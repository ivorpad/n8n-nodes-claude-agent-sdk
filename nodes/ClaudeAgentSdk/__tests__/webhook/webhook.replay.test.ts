import { beforeEach, describe, expect, it, vi } from 'vitest';

const replayMocks = vi.hoisted(() => ({
	replayToResponse: vi.fn(),
	createReplayService: vi.fn(),
	createPostgresStreamStoreHandle: vi.fn(),
	close: vi.fn(),
	getStreamState: vi.fn(),
}));

vi.mock('../../streaming/replayService', () => ({
	createReplayService: replayMocks.createReplayService,
}));

vi.mock('../../streaming/streamStoreFactory', () => ({
	createPostgresStreamStoreHandle: replayMocks.createPostgresStreamStoreHandle,
}));

vi.mock('../../streaming/ResponseStore', () => ({
	storeRequestResponse: vi.fn(),
	clearRequestResponse: vi.fn(),
}));

import { ClaudeAgentSdk } from '../../ClaudeAgentSdk.node';

describe('webhook() replay routing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		replayMocks.replayToResponse.mockResolvedValue({
			streamKey: 'stream_123',
			status: 'paused_hitl',
			framesReplayed: 2,
			lastSeq: 2,
			liveAttached: true,
		});
		replayMocks.createReplayService.mockReturnValue({
			replayToResponse: replayMocks.replayToResponse,
			attachLiveResponse: vi.fn(),
			detachLiveResponse: vi.fn(),
		});
		replayMocks.getStreamState.mockResolvedValue({
			streamKey: 'stream_123',
			status: 'paused_hitl',
			lastSeq: 2,
			nextSeq: 3,
			createdAt: '2026-03-10T12:00:00.000Z',
			updatedAt: '2026-03-10T12:01:00.000Z',
		});
		replayMocks.close.mockResolvedValue(undefined);
		replayMocks.createPostgresStreamStoreHandle.mockResolvedValue({
			store: {
				getStreamState: replayMocks.getStreamState,
			},
			credentialName: 'postgres',
			close: replayMocks.close,
		});
	});

	it('routes replay-only stream requests through the durable replay service', async () => {
		const node = new ClaudeAgentSdk();
		const res = {
			setHeader: vi.fn(),
			end: vi.fn(),
			writableEnded: false,
		};
		const wf = {
			getRequestObject: () => ({
				method: 'GET',
				query: {
					format: 'stream',
					streamKey: 'stream_123',
					replay: 'true',
					cursor: '4',
				},
			}),
			getResponseObject: () => res,
		} as any;

		const result = await node.webhook.call(wf);

		expect(result).toEqual({ noWebhookResponse: true });
		expect(replayMocks.replayToResponse).toHaveBeenCalledWith(
			{
				streamKey: 'stream_123',
				cursor: 4,
				limit: undefined,
				tailLive: true,
			},
			res,
		);
		expect(replayMocks.close).toHaveBeenCalledTimes(1);
	});
});
