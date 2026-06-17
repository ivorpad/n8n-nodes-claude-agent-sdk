/**
 * StreamingHandler SDK message streaming tests (marker mode)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingHandler } from '../../streaming/StreamingHandler';
import type { StreamingConfig, StreamContentType, SDKMessage } from '../../streaming/types';
import { DEFAULT_MARKERS_JSON_META } from '../../streaming/types';

describe('StreamingHandler - SDK Message Streaming (verbatim)', () => {
	let mockSendChunk: ReturnType<typeof vi.fn>;

	const createConfig = (
		contentTypes: StreamContentType[] = ['text'],
		overrides: Partial<StreamingConfig> = {},
	): StreamingConfig => ({
		enabled: true,
		contentTypes: new Set(contentTypes),
		useMarkers: true,
		markerFormat: 'jsonMeta',
		markers: DEFAULT_MARKERS_JSON_META,
		toolInputDisplay: 'truncated',
		toolResultDisplay: 'truncated',
		truncationLimit: 500,
		toolFilter: {
			mode: 'all',
			categories: new Set(),
			specificTools: new Set(),
		},
		...overrides,
	});

	beforeEach(() => {
		mockSendChunk = vi.fn();
	});

	it('should stream SDK message when "all" is enabled', () => {
		const config = createConfig(['all']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'assistant',
			message: { content: [{ type: 'text', text: 'Hello' }] },
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		// In markers mode, should be JSON string
		expect(call[2]).toContain('"type":"assistant"');
	});

	it('should stream SDK message when specific type is enabled', () => {
		const config = createConfig(['assistant']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'assistant',
			message: { content: [{ type: 'text', text: 'Hello' }] },
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).toHaveBeenCalled();
	});

	it('should not stream SDK message when type is not enabled', () => {
		const config = createConfig(['user']); // Only user enabled, not assistant
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'assistant',
			message: { content: [{ type: 'text', text: 'Hello' }] },
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).not.toHaveBeenCalled();
	});

	it('should stream SDK message with type:subtype match', () => {
		const config = createConfig(['system:init' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'system',
			subtype: 'init',
			session_id: 'test-123',
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).toHaveBeenCalled();
	});

	it('should stream api_retry system subtype when selected', () => {
		const config = createConfig(['system:api_retry' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'system',
			subtype: 'api_retry',
			error: 'overloaded',
			error_status: 529,
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		expect(call[2]).toContain('"error":"overloaded"');
	});

	it('should stream current Task tools under the agent tool category', () => {
		const config = createConfig(['toolCalls'], {
			useMarkers: false,
			toolFilter: {
				mode: 'categories',
				categories: new Set(['agent']),
				specificTools: new Set(),
			},
		});
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamToolCall('TaskCreate', 'toolu_task_create', { id: 'task-1' });

		expect(mockSendChunk).toHaveBeenCalledWith(
			'item',
			0,
			expect.objectContaining({
				type: 'tool_call',
				name: 'TaskCreate',
			}),
		);
	});

	it('should not stream system message when only specific subtype is enabled', () => {
		const config = createConfig(['system:init' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'system',
			subtype: 'status', // Different subtype
			status: 'compacting',
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).not.toHaveBeenCalled();
	});

	it('should stream all system subtypes when "system" type is enabled', () => {
		const config = createConfig(['system' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const initMessage: SDKMessage = { type: 'system', subtype: 'init' };
		const statusMessage: SDKMessage = { type: 'system', subtype: 'status' };

		handler.streamMessage(initMessage);
		handler.streamMessage(statusMessage);

		expect(mockSendChunk).toHaveBeenCalledTimes(2);
	});

	it('should stream result message verbatim', () => {
		const config = createConfig(['result' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'result',
			subtype: 'success',
			total_cost_usd: 0.05,
			usage: { input_tokens: 100, output_tokens: 50 },
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		expect(call[2]).toContain('"type":"result"');
		expect(call[2]).toContain('"total_cost_usd":0.05');
	});

	it('should stream stream_event verbatim when enabled', () => {
		const config = createConfig(['stream_event' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'stream_event',
			event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).toHaveBeenCalled();
	});

	it('should stream tool_progress verbatim when enabled', () => {
		const config = createConfig(['tool_progress' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		const sdkMessage: SDKMessage = {
			type: 'tool_progress',
			tool_use_id: 'tool-123',
			tool_name: 'Bash',
			parent_tool_use_id: null,
			elapsed_time_seconds: 1,
		};

		handler.streamMessage(sdkMessage);

		expect(mockSendChunk).toHaveBeenCalled();
	});

	it('shouldStreamMessage returns correct values', () => {
		const config = createConfig(['assistant', 'result' as StreamContentType, 'system:init' as StreamContentType]);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		expect(handler.shouldStreamMessage({ type: 'assistant' })).toBe(true);
		expect(handler.shouldStreamMessage({ type: 'result' })).toBe(true);
		expect(handler.shouldStreamMessage({ type: 'system', subtype: 'init' })).toBe(true);
		expect(handler.shouldStreamMessage({ type: 'system', subtype: 'status' })).toBe(false);
		expect(handler.shouldStreamMessage({ type: 'user' })).toBe(false);
	});
});
