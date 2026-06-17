/**
 * Interactive-approval (HITL) configuration: the parsed ApprovalConfig shape,
 * parameter parsing, and approval-scope checks. Split out of
 * approvalProperties.ts (file-size guard) — that module keeps the UI
 * properties and re-exports these for existing importers.
 */

import type { PermissionMode } from '../sdk/types';

export interface ApprovalConfig {
	enabled: boolean;
	mode: 'pauseForApproval' | 'disabled';
	scope: 'notAllowed' | 'fileOps' | 'bash' | 'specific';
	specificTools: string[];
	approvalMatchMode: 'tool' | 'tool+input';
	timeoutSeconds: number;
	handleAskUserQuestion: boolean;
	sdkOwnsWaitResume?: boolean;
	allowPermissionModeOverride: boolean;
	allowedOverrideModes: string[];
	hitlWebhookAuthentication: 'none' | 'basicAuth' | 'headerAuth' | 'jwtAuth';
	hitlWebhookResponderIdentity: 'none' | 'basicUsername' | 'headerValue' | 'jwtClaim';
	hitlWebhookIdentityHeaderName?: string;
	hitlWebhookIdentityJwtClaim?: string;
}

export function isHitlEnabled(interactiveApprovals: unknown): boolean {
	return interactiveApprovals === 'pauseForApproval';
}

export function resolveHitlPermissionMode(
	permissionMode: PermissionMode,
	approvalConfig: Pick<ApprovalConfig, 'enabled'>,
): PermissionMode {
	return approvalConfig.enabled ? 'default' : permissionMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Parse approval config from node parameters
// ─────────────────────────────────────────────────────────────────────────────

export function parseApprovalConfig(
	getNodeParameter: (name: string, itemIndex: number, defaultValue?: unknown) => unknown,
	itemIndex: number,
): ApprovalConfig {
	const interactiveApprovals = getNodeParameter(
		'interactiveApprovals',
		itemIndex,
		'disabled',
	) as string;

	if (!isHitlEnabled(interactiveApprovals)) {
		return {
			enabled: false,
			mode: 'disabled',
			scope: 'notAllowed',
			specificTools: [],
			approvalMatchMode: 'tool',
			timeoutSeconds: 3600,
			handleAskUserQuestion: false,
			sdkOwnsWaitResume: true,
			allowPermissionModeOverride: false,
			allowedOverrideModes: [],
			hitlWebhookAuthentication: 'none',
			hitlWebhookResponderIdentity: 'none',
			hitlWebhookIdentityHeaderName: undefined,
			hitlWebhookIdentityJwtClaim: undefined,
		};
	}

	return {
		enabled: true,
		mode: 'pauseForApproval',
		scope: getNodeParameter('approvalScope', itemIndex, 'notAllowed') as ApprovalConfig['scope'],
		specificTools: getNodeParameter('toolsRequiringApproval', itemIndex, []) as string[],
		approvalMatchMode: getNodeParameter(
			'approvalMatchMode',
			itemIndex,
			'tool',
		) as ApprovalConfig['approvalMatchMode'],
		timeoutSeconds: getNodeParameter('approvalTimeout', itemIndex, 3600) as number,
		handleAskUserQuestion: getNodeParameter('handleAskUserQuestion', itemIndex, true) as boolean,
		sdkOwnsWaitResume: getNodeParameter('sdkOwnsWaitResume', itemIndex, true) as boolean,
		allowPermissionModeOverride: getNodeParameter(
			'allowPermissionModeOverride',
			itemIndex,
			false,
		) as boolean,
		allowedOverrideModes: getNodeParameter('allowedOverrideModes', itemIndex, []) as string[],
		hitlWebhookAuthentication: getNodeParameter(
			'hitlWebhookAuthentication',
			itemIndex,
			'none',
		) as ApprovalConfig['hitlWebhookAuthentication'],
		hitlWebhookResponderIdentity: getNodeParameter(
			'hitlWebhookResponderIdentity',
			itemIndex,
			'none',
		) as ApprovalConfig['hitlWebhookResponderIdentity'],
		hitlWebhookIdentityHeaderName: getNodeParameter(
			'hitlWebhookIdentityHeaderName',
			itemIndex,
			'x-auth-request-email',
		) as string,
		hitlWebhookIdentityJwtClaim: getNodeParameter(
			'hitlWebhookIdentityJwtClaim',
			itemIndex,
			'sub',
		) as string,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Check if a tool requires approval based on config
// ─────────────────────────────────────────────────────────────────────────────

const FILE_OPERATION_TOOLS = ['Write', 'Edit', 'NotebookEdit'];
const BASH_TOOLS = ['Bash'];

export function toolRequiresApproval(
	toolName: string,
	config: ApprovalConfig,
	allowedTools: string[],
): boolean {
	if (!config.enabled) {
		return false;
	}

	switch (config.scope) {
		case 'notAllowed':
			// Require approval for tools not in the allowed list
			return !allowedTools.includes(toolName);

		case 'fileOps':
			return FILE_OPERATION_TOOLS.includes(toolName);

		case 'bash':
			return BASH_TOOLS.includes(toolName);

		case 'specific':
			return config.specificTools.includes(toolName);

		default:
			return false;
	}
}
