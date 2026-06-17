/**
 * StreamingHandler - Manages real-time streaming of agent messages
 *
 * Routes message types to streaming outputs with configurable markers.
 */

import type {
	StreamingConfig,
	StreamContentType,
	SubagentContext,
	ToolCallContext,
	SendChunkFn,
	MarkerFormat,
	StreamMarkers,
	ToolStreamFilter,
	TodoContent,
	ExecutionMetadataContent,
	UserMessageContent,
	NodeStreamMessage,
	StreamItemPayload,
	PermissionRequestContent,
	AskUserQuestionContent,
	ApprovalResponseContent,
	StructuredOutputDeltaContent,
} from '../types';
import {
	DEFAULT_MARKERS_JSON_META,
	DEFAULT_MARKERS_SIMPLE,
	DEFAULT_TOOL_STREAM_FILTER,
} from '../types';
import { HITL_MESSAGE_PREFIX } from '../../permissions/canUseToolCallback';
import { emitToolCall, emitToolResult } from './toolStreaming';
import { handleStreamEventImpl } from './streamEvents';
import { streamSubagentLifecycleImpl, streamTextImpl } from './subagentStreaming';
import { shouldStreamToolName } from './toolFilter';
import {
	shouldStreamSdkMessage,
	streamJsonMessageImpl,
	streamSdkMessageImpl,
} from './messageStreaming';
import {
	streamAskUserQuestionUacV1,
	streamApprovalExpiredUacV1,
	streamApprovalResponseUacV1,
	streamPermissionRequestUacV1,
} from './approvals';

function normalizeToolFilter(filter?: ToolStreamFilter): ToolStreamFilter {
	const base = filter ?? DEFAULT_TOOL_STREAM_FILTER;
	return {
		mode: base.mode ?? 'all',
		categories: new Set(base.categories ?? []),
		specificTools: new Set(base.specificTools ?? []),
	};
}

/**
 * Interpolates placeholders in marker templates
 * Supported placeholders: {name}, {id}, {type}, {subtype}, {success}
 */
function interpolateMarker(
	template: string,
	context: {
		name?: string;
		id?: string;
		type?: string;
		subtype?: string;
		success?: boolean;
	},
): string {
	return template
		.replace(/\{name\}/g, context.name || '')
		.replace(/\{id\}/g, context.id || '')
		.replace(/\{type\}/g, context.type || '')
		.replace(/\{subtype\}/g, context.subtype || '')
		.replace(/\{success\}/g, context.success !== undefined ? String(context.success) : '');
}

/**
 * Gets the appropriate markers based on format
 */
function getMarkersForFormat(format: MarkerFormat, customMarkers?: Partial<StreamMarkers>): StreamMarkers {
	switch (format) {
		case 'jsonMeta':
			return DEFAULT_MARKERS_JSON_META;
		case 'simple':
			return DEFAULT_MARKERS_SIMPLE;
		case 'custom':
			return {
				...DEFAULT_MARKERS_SIMPLE,
				...customMarkers,
			};
		default:
			return DEFAULT_MARKERS_JSON_META;
	}
}

/**
 * StreamingHandler class - manages all streaming operations
 */
export class StreamingHandler {
	private config: StreamingConfig;
	private sendChunk: SendChunkFn;
	private itemIndex: number;
	private toolFilter: ToolStreamFilter;

	// Track active subagents by their tool_use_id
	private activeSubagents: Map<string, SubagentContext> = new Map();

	// Track in-progress tool calls for input accumulation
	private toolCallsInProgress: Map<number, ToolCallContext> = new Map();

	// Track content blocks that belong to StructuredOutput tool calls
	private structuredOutputBlocksInProgress: Set<number> = new Set();

	// Sequence counter for structured output delta chunks
	private structuredOutputDeltaSequence = 0;

	// Track current subagent context for text attribution
	private currentSubagentId: string | null = null;

	// Track if we're currently in a subagent message block (for proper nesting)
	private inSubagentMessageBlock: boolean = false;

	constructor(
		config: StreamingConfig,
		sendChunk: SendChunkFn,
		itemIndex: number,
	) {
		this.config = config;
		this.sendChunk = sendChunk;
		this.itemIndex = itemIndex;
		this.toolFilter = normalizeToolFilter(config.toolFilter);
		// Keep config in sync so downstream access sees normalized filter
		this.config.toolFilter = this.toolFilter;
	}

	/**
	 * Check if a content type should be streamed
	 */
	shouldStream(contentType: StreamContentType): boolean {
		return this.config.contentTypes.has(contentType) || this.config.contentTypes.has('all');
	}

	/**
	 * Check if a specific tool should be streamed based on filter config
	 */
	shouldStreamTool(toolName: string): boolean {
		return shouldStreamToolName(toolName, this.toolFilter);
	}

	/**
	 * Truncate content if needed based on config
	 */
	private truncate(content: string): string {
		if (content.length <= this.config.truncationLimit) {
			return content;
		}
		return content.slice(0, this.config.truncationLimit) + '...';
	}

	/**
	 * Send a chunk to the stream (for strings/marker mode)
	 */
	private stream(content: string): void {
		this.sendChunk('item', this.itemIndex, content);
	}

	/**
	 * Emit a JSON object to the stream.
	 *
	 * Note: n8n's sendChunk accepts IDataObject | string. When we pass an object,
	 * n8n may stringify it internally before embedding in the SSE envelope. This
	 * means consumers may need to parse the content field regardless of whether
	 * we pre-stringify or not.
	 *
	 * When useMarkers=true: We stringify (for marker-based text output)
	 * When useMarkers=false: We pass object directly (n8n handles serialization)
	 */
	private emitJson(payload: Exclude<StreamItemPayload, string>): void {
		if (this.config.useMarkers) {
			// Marker mode: stringify for text-based output
			this.sendChunk('item', this.itemIndex, JSON.stringify(payload));
		} else {
			// JSON mode: pass object directly
			this.sendChunk('item', this.itemIndex, payload);
		}
	}

	/**
	 * Format a marker with context
	 */
	private formatMarker(markerTemplate: string, context: Record<string, unknown>): string {
		return interpolateMarker(markerTemplate, context as {
			name?: string;
			id?: string;
			type?: string;
			subtype?: string;
			success?: boolean;
		});
	}

	/**
	 * Stream text content (handles both main agent and subagent text)
	 * Note: Text is always streamed as plain string in both marker and JSON modes
	 */
	streamText(text: string, parentToolUseId: string | null): void {
		const next = streamTextImpl({
			config: this.config,
			shouldStream: (contentType) => this.shouldStream(contentType),
			stream: (content) => this.stream(content),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			activeSubagents: this.activeSubagents,
			text,
			parentToolUseId,
			currentSubagentId: this.currentSubagentId,
			inSubagentMessageBlock: this.inSubagentMessageBlock,
		});

		this.currentSubagentId = next.currentSubagentId;
		this.inSubagentMessageBlock = next.inSubagentMessageBlock;
	}

	/**
	 * Stream user message content (prompts/follow-up messages)
	 */
	streamUserMessage(text: string): void {
		if (!this.shouldStream('userMessages')) {
			return;
		}

		if (this.config.useMarkers) {
			this.stream(`\n${this.config.markers.userMsgStart}${text}${this.config.markers.userMsgEnd}\n`);
		} else {
			const content: UserMessageContent = { type: 'user_message', text };
			this.emitJson(content);
		}
	}

	/**
	 * Stream a tool call
	 */
	streamToolCall(name: string, id: string, input: unknown, subagentName?: string): void {
		if (!this.shouldStream('toolCalls') || !this.shouldStreamTool(name)) {
			return;
		}

		emitToolCall({
			config: this.config,
			stream: (content) => this.stream(content),
			emitJson: (payload) => this.emitJson(payload),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			truncate: (content) => this.truncate(content),
			name,
			id,
			input,
			subagentName,
		});
	}

	/**
	 * Stream a tool result
	 */
	streamToolResult(name: string, id: string, result: unknown, success: boolean): void {
		if (!this.shouldStream('toolResults') || !this.shouldStreamTool(name)) {
			return;
		}

		emitToolResult({
			config: this.config,
			stream: (content) => this.stream(content),
			emitJson: (payload) => this.emitJson(payload),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			truncate: (content) => this.truncate(content),
			name,
			id,
			result,
			success,
		});
	}

	/**
	 * Stream subagent lifecycle event (start/end)
	 */
	streamSubagentLifecycle(event: 'start' | 'end', agentName: string, toolUseId: string): void {
		if (!this.shouldStream('subagentLifecycle')) {
			return;
		}

		const next = streamSubagentLifecycleImpl({
			config: this.config,
			stream: (content) => this.stream(content),
			emitJson: (payload) => this.emitJson(payload),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			activeSubagents: this.activeSubagents,
			event,
			agentName,
			toolUseId,
			currentSubagentId: this.currentSubagentId,
			inSubagentMessageBlock: this.inSubagentMessageBlock,
		});

		this.currentSubagentId = next.currentSubagentId;
		this.inSubagentMessageBlock = next.inSubagentMessageBlock;
	}

	/**
	 * Stream a todo update
	 */
	streamTodo(todos: unknown): void {
		if (!this.shouldStream('todos')) {
			return;
		}

		if (this.config.useMarkers) {
			const contentStr = JSON.stringify(todos);
			this.stream(`\n${this.config.markers.todoStart}${contentStr}${this.config.markers.todoEnd}\n`);
		} else {
			const todosArray = Array.isArray(todos) ? todos : [todos];
			const content: TodoContent = { type: 'todo_update', todos: todosArray };
			this.emitJson(content);
		}
	}

	/**
	 * Stream a complete message as JSON
	 * Streams if 'allJson' is enabled, or if type-specific content type is enabled
	 */
	streamJsonMessage(message: Record<string, unknown>): void {
		streamJsonMessageImpl({
			config: this.config,
			message,
			stream: (content) => this.stream(content),
			emitJson: (payload) => this.emitJson(payload),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
		});
	}

	/**
	 * Stream execution metadata (executionId, timestamp, correlationId)
	 */
	streamExecutionMetadata(metadata: ExecutionMetadataContent): void {
		if (!this.shouldStream('executionMetadata')) {
			return;
		}
		this.emitJson(metadata);
	}

	/**
	 * Check if an SDK message type should be streamed based on config.
	 * Supports exact type match, 'all' for everything, and type:subtype combinations.
	 */
	shouldStreamMessage(message: NodeStreamMessage): boolean {
		return shouldStreamSdkMessage({ config: this.config, message });
	}

	/**
	 * Stream an SDK message verbatim (no transformation).
	 * The message is emitted exactly as received from the SDK.
	 * HITL coordination messages are filtered out to avoid client-side noise.
	 */
	streamMessage(message: NodeStreamMessage): void {
		streamSdkMessageImpl({
			config: this.config,
			message,
			emitJson: (payload) => this.emitJson(payload),
			hitlMessagePrefix: HITL_MESSAGE_PREFIX,
		});
	}

	/**
	 * Stream structured output result
	 * This is called when a result message with structured_output is received
	 */
	streamStructuredOutput(structuredOutput: unknown): void {
		if (!this.shouldStream('structuredOutput')) {
			return;
		}
		this.emitJson({
			type: 'structured_output',
			content: structuredOutput,
		});
	}

	/**
	 * Stream an incremental structured output delta from stream_event input_json_delta
	 */
	streamStructuredOutputDelta(delta: string, contentBlockIndex: number): void {
		if (!this.shouldStream('structuredOutputDelta')) {
			return;
		}
		const payload: StructuredOutputDeltaContent = {
			type: 'structured_output_delta',
			delta,
			sequence: ++this.structuredOutputDeltaSequence,
			contentBlockIndex,
		};
		this.emitJson(payload);
	}

	/**
	 * Handle a stream_event message for real-time streaming
	 * Returns the tool call context if a tool call was started or completed
	 */
	handleStreamEvent(
		message: Record<string, unknown>,
		parentToolUseId: string | null,
	): { toolCallComplete?: ToolCallContext } | undefined {
		return handleStreamEventImpl({
			message,
			parentToolUseId,
			toolCallsInProgress: this.toolCallsInProgress,
			structuredOutputBlocksInProgress: this.structuredOutputBlocksInProgress,
			activeSubagents: this.activeSubagents,
			streamText: (text, ptui) => this.streamText(text, ptui),
			streamToolCall: (name, id, input, subagentName) => this.streamToolCall(name, id, input, subagentName),
			streamStructuredOutputDelta: (delta, contentBlockIndex) =>
				this.streamStructuredOutputDelta(delta, contentBlockIndex),
			shouldStreamStructuredOutputDelta: () => this.shouldStream('structuredOutputDelta'),
		});
	}

	/**
	 * Finalize streaming - close any open blocks
	 */
	finalize(): void {
		// Close any open subagent message block (markers mode only)
		if (this.config.useMarkers && this.inSubagentMessageBlock) {
			this.stream(this.config.markers.subagentMsgEnd);
			this.inSubagentMessageBlock = false;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Interactive Approval Streaming Methods (UAC v1 Schema)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Stream a permission request for interactive approval (UAC v1 format)
	 * Note: This bypasses the normal content type filter when called -
	 * the caller (canUseToolCallback) already checks approvalConfig.streamRequests
	 */
	streamPermissionRequest(payload: PermissionRequestContent): void {
		streamPermissionRequestUacV1({
			config: this.config,
			stream: (content) => this.stream(content),
			emitJson: (chunk) => this.emitJson(chunk),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			payload,
		});
	}

	/**
	 * Stream an AskUserQuestion request (UAC v1 format)
	 * Note: This bypasses the normal content type filter when called -
	 * the caller already checks approvalConfig.streamRequests
	 */
	streamAskUserQuestion(payload: AskUserQuestionContent): void {
		streamAskUserQuestionUacV1({
			config: this.config,
			stream: (content) => this.stream(content),
			emitJson: (chunk) => this.emitJson(chunk),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			payload,
		});
	}

	/**
	 * Stream an approval response (UAC v1 format)
	 */
	streamApprovalResponse(payload: ApprovalResponseContent): void {
		if (!this.shouldStream('approval_response')) {
			return;
		}
		streamApprovalResponseUacV1({
			config: this.config,
			stream: (content) => this.stream(content),
			emitJson: (chunk) => this.emitJson(chunk),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			payload,
		});
	}

	/**
	 * Stream an approval expiration event (UAC v1 format)
	 */
	streamApprovalExpired(requestId: string, kind: 'tool_approval' | 'user_question', sessionId: string): void {
		streamApprovalExpiredUacV1({
			config: this.config,
			stream: (content) => this.stream(content),
			emitJson: (chunk) => this.emitJson(chunk),
			formatMarker: (markerTemplate, context) => this.formatMarker(markerTemplate, context),
			requestId,
			kind,
			sessionId,
		});
	}
}

export { getMarkersForFormat, interpolateMarker };
