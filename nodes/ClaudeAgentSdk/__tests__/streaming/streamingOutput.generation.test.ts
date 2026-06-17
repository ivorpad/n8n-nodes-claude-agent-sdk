/**
 * Streaming Output Tests - StreamingHandler output generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	StreamingHandler,
	DEFAULT_MARKERS_JSON_META,
	DEFAULT_MARKERS_SIMPLE,
} from '../../streaming';
import type { StreamingConfig, StreamContentType } from '../../streaming';

describe('StreamingHandler Output Generation', () => {
	let mockSendChunk: ReturnType<typeof vi.fn>;

	const createConfig = (
		contentTypes: StreamContentType[] = ['text'],
		overrides: Partial<StreamingConfig> = {},
	): StreamingConfig => ({
		enabled: true,
		contentTypes: new Set(contentTypes),
		useMarkers: true, // Markers mode for these tests (testing marker output format)
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

	describe('Tool Call Output with Different Display Modes', () => {
		it('should output full tool input when toolInputDisplay=full', () => {
			const config = createConfig(['toolCalls'], { toolInputDisplay: 'full' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const largeInput = { file_path: '/very/long/path'.repeat(100) };
			handler.streamToolCall('Read', 'tool-1', largeInput);

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain(JSON.stringify(largeInput));
		});

		it('should truncate tool input when toolInputDisplay=truncated', () => {
			const config = createConfig(['toolCalls'], {
				toolInputDisplay: 'truncated',
				truncationLimit: 50,
			});
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const largeInput = { file_path: '/very/long/path'.repeat(100) };
			handler.streamToolCall('Read', 'tool-1', largeInput);

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('...');
			expect(call[2].length).toBeLessThan(JSON.stringify(largeInput).length + 100);
		});

		it('should output no input when toolInputDisplay=nameOnly', () => {
			const config = createConfig(['toolCalls'], { toolInputDisplay: 'nameOnly' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-1', { file_path: '/test.ts' });

			const call = mockSendChunk.mock.calls[0];
			// Should have markers but no content between them
			expect(call[2]).toContain('[TOOL_CALL:');
			expect(call[2]).toContain('[/TOOL_CALL]');
			expect(call[2]).not.toContain('file_path');
		});
	});

	describe('Tool Result Output with Different Display Modes', () => {
		it('should output full result when toolResultDisplay=full', () => {
			const config = createConfig(['toolResults'], { toolResultDisplay: 'full' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const largeResult = 'x'.repeat(1000);
			handler.streamToolResult('Read', 'tool-1', largeResult, true);

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain(largeResult);
		});

		it('should truncate result when toolResultDisplay=truncated', () => {
			const config = createConfig(['toolResults'], {
				toolResultDisplay: 'truncated',
				truncationLimit: 50,
			});
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const largeResult = 'x'.repeat(1000);
			handler.streamToolResult('Read', 'tool-1', largeResult, true);

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('...');
			expect(call[2].length).toBeLessThan(largeResult.length + 100);
		});

		it('should output no content when toolResultDisplay=summary', () => {
			const config = createConfig(['toolResults'], { toolResultDisplay: 'summary' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolResult('Read', 'tool-1', 'large content here', true);

			const call = mockSendChunk.mock.calls[0];
			// Should have markers but no content between them
			expect(call[2]).toContain('[TOOL_RESULT:');
			expect(call[2]).toContain('[/TOOL_RESULT]');
			expect(call[2]).not.toContain('large content here');
		});

		it('should include success status in marker', () => {
			const config = createConfig(['toolResults'], { toolResultDisplay: 'summary' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolResult('Read', 'tool-1', 'result', true);

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('"success":true');
		});

		it('should include failure status in marker', () => {
			const config = createConfig(['toolResults'], { toolResultDisplay: 'summary' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolResult('Read', 'tool-1', 'error', false);

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('"success":false');
		});
	});

	describe('Marker Format Output', () => {
		it('should use jsonMeta markers by default', () => {
			const config = createConfig(['toolCalls'], { markerFormat: 'jsonMeta' });
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-123', { file: 'test.ts' });

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('[TOOL_CALL:{"name":"Read","id":"tool-123"}]');
		});

		it('should use simple markers when configured', () => {
			const config = createConfig(['toolCalls'], {
				markerFormat: 'simple',
				markers: DEFAULT_MARKERS_SIMPLE,
			});
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-123', { file: 'test.ts' });

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('[TOOL_CALL:Read]');
		});

		it('should use custom markers when configured', () => {
			const customMarkers = {
				...DEFAULT_MARKERS_SIMPLE,
				toolCallStart: '>>> TOOL: {name} <<<',
				toolCallEnd: '<<< /TOOL >>>',
			};
			const config = createConfig(['toolCalls'], {
				markerFormat: 'custom',
				markers: customMarkers,
			});
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamToolCall('Read', 'tool-123', { file: 'test.ts' });

			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('>>> TOOL: Read <<<');
			expect(call[2]).toContain('<<< /TOOL >>>');
		});
	});

	describe('Content Type Filtering', () => {
		it('should only stream enabled content types', () => {
			const config = createConfig(['text']); // Only text enabled
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamText('Hello', null);
			expect(mockSendChunk).toHaveBeenCalled();

			mockSendChunk.mockClear();
			handler.streamToolCall('Read', 'tool-1', {});
			expect(mockSendChunk).not.toHaveBeenCalled();

			mockSendChunk.mockClear();
			handler.streamToolResult('Read', 'tool-1', 'result', true);
			expect(mockSendChunk).not.toHaveBeenCalled();
		});

		it('should stream all enabled content types', () => {
			const config = createConfig(['text', 'toolCalls', 'toolResults']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamText('Hello', null);
			expect(mockSendChunk).toHaveBeenCalledTimes(1);

			handler.streamToolCall('Read', 'tool-1', {});
			expect(mockSendChunk).toHaveBeenCalledTimes(2);

			handler.streamToolResult('Read', 'tool-1', 'result', true);
			expect(mockSendChunk).toHaveBeenCalledTimes(3);
		});

		it('should not stream anything when content types are empty', () => {
			const config = createConfig([]); // No content types enabled
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamText('Hello', null);
			handler.streamToolCall('Read', 'tool-1', {});
			handler.streamToolResult('Read', 'tool-1', 'result', true);
			handler.streamTodo([{ task: 'test', status: 'pending' }]);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('Subagent Streaming', () => {
		it('should track subagent lifecycle', () => {
			const config = createConfig(['subagentLifecycle', 'subagentMessages']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamSubagentLifecycle('start', 'CodeReviewer', 'tool-123');
			expect(mockSendChunk).toHaveBeenCalled();

			const startCall = mockSendChunk.mock.calls[0];
			expect(startCall[2]).toContain('CodeReviewer');
			expect(startCall[2]).toContain('SUBAGENT_START');

			mockSendChunk.mockClear();
			handler.streamSubagentLifecycle('end', 'CodeReviewer', 'tool-123');
			const endCall = mockSendChunk.mock.calls[0];
			expect(endCall[2]).toContain('SUBAGENT_END');
		});

		it('should attribute text to correct subagent', () => {
			const config = createConfig(['subagentMessages', 'subagentLifecycle']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			// Start subagent
			handler.streamSubagentLifecycle('start', 'TestAgent', 'tool-123');
			mockSendChunk.mockClear();

			// Stream text from subagent
			handler.streamText('Subagent response', 'tool-123');

			expect(mockSendChunk).toHaveBeenCalled();
			// First call should be subagent message start marker
			const firstCall = mockSendChunk.mock.calls[0];
			expect(firstCall[2]).toContain('TestAgent');
		});

		it('should not stream subagent messages when disabled', () => {
			const config = createConfig(['text']); // Only main text, no subagent
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamText('Subagent response', 'tool-123');

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('Todo Streaming', () => {
		it('should stream todo updates when enabled', () => {
			const config = createConfig(['todos']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const todos = [
				{ task: 'First task', status: 'completed' },
				{ task: 'Second task', status: 'in_progress' },
			];

			handler.streamTodo(todos);

			expect(mockSendChunk).toHaveBeenCalled();
			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('TODO');
			expect(call[2]).toContain('First task');
			expect(call[2]).toContain('Second task');
		});

		it('should not stream todos when disabled', () => {
			const config = createConfig(['text']); // No todos
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamTodo([{ task: 'test', status: 'pending' }]);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('JSON Message Streaming', () => {
		it('should stream full JSON when allJson enabled', () => {
			const config = createConfig(['allJson']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const message = {
				type: 'assistant',
				text: 'Hello world',
				model: 'claude-opus-4-5-20251101',
			};

			handler.streamJsonMessage(message);

			expect(mockSendChunk).toHaveBeenCalled();
			const call = mockSendChunk.mock.calls[0];
			expect(call[2]).toContain('"type":"assistant"');
			expect(call[2]).toContain('"text":"Hello world"');
		});

		it('should not stream JSON when allJson disabled', () => {
			const config = createConfig(['text']); // No allJson
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamJsonMessage({ type: 'test' });

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});

	describe('Structured Output Streaming', () => {
		it('should stream structured output when enabled', () => {
			const config = createConfig(['structuredOutput']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			const output = { name: 'Result', value: 42, items: ['a', 'b', 'c'] };
			handler.streamStructuredOutput(output);

			expect(mockSendChunk).toHaveBeenCalled();
			const call = mockSendChunk.mock.calls[0];
			const parsed = JSON.parse(call[2] as string);
			expect(parsed.type).toBe('structured_output');
			expect(parsed.content).toEqual(output);
		});

		it('should not stream structured output when disabled', () => {
			const config = createConfig(['text']); // No structuredOutput
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamStructuredOutput({ result: 'test' });

			expect(mockSendChunk).not.toHaveBeenCalled();
		});

		it('should stream structured output delta when enabled', () => {
			const config = createConfig(['structuredOutputDelta']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamStructuredOutputDelta('{"items":[', 5);

			expect(mockSendChunk).toHaveBeenCalledOnce();
			const payload = JSON.parse(mockSendChunk.mock.calls[0][2] as string) as Record<string, unknown>;
			expect(payload.type).toBe('structured_output_delta');
			expect(payload.delta).toBe('{"items":[');
			expect(payload.sequence).toBe(1);
			expect(payload.contentBlockIndex).toBe(5);
		});

		it('should not stream structured output delta when disabled', () => {
			const config = createConfig(['structuredOutput']);
			const handler = new StreamingHandler(config, mockSendChunk, 0);

			handler.streamStructuredOutputDelta('{"items":[', 5);

			expect(mockSendChunk).not.toHaveBeenCalled();
		});
	});
});
