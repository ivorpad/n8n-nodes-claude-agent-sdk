/**
 * Execution loops for executeTask operation (streaming and non-streaming)
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import type { StreamingConfig, SendChunkFn, ExecutionMetadataContent, NodeStreamMessage } from '../../streaming/types';
import { StreamingHandler } from '../../streaming';
import type { ExecutionResult } from './types';
import type { SharedExecutionState } from '../../permissions/canUseToolCallback';
import type { TerminalReason, SDKDeferredToolUse, QueryHandle } from '../../sdk/types';
import { isKnownNodeMessage } from '../../sdk/messageGuards';
import { isManagedSdkMessage } from '../../managedAgent/types';
import {
	asRecord,
	createExecutionTrackingState,
	extractAssistantTextBlocks,
	updateExecutionTracking,
} from './executionTracking';
import { throwWithStderr, isAbortError } from './executionErrors';
import {
	NOOP_SECRETS_REDACTOR,
	type SecretsRedactor,
} from './secretsRedaction';

async function interruptQueryOnce(
	queryResult: QueryHandle,
	state: { attempted: boolean },
): Promise<void> {
	if (state.attempted || typeof queryResult.interrupt !== 'function') {
		return;
	}

	state.attempted = true;
	try {
		await queryResult.interrupt();
	} catch (error) {
		console.warn('[Claude Agent SDK] Failed to interrupt active query after HITL latch', error);
	}
}

/**
 * Track message type for debugging
 */
function trackMessageType(
	message: NodeStreamMessage,
	messageTypeCounts: Record<string, number>,
): void {
	const messageRecord = message as unknown as Record<string, unknown>;
	const subtype = typeof messageRecord.subtype === 'string' ? messageRecord.subtype : undefined;
	const msgType = `${message.type}${subtype ? ':' + subtype : ''}`;
	messageTypeCounts[msgType] = (messageTypeCounts[msgType] || 0) + 1;
}

/**
 * Execute the agent task with streaming
 */
export async function executeStreaming(params: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	queryResult: QueryHandle;
	streamConfig: StreamingConfig;
	sendChunkFn: SendChunkFn;
	stderrOutput: string[];
	correlationId?: string;
	streamKey?: string;
	sharedState?: SharedExecutionState;
	suppressReplayStreamingMessages?: boolean;
	shouldHaltOnPendingInteraction?: () => boolean;
	/** Redacts secrets from assembled error/stderr before throwing. */
	secretRedactor?: SecretsRedactor;
}): Promise<ExecutionResult> {
	const {
		execFunctions,
		itemIndex,
		queryResult,
		streamConfig,
		sendChunkFn,
		stderrOutput,
		correlationId,
		streamKey,
		sharedState,
		suppressReplayStreamingMessages = false,
		shouldHaltOnPendingInteraction,
		secretRedactor = NOOP_SECRETS_REDACTOR,
	} = params;

	const messages: NodeStreamMessage[] = [];
	const textMessages: string[] = [];
	const trackingState = createExecutionTrackingState();
	const messageTypeCounts: Record<string, number> = {};
	let terminalReason: TerminalReason | undefined;
	let deferredToolUse: SDKDeferredToolUse | undefined;
	const interruptState = { attempted: false };
	let inResumeReplayPrefix = false;

	const streamHandler = new StreamingHandler(streamConfig, sendChunkFn, itemIndex);
	sendChunkFn('begin', itemIndex);

	// Get execution ID from workflow data proxy ($execution.id is available at runtime)
	let executionId: string | undefined;
	try {
		const dataProxy = execFunctions.getWorkflowDataProxy(itemIndex);
		executionId = (dataProxy as unknown as { $execution?: { id?: string } }).$execution?.id;
	} catch {
		// Execution ID not available in this context
	}
	if (executionId) {
		const metadata: ExecutionMetadataContent = {
			type: 'execution_metadata',
			executionId,
			timestamp: new Date().toISOString(),
			...(correlationId ? { correlationId } : {}),
			...(streamKey ? { streamKey } : {}),
		};
		// Route through handler for consistent JSON emission (avoids double-serialization)
		streamHandler.streamExecutionMetadata(metadata);
	}

	try {
		for await (const msg of queryResult) {
			const hasPending = shouldHaltOnPendingInteraction?.();
			if (hasPending) {
				console.log(`[Claude Agent SDK] HITL interrupt: pending interaction detected, interrupting agent loop (message type: ${isKnownNodeMessage(msg) ? msg.type : 'unknown'})`);
				await interruptQueryOnce(queryResult, interruptState);
				break;
			}

			const message = msg;
			const messageRecord = message as unknown as Record<string, unknown>;
			const parentToolUseId = typeof messageRecord.parent_tool_use_id === 'string'
				? messageRecord.parent_tool_use_id
				: null;
			const isReplayUserMessage = message.type === 'user' && messageRecord.isReplay === true;

			// Resume continuation streams can replay prior transcript messages before
			// emitting the new user prompt + new assistant output.
			// SDK replay typing is explicit for user messages, but assistant replay
			// messages are not always tagged. Use replay-user markers to bracket and
			// suppress the replay prefix deterministically.
			if (suppressReplayStreamingMessages) {
				if (isReplayUserMessage) {
					inResumeReplayPrefix = true;
					continue;
				}
				if (inResumeReplayPrefix && message.type === 'user') {
					// First non-replay user message is the fresh prompt for this resumed
					// turn. Do not stream it, then end replay-prefix suppression.
					inResumeReplayPrefix = false;
					continue;
				}
				if (inResumeReplayPrefix && (message.type === 'assistant' || message.type === 'result')) {
					continue;
				}
			}

			const shouldSuppressReplayMessage =
				suppressReplayStreamingMessages && messageRecord.isReplay === true;
			trackMessageType(message, messageTypeCounts);

			// Stream the SDK message verbatim (if configured)
			if (!shouldSuppressReplayMessage) {
				streamHandler.streamMessage(message);
			}

			// Resume streams are continuations for a client that already received
			// prior turns. Suppress replay payloads to prevent duplicated transcript.
			if (shouldSuppressReplayMessage) {
				continue;
			}

			// Handle stream_event messages for real-time text streaming
			if (message.type === 'stream_event') {
				streamHandler.handleStreamEvent(messageRecord, parentToolUseId);
				// Don't store stream events in messages array (they're partial)
				continue;
			}

			// Handle result message with structured output and terminal metadata
			if (message.type === 'result') {
				// Stream structured output to the response so Chat UI can display it
				if (messageRecord.structured_output !== undefined) {
					streamHandler.streamStructuredOutput(messageRecord.structured_output);
				}
				// Capture terminal reason and deferred tool payload (SDK 0.2.92+)
				if (typeof messageRecord.terminal_reason === 'string') {
					terminalReason = messageRecord.terminal_reason as TerminalReason;
				}
				if (terminalReason === 'tool_deferred' && messageRecord.deferred_tool_use) {
					deferredToolUse = messageRecord.deferred_tool_use as SDKDeferredToolUse;
				}
			}

			// Track session ID from system init message so canUseTool has
			// the correct (post-fork) session ID for subsequent interactions
			if (message.type === 'system') {
				if (messageRecord.subtype === 'init') {
					if (typeof messageRecord.session_id === 'string' && sharedState) {
						sharedState.sessionId = messageRecord.session_id;
					}
				}
				// Track the live session state (SDKSessionStateChangedMessage)
				// so HITL flows can observe idle/running/requires_action.
				if (messageRecord.subtype === 'session_state_changed' && sharedState) {
					const state = messageRecord.state;
					if (state === 'idle' || state === 'running' || state === 'requires_action') {
						sharedState.sessionState = state;
					}
				}
			}

			// Store complete messages
			messages.push(message);
			updateExecutionTracking(message, trackingState);

			// Handle assistant messages - extract content for tracking
			if (message.type === 'assistant') {
				const msgUuid = typeof messageRecord.uuid === 'string' ? messageRecord.uuid : undefined;
				const assistantMsg = asRecord(message.message);

				// Managed Agent messages arrive complete (no stream_event deltas).
				// Stream text blocks directly so the client gets text_delta chunks.
				// Guard: only for managed agent messages (have _raw); local CLI
				// streams text via stream_event deltas — don't double-emit.
				const isManagedAgentMessage = isManagedSdkMessage(message);
				if (isManagedAgentMessage && assistantMsg?.content && Array.isArray(assistantMsg.content)) {
					for (const block of assistantMsg.content as Array<Record<string, unknown>>) {
						if (block.type === 'text' && typeof block.text === 'string') {
							streamHandler.streamText(block.text as string, parentToolUseId);
						}
					}
				}

				// Check if this assistant message contains any tool_use blocks
				let hasToolUse = false;
				if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
					for (const contentBlock of assistantMsg.content) {
						const block = contentBlock as Record<string, unknown>;
						if (block.type === 'tool_use') {
							hasToolUse = true;
							break;
						}
					}
				}

				// Track assistant message UUIDs for resumeSessionAt
				// We need to track both the "before tool_use" and "with tool_use" UUIDs
				// so canUseTool can choose the correct one for resume
				if (msgUuid && sharedState) {
					if (hasToolUse) {
						// This message contains tool_use - save the PREVIOUS message UUID as "before"
						// This is the message we want to resume at (before the tool call)
						sharedState.lastAssistantMessageUuidBeforeToolUse = sharedState.lastAssistantMessageUuid;
						sharedState.lastAssistantMessageUuidWithToolUse = msgUuid;
					}
					// Always update the last seen UUID
					sharedState.lastAssistantMessageUuid = msgUuid;
				}

				// Process content blocks
				if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
					for (const contentBlock of assistantMsg.content) {
						const block = contentBlock as Record<string, unknown>;

						// Track text for final summary
						if (block.type === 'text' && block.text) {
							textMessages.push(block.text as string);
						}

					}
				}
			}
		}
	} catch (error) {
		if (isAbortError(error)) {
			streamHandler.finalize();
			// Note: 'end' event is NOT sent here — the caller owns the stream
			// lifecycle and sends 'end' after any post-execution work (e.g. HITL
			// notifications) is complete.
			return {
				messages,
				textMessages,
				latestTodos: trackingState.latestTodos,
				latestTasks: [...trackingState.latestTasksById.values()],
				messageTypeCounts,
				terminalReason,
				deferredToolUse,
			};
		}

		// Re-throw with stderr context for better debugging
		throwWithStderr(error, stderrOutput, secretRedactor);
	}

	// Finalize streaming (close any open blocks)
	streamHandler.finalize();
	// Note: 'end' event is NOT sent here — the caller owns the stream
	// lifecycle and sends 'end' after any post-execution work (e.g. HITL
	// notifications) is complete.

	return {
		messages,
		textMessages,
		latestTodos: trackingState.latestTodos,
		latestTasks: [...trackingState.latestTasksById.values()],
		messageTypeCounts,
		terminalReason,
		deferredToolUse,
	};
}

/**
 * Execute the agent task without streaming (simple message collection)
 */
export async function executeNonStreaming(params: {
	queryResult: QueryHandle;
	stderrOutput: string[];
	shouldHaltOnPendingInteraction?: () => boolean;
	/** Redacts secrets from assembled error/stderr before throwing. */
	secretRedactor?: SecretsRedactor;
}): Promise<ExecutionResult> {
	const {
		queryResult,
		stderrOutput,
		shouldHaltOnPendingInteraction,
		secretRedactor = NOOP_SECRETS_REDACTOR,
	} = params;

	const messages: NodeStreamMessage[] = [];
	const textMessages: string[] = [];
	const trackingState = createExecutionTrackingState();
	const messageTypeCounts: Record<string, number> = {};
	let terminalReason: TerminalReason | undefined;
	let deferredToolUse: SDKDeferredToolUse | undefined;
	const interruptState = { attempted: false };

	try {
		for await (const msg of queryResult) {
			if (shouldHaltOnPendingInteraction?.()) {
				await interruptQueryOnce(queryResult, interruptState);
				break;
			}

			const message = msg;
			messages.push(message);
			trackMessageType(message, messageTypeCounts);
			updateExecutionTracking(message, trackingState);

			// Capture terminal reason and deferred tool payload (SDK 0.2.92+)
			if (message.type === 'result') {
				const resultRecord = message as unknown as Record<string, unknown>;
				if (typeof resultRecord.terminal_reason === 'string') {
					terminalReason = resultRecord.terminal_reason as TerminalReason;
				}
				if (terminalReason === 'tool_deferred' && resultRecord.deferred_tool_use) {
					deferredToolUse = resultRecord.deferred_tool_use as SDKDeferredToolUse;
				}
			}

			if (message.type === 'assistant') {
				textMessages.push(...extractAssistantTextBlocks(message));
			}

		}
	} catch (error) {
		if (isAbortError(error)) {
			return {
				messages,
				textMessages,
				latestTodos: trackingState.latestTodos,
				latestTasks: [...trackingState.latestTasksById.values()],
				messageTypeCounts,
				terminalReason,
				deferredToolUse,
			};
		}

		// Re-throw with stderr context for better debugging
		throwWithStderr(error, stderrOutput, secretRedactor);
	}

	return {
		messages,
		textMessages,
		latestTodos: trackingState.latestTodos,
		latestTasks: [...trackingState.latestTasksById.values()],
		messageTypeCounts,
		terminalReason,
		deferredToolUse,
	};
}
