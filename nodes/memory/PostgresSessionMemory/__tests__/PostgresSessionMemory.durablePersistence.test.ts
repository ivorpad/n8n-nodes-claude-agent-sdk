import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const postgresConnectionMocks = vi.hoisted(() => ({
	createPostgresConnectionHandle: vi.fn(),
	close: vi.fn(),
}));

vi.mock('../../../shared/postgresConnection', () => ({
	createPostgresConnectionHandle: postgresConnectionMocks.createPostgresConnectionHandle,
}));

import { PostgresSessionMemory } from '../PostgresSessionMemory.node';
import {
	deriveFullSessionTableName,
	deriveSessionEventsTableName,
	persistFullSessionToPostgresPool,
} from '../fullSessionPersistence';

function createSupplyContext(tableName: string, query: ReturnType<typeof vi.fn>) {
	return {
		parentNode: { name: 'Claude Agent SDK' },
		getCredentials: vi.fn().mockResolvedValue({ host: 'localhost', database: 'n8n' }),
		getNodeParameter: vi.fn().mockReturnValue(tableName),
		getWorkflow: vi.fn().mockReturnValue({ id: 'wf_1' }),
		getNode: vi.fn().mockReturnValue({
			name: 'Postgres Session Memory',
			type: 'postgresSessionMemory',
		}),
		helpers: {},
	} as any;
}

function createSessionMemoryPoolQuery() {
	return vi.fn(async (sql: string) => {
		if (sql.includes('pg_attribute')) {
			return { rows: [], rowCount: 0 };
		}
		return { rows: [], rowCount: 0 };
	});
}

const FULL_SESSION_COLUMNS = [
	'id',
	'tenant_id',
	'workflow_id',
	'session_name',
	'claude_session_id',
	'session_content',
	'message_count',
	'total_input_tokens',
	'total_output_tokens',
	'parent_node_name',
	'created_at',
	'updated_at',
	'last_accessed_at',
	'deleted_at',
] as const;

const SESSION_EVENT_COLUMNS = [
	'id',
	'tenant_id',
	'workflow_id',
	'session_name',
	'claude_session_id',
	'event_seq',
	'event_type',
	'event_subtype',
	'event_id',
	'message_uuid',
	'thread_id',
	'parent_tool_use_id',
	'tool_use_id',
	'tool_name',
	'role',
	'processed_at',
	'raw_event',
	'execution_id',
	'parent_node_name',
	'created_at',
	'updated_at',
] as const;

function createFullSessionQuery(options?: { relationExists?: boolean; updateRowCount?: number }) {
	const relationExists = options?.relationExists ?? false;
	const updateRowCount = options?.updateRowCount ?? 0;
	return vi.fn(async (sql: string, params?: unknown[]) => {
		if (sql.includes('pg_attribute')) {
			const tableName = String(params?.[0] ?? '');
			const columns = tableName.includes('session_events')
				? SESSION_EVENT_COLUMNS
				: FULL_SESSION_COLUMNS;
			return {
				rows: columns.map((attname) => ({ attname })),
				rowCount: columns.length,
			};
		}
		if (sql.includes('to_regclass')) {
			return {
				rows: [{ regclass: relationExists ? String(params?.[0] ?? '') : null }],
				rowCount: 1,
			};
		}
		if (sql.includes('INSERT INTO')) {
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes('UPDATE')) {
			return { rows: [], rowCount: updateRowCount };
		}
		return { rows: [], rowCount: 0 };
	});
}

describe('PostgresSessionMemory durable persistence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		postgresConnectionMocks.close.mockResolvedValue(undefined);
	});

	it('derives full-session table names from the configured memory table', () => {
		expect(deriveFullSessionTableName('claude_sessions')).toBe('claude_full_sessions');
		expect(deriveFullSessionTableName('public.claude_sessions')).toBe(
			'public.claude_full_sessions',
		);
		expect(deriveFullSessionTableName('tenant_claude_sessions_archive')).toBe(
			'tenant_claude_full_sessions_archive',
		);
		expect(deriveFullSessionTableName('session_memory')).toBe('claude_full_sessions');
	});

	it('derives session event table names from memory or full-session tables', () => {
		expect(deriveSessionEventsTableName('claude_sessions')).toBe('claude_session_events');
		expect(deriveSessionEventsTableName('public.claude_sessions')).toBe(
			'public.claude_session_events',
		);
		expect(deriveSessionEventsTableName('public.claude_full_sessions')).toBe(
			'public.claude_session_events',
		);
		expect(deriveSessionEventsTableName('session_memory')).toBe('claude_session_events');
	});

	it('exposes durable persistence using the same postgres pool as session memory', async () => {
		const query = createSessionMemoryPoolQuery();
		const pool = { query } as unknown as Pool;
		postgresConnectionMocks.createPostgresConnectionHandle.mockResolvedValue({
			pool,
			close: postgresConnectionMocks.close,
		});

		const node = new PostgresSessionMemory();
		const supplied = await node.supplyData.call(
			createSupplyContext('public.claude_sessions', query),
			0,
		);

		expect(supplied.response).toMatchObject({ type: 'claude-session-memory' });
		expect(supplied.response.durablePersistence).toMatchObject({
			backend: 'postgres',
			observabilityTableName: 'claude_invocation_observability_events',
			fullSessionTableName: 'public.claude_full_sessions',
			sessionEventsTableName: 'public.claude_session_events',
		});
		expect(postgresConnectionMocks.createPostgresConnectionHandle).toHaveBeenCalledTimes(1);
	});

	it('creates the full-session table and inserts redacted JSONL content', async () => {
		const query = createFullSessionQuery();
		const messages = [
			{ type: 'assistant', message: { content: [{ type: 'text', text: '[REDACTED]' }] } },
			{ type: 'result', session_id: 'claude_session_1' },
		];

		const result = await persistFullSessionToPostgresPool({
			pool: { query } as unknown as Pool,
			tableName: 'public.claude_full_sessions',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
				chatSessionId: 'chat_1',
				sessionId: 'claude_session_1',
			},
			messages,
			messageCount: messages.length,
			totalInputTokens: 12,
			totalOutputTokens: 4,
			parentNodeName: 'Claude_Agent_SDK',
		});

		expect(result).toMatchObject({
			backend: 'postgres',
			attempted: true,
			persisted: true,
			tableName: 'public.claude_full_sessions',
			rowCount: 1,
			eventTableName: 'public.claude_session_events',
			eventRowCount: messages.length,
		});
		expect(
			query.mock.calls.some(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS')),
		).toBe(true);
		expect(query.mock.calls.some(([sql]) => String(sql).includes('id UUID PRIMARY KEY'))).toBe(
			true,
		);

		const insertCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO'));
		expect(insertCall).toBeDefined();
		const insertParams = insertCall?.[1] as unknown[];
		expect(insertParams[0]).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
		expect(insertParams[0]).not.toEqual(expect.stringContaining('full_'));
		expect(insertParams).toEqual(
			expect.arrayContaining([
				'default',
				'wf_1',
				'chat_1',
				'claude_session_1',
				2,
				12,
				4,
				'Claude_Agent_SDK',
			]),
		);
		expect(JSON.stringify(insertParams)).toContain('[REDACTED]');
		expect(JSON.stringify(insertParams)).not.toContain('super-secret-token');
	});

	it('writes Platform-style event rows with extracted query fields', async () => {
		const query = createFullSessionQuery();
		const sessionContent = [
			JSON.stringify({
				type: 'user.message',
				id: 'sevt_user_1',
				session_thread_id: 'sthr_1',
				processed_at: '2026-06-13T05:36:40.000000Z',
				content: [{ type: 'text', text: 'hola' }],
			}),
			JSON.stringify({
				type: 'agent.message',
				id: 'sevt_agent_1',
				session_thread_id: 'sthr_1',
				processed_at: '2026-06-13T05:36:42.643975Z',
				content: [{ type: 'text', text: 'Hola' }],
			}),
			JSON.stringify({
				type: 'assistant',
				uuid: 'msg_tool_1',
				message: {
					role: 'assistant',
					content: [{ type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion' }],
				},
			}),
		].join('\n');

		await persistFullSessionToPostgresPool({
			pool: { query } as unknown as Pool,
			tableName: 'public.claude_full_sessions',
			eventTableName: 'public.claude_session_events',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
				chatSessionId: 'chat_1',
				sessionId: 'claude_session_1',
			},
			sessionContent,
			messageCount: 3,
			parentNodeName: 'Claude_Agent_SDK',
		});

		const eventInsertCalls = query.mock.calls.filter(([sql]) =>
			String(sql).includes('INSERT INTO "public"."claude_session_events"'),
		);
		expect(eventInsertCalls).toHaveLength(3);

		const agentEventParams = eventInsertCalls[1]?.[1] as unknown[];
		expect(agentEventParams).toEqual(
			expect.arrayContaining([
				'default',
				'wf_1',
				'chat_1',
				'claude_session_1',
				2,
				'agent.message',
				'sevt_agent_1',
				'sthr_1',
				'2026-06-13T05:36:42.643975Z',
				'exec_1',
				'Claude_Agent_SDK',
			]),
		);
		expect(agentEventParams[16]).toContain('"type":"agent.message"');

		const toolEventParams = eventInsertCalls[2]?.[1] as unknown[];
		expect(toolEventParams).toEqual(
			expect.arrayContaining([
				3,
				'assistant',
				'msg_tool_1',
				'toolu_1',
				'AskUserQuestion',
				'assistant',
			]),
		);
	});

	it('validates an existing full-session table before writing', async () => {
		const query = createFullSessionQuery({ relationExists: true, updateRowCount: 1 });

		await persistFullSessionToPostgresPool({
			pool: { query } as unknown as Pool,
			tableName: 'public.claude_full_sessions',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
				chatSessionId: 'chat_1',
				sessionId: 'claude_session_1',
			},
			messages: [],
			messageCount: 0,
			parentNodeName: 'Claude_Agent_SDK',
		});

		expect(query.mock.calls.some(([sql]) => String(sql).includes('pg_attribute'))).toBe(true);
		expect(query.mock.calls.some(([sql]) => String(sql).includes('CREATE TABLE'))).toBe(false);
		expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
	});
});
