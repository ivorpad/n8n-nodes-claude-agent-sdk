import type { IWebhookFunctions } from 'n8n-workflow';

import {
	getHeaderValue,
	getRawBodyString,
	verifyDiscordEd25519,
	verifySha256Signature,
	verifySlackRequest,
	verifyStaticSecret,
} from './providerWebhookAuth';

/**
 * Channel-agnostic webhook verification.
 *
 * Before this module each channel webhook verified the provider signature *only*
 * inside the branch that detected the provider payload shape. A request that did
 * not match that shape fell through to the unsigned `?requestId=&approved=` query
 * path and could resume an execution without any signature check (V2, HIGH).
 *
 * `verifyChannelWebhook` centralises (a) provider-shape detection and (b) running
 * the correct provider verifier, returning a typed outcome the caller acts on
 * uniformly. The query-path gate (`isUnsignedQueryDecisionAllowed`) lives here too
 * so all channels make the same decision about unsigned bearer-style decisions.
 */

export type ChannelKind = 'slack' | 'discord' | 'telegram' | 'whatsapp' | 'woztell';

export type ChannelWebhookVerification =
	/** A provider-shaped callback whose signature verified — safe to consume. */
	| { outcome: 'verified-provider' }
	/**
	 * Not a provider-shaped callback. The caller proceeds to the query/form path,
	 * which it must independently gate via `isUnsignedQueryDecisionAllowed`.
	 */
	| { outcome: 'not-provider-shaped' }
	/** A provider-shaped callback with a missing/invalid signature — must reject. */
	| { outcome: 'reject' }
	/** Discord `type:1` PING — caller must answer with a `type:1` PONG. */
	| { outcome: 'discord-pong' };

export interface ChannelWebhookSecrets {
	/** Slack app signing secret (channelKind: 'slack'). */
	slackSigningSecret?: unknown;
	/** Telegram webhook secret token, compared against the provider header (channelKind: 'telegram'). */
	telegramWebhookSecretToken?: unknown;
	/** WhatsApp Business Cloud app secret used for the HMAC-SHA256 signature (channelKind: 'whatsapp'). */
	whatsAppAppSecret?: unknown;
	/** Discord application public key (hex) used to verify Ed25519 interaction signatures (channelKind: 'discord'). */
	discordPublicKey?: unknown;
	/** Test/clock injection for Slack's timestamp window. */
	nowMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function isSlackProviderShaped(body: Record<string, unknown> | undefined): boolean {
	// Slack sends interaction payloads as { payload: "<JSON string>" }.
	return typeof body?.payload === 'string';
}

function isTelegramProviderShaped(body: Record<string, unknown> | undefined): boolean {
	const callbackQuery = body?.callback_query;
	return typeof callbackQuery === 'object' && callbackQuery !== null;
}

function isWhatsAppProviderShaped(body: Record<string, unknown> | undefined): boolean {
	return Array.isArray(body?.entry);
}

function isDiscordInteraction(body: Record<string, unknown> | undefined): boolean {
	// Discord interactions always carry a numeric `type` (1=PING, 2=COMMAND, 3=MESSAGE_COMPONENT...).
	return typeof body?.type === 'number';
}

/**
 * Returns the provider-verification outcome for the inbound request.
 *
 * For Discord, ALL interactions (PING and component callbacks) require a valid
 * Ed25519 signature first; a valid PING then yields `discord-pong`, and a valid
 * component callback yields `verified-provider`.
 */
export function verifyChannelWebhook(
	ctx: IWebhookFunctions,
	channelKind: ChannelKind,
	secrets: ChannelWebhookSecrets,
): ChannelWebhookVerification {
	const req = ctx.getRequestObject();
	const body = asRecord(ctx.getBodyData());

	switch (channelKind) {
		case 'slack': {
			if (!isSlackProviderShaped(body)) return { outcome: 'not-provider-shaped' };
			const verified = verifySlackRequest({
				signingSecret: secrets.slackSigningSecret,
				rawBody: getRawBodyString(req),
				signatureHeader: getHeaderValue(ctx.getHeaderData(), 'x-slack-signature'),
				timestampHeader: getHeaderValue(ctx.getHeaderData(), 'x-slack-request-timestamp'),
				nowMs: secrets.nowMs,
			});
			return verified ? { outcome: 'verified-provider' } : { outcome: 'reject' };
		}

		case 'telegram': {
			if (!isTelegramProviderShaped(body)) return { outcome: 'not-provider-shaped' };
			const verified = verifyStaticSecret({
				expectedSecret: secrets.telegramWebhookSecretToken,
				providedSecret: getHeaderValue(ctx.getHeaderData(), 'x-telegram-bot-api-secret-token'),
			});
			return verified ? { outcome: 'verified-provider' } : { outcome: 'reject' };
		}

		case 'whatsapp': {
			if (!isWhatsAppProviderShaped(body)) return { outcome: 'not-provider-shaped' };
			const verified = verifySha256Signature({
				secret: secrets.whatsAppAppSecret,
				rawBody: getRawBodyString(req),
				signatureHeader: getHeaderValue(ctx.getHeaderData(), 'x-hub-signature-256'),
				prefix: 'sha256=',
			});
			return verified ? { outcome: 'verified-provider' } : { outcome: 'reject' };
		}

		case 'discord': {
			if (!isDiscordInteraction(body)) return { outcome: 'not-provider-shaped' };
			// Discord REQUIRES verifying X-Signature-Ed25519 against the app public key
			// before processing ANY interaction (including the PING handshake).
			const verified = verifyDiscordEd25519({
				publicKeyHex: secrets.discordPublicKey,
				timestamp: getHeaderValue(ctx.getHeaderData(), 'x-signature-timestamp'),
				rawBody: getRawBodyString(req),
				signatureHex: getHeaderValue(ctx.getHeaderData(), 'x-signature-ed25519'),
			});
			if (!verified) return { outcome: 'reject' };
			// type:1 PING -> caller answers with a type:1 PONG.
			return body?.type === 1 ? { outcome: 'discord-pong' } : { outcome: 'verified-provider' };
		}

		case 'woztell':
			// Woztell delivers HITL decisions exclusively through its own trigger node,
			// not through this resume webhook, so there is no provider-shaped callback here.
			return { outcome: 'not-provider-shaped' };
	}
}

/**
 * Gate for the unsigned `?requestId=&approved=` (and form-submit) query path.
 *
 * In `waitForReply` mode n8n signs the resume URL and validates that signature
 * *before* invoking this webhook, so reaching the query path already implies a
 * valid n8n signature — it is allowed. Slack and Discord have no reply-handling
 * mode and are always `waitForReply`, so they read the safe default.
 *
 * In `dispatchAndExit` mode (the WhatsApp/Woztell/Telegram default) the durable
 * companion URL carries NO n8n signature, so an unsigned query decision is an
 * unauthenticated bearer token. We reject it here; such channels must instead
 * present a verified provider signature (handled by `verifyChannelWebhook`).
 */
export function isUnsignedQueryDecisionAllowed(ctx: IWebhookFunctions): boolean {
	const replyHandlingMode = ctx.getNodeParameter('replyHandlingMode', 'waitForReply');
	return replyHandlingMode !== 'dispatchAndExit';
}
