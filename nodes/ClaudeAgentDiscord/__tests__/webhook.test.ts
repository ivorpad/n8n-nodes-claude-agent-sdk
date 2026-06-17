import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { buildApprovalConfirmationHtml } from '../../ClaudeAgentSdk/webhook/questionForm';
import { getPending, savePending } from '../store/PendingDiscordHitlStore';

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
	it('builds record-only approval envelope on POST, ignoring unsigned query params when pending store entry is missing', async () => {
		// Trust boundary: the unsigned URL query (sid/afps/fp) is attacker-controllable
		// and must NEVER be folded into resume fields. With no persisted pending record,
		// a POST consumes (record-only) and every security-relevant resume field is
		// undefined — the query values are dropped on the floor.
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
		expect(payload.channel).toBe('discord');
		// Record-only: forged query values must NOT appear; with no record these are empty.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
	});

	it('returns strict approval envelope on POST for approve/deny links, with resume fields sourced from the persisted record', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			// Only an explicit POST consumes the decision (GET renders a confirmation page).
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
		expect(payload.channel).toBe('discord');
		expect(payload.approved).toBe(true);
		expect(typeof payload.decisionId).toBe('string');
		expect(typeof payload.decidedAt).toBe('string');
		// Record-only trust boundary: resume fields come FROM THE STORED RECORD.
		expect(payload.resumeSessionId).toBe('session_webhook_approval_1');
		expect(payload.approvedFingerprints).toBe('abc');
		expect(payload.fingerprint).toBe('tool:Write');
	});

	it('GET ?approved renders a confirmation page and does NOT consume', async () => {
		// CSRF / safe-method: a GET carrying ?approved=true (issued by link scanners,
		// unfurlers, browser prefetch) must render a confirmation PAGE and consume nothing.
		const staticData: Record<string, unknown> = {};
		const { context, response } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_webhook_approval_csrf_1', approved: 'true' },
			staticData,
		});

		savePending(context, {
			requestId: 'req_webhook_approval_csrf_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_webhook_approval_csrf_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
		});

		const result = await webhook.call(context);

		// Nothing consumed: no resume envelope emitted, just a rendered page.
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData).toBeUndefined();

		expect(response.send).toHaveBeenCalledTimes(1);
		const html = response.send.mock.calls[0][0] as string;
		expect(html).toBe(buildApprovalConfirmationHtml({ approved: true }));
		// It is a POST form with a hidden approved input and a submit button.
		expect(html).toContain('<form method="POST"');
		expect(html).toContain('name="approved"');
		expect(html).toContain('type="submit"');
		// And it must NOT auto-submit (no script, onload, or meta-refresh).
		expect(html).not.toContain('.submit(');
		expect(html).not.toContain('onload');
		expect(html).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);

		// The pending record is still pending — a confirmation page never consumes.
		expect(getPending(context, 'req_webhook_approval_csrf_1')?.status).toBe('pending');
	});

	it('POST forged query (sid/afps/fp) with no pending record yields empty resume fields', async () => {
		// Record-only: even on the consuming POST, attacker-controllable query params
		// (sid/afps/fp) are never trusted as resume authority. With no persisted record,
		// every security-relevant resume field is undefined.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_webhook_forged_query_1',
				approved: 'true',
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
		expect(payload.approved).toBe(true);
		expect(payload.channel).toBe('discord');
		// Forged query values must be dropped entirely.
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.fingerprint).toBeUndefined();
		expect(payload.resumeSessionId).not.toBe('attacker_session');
		expect(payload.approvedFingerprints).not.toBe('attacker_fingerprints');
		expect(payload.fingerprint).not.toBe('tool:Bash');
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
