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
	parseQuestionsFromQuery,
	toQuestionFormDefinition,
} from '../runtime/webhookRuntime';
import {
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import {
	buildFallbackApprovalPendingRecord,
	buildFallbackQuestionPendingRecord,
	buildWorkflowData,
} from '../../ClaudeAgentChannelShared/core/webhookHelpers';
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
	const querySessionId = asNonEmptyString(query.sid);
	const queryApprovedFingerprints = asNonEmptyString(query.afps);
	const queryFingerprint = asNonEmptyString(query.fp);

	if (!pending) {
		const hasSignedFallbackMetadata = Boolean(
			querySessionId
			|| queryApprovedFingerprints
			|| queryFingerprint
			|| asNonEmptyString(query.q),
		);
		if (!hasSignedFallbackMetadata) {
			return { webhookResponse: 'Error: Unknown or expired HITL requestId' };
		}
	}

	if (query.approved !== undefined || pending?.kind === 'approval') {
		const approved = query.approved === 'true'
			? true
			: query.approved === 'false'
				? false
				: undefined;
		if (typeof approved !== 'boolean') {
			return { webhookResponse: 'Error: Missing approved parameter' };
		}

		const decisionKey = `approval:${approved ? 'approved' : 'denied'}`;
		const consumeResult = await consumePendingWithDecision(
			this,
			requestId,
			decisionKey,
			storeConfig,
			buildFallbackApprovalPendingRecord({
				requestId,
				sessionId: querySessionId,
				approvedFingerprints: queryApprovedFingerprints,
				fingerprint: queryFingerprint,
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
		const envelope = buildHitlApprovalResponseEnvelope({
			requestId,
			approved,
			channel: 'woztell',
			decisionId: buildChannelReplyDecisionId(requestId, decisionKey),
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
			sessionId: querySessionId,
			approvedFingerprints: queryApprovedFingerprints,
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
	const envelope = buildHitlQuestionResponseEnvelope({
		requestId,
		answers,
		channel: 'woztell',
		decisionId: buildChannelReplyDecisionId(requestId, decisionKey),
		decidedAt: new Date().toISOString(),
		resumeSessionId: consumedPending?.sessionId ?? querySessionId,
		approvedFingerprints: consumedPending?.approvedFingerprints ?? queryApprovedFingerprints,
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
