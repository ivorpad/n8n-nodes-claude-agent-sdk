import type { Pool, PoolClient } from 'pg';

import {
	AppendStreamFrameInputSchema,
	EnsureStreamInputSchema,
	ReplayQuerySchema,
	StreamFrameSchema,
	StreamStateSchema,
	TerminalTransitionSchema,
} from './streamSchemas';
import type { QueryableClient } from '../../shared/postgresTypes';
import {
	asNumber,
	buildSafeIndexName,
	quoteQualifiedTableName,
	validateExistingSchema,
} from '../../shared/postgresIdentifiers';
import type {
	AppendStreamFrameArgs,
	EnsureStreamArgs,
	MarkStreamTerminalArgs,
	ReplayQuery,
	StreamFrame,
	StreamState,
	StreamStatus,
} from './streamTypes';

const DEFAULT_STREAMS_TABLE = 'claude_streams';
const DEFAULT_STREAM_EVENTS_TABLE = 'claude_stream_events';
const DEFAULT_RETENTION_HOURS = 24 * 7;

const REQUIRED_STREAM_COLUMNS = [
	'stream_key',
	'workflow_id',
	'execution_id',
	'chat_session_id',
	'request_id',
	'status',
	'next_seq',
	'last_seq',
	'created_at',
	'updated_at',
	'terminal_at',
	'expires_at',
	'error_message',
] as const;

const REQUIRED_EVENT_COLUMNS = [
	'stream_key',
	'seq',
	'event_type',
	'payload',
	'workflow_id',
	'execution_id',
	'chat_session_id',
	'request_id',
	'created_at',
] as const;

interface PoolLike extends QueryableClient {
	connect: () => Promise<PoolClient>;
}

function asIsoString(value: unknown): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === 'string') {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) {
			return new Date(parsed).toISOString();
		}
	}
	return new Date().toISOString();
}

type StreamRow = {
	stream_key: string;
	status: StreamStatus;
	last_seq: number | string;
	next_seq: number | string;
	created_at: string | Date;
	updated_at: string | Date;
	workflow_id: string | null;
	execution_id: string | null;
	chat_session_id: string | null;
	request_id: string | null;
	terminal_at: string | Date | null;
	expires_at: string | Date | null;
	error_message: string | null;
};

type EventRow = {
	stream_key: string;
	seq: number | string;
	event_type: string;
	payload: unknown;
	created_at: string | Date;
	workflow_id: string | null;
	execution_id: string | null;
	chat_session_id: string | null;
	request_id: string | null;
};

function mapStreamRow(row: StreamRow): StreamState {
	return StreamStateSchema.parse({
		streamKey: row.stream_key,
		status: row.status,
		lastSeq: asNumber(row.last_seq),
		nextSeq: asNumber(row.next_seq, 1),
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
		workflowId: row.workflow_id ?? undefined,
		executionId: row.execution_id ?? undefined,
		chatSessionId: row.chat_session_id ?? undefined,
		requestId: row.request_id ?? undefined,
		terminalAt: row.terminal_at ? asIsoString(row.terminal_at) : undefined,
		expiresAt: row.expires_at ? asIsoString(row.expires_at) : undefined,
		errorMessage: row.error_message ?? undefined,
	});
}

function mapEventRow(row: EventRow): StreamFrame {
	return StreamFrameSchema.parse({
		streamKey: row.stream_key,
		seq: asNumber(row.seq),
		eventType: row.event_type,
		createdAt: asIsoString(row.created_at),
		payload: row.payload,
		workflowId: row.workflow_id ?? undefined,
		executionId: row.execution_id ?? undefined,
		chatSessionId: row.chat_session_id ?? undefined,
		requestId: row.request_id ?? undefined,
	});
}

export interface StreamStore {
	ensureSchema(): Promise<void>;
	ensureStream(args: EnsureStreamArgs): Promise<void>;
	appendFrame(args: AppendStreamFrameArgs): Promise<StreamFrame>;
	readFramesSince(query: ReplayQuery): Promise<ReadonlyArray<StreamFrame>>;
	markTerminal(args: MarkStreamTerminalArgs): Promise<void>;
	purgeExpired(now: Date): Promise<number>;
	getStreamState(streamKey: string): Promise<StreamState | undefined>;
}

export class PostgresStreamStore implements StreamStore {
	private readonly pool: PoolLike;

	private readonly streamsTableName: string;

	private readonly streamEventsTableName: string;

	private readonly quotedStreamsTableName: string;

	private readonly quotedStreamEventsTableName: string;

	private readonly retentionHours: number;

	private schemaEnsured = false;

	constructor(args: {
		pool: Pool;
		streamsTableName?: string;
		streamEventsTableName?: string;
		retentionHours?: number;
	}) {
		this.pool = args.pool;
		this.streamsTableName = args.streamsTableName?.trim() || DEFAULT_STREAMS_TABLE;
		this.streamEventsTableName = args.streamEventsTableName?.trim() || DEFAULT_STREAM_EVENTS_TABLE;
		this.quotedStreamsTableName = quoteQualifiedTableName(this.streamsTableName);
		this.quotedStreamEventsTableName = quoteQualifiedTableName(this.streamEventsTableName);
		this.retentionHours = Math.max(1, Math.floor(args.retentionHours ?? DEFAULT_RETENTION_HOURS));
	}

	async ensureSchema(): Promise<void> {
		if (this.schemaEnsured) {
			return;
		}

		await this.ensureSingleTable({
			tableName: this.streamsTableName,
			requiredColumns: REQUIRED_STREAM_COLUMNS,
			createSql: `
				CREATE TABLE IF NOT EXISTS ${this.quotedStreamsTableName} (
					stream_key VARCHAR(255) PRIMARY KEY,
					workflow_id VARCHAR(255),
					execution_id VARCHAR(255),
					chat_session_id VARCHAR(255),
					request_id VARCHAR(255),
					status VARCHAR(32) NOT NULL,
					next_seq BIGINT NOT NULL DEFAULT 1,
					last_seq BIGINT NOT NULL DEFAULT 0,
					created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
					terminal_at TIMESTAMPTZ,
					expires_at TIMESTAMPTZ,
					error_message TEXT
				)
			`,
			indexSql: [
				`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(this.streamsTableName, 'status_expires_idx')} ON ${this.quotedStreamsTableName} (status, expires_at)`,
				`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(this.streamsTableName, 'execution_idx')} ON ${this.quotedStreamsTableName} (execution_id) WHERE execution_id IS NOT NULL`,
				`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(this.streamsTableName, 'chat_session_idx')} ON ${this.quotedStreamsTableName} (chat_session_id) WHERE chat_session_id IS NOT NULL`,
			],
		});

		await this.ensureSingleTable({
			tableName: this.streamEventsTableName,
			requiredColumns: REQUIRED_EVENT_COLUMNS,
			createSql: `
				CREATE TABLE IF NOT EXISTS ${this.quotedStreamEventsTableName} (
					stream_key VARCHAR(255) NOT NULL REFERENCES ${this.quotedStreamsTableName}(stream_key) ON DELETE CASCADE,
					seq BIGINT NOT NULL,
					event_type VARCHAR(32) NOT NULL,
					payload JSONB,
					workflow_id VARCHAR(255),
					execution_id VARCHAR(255),
					chat_session_id VARCHAR(255),
					request_id VARCHAR(255),
					created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
					PRIMARY KEY (stream_key, seq)
				)
			`,
			indexSql: [
				`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(this.streamEventsTableName, 'created_at_idx')} ON ${this.quotedStreamEventsTableName} (created_at DESC)`,
				`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(this.streamEventsTableName, 'workflow_stream_seq_idx')} ON ${this.quotedStreamEventsTableName} (workflow_id, stream_key, seq)`,
			],
		});

		this.schemaEnsured = true;
	}

	async ensureStream(args: EnsureStreamArgs): Promise<void> {
		await this.ensureSchema();

		const parsed = EnsureStreamInputSchema.parse(args);
		const createdAt = parsed.createdAt
			? new Date(parsed.createdAt)
			: new Date();
		const createdAtIso = createdAt.toISOString();

		await this.pool.query(
			`
				INSERT INTO ${this.quotedStreamsTableName} (
					stream_key,
					workflow_id,
					execution_id,
					chat_session_id,
					request_id,
					status,
					created_at,
					updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
				ON CONFLICT (stream_key)
				DO UPDATE SET
					workflow_id = COALESCE(EXCLUDED.workflow_id, ${this.quotedStreamsTableName}.workflow_id),
					execution_id = COALESCE(EXCLUDED.execution_id, ${this.quotedStreamsTableName}.execution_id),
					chat_session_id = COALESCE(EXCLUDED.chat_session_id, ${this.quotedStreamsTableName}.chat_session_id),
					request_id = COALESCE(EXCLUDED.request_id, ${this.quotedStreamsTableName}.request_id),
					status = EXCLUDED.status,
					updated_at = EXCLUDED.updated_at,
					terminal_at = CASE WHEN EXCLUDED.status = 'live' THEN NULL ELSE ${this.quotedStreamsTableName}.terminal_at END,
					expires_at = CASE WHEN EXCLUDED.status = 'live' THEN NULL ELSE ${this.quotedStreamsTableName}.expires_at END,
					error_message = CASE WHEN EXCLUDED.status = 'live' THEN NULL ELSE ${this.quotedStreamsTableName}.error_message END
			`,
			[
				parsed.streamKey,
				parsed.workflowId ?? null,
				parsed.executionId ?? null,
				parsed.chatSessionId ?? null,
				parsed.requestId ?? null,
				parsed.status,
				createdAtIso,
			],
		);
	}

	async appendFrame(args: AppendStreamFrameArgs): Promise<StreamFrame> {
		await this.ensureSchema();

		const parsed = AppendStreamFrameInputSchema.parse(args);
		const createdAt = parsed.createdAt
			? new Date(parsed.createdAt)
			: new Date();
		const createdAtIso = createdAt.toISOString();

		await this.ensureStream({
			streamKey: parsed.streamKey,
			status: 'live',
			workflowId: parsed.workflowId,
			executionId: parsed.executionId,
			chatSessionId: parsed.chatSessionId,
			requestId: parsed.requestId,
			createdAt,
		});

		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const current = await client.query<{ next_seq: number | string }>(
				`
					SELECT next_seq
					FROM ${this.quotedStreamsTableName}
					WHERE stream_key = $1
					FOR UPDATE
				`,
				[parsed.streamKey],
			);
			const seq = asNumber(current.rows[0]?.next_seq, 1);
			const payloadJson = parsed.payload === undefined
				? null
				: JSON.stringify(parsed.payload);

			await client.query(
				`
					INSERT INTO ${this.quotedStreamEventsTableName} (
						stream_key,
						seq,
						event_type,
						payload,
						workflow_id,
						execution_id,
						chat_session_id,
						request_id,
						created_at
					) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
				`,
				[
					parsed.streamKey,
					seq,
					parsed.eventType,
					payloadJson,
					parsed.workflowId ?? null,
					parsed.executionId ?? null,
					parsed.chatSessionId ?? null,
					parsed.requestId ?? null,
					createdAtIso,
				],
			);

			await client.query(
				`
					UPDATE ${this.quotedStreamsTableName}
					SET
						status = 'live',
						next_seq = $2,
						last_seq = $3,
						updated_at = $4,
						workflow_id = COALESCE($5, workflow_id),
						execution_id = COALESCE($6, execution_id),
						chat_session_id = COALESCE($7, chat_session_id),
						request_id = COALESCE($8, request_id),
						terminal_at = NULL,
						expires_at = NULL,
						error_message = NULL
					WHERE stream_key = $1
				`,
				[
					parsed.streamKey,
					seq + 1,
					seq,
					createdAtIso,
					parsed.workflowId ?? null,
					parsed.executionId ?? null,
					parsed.chatSessionId ?? null,
					parsed.requestId ?? null,
				],
			);

			await client.query('COMMIT');

			return StreamFrameSchema.parse({
				streamKey: parsed.streamKey,
				seq,
				eventType: parsed.eventType,
				createdAt: createdAtIso,
				payload: parsed.payload ?? null,
				workflowId: parsed.workflowId,
				executionId: parsed.executionId,
				chatSessionId: parsed.chatSessionId,
				requestId: parsed.requestId,
			});
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	async readFramesSince(query: ReplayQuery): Promise<ReadonlyArray<StreamFrame>> {
		await this.ensureSchema();

		const parsed = ReplayQuerySchema.parse(query);
		const result = await this.pool.query<EventRow>(
			`
				SELECT
					stream_key,
					seq,
					event_type,
					payload,
					created_at,
					workflow_id,
					execution_id,
					chat_session_id,
					request_id
				FROM ${this.quotedStreamEventsTableName}
				WHERE stream_key = $1
					AND seq > $2
				ORDER BY seq ASC
				LIMIT $3
			`,
			[parsed.streamKey, parsed.cursor, parsed.limit],
		);

		return result.rows.map(mapEventRow);
	}

	async markTerminal(args: MarkStreamTerminalArgs): Promise<void> {
		await this.ensureSchema();

		const parsed = TerminalTransitionSchema.parse(args);
		const at = parsed.at
			? new Date(parsed.at)
			: new Date();
		const atIso = at.toISOString();
		const expiresAt = new Date(at.getTime() + (this.retentionHours * 60 * 60 * 1000));

		await this.ensureStream({
			streamKey: parsed.streamKey,
			status: parsed.status,
			createdAt: at,
		});

		await this.pool.query(
			`
				UPDATE ${this.quotedStreamsTableName}
				SET
					status = $2,
					updated_at = $3,
					terminal_at = $3,
					expires_at = $4,
					error_message = $5
				WHERE stream_key = $1
			`,
			[
				parsed.streamKey,
				parsed.status,
				atIso,
				expiresAt.toISOString(),
				parsed.errorMessage ?? null,
			],
		);
	}

	async purgeExpired(now: Date): Promise<number> {
		await this.ensureSchema();

		const result = await this.pool.query(
			`
				DELETE FROM ${this.quotedStreamsTableName}
				WHERE expires_at IS NOT NULL
					AND expires_at <= $1
			`,
			[now.toISOString()],
		);

		return result.rowCount ?? 0;
	}

	async getStreamState(streamKey: string): Promise<StreamState | undefined> {
		await this.ensureSchema();

		const result = await this.pool.query<StreamRow>(
			`
				SELECT
					stream_key,
					status,
					last_seq,
					next_seq,
					created_at,
					updated_at,
					workflow_id,
					execution_id,
					chat_session_id,
					request_id,
					terminal_at,
					expires_at,
					error_message
				FROM ${this.quotedStreamsTableName}
				WHERE stream_key = $1
			`,
			[streamKey],
		);

		const row = result.rows[0];
		return row ? mapStreamRow(row) : undefined;
	}

	private async ensureSingleTable(args: {
		tableName: string;
		requiredColumns: readonly string[];
		createSql: string;
		indexSql: string[];
	}): Promise<void> {
		const relationResult = await this.pool.query<{ regclass: string | null }>(
			'SELECT to_regclass($1) AS regclass',
			[args.tableName],
		);
		const relationExists = relationResult.rows[0]?.regclass !== null;

		if (relationExists) {
			await validateExistingSchema(this.pool, args.tableName, args.requiredColumns, 'Stream table');
			return;
		}

		await this.pool.query(args.createSql);
		for (const statement of args.indexSql) {
			await this.pool.query(statement);
		}
	}
}
