/**
 * Permissions Module Types
 *
 * Type definitions for the comprehensive permissions system including:
 * - Path sandboxing
 * - Content filtering
 * - Tool permissions (canUseTool)
 * - Audit logging
 */

import type {
	PreToolUseHookInput as SdkPreToolUseHookInput,
	PostToolUseHookInput as SdkPostToolUseHookInput,
	UserPromptSubmitHookInput as SdkUserPromptSubmitHookInput,
	SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import type { PermissionBehavior, SdkHooks } from '../sdk/types';

// =============================================================================
// Path Sandboxing Types
// =============================================================================

export type PathAffectedTool = 'Read' | 'Write' | 'Edit' | 'Glob' | 'Grep';

export interface PathSandboxConfig {
	enabled: boolean;
	basePath: string;
	affectedTools: PathAffectedTool[];
	allowedPaths?: string[];
	/**
	 * Optional operator-enforced allowlist.
	 * When set, paths must satisfy BOTH workflow path sandbox rules and this list.
	 */
	operatorAllowedPaths?: string[];
}

export interface PathValidationResult {
	valid: boolean;
	originalPath: string;
	resolvedPath?: string;
	error?: string;
}

// =============================================================================
// Content Filtering Types
// =============================================================================

export type ContentFilterTool = 'Bash' | 'Write' | 'Edit' | 'Read' | 'Glob' | 'Grep';
export type ContentFilterTarget =
	| 'command'
	| 'content'
	| 'new_string'
	| 'file_path'
	| 'old_string'
	| 'path'
	| 'pattern';
export type ContentFilterPreset = 'dangerous-commands' | 'secrets-patterns' | 'system-files';

export interface ContentBlockRule {
	id: string;
	description?: string;
	pattern: string; // Regex pattern
	tools: ContentFilterTool[];
	targetField: ContentFilterTarget;
	caseInsensitive?: boolean;
}

export interface ContentFilterConfig {
	enabled: boolean;
	rules: ContentBlockRule[];
	presets?: ContentFilterPreset[];
}

export interface ContentFilterResult {
	blocked: boolean;
	reason?: string;
	matchedRule?: string;
	matchedContent?: string;
}

// =============================================================================
// Tool Permissions Types (canUseTool)
// =============================================================================

export type ToolPermissionDecision = PermissionBehavior;

/**
 * Permission decision for the canUseTool path — the canonical SDK
 * PermissionBehavior ('allow' | 'deny' | 'ask').
 */
type PermissionCheckDecision = PermissionBehavior;

/**
 * Result of a permission check before tool execution
 */
export interface PermissionCheckResult {
	decision: PermissionCheckDecision;
	reason?: string;
	/** Additional context for audit logging */
	context?: Record<string, unknown>;
}

export interface ToolPermissionRule {
	toolPattern: string; // Glob pattern: "Bash", "mcp__*", "mcp__github__*"
	decision: ToolPermissionDecision;
	condition?: string; // Simple condition: "input.command.includes('rm')"
	reason?: string;
}

export interface ToolPermissionsConfig {
	enabled: boolean;
	defaultDecision: 'allow' | 'deny';
	askFallback: 'allow' | 'deny'; // What to do when 'ask' in non-interactive context
	rules: ToolPermissionRule[];
}

// =============================================================================
// Audit Logging Types
// =============================================================================

export interface AuditLogEntry {
	id: string;
	timestamp: string;
	sessionId?: string;
	toolName: string;
	toolUseId?: string;
	toolInput: unknown;
	toolOutput?: unknown;
	durationMs?: number;
	blocked: boolean;
	blockReason?: string;
	blockRule?: string;
}

export interface AuditLoggerConfig {
	enabled: boolean;
	logInputs: boolean;
	logOutputs: boolean;
	redactPatterns?: string[];
	maxEntries?: number;
}

// =============================================================================
// AGT Governance Types
// =============================================================================

/**
 * Decision semantics for an AGT rule.
 * - `allow` / `deny` map directly to the permission decision.
 * - `require_approval` maps to `PermissionCheckDecision = 'ask'` and is only
 *   enforceable when HITL is enabled on the node; with HITL off it fails closed.
 */
type AgtRuleDecision = 'allow' | 'deny' | 'require_approval';

/**
 * Conflict resolution strategy passed to `new PolicyEngine([], strategy)`.
 * Names mirror the `@microsoft/agentmesh-sdk` `ConflictResolutionStrategy`
 * enum but are kept as string literals here to avoid pulling the runtime
 * dependency into the type module.
 */
export type AgtConflictStrategy =
	| 'priorityFirstMatch'
	| 'denyOverrides'
	| 'allowOverrides'
	| 'mostSpecificWins';

/**
 * Opaque shape of an n8n `type: 'filter'` parameter value after parsing.
 * Matches the runtime `FilterValue` contract from `n8n-workflow` —
 * `{ options, conditions, combinator }`. The AGT helper compiles this AST
 * into AGT policy condition strings at evaluator-construction time, so no
 * runtime import of the n8n filter evaluator is needed.
 */
export type AgtFilterValue = Record<string, unknown>;

export interface AgtRuleRow {
	/** Rule identifier. Blank rows are renamed to `rule-${index + 1}` by the parser. */
	name: string;
	/** Which tools this rule applies to. Reuses the canonical TOOL_OPTIONS list. */
	tools: string[];
	/** Decision to apply when the rule matches. */
	decision: AgtRuleDecision;
	/** Optional n8n filter AST evaluated against tool input. */
	conditions?: AgtFilterValue;
	/** Higher-priority rules win earlier under `priorityFirstMatch`. */
	priority: number;
	/** Comma-separated approvers, parsed into an array. Only meaningful when decision === 'require_approval'. */
	approvers?: string[];
	/** Rate limit expression, e.g. `'20/hour'`. Passed through to the AGT engine. */
	limit?: string;
}

export interface AgtGovernanceConfig {
	enabled: boolean;
	defaultAction: 'allow' | 'deny';
	conflictStrategy: AgtConflictStrategy;
	/** When blank, the parser leaves it undefined and the runtime derives a synthetic DID. */
	agentDid?: string;
	rules: AgtRuleRow[];
}

// =============================================================================
// Combined Configuration
// =============================================================================

export interface PermissionsConfig {
	pathSandbox?: PathSandboxConfig;
	contentFilter?: ContentFilterConfig;
	toolPermissions?: ToolPermissionsConfig;
	auditLogger?: AuditLoggerConfig;
	agtGovernance?: AgtGovernanceConfig;
}
// Narrow tool_input to Record<string, unknown> for internal permission checks
export type PreToolUseHookInput = Omit<SdkPreToolUseHookInput, 'tool_input'> & {
	tool_input: Record<string, unknown>;
};

export type PostToolUseHookInput = Omit<SdkPostToolUseHookInput, 'tool_input'> & {
	tool_input: Record<string, unknown>;
};

export type UserPromptSubmitHookInput = SdkUserPromptSubmitHookInput;
// Hook output — alias to SDK's SyncHookJSONOutput
export type HookOutput = SyncHookJSONOutput;

// SDK delivers undefined toolUseID for non-tool events; signatures mirror
// the canonical HookCallback calling convention.
export type PreToolUseHook = (
	input: PreToolUseHookInput,
	toolUseId: string | undefined,
) => Promise<HookOutput>;

export type PostToolUseHook = (
	input: PostToolUseHookInput,
	toolUseId: string | undefined,
) => Promise<HookOutput>;

export type UserPromptSubmitHook = (
	input: UserPromptSubmitHookInput,
	toolUseId: string | undefined,
) => Promise<HookOutput>;

/** Canonical hooks record (upstream Options['hooks']). */
export type PermissionHooks = SdkHooks;

// =============================================================================
// Build Result
// =============================================================================

export interface PermissionHooksResult {
	hooks: PermissionHooks;
	getAuditLog: () => AuditLogEntry[];
}
