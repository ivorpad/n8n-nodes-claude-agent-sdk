/**
 * StreamingHandler Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	StreamingHandler,
	interpolateMarker,
	getMarkersForFormat,
} from '../../streaming/StreamingHandler';
import type { StreamingConfig, StreamContentType } from '../../streaming/types';
import {
	DEFAULT_MARKERS_JSON_META,
	DEFAULT_MARKERS_SIMPLE,
} from '../../streaming/types';

describe('StreamingHandler', () => {
	// Mock sendChunk function
	let mockSendChunk: ReturnType<typeof vi.fn>;

	const createConfig = (
		contentTypes: StreamContentType[] = ['text'],
		overrides: Partial<StreamingConfig> = {},
	): StreamingConfig => ({
		enabled: true,
		contentTypes: new Set(contentTypes),
		useMarkers: true, // Markers mode for these tests (JSON mode tests are in separate describe block)
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

	describe('interpolateMarker', () => {
		it('should replace {name} placeholder', () => {
			const result = interpolateMarker('Agent: {name}', { name: 'TestAgent' });
			expect(result).toBe('Agent: TestAgent');
		});

		it('should replace {id} placeholder', () => {
			const result = interpolateMarker('ID: {id}', { id: 'tool-123' });
			expect(result).toBe('ID: tool-123');
		});

		it('should replace {type} placeholder', () => {
			const result = interpolateMarker('Type: {type}', { type: 'text' });
			expect(result).toBe('Type: text');
		});

		it('should replace {subtype} placeholder', () => {
			const result = interpolateMarker('Subtype: {subtype}', { subtype: 'init' });
			expect(result).toBe('Subtype: init');
		});

		it('should replace {success} placeholder with boolean', () => {
			const result = interpolateMarker('Success: {success}', { success: true });
			expect(result).toBe('Success: true');
		});

		it('should replace multiple placeholders', () => {
			const result = interpolateMarker('{name} ({id}): {type}', {
				name: 'Read',
				id: '123',
				type: 'tool_use',
			});
			expect(result).toBe('Read (123): tool_use');
		});

		it('should replace missing values with empty string', () => {
			const result = interpolateMarker('Name: {name}', {});
			expect(result).toBe('Name: ');
		});
	});

	describe('getMarkersForFormat', () => {
		it('should return jsonMeta markers for jsonMeta format', () => {
			const markers = getMarkersForFormat('jsonMeta');
			expect(markers).toEqual(DEFAULT_MARKERS_JSON_META);
		});

		it('should return simple markers for simple format', () => {
			const markers = getMarkersForFormat('simple');
			expect(markers).toEqual(DEFAULT_MARKERS_SIMPLE);
		});

		it('should merge custom markers for custom format', () => {
			const customMarkers = { toolCallStart: '>>> TOOL: ' };
			const markers = getMarkersForFormat('custom', customMarkers);

			expect(markers.toolCallStart).toBe('>>> TOOL: ');
			// Other markers should be from simple defaults
			expect(markers.toolCallEnd).toBe(DEFAULT_MARKERS_SIMPLE.toolCallEnd);
		});

		it('should default to jsonMeta for unknown format', () => {
			const markers = getMarkersForFormat('unknown' as any);
			expect(markers).toEqual(DEFAULT_MARKERS_JSON_META);
		});
	});

	describe('StreamingHandler.shouldStream', () => {
		it('should return true for enabled content types', () => {
			const config = createConfig(['text', 'toolCalls']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			expect(handler.shouldStream('text')).toBe(true);
			expect(handler.shouldStream('toolCalls')).toBe(true);
		});

		it('should return false for disabled content types', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			expect(handler.shouldStream('toolCalls')).toBe(false);
			expect(handler.shouldStream('toolResults')).toBe(false);
		});
	});

	describe('StreamingHandler.streamText', () => {
		it('should stream main agent text when enabled', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamText('Hello world', null);

			expect(mockSendChunk).toHaveBeenCalledWith('item', 0, 'Hello world');
		});

		it('should not stream main agent text when disabled', () => {
			const config = createConfig(['toolCalls']); // text not enabled
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamText('Hello world', null);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});

		it('should stream subagent text when subagentMessages enabled', () => {
			const config = createConfig(['subagentMessages', 'subagentLifecycle']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			// First register the subagent
			handler.streamSubagentLifecycle('start', 'TestAgent', 'tool-123');

			// Then stream subagent text
			handler.streamText('Subagent message', 'tool-123');

			// Should have sent subagent start and text
			expect(mockSendChunk).toHaveBeenCalled();
		});

		it('should not stream subagent text when subagentMessages disabled', () => {
			const config = createConfig(['text']); // only main text
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamText('Subagent message', 'tool-123');

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('StreamingHandler.streamToolCall', () => {
		it('should stream tool call when enabled', () => {
			const config = createConfig(['toolCalls']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-123', { file_path: '/test.ts' });

			expect(mockSendChunk).toHaveBeenCalled();
			const call = mockSendChunk.mock.calls[0];
			expect(call[0]).toBe('item');
			expect(call[2]).toContain('Read');
		});

		it('should not stream tool call when disabled', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-123', { file_path: '/test.ts' });

			expect(mockSendChunk).not.toHaveBeenCalled();
		});

		it('should show full input when toolInputDisplay is full', () => {
			const config = createConfig(['toolCalls'], { toolInputDisplay: 'full' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-123', { file_path: '/test.ts' });

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('file_path');
		});

		it('should show no input when toolInputDisplay is nameOnly', () => {
			const config = createConfig(['toolCalls'], { toolInputDisplay: 'nameOnly' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-123', { file_path: '/test.ts' });

			const call = mockSendChunk.mock.calls[0];
			// Content between markers should be empty
			expect(call[2]).not.toContain('file_path');
		});
	});

	describe('StreamingHandler.streamToolResult', () => {
		it('should stream tool result when enabled', () => {
			const config = createConfig(['toolResults']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolResult('Read', 'tool-123', 'file contents', true);

			expect(mockSendChunk).toHaveBeenCalled();
		});

		it('should not stream tool result when disabled', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolResult('Read', 'tool-123', 'file contents', true);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});

		it('should show summary only when toolResultDisplay is summary', () => {
			const config = createConfig(['toolResults'], { toolResultDisplay: 'summary' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolResult('Read', 'tool-123', 'long file contents here', true);

			const call = mockSendChunk.mock.calls[0];
			// Content should not include the actual result
			expect(call[2]).not.toContain('long file contents');
		});
	});

	describe('StreamingHandler.streamSubagentLifecycle', () => {
		it('should stream subagent start when enabled', () => {
			const config = createConfig(['subagentLifecycle']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamSubagentLifecycle('start', 'CodeReviewer', 'tool-123');

			expect(mockSendChunk).toHaveBeenCalled();
			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('CodeReviewer');
		});

		it('should stream subagent end when enabled', () => {
			const config = createConfig(['subagentLifecycle']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			// Start first
			handler.streamSubagentLifecycle('start', 'CodeReviewer', 'tool-123');
			mockSendChunk.mockClear();

			// Then end
			handler.streamSubagentLifecycle('end', 'CodeReviewer', 'tool-123');

			expect(mockSendChunk).toHaveBeenCalled();
		});

		it('should not stream subagent lifecycle when disabled', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamSubagentLifecycle('start', 'CodeReviewer', 'tool-123');

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('StreamingHandler.streamTodo', () => {
		it('should stream todos when enabled', () => {
			const config = createConfig(['todos']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamTodo([{ task: 'Test', status: 'pending' }]);

			expect(mockSendChunk).toHaveBeenCalled();
		});

		it('should not stream todos when disabled', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamTodo([{ task: 'Test', status: 'pending' }]);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('StreamingHandler.streamJsonMessage', () => {
		it('should stream JSON message when allJson enabled', () => {
			const config = createConfig(['allJson']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamJsonMessage({ type: 'text', text: 'hello' });

			expect(mockSendChunk).toHaveBeenCalled();
			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('"type":"text"');
		});

		it('should not stream JSON message when allJson disabled', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamJsonMessage({ type: 'text', text: 'hello' });

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('StreamingHandler.streamStructuredOutput', () => {
		it('should stream structured output when enabled', () => {
			const config = createConfig(['structuredOutput']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamStructuredOutput({ name: 'Test', value: 42 });

			expect(mockSendChunk).toHaveBeenCalled();
			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('Test');
			expect(call[2]).toContain('42');
		});

		it('should not stream structured output when disabled', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamStructuredOutput({ name: 'Test', value: 42 });

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('StreamingHandler.streamStructuredOutputDelta', () => {
		it('should stream structured output delta when enabled', () => {
			const config = createConfig(['structuredOutputDelta']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamStructuredOutputDelta('{"result":"par', 3);

			expect(mockSendChunk).toHaveBeenCalledOnce();
			const payload = JSON.parse(mockSendChunk.mock.calls[0][2] as string) as Record<string, unknown>;
			expect(payload.type).toBe('structured_output_delta');
			expect(payload.delta).toBe('{"result":"par');
			expect(payload.sequence).toBe(1);
			expect(payload.contentBlockIndex).toBe(3);
		});

		it('should not stream structured output delta when disabled', () => {
			const config = createConfig(['structuredOutput']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamStructuredOutputDelta('{"result":"par', 1);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('StreamingHandler.handleStreamEvent', () => {
		it('should stream text from text_delta event', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_delta',
						index: 0,
						delta: { type: 'text_delta', text: 'Hello' },
					},
				},
				null,
			);

			expect(mockSendChunk).toHaveBeenCalledWith('item', 0, 'Hello');
		});

		it('should accumulate tool input from input_json_delta events', () => {
			const config = createConfig(['toolCalls']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			// Start tool use
			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_start',
						index: 0,
						content_block: { type: 'tool_use', id: 'tool-1', name: 'Read' },
					},
				},
				null,
			);

			// Send input deltas
			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_delta',
						index: 0,
						delta: { type: 'input_json_delta', partial_json: '{"file' },
					},
				},
				null,
			);

			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_delta',
						index: 0,
						delta: { type: 'input_json_delta', partial_json: '":"test.ts"}' },
					},
				},
				null,
			);

			// Complete block
			const result = handler.handleStreamEvent(
				{
					event: { type: 'content_block_stop', index: 0 },
				},
				null,
			);

			expect(result?.toolCallComplete).toBeDefined();
			expect(result?.toolCallComplete?.name).toBe('Read');
		});

		it('should stream structured output deltas from StructuredOutput input_json_delta', () => {
			const config = createConfig(['structuredOutputDelta']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_start',
						index: 2,
						content_block: { type: 'tool_use', id: 'tool-structured', name: 'StructuredOutput' },
					},
				},
				null,
			);

			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_delta',
						index: 2,
						delta: { type: 'input_json_delta', partial_json: '{"status":"ok"' },
					},
				},
				null,
			);

			expect(mockSendChunk).toHaveBeenCalledOnce();
			const payload = JSON.parse(mockSendChunk.mock.calls[0][2] as string) as Record<string, unknown>;
			expect(payload.type).toBe('structured_output_delta');
			expect(payload.delta).toBe('{"status":"ok"');
			expect(payload.sequence).toBe(1);
			expect(payload.contentBlockIndex).toBe(2);
		});

		it('should not stream structured output deltas for non-StructuredOutput tools', () => {
			const config = createConfig(['structuredOutputDelta']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_start',
						index: 4,
						content_block: { type: 'tool_use', id: 'tool-read', name: 'Read' },
					},
				},
				null,
			);

			handler.handleStreamEvent(
				{
					event: {
						type: 'content_block_delta',
						index: 4,
						delta: { type: 'input_json_delta', partial_json: '{"file":"test.ts"}' },
					},
				},
				null,
			);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});

		it('should ignore events without event field', () => {
			const config = createConfig(['text']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const result = handler.handleStreamEvent({}, null);

			expect(result).toBeUndefined();
			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('StreamingHandler.finalize', () => {
		it('should close open subagent message blocks', () => {
			const config = createConfig(['subagentMessages', 'subagentLifecycle']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			// Start subagent and send text
			handler.streamSubagentLifecycle('start', 'TestAgent', 'tool-123');
			handler.streamText('Some text', 'tool-123');

			mockSendChunk.mockClear();

			// Finalize should close the block
			handler.finalize();

			expect(mockSendChunk).toHaveBeenCalled();
		});
	});

	describe('StreamingHandler truncation', () => {
		it('should truncate content exceeding limit', () => {
			const config = createConfig(['toolCalls'], {
				toolInputDisplay: 'truncated',
				truncationLimit: 20,
			});
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-1', {
				file_path: '/very/long/path/to/some/file.ts',
			});

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('...');
		});
	});
});
