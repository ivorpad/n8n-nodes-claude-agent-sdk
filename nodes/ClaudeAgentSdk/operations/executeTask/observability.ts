import type { AuditLogEntry } from '../../permissions/types';
import type {
	InvocationObservability,
	InvocationObservabilityEvent,
	InvocationObservabilitySummary,
	N8nMcpEvent,
	ObservabilityMode,
	ToolCall,
} from '../../types';
import { NOOP_SECRETS_REDACTOR, type SecretsRedactor } from './secretsRedaction';

type ObservabilityLevel = 'info' | 'warn' | 'error';

interface InvocationObservabilityContext {
	executionId?: string;
	workflowId?: string;
	nodeName?: string;
	itemIndex?: number;
	correlationId?: string;
	chatSessionId?: string;
}

interface InvocationObservabilityCollectorOptions {
	mode: ObservabilityMode;
	maxEvents: number;
	maxBytes: number;
	redactPayloads: boolean;
	/**
	 * Masks secret values inside recorded payloads. Applied in addition to size
	 * summarization. Defaults to a no-op.
	 */
	secretRedactor?: SecretsRedactor;
	context?: InvocationObservabilityContext;
}

interface RecordEventInput {
	eventType: string;
	status?: string;
	level?: ObservabilityLevel;
	toolName?: string;
	durationMs?: number;
	timestamp?: string;
	payload?: Record<string, unknown>;
}

const DEFAULT_MAX_STRING = 512;
const DEFAULT_MAX_ARRAY_ITEMS = 12;
const DEFAULT_MAX_OBJECT_KEYS = 24;
const DEFAULT_MAX_DEPTH = 4;

function clampInt(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	const rounded = Math.floor(value);
	if (rounded < min) return min;
	if (rounded > max) return max;
	return rounded;
}

function normalizeTimestamp(timestamp?: string): string {
	if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
		return new Date().toISOString();
	}
	return timestamp;
}

function summarizeUnknown(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string') {
		if (value.length <= DEFAULT_MAX_STRING) return value;
		return `${value.slice(0, DEFAULT_MAX_STRING)}...`;
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (typeof value === 'bigint') return value.toString();
	if (depth >= DEFAULT_MAX_DEPTH) return '[truncated-depth]';

	if (Array.isArray(value)) {
		const limited = value
			.slice(0, DEFAULT_MAX_ARRAY_ITEMS)
			.map((item) => summarizeUnknown(item, depth + 1));
		if (value.length > DEFAULT_MAX_ARRAY_ITEMS) {
			limited.push(`[+${value.length - DEFAULT_MAX_ARRAY_ITEMS} more items]`);
		}
		return limited;
	}

	if (typeof value === 'object') {
		const objectValue = value as Record<string, unknown>;
		const entries = Object.entries(objectValue);
		const limitedEntries = entries.slice(0, DEFAULT_MAX_OBJECT_KEYS);
		const result: Record<string, unknown> = {};
		for (const [key, entryValue] of limitedEntries) {
			result[key] = summarizeUnknown(entryValue, depth + 1);
		}
		if (entries.length > DEFAULT_MAX_OBJECT_KEYS) {
			result._truncatedKeys = entries.length - DEFAULT_MAX_OBJECT_KEYS;
		}
		return result;
	}

	return String(value);
}

function maybeRedactPayload(
	payload: Record<string, unknown> | undefined,
	redactPayloads: boolean,
	secretRedactor: SecretsRedactor,
): Record<string, unknown> | undefined {
	if (!payload) return undefined;
	// Always mask known secret values, even when payload summarization is
	// disabled — secrets must never persist to the observability store in
	// plaintext (the prior behaviour only truncated long strings).
	const masked = secretRedactor.hasSecrets
		? secretRedactor.redactUnknown(payload)
		: payload;
	if (!redactPayloads) return masked;
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(masked)) {
		redacted[key] = summarizeUnknown(value);
	}
	return redacted;
}

function eventByteSize(event: InvocationObservabilityEvent): number {
	try {
		return Buffer.byteLength(JSON.stringify(event), 'utf8');
	} catch {
		return 0;
	}
}

export class InvocationObservabilityCollector {
	private readonly mode: ObservabilityMode;

	private readonly maxEvents: number;

	private readonly maxBytes: number;

	private readonly redactPayloads: boolean;

	private readonly secretRedactor: SecretsRedactor;

	private readonly events: InvocationObservabilityEvent[] = [];

	private readonly eventsByType = new Map<string, number>();

	private totalBytes = 0;

	private droppedEvents = 0;

	private sequence = 0;

	private context: InvocationObservabilityContext;

	constructor(options: InvocationObservabilityCollectorOptions) {
		this.mode = options.mode;
		this.maxEvents = clampInt(options.maxEvents, 1, 5000, 500);
		this.maxBytes = clampInt(options.maxBytes, 1024, 10 * 1024 * 1024, 262_144);
		this.redactPayloads = options.redactPayloads;
		this.secretRedactor = options.secretRedactor ?? NOOP_SECRETS_REDACTOR;
		this.context = options.context ?? {};
	}

	updateContext(partial: InvocationObservabilityContext): void {
		this.context = {
			...this.context,
			...partial,
		};
	}

	record(input: RecordEventInput): void {
		if (this.mode === 'off') return;
		const timestamp = normalizeTimestamp(input.timestamp);
		const eventId = `obs_${Date.now()}_${this.sequence++}`;
		const payload = this.mode === 'full'
			? maybeRedactPayload(input.payload, this.redactPayloads, this.secretRedactor)
			: undefined;

		const event: InvocationObservabilityEvent = {
			eventId,
			eventType: input.eventType,
			level: input.level ?? 'info',
			timestamp,
			status: input.status,
			toolName: input.toolName,
			durationMs: input.durationMs,
			executionId: this.context.executionId,
			workflowId: this.context.workflowId,
			nodeName: this.context.nodeName,
			itemIndex: this.context.itemIndex,
			correlationId: this.context.correlationId,
			chatSessionId: this.context.chatSessionId,
			payload,
		};

		const bytes = eventByteSize(event);
		if (bytes <= 0 || bytes > this.maxBytes) {
			this.droppedEvents += 1;
			return;
		}

		while (this.totalBytes + bytes > this.maxBytes && this.events.length > 0) {
			const removed = this.events.shift();
			if (!removed) break;
			this.totalBytes -= eventByteSize(removed);
			this.droppedEvents += 1;
		}

		if (this.totalBytes + bytes > this.maxBytes) {
			this.droppedEvents += 1;
			return;
		}

		this.events.push(event);
		this.totalBytes += bytes;

		while (this.events.length > this.maxEvents) {
			const removed = this.events.shift();
			if (!removed) break;
			this.totalBytes -= eventByteSize(removed);
			this.droppedEvents += 1;
		}

		const currentCount = this.eventsByType.get(input.eventType) ?? 0;
		this.eventsByType.set(input.eventType, currentCount + 1);
	}

	recordToolCalls(toolCalls: ToolCall[]): void {
		if (toolCalls.length === 0) return;
		for (const toolCall of toolCalls) {
			this.record({
				eventType: 'tool.call.detected',
				status: 'detected',
				toolName: toolCall.tool,
				payload: {
					input: toolCall.input,
				},
			});
		}
	}

	recordAuditEntries(entries: AuditLogEntry[]): void {
		if (entries.length === 0) return;
		for (const entry of entries) {
			this.record({
				eventType: entry.blocked ? 'tool.call.blocked' : 'tool.call.executed',
				status: entry.blocked ? 'blocked' : 'completed',
				level: entry.blocked ? 'warn' : 'info',
				toolName: entry.toolName,
				durationMs: entry.durationMs,
				timestamp: entry.timestamp,
				payload: {
					blockReason: entry.blockReason,
					blockRule: entry.blockRule,
					toolInput: entry.toolInput,
					toolOutput: entry.toolOutput,
				},
			});
		}
	}

	recordN8nMcpEvents(events: N8nMcpEvent[]): void {
		if (events.length === 0) return;
		for (const event of events) {
			this.record({
				eventType: 'mcp.log',
				status: event.level,
				level: event.level,
				timestamp: event.timestamp,
				payload: {
					message: event.message,
				},
			});
		}
	}

	toTaskResultObservability(): InvocationObservability {
		const firstTs = this.events[0]?.timestamp;
		const lastTs = this.events[this.events.length - 1]?.timestamp;
		const eventsByType: Record<string, number> = {};
		for (const [eventType, count] of this.eventsByType.entries()) {
			eventsByType[eventType] = count;
		}

		const summary: InvocationObservabilitySummary = {
			mode: this.mode,
			eventCount: this.events.length,
			droppedEvents: this.droppedEvents,
			truncated: this.droppedEvents > 0,
			approxBytes: this.totalBytes,
			firstTs,
			lastTs,
			eventsByType,
		};

		return {
			summary,
			events: this.events,
		};
	}

	toMetadataHints(): Record<string, string | number | boolean> {
		const summary = this.toTaskResultObservability().summary;
		return {
			agentObsMode: summary.mode,
			agentObsEventCount: summary.eventCount,
			agentObsDroppedCount: summary.droppedEvents,
			agentObsTruncated: summary.truncated,
			agentObsBytes: summary.approxBytes,
			agentObsFirstTs: summary.firstTs ?? '',
			agentObsLastTs: summary.lastTs ?? '',
		};
	}
}
