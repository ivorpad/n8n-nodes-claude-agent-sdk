import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import {
	createPostgresConnectionHandle,
	type N8nPostgresCredential,
} from '../../shared/postgresConnection';
import { PostgresStreamStore, type StreamStore } from './PostgresStreamStore';

const DEFAULT_CREDENTIAL_NAME = 'postgres';
const DEFAULT_RETENTION_HOURS = 24 * 7;

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;
}

function parsePositiveInt(value: unknown, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) {
			return Math.floor(parsed);
		}
	}
	return fallback;
}

export interface StreamStoreHandle {
	store: StreamStore;
	credentialName: string;
	close: () => Promise<void>;
}

export async function createPostgresStreamStoreHandle(args: {
	execFunctions: IExecuteFunctions | IWebhookFunctions;
	credentialName?: string;
}): Promise<StreamStoreHandle | undefined> {
	const credentialName = asNonEmptyString(args.credentialName) ?? DEFAULT_CREDENTIAL_NAME;

	let credential: N8nPostgresCredential | undefined;
	try {
		credential = await args.execFunctions.getCredentials(credentialName) as N8nPostgresCredential;
	} catch {
		return undefined;
	}

	const handle = await createPostgresConnectionHandle({
		execFunctions: args.execFunctions,
		credential,
	});

	try {
		const store = new PostgresStreamStore({
			pool: handle.pool,
			streamsTableName: asNonEmptyString(process.env.CLAUDE_AGENT_STREAMS_TABLE),
			streamEventsTableName: asNonEmptyString(process.env.CLAUDE_AGENT_STREAM_EVENTS_TABLE),
			retentionHours: parsePositiveInt(
				process.env.CLAUDE_AGENT_STREAM_RETENTION_HOURS,
				DEFAULT_RETENTION_HOURS,
			),
		});
		await store.ensureSchema();
		return {
			store,
			credentialName,
			close: handle.close,
		};
	} catch (error) {
		await handle.close().catch(() => {});
		throw error;
	}
}
