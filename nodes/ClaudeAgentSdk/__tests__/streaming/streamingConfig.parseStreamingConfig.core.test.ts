/**
 * Streaming Configuration Tests - parseStreamingConfig (core)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import {
	parseStreamingConfig,
	DEFAULT_MARKERS_JSON_META,
	DEFAULT_MARKERS_SIMPLE,
} from '../../streaming';

describe('Streaming Configuration', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockExec = mock<IExecuteFunctions>();
	});

	const buildStreamingOptions = (overrides: Record<string, unknown> = {}) => ({
		enableStreaming: false,
		useMarkers: false,
		streamingContentTypes: ['text', 'todos', 'structuredOutput'],
		streamingMarkerFormat: 'jsonMeta',
		displaySettings: {
			settings: {
				streamingToolInputDisplay: 'truncated',
				streamingToolResultDisplay: 'truncated',
				streamingTruncationLimit: 500,
			},
		},
		toolFiltering: {
			settings: {
				streamingToolFilter: 'all',
				streamingToolCategories: [],
				streamingSpecificTools: '',
			},
		},
		customMarkers: {
			markers: {},
		},
		...overrides,
	});

	describe('parseStreamingConfig', () => {
		describe('enabled state', () => {
			it('should parse enabled=true correctly', () => {
				const streamingOptions = buildStreamingOptions({
					enableStreaming: true,
					streamingContentTypes: ['text'],
					streamingMarkerFormat: 'jsonMeta',
					displaySettings: {
						settings: {
							streamingToolInputDisplay: 'truncated',
							streamingToolResultDisplay: 'truncated',
							streamingTruncationLimit: 500,
						},
					},
				});

				mockExec.getNodeParameter.mockImplementation((name: string) => {
					if (name === 'streamingOptions') return streamingOptions;
					return undefined;
				});

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.enabled).toBe(true);
			});

			it('should parse enabled=false correctly', () => {
				const streamingOptions = buildStreamingOptions({
					enableStreaming: false,
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.enabled).toBe(false);
			});

			it('should default to enabled=false when not set', () => {
				const streamingOptions = buildStreamingOptions({
					enableStreaming: undefined,
				});

				mockExec.getNodeParameter.mockImplementation(
					(_name: string, _idx: number, defaultValue?: unknown) => {
						if (_name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.enabled).toBe(false);
			});
		});

		describe('useMarkers setting', () => {
			it('should parse useMarkers=true correctly', () => {
				const streamingOptions = buildStreamingOptions({
					useMarkers: true,
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.useMarkers).toBe(true);
			});

			it('should parse useMarkers=false correctly', () => {
				const streamingOptions = buildStreamingOptions({
					useMarkers: false,
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.useMarkers).toBe(false);
			});

			it('should default to useMarkers=false when not set', () => {
				const streamingOptions = buildStreamingOptions({
					useMarkers: undefined,
				});

				mockExec.getNodeParameter.mockImplementation(
					(_name: string, _idx: number, defaultValue?: unknown) => {
						if (_name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.useMarkers).toBe(false);
			});
		});

		describe('content types', () => {
			it('should parse single content type', () => {
				const streamingOptions = buildStreamingOptions({
					streamingContentTypes: ['text'],
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.contentTypes.has('text')).toBe(true);
				expect(config.contentTypes.size).toBe(1);
			});

			it('should parse multiple content types', () => {
				const streamingOptions = buildStreamingOptions({
					streamingContentTypes: ['text', 'toolCalls', 'toolResults', 'todos'],
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.contentTypes.has('text')).toBe(true);
				expect(config.contentTypes.has('toolCalls')).toBe(true);
				expect(config.contentTypes.has('toolResults')).toBe(true);
				expect(config.contentTypes.has('todos')).toBe(true);
				expect(config.contentTypes.size).toBe(4);
			});

			it('should parse all content types', () => {
				const allTypes = [
					'text',
					'toolCalls',
					'toolResults',
					'subagentLifecycle',
					'subagentMessages',
					'todos',
					'structuredOutputDelta',
					'structuredOutput',
					'allJson',
				];

				const streamingOptions = buildStreamingOptions({
					streamingContentTypes: allTypes,
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.contentTypes.size).toBe(9);
				allTypes.forEach((type) => {
					expect(config.contentTypes.has(type as any)).toBe(true);
				});
			});

			it('should use default content types when not specified', () => {
				const streamingOptions = buildStreamingOptions({
					streamingContentTypes: undefined,
				});

				mockExec.getNodeParameter.mockImplementation(
					(_name: string, _idx: number, defaultValue?: unknown) => {
						if (_name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				// New defaults: text and structuredOutput only (todos removed)
				expect(config.contentTypes.has('text')).toBe(true);
				expect(config.contentTypes.has('structuredOutput')).toBe(true);
				expect(config.contentTypes.has('todos')).toBe(false);
			});

			it('should handle empty content types array', () => {
				const streamingOptions = buildStreamingOptions({
					streamingContentTypes: [],
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.contentTypes.size).toBe(0);
			});
		});

		describe('marker formats', () => {
			it('should parse jsonMeta format with correct markers', () => {
				const streamingOptions = buildStreamingOptions({
					streamingMarkerFormat: 'jsonMeta',
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.markerFormat).toBe('jsonMeta');
				expect(config.markers).toEqual(DEFAULT_MARKERS_JSON_META);
			});

			it('should parse simple format with correct markers', () => {
				const streamingOptions = buildStreamingOptions({
					streamingMarkerFormat: 'simple',
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.markerFormat).toBe('simple');
				expect(config.markers).toEqual(DEFAULT_MARKERS_SIMPLE);
			});

			it('should parse custom format with custom markers', () => {
				const customMarkers = {
					toolCallStart: '>>> TOOL: {name} <<<',
					toolCallEnd: '>>> /TOOL <<<',
					toolResultStart: '>>> RESULT: {name} <<<',
					toolResultEnd: '>>> /RESULT <<<',
					subagentStart: '>>> AGENT: {name} <<<',
					subagentEnd: '>>> /AGENT <<<',
					subagentMsgStart: '>>> MSG: {name} <<<',
					subagentMsgEnd: '>>> /MSG <<<',
					todoStart: '>>> TODO <<<',
					todoEnd: '>>> /TODO <<<',
					jsonMsgStart: '>>> JSON: {type} <<<',
					jsonMsgEnd: '>>> /JSON <<<',
				};

				const streamingOptions = buildStreamingOptions({
					streamingMarkerFormat: 'custom',
					customMarkers: {
						markers: {
							streamingToolCallStartMarker: customMarkers.toolCallStart,
							streamingToolCallEndMarker: customMarkers.toolCallEnd,
							streamingToolResultStartMarker: customMarkers.toolResultStart,
							streamingToolResultEndMarker: customMarkers.toolResultEnd,
							streamingSubagentStartMarker: customMarkers.subagentStart,
							streamingSubagentEndMarker: customMarkers.subagentEnd,
							streamingSubagentMsgStartMarker: customMarkers.subagentMsgStart,
							streamingSubagentMsgEndMarker: customMarkers.subagentMsgEnd,
							streamingTodoStartMarker: customMarkers.todoStart,
							streamingTodoEndMarker: customMarkers.todoEnd,
							streamingJsonMsgStartMarker: customMarkers.jsonMsgStart,
							streamingJsonMsgEndMarker: customMarkers.jsonMsgEnd,
						},
					},
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.markerFormat).toBe('custom');
				expect(config.markers.toolCallStart).toBe(customMarkers.toolCallStart);
				expect(config.markers.toolCallEnd).toBe(customMarkers.toolCallEnd);
				expect(config.markers.subagentStart).toBe(customMarkers.subagentStart);
				expect(config.markers.todoStart).toBe(customMarkers.todoStart);
			});

			it('should use simple defaults for missing custom markers', () => {
				const streamingOptions = buildStreamingOptions({
					streamingMarkerFormat: 'custom',
					customMarkers: {
						markers: {
							streamingToolCallStartMarker: '[[TOOL:{name}]]',
						},
					},
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.markers.toolCallStart).toBe('[[TOOL:{name}]]');
				expect(config.markers.toolCallEnd).toBe(DEFAULT_MARKERS_SIMPLE.toolCallEnd);
			});
		});
	});
});
