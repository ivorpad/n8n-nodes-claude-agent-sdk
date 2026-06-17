/**
 * StreamingHandler JSON mode tests (useMarkers: false)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingHandler } from '../../streaming/StreamingHandler';
import type { StreamingConfig, StreamContentType } from '../../streaming/types';
import { DEFAULT_MARKERS_JSON_META } from '../../streaming/types';

describe('StreamingHandler - JSON Mode (useMarkers: false)', () => {
	let mockSendChunk: ReturnType<typeof vi.fn>;

	const createJsonConfig = (
		contentTypes: StreamContentType[] = ['text'],
		overrides: Partial<StreamingConfig> = {},
	): StreamingConfig => ({
		enabled: true,
		contentTypes: new Set(contentTypes),
		useMarkers: false, // JSON mode
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

	it('should stream tool call as JSON object', () => {
		const config = createJsonConfig(['toolCalls']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamToolCall('Read', 'tool-123', { file_path: '/test.ts' });

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('tool_call');
		expect(content.name).toBe('Read');
		expect(content.id).toBe('tool-123');
	});

	it('should stream tool result as JSON object', () => {
		const config = createJsonConfig(['toolResults']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamToolResult('Read', 'tool-123', 'file contents', true);

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('tool_result');
		expect(content.name).toBe('Read');
		expect(content.id).toBe('tool-123');
		expect(content.success).toBe(true);
		expect(content.result).toBe('file contents');
	});

	it('should stream subagent start as JSON object', () => {
		const config = createJsonConfig(['subagentLifecycle']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamSubagentLifecycle('start', 'CodeReviewer', 'tool-123');

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('subagent_start');
		expect(content.name).toBe('CodeReviewer');
		expect(content.id).toBe('tool-123');
	});

	it('should stream subagent end as JSON object', () => {
		const config = createJsonConfig(['subagentLifecycle']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamSubagentLifecycle('start', 'CodeReviewer', 'tool-123');
		mockSendChunk.mockClear();
		handler.streamSubagentLifecycle('end', 'CodeReviewer', 'tool-123');

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('subagent_end');
		expect(content.name).toBe('CodeReviewer');
		expect(content.id).toBe('tool-123');
	});

	it('should stream todo as JSON object', () => {
		const config = createJsonConfig(['todos']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamTodo([{ task: 'Test', status: 'pending' }]);

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('todo_update');
		expect(content.todos).toEqual([{ task: 'Test', status: 'pending' }]);
	});

	it('should stream user message as JSON object', () => {
		const config = createJsonConfig(['userMessages']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamUserMessage('Hello there');

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('user_message');
		expect(content.text).toBe('Hello there');
	});

	it('should stream structured output delta as JSON object', () => {
		const config = createJsonConfig(['structuredOutputDelta']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamStructuredOutputDelta('{"result":"par', 7);

		expect(mockSendChunk).toHaveBeenCalledOnce();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('structured_output_delta');
		expect(content.delta).toBe('{"result":"par');
		expect(content.sequence).toBe(1);
		expect(content.contentBlockIndex).toBe(7);
	});

	it('should stream JSON message as wrapped JSON object', () => {
		const config = createJsonConfig(['allJson']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamJsonMessage({ type: 'text', text: 'hello' });

		expect(mockSendChunk).toHaveBeenCalled();
		const call = mockSendChunk.mock.calls[0];
		const content = call[2] as Record<string, unknown>;
		expect(content.type).toBe('json_message');
		expect(content.messageType).toBe('text');
		expect((content.message as Record<string, unknown>).text).toBe('hello');
	});

	it('should stream plain text without markers', () => {
		const config = createJsonConfig(['text']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamText('Hello world', null);

		expect(mockSendChunk).toHaveBeenCalledWith('item', 0, 'Hello world');
	});

	it('should not use marker blocks for subagent text', () => {
		const config = createJsonConfig(['subagentMessages', 'subagentLifecycle']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamSubagentLifecycle('start', 'TestAgent', 'tool-123');
		mockSendChunk.mockClear();

		handler.streamText('Subagent message', 'tool-123');

		expect(mockSendChunk).toHaveBeenCalledWith('item', 0, 'Subagent message');
	});

	it('finalize should not emit anything in JSON mode', () => {
		const config = createJsonConfig(['subagentMessages', 'subagentLifecycle']);
		const handler = new StreamingHandler(config, mockSendChunk, 0);

		handler.streamSubagentLifecycle('start', 'TestAgent', 'tool-123');
		handler.streamText('Some text', 'tool-123');

		mockSendChunk.mockClear();

		handler.finalize();

		expect(mockSendChunk).not.toHaveBeenCalled();
	});
});
