import type { SendChunkFn, StreamItemPayload } from './types';
import { StreamEventBuffer } from './StreamEventBuffer';
import { writeNdjsonFrame } from './streamTransport';
import type { StreamFrame, StreamEventType, StreamFramePayload } from './streamTypes';
import type { StreamStore } from './PostgresStreamStore';
import {
	NOOP_SECRETS_REDACTOR,
	type SecretsRedactor,
} from '../operations/executeTask/secretsRedaction';

type ResponseStoreModule = Pick<typeof import('./ResponseStore'),
	'retrieveRequestResponse'
	| 'touchRequestResponse'
	| 'clearRequestResponse'
>;

interface DurableSendChunkArgs {
	streamStore: StreamStore;
	streamKey: string;
	requestId?: string;
	executionId?: string;
	chatSessionId?: string;
	workflowId?: string;
	liveSendChunk?: SendChunkFn;
	responseStore?: ResponseStoreModule;
	onPersistError?: (error: Error) => void;
	/**
	 * Redacts secret values from each frame payload before it is durably
	 * persisted (and before it is fanned out). Defaults to a no-op so callers
	 * that never carry secrets are unaffected (V4: durable stream sink).
	 */
	secretRedactor?: SecretsRedactor;
}

interface DurableSendChunkController {
	flush: () => Promise<void>;
	getLastSeq: () => number | undefined;
}

const durableControllers = new WeakMap<SendChunkFn, DurableSendChunkController>();

function normalizeEventType(type: string): StreamEventType {
	if (type === 'begin' || type === 'item' || type === 'end' || type === 'error') {
		return type;
	}

	return 'item';
}

function deliverToActiveResponse(
	responseStore: ResponseStoreModule | undefined,
	frame: StreamFrame,
): void {
	if (!responseStore) {
		return;
	}

	const response = responseStore.retrieveRequestResponse(frame.streamKey);
	if (!response || response.writableEnded) {
		if (response?.writableEnded) {
			responseStore.clearRequestResponse(frame.streamKey);
		}
		return;
	}

	try {
		responseStore.touchRequestResponse(frame.streamKey);
		writeNdjsonFrame(response, frame);
		if (frame.eventType === 'end') {
			response.end();
			responseStore.clearRequestResponse(frame.streamKey);
		}
	} catch {
		try {
			response.end();
		} catch {
			// Ignore secondary response-close errors.
		}
		responseStore.clearRequestResponse(frame.streamKey);
	}
}

function toLiveSendChunkData(frame: StreamFrame): StreamItemPayload | undefined {
	const content = frame.payload?.content;
	if (content === undefined || content === null) {
		return undefined;
	}

	if (typeof content === 'string' || typeof content === 'object') {
		return content as StreamItemPayload;
	}

	return undefined;
}

export function createDurableSendChunk(args: DurableSendChunkArgs): SendChunkFn {
	const {
		streamStore,
		streamKey,
		requestId,
		executionId,
		chatSessionId,
		workflowId,
		liveSendChunk,
		responseStore,
		onPersistError,
		secretRedactor = NOOP_SECRETS_REDACTOR,
	} = args;

	const eventBuffer = new StreamEventBuffer();
	let queue = Promise.resolve();
	let lastSeq: number | undefined;

	const flushFrames = async (frames: ReturnType<StreamEventBuffer['flush']>, itemIndex: number): Promise<void> => {
		for (const frame of frames) {
			// Redact secrets BEFORE persisting/fanning out: the durable store and
			// any attached response receive the masked payload, never plaintext.
			const safePayload: StreamFramePayload | null = frame.payload
				? secretRedactor.redactUnknown(frame.payload)
				: frame.payload;
			const persisted = await streamStore.appendFrame({
				streamKey,
				eventType: frame.eventType,
				payload: safePayload,
				workflowId,
				executionId,
				chatSessionId,
				requestId,
			});
			lastSeq = persisted.seq;
			deliverToActiveResponse(responseStore, persisted);
			if (liveSendChunk) {
				liveSendChunk(
					frame.eventType,
					itemIndex,
					toLiveSendChunkData(persisted),
				);
			}
		}
	};

	const sendChunk: SendChunkFn = (type, itemIndex, data) => {
		const eventType = normalizeEventType(type);
		const frames = eventType === 'end'
			? eventBuffer.flushTerminal('end')
			: eventBuffer.push(eventType, data);

		queue = queue
			.then(async () => {
				await flushFrames(frames, itemIndex);
			})
			.catch((error: unknown) => {
				onPersistError?.(error instanceof Error ? error : new Error(String(error)));
			});
	};

	durableControllers.set(sendChunk, {
		flush: async () => {
			const remaining = eventBuffer.flush();
			queue = queue
				.then(async () => {
					if (remaining.length > 0) {
						await flushFrames(remaining, 0);
					}
				})
				.catch((error: unknown) => {
					onPersistError?.(error instanceof Error ? error : new Error(String(error)));
				});
			await queue;
		},
		getLastSeq: () => lastSeq,
	});

	return sendChunk;
}

export async function flushDurableSendChunk(sendChunk?: SendChunkFn): Promise<void> {
	if (!sendChunk) {
		return;
	}

	const controller = durableControllers.get(sendChunk);
	if (!controller) {
		return;
	}

	await controller.flush();
}
