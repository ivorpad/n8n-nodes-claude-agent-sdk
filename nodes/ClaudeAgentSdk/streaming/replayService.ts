import type { StreamableResponse } from './ResponseStore';
import type { StreamStore } from './PostgresStreamStore';
import { ReplayQuerySchema } from './streamSchemas';
import { writeNdjsonFrame } from './streamTransport';
import type { ReplayQuery, ReplayResult } from './streamTypes';

type ResponseStoreModule = Pick<typeof import('./ResponseStore'),
	'storeRequestResponse'
	| 'clearRequestResponse'
>;

interface ReplayService {
	replayToResponse(query: ReplayQuery, res: StreamableResponse): Promise<ReplayResult>;
	attachLiveResponse(streamKey: string, res: StreamableResponse): void;
	detachLiveResponse(streamKey: string): void;
}

function setStreamHeaders(response: StreamableResponse): void {
	response.setHeader?.('Content-Type', 'application/x-ndjson');
	response.setHeader?.('Cache-Control', 'no-cache');
	response.setHeader?.('Connection', 'keep-alive');
	response.setHeader?.('X-Accel-Buffering', 'no');
	response.flushHeaders?.();
	response.flush?.();
}

export function createReplayService(args: {
	streamStore: StreamStore;
	responseStore: ResponseStoreModule;
}): ReplayService {
	const { streamStore, responseStore } = args;

	return {
		async replayToResponse(query: ReplayQuery, res: StreamableResponse): Promise<ReplayResult> {
			const parsed = ReplayQuerySchema.parse(query);
			setStreamHeaders(res);

			let cursor = parsed.cursor;
			let framesReplayed = 0;
			let liveAttached = false;

			const stateBeforeReplay = await streamStore.getStreamState(parsed.streamKey);
			if (!stateBeforeReplay) {
				res.end();
				return {
					streamKey: parsed.streamKey,
					status: 'expired',
					framesReplayed: 0,
					lastSeq: cursor,
					liveAttached: false,
				};
			}

			const firstBatch = await streamStore.readFramesSince({
				streamKey: parsed.streamKey,
				cursor,
				limit: parsed.limit,
			});
			for (const frame of firstBatch) {
				writeNdjsonFrame(res, frame);
				cursor = frame.seq;
				framesReplayed += 1;
			}

			const shouldTailLive = parsed.tailLive === true
				&& (stateBeforeReplay.status === 'live' || stateBeforeReplay.status === 'paused_hitl');
			if (shouldTailLive) {
				responseStore.storeRequestResponse(parsed.streamKey, res);
				liveAttached = true;
			}

			const gapFillFrames = await streamStore.readFramesSince({
				streamKey: parsed.streamKey,
				cursor,
				limit: parsed.limit,
			});
			for (const frame of gapFillFrames) {
				writeNdjsonFrame(res, frame);
				cursor = frame.seq;
				framesReplayed += 1;
			}

			const stateAfterReplay = await streamStore.getStreamState(parsed.streamKey);
			const status = stateAfterReplay?.status ?? stateBeforeReplay.status;
			const lastSeq = stateAfterReplay?.lastSeq ?? cursor;

			if (!liveAttached || status === 'completed' || status === 'failed' || status === 'expired') {
				responseStore.clearRequestResponse(parsed.streamKey);
				res.end();
				liveAttached = false;
			}

			return {
				streamKey: parsed.streamKey,
				status,
				framesReplayed,
				lastSeq,
				liveAttached,
			};
		},

		attachLiveResponse(streamKey: string, res: StreamableResponse): void {
			setStreamHeaders(res);
			responseStore.storeRequestResponse(streamKey, res);
		},

		detachLiveResponse(streamKey: string): void {
			responseStore.clearRequestResponse(streamKey);
		},
	};
}
