import { describe, expect, it } from 'vitest';
import type { INode } from 'n8n-workflow';

import {
	acquireSessionExecutionLock,
	type LockablePool,
	type LockablePoolClient,
} from '../PostgresSessionMemory.node';

const NODE_STUB = { name: 'Postgres Session Memory', type: 'postgresSessionMemory' } as INode;

interface RecordedQuery {
	clientId: number;
	sql: string;
}

/**
 * Fake pool that hands out distinguishable clients. `connect()` returns a fresh
 * client each call so the test can assert that acquire + unlock run on the SAME
 * pinned client (V11b, finding 7.1) — not on arbitrary pooled backends.
 */
function createFakePool(options?: { lockResponses?: boolean[] }) {
	const lockResponses = options?.lockResponses ?? [true];
	let lockCallIndex = 0;
	let nextClientId = 0;
	const recorded: RecordedQuery[] = [];
	const released: number[] = [];

	const connect = async (): Promise<LockablePoolClient> => {
		const clientId = nextClientId;
		nextClientId += 1;
		const client: LockablePoolClient = {
			async query<TRow = unknown>(sql: string) {
				recorded.push({ clientId, sql });
				if (sql.includes('pg_try_advisory_lock')) {
					const locked = lockResponses[Math.min(lockCallIndex, lockResponses.length - 1)];
					lockCallIndex += 1;
					return { rows: [{ locked }] as unknown as TRow[], rowCount: 1 };
				}
				return { rows: [] as TRow[], rowCount: 0 };
			},
			release() {
				released.push(clientId);
			},
		};
		return client;
	};

	const pool: LockablePool = { connect };
	return { pool, recorded, released, get clientsHandedOut() { return nextClientId; } };
}

describe('acquireSessionExecutionLock', () => {
	it('acquires and releases the advisory lock on the same pinned client', async () => {
		const fake = createFakePool({ lockResponses: [true] });

		const release = await acquireSessionExecutionLock({
			pool: fake.pool,
			workflowId: 'wf_1',
			sessionId: 'chat_1',
			node: NODE_STUB,
		});

		const acquireCall = fake.recorded.find((q) => q.sql.includes('pg_try_advisory_lock'));
		expect(acquireCall).toBeDefined();
		// Only one client should be checked out for the whole lock lifetime.
		expect(fake.clientsHandedOut).toBe(1);

		await release();

		const unlockCall = fake.recorded.find((q) => q.sql.includes('pg_advisory_unlock'));
		expect(unlockCall).toBeDefined();
		// The unlock MUST run on the very client that acquired the lock — the bug
		// was routing acquire/unlock to different pooled backends via pool.query.
		expect(unlockCall?.clientId).toBe(acquireCall?.clientId);
		// And the pinned client is returned to the pool after unlocking.
		expect(fake.released).toContain(acquireCall?.clientId);
	});

	it('is idempotent: releasing twice only unlocks once', async () => {
		const fake = createFakePool({ lockResponses: [true] });

		const release = await acquireSessionExecutionLock({
			pool: fake.pool,
			workflowId: 'wf_1',
			sessionId: 'chat_1',
			node: NODE_STUB,
		});

		await release();
		await release();

		const unlockCalls = fake.recorded.filter((q) => q.sql.includes('pg_advisory_unlock'));
		expect(unlockCalls).toHaveLength(1);
	});

	it('times out, releases the pinned client, and throws when the lock is never granted', async () => {
		const fake = createFakePool({ lockResponses: [false] });
		let fakeNow = 0;

		await expect(
			acquireSessionExecutionLock({
				pool: fake.pool,
				workflowId: 'wf_1',
				sessionId: 'chat_1',
				node: NODE_STUB,
				timeoutMs: 5000,
				pollMs: 100,
				// Deterministic clock: jump past the 5s timeout after the first failed attempt.
				now: () => {
					const value = fakeNow;
					fakeNow += 6000;
					return value;
				},
				sleep: async () => undefined,
			}),
		).rejects.toThrow(/Timed out waiting for session execution lock/);

		// Even on timeout the checked-out client must be returned to the pool.
		expect(fake.released).toHaveLength(1);
	});

	it('polls until the lock is granted on the same client', async () => {
		const fake = createFakePool({ lockResponses: [false, false, true] });
		let fakeNow = 0;

		const release = await acquireSessionExecutionLock({
			pool: fake.pool,
			workflowId: 'wf_1',
			sessionId: 'chat_1',
			node: NODE_STUB,
			now: () => {
				const value = fakeNow;
				fakeNow += 100;
				return value;
			},
			sleep: async () => undefined,
		});

		const lockAttempts = fake.recorded.filter((q) => q.sql.includes('pg_try_advisory_lock'));
		expect(lockAttempts).toHaveLength(3);
		// All attempts (and the eventual unlock) stay on one pinned client.
		const clientIds = new Set(fake.recorded.map((q) => q.clientId));
		expect(clientIds.size).toBe(1);

		await release();
	});
});
