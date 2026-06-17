import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { savePending } from '../store/PendingDiscordHitlStore';

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

function discordKeypairHex(): { publicKeyHex: string; sign: (timestamp: string, rawBody: string) => string } {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
	return {
		publicKeyHex,
		sign: (timestamp, rawBody) =>
			sign(null, Buffer.from(timestamp + rawBody, 'utf8'), privateKey).toString('hex'),
	};
}

describe('ClaudeAgentDiscord webhook', () => {
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
		expect(payload.channel).toBe('discord');
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
		expect(payload.channel).toBe('discord');
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
		expect(payload.channel).toBe('discord');
		expect(payload.answers).toEqual({ Format: 'Summary' });
	});

	it('answers a Discord PING (type 1) with a PONG (type 1) after verifying the signature', async () => {
		const { publicKeyHex, sign: signBody } = discordKeypairHex();
		const body = { type: 1 };
		const rawBody = JSON.stringify(body);
		const timestamp = '1700000000';
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body,
			rawBody,
			headers: {
				'x-signature-ed25519': signBody(timestamp, rawBody),
				'x-signature-timestamp': timestamp,
			},
			nodeParameters: { discordPublicKey: publicKeyHex },
			staticData: {},
		});

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(JSON.parse(String(result.webhookResponse))).toEqual({ type: 1 });
	});

	it('rejects an unsigned Discord component interaction (type 3) without consuming the decision', async () => {
		const { publicKeyHex } = discordKeypairHex();
		const staticData: Record<string, unknown> = {};
		const body = { type: 3, data: { custom_id: 'hitl|approve|req_discord_unsigned_1' } };
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body,
			rawBody: JSON.stringify(body),
			nodeParameters: { discordPublicKey: publicKeyHex },
			staticData,
		});

		savePending(context, {
			requestId: 'req_discord_unsigned_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_discord_unsigned_1',
		});

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(String(result.webhookResponse)).toMatch(/forbidden|invalid/i);
	});

	it('accepts a correctly signed Discord component interaction (type 3)', async () => {
		const { publicKeyHex, sign: signBody } = discordKeypairHex();
		const staticData: Record<string, unknown> = {};
		const body = { type: 3, data: { custom_id: 'hitl|approve|req_discord_signed_1' } };
		const rawBody = JSON.stringify(body);
		const timestamp = '1700000001';
		const { context } = createWebhookContext({
			method: 'POST',
			query: {},
			body,
			rawBody,
			headers: {
				'x-signature-ed25519': signBody(timestamp, rawBody),
				'x-signature-timestamp': timestamp,
			},
			nodeParameters: { discordPublicKey: publicKeyHex },
			staticData,
		});

		savePending(context, {
			requestId: 'req_discord_signed_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_discord_signed_1',
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_discord_signed_1');
		expect(payload.approved).toBe(true);
	});
});
