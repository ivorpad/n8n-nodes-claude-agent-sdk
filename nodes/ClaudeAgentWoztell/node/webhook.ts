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
} from '../runtime/webhookRuntime';
import {
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import {
	buildChannelResumeFields,
	buildFallbackApprovalPendingRecord,
	buildFallbackQuestionPendingRecord,
	buildWorkflowData,
} from '../../ClaudeAgentChannelShared/core/webhookHelpers';
import { renderChannelApprovalConfirmation } from '../../ClaudeAgentChannelShared/core/channelApprovalConfirmation';
import { forbiddenProviderWebhookResponse } from '../../ClaudeAgentChannelShared/core/providerWebhookAuth';
import { isUnsignedQueryDecisionAllowed } from '../../ClaudeAgentChannelShared/core/verifyChannelWebhook';
import {
	consumePendingWithDecision,
	getPending,
	type PendingStoreConfig,
} from '../store/PendingWoztellHitlStore';
import type { PendingStoreBackend } from '../types';

function resolveStoreConfig(ctx: IWebhookFunctions): PendingStoreConfig {
	const backend = ctx.getNodeParameter('pendingStoreBackend', 'staticData') as PendingStoreBackend;
	const tableName = ctx.getNodeParameter('pendingStoreTableName', 'claude_hitl_pending') as string;
	return {
		backend,
		tableName,
	};
}

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const req = this.getRequestObject();
	const method = req.method;
	const query = req.query as Record<string, unknown>;
	const storeConfig = resolveStoreConfig(this);

	const requestId = typeof query.requestId === 'string' ? query.requestId : '';
	if (!requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	// Woztell delivers HITL decisions through its trigger node, not this resume
	// webhook, so there is no verified provider callback here. Only allow an unsigned
	// query decision when n8n validated the resume signature upstream (waitForReply).
	// In dispatchAndExit mode (Woztell's default) the durable companion URL carries no
	// n8n signature, so reject unsigned query decisions.
	if (!isUnsignedQueryDecisionAllowed(this)) {
		return forbiddenProviderWebhookResponse(this);
	}

	const pending = await getPending(this, requestId, storeConfig);

	if (!pending) {
		// Record-only authority: the unsigned URL query carries no session/fingerprint
		// authority, so it can never stand in for a pending record. Only allow the
		// request to proceed when it actually expresses a decision — an approval flag
		// or question metadata — otherwise reject as unknown/expired.
		const hasDecisionIntent = Boolean(
			query.approved !== undefined || asNonEmptyString(query.q),
		);
		if (!hasDecisionIntent) {
			return { webhookResponse: 'Error: Unknown or expired HITL requestId' };
		}
	}

	if (query.approved !== undefined || pending?.kind === 'approval') {
		const approved = parseApprovalDecision(query.approved);
		if (typeof approved !== 'boolean') {
			return { webhookResponse: 'Error: Missing approved parameter' };
		}

		// CSRF: a GET must not consume. Render a confirmation page; only the
		// explicit POST (a deliberate button click) consumes the decision.
		if (method === 'GET') {
			if (pending?.status === 'consumed') {
				return { webhookResponse: 'This HITL request was already answered.' };
			}
			return renderChannelApprovalConfirmation(this, { approved, toolName: pending?.toolName });
		}
		if (method !== 'POST') {
			return { webhookResponse: 'Error: Approval decisions must be submitted with POST' };
		}

		const decisionKey = `approval:${approved ? 'approved' : 'denied'}`;
		const consumeResult = await consumePendingWithDecision(
			this,
			requestId,
			decisionKey,
			storeConfig,
			buildFallbackApprovalPendingRecord({
				requestId,
				channel: 'woztell',
			}),
		);
		if (consumeResult.status === 'duplicate') {
			return { webhookResponse: 'This HITL request was already answered.' };
		}
		if (consumeResult.status === 'conflict') {
			return {
				webhookResponse: 'This HITL request was already answered with a different response.',
			};
		}

		const consumedPending = consumeResult.record;
		// Record-only: resume fields never come from the unsigned URL query.
		const resume = buildChannelResumeFields(consumedPending);
		const envelope = buildHitlApprovalResponseEnvelope({
			requestId,
			approved,
			channel: 'woztell',
			decisionId: buildChannelReplyDecisionId(requestId, decisionKey),
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
	});
	const decisionKey = buildChannelReplyDecisionKey({
		kind: 'question',
		decisionType: 'answers',
		answers,
		responseAction,
	});
	const consumeResult = await consumePendingWithDecision(
		this,
		requestId,
		decisionKey,
		storeConfig,
		buildFallbackQuestionPendingRecord({
			requestId,
			questions,
			message: pending?.message,
			channel: 'woztell',
		}),
	);
	if (consumeResult.status === 'duplicate') {
		return { webhookResponse: 'This HITL request was already answered.' };
	}
	if (consumeResult.status === 'conflict') {
		return {
			webhookResponse: 'This HITL request was already answered with a different response.',
		};
	}

	const consumedPending = consumeResult.record;
	// Record-only: resume fields never come from the unsigned URL query.
	const resume = buildChannelResumeFields(consumedPending);
	const envelope = buildHitlQuestionResponseEnvelope({
		requestId,
		answers,
		channel: 'woztell',
		decisionId: buildChannelReplyDecisionId(requestId, decisionKey),
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
