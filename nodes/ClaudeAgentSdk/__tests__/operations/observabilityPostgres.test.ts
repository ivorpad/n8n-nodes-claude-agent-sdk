import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { InvocationObservabilityCollector } from '../../operations/executeTask/observability';
import {
	DEFAULT_OBSERVABILITY_TABLE_NAME,
	persistInvocationObservabilityToPostgresPool,
} from '../../operations/executeTask/observabilityPostgres';

function createObservability() {
	const collector = new InvocationObservabilityCollector({
		mode: 'full',
		maxEvents: 20,
		maxBytes: 4096,
		redactPayloads: true,
		context: { nodeName: 'Test Node', itemIndex: 0, executionId: 'exec_1' },
	});
	collector.record({
		eventType: 'tool.call.detected',
		status: 'detected',
		toolName: 'Read',
		payload: {
			requestId: 'req_1',
		},
	});
	return collector.toTaskResultObservability();
}

function createPoolQueryMock() {
	return vi.fn(async (sql: string) => {
		if (sql.includes('to_regclass')) {
			return { rows: [{ regclass: null }], rowCount: 1 };
		}
		if (sql.includes('INSERT INTO')) {
			return { rows: [], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
}

describe('observabilityPostgres persistence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('inserts invocation events through a provided postgres pool', async () => {
		const query = createPoolQueryMock();

		const result = await persistInvocationObservabilityToPostgresPool({
			pool: { query } as unknown as Pool,
			observability: createObservability(),
			terminalStatus: 'completed',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
				chatSessionId: 'chat_1',
				sessionId: 'session_1',
				correlationId: 'corr_1',
			},
		});

		expect(result).toMatchObject({
			backend: 'postgres',
			attempted: true,
			persisted: true,
			tableName: DEFAULT_OBSERVABILITY_TABLE_NAME,
		});
		expect(result.rowCount).toBeGreaterThan(0);

		const insertCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO'));
		expect(insertCall).toBeDefined();
		expect(insertCall?.[1]).toEqual(
			expect.arrayContaining([
				'wf_1',
				'Claude Agent SDK',
				'exec_1',
				'chat_1',
				'session_1',
				'corr_1',
				'req_1',
			]),
		);
	});

	it('validates existing observability tables before inserting', async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes('pg_attribute')) {
				return {
					rows: [
						'invocation_id',
						'workflow_id',
						'node_name',
						'execution_id',
						'item_index',
						'chat_session_id',
						'session_id',
						'correlation_id',
						'request_id',
						'terminal_status',
						'event_id',
						'event_type',
						'level',
						'status',
						'tool_name',
						'duration_ms',
						'event_ts',
						'payload',
					].map((attname) => ({ attname })),
					rowCount: 18,
				};
			}
			if (sql.includes('to_regclass')) {
				return { rows: [{ regclass: 'public.claude_invocation_observability_events' }], rowCount: 1 };
			}
			if (sql.includes('INSERT INTO')) {
				return { rows: [], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});

		await persistInvocationObservabilityToPostgresPool({
			pool: { query } as unknown as Pool,
			observability: createObservability(),
			terminalStatus: 'completed',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
			},
		});

		expect(query.mock.calls.some(([sql]) => String(sql).includes('CREATE TABLE'))).toBe(false);
		expect(query.mock.calls.some(([sql]) => String(sql).includes('pg_attribute'))).toBe(true);
	});

	it('rolls back and rejects when pool insert fails', async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes('to_regclass')) {
				return { rows: [{ regclass: null }], rowCount: 1 };
			}
			if (sql.includes('INSERT INTO')) {
				throw new Error('db down');
			}
			return { rows: [], rowCount: 0 };
		});

		await expect(
			persistInvocationObservabilityToPostgresPool({
				pool: { query } as unknown as Pool,
				observability: createObservability(),
				terminalStatus: 'completed',
				context: {
					workflowId: 'wf_1',
					nodeName: 'Claude Agent SDK',
					executionId: 'exec_1',
					itemIndex: 0,
				},
			}),
		).rejects.toThrow('db down');
		expect(query.mock.calls.some(([sql]) => String(sql).includes('ROLLBACK'))).toBe(true);
	});
});
