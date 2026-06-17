import type { INodeExecutionData, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

import { buildQuestionFormHtml, FORM_CSP, parseQuestionSubmission } from '../webhook/questionForm';
import { HITL_CONTRACT_VERSION } from '../hitl/contract';
import type { HitlInteractionRecord, HitlInteractionStore } from '../hitl/interactionStore';
import {
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import { isN8nQueueMode } from '../../ClaudeAgentChannelShared/core/queueMode';
import {
	type WebhookQuery,
	type WebhookQuestion,
	attachStreamResponse,
	consumeWebhookDecision,
	normalizeAnswersForDecision,
	parseQuestionsFromEncodedQuery,
	resolveQuestionControlAction,
} from './webhookHelpers';

interface QuestionHandlerArgs {
	ctx: IWebhookFunctions;
	query: WebhookQuery;
	requestId: string;
	storedInteraction: HitlInteractionRecord | undefined;
	storedQuestions: WebhookQuestion[] | undefined;
	hitlInteractionStore: HitlInteractionStore;
	effectiveStreamKey: string | undefined;
	isStreamFormat: boolean;
	hasAuditLogging: boolean;
	authentication: { ok: true; responder?: unknown };
}

/**
 * Trust boundary helper for building the question resume payload.
 *
 * n8n's webhook-waiting resume token signs only the execution + node path,
 * NOT the query string, so query parameters are attacker-controllable by any
 * holder of the resume URL. `fromRecord` returns ONLY the value persisted in
 * the interaction record. Every security-relevant resume field (anything
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

function buildOutputs(
	payload: Record<string, unknown>,
	hasAuditLogging: boolean,
): INodeExecutionData[][] {
	const json = payload as INodeExecutionData['json'];
	const outputs: INodeExecutionData[][] = [[{ json }]];
	if (hasAuditLogging) {
		outputs.push([]);
	}
	return outputs;
}

function handleConsumeStatus(
	status: string,
): IWebhookResponseData | null {
	if (status === 'duplicate') {
		return { webhookResponse: 'This HITL request was already answered.' };
	}
	if (status === 'conflict') {
		return { webhookResponse: 'This HITL request was already answered with a different response.' };
	}
	if (status === 'missing') {
		return { webhookResponse: 'This HITL request expired or could not be found.' };
	}
	return null;
}

// ─────────────────────────────────────────────────────────────────────────
// GET question handler (form render + field-param answers)
// ─────────────────────────────────────────────────────────────────────────

export async function handleGetQuestion(
	args: QuestionHandlerArgs,
): Promise<IWebhookResponseData> {
	const { ctx, query, storedQuestions } = args;

	// CSRF: a GET must NEVER consume the answer. Link scanners, unfurlers and
	// browser prefetch issue automatic GETs against the resume URL — including
	// ones that carry field-* params. A GET therefore always renders the form
	// (which POSTs the answers back); only the POST consumes (handlePostQuestion).
	const questions = storedQuestions ?? parseQuestionsFromEncodedQuery(query.q);
	if (questions.length > 0) {
		try {
			const html = buildQuestionFormHtml(
				questions,
				'Claude needs your input',
				'Please answer the following questions to continue:',
			);
			const res = ctx.getResponseObject();
			res.setHeader('Content-Security-Policy', FORM_CSP);
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.send(html);
			return { noWebhookResponse: true };
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error('[Claude Agent SDK] Failed to render question form:', error);
			return { webhookResponse: 'Error: Failed to render question form' };
		}
	}

	return { webhookResponse: 'Error: No questions found' };
}

// ─────────────────────────────────────────────────────────────────────────
// POST question handler
// ─────────────────────────────────────────────────────────────────────────

export async function handlePostQuestion(
	args: QuestionHandlerArgs & { body: Record<string, unknown> },
): Promise<IWebhookResponseData> {
	const { query, body, storedQuestions } = args;

	const hasFormFields = Object.keys(body).some((k) => k.startsWith('field-'));
	const questions = storedQuestions ?? parseQuestionsFromEncodedQuery(query.q);

	let answers: Record<string, string | string[]>;
	if (hasFormFields && questions.length > 0) {
		try {
			answers = parseQuestionSubmission(body, questions).answers;
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error('[Claude Agent SDK] Failed to parse form answers:', error);
			return { webhookResponse: 'Error: Failed to parse form answers' };
		}
	} else if (body.answers) {
		answers = body.answers as Record<string, string>;
	} else if (body.response) {
		answers = { response: body.response as string };
	} else {
		return { webhookResponse: 'Error: Missing answers or form data' };
	}

	return consumeAndReturnQuestion({
		...args,
		answers,
		isFormSubmission: hasFormFields,
		// CH-1: do NOT trust a caller-supplied responseAction (query or body). A
		// leaked/forwarded resume URL could pass responseAction=complete to force
		// the agent loop to terminate. The action is derived from the persisted
		// question options only (resolveQuestionControlAction).
		explicitResponseAction: undefined,
	});
}

// ─────────────────────────────────────────────────────────────────────────
// Shared question consume + response builder
// ─────────────────────────────────────────────────────────────────────────

async function consumeAndReturnQuestion(
	args: QuestionHandlerArgs & {
		answers: Record<string, string | string[]>;
		isFormSubmission: boolean;
		explicitResponseAction?: unknown;
	},
): Promise<IWebhookResponseData> {
	const { ctx, query, requestId, storedInteraction, storedQuestions,
		hitlInteractionStore, effectiveStreamKey, isStreamFormat,
		hasAuditLogging, authentication,
		answers, isFormSubmission, explicitResponseAction } = args;

	const decidedAt = new Date().toISOString();
	const responseAction = resolveQuestionControlAction({
		storedQuestions,
		queryEncodedQuestions: query.q,
		answers,
		explicitResponseAction,
	});
	const decisionKey = buildChannelReplyDecisionKey({
		kind: 'question',
		decisionType: 'answers',
		answers: normalizeAnswersForDecision(answers),
		responseAction,
	});
	const decisionId = buildChannelReplyDecisionId(requestId, decisionKey);
	const consumeResult = storedInteraction
		? await hitlInteractionStore.consumeQuestionDecision({
			requestId, decisionKey, decisionId,
			decidedAt: Date.parse(decidedAt), channel: 'webhook',
			answers, responseAction,
		})
		: isN8nQueueMode()
			? { status: 'missing' as const }
			: {
				status: consumeWebhookDecision(ctx, requestId, decisionKey) as
					| 'accepted'
					| 'duplicate'
					| 'conflict',
			};

	if (consumeResult.status === 'duplicate' && isStreamFormat && effectiveStreamKey) {
		await attachStreamResponse({ ctx, query, streamKey: effectiveStreamKey, requireExistingState: false });
		return { noWebhookResponse: true };
	}
	const earlyReturn = handleConsumeStatus(consumeResult.status);
	if (earlyReturn) return earlyReturn;

	const questionRecord = ('record' in consumeResult ? consumeResult.record : undefined) ?? storedInteraction;
	const payload = {
		version: HITL_CONTRACT_VERSION,
		type: 'question_response' as const,
		requestId, decisionId, decidedAt, channel: 'webhook', answers,
		// Security-relevant resume fields are sourced from the persisted record
		// ONLY (never the attacker-controllable query string — the n8n resume
		// signature does not cover query params). No record => empty on resume,
		// which is the correct, safe posture.
		originalTask: fromRecord(questionRecord?.originalTaskBase64),
		resumeSessionId: fromRecord(questionRecord?.sessionId),
		resumeSessionAt: fromRecord(questionRecord?.resumeSessionAt),
		approvedFingerprints: fromRecord(questionRecord?.approvedFingerprints),
		streamingRequestId: isStreamFormat ? effectiveStreamKey : undefined,
		streamKey: effectiveStreamKey,
		responseAction: responseAction ?? (questionRecord?.kind === 'question' ? questionRecord.responseAction : undefined),
		responder: authentication.responder,
		timestamp: decidedAt,
	};

	const res = ctx.getResponseObject();
	if (isStreamFormat && effectiveStreamKey) {
		await attachStreamResponse({ ctx, query, streamKey: effectiveStreamKey, requireExistingState: false });
	} else if (isFormSubmission) {
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.send(
			'<!DOCTYPE html><html><head><title>Response Received</title>' +
			'<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}' +
			'.card{background:#fff;padding:40px 60px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}' +
			'h1{color:#166534}</style></head>' +
			'<body><div class="card"><h1>Response Received</h1><p>You can close this page.</p></div></body></html>',
		);
	} else {
		res.setHeader('Content-Type', 'application/json');
		res.send(JSON.stringify({ success: true, message: 'Response received' }));
	}

	return { noWebhookResponse: true, workflowData: buildOutputs(payload, hasAuditLogging) };
}
