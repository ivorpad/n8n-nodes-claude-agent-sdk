/**
 * HITL resume-time permission-mode override clamp regression tests.
 *
 * The HITL approval response can re-assign `permissionMode` from
 * `approvalConfig.allowedOverrideModes`. An operator allowlist
 * (N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES) must clamp this override too, so
 * a responder cannot escalate to a forbidden mode (e.g. bypassPermissions) even
 * when the workflow's allowedOverrideModes lists it.
 */

import { describe, expect, it } from 'vitest';

import { applyHitlResponse } from '../../operations/executeTask/steps/hitlResponseApplication';
import type { ApprovalConfig } from '../../permissions/approvalProperties';
import type { OperatorPolicy } from '../../permissions/policy';
import type { HitlApprovalResponseEnvelope } from '../../hitl/contract';
import type { HitlResponseState } from '../../operations/executeTask/steps/hitlResponseApplication';

function approvalConfig(overrides: Partial<ApprovalConfig> = {}): ApprovalConfig {
	return {
		enabled: true,
		mode: 'pauseForApproval',
		scope: 'notAllowed',
		specificTools: [],
		approvalMatchMode: 'tool',
		timeoutSeconds: 3600,
		defaultOnTimeout: 'deny',
		handleAskUserQuestion: true,
		sdkOwnsWaitResume: true,
		allowPermissionModeOverride: true,
		allowedOverrideModes: ['acceptEdits', 'bypassPermissions'],
		hitlWebhookAuthentication: 'none',
		hitlWebhookResponderIdentity: 'none',
		hitlWebhookIdentityHeaderName: undefined,
		hitlWebhookIdentityJwtClaim: undefined,
		...overrides,
	};
}

function emptyPolicy(overrides: Partial<OperatorPolicy> = {}): OperatorPolicy {
	return {
		blockedToolPatterns: [],
		forceSandbox: false,
		disallowUnsandboxedCommands: false,
		...overrides,
	};
}

function approvalResponse(
	overrides: Partial<HitlApprovalResponseEnvelope> = {},
): HitlApprovalResponseEnvelope {
	return {
		version: '1.0',
		type: 'approval_response',
		requestId: 'req_1',
		decisionId: 'dec_1',
		decidedAt: '2026-02-26T12:00:00.000Z',
		channel: 'webhook',
		approved: true,
		resumeSessionId: 'sess_1',
		...overrides,
	};
}

function newState(): HitlResponseState {
	return { taskDescription: 'Original task', isApprovalResume: false };
}

describe('applyHitlResponse — permission mode override clamp', () => {
	it('applies an allowlisted override when the operator policy permits the mode', () => {
		const queryOptions: Record<string, unknown> = {};
		applyHitlResponse({
			hitlResponse: approvalResponse({ permissionModeOverride: 'acceptEdits' }),
			state: newState(),
			queryOptions,
			approvalConfig: approvalConfig(),
			backendMode: 'localCli',
			operatorPolicy: emptyPolicy({ allowedPermissionModes: ['default', 'acceptEdits'] }),
		});

		expect(queryOptions.permissionMode).toBe('acceptEdits');
	});

	it('clamps a forbidden override to default when the operator policy excludes it', () => {
		const queryOptions: Record<string, unknown> = {};
		applyHitlResponse({
			hitlResponse: approvalResponse({ permissionModeOverride: 'bypassPermissions' }),
			state: newState(),
			queryOptions,
			// Workflow allows bypass as an override mode...
			approvalConfig: approvalConfig({ allowedOverrideModes: ['bypassPermissions'] }),
			backendMode: 'localCli',
			// ...but the operator policy forbids it.
			operatorPolicy: emptyPolicy({ allowedPermissionModes: ['default', 'plan'] }),
		});

		expect(queryOptions.permissionMode).toBe('default');
	});

	it('preserves the override unchanged when the operator policy is UNSET', () => {
		const queryOptions: Record<string, unknown> = {};
		applyHitlResponse({
			hitlResponse: approvalResponse({ permissionModeOverride: 'bypassPermissions' }),
			state: newState(),
			queryOptions,
			approvalConfig: approvalConfig({ allowedOverrideModes: ['bypassPermissions'] }),
			backendMode: 'localCli',
			operatorPolicy: emptyPolicy(),
		});

		expect(queryOptions.permissionMode).toBe('bypassPermissions');
	});
});
