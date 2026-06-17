/**
 * Bounded summarization of agent_sdk_result payloads stored on pending
 * companion HITL records (size-capped so DB rows stay small).
 */

import type {
	HitlApprovalRequestEnvelope,
	HitlQuestionRequestEnvelope,
} from '../../ClaudeAgentSdk/hitl/contract';

const MAX_STORED_STRING = 1024;
const MAX_STORED_DEPTH = 4;
const MAX_STORED_OBJECT_KEYS = 32;
const MAX_STORED_TOOL_CALLS = 50;
const MAX_STORED_EVENT_SAMPLES = 10;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type SummarizedValue = { value: unknown };

function summarizeTerminalValue(value: unknown, depth: number): SummarizedValue | undefined {
	if (value === null || value === undefined) return { value };
	if (typeof value === 'string') {
		return {
			value: value.length <= MAX_STORED_STRING ? value : `${value.slice(0, MAX_STORED_STRING)}...`,
		};
	}
	if (typeof value === 'number' || typeof value === 'boolean') return { value };
	if (typeof value === 'bigint') return { value: value.toString() };
	if (depth >= MAX_STORED_DEPTH) return { value: '[truncated-depth]' };
	return undefined;
}

function summarizeRecord(value: Record<string, unknown>, depth: number): Record<string, unknown> {
	const entries = Object.entries(value);
	const result: Record<string, unknown> = {};

	for (const [key, entryValue] of entries.slice(0, MAX_STORED_OBJECT_KEYS)) {
		result[key] = summarizeUnknown(entryValue, depth + 1);
	}

	if (entries.length > MAX_STORED_OBJECT_KEYS) {
		result._truncatedKeys = entries.length - MAX_STORED_OBJECT_KEYS;
	}

	return result;
}

function summarizeUnknown(value: unknown, depth = 0): unknown {
	const terminalValue = summarizeTerminalValue(value, depth);
	if (terminalValue) return terminalValue.value;
	if (Array.isArray(value)) return value.map((entry) => summarizeUnknown(entry, depth + 1));
	if (!isRecord(value)) return String(value);
	return summarizeRecord(value, depth);
}

function summarizeSample(entries: unknown[], limit: number, fromEnd: boolean): unknown[] {
	const selectedEntries = fromEnd ? entries.slice(-limit) : entries.slice(0, limit);
	return selectedEntries.map((entry) => summarizeUnknown(entry));
}

function storeSampledArray(args: {
	stored: Record<string, unknown>;
	entries: unknown[];
	countKey: string;
	sampleKey: string;
	limit: number;
	fromEnd: boolean;
	truncatedKey?: string;
	includeEmptySample?: boolean;
}): void {
	args.stored[args.countKey] = args.entries.length;
	if (args.entries.length === 0 && !args.includeEmptySample) return;

	args.stored[args.sampleKey] = summarizeSample(args.entries, args.limit, args.fromEnd);
	if (args.truncatedKey && args.entries.length > args.limit) {
		args.stored[args.truncatedKey] = args.entries.length - args.limit;
	}
}

export function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getRawAgentSdkResult(
	request: HitlApprovalRequestEnvelope | HitlQuestionRequestEnvelope,
): Record<string, unknown> | undefined {
	if (isRecord(request.agent_sdk_result)) return request.agent_sdk_result;
	if (isRecord(request.hitl_result)) return request.hitl_result;
	return undefined;
}

function storeAgentSdkIdentityFields(
	stored: Record<string, unknown>,
	rawAgentSdkResult: Record<string, unknown>,
): void {
	const summary = asNonEmptyString(rawAgentSdkResult.summary);
	if (summary) stored.summary = summarizeUnknown(summary);

	const sessionId = asNonEmptyString(rawAgentSdkResult.sessionId);
	if (sessionId) stored.sessionId = sessionId;

	const chatSessionId = asNonEmptyString(rawAgentSdkResult.chatSessionId);
	if (chatSessionId) stored.chatSessionId = chatSessionId;

	if (typeof rawAgentSdkResult.isResumedSession === 'boolean') {
		stored.isResumedSession = rawAgentSdkResult.isResumedSession;
	}
}

function storeToolCalls(
	stored: Record<string, unknown>,
	rawAgentSdkResult: Record<string, unknown>,
): void {
	const toolCalls = rawAgentSdkResult.toolCalls;
	if (!Array.isArray(toolCalls)) return;

	storeSampledArray({
		stored,
		entries: toolCalls,
		countKey: 'toolCallCount',
		sampleKey: 'toolCalls',
		limit: MAX_STORED_TOOL_CALLS,
		fromEnd: false,
		truncatedKey: 'toolCallsTruncated',
		includeEmptySample: true,
	});
}

function storeObservability(
	stored: Record<string, unknown>,
	rawAgentSdkResult: Record<string, unknown>,
): void {
	const observability = rawAgentSdkResult.observability;
	if (!isRecord(observability)) return;

	if (isRecord(observability.summary)) {
		stored.observabilitySummary = summarizeUnknown(observability.summary);
	}

	if (Array.isArray(observability.events)) {
		storeSampledArray({
			stored,
			entries: observability.events,
			countKey: 'observabilityEventCount',
			sampleKey: 'observabilityEventsSample',
			limit: MAX_STORED_EVENT_SAMPLES,
			fromEnd: true,
		});
	}
}

function storeUsage(
	stored: Record<string, unknown>,
	rawAgentSdkResult: Record<string, unknown>,
): void {
	if (isRecord(rawAgentSdkResult.usage)) {
		stored.usage = summarizeUnknown(rawAgentSdkResult.usage);
	}
}

function storeN8nMcpEvents(
	stored: Record<string, unknown>,
	rawAgentSdkResult: Record<string, unknown>,
): void {
	const n8nMcpEvents = rawAgentSdkResult.n8nMcpEvents;
	if (!Array.isArray(n8nMcpEvents)) return;

	storeSampledArray({
		stored,
		entries: n8nMcpEvents,
		countKey: 'n8nMcpEventCount',
		sampleKey: 'n8nMcpEventsSample',
		limit: MAX_STORED_EVENT_SAMPLES,
		fromEnd: true,
	});
}

export function buildStoredAgentSdkResult(
	request: HitlApprovalRequestEnvelope | HitlQuestionRequestEnvelope,
): Record<string, unknown> | undefined {
	const rawAgentSdkResult = getRawAgentSdkResult(request);
	if (!rawAgentSdkResult) return undefined;

	const stored: Record<string, unknown> = {};
	storeAgentSdkIdentityFields(stored, rawAgentSdkResult);
	storeToolCalls(stored, rawAgentSdkResult);
	storeObservability(stored, rawAgentSdkResult);
	storeUsage(stored, rawAgentSdkResult);
	storeN8nMcpEvents(stored, rawAgentSdkResult);

	return Object.keys(stored).length > 0 ? stored : undefined;
}
