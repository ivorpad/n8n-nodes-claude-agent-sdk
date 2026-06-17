import { createHmac, createPublicKey, timingSafeEqual, verify as verifyAsymmetric } from 'node:crypto';

import type { IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

/**
 * DER SPKI header for an Ed25519 public key. Discord publishes the application
 * public key as a bare 32-byte value (hex); prefixing this header turns it into
 * a SPKI DER blob that `crypto.createPublicKey` accepts.
 */
const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_RAW_PUBLIC_KEY_BYTES = 32;

interface RawBodyRequest {
	rawBody?: unknown;
	body?: unknown;
}

function asHeaderString(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) return value[0];
	return value;
}

function safeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeSecret(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function isHexString(value: string): boolean {
	return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

function ed25519PublicKeyFromHex(publicKeyHex: string) {
	const raw = Buffer.from(publicKeyHex, 'hex');
	if (raw.length !== ED25519_RAW_PUBLIC_KEY_BYTES) return undefined;
	try {
		return createPublicKey({
			key: Buffer.concat([ED25519_SPKI_DER_PREFIX, raw]),
			format: 'der',
			type: 'spki',
		});
	} catch {
		return undefined;
	}
}

/**
 * Verify a Discord interaction request signed with Ed25519.
 *
 * Discord signs `timestamp + rawBody` with the application's private key and
 * sends `X-Signature-Ed25519` (hex) + `X-Signature-Timestamp`. We rebuild the
 * public key from the configured hex and verify the signature. The verify
 * primitive is constant-time, so no manual comparison is needed.
 *
 * NOTE: for Ed25519 the digest algorithm argument MUST be `null`
 * (`crypto.verify('ed25519', ...)` throws "Invalid digest: ed25519").
 */
export function verifyDiscordEd25519(args: {
	publicKeyHex: unknown;
	timestamp: string | undefined;
	rawBody: string | undefined;
	signatureHex: string | undefined;
}): boolean {
	const publicKeyHex = normalizeSecret(args.publicKeyHex);
	if (!publicKeyHex || !args.timestamp || args.rawBody === undefined || !args.signatureHex) {
		return false;
	}
	if (!isHexString(publicKeyHex) || !isHexString(args.signatureHex)) {
		return false;
	}

	const publicKey = ed25519PublicKeyFromHex(publicKeyHex);
	if (!publicKey) return false;

	const message = Buffer.from(args.timestamp + args.rawBody, 'utf8');
	const signature = Buffer.from(args.signatureHex, 'hex');
	try {
		return verifyAsymmetric(null, message, publicKey, signature);
	} catch {
		return false;
	}
}

export function getHeaderValue(
	headers: Record<string, string | string[] | undefined>,
	headerName: string,
): string | undefined {
	const lowerHeaderName = headerName.toLowerCase();
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === lowerHeaderName) {
			return asHeaderString(value);
		}
	}
	return undefined;
}

export function getRawBodyString(request: RawBodyRequest): string | undefined {
	if (typeof request.rawBody === 'string') return request.rawBody;
	if (Buffer.isBuffer(request.rawBody)) return request.rawBody.toString('utf8');
	if (typeof request.body === 'string') return request.body;
	if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');
	return undefined;
}

export function verifySha256Signature(args: {
	secret: unknown;
	rawBody: string | undefined;
	signatureHeader: string | undefined;
	prefix: string;
}): boolean {
	const secret = normalizeSecret(args.secret);
	if (!secret || !args.rawBody || !args.signatureHeader?.startsWith(args.prefix)) {
		return false;
	}

	const expectedSignature = `${args.prefix}${createHmac('sha256', secret)
		.update(args.rawBody)
		.digest('hex')}`;
	return safeEqual(expectedSignature, args.signatureHeader);
}

export function verifySlackRequest(args: {
	signingSecret: unknown;
	rawBody: string | undefined;
	signatureHeader: string | undefined;
	timestampHeader: string | undefined;
	nowMs?: number;
}): boolean {
	const signingSecret = normalizeSecret(args.signingSecret);
	if (!signingSecret || !args.rawBody || !args.signatureHeader || !args.timestampHeader) {
		return false;
	}

	const timestampSeconds = Number(args.timestampHeader);
	if (!Number.isFinite(timestampSeconds)) return false;

	const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);
	if (Math.abs(nowSeconds - timestampSeconds) > 60 * 5) {
		return false;
	}

	const baseString = `v0:${args.timestampHeader}:${args.rawBody}`;
	const expectedSignature = `v0=${createHmac('sha256', signingSecret)
		.update(baseString)
		.digest('hex')}`;
	return safeEqual(expectedSignature, args.signatureHeader);
}

export function verifyStaticSecret(args: {
	expectedSecret: unknown;
	providedSecret: string | undefined;
}): boolean {
	const expectedSecret = normalizeSecret(args.expectedSecret);
	return Boolean(
		expectedSecret
		&& args.providedSecret
		&& safeEqual(expectedSecret, args.providedSecret),
	);
}

export function forbiddenProviderWebhookResponse(ctx: IWebhookFunctions): IWebhookResponseData {
	const res = ctx.getResponseObject();
	res.statusCode = 403;
	res.setHeader('Content-Type', 'text/plain; charset=utf-8');
	return { webhookResponse: 'Forbidden' };
}
