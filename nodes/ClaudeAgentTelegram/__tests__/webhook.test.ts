import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { savePending } from '../store/PendingTelegramHitlStore';

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
		expect(payload.channel).toBe('telegram');
	});

	it('returns strict approval envelope for approve/deny links', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
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

	it('allows the ?approved query decision in waitForReply mode (n8n validated the signature)', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
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
	});
});
