/**
 * Streaming Configuration Tests - parseStreamingConfig (display + limits)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { parseStreamingConfig } from '../../streaming';

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
		describe('tool input display', () => {
			it('should parse full display mode', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolInputDisplay: 'full' } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolInputDisplay).toBe('full');
			});

			it('should parse truncated display mode', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolInputDisplay: 'truncated' } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolInputDisplay).toBe('truncated');
			});

			it('should parse nameOnly display mode', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolInputDisplay: 'nameOnly' } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolInputDisplay).toBe('nameOnly');
			});

			it('should default to truncated', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolInputDisplay: undefined } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(_name: string, _idx: number, defaultValue?: unknown) => {
						if (_name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolInputDisplay).toBe('truncated');
			});
		});

		describe('tool result display', () => {
			it('should parse full display mode', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolResultDisplay: 'full' } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolResultDisplay).toBe('full');
			});

			it('should parse truncated display mode', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolResultDisplay: 'truncated' } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolResultDisplay).toBe('truncated');
			});

			it('should parse summary display mode', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolResultDisplay: 'summary' } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolResultDisplay).toBe('summary');
			});

			it('should default to truncated', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingToolResultDisplay: undefined } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(_name: string, _idx: number, defaultValue?: unknown) => {
						if (_name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.toolResultDisplay).toBe('truncated');
			});
		});

		describe('truncation limit', () => {
			it('should parse custom truncation limit', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingTruncationLimit: 1000 } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.truncationLimit).toBe(1000);
			});

			it('should default to 500', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingTruncationLimit: undefined } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(_name: string, _idx: number, defaultValue?: unknown) => {
						if (_name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.truncationLimit).toBe(500);
			});

			it('should handle small truncation limit', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingTruncationLimit: 10 } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.truncationLimit).toBe(10);
			});

			it('should handle large truncation limit', () => {
				const streamingOptions = buildStreamingOptions({
					displaySettings: { settings: { streamingTruncationLimit: 100000 } },
				});

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _idx: number, defaultValue?: unknown) => {
						if (name === 'streamingOptions') return streamingOptions;
						return defaultValue;
					},
				);

				const config = parseStreamingConfig(mockExec, 0);
				expect(config.truncationLimit).toBe(100000);
			});
		});

		describe('itemIndex handling', () => {
			it('should pass correct itemIndex to getNodeParameter', () => {
				mockExec.getNodeParameter.mockImplementation(
					(_name: string, _idx: number, defaultValue?: unknown) => defaultValue,
				);

				parseStreamingConfig(mockExec, 5);

				// Verify itemIndex was passed correctly
				expect(mockExec.getNodeParameter).toHaveBeenCalledWith('streamingOptions', 5, {});
			});
		});
	});
});

