import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { getPending, savePending } from '../store/PendingGmailHitlStore';
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

describe('ClaudeAgentGmail webhook', () => {
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

	it('builds record-only approval envelope and ignores unsigned query resume params when pending store entry is missing', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_approval_fallback_1',
				approved: 'true',
				// Attacker-controllable, unsigned URL query. These MUST NOT become
				// resume fields: n8n's resume token signs the execution + node path,
				// not the query string, so anyone holding the URL can forge them.
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
		expect(payload.channel).toBe('gmail');
		expect(payload.approved).toBe(true);
		// Record-only trust boundary: with no persisted pending record the resume
		// fields are all undefined. The forged query values are NEVER trusted.
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
		expect(payload.channel).toBe('gmail');
		expect(payload.approved).toBe(true);
		expect(typeof payload.decisionId).toBe('string');
		expect(typeof payload.decidedAt).toBe('string');
		// Record-only trust boundary (positive side): resume fields come FROM the
		// persisted record, so the stored approvedFingerprints / fingerprint appear.
		expect(payload.resumeSessionId).toBe('session_webhook_approval_1');
		expect(payload.approvedFingerprints).toBe('abc');
		expect(payload.fingerprint).toBe('tool:Write');
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

		const pendingStore = staticData.__claudeAgentGmail_pendingInteractions as Record<string, { status: string }>;
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
					options: [
						{ label: 'Summary', description: 'Brief overview' },
						{ label: 'Detailed', description: 'Full breakdown' },
					],
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
		expect(payload.channel).toBe('gmail');
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

		// CH-1: the submission's responseAction is NOT trusted. A forged
		// responseAction=complete on an otherwise-identical answer must NOT change
		// the derived decision — it stays a duplicate of the resume decision above,
		// never escalating into a (different) "complete" decision that would
		// terminate the agent loop.
		const forgedComplete = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_question_submit_1', type: 'question' },
			body: { 'field-0': '["Summary"]', responseAction: 'complete' },
			staticData,
		});
		const forgedCompleteResult = await webhook.call(forgedComplete.context);
		expect(forgedCompleteResult.webhookResponse).toBe('This HITL request was already answered.');

		// A genuinely different answer is the only thing that produces a conflict.
		const conflicting = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_question_submit_1', type: 'question' },
			body: { 'field-0': '["Detailed"]' },
			staticData,
		});
		const conflictResult = await webhook.call(conflicting.context);
		expect(conflictResult.webhookResponse).toBe('This HITL request was already answered with a different response.');
	});

	it('GET ?approved renders a confirmation page and does NOT consume', async () => {
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_webhook_csrf_get_1', approved: 'true' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_csrf_get_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_csrf_get_1',
			toolName: 'Write',
		});

		const result = await webhook.call(context);

		// Safe-method GET (link scanners, unfurlers, browser prefetch) must render
		// a page and consume NOTHING: no resume envelope is emitted.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();
		// Nothing consumed: the pending record is still answerable.
		expect(getPending(context, 'req_webhook_csrf_get_1')?.status).toBe('pending');

		// The page is exactly the confirmation HTML helper output.
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toBe(buildApprovalConfirmationHtml({ approved: true, toolName: 'Write' }));

		// It is a POST form carrying the decision as a hidden input, with a submit button.
		expect(html).toContain('<form method="POST"');
		expect(html).toContain('name="approved"');
		expect(html).toMatch(/<button[^>]*type="submit"/);

		// CRITICAL: no auto-submit — re-introducing any of these would resurrect the
		// automatic-approval CSRF the confirmation page exists to prevent.
		expect(html).not.toContain('.submit(');
		expect(html).not.toMatch(/onload/i);
		expect(html).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);

		// The CSRF-safe page is sent with the sandbox CSP.
		expect(response.setHeader).toHaveBeenCalledWith('Content-Security-Policy', FORM_CSP);
	});

	it('POST forged query (sid/afps/fp) with no pending record yields empty resume fields', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_forged_query_1',
				approved: 'true',
				// Forged, unsigned URL query. With no persisted record these must be
				// completely ignored (record-only resume).
				sid: 'attacker_session',
				afps: 'attacker_fingerprints',
				fp: 'tool:Bash',
			},
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_webhook_forged_query_1');
		expect(payload.channel).toBe('gmail');
		expect(payload.approved).toBe(true);
		// Record-only: no persisted record means every authorizing resume field is empty.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});
});
