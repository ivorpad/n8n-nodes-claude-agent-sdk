import type { IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';
import {
	constants,
	createHmac,
	timingSafeEqual,
	verify as verifySignature,
} from 'node:crypto';

import type { HitlResponderIdentity } from '../hitl/contract';
import type { ApprovalConfig } from '../permissions/approvalProperties';

type HeaderMap = Record<string, string>;

type JwtAlgorithm =
	| 'HS256'
	| 'HS384'
	| 'HS512'
	| 'RS256'
	| 'RS384'
	| 'RS512'
	| 'ES256'
	| 'ES384'
	| 'ES512'
	| 'PS256'
	| 'PS384'
	| 'PS512';

type AuthContext =
	| {
		authMode: 'basicAuth';
		username: string;
	}
	| {
		authMode: 'headerAuth';
	}
	| {
		authMode: 'jwtAuth';
		jwtPayload: Record<string, unknown>;
	};

type AuthenticationResult =
	| {
		ok: true;
		responder?: HitlResponderIdentity;
	}
	| {
		ok: false;
		response: IWebhookResponseData;
	};

type BasicAuthCredential = {
	user?: unknown;
	password?: unknown;
};

type HeaderAuthCredential = {
	name?: unknown;
	value?: unknown;
};

type JwtAuthCredential = {
	keyType?: unknown;
	publicKey?: unknown;
	secret?: unknown;
	algorithm?: unknown;
};

type JwtParts = {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
	signingInput: string;
	signature: Buffer;
};

const HMAC_HASH_BY_ALGORITHM = {
	HS256: 'sha256',
	HS384: 'sha384',
	HS512: 'sha512',
} as const satisfies Record<'HS256' | 'HS384' | 'HS512', 'sha256' | 'sha384' | 'sha512'>;

const SIGNATURE_HASH_BY_ALGORITHM = {
	RS256: 'sha256',
	RS384: 'sha384',
	RS512: 'sha512',
	PS256: 'sha256',
	PS384: 'sha384',
	PS512: 'sha512',
	ES256: 'sha256',
	ES384: 'sha384',
	ES512: 'sha512',
} as const satisfies Record<
	'RS256' | 'RS384' | 'RS512' | 'PS256' | 'PS384' | 'PS512' | 'ES256' | 'ES384' | 'ES512',
	'sha256' | 'sha384' | 'sha512'
>;

const JWT_EC_PART_LENGTH = {
	ES256: 32,
	ES384: 48,
	ES512: 66,
} as const satisfies Record<'ES256' | 'ES384' | 'ES512', number>;

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeHeaders(value: unknown): HeaderMap {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	const normalized: HeaderMap = {};
	for (const [rawKey, rawValue] of Object.entries(value)) {
		const key = rawKey.toLowerCase();
		if (typeof rawValue === 'string') {
			normalized[key] = rawValue;
			continue;
		}
		if (Array.isArray(rawValue) && typeof rawValue[0] === 'string') {
			normalized[key] = rawValue[0];
			continue;
		}
		if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
			normalized[key] = String(rawValue);
		}
	}
	return normalized;
}

function getRequestHeaders(ctx: IWebhookFunctions): HeaderMap {
	const requestHeaders = normalizeHeaders(ctx.getRequestObject().headers);

	try {
		return {
			...requestHeaders,
			...normalizeHeaders(ctx.getHeaderData()),
		};
	} catch {
		return requestHeaders;
	}
}

function getHeader(headers: HeaderMap, name: string): string | undefined {
	return headers[name.toLowerCase()];
}

function secureCompare(expected: string, provided: string): boolean {
	const expectedBuffer = Buffer.from(expected);
	const providedBuffer = Buffer.from(provided);
	return expectedBuffer.length === providedBuffer.length
		&& timingSafeEqual(expectedBuffer, providedBuffer);
}

function isWebhookResponseData(value: unknown): value is IWebhookResponseData {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	const record = value as Record<string, unknown>;
	return 'noWebhookResponse' in record
		|| 'webhookResponse' in record
		|| 'workflowData' in record;
}

function sendPlainTextResponse(args: {
	ctx: IWebhookFunctions;
	statusCode: number;
	message: string;
	headers?: Record<string, string>;
}): IWebhookResponseData {
	const res = args.ctx.getResponseObject();
	res.statusCode = args.statusCode;
	for (const [headerName, value] of Object.entries(args.headers ?? {})) {
		res.setHeader(headerName, value);
	}
	res.setHeader('Content-Type', 'text/plain; charset=utf-8');
	res.send(args.message);
	return { noWebhookResponse: true };
}

function parseBasicAuthorizationHeader(value: string | undefined): {
	username: string;
	password: string;
} | undefined {
	if (!value) {
		return undefined;
	}

	const [scheme, encoded] = value.split(' ', 2);
	if (scheme?.toLowerCase() !== 'basic' || !encoded) {
		return undefined;
	}

	try {
		const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
		const separatorIndex = decoded.indexOf(':');
		if (separatorIndex < 0) {
			return undefined;
		}

		return {
			username: decoded.slice(0, separatorIndex),
			password: decoded.slice(separatorIndex + 1),
		};
	} catch {
		return undefined;
	}
}

function generateBasicAuthToken(ctx: IWebhookFunctions, user: string, password: string): string | undefined {
	const node = ctx.getNode() as { id?: string; webhookId?: string };
	const nodeId = asNonEmptyString(node.id);
	const webhookId = asNonEmptyString(node.webhookId);
	if (!nodeId || !webhookId) {
		return undefined;
	}

	return createHmac('sha256', `${user}:${password}`)
		.update(`${nodeId}-${webhookId}`)
		.digest('hex');
}

function formatPemKey(value: string, keyIsPublic = false): string {
	let markerRegex = /(PRIVATE KEY|CERTIFICATE)/;
	if (keyIsPublic) {
		markerRegex = /(PUBLIC KEY)/;
	}

	if (!value || /\n/.test(value)) {
		return value;
	}

	let formatted = '';
	const parts = value.split('-----').filter((item) => item !== '');
	for (let part of parts) {
		if (markerRegex.test(part)) {
			formatted += `-----${part}-----`;
			continue;
		}

		const passphraseRegex = /Proc-Type|DEK-Info/;
		if (passphraseRegex.test(part)) {
			part = part.replace(/:\s+/g, ':');
		}
		formatted += part.replace(/\\n/g, '\n').replace(/\s+/g, '\n');
	}
	return formatted;
}

function decodeBase64Url(value: string): Buffer {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = (4 - (normalized.length % 4)) % 4;
	return Buffer.from(normalized + '='.repeat(padding), 'base64');
}

function parseJwt(token: string): JwtParts {
	const parts = token.split('.');
	if (parts.length !== 3) {
		throw new Error('Malformed JWT');
	}

	const [headerSegment, payloadSegment, signatureSegment] = parts;
	const headerValue = JSON.parse(decodeBase64Url(headerSegment).toString('utf-8')) as unknown;
	const payloadValue = JSON.parse(decodeBase64Url(payloadSegment).toString('utf-8')) as unknown;

	if (!headerValue || typeof headerValue !== 'object' || Array.isArray(headerValue)) {
		throw new Error('JWT header must be an object');
	}
	if (!payloadValue || typeof payloadValue !== 'object' || Array.isArray(payloadValue)) {
		throw new Error('JWT payload must be an object');
	}

	return {
		header: headerValue as Record<string, unknown>,
		payload: payloadValue as Record<string, unknown>,
		signingInput: `${headerSegment}.${payloadSegment}`,
		signature: decodeBase64Url(signatureSegment),
	};
}

function encodeDerLength(length: number): Buffer {
	if (length < 128) {
		return Buffer.from([length]);
	}

	const bytes: number[] = [];
	let remaining = length;
	while (remaining > 0) {
		bytes.unshift(remaining & 0xff);
		remaining >>= 8;
	}
	return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeDerInteger(value: Buffer): Buffer {
	let normalized = value;
	while (normalized.length > 1 && normalized[0] === 0x00) {
		normalized = normalized.subarray(1);
	}

	if ((normalized[0] ?? 0) & 0x80) {
		normalized = Buffer.concat([Buffer.from([0x00]), normalized]);
	}

	return Buffer.concat([
		Buffer.from([0x02]),
		encodeDerLength(normalized.length),
		normalized,
	]);
}

function joseSignatureToDer(signature: Buffer, partLength: number): Buffer {
	if (signature.length !== partLength * 2) {
		throw new Error('Invalid ECDSA JWT signature length');
	}

	const r = encodeDerInteger(signature.subarray(0, partLength));
	const s = encodeDerInteger(signature.subarray(partLength));
	const sequence = Buffer.concat([r, s]);
	return Buffer.concat([Buffer.from([0x30]), encodeDerLength(sequence.length), sequence]);
}

function verifyJwtClaims(payload: Record<string, unknown>): void {
	const now = Math.floor(Date.now() / 1000);

	const exp = payload.exp;
	if (typeof exp === 'number' && Number.isFinite(exp) && now >= exp) {
		throw new Error('JWT expired');
	}

	const nbf = payload.nbf;
	if (typeof nbf === 'number' && Number.isFinite(nbf) && now < nbf) {
		throw new Error('JWT not active yet');
	}
}

function verifyJwtSignatureForAlgorithm(args: {
	algorithm: JwtAlgorithm;
	signingInput: string;
	signature: Buffer;
	credential: JwtAuthCredential;
}): boolean {
	const { algorithm, signingInput, signature, credential } = args;

	// Reject the unsecured `alg: none` JWT — it carries no signature and would
	// allow trivial token forgery / algorithm-confusion attacks.
	if ((algorithm as string) === 'none') {
		return false;
	}

	if (algorithm in HMAC_HASH_BY_ALGORITHM) {
		const secret = asNonEmptyString(credential.secret);
		if (!secret) {
			throw new Error('JWT secret is required');
		}

		const digest = createHmac(
			HMAC_HASH_BY_ALGORITHM[algorithm as keyof typeof HMAC_HASH_BY_ALGORITHM],
			secret,
		)
			.update(signingInput)
			.digest();

		return digest.length === signature.length && timingSafeEqual(digest, signature);
	}

	const publicKey = asNonEmptyString(credential.publicKey);
	if (!publicKey) {
		throw new Error('JWT public key is required');
	}

	const key = formatPemKey(publicKey, true);
	if (algorithm in JWT_EC_PART_LENGTH) {
		const derSignature = joseSignatureToDer(
			signature,
			JWT_EC_PART_LENGTH[algorithm as keyof typeof JWT_EC_PART_LENGTH],
		);
		return verifySignature(
			SIGNATURE_HASH_BY_ALGORITHM[algorithm as keyof typeof SIGNATURE_HASH_BY_ALGORITHM],
			Buffer.from(signingInput),
			key,
			derSignature,
		);
	}

	if (algorithm.startsWith('PS')) {
		return verifySignature(
			SIGNATURE_HASH_BY_ALGORITHM[algorithm as keyof typeof SIGNATURE_HASH_BY_ALGORITHM],
			Buffer.from(signingInput),
			{
				key,
				padding: constants.RSA_PKCS1_PSS_PADDING,
				saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
			},
			signature,
		);
	}

	return verifySignature(
		SIGNATURE_HASH_BY_ALGORITHM[algorithm as keyof typeof SIGNATURE_HASH_BY_ALGORITHM],
		Buffer.from(signingInput),
		key,
		signature,
	);
}

function verifyJwtToken(token: string, credential: JwtAuthCredential): Record<string, unknown> {
	const parts = parseJwt(token);
	const expectedAlgorithm = asNonEmptyString(credential.algorithm) as JwtAlgorithm | undefined;
	const headerAlgorithm = asNonEmptyString(parts.header.alg) as JwtAlgorithm | undefined;

	if (!expectedAlgorithm) {
		throw new Error('JWT algorithm is required');
	}
	if (!headerAlgorithm) {
		throw new Error('JWT header alg is required');
	}
	if (headerAlgorithm !== expectedAlgorithm) {
		throw new Error(`JWT alg mismatch: expected ${expectedAlgorithm}, got ${headerAlgorithm}`);
	}

	const isValidSignature = verifyJwtSignatureForAlgorithm({
		algorithm: expectedAlgorithm,
		signingInput: parts.signingInput,
		signature: parts.signature,
		credential,
	});
	if (!isValidSignature) {
		throw new Error('Invalid JWT signature');
	}

	verifyJwtClaims(parts.payload);
	return parts.payload;
}

function resolvePathValue(input: Record<string, unknown>, path: string): unknown {
	const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
	let current: unknown = input;

	for (const segment of segments) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

function coerceIdentityValue(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return undefined;
}

async function authenticateBasicAuth(
	ctx: IWebhookFunctions,
	headers: HeaderMap,
): Promise<AuthContext | IWebhookResponseData> {
	let credential: BasicAuthCredential | undefined;
	try {
		credential = await ctx.getCredentials<BasicAuthCredential>('httpBasicAuth');
	} catch {
		credential = undefined;
	}

	const expectedUser = asNonEmptyString(credential?.user);
	const expectedPassword = asNonEmptyString(credential?.password);
	if (!expectedUser || !expectedPassword) {
		return sendPlainTextResponse({
			ctx,
			statusCode: 500,
			message: 'Internal error',
		});
	}

	const providedBasicAuth = parseBasicAuthorizationHeader(getHeader(headers, 'authorization'));
	if (!providedBasicAuth) {
		const authToken = asNonEmptyString(getHeader(headers, 'x-auth-token'));
		if (!authToken) {
			return sendPlainTextResponse({
				ctx,
				statusCode: 401,
				message: 'Unauthorized',
				headers: {
					'WWW-Authenticate': 'Basic realm="Claude Agent SDK HITL"',
				},
			});
		}

		const expectedAuthToken = generateBasicAuthToken(ctx, expectedUser, expectedPassword);
		if (!expectedAuthToken || !secureCompare(expectedAuthToken, authToken)) {
			return sendPlainTextResponse({
				ctx,
				statusCode: 403,
				message: 'Forbidden',
			});
		}

		return {
			authMode: 'basicAuth',
			username: expectedUser,
		};
	}

	// Constant-time compare for BOTH fields, AND-ed without short-circuiting,
	// so response timing never reveals which field (or which character) was
	// wrong. Avoid `||` / early return for the same reason.
	const usernameMatches = secureCompare(expectedUser, providedBasicAuth.username);
	const passwordMatches = secureCompare(expectedPassword, providedBasicAuth.password);
	if (!(usernameMatches && passwordMatches)) {
		return sendPlainTextResponse({
			ctx,
			statusCode: 403,
			message: 'Forbidden',
		});
	}

	return {
		authMode: 'basicAuth',
		username: providedBasicAuth.username,
	};
}

async function authenticateHeaderAuth(
	ctx: IWebhookFunctions,
	headers: HeaderMap,
): Promise<AuthContext | IWebhookResponseData> {
	let credential: HeaderAuthCredential | undefined;
	try {
		credential = await ctx.getCredentials<HeaderAuthCredential>('httpHeaderAuth');
	} catch {
		credential = undefined;
	}

	const headerName = asNonEmptyString(credential?.name)?.toLowerCase();
	const expectedValue = asNonEmptyString(credential?.value);
	if (!headerName || !expectedValue) {
		return sendPlainTextResponse({
			ctx,
			statusCode: 500,
			message: 'Internal error',
		});
	}

	const providedValue = asNonEmptyString(getHeader(headers, headerName));
	if (!providedValue || !secureCompare(expectedValue, providedValue)) {
		return sendPlainTextResponse({
			ctx,
			statusCode: 403,
			message: 'Forbidden',
		});
	}

	return { authMode: 'headerAuth' };
}

async function authenticateJwtAuth(
	ctx: IWebhookFunctions,
	headers: HeaderMap,
): Promise<AuthContext | IWebhookResponseData> {
	let credential: JwtAuthCredential | undefined;
	try {
		credential = await ctx.getCredentials<JwtAuthCredential>('jwtAuth');
	} catch {
		credential = undefined;
	}

	if (!credential) {
		return sendPlainTextResponse({
			ctx,
			statusCode: 500,
			message: 'Internal error',
		});
	}

	const authorizationHeader = asNonEmptyString(getHeader(headers, 'authorization'));
	const token = authorizationHeader?.startsWith('Bearer ')
		? authorizationHeader.slice('Bearer '.length).trim()
		: undefined;
	if (!token) {
		return sendPlainTextResponse({
			ctx,
			statusCode: 401,
			message: 'Unauthorized',
		});
	}

	try {
		return {
			authMode: 'jwtAuth',
			jwtPayload: verifyJwtToken(token, credential),
		};
	} catch {
		// Do not disclose the verification reason (expired, bad signature,
		// alg mismatch, malformed token) to the client.
		return sendPlainTextResponse({
			ctx,
			statusCode: 403,
			message: 'Forbidden',
		});
	}
}

function resolveResponderIdentity(args: {
	ctx: IWebhookFunctions;
	headers: HeaderMap;
	authContext: AuthContext;
	approvalConfig: ApprovalConfig;
}): HitlResponderIdentity | IWebhookResponseData | undefined {
	const { ctx, headers, authContext, approvalConfig } = args;
	const identityMode = approvalConfig.hitlWebhookResponderIdentity;

	if (identityMode === 'none') {
		return undefined;
	}

	if (identityMode === 'basicUsername') {
		if (authContext.authMode !== 'basicAuth') {
			return sendPlainTextResponse({
				ctx,
				statusCode: 500,
				message: 'Internal error',
			});
		}

		return {
			id: authContext.username,
			source: 'basicAuth.username',
			authMode: 'basicAuth',
		};
	}

	if (identityMode === 'headerValue') {
		const headerName = asNonEmptyString(approvalConfig.hitlWebhookIdentityHeaderName) ?? 'x-auth-request-email';
		const identityValue = coerceIdentityValue(getHeader(headers, headerName));
		if (!identityValue) {
			return sendPlainTextResponse({
				ctx,
				statusCode: 403,
				message: 'Forbidden',
			});
		}

		return {
			id: identityValue,
			source: `header:${headerName.toLowerCase()}`,
			authMode: authContext.authMode,
		};
	}

	if (authContext.authMode !== 'jwtAuth') {
		return sendPlainTextResponse({
			ctx,
			statusCode: 500,
			message: 'Internal error',
		});
	}

	const claimPath = asNonEmptyString(approvalConfig.hitlWebhookIdentityJwtClaim) ?? 'sub';
	const identityValue = coerceIdentityValue(resolvePathValue(authContext.jwtPayload, claimPath));
	if (!identityValue) {
		return sendPlainTextResponse({
			ctx,
			statusCode: 403,
			message: 'Forbidden',
		});
	}

	return {
		id: identityValue,
		source: `jwt:${claimPath}`,
		authMode: 'jwtAuth',
	};
}

// V8a (insecure default + missing warning): when HITL webhooks are enabled
// with `authentication: 'none'`, the endpoint is gated ONLY by the n8n resume
// token in the URL. That is an intentional, non-breaking fallback (see the
// `none` branch below), but it must be surfaced loudly so an operator knows a
// second factor is recommended. We log on the request that takes the fallback;
// the warning never changes the auth outcome.
function warnNoneAuthFallback(ctx: IWebhookFunctions): void {
	// `logger` is always present on a real n8n context; guard defensively so
	// lightweight test/synthetic contexts without one still authenticate.
	const warn = ctx.logger?.warn;
	if (typeof warn !== 'function') {
		return;
	}
	warn(
		'[Claude Agent SDK] HITL webhook authentication is set to "none": the '
		+ 'approval/question endpoint is protected ONLY by the n8n resume token in '
		+ 'the URL. Anyone who obtains that URL (forwarded email, chat unfurl, logs) '
		+ 'can answer the request. Enabling Webhook Authentication (Basic/Header/JWT) '
		+ 'as a second factor is strongly recommended. See SECURITY.md (HITL Webhook '
		+ 'Authentication).',
	);
}

export async function authenticateHitlWebhookRequest(args: {
	ctx: IWebhookFunctions;
	approvalConfig: ApprovalConfig;
}): Promise<AuthenticationResult> {
	const { ctx, approvalConfig } = args;

	if (approvalConfig.hitlWebhookAuthentication === 'none') {
		if (approvalConfig.hitlWebhookResponderIdentity !== 'none') {
			return {
				ok: false,
				response: sendPlainTextResponse({
					ctx,
					statusCode: 500,
					message: 'Error: Responder Identity requires Webhook Authentication to be enabled.',
				}),
			};
		}

		// Intentional, logged default-allow fallback (V8a): with no extra auth
		// layer the request is gated solely by the n8n resume token. This is the
		// out-of-the-box behaviour and is kept non-breaking on purpose; the
		// warning makes the weaker posture visible to operators.
		warnNoneAuthFallback(ctx);
		return { ok: true };
	}

	const headers = getRequestHeaders(ctx);
	let authContext: AuthContext | IWebhookResponseData;

	switch (approvalConfig.hitlWebhookAuthentication) {
		case 'basicAuth':
			authContext = await authenticateBasicAuth(ctx, headers);
			break;
		case 'headerAuth':
			authContext = await authenticateHeaderAuth(ctx, headers);
			break;
		case 'jwtAuth':
			authContext = await authenticateJwtAuth(ctx, headers);
			break;
		default:
			authContext = sendPlainTextResponse({
				ctx,
				statusCode: 500,
				message: `Error: Unsupported HITL webhook authentication mode "${approvalConfig.hitlWebhookAuthentication}".`,
			});
			break;
	}

	if (isWebhookResponseData(authContext)) {
		return { ok: false, response: authContext };
	}

	const responder = resolveResponderIdentity({
		ctx,
		headers,
		authContext,
		approvalConfig,
	});
	if (isWebhookResponseData(responder)) {
		return { ok: false, response: responder };
	}

	return {
		ok: true,
		responder,
	};
}
