/**
 * Hooks Builder
 *
 * Composes all permission checks into SDK-compatible hooks.
 * Orchestrates the permission evaluation flow:
 * 1. Path sandbox check
 * 2. Content filter check
 * 3. Tool permissions check
 * 4. Audit logging
 */

import type {
	PermissionsConfig,
	PermissionHooks,
	PermissionHooksResult,
	PreToolUseHookInput,
	PostToolUseHookInput,
	UserPromptSubmitHookInput,
	HookOutput,
	AuditLogEntry,
} from './types';
import type { HookCallback, HookEvent, SdkHooks } from '../sdk/types';

import { checkContentFilter } from './ContentFilter';
import { createAuditLogger, type AuditLogger } from './AuditLogger';
import { evaluatePermissionDecision } from './evaluatePermission';

/**
 * Check if any permission features are enabled
 */
export function hasAnyPermissionsEnabled(config: PermissionsConfig, userPromptContext?: string): boolean {
	return (
		config.pathSandbox?.enabled === true ||
		config.contentFilter?.enabled === true ||
		config.toolPermissions?.enabled === true ||
		config.auditLogger?.enabled === true ||
		(userPromptContext !== undefined && userPromptContext.trim() !== '')
	);
}

/**
 * Build permission hooks from configuration
 * @param config - The permissions configuration
 * @param existingBlockedTools - List of tools to block
 * @param userPromptContext - Additional context to inject with every user prompt
 */
export function buildPermissionHooks(
	config: PermissionsConfig,
	existingBlockedTools: string[] = [],
	userPromptContext?: string,
): PermissionHooksResult {
	let auditLogger: AuditLogger | undefined;
	if (config.auditLogger?.enabled) {
		auditLogger = createAuditLogger(config.auditLogger);
	}

	const preToolUseHook = async (
		input: PreToolUseHookInput,
		toolUseId: string | undefined,
	): Promise<HookOutput> => {
		// 1-3. Core chain: blocked tools → path sandbox → tool permissions
		const coreResult = evaluatePermissionDecision(input, config, existingBlockedTools);

		if (coreResult.decision === 'deny') {
			if (auditLogger) {
				const source = coreResult.context?.source as string | undefined;
				const blockRule = source === 'toolPermissions'
					? (coreResult.context?.matchedRule as string | undefined)
					: source;
				auditLogger.logBlocked(
					input,
					toolUseId,
					coreResult.reason || 'Denied',
					blockRule,
				);
			}
			return {
				continue: false,
				decision: 'block',
				reason: coreResult.reason || 'Denied by permission rules',
			};
		}

		// 4. Content filter check (hooks-only, runs after core chain)
		if (config.contentFilter?.enabled) {
			const contentResult = checkContentFilter(input, config.contentFilter);
			if (contentResult.blocked) {
				if (auditLogger) {
					auditLogger.logBlocked(
						input,
						toolUseId,
						contentResult.reason || 'Content blocked',
						contentResult.matchedRule,
					);
				}
				return {
					continue: false,
					decision: 'block',
					reason: contentResult.reason || 'Content is blocked by filter',
				};
			}
		}

		// 5. Log allowed tool use (if audit logging enabled)
		if (auditLogger) {
			auditLogger.logPreToolUse(input, toolUseId);
		}

		return { continue: true };
	};

	const postToolUseHook = async (
		input: PostToolUseHookInput,
		toolUseId: string | undefined,
	): Promise<HookOutput> => {
		if (auditLogger) {
			auditLogger.logPostToolUse(toolUseId, input.tool_response);
		}

		return { continue: true };
	};

	const trimmedContext = userPromptContext?.trim();
	const userPromptSubmitHook = trimmedContext
		? async (
				input: UserPromptSubmitHookInput,
				toolUseId: string | undefined,
			): Promise<HookOutput> => {
				void input;
				void toolUseId;
				return {
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'UserPromptSubmit',
						additionalContext: trimmedContext,
					},
				};
			}
		: undefined;

	// Wrap the narrow per-event evaluators behind canonical HookCallback
	// boundaries: the SDK calls every matcher with the full HookInput union and
	// an optional toolUseID, so each wrapper narrows on hook_event_name and
	// coerces tool_input (canonically `unknown`) for the internal checks.
	const preToolUseCallback: HookCallback = async (input, toolUseID) =>
		input.hook_event_name === 'PreToolUse'
			? preToolUseHook({ ...input, tool_input: toPermissionToolInput(input.tool_input) }, toolUseID)
			: { continue: true };
	const postToolUseCallback: HookCallback = async (input, toolUseID) =>
		input.hook_event_name === 'PostToolUse'
			? postToolUseHook({ ...input, tool_input: toPermissionToolInput(input.tool_input) }, toolUseID)
			: { continue: true };

	const hooks: PermissionHooks = {
		PreToolUse: [
			{
				hooks: [preToolUseCallback],
			},
		],
		PostToolUse: [
			{
				hooks: [postToolUseCallback],
			},
		],
	};

	if (userPromptSubmitHook) {
		const userPromptSubmitCallback: HookCallback = async (input, toolUseID) =>
			input.hook_event_name === 'UserPromptSubmit'
				? userPromptSubmitHook(input, toolUseID)
				: { continue: true };
		hooks.UserPromptSubmit = [
			{
				hooks: [userPromptSubmitCallback],
			},
		];
	}

	return {
		hooks,
		getAuditLog: (): AuditLogEntry[] => {
			return auditLogger?.getEntries() || [];
		},
	};
}

/** Coerce the canonical `tool_input: unknown` for the internal permission checks. */
function toPermissionToolInput(toolInput: unknown): Record<string, unknown> {
	return toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)
		? (toolInput as Record<string, unknown>)
		: {};
}

/**
 * Merge hook sources into a single hooks record.
 * Works with any HookEvent key — not limited to permission-specific events.
 */
export function mergeHooks(
	existing: SdkHooks | undefined,
	incoming: SdkHooks,
): SdkHooks {
	if (!existing) {
		return { ...incoming };
	}

	const merged: SdkHooks = { ...existing };

	for (const key of Object.keys(incoming) as HookEvent[]) {
		const incomingMatchers = incoming[key] ?? [];
		const existingMatchers = merged[key];
		if (!existingMatchers) {
			merged[key] = incomingMatchers;
			continue;
		}

		merged[key] = key === 'PostToolUse'
			? [...existingMatchers, ...incomingMatchers]
			: [...incomingMatchers, ...existingMatchers];
	}

	return merged;
}

interface ExecutionHookSources {
	permissionHooks?: SdkHooks;
	agtHooks?: SdkHooks;
	userHooks?: SdkHooks;
}

/**
 * Merge execution-time hook sources in the node's intended enforcement order.
 * Built-in permission hooks run first, AGT runs next, and user-defined
 * hook handlers run last so policy denials short-circuit external side effects.
 */
export function mergeExecutionHookSources(
	existing: SdkHooks | undefined,
	{ permissionHooks, agtHooks, userHooks }: ExecutionHookSources,
): SdkHooks | undefined {
	let merged = existing ? { ...existing } : undefined;

	for (const source of [permissionHooks, agtHooks, userHooks]) {
		if (!source) {
			continue;
		}
		if (!merged) {
			merged = { ...source };
			continue;
		}

		for (const key of Object.keys(source) as HookEvent[]) {
			const sourceMatchers = source[key] ?? [];
			const existingMatchers = merged[key];
			merged[key] = existingMatchers
				? [...existingMatchers, ...sourceMatchers]
				: sourceMatchers;
		}
	}

	return merged;
}
