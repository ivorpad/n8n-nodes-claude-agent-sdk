import type { IWebhookFunctions } from 'n8n-workflow';
import type { HitlQuestionDefinition } from '../hitl/contractTypes';

import { clearRequestResponse, storeRequestResponse } from '../streaming/ResponseStore';
import { createReplayService } from '../streaming/replayService';
import { createPostgresStreamStoreHandle } from '../streaming/streamStoreFactory';
import { resolveQuestionResponseAction as resolveQuestionResponseActionFromPolicy } from '../hitl/questionPolicy';

const WEBHOOK_DECISION_LEDGER_KEY = '__claudeAgentSdk_hitlWebhookDecisions';
const WEBHOOK_DECISION_LEDGER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type DecisionLedgerEntry = {
	decisionKey: string;
	consumedAt: number;
};

export type WebhookQuery = {
	requestId?: string;
	approved?: string;
	fp?: string;
	task?: string;
	sid?: string;
	rsat?: string;
	afps?: string;
	format?: string;
	type?: string;
	q?: string;
	streamKey?: string;
	cursor?: string;
	replay?: string;
	limit?: string;
	responseAction?: string;
};

export type WebhookQuestion = HitlQuestionDefinition;

function setStreamHeaders(res: ReturnType<IWebhookFunctions['getResponseObject']>): void {
	res.setHeader('Content-Type', 'application/x-ndjson');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');
}

export function resolveStreamKey(query: WebhookQuery): string | undefined {
	if (typeof query.streamKey === 'string' && query.streamKey.trim().length > 0) {
		return query.streamKey.trim();
	}
	if (typeof query.requestId === 'string' && query.requestId.trim().length > 0) {
		return query.requestId.trim();
	}
	return undefined;
}

export function parseQuestionsFromEncodedQuery(value: unknown): WebhookQuestion[] {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return [];
	}

	try {
		const decoded = Buffer.from(value, 'base64').toString('utf-8');
		const parsed = JSON.parse(decoded);
		return Array.isArray(parsed) ? (parsed as WebhookQuestion[]) : [];
	} catch {
		return [];
	}
}

export async function attachStreamResponse(args: {
	ctx: IWebhookFunctions;
	query: WebhookQuery;
	streamKey: string;
	requireExistingState: boolean;
}): Promise<void> {
	const { ctx, query, streamKey, requireExistingState } = args;
	const res = ctx.getResponseObject();
	const streamStoreHandle = await createPostgresStreamStoreHandle({
		execFunctions: ctx,
	});

	if (!streamStoreHandle) {
		if (requireExistingState) {
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
			res.end('Error: Durable replay is unavailable because the Postgres credential is not configured.');
			return;
		}
		setStreamHeaders(res);
		storeRequestResponse(streamKey, res);
		return;
	}

	try {
		const existingState = await streamStoreHandle.store.getStreamState(streamKey);
		if (!existingState) {
			if (requireExistingState) {
				res.setHeader('Content-Type', 'text/plain; charset=utf-8');
				res.end(`Error: No durable stream found for streamKey "${streamKey}".`);
				return;
			}
			setStreamHeaders(res);
			storeRequestResponse(streamKey, res);
			return;
		}

		const replayService = createReplayService({
			streamStore: streamStoreHandle.store,
			responseStore: {
				storeRequestResponse,
				clearRequestResponse,
			},
		});
		await replayService.replayToResponse(
			{
				streamKey,
				cursor: query.cursor ? Number(query.cursor) : undefined,
				limit: query.limit ? Number(query.limit) : undefined,
				tailLive: true,
			},
			res,
		);
	} finally {
		await streamStoreHandle.close();
	}
}

function getDecisionLedger(ctx: IWebhookFunctions): Record<string, DecisionLedgerEntry> {
	const staticData = ctx.getWorkflowStaticData('node') as Record<string, unknown>;
	if (!staticData[WEBHOOK_DECISION_LEDGER_KEY] || typeof staticData[WEBHOOK_DECISION_LEDGER_KEY] !== 'object') {
		staticData[WEBHOOK_DECISION_LEDGER_KEY] = {};
	}
	return staticData[WEBHOOK_DECISION_LEDGER_KEY] as Record<string, DecisionLedgerEntry>;
}

export function consumeWebhookDecision(
	ctx: IWebhookFunctions,
	requestId: string,
	decisionKey: string,
): 'accepted' | 'duplicate' | 'conflict' {
	const ledger = getDecisionLedger(ctx);
	const now = Date.now();

	for (const [key, entry] of Object.entries(ledger)) {
		if (!entry || typeof entry !== 'object') {
			delete ledger[key];
			continue;
		}
		if (now - entry.consumedAt > WEBHOOK_DECISION_LEDGER_TTL_MS) {
			delete ledger[key];
		}
	}

	const existing = ledger[requestId];
	if (!existing) {
		ledger[requestId] = { decisionKey, consumedAt: now };
		return 'accepted';
	}

	if (existing.decisionKey === decisionKey) {
		return 'duplicate';
	}

	return 'conflict';
}

export function normalizeAnswersForDecision(
	answers: Record<string, string | string[]>,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(answers)) {
		if (Array.isArray(value)) {
			normalized[key] = value.map((entry) => String(entry)).join(', ');
		} else {
			normalized[key] = String(value);
		}
	}
	return normalized;
}

export function resolveQuestionControlAction(args: {
	storedQuestions?: WebhookQuestion[];
	queryEncodedQuestions?: unknown;
	answers: Record<string, string | string[]>;
	explicitResponseAction?: unknown;
}): 'resume' | 'complete' | undefined {
	const questions = args.storedQuestions && args.storedQuestions.length > 0
		? args.storedQuestions
		: parseQuestionsFromEncodedQuery(args.queryEncodedQuestions);

	return resolveQuestionResponseActionFromPolicy({
		questions,
		answers: args.answers,
		explicitResponseAction: args.explicitResponseAction,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate updatedInput from a webhook POST body.
 * Accepts a plain object or a JSON string; rejects arrays/primitives/null.
 */
export function parseUpdatedInput(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			if (isRecord(parsed)) return parsed;
		} catch {
			return undefined;
		}
		return undefined;
	}
	if (isRecord(value)) return value;
	return undefined;
}

/**
 * Parse an optional reviewer message string, trimming whitespace.
 */
export function parseReviewerMessage(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
