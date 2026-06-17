/**
 * Streaming Configuration Tests - availability + marker defaults
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import {
	isStreamingAvailable,
	getSendChunkFn,
	DEFAULT_MARKERS_JSON_META,
	DEFAULT_MARKERS_SIMPLE,
} from '../../streaming';

describe('Streaming Configuration', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockExec = mock<IExecuteFunctions>();
	});

	describe('isStreamingAvailable', () => {
		it('should return true when isStreaming function exists and returns true', () => {
			const execWithStreaming = {
				...mockExec,
				isStreaming: vi.fn().mockReturnValue(true),
			} as unknown as IExecuteFunctions;

			const result = isStreamingAvailable(execWithStreaming);
			expect(result).toBe(true);
		});

		it('should return false when isStreaming function exists but returns false', () => {
			const execWithStreaming = {
				...mockExec,
				isStreaming: vi.fn().mockReturnValue(false),
			} as unknown as IExecuteFunctions;

			const result = isStreamingAvailable(execWithStreaming);
			expect(result).toBe(false);
		});

		it('should return false when isStreaming function does not exist', () => {
			const result = isStreamingAvailable(mockExec);
			expect(result).toBe(false);
		});

		it('should return false when isStreaming is not a function', () => {
			const execWithBadStreaming = {
				...mockExec,
				isStreaming: true, // Not a function
			} as unknown as IExecuteFunctions;

			const result = isStreamingAvailable(execWithBadStreaming);
			expect(result).toBe(false);
		});
	});

	describe('getSendChunkFn', () => {
		it('should return sendChunk function when available', () => {
			const mockSendChunk = vi.fn();
			const execWithSendChunk = {
				...mockExec,
				sendChunk: mockSendChunk,
			} as unknown as IExecuteFunctions;

			const sendChunk = getSendChunkFn(execWithSendChunk);
			expect(sendChunk).toBeDefined();

			// Verify it's bound correctly
			sendChunk?.('item', 0, 'test data');
			expect(mockSendChunk).toHaveBeenCalledWith('item', 0, 'test data');
		});

		it('should return undefined when sendChunk not available', () => {
			const sendChunk = getSendChunkFn(mockExec);
			expect(sendChunk).toBeUndefined();
		});
	});
});

describe('DEFAULT_MARKERS_JSON_META', () => {
	it('should have all required marker properties', () => {
		expect(DEFAULT_MARKERS_JSON_META.toolCallStart).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.toolCallEnd).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.toolResultStart).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.toolResultEnd).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.subagentStart).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.subagentEnd).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.subagentMsgStart).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.subagentMsgEnd).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.todoStart).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.todoEnd).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.jsonMsgStart).toBeDefined();
		expect(DEFAULT_MARKERS_JSON_META.jsonMsgEnd).toBeDefined();
	});

	it('should have JSON-parseable metadata in markers', () => {
		// Tool call start should contain JSON
		expect(DEFAULT_MARKERS_JSON_META.toolCallStart).toContain('{');
		expect(DEFAULT_MARKERS_JSON_META.toolCallStart).toContain('\"name\"');
		expect(DEFAULT_MARKERS_JSON_META.toolCallStart).toContain('\"id\"');

		// Tool result start should contain JSON with success
		expect(DEFAULT_MARKERS_JSON_META.toolResultStart).toContain('\"success\"');
	});
});

describe('DEFAULT_MARKERS_SIMPLE', () => {
	it('should have all required marker properties', () => {
		expect(DEFAULT_MARKERS_SIMPLE.toolCallStart).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.toolCallEnd).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.toolResultStart).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.toolResultEnd).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.subagentStart).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.subagentEnd).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.subagentMsgStart).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.subagentMsgEnd).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.todoStart).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.todoEnd).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.jsonMsgStart).toBeDefined();
		expect(DEFAULT_MARKERS_SIMPLE.jsonMsgEnd).toBeDefined();
	});

	it('should have simpler markers without JSON metadata', () => {
		// Simple markers should not have nested JSON
		expect(DEFAULT_MARKERS_SIMPLE.toolCallStart).toBe('[TOOL_CALL:{name}]');
		expect(DEFAULT_MARKERS_SIMPLE.toolCallEnd).toBe('[/TOOL_CALL]');
		expect(DEFAULT_MARKERS_SIMPLE.toolResultStart).toBe('[TOOL_RESULT:{name}]');
		expect(DEFAULT_MARKERS_SIMPLE.subagentStart).toBe('[SUBAGENT_START:{name}]');
	});
});

