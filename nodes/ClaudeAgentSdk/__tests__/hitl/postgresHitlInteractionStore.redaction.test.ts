/**
 * HITL store secret redaction (V4: HITL interaction store sink).
 *
 * The durable Postgres HITL table persists the original task prompt and the
 * tool input / reviewer message / answers. Any provider key or secureEnv value
 * embedded in those must be masked before the row is written, so the store
 * never holds plaintext secrets at rest.
 */
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import type { Pool } from 'pg';

import { PostgresHitlInteractionStore } from '../../hitl/PostgresHitlInteractionStore';
import { createSecretsRedactor } from '../../operations/executeTask/secretsRedaction';
import type { ApprovalInteractionRecord } from '../../hitl/interactionStoreTypes';

const REQUIRED_COLUMNS = [
	'workflow_id', 'node_name', 'request_id', 'kind', 'status', 'execution_id',
	'chat_session_id', 'session_id', 'stream_key', 'original_task_base64',
	'approved_fingerprints', 'timeout_ms', 'created_at_ms', 'answered_at_ms',
	'decision_key', 'decision_id', 'decision_channel', 'resume_session_at',
	'fingerprint', 'tool_name', 'tool_input', 'questions', 'answers',
	'response_action', 'approved', 'permission_mode_override', 'reviewer_message',
	'updated_input', 'updated_at',
];

interface CapturingPool {
	pool: Pool;
	insertCalls: Array<{ sql: string; params: unknown[] }>;
}

function capturingPool(): CapturingPool {
	const insertCalls: Array<{ sql: string; params: unknown[] }> = [];
	const query = vi.fn(async (sql: string, params?: unknown[]) => {
		// The schema column-check query must report all required columns so
		// ensureSchema() succeeds; everything else is treated as a write.
		if (sql.includes('pg_attribute')) {
			return { rows: REQUIRED_COLUMNS.map((attname) => ({ attname })), rowCount: REQUIRED_COLUMNS.length };
		}
		if (sql.includes('INSERT INTO')) {
			insertCalls.push({ sql, params: params ?? [] });
		}
		return { rows: [], rowCount: 0 };
	});
	const client = { query, release: vi.fn() };
	const pool = {
		query,
		connect: vi.fn(async () => client),
	};
	return { pool: pool as unknown as Pool, insertCalls };
}

describe('PostgresHitlInteractionStore redaction', () => {
	it('masks secret values in the persisted task prompt and tool input', async () => {
		const secret = 'sk-hitl-secret-xyz';
		const { pool, insertCalls } = capturingPool();
		const store = new PostgresHitlInteractionStore({
			pool,
			workflowId: 'wf-1',
			nodeName: 'Agent',
			tableName: 'hitl_interactions',
			secretRedactor: createSecretsRedactor([secret]),
		});

		const record: ApprovalInteractionRecord = {
			kind: 'approval',
			requestId: 'req-1',
			status: 'pending',
			createdAt: 1,
			timeoutMs: 0,
			originalTaskBase64: Buffer.from(`use key ${secret}`, 'utf-8').toString('base64'),
			toolName: 'Bash',
			toolInput: { command: `curl -H "Authorization: ${secret}"` },
		};
		await store.saveInteraction(record);

		expect(insertCalls).toHaveLength(1);
		const serializedParams = JSON.stringify(insertCalls[0].params);
		expect(serializedParams).not.toContain(secret);

		// The base64 task prompt must still decode, with the secret masked.
		const persistedTaskBase64 = insertCalls[0].params[9];
		expect(typeof persistedTaskBase64).toBe('string');
		const decoded = Buffer.from(persistedTaskBase64 as string, 'base64').toString('utf-8');
		expect(decoded).toBe('use key [REDACTED]');

		// tool_input JSON must carry the masked value.
		const toolInputJson = insertCalls[0].params[20];
		expect(toolInputJson).toContain('[REDACTED]');
		expect(toolInputJson).not.toContain(secret);
	});
});
