import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import { createPendingHitlStore } from '../../ClaudeAgentChannelShared/core/pendingStore';
import type { PendingCompanionConsumeResult } from '../../ClaudeAgentChannelShared/core/types';
import type { PendingGmailHitlRecord } from '../types';

const STORE_KEY = '__claudeAgentGmail_pendingInteractions';
type StaticDataContext = IExecuteFunctions | IWebhookFunctions;

const sharedStore = createPendingHitlStore<PendingGmailHitlRecord>(STORE_KEY);

export function savePending(ctx: StaticDataContext, record: PendingGmailHitlRecord): void {
	sharedStore.save(ctx, record);
}

export function getPending(
	ctx: StaticDataContext,
	requestId: string,
): PendingGmailHitlRecord | undefined {
	return sharedStore.get(ctx, requestId);
}

export function consumePendingWithDecision(
	ctx: StaticDataContext,
	requestId: string,
	decisionKey: string,
	fallbackRecord?: PendingGmailHitlRecord,
): PendingCompanionConsumeResult<PendingGmailHitlRecord> {
	return sharedStore.consumeWithDecision(ctx, requestId, decisionKey, fallbackRecord);
}
