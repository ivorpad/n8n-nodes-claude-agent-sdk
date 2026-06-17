import type { StreamableResponse } from './ResponseStore';
import type { StreamFrame } from './streamTypes';

function toNdjsonEvent(frame: StreamFrame): Record<string, unknown> {
	const base: Record<string, unknown> = {
		type: frame.eventType,
		seq: frame.seq,
		streamKey: frame.streamKey,
		createdAt: frame.createdAt,
	};

	if (frame.payload !== null) {
		base.content = frame.payload.content;
	}

	return base;
}

export function writeNdjsonFrame(
	response: StreamableResponse,
	frame: StreamFrame,
): void {
	response.write(`${JSON.stringify(toNdjsonEvent(frame))}\n`);
}
