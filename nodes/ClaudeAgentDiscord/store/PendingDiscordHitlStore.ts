import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import { createPendingHitlStore } from '../../ClaudeAgentChannelShared/core/pendingStore';
import type { PendingDiscordHitlRecord } from '../types';

const STORE_KEY = '__claudeAgentDiscord_pendingInteractions';
type StaticDataContext = IExecuteFunctions | IWebhookFunctions;

const sharedStore = createPendingHitlStore<PendingDiscordHitlRecord>(STORE_KEY);

export function savePending(ctx: StaticDataContext, record: PendingDiscordHitlRecord): void {
	sharedStore.save(ctx, record);
}

export function getPending(
	ctx: StaticDataContext,
	requestId: string,
): PendingDiscordHitlRecord | undefined {
	return sharedStore.get(ctx, requestId);
}

export function consumePendingWithDecision(
	ctx: StaticDataContext,
	requestId: string,
	decisionKey: string,
	fallbackRecord?: PendingDiscordHitlRecord,
) {
	return sharedStore.consumeWithDecision(ctx, requestId, decisionKey, fallbackRecord);
}
