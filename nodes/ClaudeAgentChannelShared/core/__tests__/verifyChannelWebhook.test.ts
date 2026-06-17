import { createHmac, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { verifyDiscordEd25519 } from '../providerWebhookAuth';
import {
	isUnsignedQueryDecisionAllowed,
	verifyChannelWebhook,
	type ChannelKind,
	type ChannelWebhookSecrets,
} from '../verifyChannelWebhook';

function createContext(args: {
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
	rawBody?: string;
	nodeParameters?: Record<string, unknown>;
}): IWebhookFunctions {
	const context: Partial<IWebhookFunctions> = {
		getNodeParameter: vi.fn((name: string, defaultValue?: unknown) => {
			if (args.nodeParameters && name in args.nodeParameters) return args.nodeParameters[name];
			return defaultValue;
		}),
		getRequestObject: vi.fn(() => ({
			headers: args.headers ?? {},
			rawBody: args.rawBody,
		})),
		getHeaderData: vi.fn(() => args.headers ?? {}),
		getBodyData: vi.fn(() => args.body ?? {}),
	};
	return context as IWebhookFunctions;
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

describe('verifyDiscordEd25519', () => {
	it('accepts a correctly signed interaction', () => {
		const { publicKeyHex, sign: signBody } = discordKeypairHex();
		const timestamp = '1700000000';
		const rawBody = JSON.stringify({ type: 3, data: { custom_id: 'hitl|approve|req1' } });
		expect(
			verifyDiscordEd25519({
				publicKeyHex,
				timestamp,
				rawBody,
				signatureHex: signBody(timestamp, rawBody),
			}),
		).toBe(true);
	});

	it('rejects a tampered body', () => {
		const { publicKeyHex, sign: signBody } = discordKeypairHex();
		const timestamp = '1700000000';
		const rawBody = JSON.stringify({ type: 3, data: { custom_id: 'hitl|approve|req1' } });
		const signatureHex = signBody(timestamp, rawBody);
		expect(
			verifyDiscordEd25519({
				publicKeyHex,
				timestamp,
				rawBody: `${rawBody} tampered`,
				signatureHex,
			}),
		).toBe(false);
	});

	it('rejects a missing signature, timestamp, or public key', () => {
		const { publicKeyHex, sign: signBody } = discordKeypairHex();
		const timestamp = '1700000000';
		const rawBody = '{"type":1}';
		const signatureHex = signBody(timestamp, rawBody);
		expect(verifyDiscordEd25519({ publicKeyHex, timestamp, rawBody, signatureHex: undefined })).toBe(false);
		expect(verifyDiscordEd25519({ publicKeyHex, timestamp: undefined, rawBody, signatureHex })).toBe(false);
		expect(verifyDiscordEd25519({ publicKeyHex: '', timestamp, rawBody, signatureHex })).toBe(false);
	});

	it('rejects a signature from a different key', () => {
		const victim = discordKeypairHex();
		const attacker = discordKeypairHex();
		const timestamp = '1700000000';
		const rawBody = '{"type":3}';
		expect(
			verifyDiscordEd25519({
				publicKeyHex: victim.publicKeyHex,
				timestamp,
				rawBody,
				signatureHex: attacker.sign(timestamp, rawBody),
			}),
		).toBe(false);
	});
});

describe('verifyChannelWebhook', () => {
	it('returns not-provider-shaped for a bare query request', () => {
		const cases: Array<[ChannelKind, ChannelWebhookSecrets]> = [
			['slack', { slackSigningSecret: 's' }],
			['telegram', { telegramWebhookSecretToken: 's' }],
			['whatsapp', { whatsAppAppSecret: 's' }],
			['discord', { discordPublicKey: 'aa' }],
			['woztell', {}],
		];
		for (const [kind, secrets] of cases) {
			const ctx = createContext({ body: {} });
			expect(verifyChannelWebhook(ctx, kind, secrets).outcome).toBe('not-provider-shaped');
		}
	});

	it('rejects an unsigned Slack interaction payload but accepts a signed one', () => {
		const signingSecret = 'slack_signing_secret';
		const timestamp = String(Math.floor(Date.now() / 1000));
		const payload = JSON.stringify({ type: 'block_actions', actions: [{ value: 'hitl|approve|r1' }] });
		const rawBody = `payload=${encodeURIComponent(payload)}`;
		const signature = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;

		const unsigned = createContext({ body: { payload }, rawBody });
		expect(verifyChannelWebhook(unsigned, 'slack', { slackSigningSecret: signingSecret }).outcome).toBe('reject');

		const signed = createContext({
			body: { payload },
			rawBody,
			headers: { 'x-slack-signature': signature, 'x-slack-request-timestamp': timestamp },
		});
		expect(verifyChannelWebhook(signed, 'slack', { slackSigningSecret: signingSecret }).outcome).toBe(
			'verified-provider',
		);
	});

	it('rejects an unsigned WhatsApp provider payload but accepts a signed one', () => {
		const appSecret = 'whatsapp_app_secret';
		const body = { entry: [{ changes: [{ value: { messages: [{ from: '1', text: { body: 'Approve' } }] } }] }] };
		const rawBody = JSON.stringify(body);
		const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

		const unsigned = createContext({ body, rawBody });
		expect(verifyChannelWebhook(unsigned, 'whatsapp', { whatsAppAppSecret: appSecret }).outcome).toBe('reject');

		const signed = createContext({ body, rawBody, headers: { 'x-hub-signature-256': signature } });
		expect(verifyChannelWebhook(signed, 'whatsapp', { whatsAppAppSecret: appSecret }).outcome).toBe(
			'verified-provider',
		);
	});

	it('rejects a Telegram callback with the wrong secret token but accepts the right one', () => {
		const body = { callback_query: { id: '1', data: 'hitl|approve|r1' } };
		const wrong = createContext({ body, headers: { 'x-telegram-bot-api-secret-token': 'nope' } });
		expect(verifyChannelWebhook(wrong, 'telegram', { telegramWebhookSecretToken: 'secret' }).outcome).toBe(
			'reject',
		);

		const right = createContext({ body, headers: { 'x-telegram-bot-api-secret-token': 'secret' } });
		expect(verifyChannelWebhook(right, 'telegram', { telegramWebhookSecretToken: 'secret' }).outcome).toBe(
			'verified-provider',
		);
	});

	it('handles Discord PING and component interactions with Ed25519 verification', () => {
		const { publicKeyHex, sign: signBody } = discordKeypairHex();

		const pingBody = { type: 1 };
		const pingRaw = JSON.stringify(pingBody);
		const pingTs = '1700000000';
		const ping = createContext({
			body: pingBody,
			rawBody: pingRaw,
			headers: {
				'x-signature-ed25519': signBody(pingTs, pingRaw),
				'x-signature-timestamp': pingTs,
			},
		});
		expect(verifyChannelWebhook(ping, 'discord', { discordPublicKey: publicKeyHex }).outcome).toBe('discord-pong');

		const compBody = { type: 3, data: { custom_id: 'hitl|approve|r1' } };
		const compRaw = JSON.stringify(compBody);
		const compTs = '1700000001';
		const component = createContext({
			body: compBody,
			rawBody: compRaw,
			headers: {
				'x-signature-ed25519': signBody(compTs, compRaw),
				'x-signature-timestamp': compTs,
			},
		});
		expect(verifyChannelWebhook(component, 'discord', { discordPublicKey: publicKeyHex }).outcome).toBe(
			'verified-provider',
		);

		const unsigned = createContext({ body: compBody, rawBody: compRaw });
		expect(verifyChannelWebhook(unsigned, 'discord', { discordPublicKey: publicKeyHex }).outcome).toBe('reject');
	});
});

describe('isUnsignedQueryDecisionAllowed', () => {
	it('allows the query path in waitForReply mode (n8n validated the signature)', () => {
		const ctx = createContext({ nodeParameters: { replyHandlingMode: 'waitForReply' } });
		expect(isUnsignedQueryDecisionAllowed(ctx)).toBe(true);
	});

	it('allows the query path when no reply-handling mode exists (Slack/Discord are waitForReply-only)', () => {
		const ctx = createContext({});
		expect(isUnsignedQueryDecisionAllowed(ctx)).toBe(true);
	});

	it('rejects the unsigned query path in dispatchAndExit mode (durable URL has no n8n signature)', () => {
		const ctx = createContext({ nodeParameters: { replyHandlingMode: 'dispatchAndExit' } });
		expect(isUnsignedQueryDecisionAllowed(ctx)).toBe(false);
	});
});
