/**
 * Type definitions for the Claude Agent SDK node
 */

// SDK canonical re-exports — never re-declare these locally
export type { AgentDefinition, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

// =============================================================================
// Subagent Types
// =============================================================================

export interface SubagentUI {
	name: string;
	description: string;
	prompt: string;
	toolRestrictions: 'inherit' | 'readonly' | 'custom';
	tools?: string;
	model: 'inherit' | 'fable' | 'sonnet' | 'opus' | 'haiku';
}

// =============================================================================
// JSON Schema Types
// =============================================================================

export interface JsonSchema {
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema | JsonSchema[];
	required?: string[];
	description?: string;
	enum?: unknown[];
	additionalProperties?: boolean | JsonSchema;
	allOf?: JsonSchema[];
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	not?: JsonSchema;
	prefixItems?: JsonSchema[];
	$defs?: Record<string, JsonSchema>;
	definitions?: Record<string, JsonSchema>;
	[key: string]: unknown;
}

export interface AttributeDefinition {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'stringArray' | 'numberArray';
	description: string;
	required: boolean;
}

// =============================================================================
// MCP Server Types
// =============================================================================

interface McpServerUIBase {
	name: string;
	toolPermissions?: 'all' | 'block';
	blockedTools?: string;
	/** Per-server startup/request timeout in milliseconds (SDK McpServerConfig.timeout). */
	timeout?: number;
	/** Always load this server's tools instead of deferring (SDK McpServerConfig.alwaysLoad). */
	alwaysLoad?: boolean;
}

/** Canonical SDK McpServerToolPolicy — kept as a named alias for UI plumbing. */
type McpToolPolicyEntry = import('@anthropic-ai/claude-agent-sdk').McpServerToolPolicy;

interface McpToolPoliciesUI {
	entries?: McpToolPolicyEntry[];
}

export interface McpServerUIHttp extends McpServerUIBase {
	type: 'http';
	url: string;
	authentication?: 'none' | 'credential' | 'custom';
	headers?: string;
	toolPolicies?: McpToolPoliciesUI;
}

interface McpServerUISse extends McpServerUIBase {
	type: 'sse';
	url: string;
	authentication?: 'none' | 'credential' | 'custom';
	headers?: string;
	toolPolicies?: McpToolPoliciesUI;
}

interface McpServerUIStdio extends McpServerUIBase {
	type: 'stdio';
	command: string;
	args?: string;
	env?: string;
}

export type McpServerUI = McpServerUIHttp | McpServerUISse | McpServerUIStdio;
/** @deprecated Use McpSdkServerConfigWithInstance from SDK */
export type McpSdkServerConfig =
	import('@anthropic-ai/claude-agent-sdk').McpSdkServerConfigWithInstance;

type N8nMcpToolName = 'getItemJson' | 'getExecutionContext' | 'log' | 'setOutputJson';

export interface N8nMcpSettings {
	enabled?: boolean;
	serverName?: string;
	tools?: N8nMcpToolName[];
	allowOutputWrite?: boolean;
	includeExecutionMetadata?: boolean;
	enableSkillTools?: boolean;
	skillToolsServerName?: string;
	skillToolsSelectionMode?: 'all' | 'selected' | 'except';
	skillTools?: string[];
	skillToolTimeoutMs?: number;
}

export interface N8nMcpOutputOverride {
	mode: 'merge' | 'replace';
	json: Record<string, unknown>;
}

export interface N8nMcpEvent {
	level: 'info' | 'warn' | 'error';
	message: string;
	timestamp: string;
}

// =============================================================================
// Session Memory Interface
// =============================================================================
// Session memory tracks deterministic session existence + metadata.
// chatSessionId is the canonical Claude session ID for both new runs and resume.
// =============================================================================

interface ISessionMemoryMetadata {
	workingDirectory?: string;
	/**
	 * Managed Agents session ID (sesn_...).
	 * Set only for the managedAgent backend to enable conversation continuation.
	 * Anthropic generates this ID server-side; we map chatSessionId → sesn_... here.
	 */
	managedAgentSessionId?: string;
}

export interface ISessionMemory {
	type: 'claude-session-memory';
	/** Returns whether this deterministic chat session has been seen before. */
	has(chatSessionId: string): Promise<boolean>;
	getMetadata?(chatSessionId: string): Promise<ISessionMemoryMetadata | undefined>;
	/**
	 * Optional stale-session cleanup.
	 * Implementations can remove deterministic-session entries when they no
	 * longer correspond to a real Claude transcript on disk.
	 */
	forget?(chatSessionId: string): Promise<void>;
	/**
	 * Optional execution-scoped lock.
	 * Implementations that support distributed locking (e.g., Postgres) can serialize
	 * concurrent runs for the same chatSessionId across n8n workers.
	 */
	acquireExecutionLock?(chatSessionId: string): Promise<() => Promise<void>>;
	touch(
		chatSessionId: string,
		parentNodeName?: string,
		metadata?: ISessionMemoryMetadata,
	): Promise<void>;
}
// =============================================================================
// Message Types
// =============================================================================

export interface TodoItem {
	content: string;
	/** Canonical TodoWrite status union (sdk-tools.d.ts TodoWriteInput). */
	status: 'pending' | 'in_progress' | 'completed';
	activeForm: string;
}

export interface TaskItem {
	id: string;
	subject?: string;
	content?: string;
	description?: string;
	status?: string;
	activeForm?: string;
	owner?: string;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ToolCall {
	tool: string;
	input: unknown;
}

export type ObservabilityMode = 'off' | 'summary' | 'full';

export interface InvocationObservabilityEvent {
	eventId: string;
	eventType: string;
	level: 'info' | 'warn' | 'error';
	timestamp: string;
	status?: string;
	toolName?: string;
	durationMs?: number;
	executionId?: string;
	workflowId?: string;
	nodeName?: string;
	itemIndex?: number;
	correlationId?: string;
	chatSessionId?: string;
	payload?: Record<string, unknown>;
}

export interface InvocationObservabilitySummary {
	mode: ObservabilityMode;
	eventCount: number;
	droppedEvents: number;
	truncated: boolean;
	approxBytes: number;
	firstTs?: string;
	lastTs?: string;
	eventsByType: Record<string, number>;
}

export interface InvocationObservability {
	summary: InvocationObservabilitySummary;
	events: InvocationObservabilityEvent[];
}

// =============================================================================
// Additional Options
// =============================================================================

export interface AdditionalOptions {
	apiProvider?: 'anthropic' | 'openrouter' | 'ollama' | 'custom' | 'alibaba';
	customApiEndpoint?: string;
	ollamaBaseUrl?: string;
	ollamaModel?: string;
	// Proxy manager settings for credential-injecting egress routing
	useProxyManager?: boolean;
	proxyHttpUrl?: string;
	proxyHttpsUrl?: string;
	proxyNoProxy?: string;
	proxyCaBundlePath?: string;
	blockedTools?: string;
	enableStreaming?: boolean;
	envSecurityMode?: 'blocklist' | 'allowlist';
	allowedEnvVarNames?: string;
	claudeConfigDir?: string;
	isolateClaudeConfigDir?: boolean;
	claudeConfigIsolationMode?: 'perWorkflow' | 'perSession';
	env?: string;
	includePartialMessages?: boolean;
	forwardSubagentText?: boolean;
	loadProjectClaudeMd?: boolean;
	loadUserSettings?: boolean;
	useClaudeCodePreset?: boolean;
	claudeCodePromptSections?: string[];
	/** @deprecated Use top-level Thinking Mode (Opus only) instead */
	maxThinkingTokens?: number;
	systemPrompt?: string;
	userPromptContext?: string;
	maxBudgetUsd?: number;
	enableFileCheckpointing?: boolean;
	betas?: string[];
	correlationId?: string;
	promptSuggestions?: boolean;
	persistSession?: boolean;
	maxBufferSizeMb?: number;
	sessionTitle?: string;
	skillsFilter?: string;
	managedSettings?: string;
}
