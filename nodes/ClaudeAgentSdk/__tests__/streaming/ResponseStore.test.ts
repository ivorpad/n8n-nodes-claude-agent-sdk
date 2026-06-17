import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamableResponse } from '../../streaming/ResponseStore';
import {
	storeRequestResponse,
	retrieveRequestResponse,
	touchRequestResponse,
	clearRequestResponse,
	hasRequestResponse,
} from '../../streaming/ResponseStore';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const trackedRequestIds: string[] = [];

function createRequestId(): string {
	return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createMockResponse(): StreamableResponse & {
	write: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
} {
	const response = {
		writableEnded: false,
		write: vi.fn(() => true),
		end: vi.fn(function end(this: { writableEnded: boolean }) {
			this.writableEnded = true;
		}),
	};
	return response;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	for (const requestId of trackedRequestIds.splice(0)) {
		clearRequestResponse(requestId);
	}

	// Let cleanup interval run once after clearing tracked responses
	vi.advanceTimersByTime(31_000);
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
});

describe('ResponseStore request-scoped storage', () => {
	it('stores, retrieves and clears request responses', () => {
		const requestId = createRequestId();
		trackedRequestIds.push(requestId);
		const res = createMockResponse();

		storeRequestResponse(requestId, res);

		expect(hasRequestResponse(requestId)).toBe(true);
		expect(retrieveRequestResponse(requestId)).toBe(res);

		clearRequestResponse(requestId);
		expect(hasRequestResponse(requestId)).toBe(false);
	});

	it('expires idle responses on retrieval and closes the stream', () => {
		const requestId = createRequestId();
		trackedRequestIds.push(requestId);
		const res = createMockResponse();

		storeRequestResponse(requestId, res);
		vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1);

		expect(retrieveRequestResponse(requestId)).toBeUndefined();
		expect(res.end).toHaveBeenCalledTimes(1);
		expect(hasRequestResponse(requestId)).toBe(false);
	});

	it('touchRequestResponse extends idle lifetime', () => {
		const requestId = createRequestId();
		trackedRequestIds.push(requestId);
		const res = createMockResponse();

		storeRequestResponse(requestId, res);
		vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000);
		touchRequestResponse(requestId);
		vi.advanceTimersByTime(1500);

		expect(retrieveRequestResponse(requestId)).toBe(res);
		expect(res.end).not.toHaveBeenCalled();
	});

	it('cleanup interval removes stale responses to prevent memory growth', () => {
		const requestId = createRequestId();
		trackedRequestIds.push(requestId);
		const res = createMockResponse();

		storeRequestResponse(requestId, res);
		vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 60_000);

		expect(hasRequestResponse(requestId)).toBe(false);
		expect(res.end).toHaveBeenCalledTimes(1);
	});
});
