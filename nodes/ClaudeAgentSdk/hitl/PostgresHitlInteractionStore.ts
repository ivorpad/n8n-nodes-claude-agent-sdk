// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import type { Pool, PoolClient } from 'pg';

import type {
	ApprovalInteractionRecord,
	ConsumeApprovalDecisionArgs,
	ConsumeQuestionDecisionArgs,
	HitlDecisionResult,
	HitlInteractionRecord,
	HitlInteractionStore,
	QuestionInteractionRecord,
} from './interactionStoreTypes';
import {
	type InteractionRow,
	type QueryableClient,
	buildSafeIndexName,
	mapInteractionRow,
	quoteQualifiedTableName,
	validateExistingSchema,
} from './postgresHelpers';
import {
	NOOP_SECRETS_REDACTOR,
	type SecretsRedactor,
} from '../operations/executeTask/secretsRedaction';

interface PoolLike extends QueryableClient {
	connect: () => Promise<PoolClient>;
}

export class PostgresHitlInteractionStore implements HitlInteractionStore {
	readonly backend = 'postgres' as const;

	private readonly pool: PoolLike;

	private readonly workflowId: string;

	private readonly nodeName: string;

	private readonly tableName: string;

	private readonly quotedTableName: string;

	private readonly secretRedactor: SecretsRedactor;

	private schemaEnsured = false;

	constructor(args: {
		pool: Pool;
		workflowId: string;
		nodeName: string;
		tableName: string;
		/**
		 * Masks secret values before they are persisted to the durable HITL
		 * interaction table (V4: HITL store sink). Covers the task prompt
		 * (original_task_base64), tool_input, questions, answers,
		 * reviewer_message and updated_input. Defaults to a no-op.
		 */
		secretRedactor?: SecretsRedactor;
	}) {
		this.pool = args.pool;
		this.workflowId = args.workflowId;
		this.nodeName = args.nodeName;
		this.tableName = args.tableName;
		this.quotedTableName = quoteQualifiedTableName(this.tableName);
		this.secretRedactor = args.secretRedactor ?? NOOP_SECRETS_REDACTOR;
	}

	/** Mask secrets in the base64-encoded task prompt without breaking decode. */
	private redactBase64Task(value: string | null | undefined): string | null {
		if (value === null || value === undefined) {
			return null;
		}
		if (!this.secretRedactor.hasSecrets) {
			return value;
		}
		try {
			const decoded = Buffer.from(value, 'base64').toString('utf-8');
			const redacted = this.secretRedactor.redactString(decoded);
			if (redacted === decoded) {
				return value;
			}
			return Buffer.from(redacted, 'utf-8').toString('base64');
		} catch {
			// Not decodable as base64 text — fall back to redacting the raw value.
			return this.secretRedactor.redactString(value);
		}
	}

	/** Serialize a JSON value to its persisted (redacted) string form. */
	private redactJson(value: unknown): string | null {
		if (value === null || value === undefined) {
			return null;
		}
		return JSON.stringify(this.secretRedactor.redactUnknown(value));
	}

	async ensureSchema(): Promise<void> {
		if (this.schemaEnsured) {
			return;
		}

		const client = await this.pool.connect();
		try {
			await client.query(`
				CREATE TABLE IF NOT EXISTS ${this.quotedTableName} (
					id BIGSERIAL PRIMARY KEY,
					workflow_id VARCHAR(255) NOT NULL,
					node_name VARCHAR(255) NOT NULL,
					request_id VARCHAR(255) NOT NULL,
					kind VARCHAR(32) NOT NULL,
					status VARCHAR(16) NOT NULL,
					execution_id VARCHAR(255),
					chat_session_id VARCHAR(255),
					session_id VARCHAR(255),
					stream_key VARCHAR(255),
					original_task_base64 TEXT,
					approved_fingerprints TEXT,
					timeout_ms BIGINT NOT NULL DEFAULT 0,
					created_at_ms BIGINT NOT NULL,
					answered_at_ms BIGINT,
					decision_key TEXT,
					decision_id VARCHAR(255),
					decision_channel VARCHAR(64),
					resume_session_at VARCHAR(255),
					fingerprint TEXT,
					tool_name VARCHAR(255),
					tool_input JSONB,
					questions JSONB,
					answers JSONB,
					response_action VARCHAR(16),
					approved BOOLEAN,
					permission_mode_override VARCHAR(64),
					reviewer_message TEXT,
					updated_input JSONB,
					updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
					UNIQUE (workflow_id, node_name, request_id)
				)
			`);
			await client.query(`
				CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(this.tableName, 'status')}
				ON ${this.quotedTableName} (workflow_id, node_name, status)
			`);
			await client.query(`
				CREATE INDEX IF NOT EXISTS ${buildSafeIndexName(this.tableName, 'stream')}
				ON ${this.quotedTableName} (workflow_id, node_name, stream_key)
			`);
			// Additive migration: add columns that may be missing on older tables
			await client.query(`ALTER TABLE ${this.quotedTableName} ADD COLUMN IF NOT EXISTS reviewer_message TEXT`);
			await client.query(`ALTER TABLE ${this.quotedTableName} ADD COLUMN IF NOT EXISTS updated_input JSONB`);
			await validateExistingSchema(client, this.tableName);
			this.schemaEnsured = true;
		} finally {
			client.release();
		}
	}

	async saveInteraction(record: HitlInteractionRecord): Promise<void> {
		await this.ensureSchema();
		await this.pool.query(
			`
				INSERT INTO ${this.quotedTableName} (
					workflow_id,
					node_name,
					request_id,
					kind,
					status,
					execution_id,
					chat_session_id,
					session_id,
					stream_key,
					original_task_base64,
					approved_fingerprints,
					timeout_ms,
					created_at_ms,
					answered_at_ms,
					decision_key,
					decision_id,
					decision_channel,
					resume_session_at,
					fingerprint,
					tool_name,
					tool_input,
					questions,
					answers,
					response_action,
					approved,
					permission_mode_override,
					updated_at
				)
				VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
					$14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb,
					$23::jsonb, $24, $25, $26, CURRENT_TIMESTAMP
				)
				ON CONFLICT (workflow_id, node_name, request_id)
				DO UPDATE SET
					execution_id = COALESCE(EXCLUDED.execution_id, ${this.quotedTableName}.execution_id),
					chat_session_id = COALESCE(EXCLUDED.chat_session_id, ${this.quotedTableName}.chat_session_id),
					session_id = COALESCE(EXCLUDED.session_id, ${this.quotedTableName}.session_id),
					stream_key = COALESCE(EXCLUDED.stream_key, ${this.quotedTableName}.stream_key),
					original_task_base64 = COALESCE(EXCLUDED.original_task_base64, ${this.quotedTableName}.original_task_base64),
					approved_fingerprints = COALESCE(EXCLUDED.approved_fingerprints, ${this.quotedTableName}.approved_fingerprints),
					timeout_ms = EXCLUDED.timeout_ms,
					resume_session_at = COALESCE(EXCLUDED.resume_session_at, ${this.quotedTableName}.resume_session_at),
					fingerprint = COALESCE(EXCLUDED.fingerprint, ${this.quotedTableName}.fingerprint),
					tool_name = COALESCE(EXCLUDED.tool_name, ${this.quotedTableName}.tool_name),
					tool_input = COALESCE(EXCLUDED.tool_input, ${this.quotedTableName}.tool_input),
					questions = COALESCE(EXCLUDED.questions, ${this.quotedTableName}.questions),
					updated_at = CURRENT_TIMESTAMP
				WHERE ${this.quotedTableName}.status = 'pending'
			`,
			[
				this.workflowId,
				this.nodeName,
				record.requestId,
				record.kind,
				record.status,
				record.executionId ?? null,
				record.chatSessionId ?? null,
				record.sessionId ?? null,
				record.streamKey ?? null,
				this.redactBase64Task(record.originalTaskBase64),
				record.approvedFingerprints ?? null,
				record.timeoutMs,
				record.createdAt,
				record.answeredAt ?? null,
				record.decisionKey ?? null,
				record.decisionId ?? null,
				record.decisionChannel ?? null,
				record.resumeSessionAt ?? null,
				record.kind === 'approval' ? (record.fingerprint ?? null) : null,
				record.kind === 'approval' ? (record.toolName ?? null) : null,
				record.kind === 'approval' ? this.redactJson(record.toolInput ?? null) : null,
				record.kind === 'question' ? this.redactJson(record.questions) : null,
				record.kind === 'question' ? this.redactJson(record.answers ?? null) : null,
				record.kind === 'question' ? (record.responseAction ?? null) : null,
				record.kind === 'approval' ? (record.approved ?? null) : null,
				record.kind === 'approval' ? (record.permissionModeOverride ?? null) : null,
			],
		);
	}

	async getInteraction(requestId: string): Promise<HitlInteractionRecord | undefined> {
		await this.ensureSchema();
		const result = await this.pool.query<InteractionRow>(
			`
				SELECT
					request_id, kind, status, execution_id, chat_session_id, session_id, stream_key,
					original_task_base64, approved_fingerprints, timeout_ms, created_at_ms,
					answered_at_ms, decision_key, decision_id, decision_channel, resume_session_at,
					fingerprint, tool_name, tool_input, questions, answers, response_action,
					approved, permission_mode_override, reviewer_message, updated_input
				FROM ${this.quotedTableName}
				WHERE workflow_id = $1 AND node_name = $2 AND request_id = $3
				LIMIT 1
			`,
			[this.workflowId, this.nodeName, requestId],
		);
		const row = result.rows[0];
		return row ? mapInteractionRow(row) : undefined;
	}

	async consumeApprovalDecision(
		args: ConsumeApprovalDecisionArgs,
	): Promise<HitlDecisionResult<ApprovalInteractionRecord>> {
		await this.ensureSchema();
		const result = await this.pool.query<InteractionRow>(
			`
				UPDATE ${this.quotedTableName}
				SET
					status = 'answered',
					answered_at_ms = $4,
					decision_key = $5,
					decision_id = $6,
					decision_channel = $7,
					approved = $8,
					fingerprint = COALESCE($9, fingerprint),
					permission_mode_override = $10,
					reviewer_message = $11,
					updated_input = $12::jsonb,
					updated_at = CURRENT_TIMESTAMP
				WHERE workflow_id = $1 AND node_name = $2 AND request_id = $3 AND status = 'pending'
				RETURNING
					request_id, kind, status, execution_id, chat_session_id, session_id, stream_key,
					original_task_base64, approved_fingerprints, timeout_ms, created_at_ms,
					answered_at_ms, decision_key, decision_id, decision_channel, resume_session_at,
					fingerprint, tool_name, tool_input, questions, answers, response_action,
					approved, permission_mode_override, reviewer_message, updated_input
			`,
			[
				this.workflowId,
				this.nodeName,
				args.requestId,
				args.decidedAt,
				args.decisionKey,
				args.decisionId,
				args.channel,
				args.approved,
				args.fingerprint ?? null,
				args.permissionModeOverride ?? null,
				args.reviewerMessage ? this.secretRedactor.redactString(args.reviewerMessage) : null,
				this.redactJson(args.updatedInput ?? null),
			],
		);

		if (result.rows[0]) {
			return { status: 'accepted', record: mapInteractionRow(result.rows[0]) as ApprovalInteractionRecord };
		}

		return this.readConflictResult<ApprovalInteractionRecord>(args.requestId, args.decisionKey);
	}

	async consumeQuestionDecision(
		args: ConsumeQuestionDecisionArgs,
	): Promise<HitlDecisionResult<QuestionInteractionRecord>> {
		await this.ensureSchema();
		const result = await this.pool.query<InteractionRow>(
			`
				UPDATE ${this.quotedTableName}
				SET
					status = 'answered',
					answered_at_ms = $4,
					decision_key = $5,
					decision_id = $6,
					decision_channel = $7,
					answers = $8::jsonb,
					response_action = $9,
					updated_at = CURRENT_TIMESTAMP
				WHERE workflow_id = $1 AND node_name = $2 AND request_id = $3 AND status = 'pending'
				RETURNING
					request_id, kind, status, execution_id, chat_session_id, session_id, stream_key,
					original_task_base64, approved_fingerprints, timeout_ms, created_at_ms,
					answered_at_ms, decision_key, decision_id, decision_channel, resume_session_at,
					fingerprint, tool_name, tool_input, questions, answers, response_action,
					approved, permission_mode_override, reviewer_message, updated_input
			`,
			[
				this.workflowId,
				this.nodeName,
				args.requestId,
				args.decidedAt,
				args.decisionKey,
				args.decisionId,
				args.channel,
				this.redactJson(args.answers),
				args.responseAction ?? null,
			],
		);

		if (result.rows[0]) {
			return { status: 'accepted', record: mapInteractionRow(result.rows[0]) as QuestionInteractionRecord };
		}

		return this.readConflictResult<QuestionInteractionRecord>(args.requestId, args.decisionKey);
	}

	private async readConflictResult<TRecord extends HitlInteractionRecord>(
		requestId: string,
		decisionKey: string,
	): Promise<HitlDecisionResult<TRecord>> {
		const existing = await this.getInteraction(requestId);
		if (!existing) {
			return { status: 'missing' };
		}
		return {
			status: existing.decisionKey === decisionKey ? 'duplicate' : 'conflict',
			record: existing as TRecord,
		};
	}
}
