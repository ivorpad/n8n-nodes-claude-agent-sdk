import type {
	StreamItemPayload,
	StreamingConfig,
	ToolCallContent,
	ToolResultContent,
} from '../types';

export function emitToolCall(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	truncate: (content: string) => string;
	name: string;
	id: string;
	input: unknown;
	subagentName?: string;
}): void {
	const { config, stream, emitJson, formatMarker, truncate, name, id, input, subagentName } = args;

	if (config.useMarkers) {
		let content = '';
		switch (config.toolInputDisplay) {
			case 'full':
				content = JSON.stringify(input);
				break;
			case 'truncated':
				content = truncate(JSON.stringify(input));
				break;
			case 'nameOnly':
				content = '';
				break;
		}

		const startMarker = formatMarker(config.markers.toolCallStart, {
			name,
			id,
			...(subagentName && { subagent: subagentName }),
		});

		stream(`\n${startMarker}${content}${config.markers.toolCallEnd}\n`);
		return;
	}

	// JSON format - apply display settings to input
	let processedInput: unknown;
	switch (config.toolInputDisplay) {
		case 'full':
			processedInput = input;
			break;
		case 'truncated': {
			const inputStr = JSON.stringify(input);
			processedInput = inputStr.length > config.truncationLimit
				? inputStr.slice(0, config.truncationLimit) + '...'
				: input;
			break;
		}
		case 'nameOnly':
			processedInput = undefined;
			break;
	}

	// Omit undefined input field to match previous JSON.stringify behavior
	const content: ToolCallContent = {
		type: 'tool_call',
		name,
		id,
		...(processedInput !== undefined ? { input: processedInput } : {}),
	} as ToolCallContent;
	emitJson(content);
}

export function emitToolResult(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	truncate: (content: string) => string;
	name: string;
	id: string;
	result: unknown;
	success: boolean;
}): void {
	const { config, stream, emitJson, formatMarker, truncate, name, id, result, success } = args;

	if (config.useMarkers) {
		let content = '';
		switch (config.toolResultDisplay) {
			case 'full':
				content = typeof result === 'string' ? result : JSON.stringify(result);
				break;
			case 'truncated': {
				const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
				content = truncate(resultStr);
				break;
			}
			case 'summary':
				content = '';
				break;
		}

		const startMarker = formatMarker(config.markers.toolResultStart, {
			name,
			id,
			success,
		});

		stream(`\n${startMarker}${content}${config.markers.toolResultEnd}\n`);
		return;
	}

	// JSON format - apply display settings to result
	let processedResult: unknown;
	switch (config.toolResultDisplay) {
		case 'full':
			processedResult = result;
			break;
		case 'truncated': {
			const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
			processedResult = resultStr.length > config.truncationLimit
				? resultStr.slice(0, config.truncationLimit) + '...'
				: result;
			break;
		}
		case 'summary':
			processedResult = undefined;
			break;
	}

	// Omit undefined result field to match previous JSON.stringify behavior
	const content: ToolResultContent = {
		type: 'tool_result',
		name,
		id,
		success,
		...(processedResult !== undefined ? { result: processedResult } : {}),
	} as ToolResultContent;
	emitJson(content);
}
