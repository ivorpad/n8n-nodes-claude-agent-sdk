import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import { createPendingHitlStore } from '../../ClaudeAgentChannelShared/core/pendingStore';
import type { PendingCompanionConsumeResult } from '../../ClaudeAgentChannelShared/core/types';
import type { PendingSlackHitlRecord } from '../types';

const STORE_KEY = '__claudeAgentSlack_pendingInteractions';
type StaticDataContext = IExecuteFunctions | IWebhookFunctions;

const sharedStore = createPendingHitlStore<PendingSlackHitlRecord>(STORE_KEY);

export function savePending(ctx: StaticDataContext, record: PendingSlackHitlRecord): void {
	sharedStore.save(ctx, record);
}

export function getPending(
	ctx: StaticDataContext,
	requestId: string,
): PendingSlackHitlRecord | undefined {
	return sharedStore.get(ctx, requestId);
}

export function consumePendingWithDecision(
	ctx: StaticDataContext,
	requestId: string,
	decisionKey: string,
	fallbackRecord?: PendingSlackHitlRecord,
): PendingCompanionConsumeResult<PendingSlackHitlRecord> {
	return sharedStore.consumeWithDecision(ctx, requestId, decisionKey, fallbackRecord);
}
