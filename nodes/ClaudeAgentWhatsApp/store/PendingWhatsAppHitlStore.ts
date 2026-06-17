import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import { createPendingHitlStore } from '../../ClaudeAgentChannelShared/core/pendingStore';
import {
	consumePendingHitlRecordWithDecisionPostgres,
	getLatestPendingHitlRecordByRecipientPostgres,
	getPendingHitlRecordByProviderMessageIdPostgres,
	getPendingHitlRecordPostgres,
	savePendingHitlRecordPostgres,
	type PostgresPendingStoreConfig,
} from '../../ClaudeAgentChannelShared/core/pendingStorePostgres';
import type { PendingCompanionConsumeResult } from '../../ClaudeAgentChannelShared/core/types';
import type { PendingCompanionStoreBackend } from '../../ClaudeAgentChannelShared/core/types';
import type { PendingWhatsAppHitlRecord } from '../types';

const STORE_KEY = '__claudeAgentWhatsApp_pendingInteractions';
const DEFAULT_POSTGRES_TABLE = 'claude_hitl_pending';
const DEFAULT_CHANNEL = 'whatsapp';

type StaticDataContext = IExecuteFunctions | IWebhookFunctions;

const sharedStore = createPendingHitlStore<PendingWhatsAppHitlRecord>(STORE_KEY);

export interface PendingStoreConfig {
	backend: PendingCompanionStoreBackend;
	tableName?: string;
	credentialName?: string;
}

function asPostgresConfig(config: PendingStoreConfig): PostgresPendingStoreConfig {
	return {
		tableName: config.tableName?.trim() || DEFAULT_POSTGRES_TABLE,
		credentialName: config.credentialName,
		channel: DEFAULT_CHANNEL,
	};
}

export async function savePending(
	ctx: StaticDataContext,
	record: PendingWhatsAppHitlRecord,
	config: PendingStoreConfig,
): Promise<void> {
	if (config.backend === 'postgres') {
		await savePendingHitlRecordPostgres(ctx, record, asPostgresConfig(config));
		return;
	}
	sharedStore.save(ctx, record);
}

export async function getPending(
	ctx: StaticDataContext,
	requestId: string,
	config: PendingStoreConfig,
): Promise<PendingWhatsAppHitlRecord | undefined> {
	if (config.backend === 'postgres') {
		return getPendingHitlRecordPostgres(ctx, requestId, asPostgresConfig(config));
	}
	return sharedStore.get(ctx, requestId);
}

export async function getPendingByProviderMessageId(
	ctx: StaticDataContext,
	args: {
		providerMessageId: string;
		recipientId?: string;
	},
	config: PendingStoreConfig,
): Promise<PendingWhatsAppHitlRecord | undefined> {
	if (config.backend === 'postgres') {
		return getPendingHitlRecordByProviderMessageIdPostgres(ctx, args, asPostgresConfig(config));
	}

	const staticData = ctx.getWorkflowStaticData('node') as Record<string, unknown>;
	const store = (staticData[STORE_KEY] as Record<string, PendingWhatsAppHitlRecord> | undefined) ?? {};
	return Object.values(store).find((record) =>
		record.status === 'pending'
		&& record.providerMessageId === args.providerMessageId
		&& (!args.recipientId || record.recipientId === args.recipientId));
}

export async function getLatestPendingByRecipient(
	ctx: StaticDataContext,
	args: {
		recipientId: string;
		kind?: PendingWhatsAppHitlRecord['kind'];
	},
	config: PendingStoreConfig,
): Promise<PendingWhatsAppHitlRecord | undefined> {
	if (config.backend === 'postgres') {
		return getLatestPendingHitlRecordByRecipientPostgres(ctx, args, asPostgresConfig(config));
	}

	const staticData = ctx.getWorkflowStaticData('node') as Record<string, unknown>;
	const store = (staticData[STORE_KEY] as Record<string, PendingWhatsAppHitlRecord> | undefined) ?? {};
	return Object.values(store)
		.filter((record) =>
			record.status === 'pending'
			&& record.recipientId === args.recipientId
			&& (!args.kind || record.kind === args.kind))
		.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))[0];
}

export async function consumePendingWithDecision(
	ctx: StaticDataContext,
	requestId: string,
	decisionKey: string,
	config: PendingStoreConfig,
	fallbackRecord?: PendingWhatsAppHitlRecord,
): Promise<PendingCompanionConsumeResult<PendingWhatsAppHitlRecord>> {
	if (config.backend === 'postgres') {
		return consumePendingHitlRecordWithDecisionPostgres(
			ctx,
			requestId,
			decisionKey,
			asPostgresConfig(config),
			fallbackRecord,
		);
	}
	return sharedStore.consumeWithDecision(ctx, requestId, decisionKey, fallbackRecord);
}
