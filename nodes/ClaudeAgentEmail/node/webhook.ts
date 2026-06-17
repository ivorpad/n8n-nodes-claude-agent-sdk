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
	buildQuestionFormHtml,
	FORM_CSP,
	parseQuestionAnswers,
} from '../../ClaudeAgentSdk/webhook/questionForm';
import { resolveQuestionResponseAction } from '../../ClaudeAgentSdk/hitl/questionPolicy';
import {
	asNonEmptyString,
	normalizeRawAnswers,
	parseApprovalDecision,
	parseQuestionsFromQuery,
	toQuestionFormDefinition,
} from '../../ClaudeAgentChannelShared/core/webhookRuntime';
import {
	buildFallbackApprovalPendingRecord,
	buildWorkflowData,
} from '../../ClaudeAgentChannelShared/core/webhookHelpers';
import { consumePendingWithDecision, getPending } from '../store/PendingEmailHitlStore';

function buildDecisionId(requestId: string): string {
	return `${requestId}:${randomUUID()}`;
}

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const req = this.getRequestObject();
	const method = req.method;
	const query = req.query as Record<string, unknown>;

	const requestId = typeof query.requestId === 'string' ? query.requestId : '';
	if (!requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	const pending = getPending(this, requestId);
	const querySessionId = asNonEmptyString(query.sid);
	const queryApprovedFingerprints = asNonEmptyString(query.afps);
	const queryFingerprint = asNonEmptyString(query.fp);

	if (query.approved !== undefined || pending?.kind === 'approval') {
		const approved = parseApprovalDecision(query.approved);
		if (typeof approved !== 'boolean') {
			return { webhookResponse: 'Error: Missing approved parameter' };
		}

		const decisionKey = `approval:${approved ? 'approved' : 'denied'}`;
		const consumeResult = consumePendingWithDecision(
			this,
			requestId,
			decisionKey,
			buildFallbackApprovalPendingRecord({
				requestId,
				sessionId: querySessionId,
				approvedFingerprints: queryApprovedFingerprints,
				fingerprint: queryFingerprint,
				channel: 'email',
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
		const envelope = buildHitlApprovalResponseEnvelope({
			requestId,
			approved,
			channel: 'email',
			decisionId: buildDecisionId(requestId),
			decidedAt: new Date().toISOString(),
			resumeSessionId: consumedPending?.sessionId ?? querySessionId,
			approvedFingerprints: consumedPending?.approvedFingerprints ?? queryApprovedFingerprints,
			fingerprint: consumedPending?.fingerprint ?? queryFingerprint,
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

	const rawBody = this.getBodyData() as Record<string, unknown>;
	const submission =
		method === 'POST' && rawBody && typeof rawBody === 'object'
			? ((rawBody.data as Record<string, unknown>) ?? rawBody)
			: query;

	const answers =
		questions.length > 0
			? parseQuestionAnswers(submission, toQuestionFormDefinition(questions))
			: normalizeRawAnswers(submission);

	if (Object.keys(answers).length === 0) {
		return { webhookResponse: 'Error: Missing question answers in webhook payload' };
	}

	const responseAction = resolveQuestionResponseAction({
		questions,
		answers,
		explicitResponseAction: submission.responseAction,
	});
	const envelope = buildHitlQuestionResponseEnvelope({
		requestId,
		answers,
		channel: 'email',
		decisionId: buildDecisionId(requestId),
		decidedAt: new Date().toISOString(),
		resumeSessionId: pending?.sessionId ?? querySessionId,
		approvedFingerprints: pending?.approvedFingerprints ?? queryApprovedFingerprints,
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
