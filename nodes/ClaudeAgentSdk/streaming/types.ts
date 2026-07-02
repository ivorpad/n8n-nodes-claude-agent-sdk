/**
 * Streaming configuration types for ClaudeAgentSdk node
 */

import type { ChunkType } from 'n8n-workflow';

import type { HitlQuestionDefinition } from '../hitl/contractTypes';
import type { NodeStreamMessage } from '../sdk/types';
export type { NodeStreamMessage, SDKMessage } from '../sdk/types';

/**
 * JSON content types for marker-free streaming
 */
export interface ToolCallContent {
	type: 'tool_call';
	name: string;
	id: string;
	input: unknown;
}

export interface ToolResultContent {
	type: 'tool_result';
	name: string;
	id: string;
	success: boolean;
	result: unknown;
}

export interface SubagentEventContent {
	type: 'subagent_start' | 'subagent_end';
	name: string;
	id: string;
}

export interface TodoContent {
	type: 'todo_update';
	todos: unknown[];
}

export interface ExecutionMetadataContent {
	type: 'execution_metadata';
	executionId: string;
	timestamp: string;
	correlationId?: string;
	streamKey?: string;
}

export interface UserMessageContent {
	type: 'user_message';
	text: string;
}

export interface JsonMessageContent {
	type: 'json_message';
	messageType: string;
	subtype?: string;
	message: Record<string, unknown>;
}

export interface StreamErrorContent {
	type: 'error';
	source: string;
	itemIndex: number;
	correlationId?: string;
	message: string;
	details?: {
		name: string;
		stack?: string;
	};
}

/**
 * Permission request content - emitted when interactive approval is needed
 */
export interface PermissionRequestContent {
	type: 'permission_request';
	requestId: string;
	toolName: string;
	toolUseId: string;
	toolInput: Record<string, unknown>;
	sessionId: string;
	approveUrl: string;
	denyUrl: string;
	expiresAt?: string; // ISO timestamp
}

/**
 * AskUserQuestion content - emitted when Claude needs user input
 */
export interface AskUserQuestionContent {
	type: 'ask_user_question';
	requestId: string;
	toolUseId: string;
	questions: HitlQuestionDefinition[];
	sessionId: string;
	responseUrl: string;
	expiresAt?: string; // ISO timestamp
}

/**
 * Approval response content - emitted when approval decision is received
 */
export interface ApprovalResponseContent {
	type: 'approval_response';
	requestId: string;
	approved: boolean;
	sessionId?: string | null;
	permissionModeOverride?: string;
	message?: string;
	updatedInput?: Record<string, unknown>;
	timestamp: string;
}
/**
 * UAC request kind - what type of interaction is needed
 */
type ApprovalRequestKind = 'tool_approval' | 'user_question';

/**
 * UAC request metadata - common fields for all approval requests
 */
interface ApprovalChunkRequest {
	id: string;           // Request ID (approval_xxx or question_xxx)
	kind: ApprovalRequestKind;
	sessionId: string;    // Claude SDK session ID
	expiresAt?: string;   // ISO timestamp when request expires
}

/**
 * UAC tool metadata - included for tool_approval requests
 */
interface ApprovalChunkTool {
	name: string;
	useId?: string;       // tool_use_id from SDK
	input: Record<string, unknown>;
}

/**
 * UAC question metadata - included for user_question requests
 */
export type ApprovalChunkQuestion = HitlQuestionDefinition;

/**
 * UAC action URLs - how to respond to the request
 */
interface ApprovalChunkActions {
	approveUrl?: string;  // URL to approve (tool_approval)
	denyUrl?: string;     // URL to deny (tool_approval)
	responseUrl?: string; // URL to submit answers (user_question)
}

/**
 * UAC display hints - UI rendering suggestions
 */
interface ApprovalChunkDisplay {
	title: string;        // Short title for UI
	summary?: string;     // Optional longer description
}

/**
 * Universal Approval Chunk (UAC) v1 - request event
 *
 * This schema provides a consistent format for all approval-related streaming
 * events, supporting:
 * - n8n Chat UI (via messageComponents rendering)
 * - External web apps (parsing NDJSON stream)
 * - n8n workflows (handling structured JSON)
 */
export interface ApprovalChunkV1Request {
	schema: 'n8n.approval.v1';
	event: 'request';
	request: ApprovalChunkRequest;
	tool?: ApprovalChunkTool;        // Present for tool_approval
	questions?: ApprovalChunkQuestion[]; // Present for user_question
	actions: ApprovalChunkActions;
	display: ApprovalChunkDisplay;
}

/**
 * UAC v1 - response event (approval decision received)
 */
export interface ApprovalChunkV1Response {
	schema: 'n8n.approval.v1';
	event: 'response';
	request: Omit<Pick<ApprovalChunkRequest, 'id' | 'kind' | 'sessionId'>, 'sessionId'> & {
		sessionId?: string | null;
	};
	approved?: boolean;              // For tool_approval
	answers?: Record<string, string>; // For user_question
	message?: string;                // Reviewer feedback message
	updatedInput?: Record<string, unknown>; // Modified tool input from reviewer
	timestamp: string;
}

/**
 * UAC v1 - expired event (request timed out)
 */
export interface ApprovalChunkV1Expired {
	schema: 'n8n.approval.v1';
	event: 'expired';
	request: Pick<ApprovalChunkRequest, 'id' | 'kind' | 'sessionId'>;
	timestamp: string;
}

/**
 * Union type for all UAC v1 events
 */
type ApprovalChunkV1 =
	| ApprovalChunkV1Request
	| ApprovalChunkV1Response
	| ApprovalChunkV1Expired;

interface StructuredOutputContent {
	type: 'structured_output';
	content: unknown;
}

export interface StructuredOutputDeltaContent {
	type: 'structured_output_delta';
	delta: string;
	sequence: number;
	contentBlockIndex?: number;
}

/**
 * Union type for all JSON streaming content
 */
type StreamContent =
	| string
	| ToolCallContent
	| ToolResultContent
	| StructuredOutputDeltaContent
	| StructuredOutputContent
	| SubagentEventContent
	| TodoContent
	| ExecutionMetadataContent
	| UserMessageContent
	| JsonMessageContent
	| StreamErrorContent
	| PermissionRequestContent
	| AskUserQuestionContent
	| ApprovalResponseContent
	| ApprovalChunkV1;

/**
 * Content types that can be streamed.
 *
 * SDK message types (verbatim - no transformation):
 * - 'all': Stream all SDK messages verbatim
 * - 'assistant': SDKAssistantMessage
 * - 'user': SDKUserMessage
 * - 'result': SDKResultMessage
 * - 'system': SDKSystemMessage (all subtypes)
 * - 'system:init': SDKSystemMessage subtype
 * - 'system:status': SDKStatusMessage
 * - 'system:hook_response': SDKHookResponseMessage
 * - 'system:api_retry': SDKAPIRetryMessage
 * - 'system:informational': SDKInformationalMessage
 * - 'system:model_refusal_no_fallback': SDKModelRefusalNoFallbackMessage
 * - 'system:task_started': SDKTaskStartedMessage
 * - 'system:task_updated': SDKTaskUpdatedMessage
 * - 'system:task_progress': SDKTaskProgressMessage
 * - 'system:task_notification': SDKTaskNotificationMessage
 * - 'system:worker_shutting_down': SDKWorkerShuttingDownMessage
 * - 'stream_event': SDKPartialAssistantMessage (real-time streaming deltas)
 * - 'tool_progress': SDKToolProgressMessage
 * - 'auth_status': SDKAuthStatusMessage
 * - 'prompt_suggestion': SDKPromptSuggestionMessage (requires promptSuggestions option)
 *
 * Special types:
 * - 'text': Stream text deltas from stream_event (for incremental display)
 * - 'structuredOutputDelta': Stream incremental structured output JSON chunks from stream_event
 * - 'structuredOutput': Stream structured output from result message
 * - 'executionMetadata': Stream execution ID and timestamp
 *
 * Legacy types (deprecated - use SDK message types instead):
 * - 'toolCalls', 'toolResults', 'subagentLifecycle', 'subagentMessages',
 *   'todos', 'userMessages', 'allJson'
 */
export type StreamContentType =
	// SDK message types (verbatim)
	| 'all'              // Stream all SDK messages
	| 'assistant'        // SDKAssistantMessage
	| 'user'             // SDKUserMessage
	| 'result'           // SDKResultMessage
	| 'system'           // All system:* messages (init is SDKSystemMessage; other subtypes are sibling system message types)
	| 'system:init'      // SDKSystemMessage subtype
	| 'system:status'    // SDKStatusMessage
	| 'system:hook_response' // SDKHookResponseMessage
	| 'system:api_retry' // SDKAPIRetryMessage
	| 'system:informational' // SDKInformationalMessage
	| 'system:model_refusal_no_fallback' // SDKModelRefusalNoFallbackMessage
	| 'system:task_started'      // SDKTaskStartedMessage
	| 'system:task_updated'      // SDKTaskUpdatedMessage
	| 'system:task_progress'     // SDKTaskProgressMessage
	| 'system:task_notification' // SDKTaskNotificationMessage
	| 'system:session_state_changed' // SDKSessionStateChangedMessage
	| 'system:permission_denied' // SDKPermissionDeniedMessage
	| 'system:worker_shutting_down' // SDKWorkerShuttingDownMessage
	| 'stream_event'     // SDKPartialAssistantMessage
	| 'tool_progress'    // SDKToolProgressMessage
	| 'auth_status'      // SDKAuthStatusMessage
	| 'tool_use_summary' // SDKToolUseSummaryMessage
	| 'rate_limit_event' // SDKRateLimitEvent
	| 'prompt_suggestion' // SDKPromptSuggestionMessage
	// Special types
	| 'text'             // Stream text deltas (for incremental display)
	| 'structuredOutputDelta' // Stream structured output deltas from stream_event
	| 'structuredOutput' // Stream structured output from result
	| 'executionMetadata' // Stream execution ID and timestamp
	// Legacy types (deprecated)
	| 'toolCalls'
	| 'toolResults'
	| 'subagentLifecycle'
	| 'subagentMessages'
	| 'todos'
	| 'userMessages'
	| 'allJson'
	// Interactive approval types
	| 'permission_request'   // Tool permission approval requests
	| 'ask_user_question'    // AskUserQuestion tool prompts
	| 'approval_response';   // Approval decision responses

/**
 * Marker format options
 */
export type MarkerFormat = 'jsonMeta' | 'simple' | 'custom';

/**
 * Tool input display modes
 */
export type ToolInputDisplay = 'full' | 'truncated' | 'nameOnly';

/**
 * Tool result display modes
 */
export type ToolResultDisplay = 'full' | 'truncated' | 'summary';

/**
 * Tool streaming filter mode
 */
export type ToolStreamFilterMode = 'all' | 'categories' | 'specific';

/**
 * Tool categories for filtering
 */
export type ToolStreamCategory = 'file' | 'bash' | 'web' | 'agent' | 'mcp';

/**
 * Tools in each category
 */
export const TOOL_CATEGORIES: Record<ToolStreamCategory, string[]> = {
	file: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'],
	bash: ['Bash', 'BashOutput', 'KillShell'],
	web: ['WebFetch', 'WebSearch'],
	agent: [
		'Task',
		'TaskCreate',
		'TaskGet',
		'TaskList',
		'TaskOutput',
		'TaskUpdate',
		'TodoWrite',
		'AskUserQuestion',
		'Monitor',
		'Skill',
		'SlashCommand',
		'EnterPlanMode',
		'ExitPlanMode',
	],
	mcp: [], // MCP tools are matched by prefix 'mcp__'
};

/**
 * Tool stream filter configuration
 */
export interface ToolStreamFilter {
	mode: ToolStreamFilterMode;
	categories: Set<ToolStreamCategory>;
	specificTools: Set<string>;
}

/**
 * Default tool stream filter (stream all)
 */
export const DEFAULT_TOOL_STREAM_FILTER: ToolStreamFilter = {
	mode: 'all',
	categories: new Set<ToolStreamCategory>(),
	specificTools: new Set<string>(),
};

/**
 * Custom marker templates
 */
export interface StreamMarkers {
	toolCallStart: string;
	toolCallEnd: string;
	toolResultStart: string;
	toolResultEnd: string;
	subagentStart: string;
	subagentEnd: string;
	subagentMsgStart: string;
	subagentMsgEnd: string;
	todoStart: string;
	todoEnd: string;
	userMsgStart: string;
	userMsgEnd: string;
	jsonMsgStart: string;
	jsonMsgEnd: string;
}

/**
 * Streaming configuration parsed from UI
 */
export interface StreamingConfig {
	enabled: boolean;
	contentTypes: Set<StreamContentType>;
	useMarkers: boolean; // default: false - when false, stream clean JSON objects
	markerFormat: MarkerFormat;
	markers: StreamMarkers;
	toolInputDisplay: ToolInputDisplay;
	toolResultDisplay: ToolResultDisplay;
	truncationLimit: number;
	toolFilter: ToolStreamFilter;
}

/**
 * Context for tracking active subagents
 */
export interface SubagentContext {
	id: string;        // parent_tool_use_id from SDK
	name: string;      // agent name
	toolUseId: string; // Task tool use ID
}

/**
 * Context for tracking in-progress tool calls during streaming
 */
export interface ToolCallContext {
	id: string;
	name: string;
	inputJson: string;
	complete: boolean;
}

/**
 * Payload type for streaming chunks - supports both strings (marker mode) and objects (JSON mode)
 */
export type StreamItemPayload = string | StreamContent | NodeStreamMessage;

/**
 * Type for the sendChunk function
 * In JSON mode (useMarkers=false), objects are passed directly.
 * In marker mode (useMarkers=true), strings are passed.
 * Note: n8n's internal sendChunk accepts IDataObject | string.
 */
export type SendChunkFn = (type: ChunkType, itemIndex: number, data?: StreamItemPayload) => void;

/**
 * Default marker templates for JSON metadata format
 */
export const DEFAULT_MARKERS_JSON_META: StreamMarkers = {
	toolCallStart: '[TOOL_CALL:{"name":"{name}","id":"{id}"}]',
	toolCallEnd: '[/TOOL_CALL]',
	toolResultStart: '[TOOL_RESULT:{"name":"{name}","id":"{id}","success":{success}}]',
	toolResultEnd: '[/TOOL_RESULT]',
	subagentStart: '[SUBAGENT_START:{"name":"{name}","id":"{id}"}]',
	subagentEnd: '[SUBAGENT_END:{"name":"{name}","id":"{id}"}]',
	subagentMsgStart: '[SUBAGENT_MSG:{"name":"{name}"}]',
	subagentMsgEnd: '[/SUBAGENT_MSG]',
	todoStart: '[TODO:{"action":"update"}]',
	todoEnd: '[/TODO]',
	userMsgStart: '[USER_MSG]',
	userMsgEnd: '[/USER_MSG]',
	jsonMsgStart: '[MSG:{"type":"{type}","subtype":"{subtype}"}]',
	jsonMsgEnd: '[/MSG]',
};

/**
 * Default marker templates for simple format
 */
export const DEFAULT_MARKERS_SIMPLE: StreamMarkers = {
	toolCallStart: '[TOOL_CALL:{name}]',
	toolCallEnd: '[/TOOL_CALL]',
	toolResultStart: '[TOOL_RESULT:{name}]',
	toolResultEnd: '[/TOOL_RESULT]',
	subagentStart: '[SUBAGENT_START:{name}]',
	subagentEnd: '[SUBAGENT_END:{name}]',
	subagentMsgStart: '[SUBAGENT:{name}]',
	subagentMsgEnd: '[/SUBAGENT]',
	todoStart: '[TODO_UPDATE]',
	todoEnd: '[/TODO_UPDATE]',
	userMsgStart: '[USER]',
	userMsgEnd: '[/USER]',
	jsonMsgStart: '[MSG:{type}]',
	jsonMsgEnd: '[/MSG]',
};
