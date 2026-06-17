/**
 * ResponseStore - Active stream response registry
 *
 * This module only tracks live process-local HTTP responses keyed by a stream
 * identifier. It is not a source of truth for replay, terminal state, or
 * stream progress. Durable recovery lives in Postgres; this registry only
 * exists so a currently connected socket can receive live frames.
 *
 * Session-scoped storage remains as deprecated no-ops for backwards
 * compatibility. Keep durability and replay logic out of this file.
 */

/**
 * Generic HTTP response interface
 */
export interface StreamableResponse {
	write(chunk: string | Buffer): boolean;
	end(chunk?: string | Buffer): void;
	writableEnded: boolean;
	setHeader?(name: string, value: string | number | readonly string[]): void;
	flushHeaders?(): void;
	flush?(): void;
}

// Request-scoped storage (short-lived, for current request only)
const requestResponseStore = new Map<string, {
	response: StreamableResponse;
	createdAt: number;
	lastActivityAt: number;
}>();
const MAX_ACTIVE_RESPONSES = 200;

// Idle timeout - responses are cleaned up after this much inactivity
// Set to 5 minutes to handle longer agent runs while still cleaning up stale entries
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup old request entries periodically
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanupInterval(): void {
	if (cleanupInterval) return;
	cleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [requestId, entry] of requestResponseStore.entries()) {
			// Use idle timeout (lastActivityAt) instead of age (createdAt)
			if (now - entry.lastActivityAt > IDLE_TIMEOUT_MS) {
				// Close response if still open
				if (!entry.response.writableEnded) {
					try {
						entry.response.end();
					} catch {
						// Ignore errors closing stale responses
					}
				}
				requestResponseStore.delete(requestId);
			}
		}
		// Stop interval if store is empty
		if (requestResponseStore.size === 0 && cleanupInterval) {
			clearInterval(cleanupInterval);
			cleanupInterval = null;
		}
	}, 30_000); // Check every 30 seconds
}

function closeResponse(response: StreamableResponse | undefined): void {
	if (!response || response.writableEnded) {
		return;
	}
	try {
		response.end();
	} catch {
		// Ignore secondary close failures.
	}
}

function evictOldestResponseIfNeeded(): void {
	if (requestResponseStore.size < MAX_ACTIVE_RESPONSES) {
		return;
	}

	let oldestKey: string | undefined;
	let oldestTimestamp = Number.POSITIVE_INFINITY;
	for (const [key, entry] of requestResponseStore.entries()) {
		if (entry.lastActivityAt < oldestTimestamp) {
			oldestTimestamp = entry.lastActivityAt;
			oldestKey = key;
		}
	}

	if (!oldestKey) {
		return;
	}

	const oldest = requestResponseStore.get(oldestKey);
	closeResponse(oldest?.response);
	requestResponseStore.delete(oldestKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST-SCOPED STORAGE (safe for current request streaming)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store a response object for the current request.
 * Used when resuming from approval/question webhook to stream continued execution.
 *
 * @param requestId - Active stream key (legacy name preserved for compatibility)
 * @param res - The HTTP response object to stream to
 */
export function storeRequestResponse(requestId: string, res: StreamableResponse): void {
	const now = Date.now();
	const existing = requestResponseStore.get(requestId);
	if (existing) {
		closeResponse(existing.response);
	} else {
		evictOldestResponseIfNeeded();
	}
	requestResponseStore.set(requestId, {
		response: res,
		createdAt: now,
		lastActivityAt: now,
	});
	startCleanupInterval();
}

/**
	* Update the last activity timestamp for a request response.
	* Call this when writing to the response to prevent idle timeout.
	*
	* @param requestId - The request ID to touch
	*/
export function touchRequestResponse(requestId: string): void {
	const entry = requestResponseStore.get(requestId);
	if (entry) {
		entry.lastActivityAt = Date.now();
	}
}

/**
 * Retrieve a stored response for the current request.
 *
 * @param requestId - The request ID used when storing
 * @returns The response object, or undefined if not found/expired
 */
export function retrieveRequestResponse(requestId: string): StreamableResponse | undefined {
	const entry = requestResponseStore.get(requestId);
	if (!entry) return undefined;

	// Check if idle too long
	if (Date.now() - entry.lastActivityAt > IDLE_TIMEOUT_MS) {
		closeResponse(entry.response);
		requestResponseStore.delete(requestId);
		return undefined;
	}

	// Touch on retrieval to extend the timeout
	entry.lastActivityAt = Date.now();
	return entry.response;
}

/**
 * Remove a stored request response (call after streaming completes).
 *
 * @param requestId - The request ID to remove
 */
export function clearRequestResponse(requestId: string): void {
	requestResponseStore.delete(requestId);
}

/**
 * Check if a request response is stored.
 */
export function hasRequestResponse(requestId: string): boolean {
	return requestResponseStore.has(requestId);
}
