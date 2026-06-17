import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';
import type { Pool } from 'pg';

import {
	createPostgresConnectionHandle,
	type N8nPostgresCredential,
} from '../../shared/postgresConnection';
import {
	asNumber,
	buildSafeIndexName,
	quoteQualifiedTableName,
} from '../../shared/postgresIdentifiers';
import type {
	PendingCompanionConsumeResult,
	PendingCompanionHitlRecord,
} from './types';

type StoreContext = IExecuteFunctions | IWebhookFunctions;

export interface PostgresPendingStoreConfig {
	tableName: string;
	credentialName?: string;
	channel: string;
}

interface PendingStoreRow {
	request_id: string;
	kind: string;
	status: string;
	created_at_ms: string | number;
	consumed_at_ms: string | number | null;
	consumed_decision_key: string | null;
	timeout_ms: string | number;
	payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeContextIdentity(ctx: StoreContext): { workflowId: string; nodeName: string } {
	const workflowId = String(ctx.getWorkflow().id ?? '__unknown_workflow__');
	const nodeName = ctx.getNode().name || '__unknown_node__';
	return { workflowId, nodeName };
}

function rowToRecord<TRecord extends PendingCompanionHitlRecord>(row: PendingStoreRow): TRecord {
	const payload = isRecord(row.payload) ? row.payload : {};

	return {
		...payload,
		requestId: row.request_id,
		kind: row.kind as PendingCompanionHitlRecord['kind'],
		status: row.status as PendingCompanionHitlRecord['status'],
		createdAt: asNumber(row.created_at_ms),
		consumedAt: row.consumed_at_ms == null ? undefined : asNumber(row.consumed_at_ms),
		consumedDecisionKey: row.consumed_decision_key ?? undefined,
		timeoutMs: asNumber(row.timeout_ms),
	} as TRecord;
}

async function withPool<TResult>(
	ctx: StoreContext,
	config: PostgresPendingStoreConfig,
	fn: (args: {
		queryTableName: string;
		workflowId: string;
		nodeName: string;
		pool: Pool;
	}) => Promise<TResult>,
): Promise<TResult> {
	const credentialName = config.credentialName?.trim() || 'postgres';
	const credential = await ctx.getCredentials(credentialName) as N8nPostgresCredential;
	const handle = await createPostgresConnectionHandle({
		execFunctions: ctx,
		credential,
	});
	const { workflowId, nodeName } = normalizeContextIdentity(ctx);
	const queryTableName = quoteQualifiedTableName(config.tableName);

	try {
		await ensureSchema(handle.pool, queryTableName, config.tableName);
		return await fn({ queryTableName, workflowId, nodeName, pool: handle.pool });
	} finally {
		await handle.close();
	}
}

/**
 * Build the per-table index DDL for the pending store.
 *
 * Index names are derived from the (raw) table name (V13, finding 1.3): constant
 * names caused a silent collision when two workflows used different pending-store
 * tables in one schema — the second `CREATE INDEX IF NOT EXISTS` became a no-op,
 * leaving that table's lookups unindexed. `quotedTableName` is the safely-quoted
 * identifier used in the `ON` clause; `rawTableName` is the unquoted base used to
 * derive a unique, safe index name.
 */
export function buildPendingIndexStatements(quotedTableName: string, rawTableName: string): string[] {
	return [
		`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(rawTableName, 'pending_status')} ON ${quotedTableName} (workflow_id, node_name, status)`,
		`CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(rawTableName, 'pending_provider_msg')} ON ${quotedTableName} (workflow_id, node_name, provider_message_id)`,
	];
}

async function ensureSchema(
	pool: Pool,
	tableName: string,
	rawTableName: string,
): Promise<void> {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id BIGSERIAL PRIMARY KEY,
			workflow_id VARCHAR(255) NOT NULL,
			node_name VARCHAR(255) NOT NULL,
			request_id VARCHAR(255) NOT NULL,
			channel VARCHAR(64) NOT NULL,
			kind VARCHAR(32) NOT NULL,
			status VARCHAR(16) NOT NULL,
			created_at_ms BIGINT NOT NULL,
			consumed_at_ms BIGINT,
			consumed_decision_key TEXT,
			timeout_ms BIGINT NOT NULL DEFAULT 0,
			recipient_id TEXT,
			provider_message_id TEXT,
			provider_conversation_id TEXT,
			provider_metadata JSONB,
			payload JSONB NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (workflow_id, node_name, request_id)
		)
	`);

	for (const statement of buildPendingIndexStatements(tableName, rawTableName)) {
		await pool.query(statement);
	}
}

export async function savePendingHitlRecordPostgres<TRecord extends PendingCompanionHitlRecord>(
	ctx: StoreContext,
	record: TRecord,
	config: PostgresPendingStoreConfig,
): Promise<void> {
	await withPool(ctx, config, async ({ queryTableName, workflowId, nodeName, pool }) => {
		const payload = { ...record, channel: record.channel ?? config.channel };
		const recipientId = record.recipientId ?? null;
		const providerMessageId = record.providerMessageId ?? null;
		const providerConversationId = record.providerConversationId ?? null;
		const providerMetadata = record.providerMetadata ?? null;

		await pool.query(
			`
				INSERT INTO ${queryTableName} (
					workflow_id,
					node_name,
					request_id,
					channel,
					kind,
					status,
					created_at_ms,
					consumed_at_ms,
					consumed_decision_key,
					timeout_ms,
					recipient_id,
					provider_message_id,
					provider_conversation_id,
					provider_metadata,
					payload,
					updated_at
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, CURRENT_TIMESTAMP)
				ON CONFLICT (workflow_id, node_name, request_id)
				DO UPDATE SET
					kind = EXCLUDED.kind,
					timeout_ms = EXCLUDED.timeout_ms,
					recipient_id = COALESCE(EXCLUDED.recipient_id, ${queryTableName}.recipient_id),
					provider_message_id = COALESCE(EXCLUDED.provider_message_id, ${queryTableName}.provider_message_id),
					provider_conversation_id = COALESCE(EXCLUDED.provider_conversation_id, ${queryTableName}.provider_conversation_id),
					provider_metadata = COALESCE(EXCLUDED.provider_metadata, ${queryTableName}.provider_metadata),
					payload = EXCLUDED.payload,
					updated_at = CURRENT_TIMESTAMP
				WHERE ${queryTableName}.status <> 'consumed'
			`,
			[
				workflowId,
				nodeName,
				record.requestId,
				record.channel ?? config.channel,
				record.kind,
				record.status,
				record.createdAt,
				record.consumedAt ?? null,
				record.consumedDecisionKey ?? null,
				record.timeoutMs,
				recipientId,
				providerMessageId,
				providerConversationId,
				providerMetadata ? JSON.stringify(providerMetadata) : null,
				JSON.stringify(payload),
			],
		);
	});
}

export async function getPendingHitlRecordPostgres<TRecord extends PendingCompanionHitlRecord>(
	ctx: StoreContext,
	requestId: string,
	config: PostgresPendingStoreConfig,
): Promise<TRecord | undefined> {
	return withPool(ctx, config, async ({ queryTableName, workflowId, nodeName, pool }) => {
		const result = await pool.query<PendingStoreRow>(
			`
				SELECT request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
				FROM ${queryTableName}
				WHERE workflow_id = $1 AND node_name = $2 AND request_id = $3
				LIMIT 1
			`,
			[workflowId, nodeName, requestId],
		);
		const row = result.rows[0];
		return row ? rowToRecord<TRecord>(row) : undefined;
	});
}

export async function getPendingHitlRecordByProviderMessageIdPostgres<TRecord extends PendingCompanionHitlRecord>(
	ctx: StoreContext,
	args: {
		providerMessageId: string;
		recipientId?: string;
	},
	config: PostgresPendingStoreConfig,
): Promise<TRecord | undefined> {
	return withPool(ctx, config, async ({ queryTableName, workflowId, nodeName, pool }) => {
		const query = args.recipientId
			? `
				SELECT request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
				FROM ${queryTableName}
				WHERE workflow_id = $1
					AND node_name = $2
					AND provider_message_id = $3
					AND recipient_id = $4
					AND status = 'pending'
				LIMIT 1
			`
			: `
				SELECT request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
				FROM ${queryTableName}
				WHERE workflow_id = $1
					AND node_name = $2
					AND provider_message_id = $3
					AND status = 'pending'
				LIMIT 1
			`;

		const params = args.recipientId
			? [workflowId, nodeName, args.providerMessageId, args.recipientId]
			: [workflowId, nodeName, args.providerMessageId];
		const result = await pool.query<PendingStoreRow>(query, params);
		const row = result.rows[0];
		return row ? rowToRecord<TRecord>(row) : undefined;
	});
}

export async function getLatestPendingHitlRecordByRecipientPostgres<TRecord extends PendingCompanionHitlRecord>(
	ctx: StoreContext,
	args: {
		recipientId: string;
		kind?: PendingCompanionHitlRecord['kind'];
	},
	config: PostgresPendingStoreConfig,
): Promise<TRecord | undefined> {
	return withPool(ctx, config, async ({ queryTableName, workflowId, nodeName, pool }) => {
		const query = args.kind
			? `
				SELECT request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
				FROM ${queryTableName}
				WHERE workflow_id = $1
					AND node_name = $2
					AND recipient_id = $3
					AND kind = $4
					AND status = 'pending'
				ORDER BY created_at_ms DESC
				LIMIT 1
			`
			: `
				SELECT request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
				FROM ${queryTableName}
				WHERE workflow_id = $1
					AND node_name = $2
					AND recipient_id = $3
					AND status = 'pending'
				ORDER BY created_at_ms DESC
				LIMIT 1
			`;

		const params = args.kind
			? [workflowId, nodeName, args.recipientId, args.kind]
			: [workflowId, nodeName, args.recipientId];

		const result = await pool.query<PendingStoreRow>(query, params);
		const row = result.rows[0];
		return row ? rowToRecord<TRecord>(row) : undefined;
	});
}

export async function consumePendingHitlRecordWithDecisionPostgres<TRecord extends PendingCompanionHitlRecord>(
	ctx: StoreContext,
	requestId: string,
	decisionKey: string,
	config: PostgresPendingStoreConfig,
	fallbackRecord?: TRecord,
): Promise<PendingCompanionConsumeResult<TRecord>> {
	return withPool(ctx, config, async ({ queryTableName, workflowId, nodeName, pool }) => {
		const consumedAt = Date.now();

		const updateResult = await pool.query<PendingStoreRow>(
			`
				UPDATE ${queryTableName}
				SET status = 'consumed',
					consumed_at_ms = $4,
					consumed_decision_key = $5,
					updated_at = CURRENT_TIMESTAMP
				WHERE workflow_id = $1
					AND node_name = $2
					AND request_id = $3
					AND status = 'pending'
				RETURNING request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
			`,
			[workflowId, nodeName, requestId, consumedAt, decisionKey],
		);

		const updated = updateResult.rows[0];
		if (updated) {
			return { status: 'accepted', record: rowToRecord<TRecord>(updated) };
		}

		const existingResult = await pool.query<PendingStoreRow>(
			`
				SELECT request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
				FROM ${queryTableName}
				WHERE workflow_id = $1 AND node_name = $2 AND request_id = $3
				LIMIT 1
			`,
			[workflowId, nodeName, requestId],
		);

		const existing = existingResult.rows[0];
		if (!existing) {
			if (!fallbackRecord) {
				return { status: 'missing' };
			}

			const insertedFallback = {
				...fallbackRecord,
				status: 'consumed',
				consumedAt,
				consumedDecisionKey: decisionKey,
				channel: fallbackRecord.channel ?? config.channel,
			} as TRecord;
			const insertResult = await pool.query<PendingStoreRow>(
				`
					INSERT INTO ${queryTableName} (
						workflow_id,
						node_name,
						request_id,
						channel,
						kind,
						status,
						created_at_ms,
						consumed_at_ms,
						consumed_decision_key,
						timeout_ms,
						recipient_id,
						provider_message_id,
						provider_conversation_id,
						provider_metadata,
						payload,
						updated_at
					)
					VALUES ($1, $2, $3, $4, $5, 'consumed', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, CURRENT_TIMESTAMP)
					ON CONFLICT (workflow_id, node_name, request_id) DO NOTHING
					RETURNING request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
				`,
				[
					workflowId,
					nodeName,
					requestId,
					insertedFallback.channel ?? config.channel,
					insertedFallback.kind,
					insertedFallback.createdAt,
					insertedFallback.consumedAt ?? consumedAt,
					decisionKey,
					insertedFallback.timeoutMs,
					insertedFallback.recipientId ?? null,
					insertedFallback.providerMessageId ?? null,
					insertedFallback.providerConversationId ?? null,
					insertedFallback.providerMetadata ? JSON.stringify(insertedFallback.providerMetadata) : null,
					JSON.stringify(insertedFallback),
				],
			);

			const insertedRow = insertResult.rows[0];
			if (insertedRow) {
				return { status: 'accepted', record: rowToRecord<TRecord>(insertedRow) };
			}

			const racedResult = await pool.query<PendingStoreRow>(
				`
					SELECT request_id, kind, status, created_at_ms, consumed_at_ms, consumed_decision_key, timeout_ms, payload
					FROM ${queryTableName}
					WHERE workflow_id = $1 AND node_name = $2 AND request_id = $3
					LIMIT 1
				`,
				[workflowId, nodeName, requestId],
			);
			const raced = racedResult.rows[0];
			if (!raced) return { status: 'missing' };
			const racedRecord = rowToRecord<TRecord>(raced);
			if (racedRecord.status === 'consumed' && racedRecord.consumedDecisionKey === decisionKey) {
				return { status: 'duplicate', record: racedRecord };
			}
			return { status: 'conflict', record: racedRecord };
		}

		const existingRecord = rowToRecord<TRecord>(existing);
		if (existingRecord.status === 'consumed' && existingRecord.consumedDecisionKey === decisionKey) {
			return { status: 'duplicate', record: existingRecord };
		}

		return { status: 'conflict', record: existingRecord };
	});
}
