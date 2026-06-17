/**
 * Audit Logger
 *
 * Captures detailed logs of all tool executions with support for:
 * - Input/output logging with configurable detail level
 * - Pattern-based redaction for sensitive data
 * - Duration tracking
 */

import type {
	AuditLogEntry,
	AuditLoggerConfig,
	PreToolUseHookInput,
} from './types';

// =============================================================================
// Redaction
// =============================================================================

/**
 * Apply redaction patterns to a string value
 */
function redactString(value: string, patterns: RegExp[]): string {
	let result = value;
	for (const pattern of patterns) {
		result = result.replace(pattern, '[REDACTED]');
	}
	return result;
}

/**
 * Deep clone and redact an object
 */
function redactObject(obj: unknown, patterns: RegExp[]): unknown {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj === 'string') {
		return redactString(obj, patterns);
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => redactObject(item, patterns));
	}

	if (typeof obj === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = redactObject(value, patterns);
		}
		return result;
	}

	return obj;
}

/**
 * Compile redaction patterns from string array
 */
function compileRedactionPatterns(patterns: string[]): RegExp[] {
	return patterns
		.map((pattern) => {
			try {
				return new RegExp(pattern, 'gi');
			} catch {
				console.warn(`Invalid redaction pattern: ${pattern}`);
				return null;
			}
		})
		.filter((p): p is RegExp => p !== null);
}

// =============================================================================
// Audit Logger Implementation
// =============================================================================

/**
 * Generate a unique ID for an audit entry
 */
function generateId(): string {
	return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create an in-memory audit logger
 */
export function createAuditLogger(config: AuditLoggerConfig) {
	const entries: AuditLogEntry[] = [];
	const toolStartTimes = new Map<string, number>();
	const redactionPatterns = config.redactPatterns
		? compileRedactionPatterns(config.redactPatterns)
		: [];

	/**
	 * Log a blocked tool attempt
	 */
	function logBlocked(
		input: PreToolUseHookInput,
		toolUseId: string | undefined,
		reason: string,
		rule?: string,
	): void {
		const entry: AuditLogEntry = {
			id: generateId(),
			timestamp: new Date().toISOString(),
			sessionId: input.session_id,
			toolName: input.tool_name,
			toolUseId,
			toolInput: config.logInputs
				? redactObject(input.tool_input, redactionPatterns)
				: { _redacted: true },
			blocked: true,
			blockReason: reason,
			blockRule: rule,
		};

		addEntry(entry);
	}

	/**
	 * Log an allowed tool attempt (before execution)
	 */
	function logPreToolUse(input: PreToolUseHookInput, toolUseId: string | undefined): void {
		// Record start time for duration calculation
		if (toolUseId) {
			toolStartTimes.set(toolUseId, Date.now());
		}

		const entry: AuditLogEntry = {
			id: generateId(),
			timestamp: new Date().toISOString(),
			sessionId: input.session_id,
			toolName: input.tool_name,
			toolUseId,
			toolInput: config.logInputs
				? redactObject(input.tool_input, redactionPatterns)
				: { _redacted: true },
			blocked: false,
		};

		addEntry(entry);
	}

	/**
	 * Update an entry with post-execution data
	 */
	function logPostToolUse(toolUseId: string | undefined, toolResponse: unknown): void {
		// Calculate duration
		const startTime = toolUseId ? toolStartTimes.get(toolUseId) : undefined;
		const durationMs = startTime ? Date.now() - startTime : undefined;
		if (toolUseId) {
			toolStartTimes.delete(toolUseId);
		}

		// Find and update the entry
		const entry = entries.find((e) => e.toolUseId === toolUseId);
		if (entry) {
			entry.durationMs = durationMs;
			if (config.logOutputs) {
				entry.toolOutput = redactObject(toolResponse, redactionPatterns);
			}
		}
	}

	/**
	 * Add an entry to the log
	 */
	function addEntry(entry: AuditLogEntry): void {
		entries.push(entry);

		// Enforce max entries limit
		if (config.maxEntries && entries.length > config.maxEntries) {
			entries.shift();
		}
	}

	/**
	 * Get all audit entries
	 */
	function getEntries(): AuditLogEntry[] {
		return [...entries];
	}

	/**
	 * Clear all entries
	 */
	function clear(): void {
		entries.length = 0;
		toolStartTimes.clear();
	}

	return {
		logBlocked,
		logPreToolUse,
		logPostToolUse,
		getEntries,
		clear,
	};
}

export type AuditLogger = ReturnType<typeof createAuditLogger>;
