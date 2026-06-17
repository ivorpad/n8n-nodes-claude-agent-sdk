/**
 * Maps Managed Agent SSE events to canonical SDK messages.
 *
 * The local Claude Agent SDK emits the discriminated SDKMessage union
 * (assistant/user/result/...). The mapper normalises Managed Agent events into
 * the SAME canonical shapes — required uuid/session_id, BetaMessage envelopes,
 * top-level stop_reason, canonical result subtypes — so the existing pipeline
 * (StreamingHandler, processMessages, observability) consumes one contract.
 * Every mapped message additionally carries `_raw` (the source SSE event) as
 * the documented project extension; see ManagedSdkMessage.
 *
 * The mapper is stateful per stream: span.model_request_end events are
 * accumulated (token usage, turn count, fast-speed detection) and land on the
 * terminal result message instead of being emitted as fake stream_event frames
 * nobody consumed.
 */

import { randomUUID } from 'node:crypto';

import type {
	BetaManagedAgentsSpanModelUsage,
} from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { BetaContentBlock, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { NonNullableUsage, SDKResultError, SDKResultSuccess } from '../sdk/types';
import type { ManagedAgentRawEvent, ManagedSdkMessage, ManagedStreamMessage } from './types';

/** Placeholder model id — the Managed Agents stream does not expose one. */
const MANAGED_AGENT_MODEL = 'managed-agent';

interface UsageTotals {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
}

export interface ManagedEventMapper {
	map(event: ManagedAgentRawEvent): ManagedStreamMessage[];
}

/** Empty nullable BetaUsage for synthesized assistant envelopes. */
function nullBetaUsage(): BetaMessage['usage'] {
	return {
		cache_creation: null,
		cache_creation_input_tokens: null,
		cache_read_input_tokens: null,
		inference_geo: null,
		input_tokens: 0,
		iterations: null,
		output_tokens: 0,
		output_tokens_details: null,
		server_tool_use: null,
		service_tier: null,
		speed: null,
	};
}

/** Canonical BetaMessage envelope for mapped assistant content. */
function managedBetaMessage(id: string, content: BetaContentBlock[]): BetaMessage {
	return {
		id,
		container: null,
		content,
		context_management: null,
		diagnostics: null,
		model: MANAGED_AGENT_MODEL,
		role: 'assistant',
		stop_details: null,
		stop_reason: null,
		stop_sequence: null,
		type: 'message',
		usage: nullBetaUsage(),
	};
}

/**
 * Create a stateful mapper for one managed-agent stream.
 */
export function createManagedEventMapper(sessionId: string): ManagedEventMapper {
	const startedAtMs = Date.now();
	let turnStartMs = startedAtMs;
	let numTurns = 0;
	let sawFastSpeed = false;
	const totals: UsageTotals = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadInputTokens: 0,
		cacheCreationInputTokens: 0,
	};

	const accumulateUsage = (usage: BetaManagedAgentsSpanModelUsage): void => {
		numTurns += 1;
		totals.inputTokens += usage.input_tokens ?? 0;
		totals.outputTokens += usage.output_tokens ?? 0;
		totals.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
		totals.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
		if (usage.speed === 'fast') {
			sawFastSpeed = true;
		}
	};

	/** Required-complete NonNullableUsage with neutral fills for unreported fields. */
	const toNonNullableUsage = (): NonNullableUsage => ({
		cache_creation: {
			ephemeral_1h_input_tokens: 0,
			ephemeral_5m_input_tokens: totals.cacheCreationInputTokens,
		},
		cache_creation_input_tokens: totals.cacheCreationInputTokens,
		cache_read_input_tokens: totals.cacheReadInputTokens,
		inference_geo: '',
		input_tokens: totals.inputTokens,
		iterations: [],
		output_tokens: totals.outputTokens,
		output_tokens_details: { thinking_tokens: 0 },
		server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
		service_tier: 'standard',
		speed: sawFastSpeed ? 'fast' : 'standard',
	});

	/**
	 * Shared required fields for terminal results. The Managed Agents API
	 * reports no cost and no API-time split, so total_cost_usd and
	 * duration_api_ms stay 0 by contract.
	 */
	const baseResultFields = () => ({
		duration_ms: Math.max(0, Date.now() - turnStartMs),
		duration_api_ms: 0,
		num_turns: numTurns,
		total_cost_usd: 0,
		usage: toNonNullableUsage(),
		modelUsage: {},
		permission_denials: [],
		uuid: randomUUID(),
		session_id: sessionId,
	});

	const successResult = (
		event: ManagedAgentRawEvent,
		stopReason: string,
	): ManagedSdkMessage<SDKResultSuccess> => ({
		type: 'result',
		subtype: 'success',
		is_error: false,
		result: '',
		stop_reason: stopReason,
		...baseResultFields(),
		_raw: event,
	});

	const errorResult = (
		event: ManagedAgentRawEvent,
		stopReason: string | null,
		errors: string[],
	): ManagedSdkMessage<SDKResultError> => ({
		type: 'result',
		// Closest canonical subtype: managed-session failures (model overload,
		// rate limit, MCP failure, termination) all occur mid-execution; the
		// other subtypes encode budget/turn/structured-output limits the
		// Managed Agents API does not signal.
		subtype: 'error_during_execution',
		is_error: true,
		stop_reason: stopReason,
		errors,
		...baseResultFields(),
		_raw: event,
	});

	const map = (event: ManagedAgentRawEvent): ManagedStreamMessage[] => {
		switch (event.type) {
			case 'agent.message': {
				const textBlocks = (event.content ?? []).filter((b) => b.type === 'text');
				if (textBlocks.length === 0) return [];
				return [
					{
						type: 'assistant',
						message: managedBetaMessage(
							event.id,
							textBlocks.map((b) => ({
								type: 'text' as const,
								text: 'text' in b ? b.text : '',
								citations: null,
							})),
						),
						parent_tool_use_id: null,
						uuid: randomUUID(),
						session_id: sessionId,
						_raw: event,
					},
				];
			}

			case 'agent.thinking':
				// The API event carries no thinking text — only {id, processed_at}.
				// A canonical stream_event would require a real
				// BetaRawMessageStreamEvent payload; fabricating an empty one
				// helps nobody, so thinking markers are dropped.
				return [];

			case 'agent.tool_use':
			case 'agent.custom_tool_use':
			case 'agent.mcp_tool_use': {
				// Custom tools (e.g. ask_user_question) and MCP tools use the same
				// wire shape — name, input, id. The event's `id` is the server-side
				// event ID (sevt_...) and becomes the SDK tool_use_id. For custom
				// tools this id is ALSO the `custom_tool_use_id` a
				// user.custom_tool_result reply must reference — it must be the
				// real server ID, never a client-generated one. Events without an
				// id are dropped rather than fabricating a value that would break
				// HITL correlation on resume.
				const toolUseId = typeof event.id === 'string' ? event.id : undefined;
				if (!toolUseId) {
					console.warn(
						`[ManagedAgent] Dropping ${event.type} with missing id — cannot correlate for HITL resume`,
					);
					return [];
				}
				return [
					{
						type: 'assistant',
						message: managedBetaMessage(toolUseId, [
							{
								type: 'tool_use' as const,
								id: toolUseId,
								name: event.name ?? 'unknown',
								input: event.input ?? {},
							},
						]),
						parent_tool_use_id: null,
						uuid: randomUUID(),
						session_id: sessionId,
						_raw: event,
					},
				];
			}

			case 'agent.tool_result':
			case 'agent.mcp_tool_result': {
				const toolUseId =
					(event.type === 'agent.mcp_tool_result' ? event.mcp_tool_use_id : event.tool_use_id) ||
					event.id ||
					'';
				const rawContent = event.content;
				// Normalize content: clients expect string or [{type:'text',text}] blocks
				let normalizedContent: unknown = rawContent;
				if (Array.isArray(rawContent)) {
					normalizedContent = rawContent;
				} else if (typeof rawContent === 'string') {
					normalizedContent = [{ type: 'text', text: rawContent }];
				}
				return [
					{
						type: 'user',
						message: {
							role: 'user',
							content: [
								{
									type: 'tool_result' as const,
									tool_use_id: toolUseId,
									content: normalizedContent as never,
								},
							],
						},
						parent_tool_use_id: null,
						uuid: randomUUID(),
						session_id: sessionId,
						_raw: event,
					},
				];
			}

			case 'span.model_request_end':
				// Accumulated into the terminal result; the previous fake
				// stream_event 'usage' frame had zero consumers.
				if (event.model_usage) {
					accumulateUsage(event.model_usage);
				}
				return [];

			case 'session.status_running':
				// Server-side turn start — anchors duration_ms without clock skew.
				turnStartMs = Date.now();
				return [];

			case 'session.status_idle': {
				// stop_reason is an object { type, event_ids? }, not a bare string.
				const reasonType = event.stop_reason?.type;

				if (reasonType === 'requires_action') {
					// HITL: the session is waiting for tool confirmations. Emit a
					// short visible assistant acknowledgement (the real form is
					// emitted separately via the HITL bridge) plus a canonical
					// success result with top-level stop_reason so the stream
					// terminates cleanly. stop_reason is an open string in the
					// SDK contract; 'requires_action' is the managed-session
					// pause marker consumed by hitlBridge.
					const placeholder = '_Waiting for your answer…_';
					return [
						{
							type: 'assistant',
							message: managedBetaMessage(event.id, [
								{ type: 'text' as const, text: placeholder, citations: null },
							]),
							parent_tool_use_id: null,
							uuid: randomUUID(),
							session_id: sessionId,
							_raw: event,
						},
						successResult(event, 'requires_action'),
					];
				}
				if (reasonType === 'retries_exhausted') {
					return [
						errorResult(event, 'retries_exhausted', [
							'Managed agent turn ended: retries_exhausted',
						]),
					];
				}
				// Normal end of turn.
				return [successResult(event, reasonType ?? 'end_turn')];
			}

			case 'session.error': {
				const err = event.error;
				const message =
					err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
						? err.message
						: 'Managed agent session error';
				const errType =
					err && typeof err === 'object' && 'type' in err && typeof err.type === 'string'
						? err.type
						: 'unknown_error';
				return [errorResult(event, null, [`${errType}: ${message}`])];
			}

			case 'session.status_terminated':
				// The adapter breaks at status_idle in every healthy flow, so a
				// terminated event without idle means the turn did not complete.
				return [
					errorResult(event, 'terminated', [
						'Managed agent session terminated before reaching idle',
					]),
				];

			// Status events we consume but don't forward as messages.
			case 'session.status_rescheduled':
			case 'span.model_request_start':
			case 'user.message':
			case 'agent.thread_context_compacted':
				return [];

			default:
				return [];
		}
	};

	return { map };
}
