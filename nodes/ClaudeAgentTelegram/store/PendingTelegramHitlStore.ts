import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import { createPendingHitlStore } from '../../ClaudeAgentChannelShared/core/pendingStore';
import {
	consumePendingHitlRecordWithDecisionPostgres,
	getPendingHitlRecordPostgres,
	savePendingHitlRecordPostgres,
	type PostgresPendingStoreConfig,
} from '../../ClaudeAgentChannelShared/core/pendingStorePostgres';
import type { PendingCompanionConsumeResult } from '../../ClaudeAgentChannelShared/core/types';
import type { PendingTelegramHitlRecord } from '../types';
import type { PendingStoreBackend } from '../types';

const STORE_KEY = '__claudeAgentTelegram_pendingInteractions';
const DEFAULT_POSTGRES_TABLE = 'claude_hitl_pending';
const DEFAULT_CHANNEL = 'telegram';

type StaticDataContext = IExecuteFunctions | IWebhookFunctions;

const sharedStore = createPendingHitlStore<PendingTelegramHitlRecord>(STORE_KEY);

export interface PendingStoreConfig {
	backend: PendingStoreBackend;
	tableName?: string;
	credentialName?: string;
}

function resolveStoreConfig(config?: PendingStoreConfig): PendingStoreConfig {
	return {
		backend: config?.backend ?? 'staticData',
		tableName: config?.tableName,
		credentialName: config?.credentialName,
	};
}

function asPostgresConfig(config?: PendingStoreConfig): PostgresPendingStoreConfig {
	const normalized = resolveStoreConfig(config);
	return {
		tableName: normalized.tableName?.trim() || DEFAULT_POSTGRES_TABLE,
		credentialName: normalized.credentialName,
		channel: DEFAULT_CHANNEL,
	};
}

export async function savePending(
	ctx: StaticDataContext,
	record: PendingTelegramHitlRecord,
	config?: PendingStoreConfig,
): Promise<void> {
	const normalized = resolveStoreConfig(config);
	if (normalized.backend === 'postgres') {
		await savePendingHitlRecordPostgres(ctx, record, asPostgresConfig(normalized));
		return;
	}
	sharedStore.save(ctx, record);
}

export async function getPending(
	ctx: StaticDataContext,
	requestId: string,
	config?: PendingStoreConfig,
): Promise<PendingTelegramHitlRecord | undefined> {
	const normalized = resolveStoreConfig(config);
	if (normalized.backend === 'postgres') {
		return getPendingHitlRecordPostgres(ctx, requestId, asPostgresConfig(normalized));
	}
	return sharedStore.get(ctx, requestId);
}

export async function consumePendingWithDecision(
	ctx: StaticDataContext,
	requestId: string,
	decisionKey: string,
	config?: PendingStoreConfig,
	fallbackRecord?: PendingTelegramHitlRecord,
): Promise<PendingCompanionConsumeResult<PendingTelegramHitlRecord>> {
	const normalized = resolveStoreConfig(config);
	if (normalized.backend === 'postgres') {
		return consumePendingHitlRecordWithDecisionPostgres(
			ctx,
			requestId,
			decisionKey,
			asPostgresConfig(normalized),
			fallbackRecord,
		);
	}
	return sharedStore.consumeWithDecision(ctx, requestId, decisionKey, fallbackRecord);
}
