import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import type {
	PendingCompanionConsumeResult,
	PendingCompanionHitlRecord,
} from './types';
import { assertStaticDataStoreQueueSafe } from './queueMode';

const DEFAULT_PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const CONSUMED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StaticDataContext = IExecuteFunctions | IWebhookFunctions;

function cleanupExpired(store: Record<string, PendingCompanionHitlRecord>): void {
	const now = Date.now();
	for (const [requestId, record] of Object.entries(store)) {
		const ageFrom =
			record.status === 'consumed' ? (record.consumedAt ?? record.createdAt) : record.createdAt;
		const maxAge =
			record.status === 'consumed'
				? CONSUMED_MAX_AGE_MS
				: Math.min(
					record.timeoutMs && record.timeoutMs > 0 ? record.timeoutMs : DEFAULT_PENDING_MAX_AGE_MS,
					MAX_PENDING_MAX_AGE_MS,
				);
		if (now - ageFrom > maxAge) {
			delete store[requestId];
		}
	}
}

export function createPendingHitlStore<TRecord extends PendingCompanionHitlRecord>(storeKey: string) {
	function getStore(ctx: StaticDataContext): Record<string, TRecord> {
		assertStaticDataStoreQueueSafe(
			ctx,
			'Companion HITL pending store',
			'Select the Postgres pending store backend for HITL companion nodes, or run n8n without queue mode.',
		);
		const staticData = ctx.getWorkflowStaticData('node') as Record<string, unknown>;
		if (!staticData[storeKey] || typeof staticData[storeKey] !== 'object') {
			staticData[storeKey] = {};
		}
		return staticData[storeKey] as Record<string, TRecord>;
	}

	function save(ctx: StaticDataContext, record: TRecord): void {
		const store = getStore(ctx);
		cleanupExpired(store);
		const existing = store[record.requestId];
		if (existing?.status === 'consumed') {
			// Keep consumed tombstones so late duplicate webhooks remain idempotent.
			return;
		}
		store[record.requestId] = record;
	}

	function get(ctx: StaticDataContext, requestId: string): TRecord | undefined {
		const store = getStore(ctx);
		cleanupExpired(store);
		return store[requestId];
	}

	function consume(ctx: StaticDataContext, requestId: string): TRecord | undefined {
		const store = getStore(ctx);
		cleanupExpired(store);
		const existing = store[requestId];
		if (!existing) return undefined;
		if (existing.status === 'consumed') return existing;
		const consumed: TRecord = {
			...existing,
			status: 'consumed',
			consumedAt: Date.now(),
		};
		store[requestId] = consumed;
		return consumed;
	}

	function consumeWithDecision(
		ctx: StaticDataContext,
		requestId: string,
		decisionKey: string,
		fallbackRecord?: TRecord,
	): PendingCompanionConsumeResult<TRecord> {
		const store = getStore(ctx);
		cleanupExpired(store);
		const existing = store[requestId];

		if (!existing) {
			if (!fallbackRecord) {
				return { status: 'missing' };
			}
			const consumedFallback: TRecord = {
				...fallbackRecord,
				status: 'consumed',
				consumedAt: Date.now(),
				consumedDecisionKey: decisionKey,
			};
			store[requestId] = consumedFallback;
			return { status: 'accepted', record: consumedFallback };
		}

		if (existing.status === 'consumed') {
			if (existing.consumedDecisionKey && existing.consumedDecisionKey === decisionKey) {
				return { status: 'duplicate', record: existing };
			}
			return { status: 'conflict', record: existing };
		}

		const consumed: TRecord = {
			...existing,
			status: 'consumed',
			consumedAt: Date.now(),
			consumedDecisionKey: decisionKey,
		};
		store[requestId] = consumed;
		return { status: 'accepted', record: consumed };
	}

	return { save, get, consume, consumeWithDecision };
}
