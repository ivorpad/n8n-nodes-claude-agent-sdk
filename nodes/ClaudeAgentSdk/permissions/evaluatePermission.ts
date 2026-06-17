/**
 * Shared Permission Evaluation
 *
 * Core permission chain shared by canUseToolCallback and HooksBuilder:
 * blocked tools → path sandbox → tool permissions.
 *
 * Returns on first deny; otherwise returns the tool-permissions decision
 * (allow/ask) or 'allow' if no restrictions matched.
 */

import type { PermissionsConfig, PreToolUseHookInput, PermissionCheckResult } from './types';
import { checkPathSandbox } from './PathSandbox';
import { evaluateToolPermission } from './ToolPermissions';
import { findMatchingToolPattern } from './toolPattern';

/**
 * Evaluate the core permission chain: blocked tools → path sandbox → tool permissions.
 *
 * Used by both the canUseToolCallback (interactive HITL path) and the
 * HooksBuilder (SDK hooks path) to avoid duplicating the same evaluation
 * logic. Callers may layer additional checks (e.g. content filter,
 * allowed-tools list) on top of the result.
 *
 * The `context` field on the result carries source metadata so callers
 * (e.g. audit logger) can identify which check produced the decision.
 */
export function evaluatePermissionDecision(
	input: PreToolUseHookInput,
	config: PermissionsConfig,
	blockedTools: string[],
): PermissionCheckResult {
	// 1. Blocked tools
	const matchedBlockedTool = findMatchingToolPattern(input.tool_name, blockedTools);
	if (matchedBlockedTool) {
		return {
			decision: 'deny',
			reason: `Tool "${input.tool_name}" is blocked by configuration pattern "${matchedBlockedTool}"`,
			context: { source: 'blockedTools', matchedPattern: matchedBlockedTool },
		};
	}

	// 2. Path sandbox
	if (config.pathSandbox?.enabled) {
		const pathResult = checkPathSandbox(input, config.pathSandbox);
		if (!pathResult.valid) {
			return {
				decision: 'deny',
				reason: pathResult.error || 'Path is outside the allowed sandbox',
				context: { source: 'pathSandbox' },
			};
		}
	}

	// 3. Tool permissions
	if (config.toolPermissions?.enabled) {
		const permResult = evaluateToolPermission(input, config.toolPermissions);
		if (permResult.decision === 'deny') {
			return {
				decision: 'deny',
				reason: permResult.reason || `Tool "${input.tool_name}" is denied by permission rule`,
				context: { source: 'toolPermissions', matchedRule: permResult.rule?.toolPattern },
			};
		}
		if (permResult.decision === 'allow' || permResult.decision === 'ask') {
			return {
				decision: permResult.decision,
				reason: permResult.reason,
			};
		}
	}

	// Default: no restrictions matched
	return { decision: 'allow' };
}
