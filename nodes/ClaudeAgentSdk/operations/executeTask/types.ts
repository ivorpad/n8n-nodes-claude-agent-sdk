/**
 * Types for the executeTask operation
 */

import type { INodeExecutionData, EngineResponse } from 'n8n-workflow';
import type { ToolCall, TodoItem, TaskItem } from '../../types';
import type {
	ManagedSessionFilesMessage,
	ModelUsage,
	NodeStreamMessage,
	SdkAdapter,
	ClaudeAgentSdkModule,
	SDKPermissionDenial,
	SDKSystemMessage,
	TerminalReason,
	SDKDeferredToolUse,
} from '../../sdk/types';

/**
 * Options passed to executeTaskOperation
 */
export interface ExecuteTaskOptions {
	apiKey?: string;
	anthropicBaseUrl?: string;
	openrouterAuthToken?: string;
	openrouterBaseUrl?: string;
	ollamaAuthToken?: string;
	ollamaBaseUrl?: string;
	alibabaAuthToken?: string;
	alibabaBaseUrl?: string;
	liteLlmAuthToken?: string;
	liteLlmBaseUrl?: string;
	/** Resolved at runtime by ensureCodemieProxy (the local proxy URL + gateway key). */
	codeMieBaseUrl?: string;
	codeMieAuthToken?: string;
	secureEnv?: Record<string, string>;
	authMethod?:
		| 'apiCredentials'
		| 'cliSession'
		| 'openrouter'
		| 'ollama'
		| 'alibaba'
		| 'litellm'
		| 'codemie';
	backendMode?: 'localCli' | 'managedAgent';
	sdkModule?: ClaudeAgentSdkModule;
	adapter: SdkAdapter;
	engineResponse?: EngineResponse;
}

/**
 * Result returned from executeTaskOperation
 */
export interface ExecuteTaskResult {
	returnData: INodeExecutionData;
	/**
	 * Optional fan-out items appended after returnData. Used by the
	 * managed-agent generated-files feature to emit one item per file
	 * (each carrying the same task_result JSON + a binary at key 'data').
	 * When undefined or empty, output is a single item — backward-compatible.
	 */
	extraReturnItems?: INodeExecutionData[];
	auditLogData: INodeExecutionData[];
	hasAuditLogging: boolean;
	agentError?: {
		message: string;
	};
}

/**
 * Per-model token usage and cost breakdown — the canonical SDK ModelUsage
 * (incl. contextWindow and maxOutputTokens, which the previous local copy
 * silently dropped).
 */
export type ModelUsageEntry = ModelUsage;

/**
 * Execution usage summary extracted from SDK result messages
 */
export interface ExecutionUsage {
	totalCostUsd: number;
	numTurns: number;
	durationMs: number;
	durationApiMs: number;
	warnings?: string[];
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadInputTokens: number;
		cacheCreationInputTokens: number;
	};
	modelUsage: Record<string, ModelUsageEntry>;
}

/**
 * Result of processing agent messages
 */
interface ToolDenial {
	tool: string;
	reason: string;
}

export interface PendingHitlResolution {
	kind: 'approval';
	requestId: string;
	approved: boolean;
	fingerprint?: string;
	toolName?: string;
	reviewerMessage?: string;
	updatedInput?: Record<string, unknown>;
}

export interface ProcessedMessages {
	textMessages: string[];
	artifacts: unknown[];
	toolCalls: ToolCall[];
	toolDenials: ToolDenial[];
	/** system:init carries only {name, status} per server (NOT the full McpServerStatus). */
	mcpServerStatus: SDKSystemMessage['mcp_servers'];
	sessionId: string | undefined;
	rawStructuredOutputResult: unknown;
	structuredOutputResult: unknown;
	resultSubtype: string | undefined;
	/** Canonical result diagnostics (SDKResultMessage). */
	resultIsError: boolean | undefined;
	resultErrors: string[];
	permissionDenials: SDKPermissionDenial[];
	executionUsage: ExecutionUsage | undefined;
	/** Metadata-only session file listing from the managed backend (session_files message). */
	sessionFiles?: ManagedSessionFilesMessage['content'];
	terminalReason?: TerminalReason;
	deferredToolUse?: SDKDeferredToolUse;
	stopReason?: string;
	stopDetails?: unknown;
}

/**
 * Result from execution loops (streaming or non-streaming)
 */
export interface ExecutionResult {
	messages: NodeStreamMessage[];
	textMessages: string[];
	latestTodos: TodoItem[];
	latestTasks: TaskItem[];
	messageTypeCounts: Record<string, number>;
	terminalReason?: TerminalReason;
	deferredToolUse?: SDKDeferredToolUse;
}
