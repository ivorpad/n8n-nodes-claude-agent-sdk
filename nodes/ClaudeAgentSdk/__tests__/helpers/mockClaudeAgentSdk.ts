/**
 * Mock factory for Claude Agent SDK's async iterator pattern
 */

import { vi } from 'vitest';
import type { SdkAdapter, SessionHandle } from '../../sdk/types';

/**
 * Creates an async generator that yields predefined messages
 */
function createMockAsyncIterator<T>(messages: T[]): AsyncIterable<T> {
	return {
		[Symbol.asyncIterator]: async function* () {
			for (const msg of messages) {
				yield msg;
			}
		},
	};
}

/**
 * Creates a mock query function that returns an async iterable
 */
function createMockQueryFn(messages: unknown[] = []) {
	return vi.fn().mockImplementation(() => {
		return createMockAsyncIterator(messages);
	});
}

/**
 * Creates a mock SDK adapter for testing
 */
export function createMockAdapter(messages: unknown[] = []): SdkAdapter {
	const mockSessionHandle: SessionHandle = {
		id: 'test-session-123',
		send: vi.fn().mockResolvedValue(undefined),
		stream: vi.fn().mockReturnValue(createMockAsyncIterator(messages)),
		close: vi.fn().mockResolvedValue(undefined),
	};

	return {
		version: 'v1',
		createSession: vi.fn().mockResolvedValue(mockSessionHandle),
		resumeSession: vi.fn().mockResolvedValue(mockSessionHandle),
		promptOnce: vi.fn().mockReturnValue(createMockAsyncIterator(messages)),
	};
}

/**
 * Standard message fixtures for testing
 */
export const mockMessages = {
	systemInit: {
		type: 'system',
		subtype: 'init',
		session_id: 'test-session-123',
		mcp_servers: [],
		agents: [],
		tools: ['Read', 'Write', 'Bash'],
	},

	// Canonical SDKAssistantMessage carrying one text block. The legacy
	// top-level {type:'text'} shape never existed in the SDK union.
	textMessage: (text: string) => ({
		type: 'assistant',
		message: {
			role: 'assistant',
			content: [{ type: 'text', text }],
		},
		parent_tool_use_id: null,
		uuid: 'mock-uuid-text',
		session_id: 'test-session-123',
	}),

	// Canonical SDKAssistantMessage carrying one tool_use block. The legacy
	// top-level {type:'tool_use'} shape never existed in the SDK union.
	toolUse: (name: string, input: unknown) => ({
		type: 'assistant',
		message: {
			role: 'assistant',
			content: [{ type: 'tool_use', id: `tool-${Date.now()}`, name, input }],
		},
		parent_tool_use_id: null,
		uuid: 'mock-uuid-tool',
		session_id: 'test-session-123',
	}),

	artifact: (content: string) => ({
		type: 'artifact',
		content,
	}),

	result: (structuredOutput?: unknown, subtype = 'success') => ({
		type: 'result',
		subtype,
		session_id: 'test-session-123',
		structured_output: structuredOutput,
	}),

	streamEvent: (eventType: string, delta?: unknown) => ({
		type: 'stream_event',
		event: { type: eventType, delta },
	}),
};
