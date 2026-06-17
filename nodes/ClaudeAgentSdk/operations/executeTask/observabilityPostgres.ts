import { ApplicationError, type IExecuteFunctions } from 'n8n-workflow';
import type { Pool } from 'pg';

import {
	createPostgresConnectionHandle,
	type N8nPostgresCredential,
} from '../../../shared/postgresConnection';
import type { InvocationObservabilityCollector } from './observability';
import {
	quoteQualifiedTableName,
	validateExistingSchema,
} from '../../../shared/postgresIdentifiers';

const DEFAULT_TABLE_NAME = 'claude_invocation_observability_events';
const DEFAULT_CREDENTIAL_NAME = 'postgres';

const REQUIRED_COLUMNS = [
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
] as const;

type ObservabilityPersistenceBackend = 'auto' | 'runDataOnly' | 'postgres';

interface ObservabilityPersistenceConfig {
	backend: ObservabilityPersistenceBackend;
	strict: boolean;
	tableName: string;
	credentialName: string;
}

interface ObservabilityPersistenceContext {
	workflowId?: string | number;
	nodeName: string;
	executionId?: string;
	itemIndex: number;
	chatSessionId?: string;
	sessionId?: string;
	correlationId?: string;
	requestId?: string;
}

export type ObservabilityPersistenceStatus = 'completed' | 'paused_hitl' | 'failed';

export interface ObservabilityPersistenceResult {
	backend: ObservabilityPersistenceBackend;
	attempted: boolean;
	persisted: boolean;
	tableName?: string;
	rowCount: number;
	error?: string;
	invocationId?: string;
}

interface PersistInvocationArgs {
	execFunctions: IExecuteFunctions;
	collector: InvocationObservabilityCollector;
	context: ObservabilityPersistenceContext;
	terminalStatus: ObservabilityPersistenceStatus;
	config: ObservabilityPersistenceConfig;
}

interface PersistableEventRow {
	invocationId: string;
	workflowId: string;
	nodeName: string;
	executionId: string | null;
	itemIndex: number;
	chatSessionId: string | null;
	sessionId: string | null;
	correlationId: string | null;
	requestId: string | null;
	terminalStatus: ObservabilityPersistenceStatus;
	eventId: string;
	eventType: string;
	level: 'info' | 'warn' | 'error';
	status: string | null;
	toolName: string | null;
	durationMs: number | null;
	eventTs: string;
	payload: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown): string {
	if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
		return value;
	}
	return new Date().toISOString();
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;
}

function extractRequestId(
	payload: Record<string, unknown> | undefined,
	fallback?: string,
): string | undefined {
	if (!payload) return fallback;
	const direct = asNonEmptyString(payload.requestId);
	if (direct) return direct;
	const nested = payload.data;
	if (isRecord(nested)) {
		return asNonEmptyString(nested.requestId) ?? fallback;
	}
	return fallback;
}

function buildInvocationId(context: ObservabilityPersistenceContext): string {
	const executionId = asNonEmptyString(context.executionId) ?? 'no_execution';
	const nodeName = context.nodeName.replace(/\s+/g, '_').slice(0, 64);
	const itemIndex = context.itemIndex;
	const correlationId = asNonEmptyString(context.correlationId) ?? 'no_corr';
	const entropy = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	return `inv_${executionId}_${nodeName}_${itemIndex}_${correlationId}_${entropy}`;
}

export function parseObservabilityPersistenceConfig(
	executionSettings: Record<string, unknown>,
): ObservabilityPersistenceConfig {
	const backend = executionSettings.observabilityPersistenceBackend === 'postgres'
		? 'postgres'
		: (executionSettings.observabilityPersistenceBackend === 'runDataOnly'
			? 'runDataOnly'
			: 'auto');
	const strict = executionSettings.observabilityPersistenceStrict === true;
	const tableName = asNonEmptyString(executionSettings.observabilityPostgresTable)
		?? DEFAULT_TABLE_NAME;
	const credentialName = asNonEmptyString(executionSettings.observabilityPostgresCredentialName)
		?? DEFAULT_CREDENTIAL_NAME;

	return {
		backend,
		strict,
		tableName,
		credentialName,
	};
}

async function ensureSchema(
	pool: Pool,
	tableName: string,
): Promise<string> {
	const queryTableName = quoteQualifiedTableName(tableName);
	const relationResult = await pool.query<{ regclass: string | null }>(
		'SELECT to_regclass($1) AS regclass',
		[tableName],
	);
	const relationExists = relationResult.rows[0]?.regclass !== null;

	if (relationExists) {
		await validateExistingSchema(pool, tableName, REQUIRED_COLUMNS, 'Observability table');
		return queryTableName;
	}

	await pool.query(`
		CREATE TABLE IF NOT EXISTS ${queryTableName} (
			id BIGSERIAL PRIMARY KEY,
			invocation_id VARCHAR(255) NOT NULL,
			workflow_id VARCHAR(255) NOT NULL,
			node_name VARCHAR(255) NOT NULL,
			execution_id VARCHAR(255),
			item_index INTEGER NOT NULL,
			chat_session_id VARCHAR(255),
			session_id VARCHAR(255),
			correlation_id VARCHAR(255),
			request_id VARCHAR(255),
			terminal_status VARCHAR(32) NOT NULL,
			event_id VARCHAR(255) NOT NULL,
			event_type VARCHAR(255) NOT NULL,
			level VARCHAR(16) NOT NULL,
			status VARCHAR(64),
			tool_name VARCHAR(255),
			duration_ms INTEGER,
			event_ts TIMESTAMPTZ NOT NULL,
			payload JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (invocation_id, event_id)
		)
	`);

	await pool.query(`CREATE INDEX IF NOT EXISTS idx_obs_events_workflow_node_ts ON ${queryTableName} (workflow_id, node_name, event_ts DESC)`);
	await pool.query(`CREATE INDEX IF NOT EXISTS idx_obs_events_execution_item_ts ON ${queryTableName} (execution_id, item_index, event_ts DESC)`);
	await pool.query(`CREATE INDEX IF NOT EXISTS idx_obs_events_chat_session_ts ON ${queryTableName} (chat_session_id, event_ts DESC)`);
	await pool.query(`CREATE INDEX IF NOT EXISTS idx_obs_events_event_type_ts ON ${queryTableName} (event_type, event_ts DESC)`);
	await pool.query(`CREATE INDEX IF NOT EXISTS idx_obs_events_tool_ts ON ${queryTableName} (tool_name, event_ts DESC) WHERE tool_name IS NOT NULL`);
	await pool.query(`CREATE INDEX IF NOT EXISTS idx_obs_events_request_ts ON ${queryTableName} (request_id, event_ts DESC) WHERE request_id IS NOT NULL`);

	return queryTableName;
}

function buildEventRows(args: {
	invocationId: string;
	workflowId: string;
	nodeName: string;
	executionId: string | null;
	itemIndex: number;
	chatSessionId: string | null;
	sessionId: string | null;
	correlationId: string | null;
	terminalStatus: ObservabilityPersistenceStatus;
	contextRequestId?: string;
	collector: InvocationObservabilityCollector;
}): PersistableEventRow[] {
	const {
		invocationId,
		workflowId,
		nodeName,
		executionId,
		itemIndex,
		chatSessionId,
		sessionId,
		correlationId,
		terminalStatus,
		contextRequestId,
		collector,
	} = args;
	const snapshot = collector.toTaskResultObservability();

	const rows: PersistableEventRow[] = snapshot.events.map((event) => {
		const payload = isRecord(event.payload) ? event.payload : undefined;
		const requestId = extractRequestId(payload, contextRequestId);
		return {
			invocationId,
			workflowId,
			nodeName,
			executionId,
			itemIndex,
			chatSessionId,
			sessionId,
			correlationId,
			requestId: requestId ?? null,
			terminalStatus,
			eventId: event.eventId,
			eventType: event.eventType,
			level: event.level,
			status: asNonEmptyString(event.status) ?? null,
			toolName: asNonEmptyString(event.toolName) ?? null,
			durationMs: typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
				? Math.floor(event.durationMs)
				: null,
			eventTs: normalizeTimestamp(event.timestamp),
			payload: payload ?? null,
		};
	});

	rows.push({
		invocationId,
		workflowId,
		nodeName,
		executionId,
		itemIndex,
		chatSessionId,
		sessionId,
		correlationId,
		requestId: contextRequestId ?? null,
		terminalStatus,
		eventId: `${invocationId}_summary`,
		eventType: 'invocation.summary',
		level: 'info',
		status: terminalStatus,
		toolName: null,
		durationMs: null,
		eventTs: normalizeTimestamp(snapshot.summary.lastTs ?? snapshot.summary.firstTs),
		payload: {
			summary: snapshot.summary,
		},
	});

	return rows;
}

async function insertEventRows(
	pool: Pool,
	queryTableName: string,
	rows: PersistableEventRow[],
): Promise<number> {
	if (rows.length === 0) return 0;

	let inserted = 0;
	const query = `
		INSERT INTO ${queryTableName} (
			invocation_id,
			workflow_id,
			node_name,
			execution_id,
			item_index,
			chat_session_id,
			session_id,
			correlation_id,
			request_id,
			terminal_status,
			event_id,
			event_type,
			level,
			status,
			tool_name,
			duration_ms,
			event_ts,
			payload
		)
		VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb
		)
		ON CONFLICT (invocation_id, event_id) DO NOTHING
	`;

	for (const row of rows) {
		const result = await pool.query(query, [
			row.invocationId,
			row.workflowId,
			row.nodeName,
			row.executionId,
			row.itemIndex,
			row.chatSessionId,
			row.sessionId,
			row.correlationId,
			row.requestId,
			row.terminalStatus,
			row.eventId,
			row.eventType,
			row.level,
			row.status,
			row.toolName,
			row.durationMs,
			row.eventTs,
			row.payload ? JSON.stringify(row.payload) : null,
		]);
		inserted += result.rowCount ?? 0;
	}

	return inserted;
}

export async function persistInvocationObservability(
	args: PersistInvocationArgs,
): Promise<ObservabilityPersistenceResult> {
	const {
		execFunctions,
		collector,
		context,
		terminalStatus,
		config,
	} = args;

	if (config.backend === 'runDataOnly') {
		return {
			backend: config.backend,
			attempted: false,
			persisted: false,
			rowCount: 0,
		};
	}

	let credential: N8nPostgresCredential | undefined;
	if (config.backend === 'auto') {
		try {
			credential = await execFunctions.getCredentials(
				config.credentialName,
			) as N8nPostgresCredential;
		} catch {
			const message = `Postgres credential "${config.credentialName}" is not configured on Claude Agent SDK node; auto mode will keep run-data-only observability`;
			return {
				backend: config.backend,
				attempted: false,
				persisted: false,
				rowCount: 0,
				error: message,
			};
		}
	}

	const invocationId = buildInvocationId(context);
	const workflowId = String(context.workflowId ?? '__unknown_workflow__');
	const nodeName = context.nodeName || '__unknown_node__';
	const executionId = asNonEmptyString(context.executionId) ?? null;
	const chatSessionId = asNonEmptyString(context.chatSessionId) ?? null;
	const sessionId = asNonEmptyString(context.sessionId) ?? null;
	const correlationId = asNonEmptyString(context.correlationId) ?? null;
	const rows = buildEventRows({
		invocationId,
		workflowId,
		nodeName,
		executionId,
		itemIndex: context.itemIndex,
		chatSessionId,
		sessionId,
		correlationId,
		terminalStatus,
		contextRequestId: asNonEmptyString(context.requestId),
		collector,
	});

	try {
		if (!credential) {
			credential = await execFunctions.getCredentials(
				config.credentialName,
			) as N8nPostgresCredential;
		}
		const handle = await createPostgresConnectionHandle({
			execFunctions,
			credential,
		});

		try {
			const queryTableName = await ensureSchema(handle.pool, config.tableName);
			await handle.pool.query('BEGIN');
			try {
				const inserted = await insertEventRows(handle.pool, queryTableName, rows);
				await handle.pool.query('COMMIT');
				return {
					backend: config.backend,
					attempted: true,
					persisted: true,
					tableName: config.tableName,
					rowCount: inserted,
					invocationId,
				};
			} catch (error) {
				await handle.pool.query('ROLLBACK');
				throw error;
			}
		} finally {
			await handle.close();
		}
	} catch (error) {
		const message = (error as Error).message;
		if (config.strict) {
			throw new ApplicationError(
				`Failed to persist observability events to Postgres table "${config.tableName}": ${message}`,
			);
		}

		console.warn(
			`[Claude Agent SDK] Observability persistence skipped: ${message}`,
		);
		return {
			backend: config.backend,
			attempted: true,
			persisted: false,
			tableName: config.tableName,
			rowCount: 0,
			error: message,
			invocationId,
		};
	}
}
