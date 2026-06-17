import { describe, expect, it, vi } from 'vitest';

import { createReplayService } from '../../streaming/replayService';

describe('replayService', () => {
	it('replays persisted frames and keeps the response attached for paused HITL streams', async () => {
		const streamStore = {
			getStreamState: vi
				.fn()
				.mockResolvedValueOnce({
					streamKey: 'stream_123',
					status: 'paused_hitl',
					lastSeq: 2,
					nextSeq: 3,
					createdAt: '2026-03-10T12:00:00.000Z',
					updatedAt: '2026-03-10T12:01:00.000Z',
				})
				.mockResolvedValueOnce({
					streamKey: 'stream_123',
					status: 'paused_hitl',
					lastSeq: 2,
					nextSeq: 3,
					createdAt: '2026-03-10T12:00:00.000Z',
					updatedAt: '2026-03-10T12:01:00.000Z',
				}),
			readFramesSince: vi
				.fn()
				.mockResolvedValueOnce([
					{
						streamKey: 'stream_123',
						seq: 1,
						eventType: 'begin',
						createdAt: '2026-03-10T12:00:00.000Z',
						payload: null,
					},
					{
						streamKey: 'stream_123',
						seq: 2,
						eventType: 'item',
						createdAt: '2026-03-10T12:00:01.000Z',
						payload: { content: { hello: 'world' } },
					},
				])
				.mockResolvedValueOnce([]),
		};
		const responseStore = {
			storeRequestResponse: vi.fn(),
			clearRequestResponse: vi.fn(),
		};
		const writes: string[] = [];
		const response = {
			write: vi.fn((chunk: string | Buffer) => {
				writes.push(String(chunk));
				return true;
			}),
			end: vi.fn(),
			writableEnded: false,
			setHeader: vi.fn(),
			flushHeaders: vi.fn(),
			flush: vi.fn(),
		};

		const replayService = createReplayService({
			streamStore: streamStore as never,
			responseStore,
		});

		const result = await replayService.replayToResponse(
			{
				streamKey: 'stream_123',
				cursor: 0,
				tailLive: true,
			},
			response,
		);

		expect(result).toEqual({
			streamKey: 'stream_123',
			status: 'paused_hitl',
			framesReplayed: 2,
			lastSeq: 2,
			liveAttached: true,
		});
		expect(writes).toEqual([
			'{"type":"begin","seq":1,"streamKey":"stream_123","createdAt":"2026-03-10T12:00:00.000Z"}\n',
			'{"type":"item","seq":2,"streamKey":"stream_123","createdAt":"2026-03-10T12:00:01.000Z","content":{"hello":"world"}}\n',
		]);
		expect(responseStore.storeRequestResponse).toHaveBeenCalledWith('stream_123', response);
		expect(response.end).not.toHaveBeenCalled();
	});
});
