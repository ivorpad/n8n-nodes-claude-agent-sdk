import { randomUUID } from 'node:crypto';

import type {
	IDataObject,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import {
	assertHitlResponseEnvelope,
	buildHitlApprovalResponseEnvelope,
	buildHitlQuestionResponseEnvelope,
} from '../../ClaudeAgentSdk/hitl/contract';
import {
	buildApprovalConfirmationHtml,
	buildQuestionFormHtml,
	FORM_CSP,
	parseQuestionAnswers,
} from '../../ClaudeAgentSdk/webhook/questionForm';
import { resolveQuestionResponseAction } from '../../ClaudeAgentSdk/hitl/questionPolicy';
import { buildChannelReplyDecisionKey } from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import {
	normalizeRawAnswers,
	parseApprovalDecision,
	parseQuestionsFromQuery,
	toQuestionFormDefinition,
} from '../../ClaudeAgentChannelShared/core/webhookRuntime';
import {
	buildChannelResumeFields,
	buildFallbackApprovalPendingRecord,
	buildFallbackQuestionPendingRecord,
	buildWorkflowData,
	normalizeAnswersForDecision,
} from '../../ClaudeAgentChannelShared/core/webhookHelpers';
import { consumePendingWithDecision, getPending } from '../store/PendingGmailHitlStore';

function buildDecisionId(requestId: string): string {
	return `${requestId}:${randomUUID()}`;
}

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const req = this.getRequestObject();
	const method = req.method;
	const query = req.query as Record<string, unknown>;
	const rawBody = this.getBodyData() as Record<string, unknown>;
	const postSubmission: Record<string, unknown> =
		method === 'POST' && rawBody && typeof rawBody === 'object'
			? ((rawBody.data as Record<string, unknown>) ?? rawBody)
			: {};

	const requestId = typeof query.requestId === 'string'
		? query.requestId
		: typeof postSubmission.requestId === 'string'
			? postSubmission.requestId
			: '';
	if (!requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	const pending = getPending(this, requestId);

	const approvalValue = query.approved ?? postSubmission.approved;
	if (approvalValue !== undefined || pending?.kind === 'approval') {
		const approved = parseApprovalDecision(approvalValue);
		if (typeof approved !== 'boolean') {
			return { webhookResponse: 'Error: Missing approved parameter' };
		}

		if (method === 'GET') {
			if (pending?.status === 'consumed') {
				return { webhookResponse: 'This HITL request was already answered.' };
			}
			const res = this.getResponseObject();
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.setHeader('Content-Security-Policy', FORM_CSP);
			res.send(buildApprovalConfirmationHtml({ approved, toolName: pending?.toolName }));
			return { noWebhookResponse: true };
		}

		if (method !== 'POST') {
			return { webhookResponse: 'Error: Approval decisions must be submitted with POST' };
		}

		const decisionKey = `approval:${approved ? 'approved' : 'denied'}`;
		const consumeResult = consumePendingWithDecision(
			this,
			requestId,
			decisionKey,
			buildFallbackApprovalPendingRecord({
				requestId,
				channel: 'gmail',
			}),
		);
		if (consumeResult.status === 'duplicate') {
			return { webhookResponse: 'This HITL request was already answered.' };
		}
		if (consumeResult.status === 'conflict') {
			return { webhookResponse: 'This HITL request was already answered with a different response.' };
		}
		if (consumeResult.status === 'missing') {
			return { webhookResponse: 'Error: Unknown or expired HITL requestId' };
		}

		const consumedPending = consumeResult.record;
		// Record-only: resume fields never come from the unsigned URL query.
		const resume = buildChannelResumeFields(consumedPending);
		const envelope = buildHitlApprovalResponseEnvelope({
			requestId,
			approved,
			channel: 'gmail',
			decisionId: buildDecisionId(requestId),
			decidedAt: new Date().toISOString(),
			resumeSessionId: resume.resumeSessionId,
			approvedFingerprints: resume.approvedFingerprints,
			fingerprint: resume.fingerprint,
		});
		assertHitlResponseEnvelope(envelope);

		return {
			webhookResponse: approved ? 'Approved' : 'Denied',
			workflowData: buildWorkflowData(envelope as unknown as IDataObject),
		};
	}

	const questions = pending?.questions ?? parseQuestionsFromQuery(query.q);
	const hasFieldParams = Object.keys(query).some((key) => key.startsWith('field-'));

	if (method === 'GET' && !hasFieldParams) {
		if (questions.length === 0) {
			return {
				webhookResponse:
					'Error: Missing question definition. Re-run the HITL step so the response URL includes question metadata.',
			};
		}
		const formQuestions = toQuestionFormDefinition(questions);
		const res = this.getResponseObject();
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.setHeader('Content-Security-Policy', FORM_CSP);
		res.send(
			buildQuestionFormHtml(
				formQuestions,
				'Claude HITL Question',
				pending?.message || 'Please answer to continue.',
			),
		);
		return { noWebhookResponse: true };
	}

	const submission =
		method === 'POST'
			? postSubmission
			: query;

	const answers =
		questions.length > 0
			? parseQuestionAnswers(submission, toQuestionFormDefinition(questions))
			: normalizeRawAnswers(submission);

	if (Object.keys(answers).length === 0) {
		return { webhookResponse: 'Error: Missing question answers in webhook payload' };
	}

	// CH-1: do NOT honor a caller-supplied responseAction from the unsigned
	// submission — a leaked URL could pass responseAction=complete to terminate
	// the agent loop. The action is derived from the persisted question options.
	const responseAction = resolveQuestionResponseAction({
		questions,
		answers,
	});
	const decisionKey = buildChannelReplyDecisionKey({
		kind: 'question',
		decisionType: 'answers',
		answers: normalizeAnswersForDecision(answers),
		responseAction,
	});
	const consumeResult = consumePendingWithDecision(
		this,
		requestId,
		decisionKey,
		buildFallbackQuestionPendingRecord({
			requestId,
			questions,
			message: pending?.message,
			channel: 'gmail',
		}),
	);
	if (consumeResult.status === 'duplicate') {
		return { webhookResponse: 'This HITL request was already answered.' };
	}
	if (consumeResult.status === 'conflict') {
		return { webhookResponse: 'This HITL request was already answered with a different response.' };
	}
	if (consumeResult.status === 'missing') {
		return { webhookResponse: 'Error: Unknown or expired HITL requestId' };
	}

	const consumedPending = consumeResult.record;
	// Record-only: resume fields never come from the unsigned URL query.
	const resume = buildChannelResumeFields(consumedPending);
	const envelope = buildHitlQuestionResponseEnvelope({
		requestId,
		answers,
		channel: 'gmail',
		decisionId: buildDecisionId(requestId),
		decidedAt: new Date().toISOString(),
		resumeSessionId: resume.resumeSessionId,
		approvedFingerprints: resume.approvedFingerprints,
		responseAction,
	});
	assertHitlResponseEnvelope(envelope);

	const res = this.getResponseObject();
	res.setHeader('Content-Type', 'application/json');
	res.send(JSON.stringify({ success: true, message: 'Response received' }));

	return {
		noWebhookResponse: true,
		workflowData: buildWorkflowData(envelope as unknown as IDataObject),
	};
}
