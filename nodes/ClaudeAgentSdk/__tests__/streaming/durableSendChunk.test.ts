import { describe, expect, it, vi } from 'vitest';

import {
	createDurableSendChunk,
	flushDurableSendChunk,
} from '../../streaming/durableSendChunk';
import type { StreamStore } from '../../streaming/PostgresStreamStore';
import { createSecretsRedactor } from '../../operations/executeTask/secretsRedaction';

function appendOnlyStreamStore(appendFrame: StreamStore['appendFrame']): StreamStore {
	const notImplemented = () => {
		throw new Error('not implemented in fake');
	};
	return {
		appendFrame,
		ensureSchema: notImplemented,
		ensureStream: notImplemented,
		readFramesSince: notImplemented,
		markTerminal: notImplemented,
		purgeExpired: notImplemented,
		getStreamState: notImplemented,
	};
}

describe('durableSendChunk', () => {
	it('redacts secret values in the frame payload before persisting via appendFrame', async () => {
		const appended: Array<{ payload?: { content: unknown } | null }> = [];
		let seq = 0;
		const appendFrame: StreamStore['appendFrame'] = vi.fn(async (args) => {
			appended.push({ payload: args.payload });
			return {
				streamKey: args.streamKey,
				seq: ++seq,
				eventType: args.eventType,
				createdAt: '2026-03-10T12:00:00.000Z',
				payload: args.payload ?? null,
			};
		});
		const streamStore = appendOnlyStreamStore(appendFrame);

		const sendChunk = createDurableSendChunk({
			streamStore,
			streamKey: 'stream_secret',
			secretRedactor: createSecretsRedactor(['sk-secret-leaked-123']),
		});

		sendChunk('item', 0, { token: 'sk-secret-leaked-123', note: 'safe' });
		await flushDurableSendChunk(sendChunk);

		expect(appendFrame).toHaveBeenCalledTimes(1);
		const persistedPayload = appended[0].payload;
		expect(JSON.stringify(persistedPayload)).not.toContain('sk-secret-leaked-123');
		expect(persistedPayload).toEqual({
			content: { token: '[REDACTED]', note: 'safe' },
		});
	});

	it('persists frames before fan-out and writes NDJSON to an attached response', async () => {
		let seq = 0;
		const appendFrame: StreamStore['appendFrame'] = vi.fn(async (args) => ({
			streamKey: args.streamKey,
			seq: ++seq,
			eventType: args.eventType,
			createdAt: '2026-03-10T12:00:00.000Z',
			payload: args.payload ?? null,
		}));
		const streamStore = appendOnlyStreamStore(appendFrame);

		const writes: string[] = [];
		const response = {
			write: vi.fn((chunk: string | Buffer) => {
				writes.push(String(chunk));
				return true;
			}),
			end: vi.fn(),
			writableEnded: false,
		};
		const responseStore = {
			retrieveRequestResponse: vi.fn(() => response),
			touchRequestResponse: vi.fn(),
			clearRequestResponse: vi.fn(),
		};
		const liveSendChunk = vi.fn();

		const sendChunk = createDurableSendChunk({
			streamStore,
			streamKey: 'stream_123',
			liveSendChunk,
			responseStore,
		});

		sendChunk('begin', 0);
		sendChunk('item', 0, { hello: 'world' });
		sendChunk('end', 0);
		await flushDurableSendChunk(sendChunk);

		expect(appendFrame).toHaveBeenCalledTimes(3);
		expect(appendFrame).toHaveBeenNthCalledWith(1, expect.objectContaining({
			streamKey: 'stream_123',
			eventType: 'begin',
		}));
		expect(appendFrame).toHaveBeenNthCalledWith(2, expect.objectContaining({
			streamKey: 'stream_123',
			eventType: 'item',
			payload: { content: { hello: 'world' } },
		}));
		expect(appendFrame).toHaveBeenNthCalledWith(3, expect.objectContaining({
			streamKey: 'stream_123',
			eventType: 'end',
		}));

		expect(writes).toEqual([
			'{"type":"begin","seq":1,"streamKey":"stream_123","createdAt":"2026-03-10T12:00:00.000Z"}\n',
			'{"type":"item","seq":2,"streamKey":"stream_123","createdAt":"2026-03-10T12:00:00.000Z","content":{"hello":"world"}}\n',
			'{"type":"end","seq":3,"streamKey":"stream_123","createdAt":"2026-03-10T12:00:00.000Z"}\n',
		]);
		expect(response.end).toHaveBeenCalledTimes(1);
		expect(responseStore.clearRequestResponse).toHaveBeenCalledWith('stream_123');

		expect(liveSendChunk).toHaveBeenCalledTimes(3);
		expect(liveSendChunk).toHaveBeenNthCalledWith(1, 'begin', 0, undefined);
		expect(liveSendChunk).toHaveBeenNthCalledWith(2, 'item', 0, { hello: 'world' });
		expect(liveSendChunk).toHaveBeenNthCalledWith(3, 'end', 0, undefined);
	});
});
