/**
 * AGT PreToolUse Hook Builder
 *
 * Wraps an AgtEvaluator in an SDK PreToolUse hook so AGT rules are enforced
 * on every tool call, regardless of permission mode or allowedTools list.
 *
 * Why a hook (not canUseTool): the Claude Code SDK auto-allows built-in tools
 * when they're in `allowedTools` AND has its own internal allowed-tools logic
 * that bypasses `canUseTool` for built-ins under `permissionMode: 'default'`.
 * PreToolUse hooks fire on EVERY tool call regardless — this is the only
 * reliable enforcement point for AGT.
 */

// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import type {
	HookCallback,
	HookCallbackMatcher,
	HookEvent,
	PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';

import type { AgtEvaluator } from './AgtGovernance';

/**
 * Build a PreToolUse hook from an AGT evaluator.
 *
 * Returns a single-matcher hook record that can be merged into
 * `queryOptions.hooks` via `mergeHooks()`.
 *
 * Decision mapping:
 * - AGT allow → hook returns a neutral PreToolUse result
 * - AGT deny → hook returns `permissionDecision: 'deny'` with the AGT reason
 * - AGT ask (require_approval) → hook returns `permissionDecision: 'deny'`
 *   with a clear "manual approval required" message. AGT `require_approval`
 *   cannot be routed into the n8n HITL flow from a PreToolUse hook because
 *   the SDK hook system does not have pause/resume semantics. Use the
 *   existing `Approval Tool Names or IDs` HITL setting alongside AGT for
 *   approval flows.
 */
export function buildAgtPreToolUseHook(
	evaluator: AgtEvaluator,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	const hookFn: HookCallback = async (input) => {
		const { tool_name, tool_input } = input as PreToolUseHookInput;
		const result = evaluator.evaluate(
			tool_name,
			(tool_input ?? {}) as Record<string, unknown>,
		);

		if (result.decision === 'deny') {
			return {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse' as const,
					permissionDecision: 'deny' as const,
					permissionDecisionReason: result.reason,
				},
			};
		}

		if (result.decision === 'ask') {
			// AGT require_approval cannot route into HITL from a hook.
			// Fail closed with a clear message.
			const approvers = result.approvers ?? [];
			const approverSuffix = approvers.length > 0
				? ` Required approvers: ${approvers.join(', ')}.`
				: '';
			return {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse' as const,
					permissionDecision: 'deny' as const,
					permissionDecisionReason:
						`${result.reason}. Manual approval is required for this tool call but cannot be collected from a PreToolUse hook.${approverSuffix}`,
				},
			};
		}

		return {
			hookSpecificOutput: {
				hookEventName: 'PreToolUse' as const,
			},
		};
	};

	return {
		PreToolUse: [{
			hooks: [hookFn],
		}],
	};
}
