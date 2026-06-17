import type { IExecuteFunctions } from 'n8n-workflow';

import {
	assertHitlResponseEnvelope,
	buildHitlApprovalResponseEnvelope,
	buildHitlQuestionResponseEnvelope,
	type HitlQuestionDefinition,
	type HitlResponseEnvelope,
} from '../../ClaudeAgentSdk/hitl/contract';
import { resolveQuestionResponseAction } from '../../ClaudeAgentSdk/hitl/questionPolicy';
import {
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
	parseReplyToken,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import {
	consumePendingWithDecision,
	getLatestPendingByRecipient,
	getPending,
	getPendingByProviderMessageId,
} from '../store/PendingWoztellHitlStore';
import type {
	PendingStoreBackend,
	PendingWoztellHitlRecord,
} from '../types';

interface ParsedTriggerInbound {
	hasMessage: boolean;
	requestId?: string;
	approved?: boolean;
	fingerprint?: string;
	senderId?: string;
	contextMessageId?: string;
	textAnswer?: string;
	selectedLabel?: string;
	questionIndex?: number;
	optionIndex?: number;
}

type TriggerHandlingResult =
	| { mode: 'passthrough' }
	| { mode: 'drop' }
	| { mode: 'envelope'; envelope: HitlResponseEnvelope };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;
}

export function normalizeRecipientId(phoneNumber: string): string {
	return phoneNumber.replace(/[\s\-()+]/g, '');
}

function parseApprovalFromText(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return undefined;
	if (['approve', 'approved', 'yes', 'y', 'allow', 'ok'].includes(normalized)) return true;
	if (['deny', 'denied', 'no', 'n', 'reject', 'block'].includes(normalized)) return false;
	return undefined;
}

// ---------------------------------------------------------------------------
// Woztell inbound event parsing
// ---------------------------------------------------------------------------

function parseTriggerInbound(input: Record<string, unknown>): ParsedTriggerInbound {
	const type = asNonEmptyString(input.type);
	if (!type) {
		return { hasMessage: false };
	}

	const data = isRecord(input.data) ? input.data : undefined;
	const from = asNonEmptyString(input.from);
	const context = isRecord(input.context) ? input.context : undefined;
	const replyTo = isRecord(input.replyTo) ? input.replyTo : undefined;
	const contextMessageId = asNonEmptyString(context?.id)
		?? asNonEmptyString(replyTo?.messageId);

	const inbound: ParsedTriggerInbound = {
		hasMessage: true,
		senderId: from,
		contextMessageId,
	};

	if (type === 'PAYLOAD') {
		const payloadValue = asNonEmptyString(data?.payload);
		const token = parseReplyToken(payloadValue);
		if (token) {
			inbound.requestId = token.requestId;
			inbound.approved = token.approved;
			inbound.fingerprint = token.fingerprint;
			inbound.questionIndex = token.questionIndex;
			inbound.optionIndex = token.optionIndex;
		}
		inbound.selectedLabel = asNonEmptyString(data?.title);
	} else if (type === 'TEXT') {
		inbound.textAnswer = asNonEmptyString(data?.text);
	} else if (type === 'INTERACTIVE_MESSAGE_REPLY') {
		const payloadValue = asNonEmptyString(data?.payload) ?? asNonEmptyString(data?.id);
		const token = parseReplyToken(payloadValue);
		if (token) {
			inbound.requestId = token.requestId;
			inbound.fingerprint = token.fingerprint;
			inbound.questionIndex = token.questionIndex;
			inbound.optionIndex = token.optionIndex;
		}
		inbound.selectedLabel = asNonEmptyString(data?.title);
	}

	return inbound;
}

// ---------------------------------------------------------------------------
// Question answer building
// ---------------------------------------------------------------------------

function buildQuestionAnswersFromInbound(args: {
	pending?: PendingWoztellHitlRecord;
	inbound: ParsedTriggerInbound;
}): Record<string, string | string[]> {
	const { pending, inbound } = args;
	if (!pending?.questions || pending.questions.length === 0) return {};

	const questionIndex = inbound.questionIndex ?? 0;
	const question = pending.questions[questionIndex];
	if (!question) return {};

	const answers: Record<string, string> = {};
	const questionText = question.question;

	if (
		typeof inbound.optionIndex === 'number'
		&& Array.isArray(question.options)
		&& question.options[inbound.optionIndex]
	) {
		answers[questionText] = question.options[inbound.optionIndex].label;
		return answers;
	}

	if (inbound.selectedLabel && Array.isArray(question.options) && question.options.length > 0) {
		const matched = question.options.find((option) => option.label === inbound.selectedLabel);
		if (matched) {
			answers[questionText] = matched.label;
			return answers;
		}
	}

	if (inbound.textAnswer) {
		answers[questionText] = inbound.textAnswer;
		return answers;
	}

	return {};
}

function getFirstQuestion(questions: HitlQuestionDefinition[] | undefined): HitlQuestionDefinition | undefined {
	return Array.isArray(questions) && questions.length > 0
		? questions[0]
		: undefined;
}

// ---------------------------------------------------------------------------
// Trigger inbound handler
// ---------------------------------------------------------------------------

export async function handleTriggerInbound(
	ctx: IExecuteFunctions,
	itemJson: Record<string, unknown>,
	itemIndex: number,
): Promise<TriggerHandlingResult | undefined> {
	// Detect Woztell webhook event shape
	const eventType = asNonEmptyString(itemJson.eventType);
	const messageType = asNonEmptyString(itemJson.type);
	const looksLikeWoztellTriggerEvent = eventType === 'INBOUND'
		&& (messageType === 'TEXT' || messageType === 'PAYLOAD' || messageType === 'INTERACTIVE_MESSAGE_REPLY');
	if (!looksLikeWoztellTriggerEvent) return undefined;

	const pendingStoreBackend = ctx.getNodeParameter(
		'pendingStoreBackend',
		itemIndex,
		'staticData',
	) as PendingStoreBackend;
	const pendingStoreTableName = ctx.getNodeParameter(
		'pendingStoreTableName',
		itemIndex,
		'claude_hitl_pending',
	) as string;
	const storeConfig = {
		backend: pendingStoreBackend,
		tableName: pendingStoreTableName,
	} as const;

	const inbound = parseTriggerInbound(itemJson);
	if (!inbound.hasMessage) {
		return { mode: 'drop' };
	}

	const inboundRecipientId = inbound.senderId ? normalizeRecipientId(inbound.senderId) : undefined;

	let pending = inbound.requestId
		? await getPending(ctx, inbound.requestId, storeConfig)
		: undefined;
	const hasExplicitRequestId = Boolean(inbound.requestId);

	if (!pending && !hasExplicitRequestId && inbound.contextMessageId) {
		pending = await getPendingByProviderMessageId(
			ctx,
			{
				providerMessageId: inbound.contextMessageId,
				recipientId: inboundRecipientId,
			},
			storeConfig,
		);
	}
	if (!pending && !hasExplicitRequestId && inboundRecipientId) {
		pending = await getLatestPendingByRecipient(
			ctx,
			{
				recipientId: inboundRecipientId,
			},
			storeConfig,
		);
	}

	if (!pending) {
		if (hasExplicitRequestId) {
			return { mode: 'drop' };
		}
		return { mode: 'passthrough' };
	}

	const requestId = pending.requestId;

	if (pending.kind === 'approval') {
		const inferredApproval = inbound.approved ?? parseApprovalFromText(inbound.textAnswer);
		if (typeof inferredApproval !== 'boolean') {
			return { mode: 'drop' };
		}

		const decisionKey = buildChannelReplyDecisionKey({
			kind: 'approval',
			decisionType: inferredApproval ? 'approve' : 'deny',
			approved: inferredApproval,
		});
		const consumeResult = await consumePendingWithDecision(
			ctx,
			requestId,
			decisionKey,
			storeConfig,
		);
		if (consumeResult.status !== 'accepted' || !consumeResult.record) {
			return { mode: 'drop' };
		}

		const consumedPending = consumeResult.record;
		const envelope = buildHitlApprovalResponseEnvelope({
			requestId,
			approved: inferredApproval,
			channel: 'woztell',
			decisionId: buildChannelReplyDecisionId(requestId, decisionKey),
			decidedAt: new Date().toISOString(),
			resumeSessionId: consumedPending.sessionId,
			approvedFingerprints: consumedPending.approvedFingerprints,
			fingerprint: consumedPending.fingerprint,
		});
		assertHitlResponseEnvelope(envelope);
		return { mode: 'envelope', envelope };
	}

	let answers = buildQuestionAnswersFromInbound({ pending, inbound });
	if (Object.keys(answers).length === 0) {
		const firstQuestion = getFirstQuestion(pending.questions);
		if (firstQuestion && inbound.textAnswer) {
			answers = { [firstQuestion.question]: inbound.textAnswer };
		}
	}
	if (Object.keys(answers).length === 0) {
		return { mode: 'drop' };
	}

	const responseAction = resolveQuestionResponseAction({
		questions: pending.questions,
		answers,
	});
	const decisionKey = buildChannelReplyDecisionKey({
		kind: 'question',
		decisionType: 'answers',
		answers,
		responseAction,
	});
	const consumeResult = await consumePendingWithDecision(
		ctx,
		requestId,
		decisionKey,
		storeConfig,
	);
	if (consumeResult.status !== 'accepted' || !consumeResult.record) {
		return { mode: 'drop' };
	}

	const consumedPending = consumeResult.record;
	const envelope = buildHitlQuestionResponseEnvelope({
		requestId,
		answers,
		channel: 'woztell',
		decisionId: buildChannelReplyDecisionId(requestId, decisionKey),
		decidedAt: new Date().toISOString(),
		resumeSessionId: consumedPending.sessionId,
		approvedFingerprints: consumedPending.approvedFingerprints,
		responseAction,
	});
	assertHitlResponseEnvelope(envelope);
	return { mode: 'envelope', envelope };
}
