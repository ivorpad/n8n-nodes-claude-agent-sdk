/**
 * Security regression (V8a): insecure default + missing warning.
 *
 * Out of the box `hitlWebhookAuthentication` defaults to `'none'`, and the auth
 * layer then returns `{ ok: true }` (default-allow). The only protection in
 * that configuration is the n8n resume token in the URL. That is an
 * intentional, non-breaking fallback — but it MUST be surfaced loudly so an
 * operator knows the endpoint relies solely on the resume token and a second
 * factor is recommended.
 *
 * These tests assert the auth layer logs a clear warning on the `none`
 * default-allow path, while still returning `{ ok: true }` so existing setups
 * keep working.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ApprovalConfig } from '../../permissions/approvalProperties';
import { authenticateHitlWebhookRequest } from '../../webhook/auth';

function makeApprovalConfig(overrides: Partial<ApprovalConfig> = {}): ApprovalConfig {
	return {
		enabled: true,
		mode: 'pauseForApproval',
		scope: 'notAllowed',
		specificTools: [],
		approvalMatchMode: 'tool',
		timeoutSeconds: 3600,
		handleAskUserQuestion: true,
		sdkOwnsWaitResume: true,
		allowPermissionModeOverride: false,
		allowedOverrideModes: [],
		hitlWebhookAuthentication: 'none',
		hitlWebhookResponderIdentity: 'none',
		hitlWebhookIdentityHeaderName: undefined,
		hitlWebhookIdentityJwtClaim: undefined,
		...overrides,
	};
}

function makeCtx(warn: ReturnType<typeof vi.fn>) {
	return {
		logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
		getNode: () => ({ id: 'node_test', name: 'Claude Agent SDK' }),
		getRequestObject: () => ({ headers: {} }),
		getHeaderData: () => ({}),
		getResponseObject: () => ({ setHeader: vi.fn(), send: vi.fn(), statusCode: 200 }),
		getCredentials: vi.fn(async () => {
			throw new Error('no credentials');
		}),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('authenticateHitlWebhookRequest — V8a none-auth warning', () => {
	it('warns that the endpoint relies solely on the resume token when auth is none', async () => {
		const warn = vi.fn();
		const result = await authenticateHitlWebhookRequest({
			ctx: makeCtx(warn),
			approvalConfig: makeApprovalConfig({ hitlWebhookAuthentication: 'none' }),
		});

		// Non-breaking: the request is still allowed (the resume token gates it).
		expect(result.ok).toBe(true);

		// But a clear warning must be surfaced.
		expect(warn).toHaveBeenCalledTimes(1);
		const message = String(warn.mock.calls[0][0]);
		expect(message).toMatch(/resume token/i);
		expect(message).toMatch(/second factor|authentication|recommend/i);
	});

	it('does NOT warn when an explicit authentication mode is configured', async () => {
		const warn = vi.fn();
		// headerAuth with no matching credential -> auth fails (500), but the point
		// is that the none-auth warning must NOT fire for a non-none mode.
		await authenticateHitlWebhookRequest({
			ctx: makeCtx(warn),
			approvalConfig: makeApprovalConfig({ hitlWebhookAuthentication: 'headerAuth' }),
		});

		expect(warn).not.toHaveBeenCalled();
	});

	it('does not throw when the logger is unavailable on the context', async () => {
		const config = makeApprovalConfig({ hitlWebhookAuthentication: 'none' });
		// A context without a logger must still authenticate cleanly (defensive).
		const ctx = {
			getNode: () => ({ id: 'n', name: 'Claude Agent SDK' }),
			getRequestObject: () => ({ headers: {} }),
			getHeaderData: () => ({}),
			getResponseObject: () => ({ setHeader: vi.fn(), send: vi.fn(), statusCode: 200 }),
			getCredentials: vi.fn(async () => {
				throw new Error('no credentials');
			}),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;

		const result = await authenticateHitlWebhookRequest({ ctx, approvalConfig: config });
		expect(result.ok).toBe(true);
	});
});
