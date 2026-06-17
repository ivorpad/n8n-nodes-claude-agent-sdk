import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { getPending, savePending } from '../store/PendingSlackHitlStore';
import { buildApprovalConfirmationHtml } from '../../ClaudeAgentSdk/webhook/questionForm';

function createWebhookContext(args: {
	method: 'GET' | 'POST' | 'HEAD' | 'PUT';
	query: Record<string, unknown>;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
	rawBody?: string;
	nodeParameters?: Record<string, unknown>;
	staticData: Record<string, unknown>;
}) {
	const response = {
		setHeader: vi.fn(),
		send: vi.fn(),
	};

	const context: Partial<IWebhookFunctions> = {
		getNodeParameter: vi.fn((name: string, defaultValue?: unknown) => {
			if (args.nodeParameters && name in args.nodeParameters) return args.nodeParameters[name];
			return defaultValue;
		}),
		getRequestObject: vi.fn(() => ({
			method: args.method,
			query: args.query,
			headers: args.headers ?? {},
			rawBody: args.rawBody,
		})),
		getHeaderData: vi.fn(() => args.headers ?? {}),
		getBodyData: vi.fn(() => args.body ?? {}),
		getResponseObject: vi.fn(() => response),
		getWorkflowStaticData: vi.fn(() => args.staticData),
	};

	return { context: context as IWebhookFunctions, response };
}

function signSlackBody(rawBody: string, signingSecret: string, timestamp: string): Record<string, string> {
	const signature = createHmac('sha256', signingSecret)
		.update(`v0:${timestamp}:${rawBody}`)
		.digest('hex');
	return {
		'x-slack-request-timestamp': timestamp,
		'x-slack-signature': `v0=${signature}`,
	};
}

describe('ClaudeAgentSlack webhook', () => {
	it('builds record-only approval envelope (ignores unsigned query sid/afps/fp) when pending store entry is missing', async () => {
		// The resume URL is delivered out-of-band and n8n's resume token signs only
		// the execution + node path, NOT the query string, so sid/afps/fp are
		// attacker-controllable. A POST consumes the decision, but these forged
		// query values must NEVER become resume fields — they must be undefined.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_approval_fallback_1',
				approved: 'true',
				sid: 'session_from_query',
				afps: 'afps_from_query',
				fp: 'tool:Write',
			},
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_webhook_approval_fallback_1');
		expect(payload.approved).toBe(true);
		expect(payload.channel).toBe('slack');
		// Record-only trust boundary: no persisted record => all resume fields undefined.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

	it('GET ?approved renders a confirmation page and does NOT consume', async () => {
		// Link scanners, unfurlers and browser prefetch issue automatic GETs against
		// approve/deny URLs. A GET must render a confirmation page and consume
		// nothing; only an explicit POST (button click) consumes the decision.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_slack_get_confirm_1', approved: 'true' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_slack_get_confirm_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_slack_get_confirm_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
		});

		const result = await webhook.call(context);

		// Nothing consumed: no resume envelope emitted, page rendered out-of-band.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		// Exact audited confirmation page (CSRF-safe GET->POST handoff).
		expect(html).toBe(buildApprovalConfirmationHtml({ approved: true }));
		// It is a POST form with a hidden approved input and a submit button.
		expect(html).toMatch(/<form[^>]*method="POST"/i);
		expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="approved"/i);
		expect(html).toMatch(/<button[^>]*type="submit"/i);
		// No auto-submit of any kind — that would re-introduce the vulnerability.
		expect(html).not.toMatch(/\.submit\(/);
		expect(html).not.toMatch(/onload/i);
		expect(html).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);
	});

	it('POST forged query (sid/afps/fp) with no pending record yields empty resume fields', async () => {
		// A forged URL carrying resume metadata in the query must not grant authority:
		// with no persisted record the consumed envelope is record-only (all undefined).
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_slack_forged_query_1',
				approved: 'true',
				sid: 'forged_session',
				afps: 'forged_afps',
				fp: 'tool:Bash',
			},
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_slack_forged_query_1');
		expect(payload.approved).toBe(true);
		expect(payload.channel).toBe('slack');
		// Record-only: forged query values never become resume fields.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

	it('returns strict approval envelope on POST with resume fields sourced from the persisted record', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_approval_1', approved: 'true' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_approval_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_approval_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_webhook_approval_1');
		expect(payload.version).toBe('1.0');
		expect(payload.channel).toBe('slack');
		expect(payload.approved).toBe(true);
		expect(typeof payload.decisionId).toBe('string');
		expect(typeof payload.decidedAt).toBe('string');
		// Resume fields come from the persisted record, not the query string.
		expect(payload.resumeSessionId).toBe('session_webhook_approval_1');
		expect(payload.approvedFingerprints).toBe('abc');
		expect(payload.fingerprint).toBe('tool:Write');
	});

	it('renders HTML question form on GET before submission', async () => {
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_webhook_question_form_1', type: 'question' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_question_form_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_question_1',
			questions: [
				{
					question: 'How should output be formatted?',
					header: 'Format',
					options: [{ label: 'Summary', description: 'Brief overview' }],
					multiSelect: false,
				},
			],
		});

		const result = await webhook.call(context);
		expect(result.noWebhookResponse).toBe(true);
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toContain('<form');
		expect(html).toContain('Submit Response');
	});

	it('GET carrying field-* params does NOT consume the question (renders form / no workflowData)', async () => {
		// Link scanners, unfurlers and prefetch issue automatic GETs. A GET that carries
		// field-* answer params in the query must render the form and consume NOTHING —
		// only an explicit POST (deliberate form submit) may resume the agent.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_slack_get_field_no_consume_1', 'field-0': 'Summary' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_slack_get_field_no_consume_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_slack_get_field_no_consume_1',
			questions: [
				{
					question: 'How should output be formatted?',
					header: 'Format',
					options: [{ label: 'Summary', description: 'Brief overview' }],
					multiSelect: false,
				},
			],
		});

		const result = await webhook.call(context);

		// Nothing consumed: the form is rendered out-of-band, no resume envelope emitted.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toContain('<form');
		expect(html).toContain('Submit Response');

		// The pending record is untouched — still awaiting a real answer.
		expect(getPending(context, 'req_slack_get_field_no_consume_1')?.status).toBe('pending');
	});

	it('PUT carrying field-* params does NOT consume the question', async () => {
		// Any non-POST method (HEAD/PUT/etc.) must be treated like a GET: render-only,
		// never consume. This closes the GET-consume CSRF gap across all verbs.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'PUT',
			query: { requestId: 'req_slack_put_no_consume_1', 'field-0': 'Summary' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_slack_put_no_consume_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_slack_put_no_consume_1',
			questions: [
				{
					question: 'How should output be formatted?',
					header: 'Format',
					options: [{ label: 'Summary', description: 'Brief overview' }],
					multiSelect: false,
				},
			],
		});

		const result = await webhook.call(context);

		expect(result.workflowData).toBeUndefined();
		expect(response.send).toHaveBeenCalledTimes(1);
		// The pending record is untouched.
		expect(getPending(context, 'req_slack_put_no_consume_1')?.status).toBe('pending');
	});

	it('returns strict question envelope on POST submit', async () => {
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_question_submit_1', type: 'question' },
			body: { 'field-0': '["Summary"]' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_question_submit_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_question_2',
			questions: [
				{
					question: 'How should output be formatted?',
					header: 'Format',
					options: [{ label: 'Summary', description: 'Brief overview' }],
					multiSelect: false,
				},
			],
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(response.send).toHaveBeenCalledTimes(1);
		expect(payload.type).toBe('question_response');
		expect(payload.requestId).toBe('req_webhook_question_submit_1');
		expect(payload.version).toBe('1.0');
		expect(payload.channel).toBe('slack');
		expect(payload.answers).toEqual({ Format: 'Summary' });
	});

	it('rejects unsigned Slack interaction payloads before consuming approval decisions', async () => {
		const staticData: Record<string, unknown> = {};
		const payload = JSON.stringify({
			type: 'block_actions',
			actions: [{ value: 'hitl|approve|req_slack_unsigned_1' }],
		});
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body: { payload },
			rawBody: `payload=${encodeURIComponent(payload)}`,
			nodeParameters: { slackSigningSecret: 'slack_signing_secret' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_slack_unsigned_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_slack_unsigned_1',
		});

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/forbidden/i);
	});

	it('allows the in-waitForReply n8n-signed query path on POST (no provider shape)', async () => {
		// waitForReply means n8n validated the resume signature before invoking the
		// webhook. The decision is still only consumed on an explicit POST.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_slack_waitforreply_1', approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.approved).toBe(true);
	});

	it('accepts signed Slack interaction payloads', async () => {
		const staticData: Record<string, unknown> = {};
		const signingSecret = 'slack_signing_secret';
		const timestamp = String(Math.floor(Date.now() / 1000));
		const payload = JSON.stringify({
			type: 'block_actions',
			actions: [{ value: 'hitl|approve|req_slack_signed_1' }],
		});
		const rawBody = `payload=${encodeURIComponent(payload)}`;
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body: { payload },
			headers: signSlackBody(rawBody, signingSecret, timestamp),
			rawBody,
			nodeParameters: { slackSigningSecret: signingSecret },
			staticData,
		});

		savePending(context, {
			requestId: 'req_slack_signed_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_slack_signed_1',
		});

		const result = await webhook.call(context);
		const payloadJson = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payloadJson.type).toBe('approval_response');
		expect(payloadJson.requestId).toBe('req_slack_signed_1');
		expect(payloadJson.approved).toBe(true);
	});
});
