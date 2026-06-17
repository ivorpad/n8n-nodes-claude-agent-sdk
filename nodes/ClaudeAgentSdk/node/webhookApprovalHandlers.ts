import type { INodeExecutionData, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

import { HITL_CONTRACT_VERSION } from '../hitl/contract';
import type { ApprovalInteractionRecord, HitlDecisionResult } from '../hitl/interactionStoreTypes';
import type { HitlInteractionRecord, HitlInteractionStore } from '../hitl/interactionStore';
import {
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import { parseApprovalDecision } from '../../ClaudeAgentChannelShared/core/webhookRuntime';
import {
	type WebhookQuery,
	attachStreamResponse,
	consumeWebhookDecision,
	parseReviewerMessage,
	parseUpdatedInput,
} from './webhookHelpers';

interface ApprovalHandlerArgs {
	ctx: IWebhookFunctions;
	query: WebhookQuery;
	requestId: string;
	storedInteraction: HitlInteractionRecord | undefined;
	hitlInteractionStore: HitlInteractionStore;
	effectiveStreamKey: string | undefined;
	isStreamFormat: boolean;
	hasAuditLogging: boolean;
	authentication: { ok: true; responder?: unknown };
}

interface ApprovalDecisionInput {
	approved: boolean;
	reviewerMessage?: string;
	updatedInput?: Record<string, unknown>;
}

interface ApprovalDecisionContext extends ApprovalDecisionInput {
	decidedAt: string;
	decisionKey: string;
	decisionId: string;
}

const APPROVAL_CONSUME_MESSAGES: Record<string, string> = {
	duplicate: 'This HITL request was already answered.',
	conflict: 'This HITL request was already answered with a different response.',
	missing: 'This HITL request expired or could not be found.',
};

function buildApprovalOutputs(
	payload: Record<string, unknown>,
	hasAuditLogging: boolean,
): INodeExecutionData[][] {
	const resultOutput = [{ json: payload as INodeExecutionData['json'] }];
	return hasAuditLogging ? [resultOutput, []] : [resultOutput];
}

function buildApprovalConsumeStatusResponse(status: string): IWebhookResponseData | null {
	const message = APPROVAL_CONSUME_MESSAGES[status];
	return message ? { webhookResponse: message } : null;
}

// The confirmation page (V6) POSTs `approved` as a string form field, while
// programmatic callers may send a real boolean. Normalize both to a boolean so
// the explicit POST always consumes; an unrecognised string is treated as
// "absent" so it cannot silently flip a decision.
function normalizeBodyApproved(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		return parseApprovalDecision(value);
	}
	return undefined;
}

function resolveApprovalValue(args: {
	queryApproved: string | undefined;
	bodyApproved: unknown;
}): boolean | { error: string } {
	let approved: boolean | undefined;
	if (args.queryApproved !== undefined) {
		approved = parseApprovalDecision(args.queryApproved);
	}

	const bodyApproved = normalizeBodyApproved(args.bodyApproved);
	if (typeof bodyApproved === 'boolean') {
		if (approved !== undefined && approved !== bodyApproved) {
			return { error: 'Error: approved in query and body disagree' };
		}
		approved = bodyApproved;
	}

	if (typeof approved !== 'boolean') {
		return { error: 'Error: Missing approved parameter' };
	}

	return approved;
}

function resolveUpdatedInput(
	value: unknown,
): { updatedInput?: Record<string, unknown> } | { error: string } {
	const updatedInput = parseUpdatedInput(value);
	if (value !== undefined && value !== null && !updatedInput) {
		return { error: 'Error: updatedInput must be a plain JSON object' };
	}
	return { updatedInput };
}

function resolvePostApprovalInput(args: {
	query: WebhookQuery;
	body: Record<string, unknown>;
}): ApprovalDecisionInput | { error: string } {
	const { query, body } = args;
	const approved = resolveApprovalValue({
		queryApproved: query.approved,
		bodyApproved: body.approved,
	});
	if (typeof approved !== 'boolean') {
		return approved;
	}

	const reviewerMessage = parseReviewerMessage(body.reviewerMessage ?? body.message);
	const updatedInputResult = resolveUpdatedInput(body.updatedInput);
	if ('error' in updatedInputResult) {
		return updatedInputResult;
	}

	return { approved, reviewerMessage, updatedInput: updatedInputResult.updatedInput };
}

function buildApprovalDecisionContext(
	requestId: string,
	input: ApprovalDecisionInput,
): ApprovalDecisionContext {
	const decidedAt = new Date().toISOString();
	const decisionKey = buildChannelReplyDecisionKey({
		kind: 'approval',
		decisionType: input.approved ? 'approve' : 'deny',
		approved: input.approved,
		reviewerMessage: input.reviewerMessage,
		updatedInput: input.updatedInput,
	});
	return {
		...input,
		decidedAt,
		decisionKey,
		decisionId: buildChannelReplyDecisionId(requestId, decisionKey),
	};
}

async function consumeApprovalDecision(args: {
	handlerArgs: ApprovalHandlerArgs;
	decision: ApprovalDecisionContext;
}): Promise<HitlDecisionResult<ApprovalInteractionRecord>> {
	const { handlerArgs, decision } = args;
	const { ctx, requestId, storedInteraction, hitlInteractionStore } = handlerArgs;

	if (!storedInteraction) {
		return {
			status: consumeWebhookDecision(ctx, requestId, decision.decisionKey) as
				| 'accepted'
				| 'duplicate'
				| 'conflict',
		};
	}

	return hitlInteractionStore.consumeApprovalDecision({
		requestId,
		decisionKey: decision.decisionKey,
		decisionId: decision.decisionId,
		decidedAt: Date.parse(decision.decidedAt),
		channel: 'webhook',
		approved: decision.approved,
		// Record-only: query.fp is attacker-controllable and would otherwise be
		// persisted (COALESCE) over the stored fingerprint, then read back into
		// the resume payload to approve an arbitrary tool. Use the stored
		// fingerprint exclusively.
		fingerprint: storedInteraction.kind === 'approval' ? storedInteraction.fingerprint : undefined,
		reviewerMessage: decision.reviewerMessage,
		updatedInput: decision.updatedInput,
	});
}

async function handleDuplicateStreamResponse(
	args: ApprovalHandlerArgs,
	status: string,
): Promise<IWebhookResponseData | null> {
	if (status !== 'duplicate' || !args.isStreamFormat || !args.effectiveStreamKey) {
		return null;
	}

	await attachStreamResponse({
		ctx: args.ctx,
		query: args.query,
		streamKey: args.effectiveStreamKey,
		requireExistingState: false,
	});
	return { noWebhookResponse: true };
}

function buildApprovalResponsePayload(args: {
	handlerArgs: ApprovalHandlerArgs;
	decision: ApprovalDecisionContext;
	consumeResult: HitlDecisionResult<ApprovalInteractionRecord>;
}): Record<string, unknown> {
	const { handlerArgs, decision, consumeResult } = args;
	const {
		requestId,
		storedInteraction,
		effectiveStreamKey,
		isStreamFormat,
		authentication,
	} = handlerArgs;
	const approvalRecord = resolveApprovalRecord(consumeResult, storedInteraction);

	return {
		version: HITL_CONTRACT_VERSION,
		type: 'approval_response' as const,
		requestId,
		decisionId: decision.decisionId,
		decidedAt: decision.decidedAt,
		channel: 'webhook',
		approved: decision.approved,
		// Security-relevant resume fields are sourced from the persisted record
		// ONLY (never the attacker-controllable query string). When no record
		// exists (in-memory ledger, no Postgres HITL store) these are empty on
		// resume — the correct, safe posture. Fingerprint restore across a
		// restart legitimately requires the persisted store.
		fingerprint: resolveApprovalFingerprint(approvalRecord),
		originalTask: fromRecord(approvalRecord?.originalTaskBase64),
		sessionId: fromRecord(approvalRecord?.sessionId),
		resumeSessionId: fromRecord(approvalRecord?.sessionId),
		resumeSessionAt: fromRecord(approvalRecord?.resumeSessionAt),
		approvedFingerprints: fromRecord(approvalRecord?.approvedFingerprints),
		streamingRequestId: isStreamFormat ? effectiveStreamKey : undefined,
		streamKey: effectiveStreamKey,
		responder: authentication.responder,
		reviewerMessage: decision.reviewerMessage,
		updatedInput: decision.updatedInput,
		timestamp: decision.decidedAt,
	};
}

function resolveApprovalRecord(
	consumeResult: HitlDecisionResult<ApprovalInteractionRecord>,
	storedInteraction: HitlInteractionRecord | undefined,
): ApprovalInteractionRecord | HitlInteractionRecord | undefined {
	return consumeResult.record ?? storedInteraction;
}

function resolveApprovalFingerprint(
	approvalRecord: ApprovalInteractionRecord | HitlInteractionRecord | undefined,
): string | undefined {
	// Record-only: the approval fingerprint is consumed to mark a tool approved
	// on resume, so it must never come from the query string (which is not
	// covered by the n8n resume signature). No record => no approval.
	if (approvalRecord?.kind === 'approval') {
		return approvalRecord.fingerprint;
	}
	return undefined;
}

/**
 * Trust boundary helper for building the approval resume payload.
 *
 * n8n's webhook-waiting resume token signs only the execution + node path,
 * NOT the query string, so query parameters are attacker-controllable by any
 * holder of an approve/deny URL. `fromRecord` returns ONLY the value persisted
 * in the interaction record. Every security-relevant resume field (anything
 * consumed for authorization or replay control on resume) is built through it,
 * so a forged query param can never grant authority.
 *
 * If a purely cosmetic, non-authorizing echo of a query value is ever needed,
 * add an explicitly named `untrustedQueryFallback(stored, query)` helper rather
 * than widening this one — keep the trust decision visible at each call site.
 */
function fromRecord(storedValue: string | undefined): string | undefined {
	return storedValue || undefined;
}

async function sendApprovalResponse(args: {
	handlerArgs: ApprovalHandlerArgs;
	approved: boolean;
	format: 'html' | 'json';
}): Promise<void> {
	const { handlerArgs, approved, format } = args;
	const { ctx, query, effectiveStreamKey, isStreamFormat } = handlerArgs;
	if (isStreamFormat && effectiveStreamKey) {
		await attachStreamResponse({
			ctx,
			query,
			streamKey: effectiveStreamKey,
			requireExistingState: false,
		});
		return;
	}

	const res = ctx.getResponseObject();
	if (format === 'json') {
		res.setHeader('Content-Type', 'application/json');
		res.send(JSON.stringify({ success: true, message: approved ? 'Approved' : 'Denied' }));
		return;
	}

	const color = approved ? '#166534' : '#991b1b';
	const title = approved ? 'Approved' : 'Denied';
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(
		`<!DOCTYPE html><html><head><title>${title}</title>` +
			`<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}` +
			`.card{background:#fff;padding:40px 60px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}` +
			`h1{color:${color}}</style></head>` +
			`<body><div class="card"><h1>${title}</h1><p>You can close this page.</p></div></body></html>`,
	);
}

async function consumeAndReturnApproval(args: {
	handlerArgs: ApprovalHandlerArgs;
	input: ApprovalDecisionInput;
	format: 'html' | 'json';
}): Promise<IWebhookResponseData> {
	const { handlerArgs, input, format } = args;
	const decision = buildApprovalDecisionContext(handlerArgs.requestId, input);
	const consumeResult = await consumeApprovalDecision({ handlerArgs, decision });
	const duplicateStreamResponse = await handleDuplicateStreamResponse(
		handlerArgs,
		consumeResult.status,
	);
	if (duplicateStreamResponse) {
		return duplicateStreamResponse;
	}

	const earlyReturn = buildApprovalConsumeStatusResponse(consumeResult.status);
	if (earlyReturn) {
		return earlyReturn;
	}

	const payload = buildApprovalResponsePayload({
		handlerArgs,
		decision,
		consumeResult,
	});
	await sendApprovalResponse({ handlerArgs, approved: input.approved, format });

	return {
		noWebhookResponse: true,
		workflowData: buildApprovalOutputs(payload, handlerArgs.hasAuditLogging),
	};
}

export async function handlePostApproval(
	args: ApprovalHandlerArgs & { body: Record<string, unknown> },
): Promise<IWebhookResponseData> {
	const input = resolvePostApprovalInput({
		query: args.query,
		body: args.body,
	});
	if ('error' in input) {
		return { webhookResponse: input.error };
	}

	return consumeAndReturnApproval({
		handlerArgs: args,
		input,
		format: 'json',
	});
}
