import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { getPending, savePending } from '../store/PendingWhatsAppHitlStore';

function createWebhookContext(args: {
	method: 'GET' | 'POST';
	query: Record<string, unknown>;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
	rawBody?: string;
	credentials?: Record<string, unknown>;
	nodeParameters?: Record<string, unknown>;
	staticData: Record<string, unknown>;
}) {
	const response = {
		setHeader: vi.fn(),
		send: vi.fn(),
	};

	const context: Partial<IWebhookFunctions> = {
		getNodeParameter: vi.fn((name: string, second?: unknown, third?: unknown) => {
			const defaultValue = third === undefined ? second : third;
			if (args.nodeParameters && name in args.nodeParameters) return args.nodeParameters[name];
			if (name === 'pendingStoreBackend') return 'staticData';
			if (name === 'pendingStoreTableName') return 'claude_hitl_pending';
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
		getCredentials: vi.fn(async () => args.credentials ?? {}),
	};

	return { context: context as IWebhookFunctions, response };
}

function signWhatsAppBody(rawBody: string, appSecret: string): Record<string, string> {
	return {
		'x-hub-signature-256': `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`,
	};
}

describe('ClaudeAgentWhatsApp webhook', () => {
	it('builds record-only approval envelope (forged query sid/afps/fp ignored) when pending store entry is missing', async () => {
		// The unsigned companion URL query (sid/afps/fp) is attacker-controllable and
		// MUST NEVER populate resume fields. With no persisted pending record, a POST
		// approve still consumes the decision, but every resume field stays undefined.
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
		// Record-only trust boundary: forged query metadata is never trusted.
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

		await savePending(context, {
			requestId: 'req_webhook_approval_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_approval_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_webhook_approval_1');
		expect(payload.version).toBe('1.0');
		expect(payload.channel).toBe('whatsapp');
		expect(payload.approved).toBe(true);
		expect(typeof payload.decisionId).toBe('string');
		expect(typeof payload.decidedAt).toBe('string');
	});

	it('resolves approval by WhatsApp context message id when requestId is absent', async () => {
		const staticData: Record<string, unknown> = {};
		const appSecret = 'whatsapp_app_secret';
		const body = {
			entry: [
				{
					changes: [
						{
							value: {
								messages: [
									{
										from: '34696169382',
										context: { id: 'wamid.pending.approval.1' },
										text: { body: 'Approve' },
									},
								],
							},
						},
					],
				},
			],
		};
		const rawBody = JSON.stringify(body);
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body,
			headers: signWhatsAppBody(rawBody, appSecret),
			rawBody,
			credentials: { appSecret },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_webhook_approval_context_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_approval_context_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
			recipientId: '34696169382',
			providerMessageId: 'wamid.pending.approval.1',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_webhook_approval_context_1');
		expect(payload.approved).toBe(true);
	});

	it('rejects unsigned WhatsApp provider replies before resolving latest pending by recipient', async () => {
		const staticData: Record<string, unknown> = {};
		const body = {
			entry: [
				{
					changes: [
						{
							value: {
								messages: [
									{
										from: '34696169382',
										text: { body: 'Approve' },
									},
								],
							},
						},
					],
				},
			],
		};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body,
			rawBody: JSON.stringify(body),
			credentials: { appSecret: 'whatsapp_app_secret' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_webhook_latest_unsigned_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_latest_unsigned_1',
			recipientId: '34696169382',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/forbidden/i);

		const pendingAfter = await getPending(context, 'req_webhook_latest_unsigned_1', { backend: 'staticData' });
		expect(pendingAfter?.status).toBe('pending');
	});

	it('returns already answered on duplicate approval reply', async () => {
		const staticData: Record<string, unknown> = {};
		const initial = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_approval_duplicate_1', approved: 'true' },
			staticData,
		});

		await savePending(initial.context, {
			requestId: 'req_webhook_approval_duplicate_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_approval_duplicate_1',
		}, { backend: 'staticData' });

		const firstResult = await webhook.call(initial.context);
		expect(firstResult.workflowData?.[0]?.[0]?.json?.type).toBe('approval_response');

		const replay = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_approval_duplicate_1', approved: 'true' },
			staticData,
		});
		const replayResult = await webhook.call(replay.context);
		expect(replayResult.workflowData).toBeUndefined();
		expect(replayResult.webhookResponse).toMatch(/already answered/i);
	});

	it('returns conflict when replay uses a different approval decision', async () => {
		const staticData: Record<string, unknown> = {};
		const approved = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_approval_conflict_1', approved: 'true' },
			staticData,
		});

		await savePending(approved.context, {
			requestId: 'req_webhook_approval_conflict_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_approval_conflict_1',
		}, { backend: 'staticData' });

		const firstResult = await webhook.call(approved.context);
		expect(firstResult.workflowData?.[0]?.[0]?.json?.type).toBe('approval_response');

		const deniedReplay = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_approval_conflict_1', approved: 'false' },
			staticData,
		});
		const replayResult = await webhook.call(deniedReplay.context);
		expect(replayResult.workflowData).toBeUndefined();
		expect(replayResult.webhookResponse).toMatch(/different response/i);
	});

	it('does not fall back to latest recipient pending when inbound includes unknown requestId', async () => {
		const staticData: Record<string, unknown> = {};
		const appSecret = 'whatsapp_app_secret';
		const body = {
			entry: [
				{
					changes: [
						{
							value: {
								messages: [
									{
										from: '34696169382',
										interactive: {
											type: 'button_reply',
											button_reply: {
												id: 'hitl|approve|req_webhook_unknown_approval_1',
												title: 'Approve',
											},
										},
									},
								],
							},
						},
					],
				},
			],
		};
		const rawBody = JSON.stringify(body);
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body,
			headers: signWhatsAppBody(rawBody, appSecret),
			rawBody,
			credentials: { appSecret },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_webhook_known_approval_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_known_approval_1',
			recipientId: '34696169382',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/unknown or expired/i);

		const pendingAfter = await getPending(context, 'req_webhook_known_approval_1', { backend: 'staticData' });
		expect(pendingAfter?.status).toBe('pending');
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
		}, { backend: 'staticData' });

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
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(response.send).toHaveBeenCalledTimes(1);
		expect(payload.type).toBe('question_response');
		expect(payload.requestId).toBe('req_webhook_question_submit_1');
		expect(payload.version).toBe('1.0');
		expect(payload.channel).toBe('whatsapp');
		expect(payload.answers).toEqual({ Format: 'Summary' });
	});

	it('rejects blank question submissions and keeps pending interaction unresolved', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_webhook_question_blank_1', type: 'question' },
			body: {},
			staticData,
		});

		await savePending(context, {
			requestId: 'req_webhook_question_blank_1',
			kind: 'question',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_question_blank_1',
			questions: [
				{
					question: 'How should output be formatted?',
					header: 'Format',
					options: [{ label: 'Summary', description: 'Brief overview' }],
					multiSelect: false,
				},
			],
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/missing question answers/i);

		const pendingAfter = await getPending(context, 'req_webhook_question_blank_1', { backend: 'staticData' });
		expect(pendingAfter?.status).toBe('pending');
	});

	it('builds record-only question envelope (forged query sid/afps ignored) when pending store entry is missing', async () => {
		// Question metadata (q) is needed to render/parse the form, but the unsigned
		// sid/afps query params are attacker-controllable and MUST NOT become resume
		// fields. With no persisted record, those resume fields stay undefined.
		const staticData: Record<string, unknown> = {};
		const questions = [
			{
				question: 'How should output be formatted?',
				header: 'Format',
				options: [{ label: 'Summary', description: 'Brief overview' }],
				multiSelect: false,
			},
		];
		const q = Buffer.from(JSON.stringify(questions)).toString('base64');
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_question_fallback_1',
				type: 'question',
				sid: 'session_from_query_q',
				afps: 'afps_from_query_q',
				q,
			},
			body: { 'field-0': '["Summary"]' },
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('question_response');
		expect(payload.requestId).toBe('req_webhook_question_fallback_1');
		expect(payload.answers).toEqual({ Format: 'Summary' });
		// Record-only trust boundary: forged query metadata is never trusted.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
	});

	it('renders question form from signed query metadata when pending entry is missing', async () => {
		const staticData: Record<string, unknown> = {};
		const questions = [
			{
				question: 'How should output be formatted?',
				header: 'Format',
				options: [{ label: 'Summary', description: 'Brief overview' }],
				multiSelect: false,
			},
		];
		const q = Buffer.from(JSON.stringify(questions)).toString('base64');
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: {
				requestId: 'req_webhook_question_form_fallback_1',
				type: 'question',
				q,
			},
			staticData,
		});

		const result = await webhook.call(context);
		expect(result.noWebhookResponse).toBe(true);
		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toContain('<form');
		expect(html).toContain('Submit Response');
	});

	it('returns helpful error when signed question metadata is invalid', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: {
				requestId: 'req_webhook_question_invalid_q_1',
				type: 'question',
				q: 'not-base64-json',
			},
			staticData,
		});

		const result = await webhook.call(context);
		expect(result.webhookResponse).toMatch(/Missing question definition/i);
	});

	it('returns already answered on duplicate question submission', async () => {
		const staticData: Record<string, unknown> = {};
		const questions = [
			{
				question: 'How should output be formatted?',
				header: 'Format',
				options: [{ label: 'Summary', description: 'Brief overview' }],
				multiSelect: false,
			},
		];
		const q = Buffer.from(JSON.stringify(questions)).toString('base64');

		const first = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_question_duplicate_1',
				type: 'question',
				q,
			},
			body: { 'field-0': '["Summary"]' },
			staticData,
		});

		const firstResult = await webhook.call(first.context);
		expect(firstResult.workflowData?.[0]?.[0]?.json?.type).toBe('question_response');

		const replay = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_question_duplicate_1',
				type: 'question',
				q,
			},
			body: { 'field-0': '["Summary"]' },
			staticData,
		});

		const replayResult = await webhook.call(replay.context);
		expect(replayResult.workflowData).toBeUndefined();
		expect(replayResult.webhookResponse).toMatch(/already answered/i);
	});

	it('rejects an unsigned ?approved query decision in dispatchAndExit mode (durable URL has no n8n signature)', async () => {
		// Shape-bypass: a non-provider-shaped request carrying a forged
		// ?requestId=&approved=true must not resume the execution when the durable
		// companion URL is unsigned (dispatchAndExit default for WhatsApp).
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_wa_forged_query_1', approved: 'true', sid: 'session_forged' },
			nodeParameters: { replyHandlingMode: 'dispatchAndExit' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_wa_forged_query_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_wa_forged_1',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/forbidden/i);

		// Decision must NOT have been consumed.
		const stillPending = await getPending(context, 'req_wa_forged_query_1', { backend: 'staticData' });
		expect(stillPending?.status).toBe('pending');
	});

	it('allows the ?approved query decision in waitForReply mode via POST (n8n validated the signature)', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: { requestId: 'req_wa_waitforreply_1', approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_wa_waitforreply_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_wa_waitforreply_1',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.approved).toBe(true);
	});


	it('GET ?approved renders a confirmation page and does NOT consume', async () => {
		// CSRF / safe-method: a GET carrying ?approved must render a confirmation PAGE
		// (a POST form with no auto-submit) and must NOT consume the pending decision.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_wa_get_confirm_1', approved: 'true' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_wa_get_confirm_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_wa_get_confirm_1',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);

		// Nothing consumed: confirmation-only render, no resume envelope emitted.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();
		expect(response.send).toHaveBeenCalledTimes(1);

		const html = response.send.mock.calls[0][0] as string;
		// A POST form with a hidden approved input and a submit button...
		expect(html).toMatch(/<form[^>]*method=["']POST["']/i);
		expect(html).toMatch(/<input[^>]*name=["']approved["']/i);
		expect(html).toMatch(/<button[^>]*type=["']submit["']/i);
		// ...and NO auto-submit (no script submit, onload, or meta refresh).
		expect(html).not.toContain('.submit(');
		expect(html).not.toMatch(/onload/i);
		expect(html).not.toMatch(/http-equiv=["']?refresh/i);

		// The decision must still be pending — the GET did not consume it.
		const stillPending = await getPending(context, 'req_wa_get_confirm_1', { backend: 'staticData' });
		expect(stillPending?.status).toBe('pending');
	});

	it('POST forged query (sid/afps/fp) with no pending record yields empty resume fields', async () => {
		// Record-only trust boundary: an attacker-controllable unsigned query may carry
		// sid/afps/fp, but with NO persisted pending record the consumed envelope must
		// expose none of them — all resume fields are undefined.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_wa_forged_record_only_1',
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
		expect(payload.requestId).toBe('req_wa_forged_record_only_1');
		expect(payload.approved).toBe(true);
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

});
