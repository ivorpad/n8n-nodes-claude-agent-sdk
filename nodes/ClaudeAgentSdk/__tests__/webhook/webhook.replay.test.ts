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
			streamKey: 'stream:42:0:0123456789abcdef0123456789abcdef',
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
			streamKey: 'stream:42:0:0123456789abcdef0123456789abcdef',
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
					streamKey: 'stream:42:0:0123456789abcdef0123456789abcdef',
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
				streamKey: 'stream:42:0:0123456789abcdef0123456789abcdef',
				cursor: 4,
				limit: undefined,
				tailLive: true,
			},
			res,
		);
		expect(replayMocks.close).toHaveBeenCalledTimes(1);
	});

	it('refuses to replay a legacy enumerable (non-nonce) stream key', async () => {
		// Security regression: a pre-nonce key `stream:<exec>:<idx>` is enumerable.
		// A replay request bearing one must NOT reach the durable replay service.
		const node = new ClaudeAgentSdk();
		const res = { setHeader: vi.fn(), end: vi.fn(), send: vi.fn(), writableEnded: false };
		const wf = {
			getRequestObject: () => ({
				method: 'GET',
				query: { format: 'stream', streamKey: 'stream:1:0', replay: 'true' },
			}),
			getResponseObject: () => res,
		} as any;

		const result = await node.webhook.call(wf);

		// Not routed to replay; falls through to normal handling and is rejected.
		expect(replayMocks.replayToResponse).not.toHaveBeenCalled();
		expect(result.webhookResponse).toContain('Missing requestId');
	});
});
