import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { getPending, savePending } from '../store/PendingWoztellHitlStore';
import { buildApprovalConfirmationHtml } from '../../ClaudeAgentSdk/webhook/questionForm';

function createWebhookContext(args: {
	method: 'GET' | 'POST';
	query: Record<string, unknown>;
	body?: Record<string, unknown>;
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
			if (name === 'pendingStoreBackend') return 'staticData';
			if (name === 'pendingStoreTableName') return 'claude_hitl_pending';
			return defaultValue;
		}),
		getRequestObject: vi.fn(() => ({
			method: args.method,
			query: args.query,
			headers: {},
		})),
		getHeaderData: vi.fn(() => ({})),
		getBodyData: vi.fn(() => args.body ?? {}),
		getResponseObject: vi.fn(() => response),
		getWorkflowStaticData: vi.fn(() => args.staticData),
	};

	return { context: context as IWebhookFunctions, response };
}

describe('ClaudeAgentWoztell webhook', () => {
	it('returns strict approval envelope on POST for approve/deny links in waitForReply mode', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_woztell_approval_1', approved: 'true' },
			body: { approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_approval_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_woztell_approval_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_woztell_approval_1');
		expect(payload.channel).toBe('woztell');
		expect(payload.approved).toBe(true);
		// Trust boundary: resume fields come FROM THE PERSISTED RECORD, never the query.
		expect(payload.resumeSessionId).toBe('session_woztell_approval_1');
		expect(payload.approvedFingerprints).toBe('abc');
		expect(payload.fingerprint).toBe('tool:Write');
	});

	it('uses record resume fields and IGNORES forged query params when a pending record exists (waitForReply)', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_woztell_record_1',
				approved: 'true',
				// Attacker-controllable, unsigned query params — must NOT influence resume.
				sid: 'session_from_query',
				afps: 'afps_from_query',
				fp: 'tool:Evil',
			},
			body: { approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_record_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_from_record',
			approvedFingerprints: 'afps_from_record',
			fingerprint: 'tool:Write',
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.channel).toBe('woztell');
		// Resume fields are sourced from the record, NOT the unsigned query.
		expect(payload.resumeSessionId).toBe('session_from_record');
		expect(payload.approvedFingerprints).toBe('afps_from_record');
		expect(payload.fingerprint).toBe('tool:Write');
		// The forged query values never appear.
		expect(payload.resumeSessionId).not.toBe('session_from_query');
		expect(payload.approvedFingerprints).not.toBe('afps_from_query');
		expect(payload.fingerprint).not.toBe('tool:Evil');
	});

	it('record-only resume: POST with forged query params yields undefined resume fields when pending store entry is missing (waitForReply)', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_woztell_fallback_1',
				approved: 'true',
				// Unsigned, attacker-controllable — must be ignored entirely.
				sid: 'session_from_query',
				afps: 'afps_from_query',
				fp: 'tool:Write',
			},
			body: { approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.channel).toBe('woztell');
		expect(payload.approved).toBe(true);
		// No persisted record => resume fields are record-only => all undefined.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

	it('rejects an unsigned ?approved query decision in dispatchAndExit mode (durable URL has no n8n signature)', async () => {
		// Woztell's default reply-handling mode is dispatchAndExit; the durable
		// companion URL carries no n8n signature, so an unsigned ?approved query is
		// an unauthenticated bearer token (V2, HIGH) and must be rejected.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_woztell_forged_1', approved: 'true', sid: 'session_forged' },
			nodeParameters: { replyHandlingMode: 'dispatchAndExit' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_forged_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_woztell_forged_1',
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/forbidden/i);

		// Decision must NOT have been consumed.
		const stillPending = await getPending(context, 'req_woztell_forged_1', { backend: 'staticData' });
		expect(stillPending?.status).toBe('pending');
	});

	it('GET ?approved renders a confirmation page and does NOT consume', async () => {
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_woztell_confirm_1', approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_confirm_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_woztell_confirm_1',
			toolName: 'Write',
			fingerprint: 'tool:Write',
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);

		// A safe-method GET renders a page and consumes NOTHING.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		// The page is the audited approval confirmation HTML.
		const sentHtml = response.send.mock.calls[0]?.[0] as string;
		expect(sentHtml).toBe(
			buildApprovalConfirmationHtml({ approved: true, toolName: 'Write' }),
		);
		// It is a POST form with a hidden approved input and a submit button...
		expect(sentHtml).toMatch(/<form[^>]*method="POST"/i);
		expect(sentHtml).toMatch(/<input[^>]*type="hidden"[^>]*name="approved"/i);
		expect(sentHtml).toMatch(/<button[^>]*type="submit"/i);
		// ...with NO auto-submit (no script submit, no onload, no meta-refresh).
		expect(sentHtml).not.toMatch(/\.submit\(/);
		expect(sentHtml).not.toMatch(/onload/i);
		expect(sentHtml).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);

		// The decision must NOT have been consumed by the GET.
		const stillPending = await getPending(context, 'req_woztell_confirm_1', { backend: 'staticData' });
		expect(stillPending?.status).toBe('pending');
	});

	it('GET carrying field-* params does NOT consume the question (renders form / no workflowData)', async () => {
		// CSRF: a GET (link scanner / unfurler / prefetch) that smuggles answers in the
		// query string as field-* params must render the form and consume NOTHING.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_woztell_question_get_1', 'field-0': 'Summary' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_question_get_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_woztell_question_get_1',
			message: 'Please choose an action.',
			questions: [
				{
					question: 'What should I do?',
					options: [{ label: 'Summary' }, { label: 'Detail' }],
				},
			],
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);

		// The form is rendered and the agent is NOT resumed.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		// It rendered the question form, not a JSON acknowledgement.
		const sentHtml = response.send.mock.calls[0]?.[0] as string;
		expect(sentHtml).toMatch(/<form[^>]*method="POST"/i);
		expect(sentHtml).toMatch(/What should I do\?/);

		// The forged answer was NOT consumed: the record is still pending.
		const stillPending = await getPending(context, 'req_woztell_question_get_1', { backend: 'staticData' });
		expect(stillPending?.status).toBe('pending');
		expect(stillPending?.consumedDecisionKey).toBeUndefined();
	});

	it('PUT carrying field-* params does NOT consume the question (non-POST is never a decision)', async () => {
		// Any non-POST method (HEAD/PUT/...) must render the form and consume NOTHING.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'PUT' as 'GET',
			query: { requestId: 'req_woztell_question_put_1', 'field-0': 'Summary' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_question_put_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_woztell_question_put_1',
			message: 'Please choose an action.',
			questions: [
				{
					question: 'What should I do?',
					options: [{ label: 'Summary' }, { label: 'Detail' }],
				},
			],
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);

		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		const stillPending = await getPending(context, 'req_woztell_question_put_1', { backend: 'staticData' });
		expect(stillPending?.status).toBe('pending');
		expect(stillPending?.consumedDecisionKey).toBeUndefined();
	});
});
