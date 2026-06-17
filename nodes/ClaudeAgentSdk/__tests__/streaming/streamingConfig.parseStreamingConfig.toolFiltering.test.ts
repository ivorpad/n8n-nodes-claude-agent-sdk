/**
 * Streaming Configuration Tests - parseStreamingConfig (enablement + tool filtering)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { parseStreamingConfig } from '../../streaming';

describe('parseStreamingConfig enablement and tool filtering', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockExec = mock<IExecuteFunctions>();
	});

	const buildStreamingOptions = (overrides: Record<string, unknown> = {}) => ({
		enableStreaming: false,
		useMarkers: false,
		streamingMarkerFormat: 'jsonMeta',
		displaySettings: {
			settings: {},
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

	const useParams = (params: Record<string, unknown>) => {
		mockExec.getNodeParameter.mockImplementation(
			(name: string, _idx: number, defaultValue?: unknown) => params[name] ?? defaultValue,
		);
	};

	it('enables streaming from the top-level toggle even when legacy collection toggle is false', () => {
		useParams({
			enableStreaming: true,
			streamingOptions: buildStreamingOptions({ enableStreaming: false }),
		});

		const config = parseStreamingConfig(mockExec, 0);

		expect(config.enabled).toBe(true);
	});

	it('keeps the legacy collection toggle as a backwards-compatible enablement source', () => {
		useParams({
			enableStreaming: false,
			streamingOptions: buildStreamingOptions({ enableStreaming: true }),
		});

		const config = parseStreamingConfig(mockExec, 0);

		expect(config.enabled).toBe(true);
	});

	it('falls back to legacy top-level content types when the collection does not define them', () => {
		useParams({
			streamingContentTypes: ['assistant', 'system:status'],
			streamingOptions: buildStreamingOptions({ streamingContentTypes: undefined }),
		});

		const config = parseStreamingConfig(mockExec, 0);

		expect([...config.contentTypes]).toEqual(['assistant', 'system:status']);
	});

	it('parses category tool filtering into selected categories only', () => {
		useParams({
			streamingOptions: buildStreamingOptions({
				toolFiltering: {
					settings: {
						streamingToolFilter: 'categories',
						streamingToolCategories: ['file', 'mcp'],
					},
				},
			}),
		});

		const config = parseStreamingConfig(mockExec, 0);

		expect(config.toolFilter.mode).toBe('categories');
		expect([...config.toolFilter.categories]).toEqual(['file', 'mcp']);
		expect(config.toolFilter.specificTools.size).toBe(0);
	});

	it('trims comma-separated specific tools and drops blank entries', () => {
		useParams({
			streamingOptions: buildStreamingOptions({
				toolFiltering: {
					settings: {
						streamingToolFilter: 'specific',
						streamingSpecificTools: ' Read, ,Bash, mcp__server__tool ',
					},
				},
			}),
		});

		const config = parseStreamingConfig(mockExec, 0);

		expect(config.toolFilter.mode).toBe('specific');
		expect(config.toolFilter.categories.size).toBe(0);
		expect([...config.toolFilter.specificTools]).toEqual(['Read', 'Bash', 'mcp__server__tool']);
	});

	it('defaults missing tool filtering settings to all tools', () => {
		useParams({
			streamingOptions: buildStreamingOptions({ toolFiltering: undefined }),
		});

		const config = parseStreamingConfig(mockExec, 0);

		expect(config.toolFilter.mode).toBe('all');
		expect(config.toolFilter.categories.size).toBe(0);
		expect(config.toolFilter.specificTools.size).toBe(0);
	});
});
