import {
	NodeConnectionTypes,
	NodeOperationError,
	type INode,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { createPostgresConnectionHandle } from '../../shared/postgresConnection';
import type { N8nPostgresCredential, PostgresConnectionHandle } from '../../shared/postgresConnection';
import { quoteQualifiedTableName } from '../../shared/postgresIdentifiers';

import type { ISessionMemory } from '../SimpleSessionMemory/SimpleSessionMemory.node';

const EXECUTION_LOCK_TIMEOUT_MS = 5000;
const EXECUTION_LOCK_POLL_MS = 100;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Minimal structural view of a pooled pg client for advisory-lock pinning. */
export interface LockablePoolClient {
	query<TRow = unknown>(
		sql: string,
		params?: unknown[],
	): Promise<{ rows: TRow[]; rowCount: number | null }>;
	release(): void;
}

/** Minimal structural view of a pg Pool that can hand out a pinnable client. */
export interface LockablePool {
	connect(): Promise<LockablePoolClient>;
}

/**
 * Acquire the per-session execution-lifecycle advisory lock on a SINGLE pinned
 * client (V11b, finding 7.1).
 *
 * `pg_try_advisory_lock` is session-scoped, so the unlock must run on the exact
 * same backend that took the lock. The previous implementation acquired and
 * released via `pool.query`, which can route those calls to different pooled
 * backends — the unlock would then no-op on a connection that never held the
 * lock, leaking the lock on the original backend until it reset.
 *
 * We pin one client via `pool.connect()` for the lock's lifetime (mirroring the
 * `PostgresStreamStore.appendFrame` reference) and run both the acquire poll and
 * the unlock on it. The returned release function is idempotent and always
 * returns the client to the pool.
 */
export async function acquireSessionExecutionLock(args: {
	pool: LockablePool;
	workflowId: string | undefined;
	sessionId: string;
	node: INode;
	timeoutMs?: number;
	pollMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}): Promise<() => Promise<void>> {
	const {
		pool,
		workflowId,
		sessionId,
		node,
		timeoutMs = EXECUTION_LOCK_TIMEOUT_MS,
		pollMs = EXECUTION_LOCK_POLL_MS,
		now = Date.now,
		sleep = delay,
	} = args;

	const lockSessionId = sessionId || '__empty__';
	const lockStart = now();
	const client = await pool.connect();

	try {
		while (true) {
			const { rows } = await client.query<{ locked: boolean }>(
				'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
				[workflowId, lockSessionId],
			);

			if (rows[0]?.locked === true) {
				break;
			}

			if (now() - lockStart >= timeoutMs) {
				throw new NodeOperationError(
					node,
					`Timed out waiting for session execution lock (${timeoutMs}ms) for chat session "${sessionId}". ` +
						'Another n8n worker is likely running this session. Retry, or reduce concurrent runs for the same Chat Session ID.',
				);
			}

			await sleep(pollMs);
		}
	} catch (error) {
		// Acquisition failed (timeout or query error): return the client to the pool
		// so we never leak a checked-out connection.
		client.release();
		throw error;
	}

	let released = false;
	return async () => {
		if (released) return;
		released = true;
		try {
			await client.query(
				'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
				[workflowId, lockSessionId],
			);
		} catch (error) {
			throw new NodeOperationError(
				node,
				`Failed to release session execution lock for chat session "${sessionId}": ${(error as Error).message}`,
			);
		} finally {
			// Always return the pinned client to the pool, even if the unlock query
			// itself failed — the backend will drop session locks when reset/closed.
			client.release();
		}
	};
}

function hasParentNode(
	ctx: ISupplyDataFunctions,
): ctx is ISupplyDataFunctions & { parentNode: { name: string } } {
	const parentNode = Reflect.get(ctx, 'parentNode');
	return (
		isRecord(parentNode)
		&& typeof parentNode.name === 'string'
	);
}

export class PostgresSessionMemory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Postgres Session Memory',
		name: 'postgresSessionMemory',
		icon: 'file:postgres.svg',
		group: ['transform'],
		version: 1,
		description: 'Tracks session existence and metadata in PostgreSQL for deterministic session resume',
		defaults: {
			name: 'Postgres Session Memory',
		},
		credentials: [
			{
				name: 'postgres',
				required: true,
			},
		],
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Memory'],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiMemory],
		outputNames: ['Memory'],
		properties: [
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: 'claude_sessions',
				description:
					'Table name for storing session existence and metadata. Will be created if it does not exist.',
			},
		],
		usableAsTool: true,
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials<N8nPostgresCredential>('postgres');
		const tableName = this.getNodeParameter('tableName', itemIndex, 'claude_sessions') as string;
		const workflowId = this.getWorkflow().id;
		// Use the shared SAFE quoting (with .trim() + empty-part rejection); the prior
		// inline copy here diverged by skipping both guards (finding 1.2).
		const quotedTableName = quoteQualifiedTableName(tableName, 'Postgres Session Memory');

		// Get parent node name for namespacing (e.g., "Claude Agent SDK HR" -> "Claude_Agent_SDK_HR")
		const parentNodeName = hasParentNode(this)
			? this.parentNode.name.replace(/\s+/g, '_')
			: 'default';

		// Use the shared connection factory for consistent SSL + SSH tunnel support
		const connectionHandle: PostgresConnectionHandle = await createPostgresConnectionHandle({
			execFunctions: this,
			credential: credentials,
		});
		const pool = connectionHandle.pool;
		const node = this.getNode();

		// Create table if not exists
		// parent_node_name is stored for analytics only, not used in lookups
		await pool.query(`
			CREATE TABLE IF NOT EXISTS ${quotedTableName} (
				id SERIAL PRIMARY KEY,
				workflow_id VARCHAR(255) NOT NULL,
				session_id VARCHAR(255) NOT NULL,
				claude_session_id VARCHAR(255) NOT NULL,
				parent_node_name VARCHAR(255) DEFAULT 'default',
				working_directory TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(workflow_id, session_id)
			)
		`);

		// Validate the table isn't accidentally pointed at the transcript artifact store.
		// (That table has NOT NULL columns like `artifact` that will break session metadata inserts.)
		const { rows: columns } = await pool.query<{ attname: string }>(
			`SELECT attname FROM pg_attribute WHERE attrelid = to_regclass($1) AND attnum > 0 AND NOT attisdropped`,
			[tableName],
		);
		const columnNames = new Set(columns.map((row) => row.attname));
		if (columnNames.has('artifact') || columnNames.has('checksum') || columnNames.has('size_bytes') || columnNames.has('version')) {
			throw new NodeOperationError(
				this.getNode(),
				`Postgres Session Memory table "${tableName}" looks like a transcript artifact table (contains artifact-related columns). ` +
					'This node tracks session existence and metadata for deterministic resume. ' +
					`Use a separate table name (default: "claude_sessions").`,
			);
		}

		// Ensure columns exist for older tables created before metadata was added.
		// claude_session_id is kept as a legacy column for backward compatibility.
		await pool.query(`ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS claude_session_id VARCHAR(255)`);
		await pool.query(`ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS parent_node_name VARCHAR(255)`);
		await pool.query(`ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS working_directory TEXT`);
		await pool.query(`ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS managed_agent_session_id VARCHAR(255)`);

		const sessionMemory: ISessionMemory = {
			type: 'claude-session-memory',
			async acquireExecutionLock(sessionId: string): Promise<() => Promise<void>> {
				// Pin a single client for the lock's lifetime so the session-scoped
				// advisory lock is acquired and released on the SAME backend (V11b).
				return acquireSessionExecutionLock({
					pool,
					workflowId,
					sessionId,
					node,
				});
			},
			async has(sessionId: string): Promise<boolean> {
				// Key is workflowId + sessionId only (not parentNodeName) so renaming nodes doesn't break sessions
				const result = await pool.query(
					`SELECT 1 FROM ${quotedTableName} WHERE workflow_id = $1 AND session_id = $2`,
					[workflowId, sessionId],
				);
				return (result.rowCount ?? 0) > 0;
			},
			async getMetadata(sessionId: string): Promise<{ workingDirectory?: string; managedAgentSessionId?: string } | undefined> {
				const result = await pool.query(
					`SELECT working_directory, managed_agent_session_id FROM ${quotedTableName} WHERE workflow_id = $1 AND session_id = $2`,
					[workflowId, sessionId],
				);
				const row = result.rows[0];
				if (!row) return undefined;
				const workingDirectory = row.working_directory as string | undefined;
				const managedAgentSessionId = row.managed_agent_session_id as string | undefined;
				if (!workingDirectory && !managedAgentSessionId) return undefined;
				return {
					...(workingDirectory && { workingDirectory }),
					...(managedAgentSessionId && { managedAgentSessionId }),
				};
			},
			async touch(
				sessionId: string,
				nodeNameForAnalytics?: string,
				metadata?: { workingDirectory?: string; managedAgentSessionId?: string },
			): Promise<void> {
				// Key is workflowId + sessionId only; parentNodeName stored separately for analytics
				const nodeNameToStore = nodeNameForAnalytics || parentNodeName;
				await pool.query(
					`INSERT INTO ${quotedTableName} (workflow_id, session_id, claude_session_id, parent_node_name, working_directory, managed_agent_session_id, updated_at)
					 VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
					 ON CONFLICT (workflow_id, session_id)
					 DO UPDATE SET claude_session_id = $3, parent_node_name = $4, working_directory = $5, managed_agent_session_id = COALESCE($6, ${quotedTableName}.managed_agent_session_id), updated_at = CURRENT_TIMESTAMP`,
					[workflowId, sessionId, sessionId, nodeNameToStore, metadata?.workingDirectory ?? null, metadata?.managedAgentSessionId ?? null],
				);
			},
			async forget(sessionId: string): Promise<void> {
				await pool.query(
					`DELETE FROM ${quotedTableName} WHERE workflow_id = $1 AND session_id = $2`,
					[workflowId, sessionId],
				);
			},
		};

		return {
			response: sessionMemory,
			closeFunction: async () => {
				await connectionHandle.close();
			},
		};
	}
}
