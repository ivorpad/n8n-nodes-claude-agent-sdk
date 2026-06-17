import type {
	StreamEventType,
	StreamFramePayload,
} from './streamTypes';

interface BufferedStreamEvent {
	eventType: StreamEventType;
	payload: StreamFramePayload | null;
}

function buildPayload(
	eventType: StreamEventType,
	content: unknown,
): StreamFramePayload | null {
	if (eventType === 'begin' || eventType === 'end') {
		return null;
	}

	return {
		content: content === undefined ? null : content,
	};
}

export class StreamEventBuffer {
	private readonly pending: BufferedStreamEvent[] = [];

	push(eventType: StreamEventType, content?: unknown): BufferedStreamEvent[] {
		this.pending.push({
			eventType,
			payload: buildPayload(eventType, content),
		});

		return this.flush();
	}

	flush(): BufferedStreamEvent[] {
		if (this.pending.length === 0) {
			return [];
		}

		return this.pending.splice(0, this.pending.length);
	}

	flushTerminal(eventType: Extract<StreamEventType, 'end' | 'error'>, content?: unknown): BufferedStreamEvent[] {
		const flushed = this.flush();
		flushed.push({
			eventType,
			payload: buildPayload(eventType, content),
		});
		return flushed;
	}
}
