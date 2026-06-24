import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
	buildSafeIndexName,
	quoteQualifiedTableName,
	validateExistingSchema,
} from '../../shared/postgresIdentifiers';
import type {
	DurablePersistenceResult,
	DurableSessionPersistenceContext,
} from '../../ClaudeAgentSdk/types';

const TENANT_ID = 'default';

const REQUIRED_FULL_SESSION_COLUMNS = [
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

const REQUIRED_SESSION_EVENT_COLUMNS = [
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

interface ParsedSessionEvent {
	eventSeq: number;
	eventType: string | undefined;
	eventSubtype: string | undefined;
	eventId: string | undefined;
	messageUuid: string | undefined;
	threadId: string | undefined;
	parentToolUseId: string | undefined;
	toolUseId: string | undefined;
	toolName: string | undefined;
	role: string | undefined;
	processedAt: string | undefined;
	rawEvent: unknown;
}

export function deriveFullSessionTableName(memoryTableName: string): string {
	const trimmed = memoryTableName.trim();
	if (!trimmed) {
		return 'claude_full_sessions';
	}
	if (trimmed.includes('claude_sessions')) {
		return trimmed.replace('claude_sessions', 'claude_full_sessions');
	}
	return 'claude_full_sessions';
}

export function deriveSessionEventsTableName(memoryOrFullSessionTableName: string): string {
	const trimmed = memoryOrFullSessionTableName.trim();
	if (!trimmed) {
		return 'claude_session_events';
	}
	if (trimmed.includes('claude_sessions')) {
		return trimmed.replace('claude_sessions', 'claude_session_events');
	}
	if (trimmed.includes('claude_full_sessions')) {
		return trimmed.replace('claude_full_sessions', 'claude_session_events');
	}
	return 'claude_session_events';
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asTimestampString(value: unknown): string | undefined {
	const text = asNonEmptyString(value);
	if (!text) {
		return undefined;
	}
	return Number.isNaN(Date.parse(text)) ? undefined : text;
}

function getNestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	return asRecord(record?.[key]);
}

function getStringFromPath(
	record: Record<string, unknown> | undefined,
	path: readonly string[],
): string | undefined {
	let current = record;
	for (let index = 0; index < path.length; index += 1) {
		const key = path[index];
		if (!key) {
			return undefined;
		}
		const value = current?.[key];
		if (index === path.length - 1) {
			return asNonEmptyString(value);
		}
		current = asRecord(value);
	}
	return undefined;
}

function firstStringFromPaths(
	record: Record<string, unknown> | undefined,
	paths: readonly (readonly string[])[],
): string | undefined {
	for (const path of paths) {
		const value = getStringFromPath(record, path);
		if (value) {
			return value;
		}
	}
	return undefined;
}

function resolveWorkflowId(context: DurableSessionPersistenceContext): string {
	return String(context.workflowId ?? '__unknown_workflow__');
}

function resolveSessionName(context: DurableSessionPersistenceContext): string {
	return (
		asNonEmptyString(context.chatSessionId) ??
		asNonEmptyString(context.sessionId) ??
		'__unknown_session__'
	);
}

function serializeJsonl(messages: unknown[]): string {
	return messages
		.map((message) => JSON.stringify(message))
		.filter((line): line is string => typeof line === 'string')
		.join('\n');
}

function parseSessionContentEvents(sessionContent: string): unknown[] {
	return sessionContent
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			try {
				return JSON.parse(line) as unknown;
			} catch {
				return { raw: line };
			}
		});
}

function getContentBlocks(
	record: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
	const directContent = record?.content;
	if (Array.isArray(directContent)) {
		return directContent
			.map((block) => asRecord(block))
			.filter((block): block is Record<string, unknown> => Boolean(block));
	}

	const messageContent = getNestedRecord(record, 'message')?.content;
	if (Array.isArray(messageContent)) {
		return messageContent
			.map((block) => asRecord(block))
			.filter((block): block is Record<string, unknown> => Boolean(block));
	}

	return [];
}

function firstContentBlockByType(
	record: Record<string, unknown> | undefined,
	types: readonly string[],
): Record<string, unknown> | undefined {
	return getContentBlocks(record).find((block) => {
		const blockType = asNonEmptyString(block.type);
		return Boolean(blockType && types.includes(blockType));
	});
}

function extractToolUseId(record: Record<string, unknown> | undefined): string | undefined {
	const topLevel = firstStringFromPaths(record, [['tool_use_id'], ['toolUseId'], ['tool', 'id']]);
	if (topLevel) {
		return topLevel;
	}
	const toolBlock = firstContentBlockByType(record, ['tool_use', 'tool_result']);
	return firstStringFromPaths(toolBlock, [['id'], ['tool_use_id'], ['toolUseId']]);
}

function extractToolName(record: Record<string, unknown> | undefined): string | undefined {
	const topLevel = firstStringFromPaths(record, [
		['tool_name'],
		['toolName'],
		['name'],
		['tool', 'name'],
	]);
	if (topLevel) {
		return topLevel;
	}
	const toolBlock = firstContentBlockByType(record, ['tool_use']);
	return firstStringFromPaths(toolBlock, [['name'], ['tool_name'], ['toolName']]);
}

function extractRole(record: Record<string, unknown> | undefined): string | undefined {
	const explicitRole = firstStringFromPaths(record, [['role'], ['message', 'role']]);
	if (explicitRole) {
		return explicitRole;
	}
	const type = asNonEmptyString(record?.type);
	return type === 'assistant' || type === 'user' || type === 'system' ? type : undefined;
}

function buildSessionEvents(sessionContent: string): ParsedSessionEvent[] {
	return parseSessionContentEvents(sessionContent).map((rawEvent, index) => {
		const record = asRecord(rawEvent);
		return {
			eventSeq: index + 1,
			eventType: asNonEmptyString(record?.type),
			eventSubtype: asNonEmptyString(record?.subtype),
			eventId: asNonEmptyString(record?.id),
			messageUuid: firstStringFromPaths(record, [['uuid'], ['message', 'id'], ['message', 'uuid']]),
			threadId: firstStringFromPaths(record, [
				['thread_id'],
				['threadId'],
				['session_thread_id'],
				['sessionThreadId'],
				['thread', 'id'],
			]),
			parentToolUseId: firstStringFromPaths(record, [['parent_tool_use_id'], ['parentToolUseId']]),
			toolUseId: extractToolUseId(record),
			toolName: extractToolName(record),
			role: extractRole(record),
			processedAt: asTimestampString(
				firstStringFromPaths(record, [
					['processed_at'],
					['processedAt'],
					['timestamp'],
					['created_at'],
					['createdAt'],
				]),
			),
			rawEvent,
		};
	});
}

async function ensureFullSessionSchema(pool: Pool, tableName: string): Promise<string> {
	const quotedTableName = quoteQualifiedTableName(tableName, 'Postgres full session');
	const relationResult = await pool.query<{ regclass: string | null }>(
		'SELECT to_regclass($1) AS regclass',
		[tableName],
	);
	const relationExists = relationResult.rows[0]?.regclass !== null;

	if (relationExists) {
		await validateExistingSchema(
			pool,
			tableName,
			REQUIRED_FULL_SESSION_COLUMNS,
			'Full session table',
		);
		return quotedTableName;
	}

	await pool.query(`
		CREATE TABLE IF NOT EXISTS ${quotedTableName} (
			id UUID PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			workflow_id TEXT NOT NULL,
			session_name TEXT NOT NULL,
			claude_session_id TEXT NOT NULL,
			session_content TEXT NOT NULL,
			message_count INTEGER,
			total_input_tokens BIGINT,
			total_output_tokens BIGINT,
			parent_node_name TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMPTZ,
			UNIQUE (tenant_id, workflow_id, session_name)
		)
	`);

	await pool.query(
		`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(tableName, 'workflow_session_idx')} ` +
			`ON ${quotedTableName} (tenant_id, workflow_id, session_name)`,
	);
	await pool.query(
		`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(tableName, 'updated_idx')} ` +
			`ON ${quotedTableName} (updated_at DESC)`,
	);

	return quotedTableName;
}

async function ensureSessionEventsSchema(pool: Pool, tableName: string): Promise<string> {
	const quotedTableName = quoteQualifiedTableName(tableName, 'Postgres session events');
	const relationResult = await pool.query<{ regclass: string | null }>(
		'SELECT to_regclass($1) AS regclass',
		[tableName],
	);
	const relationExists = relationResult.rows[0]?.regclass !== null;

	if (relationExists) {
		await validateExistingSchema(
			pool,
			tableName,
			REQUIRED_SESSION_EVENT_COLUMNS,
			'Session event table',
		);
		return quotedTableName;
	}

	await pool.query(`
		CREATE TABLE IF NOT EXISTS ${quotedTableName} (
			id UUID PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			workflow_id TEXT NOT NULL,
			session_name TEXT NOT NULL,
			claude_session_id TEXT NOT NULL,
			event_seq INTEGER NOT NULL,
			event_type TEXT,
			event_subtype TEXT,
			event_id TEXT,
			message_uuid TEXT,
			thread_id TEXT,
			parent_tool_use_id TEXT,
			tool_use_id TEXT,
			tool_name TEXT,
			role TEXT,
			processed_at TIMESTAMPTZ,
			raw_event JSONB NOT NULL,
			execution_id TEXT,
			parent_node_name TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (tenant_id, workflow_id, session_name, event_seq)
		)
	`);

	await pool.query(
		`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(tableName, 'session_timeline_idx')} ` +
			`ON ${quotedTableName} (tenant_id, workflow_id, session_name, event_seq)`,
	);
	await pool.query(
		`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(tableName, 'event_type_time_idx')} ` +
			`ON ${quotedTableName} (tenant_id, workflow_id, event_type, processed_at DESC)`,
	);
	await pool.query(
		`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(tableName, 'tool_time_idx')} ` +
			`ON ${quotedTableName} (tenant_id, workflow_id, tool_name, processed_at DESC) ` +
			'WHERE tool_name IS NOT NULL',
	);

	return quotedTableName;
}

async function upsertFullSession(args: {
	pool: Pool;
	quotedTableName: string;
	context: DurableSessionPersistenceContext;
	sessionContent: string;
	messageCount: number;
	totalInputTokens?: number;
	totalOutputTokens?: number;
	parentNodeName?: string;
}): Promise<number> {
	const {
		pool,
		quotedTableName,
		context,
		sessionContent,
		messageCount,
		totalInputTokens,
		totalOutputTokens,
		parentNodeName,
	} = args;
	const workflowId = resolveWorkflowId(context);
	const sessionName = resolveSessionName(context);
	const claudeSessionId = asNonEmptyString(context.sessionId) ?? sessionName;
	const nodeName =
		asNonEmptyString(parentNodeName) ?? asNonEmptyString(context.nodeName) ?? 'default';

	const updateResult = await pool.query(
		`
			UPDATE ${quotedTableName}
			SET
				claude_session_id = $4,
				session_content = $5,
				message_count = $6,
				total_input_tokens = $7,
				total_output_tokens = $8,
				parent_node_name = $9,
				updated_at = CURRENT_TIMESTAMP,
				last_accessed_at = CURRENT_TIMESTAMP,
				deleted_at = NULL
			WHERE tenant_id = $1
				AND workflow_id = $2
				AND session_name = $3
		`,
		[
			TENANT_ID,
			workflowId,
			sessionName,
			claudeSessionId,
			sessionContent,
			messageCount,
			totalInputTokens ?? null,
			totalOutputTokens ?? null,
			nodeName,
		],
	);
	if ((updateResult.rowCount ?? 0) > 0) {
		return updateResult.rowCount ?? 0;
	}

	const insertResult = await pool.query(
		`
			INSERT INTO ${quotedTableName} (
				id,
				tenant_id,
				workflow_id,
				session_name,
				claude_session_id,
				session_content,
				message_count,
				total_input_tokens,
				total_output_tokens,
				parent_node_name,
				created_at,
				updated_at,
				last_accessed_at,
				deleted_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
		`,
		[
			randomUUID(),
			TENANT_ID,
			workflowId,
			sessionName,
			claudeSessionId,
			sessionContent,
			messageCount,
			totalInputTokens ?? null,
			totalOutputTokens ?? null,
			nodeName,
		],
	);
	return insertResult.rowCount ?? 0;
}

async function replaceSessionEvents(args: {
	pool: Pool;
	quotedTableName: string;
	context: DurableSessionPersistenceContext;
	sessionContent: string;
	parentNodeName?: string;
}): Promise<number> {
	const { pool, quotedTableName, context, sessionContent, parentNodeName } = args;
	const workflowId = resolveWorkflowId(context);
	const sessionName = resolveSessionName(context);
	const claudeSessionId = asNonEmptyString(context.sessionId) ?? sessionName;
	const nodeName =
		asNonEmptyString(parentNodeName) ?? asNonEmptyString(context.nodeName) ?? 'default';
	const events = buildSessionEvents(sessionContent);

	await pool.query(
		`
			DELETE FROM ${quotedTableName}
			WHERE tenant_id = $1
				AND workflow_id = $2
				AND session_name = $3
		`,
		[TENANT_ID, workflowId, sessionName],
	);

	let insertedRows = 0;
	for (const event of events) {
		const insertResult = await pool.query(
			`
				INSERT INTO ${quotedTableName} (
					id,
					tenant_id,
					workflow_id,
					session_name,
					claude_session_id,
					event_seq,
					event_type,
					event_subtype,
					event_id,
					message_uuid,
					thread_id,
					parent_tool_use_id,
					tool_use_id,
					tool_name,
					role,
					processed_at,
					raw_event,
					execution_id,
					parent_node_name,
					created_at,
					updated_at
				)
				VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
					$11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19,
					CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
				)
				ON CONFLICT (tenant_id, workflow_id, session_name, event_seq)
				DO UPDATE SET
					claude_session_id = EXCLUDED.claude_session_id,
					event_type = EXCLUDED.event_type,
					event_subtype = EXCLUDED.event_subtype,
					event_id = EXCLUDED.event_id,
					message_uuid = EXCLUDED.message_uuid,
					thread_id = EXCLUDED.thread_id,
					parent_tool_use_id = EXCLUDED.parent_tool_use_id,
					tool_use_id = EXCLUDED.tool_use_id,
					tool_name = EXCLUDED.tool_name,
					role = EXCLUDED.role,
					processed_at = EXCLUDED.processed_at,
					raw_event = EXCLUDED.raw_event,
					execution_id = EXCLUDED.execution_id,
					parent_node_name = EXCLUDED.parent_node_name,
					updated_at = CURRENT_TIMESTAMP
			`,
			[
				randomUUID(),
				TENANT_ID,
				workflowId,
				sessionName,
				claudeSessionId,
				event.eventSeq,
				event.eventType ?? null,
				event.eventSubtype ?? null,
				event.eventId ?? null,
				event.messageUuid ?? null,
				event.threadId ?? null,
				event.parentToolUseId ?? null,
				event.toolUseId ?? null,
				event.toolName ?? null,
				event.role ?? null,
				event.processedAt ?? null,
				JSON.stringify(event.rawEvent),
				asNonEmptyString(context.executionId) ?? null,
				nodeName,
			],
		);
		insertedRows += insertResult.rowCount ?? 0;
	}

	return insertedRows;
}

export async function persistFullSessionToPostgresPool(args: {
	pool: Pool;
	tableName: string;
	eventTableName?: string;
	context: DurableSessionPersistenceContext;
	messages?: unknown[];
	sessionContent?: string;
	messageCount: number;
	totalInputTokens?: number;
	totalOutputTokens?: number;
	parentNodeName?: string;
}): Promise<DurablePersistenceResult> {
	const {
		pool,
		tableName,
		eventTableName = deriveSessionEventsTableName(tableName),
		context,
		messages = [],
		sessionContent: providedSessionContent,
		messageCount,
		totalInputTokens,
		totalOutputTokens,
		parentNodeName,
	} = args;
	const sessionContent = providedSessionContent ?? serializeJsonl(messages);
	const quotedTableName = await ensureFullSessionSchema(pool, tableName);
	const quotedEventTableName = await ensureSessionEventsSchema(pool, eventTableName);

	await pool.query('BEGIN');
	try {
		const rowCount = await upsertFullSession({
			pool,
			quotedTableName,
			context,
			sessionContent,
			messageCount,
			totalInputTokens,
			totalOutputTokens,
			parentNodeName,
		});
		const eventRowCount = await replaceSessionEvents({
			pool,
			quotedTableName: quotedEventTableName,
			context,
			sessionContent,
			parentNodeName,
		});
		await pool.query('COMMIT');
		return {
			backend: 'postgres',
			attempted: true,
			persisted: true,
			tableName,
			eventTableName,
			rowCount,
			eventRowCount,
		};
	} catch (error) {
		await pool.query('ROLLBACK');
		throw error;
	}
}
