/**
 * Streaming Module
 *
 * Provides comprehensive streaming configuration for the ClaudeAgentSdk node.
 * Exports types, properties, and the StreamingHandler class.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import type {
	StreamingConfig,
	StreamContentType,
	MarkerFormat,
	ToolInputDisplay,
	ToolResultDisplay,
	StreamMarkers,
	ToolStreamFilterMode,
	ToolStreamCategory,
	ToolStreamFilter,
	SendChunkFn,
} from './types';
import {
	DEFAULT_MARKERS_JSON_META,
	DEFAULT_MARKERS_SIMPLE,
	DEFAULT_TOOL_STREAM_FILTER,
} from './types';

// Re-export types
export type { StreamingConfig, StreamContentType } from './types';

// Re-export default marker values
export { DEFAULT_MARKERS_JSON_META, DEFAULT_MARKERS_SIMPLE } from './types';

// Re-export handler
export { StreamingHandler, interpolateMarker } from './StreamingHandler';

// Request-scoped response storage (safe for current request streaming)
export {
	retrieveRequestResponse,
	clearRequestResponse,
	touchRequestResponse,
} from './ResponseStore';

export { createDurableSendChunk, flushDurableSendChunk } from './durableSendChunk';
export { createPostgresStreamStoreHandle } from './streamStoreFactory';
export type { StreamStoreHandle } from './streamStoreFactory';
export { buildDurableStreamKey } from './streamKey';
export * from './streamSchemas';
export * from './streamTypes';

/**
 * Parse streaming configuration from n8n node parameters
 */
function getParam<T>(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	name: string,
	defaultValue: T,
): T {
	const value = execFunctions.getNodeParameter(name, itemIndex, defaultValue as never) as
		| T
		| undefined;
	return (value ?? defaultValue) as T;
}

type StreamingDisplaySettings = {
	streamingToolInputDisplay?: ToolInputDisplay;
	streamingToolResultDisplay?: ToolResultDisplay;
	streamingTruncationLimit?: number;
};

type StreamingToolFilteringSettings = {
	streamingToolFilter?: ToolStreamFilterMode;
	streamingToolCategories?: ToolStreamCategory[];
	streamingSpecificTools?: string;
};

type StreamingCustomMarkers = {
	streamingToolCallStartMarker?: string;
	streamingToolCallEndMarker?: string;
	streamingToolResultStartMarker?: string;
	streamingToolResultEndMarker?: string;
	streamingSubagentStartMarker?: string;
	streamingSubagentEndMarker?: string;
	streamingSubagentMsgStartMarker?: string;
	streamingSubagentMsgEndMarker?: string;
	streamingTodoStartMarker?: string;
	streamingTodoEndMarker?: string;
	streamingUserMsgStartMarker?: string;
	streamingUserMsgEndMarker?: string;
	streamingJsonMsgStartMarker?: string;
	streamingJsonMsgEndMarker?: string;
};

type StreamingOptions = {
	enableStreaming?: boolean;
	useMarkers?: boolean;
	streamingContentTypes?: StreamContentType[];
	streamingMarkerFormat?: MarkerFormat;
	displaySettings?: { settings?: StreamingDisplaySettings };
	toolFiltering?: { settings?: StreamingToolFilteringSettings };
	customMarkers?: { markers?: StreamingCustomMarkers };
};

const CUSTOM_MARKER_FIELDS = {
	toolCallStart: 'streamingToolCallStartMarker',
	toolCallEnd: 'streamingToolCallEndMarker',
	toolResultStart: 'streamingToolResultStartMarker',
	toolResultEnd: 'streamingToolResultEndMarker',
	subagentStart: 'streamingSubagentStartMarker',
	subagentEnd: 'streamingSubagentEndMarker',
	subagentMsgStart: 'streamingSubagentMsgStartMarker',
	subagentMsgEnd: 'streamingSubagentMsgEndMarker',
	todoStart: 'streamingTodoStartMarker',
	todoEnd: 'streamingTodoEndMarker',
	userMsgStart: 'streamingUserMsgStartMarker',
	userMsgEnd: 'streamingUserMsgEndMarker',
	jsonMsgStart: 'streamingJsonMsgStartMarker',
	jsonMsgEnd: 'streamingJsonMsgEndMarker',
} satisfies Record<keyof StreamMarkers, keyof StreamingCustomMarkers>;

function readStreamingOptions(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): StreamingOptions {
	return getParam<StreamingOptions>(execFunctions, itemIndex, 'streamingOptions', {});
}

function parseStreamingEnabled(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	streamingOptions: StreamingOptions,
): boolean {
	const topLevelEnabled = getParam(execFunctions, itemIndex, 'enableStreaming', false);
	const legacyEnabled = streamingOptions.enableStreaming === true;
	return topLevelEnabled || legacyEnabled;
}

function parseContentTypes(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	streamingOptions: StreamingOptions,
): Set<StreamContentType> {
	const contentTypesArray =
		streamingOptions.streamingContentTypes ??
		getParam<StreamContentType[]>(execFunctions, itemIndex, 'streamingContentTypes', [
			'text',
			'structuredOutput',
		]);

	return new Set<StreamContentType>(contentTypesArray);
}

function parseMarkerFormat(streamingOptions: StreamingOptions): MarkerFormat {
	return streamingOptions.streamingMarkerFormat ?? 'jsonMeta';
}

function customMarkerValue(
	customMarkers: StreamingCustomMarkers,
	markerName: keyof StreamMarkers,
): string {
	const customMarkerField = CUSTOM_MARKER_FIELDS[markerName];
	return customMarkers[customMarkerField] ?? DEFAULT_MARKERS_SIMPLE[markerName];
}

function buildCustomMarkers(customMarkers: StreamingCustomMarkers): StreamMarkers {
	return {
		toolCallStart: customMarkerValue(customMarkers, 'toolCallStart'),
		toolCallEnd: customMarkerValue(customMarkers, 'toolCallEnd'),
		toolResultStart: customMarkerValue(customMarkers, 'toolResultStart'),
		toolResultEnd: customMarkerValue(customMarkers, 'toolResultEnd'),
		subagentStart: customMarkerValue(customMarkers, 'subagentStart'),
		subagentEnd: customMarkerValue(customMarkers, 'subagentEnd'),
		subagentMsgStart: customMarkerValue(customMarkers, 'subagentMsgStart'),
		subagentMsgEnd: customMarkerValue(customMarkers, 'subagentMsgEnd'),
		todoStart: customMarkerValue(customMarkers, 'todoStart'),
		todoEnd: customMarkerValue(customMarkers, 'todoEnd'),
		userMsgStart: customMarkerValue(customMarkers, 'userMsgStart'),
		userMsgEnd: customMarkerValue(customMarkers, 'userMsgEnd'),
		jsonMsgStart: customMarkerValue(customMarkers, 'jsonMsgStart'),
		jsonMsgEnd: customMarkerValue(customMarkers, 'jsonMsgEnd'),
	};
}

function parseMarkers(
	streamingOptions: StreamingOptions,
	markerFormat: MarkerFormat,
): StreamMarkers {
	if (markerFormat === 'jsonMeta') {
		return DEFAULT_MARKERS_JSON_META;
	}

	if (markerFormat === 'simple') {
		return DEFAULT_MARKERS_SIMPLE;
	}

	return buildCustomMarkers(streamingOptions.customMarkers?.markers ?? {});
}

function parseDisplayConfig(
	streamingOptions: StreamingOptions,
): Pick<StreamingConfig, 'toolInputDisplay' | 'toolResultDisplay' | 'truncationLimit'> {
	const displaySettings = streamingOptions.displaySettings?.settings ?? {};

	return {
		toolInputDisplay: displaySettings.streamingToolInputDisplay ?? 'truncated',
		toolResultDisplay: displaySettings.streamingToolResultDisplay ?? 'truncated',
		truncationLimit: displaySettings.streamingTruncationLimit ?? 500,
	};
}

function cloneToolStreamFilter(toolFilter: ToolStreamFilter): ToolStreamFilter {
	return {
		mode: toolFilter.mode,
		categories: new Set(toolFilter.categories),
		specificTools: new Set(toolFilter.specificTools),
	};
}

function parseCategoryToolFilter(toolFiltering: StreamingToolFilteringSettings): ToolStreamFilter {
	return {
		mode: 'categories',
		categories: new Set(toolFiltering.streamingToolCategories ?? []),
		specificTools: new Set<string>(),
	};
}

function parseSpecificToolFilter(toolFiltering: StreamingToolFilteringSettings): ToolStreamFilter {
	const specificTools = (toolFiltering.streamingSpecificTools ?? '')
		.split(',')
		.map((toolName) => toolName.trim())
		.filter(Boolean);

	return {
		mode: 'specific',
		categories: new Set<ToolStreamCategory>(),
		specificTools: new Set<string>(specificTools),
	};
}

function parseToolFilter(streamingOptions: StreamingOptions): ToolStreamFilter {
	const toolFiltering = streamingOptions.toolFiltering?.settings ?? {};
	const toolFilterMode = toolFiltering.streamingToolFilter ?? 'all';

	if (toolFilterMode === 'all') {
		return cloneToolStreamFilter(DEFAULT_TOOL_STREAM_FILTER);
	}

	if (toolFilterMode === 'categories') {
		return parseCategoryToolFilter(toolFiltering);
	}

	return parseSpecificToolFilter(toolFiltering);
}

export function parseStreamingConfig(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): StreamingConfig {
	const streamingOptions = readStreamingOptions(execFunctions, itemIndex);
	const markerFormat = parseMarkerFormat(streamingOptions);
	const displayConfig = parseDisplayConfig(streamingOptions);

	return {
		enabled: parseStreamingEnabled(execFunctions, itemIndex, streamingOptions),
		contentTypes: parseContentTypes(execFunctions, itemIndex, streamingOptions),
		useMarkers: streamingOptions.useMarkers ?? false,
		markerFormat,
		markers: parseMarkers(streamingOptions, markerFormat),
		...displayConfig,
		toolFilter: parseToolFilter(streamingOptions),
	};
}

/**
 * Check if streaming is available in the current execution context
 */
export function isStreamingAvailable(execFunctions: IExecuteFunctions): boolean {
	// n8n 2.x exposes isStreaming on the prototype (class method), not as an
	// own property — use `in` / typeof checks instead of hasOwnProperty.
	return (
		'isStreaming' in execFunctions &&
		typeof execFunctions.isStreaming === 'function' &&
		Boolean(execFunctions.isStreaming())
	);
}

/**
 * Get the sendChunk function from execution context
 * Note: n8n's sendChunk accepts objects which it serializes in the envelope.
 * We pass objects directly in JSON mode to avoid double-serialization.
 */
export function getSendChunkFn(execFunctions: IExecuteFunctions): SendChunkFn | undefined {
	// n8n 2.x exposes sendChunk on the prototype (class method) — `in` check
	// works for both own and inherited properties.
	if (!('sendChunk' in execFunctions) || typeof execFunctions.sendChunk !== 'function') {
		return undefined;
	}

	return (type, itemIndex, data) => {
		execFunctions.sendChunk(
			type as Parameters<typeof execFunctions.sendChunk>[0],
			itemIndex,
			data as Parameters<typeof execFunctions.sendChunk>[2],
		);
	};
}
