import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { getPending, savePending } from '../store/PendingTelegramHitlStore';
import { buildApprovalConfirmationHtml } from '../../ClaudeAgentSdk/webhook/questionForm';

function createWebhookContext(args: {
	method: 'GET' | 'POST';
	query: Record<string, unknown>;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
	nodeParameters?: Record<string, unknown>;
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
			headers: args.headers ?? {},
		})),
		getHeaderData: vi.fn(() => args.headers ?? {}),
		getNodeParameter: vi.fn((name: string, defaultValue?: unknown) => {
			if (args.nodeParameters && name in args.nodeParameters) return args.nodeParameters[name];
			if (name === 'pendingStoreBackend') return 'staticData';
			if (name === 'pendingStoreTableName') return 'claude_hitl_pending';
			return defaultValue;
		}),
		getBodyData: vi.fn(() => args.body ?? {}),
		getResponseObject: vi.fn(() => response),
		getWorkflowStaticData: vi.fn(() => args.staticData),
	};

	return { context: context as IWebhookFunctions, response };
}

describe('ClaudeAgentTelegram webhook', () => {
	it('builds a record-only approval envelope with empty resume fields when the pending store entry is missing', async () => {
		// Trust boundary: the unsigned URL query (sid/afps/fp) is attacker-controllable
		// and must NEVER populate resume fields. With no persisted record a POST still
		// consumes (record-only), but every security-relevant resume field stays undefined.
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
		expect(payload.channel).toBe('telegram');
		expect(payload.approved).toBe(true);
		// Forged query metadata is ignored — resume fields come from a record only.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

	it('returns strict approval envelope on POST with resume fields sourced from the persisted record', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			// Only an explicit POST consumes the decision; the resume fields below
			// come from the persisted record (never the unsigned query).
			method: 'POST',
			query: { requestId: 'req_webhook_approval_1', approved: 'true' },
			staticData,
		});

		await savePending(context, {
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
		expect(payload.channel).toBe('telegram');
		expect(payload.approved).toBe(true);
		expect(typeof payload.decisionId).toBe('string');
		expect(typeof payload.decidedAt).toBe('string');
		// Resume fields are restored from the stored record.
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

		await savePending(context, {
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
		// CSRF / safe-method: a link scanner, unfurler or prefetch issuing a GET with
		// field-* query params must render the form and consume NOTHING. Only a
		// deliberate POST may answer the question and resume the agent.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_webhook_question_csrf_1', 'field-0': '["Summary"]' },
			staticData,
		});

		await savePending(context, {
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

		// Nothing consumed: the form is rendered, no resume envelope is emitted.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toContain('<form');
		expect(html).toContain('Submit Response');

		// The pending record is untouched — still pending after the GET.
		const stillPending = await getPending(context, 'req_webhook_question_csrf_1', {
			backend: 'staticData',
			tableName: 'claude_hitl_pending',
		});
		expect(stillPending?.status).toBe('pending');

		// A PUT carrying field-* params likewise consumes nothing.
		const { context: putContext, response: putResponse } = createWebhookContext({
			method: 'PUT' as 'GET',
			query: { requestId: 'req_webhook_question_csrf_1', 'field-0': '["Summary"]' },
			staticData,
		});
		const putResult = await webhook.call(putContext);
		expect(putResult.noWebhookResponse).toBe(true);
		expect(putResult.workflowData).toBeUndefined();
		expect(putResponse.send).toHaveBeenCalledTimes(1);

		const stillPendingAfterPut = await getPending(context, 'req_webhook_question_csrf_1', {
			backend: 'staticData',
			tableName: 'claude_hitl_pending',
		});
		expect(stillPendingAfterPut?.status).toBe('pending');
	});

	it('returns strict question envelope on POST submit', async () => {
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_question_submit_1', type: 'question' },
			body: { 'field-0': '["Summary"]' },
			staticData,
		});

		await savePending(context, {
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
		expect(payload.channel).toBe('telegram');
		expect(payload.answers).toEqual({ Format: 'Summary' });
	});

	it('rejects Telegram callback queries without the configured secret token', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body: {
				callback_query: {
					id: 'callback-unsigned',
					data: 'hitl|approve|req_telegram_unsigned_1',
				},
			},
			nodeParameters: { telegramWebhookSecretToken: 'telegram_secret' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_telegram_unsigned_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_telegram_unsigned_1',
		});

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/forbidden/i);
	});

	it('accepts Telegram callback queries with the configured secret token', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body: {
				callback_query: {
					id: 'callback-signed',
					data: 'hitl|approve|req_telegram_signed_1',
				},
			},
			headers: { 'x-telegram-bot-api-secret-token': 'telegram_secret' },
			nodeParameters: { telegramWebhookSecretToken: 'telegram_secret' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_telegram_signed_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_telegram_signed_1',
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_telegram_signed_1');
		expect(payload.approved).toBe(true);
	});

	it('rejects an unsigned ?approved query decision in dispatchAndExit mode (durable URL has no n8n signature)', async () => {
		// Shape-bypass: a request that is NOT provider-shaped but carries a forged
		// ?requestId=&approved=true must not resume the execution when the durable
		// companion URL is unsigned (dispatchAndExit).
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_telegram_forged_query_1', approved: 'true', sid: 'session_forged' },
			nodeParameters: { replyHandlingMode: 'dispatchAndExit' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_telegram_forged_query_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_telegram_forged_1',
		});

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/forbidden/i);
	});

	it('allows the POST ?approved decision in waitForReply mode (n8n validated the signature)', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			// waitForReply means n8n signed and validated the resume URL upstream, so
			// the query path is permitted — but only an explicit POST consumes.
			method: 'POST',
			query: { requestId: 'req_telegram_waitforreply_1', approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_telegram_waitforreply_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_telegram_waitforreply_1',
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.approved).toBe(true);
		expect(payload.resumeSessionId).toBe('session_telegram_waitforreply_1');
	});

	it('GET ?approved renders a confirmation page and does NOT consume', async () => {
		// CSRF / safe-method: link scanners, unfurlers and browser prefetch issue
		// automatic GETs against approve/deny URLs. A GET must render a confirmation
		// page and consume NOTHING — only a deliberate POST may consume.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_webhook_get_confirm_1', approved: 'true' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_webhook_get_confirm_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_get_confirm_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
		});

		const result = await webhook.call(context);

		// Nothing consumed: no resume envelope is emitted.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		// The page sent is the audited POST-form confirmation page.
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toBe(buildApprovalConfirmationHtml({ approved: true }));
		expect(html).toContain('<form method="POST"');
		expect(html).toContain('name="approved"');
		expect(html).toContain('type="submit"');
		// No auto-submit: no scripted submit, onload, or meta-refresh.
		expect(html).not.toContain('.submit(');
		expect(html).not.toMatch(/onload/i);
		expect(html).not.toMatch(/http-equiv=["']?refresh/i);

		// The decision is still pending after the GET — it was not consumed.
		const result2 = await webhook.call(context);
		expect(result2.noWebhookResponse).toBe(true);
		expect(result2.workflowData).toBeUndefined();
	});

	it('POST forged query (sid/afps/fp) with no pending record yields empty resume fields', async () => {
		// Record-only trust boundary: with no persisted record the POST consumes,
		// but the attacker-controllable query metadata is never used for resume.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_forged_post_1',
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
		expect(payload.requestId).toBe('req_webhook_forged_post_1');
		expect(payload.approved).toBe(true);
		expect(payload.channel).toBe('telegram');
		// Forged query metadata must not leak into the resume envelope.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});
});
