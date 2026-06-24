/**
 * HITL bridge for the Managed Agent backend.
 *
 * The CLI backend intercepts HITL via canUseTool callbacks inline with the
 * SDK generator. Managed Agents work differently: the session pauses
 * server-side (status_idle, stop_reason.type='requires_action') and the
 * blocking custom tool invocation is visible as an agent.custom_tool_use
 * event in the SSE stream (mapped to an assistant tool_use content block
 * by eventMapper.ts).
 *
 * This module provides:
 *
 * 1. `injectManagedHitlInteraction` — post-stream interceptor. Scans the
 *    collected messages, finds the custom_tool_use that caused the pause,
 *    extracts the question/options from its input, and injects a
 *    RuntimePendingInteraction into runtimePendingState. The existing
 *    waitForPendingInteractions flow then handles persistence, notification,
 *    pause, and resume identically to the CLI path.
 *
 * 2. `ManagedHitlMetadata` — extra metadata stored alongside the pending
 *    interaction so the resume path can reconstruct
 *    ManagedAgentConfig.resumeWithToolResult.
 */

import type { RuntimePendingState } from '../operations/executeTask/hitlRuntimeState';
import {
	createRuntimeApprovalInteraction,
	createRuntimeQuestionInteraction,
} from '../operations/executeTask/hitlRuntimeState';
import type { HitlQuestionDefinition } from '../hitl/contractTypes';
import type { NodeStreamMessage } from '../sdk/types';
import type { ManagedAgentRawEvent, ManagedSdkMessage } from './types';
import { debugWarn } from '../diagnostics';

/** Extra metadata for managed-agent HITL interactions, persisted in the
 *  interaction store so the resume path can build resumeWithToolResult. */
export interface ManagedHitlMetadata {
	kind: 'question' | 'tool_confirmation';
	/** The sesn_... session ID paused at requires_action. */
	managedSessionId: string;
	/** The sevt_... event ID of the agent.custom_tool_use to reply to. */
	customToolUseId?: string;
	/** The sevt_... event ID of the agent.tool_use/agent.mcp_tool_use to confirm. */
	toolUseId?: string;
	/** Optional subagent thread route copied from the blocking managed event. */
	sessionThreadId?: string;
}

/** Extracted tool invocation from the stream. */
interface ManagedToolCapture {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	eventType: ManagedAgentRawEvent['type'];
	sessionThreadId?: string;
	mcpServerName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManagedSdkMessage(message: NodeStreamMessage): message is ManagedSdkMessage {
	return typeof message === 'object' && message !== null && '_raw' in message;
}

function readRequiresActionEventIds(message: NodeStreamMessage): string[] {
	if (!isManagedSdkMessage(message)) {
		return [];
	}
	const raw = message._raw;
	if (raw.type !== 'session.status_idle' || raw.stop_reason?.type !== 'requires_action') {
		return [];
	}
	return Array.isArray(raw.stop_reason.event_ids) ? raw.stop_reason.event_ids : [];
}

function encodeRequestPart(value: string): string {
	return Buffer.from(value, 'utf-8').toString('base64url');
}

export function decodeManagedRequestId(
	requestId: string,
	prefix: string,
): { toolUseId: string; sessionThreadId?: string } | undefined {
	if (!requestId.startsWith(prefix)) {
		return undefined;
	}
	const body = requestId.slice(prefix.length);
	const threadMarker = '__thread_';
	const markerIndex = body.indexOf(threadMarker);
	if (markerIndex === -1) {
		return body ? { toolUseId: body } : undefined;
	}
	const toolUseId = body.slice(0, markerIndex);
	const encodedThreadId = body.slice(markerIndex + threadMarker.length);
	if (!toolUseId) {
		return undefined;
	}
	try {
		const sessionThreadId = Buffer.from(encodedThreadId, 'base64url').toString('utf-8');
		return sessionThreadId ? { toolUseId, sessionThreadId } : { toolUseId };
	} catch {
		return { toolUseId };
	}
}

function buildManagedRequestId(prefix: string, capture: ManagedToolCapture): string {
	return `${prefix}${capture.toolUseId}${
		capture.sessionThreadId ? `__thread_${encodeRequestPart(capture.sessionThreadId)}` : ''
	}`;
}

function isQuestionCapture(capture: ManagedToolCapture): boolean {
	return capture.eventType === 'agent.custom_tool_use'
		&& capture.name === 'ask_user_question'
		&& typeof capture.input.question === 'string';
}

function isToolConfirmationCapture(capture: ManagedToolCapture, requiresActionIds: string[]): boolean {
	if (capture.eventType !== 'agent.tool_use' && capture.eventType !== 'agent.mcp_tool_use') {
		return false;
	}
	if (requiresActionIds.length > 0 && !requiresActionIds.includes(capture.toolUseId)) {
		return false;
	}
	return true;
}

function buildToolLabel(capture: ManagedToolCapture): string {
	if (capture.eventType === 'agent.mcp_tool_use' && capture.mcpServerName) {
		return `${capture.mcpServerName}.${capture.name}`;
	}
	return capture.name;
}

/**
 * Scan messages yielded from the managed adapter and, if the stream ended
 * with requires_action, inject a RuntimePendingInteraction into the state
 * so the existing CLI HITL infrastructure picks it up.
 *
 * Returns the ManagedHitlMetadata for the resume path (stored alongside the
 * interaction) or null if no HITL pause was detected.
 */
export function injectManagedHitlInteraction(args: {
	messages: NodeStreamMessage[];
	sessionId: string;
	runtimePendingState: RuntimePendingState;
	executionId?: string;
	streamKey?: string;
	taskDescription?: string;
	timeoutMs?: number;
}): ManagedHitlMetadata | null {
	const {
		messages,
		sessionId,
		runtimePendingState,
		executionId,
		streamKey,
		taskDescription,
		timeoutMs = 30 * 60 * 1000, // 30 min default
	} = args;

	// 1. Check if the stream ended with requires_action. The mapper emits a
	// canonical SDKResultSuccess with TOP-LEVEL stop_reason for the managed
	// pause marker.
	const lastMsg = messages[messages.length - 1];
	if (!lastMsg || lastMsg.type !== 'result' || lastMsg.stop_reason !== 'requires_action') {
		return null;
	}

	// 2. Find the custom tool_use that triggered the pause.
	//    Walk backwards through messages to find the most recent assistant
	//    message with a tool_use content block.
	const requiresActionIds = readRequiresActionEventIds(lastMsg);
	let capture: ManagedToolCapture | undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.type !== 'assistant') continue;
		const raw = isManagedSdkMessage(msg) ? msg._raw : undefined;
		if (
			raw?.type !== 'agent.custom_tool_use'
			&& raw?.type !== 'agent.tool_use'
			&& raw?.type !== 'agent.mcp_tool_use'
		) {
			continue;
		}
		const content = msg.message.content;
		if (!Array.isArray(content)) continue;
		const toolBlock = content.find((b) => b.type === 'tool_use');
		if (toolBlock?.id) {
			capture = {
				toolUseId: toolBlock.id,
				name: toolBlock.name,
				input: isRecord(toolBlock.input) ? toolBlock.input : {},
				eventType: raw.type,
				sessionThreadId: typeof raw.session_thread_id === 'string' ? raw.session_thread_id : undefined,
				mcpServerName: raw.type === 'agent.mcp_tool_use' ? raw.mcp_server_name : undefined,
			};
			break;
		}
		}

		if (!capture) {
			debugWarn(
				'[ManagedAgent] requires_action with no preceding tool_use — cannot bridge HITL',
			);
		return null;
	}

	if (isToolConfirmationCapture(capture, requiresActionIds)) {
		const requestId = buildManagedRequestId('managed_tool_confirmation_', capture);
		const interaction = createRuntimeApprovalInteraction({
			requestId,
			streamKey,
			fingerprint: requestId,
			sessionId,
			originalTask: taskDescription,
			timeoutMs,
			executionId,
			toolName: buildToolLabel(capture),
			toolInput: capture.input,
		});
		runtimePendingState.addInteraction(interaction);
		return {
			kind: 'tool_confirmation',
			managedSessionId: sessionId,
			toolUseId: capture.toolUseId,
			sessionThreadId: capture.sessionThreadId,
		};
	}

	// 3. Build question definitions from the tool input.
	//    ask_user_question shape: { question, header?, options?: [{label, description?, value?}], multi_select? }
	//    Map to the HitlQuestionDefinition shape used by the CLI HITL path.
	const questions: HitlQuestionDefinition[] = [];
	const q = capture.input.question;
	if (isQuestionCapture(capture) && typeof q === 'string') {
		const rawOptions = Array.isArray(capture.input.options) ? capture.input.options : [];
			questions.push({
				question: q,
				header: typeof capture.input.header === 'string' ? capture.input.header : undefined,
			options: rawOptions.flatMap((opt: unknown): Array<{
				label: string;
				description?: string;
				value?: string;
				action: 'resume';
			}> => {
				if (typeof opt === 'string') {
					return [{ label: opt, action: 'resume' as const }];
				}
				if (!isRecord(opt)) return [];
				const o = opt;
				return [{
					label: String(o.label ?? o.value ?? ''),
					description: typeof o.description === 'string' ? o.description : undefined,
					value: typeof o.value === 'string' ? o.value : undefined,
					action: 'resume' as const,
				}];
			}),
			multiSelect: capture.input.multi_select === true,
		});
	}

	if (questions.length === 0) {
		return null;
	}

	// 4. Build and inject the RuntimePendingInteraction.
	const requestId = buildManagedRequestId('managed_hitl_', capture);
	const interaction = createRuntimeQuestionInteraction({
		requestId,
		streamKey,
		questions,
		sessionId,
		originalTask: taskDescription,
		timeoutMs,
		executionId,
	});
	runtimePendingState.addInteraction(interaction);

	return {
		kind: 'question',
		managedSessionId: sessionId,
		customToolUseId: capture.toolUseId,
		sessionThreadId: capture.sessionThreadId,
	};
}
