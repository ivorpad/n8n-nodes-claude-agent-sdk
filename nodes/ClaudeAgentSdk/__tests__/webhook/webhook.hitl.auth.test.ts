/**
 * Webhook handler HITL auth regression tests
 *
 * Optional webhook authentication and responder-identity resolution:
 * - header auth (missing secret, valid secret + identity header, missing identity header)
 * - basic auth (valid username identity, missing credentials prompt)
 * - jwt auth (valid claim identity)
 *
 * Split out of webhook.hitl.test.ts to keep each suite under the file-size
 * guard; behaviour is unchanged.
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
	staticData?: Record<string, unknown>;
	credentials?: Record<string, unknown>;
}) {
	const res = {
		setHeader: vi.fn(),
		send: vi.fn(),
		writableEnded: false,
		statusCode: 200,
	};

	const staticData = overrides.staticData ?? {};
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
		getWorkflowStaticData: vi.fn(() => staticData),
		getNodeParameter: vi.fn((name: string, arg2?: unknown, arg3?: unknown) => {
			const defaultValue = arg3 !== undefined ? arg3 : arg2;
			if (overrides.nodeParams?.[name] !== undefined) return overrides.nodeParams[name];
			if (name === 'interactiveApprovals') return 'pauseForApproval';
			if (name === 'securityOptions') return {};
			return defaultValue;
		}),
		res,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

function createHs256Jwt(payload: Record<string, unknown>, secret: string): string {
	const header = { alg: 'HS256', typ: 'JWT' };
	const encode = (value: Record<string, unknown>) =>
		Buffer.from(JSON.stringify(value)).toString('base64url');
	const signingInput = `${encode(header)}.${encode(payload)}`;
	const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
	return `${signingInput}.${signature}`;
}

describe('webhook() — HITL auth regression', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects header-authenticated HITL requests without the expected auth header', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_header_auth_missing', approved: 'true' },
			nodeParams: {
				hitlWebhookAuthentication: 'headerAuth',
			},
			credentials: {
				httpHeaderAuth: {
					name: 'x-hitl-secret',
					value: 'shared-secret',
				},
			},
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.statusCode).toBe(403);
		expect(wf.res.send).toHaveBeenCalledWith('Forbidden');
	});

	it('accepts header auth and attaches responder identity from a trusted header', async () => {
		// V6: the responder identity is attached to the consumed approval payload,
		// which is produced on POST (GET now renders a confirmation page).
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_header_auth_ok', approved: 'true' },
			headers: {
				'x-hitl-secret': 'shared-secret',
				'x-auth-request-email': 'approver@example.com',
			},
			nodeParams: {
				hitlWebhookAuthentication: 'headerAuth',
				hitlWebhookResponderIdentity: 'headerValue',
				hitlWebhookIdentityHeaderName: 'x-auth-request-email',
			},
			credentials: {
				httpHeaderAuth: {
					name: 'x-hitl-secret',
					value: 'shared-secret',
				},
			},
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.responder).toEqual({
			id: 'approver@example.com',
			source: 'header:x-auth-request-email',
			authMode: 'headerAuth',
		});
	});

	it('rejects when header-authenticated requests require a responder header and it is missing', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_header_identity_missing', approved: 'true' },
			headers: {
				'x-hitl-secret': 'shared-secret',
			},
			nodeParams: {
				hitlWebhookAuthentication: 'headerAuth',
				hitlWebhookResponderIdentity: 'headerValue',
				hitlWebhookIdentityHeaderName: 'x-auth-request-email',
			},
			credentials: {
				httpHeaderAuth: {
					name: 'x-hitl-secret',
					value: 'shared-secret',
				},
			},
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.statusCode).toBe(403);
		// The auth-hardening change in webhook/auth.ts now returns a generic
		// 403 "Forbidden" for a missing responder identity (no longer disclosing
		// the specific header name), matching webhook.authHardening.test.ts.
		expect(wf.res.send).toHaveBeenCalledWith('Forbidden');
	});

	it('accepts basic auth and attaches the authenticated username as responder identity', async () => {
		// V6: consumed on POST (GET now renders a confirmation page).
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_basic_auth_ok', approved: 'true' },
			headers: {
				authorization: `Basic ${Buffer.from('alice:swordfish').toString('base64')}`,
			},
			nodeParams: {
				hitlWebhookAuthentication: 'basicAuth',
				hitlWebhookResponderIdentity: 'basicUsername',
			},
			credentials: {
				httpBasicAuth: {
					user: 'alice',
					password: 'swordfish',
				},
			},
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.responder).toEqual({
			id: 'alice',
			source: 'basicAuth.username',
			authMode: 'basicAuth',
		});
	});

	it('prompts for basic auth when credentials are missing from the request', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_basic_auth_missing', approved: 'true' },
			nodeParams: {
				hitlWebhookAuthentication: 'basicAuth',
			},
			credentials: {
				httpBasicAuth: {
					user: 'alice',
					password: 'swordfish',
				},
			},
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.statusCode).toBe(401);
		expect(wf.res.setHeader).toHaveBeenCalledWith(
			'WWW-Authenticate',
			'Basic realm="Claude Agent SDK HITL"',
		);
		expect(wf.res.send).toHaveBeenCalledWith('Unauthorized');
	});

	it('accepts jwt auth and attaches responder identity from the configured claim', async () => {
		const node = new ClaudeAgentSdk();
		const token = createHs256Jwt(
			{
				sub: 'user_123',
				email: 'jwt-user@example.com',
				exp: Math.floor(Date.now() / 1000) + 60,
			},
			'top-secret',
		);
		const wf = makeWebhookContext({
			// V6: consumed on POST (GET now renders a confirmation page).
			method: 'POST',
			query: { requestId: 'req_jwt_auth_ok', approved: 'true' },
			headers: {
				authorization: `Bearer ${token}`,
			},
			nodeParams: {
				hitlWebhookAuthentication: 'jwtAuth',
				hitlWebhookResponderIdentity: 'jwtClaim',
				hitlWebhookIdentityJwtClaim: 'email',
			},
			credentials: {
				jwtAuth: {
					keyType: 'passphrase',
					secret: 'top-secret',
					algorithm: 'HS256',
				},
			},
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.responder).toEqual({
			id: 'jwt-user@example.com',
			source: 'jwt:email',
			authMode: 'jwtAuth',
		});
	});
});
