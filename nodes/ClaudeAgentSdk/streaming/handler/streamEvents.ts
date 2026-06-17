import type { SubagentContext, ToolCallContext } from '../types';

const STRUCTURED_OUTPUT_TOOL_NAME = 'structuredoutput';

function isStructuredOutputToolName(name: unknown): boolean {
	return typeof name === 'string' && name.toLowerCase() === STRUCTURED_OUTPUT_TOOL_NAME;
}

export function handleStreamEventImpl(args: {
	message: Record<string, unknown>;
	parentToolUseId: string | null;
	toolCallsInProgress: Map<number, ToolCallContext>;
	structuredOutputBlocksInProgress: Set<number>;
	activeSubagents: Map<string, SubagentContext>;
	streamText: (text: string, parentToolUseId: string | null) => void;
	streamToolCall: (name: string, id: string, input: unknown, subagentName?: string) => void;
	streamStructuredOutputDelta: (delta: string, contentBlockIndex: number) => void;
	shouldStreamStructuredOutputDelta: () => boolean;
}): { toolCallComplete?: ToolCallContext } | undefined {
	const {
		message,
		parentToolUseId,
		toolCallsInProgress,
		structuredOutputBlocksInProgress,
		activeSubagents,
		streamText,
		streamToolCall,
		streamStructuredOutputDelta,
		shouldStreamStructuredOutputDelta,
	} = args;

	const event = message.event as Record<string, unknown>;
	if (!event) {
		return;
	}

	// Handle content_block_start - begins a new content block
	if (event.type === 'content_block_start') {
		const index = event.index as number;
		const contentBlock = event.content_block as Record<string, unknown>;
		// Reset stale block classification if an index is reused across events.
		structuredOutputBlocksInProgress.delete(index);

		if (contentBlock?.type === 'tool_use') {
			// Start tracking tool call for input accumulation
			toolCallsInProgress.set(index, {
				id: contentBlock.id as string,
				name: contentBlock.name as string,
				inputJson: '',
				complete: false,
			});
			if (isStructuredOutputToolName(contentBlock.name)) {
				structuredOutputBlocksInProgress.add(index);
			}
		}
		return;
	}

	// Handle content_block_delta events
	if (event.type === 'content_block_delta') {
		const delta = event.delta as Record<string, unknown>;
		const index = event.index as number;

		// Text delta - stream text content
		if (delta?.type === 'text_delta' && delta.text) {
			streamText(delta.text as string, parentToolUseId);
		}

		// Input JSON delta - accumulate tool call input
		if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
			const partialJson = delta.partial_json;
			const toolCall = toolCallsInProgress.get(index);
			if (toolCall) {
				toolCall.inputJson += partialJson;
			}
			if (shouldStreamStructuredOutputDelta() && structuredOutputBlocksInProgress.has(index)) {
				streamStructuredOutputDelta(partialJson, index);
			}
		}
		return;
	}

	// Handle content_block_stop - complete content block
	if (event.type === 'content_block_stop') {
		const index = event.index as number;
		structuredOutputBlocksInProgress.delete(index);
		const toolCall = toolCallsInProgress.get(index);

		if (toolCall) {
			toolCall.complete = true;

			// Stream the tool call now that it's complete
			try {
				const input = toolCall.inputJson ? JSON.parse(toolCall.inputJson) : {};
				const subagentName = parentToolUseId
					? activeSubagents.get(parentToolUseId)?.name
					: undefined;
				streamToolCall(toolCall.name, toolCall.id, input, subagentName);
			} catch {
				// JSON parse failed, stream with raw input
				streamToolCall(toolCall.name, toolCall.id, toolCall.inputJson);
			}

			// Clean up
			const completed = { ...toolCall };
			toolCallsInProgress.delete(index);
			return { toolCallComplete: completed };
		}
		return undefined;
	}

	// Unknown event type - ignore
	return undefined;
}
