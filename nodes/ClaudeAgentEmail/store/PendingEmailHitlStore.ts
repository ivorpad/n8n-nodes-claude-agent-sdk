import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import { createPendingHitlStore } from '../../ClaudeAgentChannelShared/core/pendingStore';
import type { PendingCompanionConsumeResult } from '../../ClaudeAgentChannelShared/core/types';
import type { PendingEmailHitlRecord } from '../types';

const STORE_KEY = '__claudeAgentEmail_pendingInteractions';
type StaticDataContext = IExecuteFunctions | IWebhookFunctions;

const sharedStore = createPendingHitlStore<PendingEmailHitlRecord>(STORE_KEY);

export function savePending(ctx: StaticDataContext, record: PendingEmailHitlRecord): void {
	sharedStore.save(ctx, record);
}

export function getPending(
	ctx: StaticDataContext,
	requestId: string,
): PendingEmailHitlRecord | undefined {
	return sharedStore.get(ctx, requestId);
}

export function consumePendingWithDecision(
	ctx: StaticDataContext,
	requestId: string,
	decisionKey: string,
	fallbackRecord?: PendingEmailHitlRecord,
): PendingCompanionConsumeResult<PendingEmailHitlRecord> {
	return sharedStore.consumeWithDecision(ctx, requestId, decisionKey, fallbackRecord);
}
