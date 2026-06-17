import type {
	StreamingConfig,
	StreamContentType,
	SubagentContext,
	SubagentEventContent,
	StreamItemPayload,
} from '../types';

export function streamTextImpl(args: {
	config: StreamingConfig;
	shouldStream: (contentType: StreamContentType) => boolean;
	stream: (content: string) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	activeSubagents: Map<string, SubagentContext>;
	text: string;
	parentToolUseId: string | null;
	currentSubagentId: string | null;
	inSubagentMessageBlock: boolean;
}): { currentSubagentId: string | null; inSubagentMessageBlock: boolean } {
	const {
		config,
		shouldStream,
		stream,
		formatMarker,
		activeSubagents,
		text,
		parentToolUseId,
	} = args;
	let { currentSubagentId, inSubagentMessageBlock } = args;

	const isSubagent = parentToolUseId !== null;

	if (isSubagent) {
		if (!shouldStream('subagentMessages')) {
			return { currentSubagentId, inSubagentMessageBlock };
		}

		if (config.useMarkers) {
			// Marker mode: Track subagent context change and use message blocks
			if (currentSubagentId !== parentToolUseId) {
				// Close previous subagent message block if open
				if (inSubagentMessageBlock && currentSubagentId) {
					stream(config.markers.subagentMsgEnd);
					inSubagentMessageBlock = false;
				}

				// Open new subagent message block
				const subagent = activeSubagents.get(parentToolUseId);
				const marker = formatMarker(config.markers.subagentMsgStart, {
					name: subagent?.name || 'unknown',
					id: parentToolUseId,
				});
				stream(marker);
				currentSubagentId = parentToolUseId;
				inSubagentMessageBlock = true;
			}
		}

		stream(text);
		return { currentSubagentId, inSubagentMessageBlock };
	}

	// Main agent text
	if (!shouldStream('text')) {
		return { currentSubagentId, inSubagentMessageBlock };
	}

	// Close subagent message block if we were in one (markers mode only)
	if (config.useMarkers && inSubagentMessageBlock) {
		stream(config.markers.subagentMsgEnd);
		inSubagentMessageBlock = false;
		currentSubagentId = null;
	}

	stream(text);
	return { currentSubagentId, inSubagentMessageBlock };
}

export function streamSubagentLifecycleImpl(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	activeSubagents: Map<string, SubagentContext>;
	event: 'start' | 'end';
	agentName: string;
	toolUseId: string;
	currentSubagentId: string | null;
	inSubagentMessageBlock: boolean;
}): { currentSubagentId: string | null; inSubagentMessageBlock: boolean } {
	const {
		config,
		stream,
		emitJson,
		formatMarker,
		activeSubagents,
		event,
		agentName,
		toolUseId,
	} = args;
	let { currentSubagentId, inSubagentMessageBlock } = args;

	if (event === 'start') {
		activeSubagents.set(toolUseId, {
			id: toolUseId,
			name: agentName,
			toolUseId,
		});

		if (config.useMarkers) {
			const marker = formatMarker(config.markers.subagentStart, {
				name: agentName,
				id: toolUseId,
			});
			stream(`\n${marker}\n`);
		} else {
			const content: SubagentEventContent = { type: 'subagent_start', name: agentName, id: toolUseId };
			emitJson(content);
		}

		return { currentSubagentId, inSubagentMessageBlock };
	}

	// event === 'end'
	if (config.useMarkers && inSubagentMessageBlock && currentSubagentId === toolUseId) {
		stream(config.markers.subagentMsgEnd);
		inSubagentMessageBlock = false;
		currentSubagentId = null;
	}

	if (config.useMarkers) {
		const marker = formatMarker(config.markers.subagentEnd, {
			name: agentName,
			id: toolUseId,
		});
		stream(`\n${marker}\n`);
	} else {
		const content: SubagentEventContent = { type: 'subagent_end', name: agentName, id: toolUseId };
		emitJson(content);
	}

	activeSubagents.delete(toolUseId);
	return { currentSubagentId, inSubagentMessageBlock };
}

