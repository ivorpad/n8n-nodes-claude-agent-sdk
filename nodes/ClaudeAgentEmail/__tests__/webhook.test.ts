import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { getPending, savePending } from '../store/PendingEmailHitlStore';
import {
	buildApprovalConfirmationHtml,
	FORM_CSP,
} from '../../ClaudeAgentSdk/webhook/questionForm';

function createWebhookContext(args: {
	method: 'GET' | 'POST';
	query: Record<string, unknown>;
	body?: Record<string, unknown>;
	staticData: Record<string, unknown>;
}) {
	const response = {
		setHeader: vi.fn(),
		send: vi.fn(),
	};

	const context: Partial<IWebhookFunctions> = {
		getRequestObject: vi.fn(() => ({
			method: args.method,
			query: args.query,
		})),
		getBodyData: vi.fn(() => args.body ?? {}),
		getResponseObject: vi.fn(() => response),
		getWorkflowStaticData: vi.fn(() => args.staticData),
	};

	return { context: context as IWebhookFunctions, response };
}

describe('ClaudeAgentEmail webhook', () => {
	it('renders approval confirmation on GET without consuming pending state', async () => {
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_webhook_approval_get_1', approved: 'true' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_approval_get_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_approval_get_1',
			toolName: 'Write',
		});

		const result = await webhook.call(context);

		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();
		expect(response.send).toHaveBeenCalledTimes(1);
		expect(response.send.mock.calls[0][0]).toContain('Confirm approval');
		expect(getPending(context, 'req_webhook_approval_get_1')?.status).toBe('pending');
	});

	it('builds record-only approval envelope, ignoring unsigned query resume params, when pending store entry is missing', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_approval_fallback_1',
				approved: 'true',
				// Attacker-controllable unsigned query params: must NEVER become resume fields.
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
		expect(payload.channel).toBe('email');
		expect(payload.approved).toBe(true);
		// Record-only: with no persisted pending record, the forged query resume
		// params are discarded and the security-relevant fields stay undefined.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

	it('returns strict approval envelope for approve/deny links', async () => {
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
		expect(payload.channel).toBe('email');
		expect(payload.approved).toBe(true);
		expect(typeof payload.decisionId).toBe('string');
		expect(typeof payload.decidedAt).toBe('string');
	});

	it('rejects malformed approval value without consuming pending interaction', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_webhook_invalid_approval_1', approved: 'yes' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_invalid_approval_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_invalid_approval_1',
		});

		const result = await webhook.call(context);
		expect(result.webhookResponse).toBe('Error: Missing approved parameter');

		const pendingStore = staticData.__claudeAgentEmail_pendingInteractions as Record<string, { status: string }>;
		expect(pendingStore.req_webhook_invalid_approval_1?.status).toBe('pending');
	});

	it('treats repeated identical approval as duplicate and opposite as conflict', async () => {
		const staticData: Record<string, unknown> = {};
		const query = { requestId: 'req_webhook_conflict_1', approved: 'true' };

		const first = createWebhookContext({ method: 'POST', query, staticData });
		const second = createWebhookContext({ method: 'POST', query, staticData });
		const conflicting = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_conflict_1', approved: 'false' },
			staticData,
		});

		await webhook.call(first.context);
		const duplicate = await webhook.call(second.context);
		const conflict = await webhook.call(conflicting.context);

		expect(duplicate.webhookResponse).toBe('This HITL request was already answered.');
		expect(conflict.webhookResponse).toBe('This HITL request was already answered with a different response.');
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
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			// A link scanner / unfurler / prefetch hitting a URL that already
			// carries the answers as query params must NOT auto-answer the question.
			query: { requestId: 'req_webhook_question_csrf_1', 'field-0': '["Summary"]' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_question_csrf_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_question_csrf_1',
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

		// CSRF-safe: a non-POST never consumes the question.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		// The form is rendered instead of the answers being consumed.
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toContain('<form');
		expect(html).toContain('Submit Response');

		// The pending record is untouched (still 'pending', not 'consumed').
		expect(getPending(context, 'req_webhook_question_csrf_1')?.status).toBe('pending');
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
		expect(payload.channel).toBe('email');
		expect(payload.answers).toEqual({ Format: 'Summary' });
		expect(getPending(context, 'req_webhook_question_submit_1')?.status).toBe('consumed');

		const duplicate = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_question_submit_1', type: 'question' },
			body: { 'field-0': '["Summary"]' },
			staticData,
		});
		const duplicateResult = await webhook.call(duplicate.context);
		expect(duplicateResult.webhookResponse).toBe('This HITL request was already answered.');

		// CH-1: a caller-supplied responseAction in the submission is NOT trusted.
		// The decision is derived from the persisted question options (which carry
		// no `complete` action), so resubmitting the same answers with a forged
		// `responseAction: 'complete'` does NOT change the decision key and does NOT
		// force completion — it remains the same decision and is rejected as a
		// duplicate rather than treated as a conflicting (different) response.
		const forgedAction = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_question_submit_1', type: 'question' },
			body: { 'field-0': '["Summary"]', responseAction: 'complete' },
			staticData,
		});
		const forgedActionResult = await webhook.call(forgedAction.context);
		expect(forgedActionResult.webhookResponse).toBe('This HITL request was already answered.');
	});

	it('GET ?approved renders a confirmation page and does NOT consume', async () => {
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			// A bare GET (no persisted record) such as an email link scanner /
			// unfurler / browser prefetch would issue. Must render a page, not act.
			query: { requestId: 'req_webhook_approval_csrf_1', approved: 'true' },
			staticData,
		});

		const result = await webhook.call(context);

		// CSRF-safe: a GET never consumes the decision.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		// Nothing was persisted or consumed by the unsafe GET.
		expect(getPending(context, 'req_webhook_approval_csrf_1')).toBeUndefined();
		const pendingStore = staticData.__claudeAgentEmail_pendingInteractions as
			| Record<string, unknown>
			| undefined;
		expect(pendingStore?.req_webhook_approval_csrf_1).toBeUndefined();

		// The body is exactly the confirmation page helper output.
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toBe(buildApprovalConfirmationHtml({ approved: true, toolName: undefined }));
		expect(response.setHeader).toHaveBeenCalledWith('Content-Security-Policy', FORM_CSP);

		// It is a POST form with a hidden approved input and a submit button...
		expect(html).toMatch(/<form[^>]*method="POST"/i);
		expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="approved"[^>]*value="true"/i);
		expect(html).toMatch(/<button[^>]*type="submit"/i);

		// ...and contains NO auto-submit vector that would re-introduce auto-approval.
		expect(html).not.toContain('.submit(');
		expect(html).not.toMatch(/onload/i);
		expect(html).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);
	});

	it('POST forged query (sid/afps/fp) with no pending record yields empty resume fields', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_approval_forged_1',
				approved: 'true',
				// Forged, unsigned, attacker-controllable resume params.
				sid: 'attacker_session',
				afps: 'attacker_fingerprints',
				fp: 'tool:Bash',
			},
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_webhook_approval_forged_1');
		expect(payload.approved).toBe(true);
		expect(payload.channel).toBe('email');
		// Record-only: with no persisted record, every security-relevant resume
		// field comes from the (absent) record, never the forged query string.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

	it('uses persisted record resume fields, never the unsigned query, when a pending record exists', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_approval_record_1',
				approved: 'true',
				// These forged query values must be ignored in favor of the record.
				sid: 'session_from_query',
				afps: 'afps_from_query',
				fp: 'tool:Bash',
			},
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_approval_record_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_from_record',
			approvedFingerprints: 'afps_from_record',
			fingerprint: 'tool:Write',
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		// Resume fields come FROM THE RECORD; the query values never appear.
		expect(payload.resumeSessionId).toBe('session_from_record');
		expect(payload.approvedFingerprints).toBe('afps_from_record');
		expect(payload.fingerprint).toBe('tool:Write');
		expect(payload.resumeSessionId).not.toBe('session_from_query');
		expect(payload.approvedFingerprints).not.toBe('afps_from_query');
		expect(payload.fingerprint).not.toBe('tool:Bash');
	});
});
