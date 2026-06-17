import type { IDataObject, INodeExecutionData, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

import {
	assertHitlResponseEnvelope,
	buildHitlApprovalResponseEnvelope,
	buildHitlQuestionResponseEnvelope,
	type HitlQuestionDefinition,
} from '../../ClaudeAgentSdk/hitl/contract';
import {
	buildQuestionFormHtml,
	FORM_CSP,
	parseQuestionAnswers,
} from '../../ClaudeAgentSdk/webhook/questionForm';
import { resolveQuestionResponseAction } from '../../ClaudeAgentSdk/hitl/questionPolicy';
import { forbiddenProviderWebhookResponse } from '../../ClaudeAgentChannelShared/core/providerWebhookAuth';
import { renderChannelApprovalConfirmation } from '../../ClaudeAgentChannelShared/core/channelApprovalConfirmation';
import { buildChannelResumeFields } from '../../ClaudeAgentChannelShared/core/webhookHelpers';
import {
	isUnsignedQueryDecisionAllowed,
	verifyChannelWebhook,
} from '../../ClaudeAgentChannelShared/core/verifyChannelWebhook';
import {
	asNonEmptyString,
	normalizeRawAnswers,
	parseQuestionsFromQuery,
	toQuestionFormDefinition,
} from '../runtime/webhookRuntime';
import {
	buildDecisionId,
	buildFallbackApprovalPendingRecord,
	buildFallbackQuestionPendingRecord,
	buildQuestionAnswersFromInbound,
	buildQuestionDecisionKey,
	hasWhatsAppProviderPayload,
	normalizeRecipientId,
	parseApprovalFromText,
	parseWhatsAppInbound,
} from '../runtime/whatsAppInbound';
import {
	consumePendingWithDecision,
	getLatestPendingByRecipient,
	getPending,
	getPendingByProviderMessageId,
	type PendingStoreConfig,
} from '../store/PendingWhatsAppHitlStore';
import type { PendingStoreBackend } from '../types';

interface WhatsAppCredentials {
	appSecret?: string;
}

function buildApprovalWorkflowData(payload: IDataObject): INodeExecutionData[][] {
	return [[{ json: payload }]];
}

function resolveStoreConfig(ctx: IWebhookFunctions): PendingStoreConfig {
	const backend = ctx.getNodeParameter('pendingStoreBackend', 'staticData') as PendingStoreBackend;
	const tableName = ctx.getNodeParameter('pendingStoreTableName', 'claude_hitl_pending') as string;
	return {
		backend,
		tableName,
	};
}

function getFirstQuestion(questions: HitlQuestionDefinition[]): HitlQuestionDefinition | undefined {
	return Array.isArray(questions) && questions.length > 0
		? questions[0]
		: undefined;
}

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const req = this.getRequestObject();
	const method = req.method;
	const query = req.query as Record<string, unknown>;
	const storeConfig = resolveStoreConfig(this);

	const rawBody = this.getBodyData() as Record<string, unknown>;
	const isProviderWebhook = hasWhatsAppProviderPayload(rawBody);

	// Provider-shaped callbacks MUST carry a valid HMAC signature before we consume
	// any decision. Shape detection + verification is centralized in verifyChannelWebhook.
	let isVerifiedProvider = false;
	if (isProviderWebhook) {
		const credentials = await this.getCredentials<WhatsAppCredentials>('whatsAppBusinessCloudApi');
		const verification = verifyChannelWebhook(this, 'whatsapp', {
			whatsAppAppSecret: credentials.appSecret,
		});
		if (verification.outcome === 'reject') {
			return forbiddenProviderWebhookResponse(this);
		}
		isVerifiedProvider = verification.outcome === 'verified-provider';
	}
	const inbound = isProviderWebhook ? parseWhatsAppInbound(rawBody) : {};
	const inboundRecipientId = inbound.senderId ? normalizeRecipientId(inbound.senderId) : undefined;

	let requestId = typeof query.requestId === 'string' ? query.requestId : '';
	if (!requestId && inbound.requestId) {
		requestId = inbound.requestId;
	}
	const hasExplicitRequestId = requestId.length > 0;

	let pending = requestId
		? await getPending(this, requestId, storeConfig)
		: undefined;

	if (!pending && !hasExplicitRequestId && inbound.contextMessageId) {
		pending = await getPendingByProviderMessageId(
			this,
			{
				providerMessageId: inbound.contextMessageId,
				recipientId: inboundRecipientId,
			},
			storeConfig,
		);
		if (pending) {
			requestId = pending.requestId;
		}
	}
	if (!pending && !hasExplicitRequestId && inboundRecipientId) {
		pending = await getLatestPendingByRecipient(
			this,
			{
				recipientId: inboundRecipientId,
			},
			storeConfig,
		);
		if (pending) {
			requestId = pending.requestId;
		}
	}

	if (!requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	// Gate the unsigned query/decision path. A decision that is neither a verified
	// provider callback nor an n8n-signature-validated resume (waitForReply) must
	// not resume the execution. In dispatchAndExit mode the durable companion URL
	// carries no n8n signature, so an unsigned ?requestId=&approved= query is an
	// unauthenticated bearer token.
	if (!isVerifiedProvider && !isUnsignedQueryDecisionAllowed(this)) {
		return forbiddenProviderWebhookResponse(this);
	}

	if (!pending && hasExplicitRequestId) {
		// Resume fields are record-only now, so a fallback is meaningful only when the
		// URL still carries a non-authorizing decision signal: question metadata (q) or
		// an explicit approve/deny decision. sid/afps/fp are no longer trusted inputs.
		const hasFallbackDecisionSignal = Boolean(
			asNonEmptyString(query.q) || query.approved !== undefined,
		);
		if (!hasFallbackDecisionSignal) {
			return { webhookResponse: 'Error: Unknown or expired HITL requestId' };
		}
	}

	const explicitApprovalFromQuery =
		query.approved === 'true'
			? true
			: query.approved === 'false'
				? false
				: undefined;
	const inferredApproval = explicitApprovalFromQuery
		?? inbound.approved
		?? parseApprovalFromText(inbound.textAnswer);

	if (inferredApproval !== undefined || pending?.kind === 'approval') {
		if (typeof inferredApproval !== 'boolean') {
			return { webhookResponse: 'Error: Missing approved parameter' };
		}

		// CSRF: the verified provider inbound (HMAC-signed WhatsApp callback) is
		// POST-equivalent and may consume. The unsigned query-derived path must NOT
		// consume on GET — link scanners, unfurlers and browser prefetch issue
		// automatic GETs against the out-of-band approve/deny URL. Render a
		// confirmation page on GET; only a deliberate POST consumes the decision.
		if (!isVerifiedProvider) {
			if (method === 'GET') {
				if (pending?.status === 'consumed') {
					return { webhookResponse: 'This HITL request was already answered.' };
				}
				return renderChannelApprovalConfirmation(this, {
					approved: inferredApproval,
					toolName: pending?.toolName,
				});
			}
			if (method !== 'POST') {
				return { webhookResponse: 'Error: Approval decisions must be submitted with POST' };
			}
		}

		const decisionKey = `approval:${inferredApproval ? 'approved' : 'denied'}`;
		const consumeResult = await consumePendingWithDecision(
			this,
			requestId,
			decisionKey,
			storeConfig,
			buildFallbackApprovalPendingRecord({
				requestId,
				recipientId: inboundRecipientId,
				providerMessageId: inbound.contextMessageId,
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
			approved: inferredApproval,
			channel: 'whatsapp',
			decisionId: buildDecisionId(requestId, decisionKey),
			decidedAt: new Date().toISOString(),
			resumeSessionId: resume.resumeSessionId,
			approvedFingerprints: resume.approvedFingerprints,
			fingerprint: resume.fingerprint,
		});
		assertHitlResponseEnvelope(envelope);

		return {
			webhookResponse: inferredApproval ? 'Approved' : 'Denied',
			workflowData: buildApprovalWorkflowData(envelope as unknown as IDataObject),
		};
	}

	const questions = pending?.questions ?? parseQuestionsFromQuery(query.q);
	const hasFieldParams = Object.keys(query).some((key) => key.startsWith('field-'));

	if (method === 'GET' && !hasFieldParams && !inbound.textAnswer && !inbound.selectedLabel) {
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

	let answers = buildQuestionAnswersFromInbound({ pending, inbound });
	const submission = method === 'POST' && rawBody && typeof rawBody === 'object'
		? (rawBody.data as Record<string, unknown> ?? rawBody)
		: query;
	if (Object.keys(answers).length === 0) {
		answers = questions.length > 0
			? parseQuestionAnswers(submission, toQuestionFormDefinition(questions))
			: normalizeRawAnswers(submission);
	}

	if (Object.keys(answers).length === 0) {
		// As a last fallback for single-question payloads, map inbound free text to the first question.
		const firstQuestion = getFirstQuestion(questions);
		if (firstQuestion && inbound.textAnswer) {
			answers = { [firstQuestion.question]: inbound.textAnswer };
		}
	}

	if (Object.keys(answers).length === 0) {
		return { webhookResponse: 'Error: Missing question answers in webhook payload' };
	}

	// CH-1: do NOT trust a submission-supplied responseAction. A leaked/forged URL
	// or body could set ?responseAction=complete to force-finish the run. The action
	// is derived from the question definition's per-option action only.
	const responseAction = resolveQuestionResponseAction({
		questions,
		answers,
	});
	const decisionKey = buildQuestionDecisionKey(answers, responseAction);
	const consumeResult = await consumePendingWithDecision(
		this,
		requestId,
		decisionKey,
		storeConfig,
		buildFallbackQuestionPendingRecord({
			requestId,
			questions,
			message: pending?.message,
			recipientId: inboundRecipientId,
			providerMessageId: inbound.contextMessageId,
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
		channel: 'whatsapp',
		decisionId: buildDecisionId(requestId, decisionKey),
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
		workflowData: [[{ json: envelope as unknown as IDataObject }]],
	};
}
