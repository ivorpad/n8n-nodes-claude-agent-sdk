/**
 * Pure permission-mode resolution.
 *
 * The SDK node reads `permissionMode` from a workflow parameter, which is
 * expression-bindable — a workflow can therefore bind it to inbound/external
 * chat data. `bypassPermissions` disables the SDK's native per-tool permission
 * prompts and the canUseTool gate (it sets `allowDangerouslySkipPermissions`),
 * so an operator hardening a shared instance must be able to forbid it.
 *
 * This module centralizes the previously-scattered resolution logic so there is
 * a single, testable place that:
 *   1. clamps the requested mode against the operator allowlist (if configured),
 *   2. applies the HITL-enabled downgrade (HITL always runs as `default`),
 *   3. derives the dangerous `allowDangerouslySkipPermissions` flag.
 *
 * Keeping it pure (values in, values out — no n8n params, no env, no I/O) lets
 * both the initial setup path and the HITL resume-override path share the same
 * clamp without duplicating the security rule.
 */

import type { PermissionMode } from '../sdk/types';
import { resolveHitlPermissionMode } from './approvalProperties';

const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';

/**
 * Canonical SDK permission modes. Kept as a value array (checked against the
 * SDK union via `satisfies`) so arbitrary strings from parameters or the
 * operator-policy env var clamp to a real mode instead of flowing through.
 */
const PERMISSION_MODES = [
	'default',
	'acceptEdits',
	'bypassPermissions',
	'plan',
	'dontAsk',
	'auto',
] as const satisfies readonly PermissionMode[];

function isPermissionMode(value: string): value is PermissionMode {
	return (PERMISSION_MODES as readonly string[]).includes(value);
}

export interface PermissionModeResolution {
	mode: PermissionMode;
	allowDangerouslySkipPermissions: boolean;
}

export interface ResolvePermissionModeInput {
	/** The mode requested by the workflow parameter (or HITL override). */
	requestedMode: string;
	/** Whether HITL approvals are enabled (forces `default`). */
	hitlEnabled: boolean;
	/**
	 * Operator allowlist of permitted modes. `undefined` means UNSET → no
	 * restriction (current behavior). A defined array (including an empty one)
	 * is an allowlist: any mode not present is downgraded to `default`.
	 */
	allowedPermissionModes?: string[];
}

/**
 * Clamp a requested permission mode against an operator allowlist.
 *
 * `undefined` allowlist → unset → mode passes through unchanged.
 * A defined allowlist → any mode not present is downgraded to `default`.
 */
export function clampPermissionMode(
	mode: string,
	allowedModes: string[] | undefined,
): PermissionMode {
	if (!isPermissionMode(mode)) {
		return DEFAULT_PERMISSION_MODE;
	}
	if (allowedModes === undefined) {
		return mode;
	}
	return allowedModes.includes(mode) ? mode : DEFAULT_PERMISSION_MODE;
}

/**
 * Resolve the effective permission mode and the dangerous-skip flag.
 *
 * Ordering matters and mirrors the pre-existing (pre-fix) behavior:
 *   - clamp first (operator policy is a hard constraint),
 *   - then HITL downgrade (HITL always runs as `default`),
 *   - the dangerous flag is true ONLY when the final mode is
 *     `bypassPermissions`, so any downgrade (clamp or HITL) clears it.
 */
export function resolvePermissionMode(
	input: ResolvePermissionModeInput,
): PermissionModeResolution {
	const clamped = clampPermissionMode(input.requestedMode, input.allowedPermissionModes);
	const mode = resolveHitlPermissionMode(clamped, { enabled: input.hitlEnabled });
	return {
		mode,
		allowDangerouslySkipPermissions: mode === 'bypassPermissions',
	};
}
