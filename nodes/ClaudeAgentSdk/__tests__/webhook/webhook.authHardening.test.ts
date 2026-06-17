/**
 * Webhook auth hardening regression tests (security findings V7, V12).
 *
 * V7  — Basic Auth must use a constant-time compare for BOTH username and
 *       password, combined without short-circuiting, so timing never reveals
 *       which field/char mismatched. Behaviourally: a wrong username OR a wrong
 *       password yields the same 403 "Forbidden" response.
 * V12 — JWT `alg: none` must be rejected (no algorithm confusion / signature
 *       bypass), and client-facing auth failures must NOT leak internal detail
 *       (verification reasons, header/claim names, or config state).
 */

import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeAgentSdk } from '../../ClaudeAgentSdk.node';

vi.mock('../../streaming/ResponseStore', () => ({
	storeRequestResponse: vi.fn(),
}));

function makeWebhookContext(overrides: {
	method: string;
	query: Record<string, string>;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
	nodeParams?: Record<string, unknown>;
	credentials?: Record<string, unknown>;
}) {
	const res = {
		setHeader: vi.fn(),
		send: vi.fn(),
		writableEnded: false,
		statusCode: 200,
	};

	const headers = overrides.headers ?? {};
	const credentials = overrides.credentials ?? {};

	return {
		getWorkflow: () => ({ id: 'wf_test' }),
		getNode: () => ({
			id: 'node_test',
			webhookId: 'webhook_test',
			name: 'Claude Agent SDK',
			credentials,
		}),
		getRequestObject: () => ({
			method: overrides.method,
			query: overrides.query,
			headers,
		}),
		getHeaderData: () => headers,
		getResponseObject: () => res,
		getBodyData: () => overrides.body ?? {},
		getCredentials: vi.fn(async (name: string) => {
			if (credentials[name] === undefined) {
				throw new Error(`Missing credential: ${name}`);
			}
			return credentials[name];
		}),
		getWorkflowStaticData: vi.fn(() => ({})),
		getNodeParameter: vi.fn((name: string, arg2?: unknown, arg3?: unknown) => {
			const defaultValue = arg3 !== undefined ? arg3 : arg2;
			if (overrides.nodeParams?.[name] !== undefined) return overrides.nodeParams[name];
			if (name === 'interactiveApprovals') return 'pauseForApproval';
			if (name === 'securityOptions') return {};
			return defaultValue;
		}),
		res,
	} as never;
}

function basicAuthHeader(user: string, password: string): string {
	return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function encodeSegment(value: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createHs256Jwt(payload: Record<string, unknown>, secret: string): string {
	const header = { alg: 'HS256', typ: 'JWT' };
	const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
	const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
	return `${signingInput}.${signature}`;
}

/** Forged `alg: none` token with an empty signature segment. */
function createNoneAlgJwt(payload: Record<string, unknown>): string {
	const header = { alg: 'none', typ: 'JWT' };
	return `${encodeSegment(header)}.${encodeSegment(payload)}.`;
}

describe('webhook() — auth hardening (V7 basic auth)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects a wrong password with a generic 403 Forbidden', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_bad_pw', approved: 'true' },
			headers: { authorization: basicAuthHeader('alice', 'wrong-password') },
			nodeParams: { hitlWebhookAuthentication: 'basicAuth' },
			credentials: { httpBasicAuth: { user: 'alice', password: 'swordfish' } },
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.statusCode).toBe(403);
		expect(wf.res.send).toHaveBeenCalledWith('Forbidden');
	});

	it('rejects a wrong username with the same generic 403 Forbidden', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_bad_user', approved: 'true' },
			headers: { authorization: basicAuthHeader('mallory', 'swordfish') },
			nodeParams: { hitlWebhookAuthentication: 'basicAuth' },
			credentials: { httpBasicAuth: { user: 'alice', password: 'swordfish' } },
		});

		const result = await node.webhook.call(wf);

		expect(wf.res.statusCode).toBe(403);
		expect(wf.res.send).toHaveBeenCalledWith('Forbidden');
	});

	it('accepts correct basic auth credentials', async () => {
		// V6: the consume path is POST (a GET now renders a confirmation page),
		// so an authenticated approval is routed to workflow output on POST.
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_good', approved: 'true' },
			headers: { authorization: basicAuthHeader('alice', 'swordfish') },
			nodeParams: { hitlWebhookAuthentication: 'basicAuth' },
			credentials: { httpBasicAuth: { user: 'alice', password: 'swordfish' } },
		});

		const result = await node.webhook.call(wf);

		// Authenticated requests are routed to workflow output, not a 403.
		expect(result.workflowData).toBeDefined();
		expect(wf.res.statusCode).not.toBe(403);
	});
});

describe('webhook() — auth hardening (V12 JWT)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects a JWT using alg "none" even when the credential expects none', async () => {
		const node = new ClaudeAgentSdk();
		const token = createNoneAlgJwt({
			sub: 'attacker',
			exp: Math.floor(Date.now() / 1000) + 60,
		});
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_none_alg', approved: 'true' },
			headers: { authorization: `Bearer ${token}` },
			nodeParams: { hitlWebhookAuthentication: 'jwtAuth' },
			// Even if an operator misconfigured `algorithm: none`, it must be rejected.
			credentials: { jwtAuth: { keyType: 'passphrase', algorithm: 'none' } },
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.statusCode).toBe(403);
		expect(result.workflowData).toBeUndefined();
	});

	it('does not leak internal verification detail in the 403 response body', async () => {
		const node = new ClaudeAgentSdk();
		// Valid HS256 token but signed with the wrong secret -> signature failure.
		const token = createHs256Jwt(
			{ sub: 'user_1', exp: Math.floor(Date.now() / 1000) + 60 },
			'attacker-secret',
		);
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_bad_sig', approved: 'true' },
			headers: { authorization: `Bearer ${token}` },
			nodeParams: { hitlWebhookAuthentication: 'jwtAuth' },
			credentials: { jwtAuth: { keyType: 'passphrase', secret: 'real-secret', algorithm: 'HS256' } },
		});

		const result = await node.webhook.call(wf);
		const sentBody = wf.res.send.mock.calls[0][0] as string;

		expect(wf.res.statusCode).toBe(403);
		expect(sentBody).toBe('Forbidden');
		// Must not echo internal reasons such as "Invalid JWT signature" or "alg mismatch".
		expect(sentBody).not.toMatch(/signature/i);
		expect(sentBody).not.toMatch(/alg/i);
		expect(sentBody).not.toMatch(/JWT/);
	});

	it('returns a generic 500 without disclosing config state when JWT credential is missing', async () => {
		const node = new ClaudeAgentSdk();
		const token = createHs256Jwt(
			{ sub: 'user_1', exp: Math.floor(Date.now() / 1000) + 60 },
			'real-secret',
		);
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_no_cred', approved: 'true' },
			headers: { authorization: `Bearer ${token}` },
			nodeParams: { hitlWebhookAuthentication: 'jwtAuth' },
			// No jwtAuth credential configured -> getCredentials throws.
			credentials: {},
		});

		const result = await node.webhook.call(wf);
		const sentBody = wf.res.send.mock.calls[0][0] as string;

		expect(wf.res.statusCode).toBe(500);
		expect(sentBody).toBe('Internal error');
		expect(sentBody).not.toMatch(/credential/i);
		expect(sentBody).not.toMatch(/configured/i);
	});
});
