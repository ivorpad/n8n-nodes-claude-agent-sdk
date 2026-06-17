import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { savePending } from '../store/PendingSlackHitlStore';

function createWebhookContext(args: {
	method: 'GET' | 'POST';
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
	it('builds approval envelope from signed query params when pending store entry is missing', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
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
		expect(payload.resumeSessionId).toBe('session_from_query');
		expect(payload.approvedFingerprints).toBe('afps_from_query');
		expect(payload.fingerprint).toBe('tool:Write');
		expect(payload.channel).toBe('slack');
	});

	it('returns strict approval envelope for approve/deny links', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
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

	it('allows the in-waitForReply n8n-signed query path (no provider shape)', async () => {
		// waitForReply means n8n validated the resume signature before invoking the webhook.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
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
