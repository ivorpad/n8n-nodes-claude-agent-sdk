import { describe, expect, it } from 'vitest';

import { PostgresStreamStore } from '../../streaming/PostgresStreamStore';

type StreamRecord = {
	stream_key: string;
	workflow_id: string | null;
	execution_id: string | null;
	chat_session_id: string | null;
	request_id: string | null;
	status: string;
	next_seq: number;
	last_seq: number;
	created_at: string;
	updated_at: string;
	terminal_at: string | null;
	expires_at: string | null;
	error_message: string | null;
};

type EventRecord = {
	stream_key: string;
	seq: number;
	event_type: string;
	payload: { content: unknown } | null;
	workflow_id: string | null;
	execution_id: string | null;
	chat_session_id: string | null;
	request_id: string | null;
	created_at: string;
};

function createMockPool() {
	const relations = new Set<string>();
	const streams = new Map<string, StreamRecord>();
	const events = new Map<string, EventRecord[]>();

	const ensureStream = (params: unknown[]) => {
		const [streamKey, workflowId, executionId, chatSessionId, requestId, status, updatedAt] = params as [
			string,
			string | null,
			string | null,
			string | null,
			string | null,
			string,
			string,
		];
		const existing = streams.get(streamKey);
		if (!existing) {
			streams.set(streamKey, {
				stream_key: streamKey,
				workflow_id: workflowId,
				execution_id: executionId,
				chat_session_id: chatSessionId,
				request_id: requestId,
				status,
				next_seq: 1,
				last_seq: 0,
				created_at: updatedAt,
				updated_at: updatedAt,
				terminal_at: null,
				expires_at: null,
				error_message: null,
			});
			return;
		}

		existing.workflow_id = workflowId ?? existing.workflow_id;
		existing.execution_id = executionId ?? existing.execution_id;
		existing.chat_session_id = chatSessionId ?? existing.chat_session_id;
		existing.request_id = requestId ?? existing.request_id;
		existing.status = status;
		existing.updated_at = updatedAt;
		if (status === 'live') {
			existing.terminal_at = null;
			existing.expires_at = null;
			existing.error_message = null;
		}
	};

	const query = async (sql: string, params: unknown[] = []) => {
		const normalized = sql.replace(/\s+/g, ' ').trim();

		if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
			return { rows: [], rowCount: null };
		}

		if (normalized.startsWith('SELECT to_regclass')) {
			const tableName = String(params[0]);
			return {
				rows: [{ regclass: relations.has(tableName) ? tableName : null }],
				rowCount: 1,
			};
		}

		if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "claude_streams"')) {
			relations.add('claude_streams');
			return { rows: [], rowCount: null };
		}

		if (normalized.startsWith('CREATE TABLE IF NOT EXISTS "claude_stream_events"')) {
			relations.add('claude_stream_events');
			return { rows: [], rowCount: null };
		}

		if (normalized.startsWith('CREATE INDEX IF NOT EXISTS')) {
			return { rows: [], rowCount: null };
		}

		if (normalized.startsWith('INSERT INTO "claude_streams"')) {
			ensureStream(params);
			return { rows: [], rowCount: 1 };
		}

		if (normalized.includes('SELECT next_seq FROM "claude_streams"')) {
			const stream = streams.get(String(params[0]));
			return {
				rows: stream ? [{ next_seq: stream.next_seq }] : [],
				rowCount: stream ? 1 : 0,
			};
		}

		if (normalized.startsWith('INSERT INTO "claude_stream_events"')) {
			const [streamKey, seq, eventType, payloadJson, workflowId, executionId, chatSessionId, requestId, createdAt] = params as [
				string,
				number,
				string,
				string | null,
				string | null,
				string | null,
				string | null,
				string | null,
				string,
			];
			const existing = events.get(streamKey) ?? [];
			existing.push({
				stream_key: streamKey,
				seq,
				event_type: eventType,
				payload: payloadJson ? JSON.parse(payloadJson) as { content: unknown } : null,
				workflow_id: workflowId,
				execution_id: executionId,
				chat_session_id: chatSessionId,
				request_id: requestId,
				created_at: createdAt,
			});
			events.set(streamKey, existing);
			return { rows: [], rowCount: 1 };
		}

		if (normalized.includes('UPDATE "claude_streams" SET status = \'live\'')) {
			const [streamKey, nextSeq, lastSeq, updatedAt, workflowId, executionId, chatSessionId, requestId] = params as [
				string,
				number,
				number,
				string,
				string | null,
				string | null,
				string | null,
				string | null,
			];
			const stream = streams.get(streamKey);
			if (stream) {
				stream.status = 'live';
				stream.next_seq = nextSeq;
				stream.last_seq = lastSeq;
				stream.updated_at = updatedAt;
				stream.workflow_id = workflowId ?? stream.workflow_id;
				stream.execution_id = executionId ?? stream.execution_id;
				stream.chat_session_id = chatSessionId ?? stream.chat_session_id;
				stream.request_id = requestId ?? stream.request_id;
				stream.terminal_at = null;
				stream.expires_at = null;
				stream.error_message = null;
			}
			return { rows: [], rowCount: stream ? 1 : 0 };
		}

		if (normalized.includes('FROM "claude_stream_events" WHERE stream_key = $1')) {
			const [streamKey, cursor, limit] = params as [string, number, number];
			const rows = (events.get(streamKey) ?? [])
				.filter((event) => event.seq > cursor)
				.sort((left, right) => left.seq - right.seq)
				.slice(0, limit);
			return { rows, rowCount: rows.length };
		}

		if (normalized.includes('UPDATE "claude_streams" SET status = $2')) {
			const [streamKey, status, updatedAt, expiresAt, errorMessage] = params as [
				string,
				string,
				string,
				string,
				string | null,
			];
			const stream = streams.get(streamKey);
			if (stream) {
				stream.status = status;
				stream.updated_at = updatedAt;
				stream.terminal_at = updatedAt;
				stream.expires_at = expiresAt;
				stream.error_message = errorMessage;
			}
			return { rows: [], rowCount: stream ? 1 : 0 };
		}

		if (normalized.includes('DELETE FROM "claude_streams"')) {
			const cutoff = new Date(String(params[0])).getTime();
			let deleted = 0;
			for (const [key, stream] of streams.entries()) {
				if (stream.expires_at && new Date(stream.expires_at).getTime() <= cutoff) {
					streams.delete(key);
					events.delete(key);
					deleted += 1;
				}
			}
			return { rows: [], rowCount: deleted };
		}

		if (normalized.includes('FROM "claude_streams" WHERE stream_key = $1')) {
			const stream = streams.get(String(params[0]));
			return {
				rows: stream ? [stream] : [],
				rowCount: stream ? 1 : 0,
			};
		}

		throw new Error(`Unhandled SQL in mock pool: ${normalized}`);
	};

	return {
		query,
		connect: async () => ({
			query,
			release: () => undefined,
		}),
	};
}

describe('PostgresStreamStore', () => {
	it('appends sequential frames and tracks terminal stream state', async () => {
		const store = new PostgresStreamStore({
			pool: createMockPool() as never,
		});

		const beginFrame = await store.appendFrame({
			streamKey: 'stream_123',
			eventType: 'begin',
		});
		const itemFrame = await store.appendFrame({
			streamKey: 'stream_123',
			eventType: 'item',
			payload: { content: { hello: 'world' } },
			executionId: 'exec_1',
			chatSessionId: 'chat_1',
		});

		expect(beginFrame.seq).toBe(1);
		expect(itemFrame.seq).toBe(2);

		const replayFrames = await store.readFramesSince({
			streamKey: 'stream_123',
			cursor: 1,
			limit: 10,
		});
		expect(replayFrames).toEqual([
			expect.objectContaining({
				seq: 2,
				eventType: 'item',
				payload: { content: { hello: 'world' } },
				executionId: 'exec_1',
				chatSessionId: 'chat_1',
			}),
		]);

		await store.markTerminal({
			streamKey: 'stream_123',
			status: 'completed',
		});

		const state = await store.getStreamState('stream_123');
		expect(state).toEqual(expect.objectContaining({
			streamKey: 'stream_123',
			status: 'completed',
			lastSeq: 2,
			nextSeq: 3,
			executionId: 'exec_1',
			chatSessionId: 'chat_1',
		}));
		expect(state?.terminalAt).toBeDefined();
		expect(state?.expiresAt).toBeDefined();

		const deleted = await store.purgeExpired(new Date('3000-01-01T00:00:00.000Z'));
		expect(deleted).toBe(1);
		expect(await store.getStreamState('stream_123')).toBeUndefined();
	});
});
