import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import {
	createPostgresConnectionHandle,
	type N8nPostgresCredential,
} from '../../shared/postgresConnection';
import { PostgresHitlInteractionStore } from './PostgresHitlInteractionStore';
import type { SecretsRedactor } from '../operations/executeTask/secretsRedaction';
import type {
	ApprovalInteractionRecord,
	HitlInteractionRecord,
	HitlInteractionStore,
	HitlInteractionStoreHandle,
	QuestionInteractionRecord,
} from './interactionStoreTypes';

type StoreContext = IExecuteFunctions | IWebhookFunctions;

const STATIC_DATA_STORE_KEY = '__claudeAgentSdk_hitlInteractions';
const DEFAULT_ANSWERED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_INTERACTIONS_TABLE = 'claude_hitl_interactions';
const fallbackStaticStores = new WeakMap<object, Record<string, HitlInteractionRecord>>();

export type { HitlInteractionRecord, HitlInteractionStore, HitlInteractionStoreHandle } from './interactionStoreTypes';

function cleanupExpired(store: Record<string, HitlInteractionRecord>): void {
	const now = Date.now();

	for (const [requestId, record] of Object.entries(store)) {
		const ageFrom = record.status === 'answered'
			? (record.answeredAt ?? record.createdAt)
			: record.createdAt;
		const maxAge = record.status === 'answered'
			? DEFAULT_ANSWERED_MAX_AGE_MS
			: Math.min(record.timeoutMs || DEFAULT_ANSWERED_MAX_AGE_MS, MAX_PENDING_MAX_AGE_MS);
		if (now - ageFrom > maxAge) {
			delete store[requestId];
		}
	}
}

function getStaticStore(ctx: StoreContext): Record<string, HitlInteractionRecord> {
	if (typeof ctx.getWorkflowStaticData !== 'function') {
		const existingFallback = fallbackStaticStores.get(ctx);
		if (existingFallback) {
			return existingFallback;
		}

		const fallbackStore: Record<string, HitlInteractionRecord> = {};
		fallbackStaticStores.set(ctx, fallbackStore);
		return fallbackStore;
	}

	const staticData = ctx.getWorkflowStaticData('node') as Record<string, unknown> | undefined;
	if (!staticData || typeof staticData !== 'object') {
		const existingFallback = fallbackStaticStores.get(ctx);
		if (existingFallback) {
			return existingFallback;
		}

		const fallbackStore: Record<string, HitlInteractionRecord> = {};
		fallbackStaticStores.set(ctx, fallbackStore);
		return fallbackStore;
	}

	if (!staticData[STATIC_DATA_STORE_KEY] || typeof staticData[STATIC_DATA_STORE_KEY] !== 'object') {
		staticData[STATIC_DATA_STORE_KEY] = {};
	}
	return staticData[STATIC_DATA_STORE_KEY] as Record<string, HitlInteractionRecord>;
}

function createStaticHitlInteractionStore(ctx: StoreContext): HitlInteractionStore {
	return {
		backend: 'staticData',
		async saveInteraction(record) {
			const store = getStaticStore(ctx);
			cleanupExpired(store);
			const existing = store[record.requestId];
			if (existing?.status === 'answered') {
				return;
			}
			store[record.requestId] = existing
				? { ...existing, ...record, status: 'pending' }
				: record;
		},
		async getInteraction(requestId) {
			const store = getStaticStore(ctx);
			cleanupExpired(store);
			return store[requestId];
		},
		async consumeApprovalDecision(args) {
			const store = getStaticStore(ctx);
			cleanupExpired(store);
			const existing = store[args.requestId];
			if (!existing) {
				return { status: 'missing' };
			}
			if (existing.kind !== 'approval') {
				return { status: 'conflict' };
			}
			if (existing.status === 'answered') {
				return {
					status: existing.decisionKey === args.decisionKey ? 'duplicate' : 'conflict',
					record: existing,
				};
			}

			const answered: ApprovalInteractionRecord = {
				...existing,
				status: 'answered',
				answeredAt: args.decidedAt,
				decisionKey: args.decisionKey,
				decisionId: args.decisionId,
				decisionChannel: args.channel,
				approved: args.approved,
				fingerprint: args.fingerprint ?? existing.fingerprint,
				permissionModeOverride: args.permissionModeOverride,
				reviewerMessage: args.reviewerMessage,
				updatedInput: args.updatedInput,
			};
			store[args.requestId] = answered;
			return { status: 'accepted', record: answered };
		},
		async consumeQuestionDecision(args) {
			const store = getStaticStore(ctx);
			cleanupExpired(store);
			const existing = store[args.requestId];
			if (!existing) {
				return { status: 'missing' };
			}
			if (existing.kind !== 'question') {
				return { status: 'conflict' };
			}
			if (existing.status === 'answered') {
				return {
					status: existing.decisionKey === args.decisionKey ? 'duplicate' : 'conflict',
					record: existing,
				};
			}

			const answered: QuestionInteractionRecord = {
				...existing,
				status: 'answered',
				answeredAt: args.decidedAt,
				decisionKey: args.decisionKey,
				decisionId: args.decisionId,
				decisionChannel: args.channel,
				answers: args.answers,
				responseAction: args.responseAction,
			};
			store[args.requestId] = answered;
			return { status: 'accepted', record: answered };
		},
	};
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;
}

export async function createHitlInteractionStoreHandle(args: {
	ctx: StoreContext;
	credentialName?: string;
	/**
	 * Masks secrets before persisting interaction rows (V4: HITL store sink).
	 * Optional — webhook/read paths default to a no-op redactor.
	 */
	secretRedactor?: SecretsRedactor;
}): Promise<HitlInteractionStoreHandle> {
	const credentialName = asNonEmptyString(args.credentialName) ?? 'postgres';
	let hasCredentialConfigured = false;
	try {
		hasCredentialConfigured = Boolean(
			(args.ctx.getNode().credentials as Record<string, unknown> | undefined)?.[credentialName],
		);
	} catch {
		hasCredentialConfigured = false;
	}

	let credential: N8nPostgresCredential | undefined;
	try {
		credential = await args.ctx.getCredentials(credentialName) as N8nPostgresCredential;
	} catch (error) {
		if (hasCredentialConfigured) {
			throw error;
		}
		const staticStore = createStaticHitlInteractionStore(args.ctx);
		return {
			store: staticStore,
			backend: staticStore.backend,
			close: async () => {},
		};
	}

	const handle = await createPostgresConnectionHandle({
		execFunctions: args.ctx,
		credential,
	});

	try {
		let workflowId = '__unknown_workflow__';
		let nodeName = '__unknown_node__';
		try {
			workflowId = String(args.ctx.getWorkflow().id ?? '__unknown_workflow__');
		} catch {
			workflowId = '__unknown_workflow__';
		}
		try {
			nodeName = args.ctx.getNode().name || '__unknown_node__';
		} catch {
			nodeName = '__unknown_node__';
		}
		const store = new PostgresHitlInteractionStore({
			pool: handle.pool,
			workflowId,
			nodeName,
			// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
			tableName: asNonEmptyString(process.env.CLAUDE_AGENT_HITL_INTERACTIONS_TABLE) ?? DEFAULT_INTERACTIONS_TABLE,
			secretRedactor: args.secretRedactor,
		});
		await store.ensureSchema();
		return {
			store,
			backend: store.backend,
			close: handle.close,
		};
	} catch (error) {
		await handle.close().catch(() => {});
		throw error;
	}
}
