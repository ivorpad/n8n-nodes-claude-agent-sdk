import type { IDataObject, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

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
	resolveQuestionAnswer,
} from '../../ClaudeAgentChannelShared/core/webhookHelpers';
import { renderChannelApprovalConfirmation } from '../../ClaudeAgentChannelShared/core/channelApprovalConfirmation';
import { forbiddenProviderWebhookResponse } from '../../ClaudeAgentChannelShared/core/providerWebhookAuth';
import {
	isUnsignedQueryDecisionAllowed,
	verifyChannelWebhook,
} from '../../ClaudeAgentChannelShared/core/verifyChannelWebhook';
import {
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
	parseReplyToken,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import { consumePendingWithDecision, getPending } from '../store/PendingSlackHitlStore';

function tryParseSlackInteractionPayload(
	body: Record<string, unknown>,
): { token: NonNullable<ReturnType<typeof parseReplyToken>> } | undefined {
	// Slack sends interaction payloads as { payload: "<JSON string>" }
	const rawPayload = body.payload;
	if (typeof rawPayload !== 'string') return undefined;
	try {
		const payload = JSON.parse(rawPayload) as Record<string, unknown>;
		if (payload.type !== 'block_actions') return undefined;
		const actions = Array.isArray(payload.actions) ? payload.actions : [];
		const firstAction = actions[0] as Record<string, unknown> | undefined;
		if (!firstAction) return undefined;
		const token = parseReplyToken(firstAction.value);
		if (!token) return undefined;
		return { token };
	} catch {
		return undefined;
	}
}

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const req = this.getRequestObject();
	const method = req.method;
	const query = req.query as Record<string, unknown>;

	// --- Slack interaction payload path (Block Kit button clicks) ---
	const rawBody = this.getBodyData() as Record<string, unknown>;
	// Provider-shape detection and signature verification are centralized so they
	// always run before any decision is consumed.
	const verification = verifyChannelWebhook(this, 'slack', {
		slackSigningSecret: this.getNodeParameter('slackSigningSecret', ''),
	});
	if (verification.outcome === 'reject') {
		return forbiddenProviderWebhookResponse(this);
	}
	const isVerifiedProvider = verification.outcome === 'verified-provider';
	const interaction = isVerifiedProvider ? tryParseSlackInteractionPayload(rawBody) : undefined;

	if (interaction) {
		const { token } = interaction;
		const pending = getPending(this, token.requestId);

		// Approval callback
		if (typeof token.approved === 'boolean') {
			const decisionKey = buildChannelReplyDecisionKey({
				kind: 'approval',
				decisionType: token.approved ? 'approve' : 'deny',
				approved: token.approved,
			});
			const consumeResult = consumePendingWithDecision(
				this,
				token.requestId,
				decisionKey,
				buildFallbackApprovalPendingRecord({
					requestId: token.requestId,
					sessionId: pending?.sessionId,
					approvedFingerprints: pending?.approvedFingerprints,
					fingerprint: token.fingerprint ?? pending?.fingerprint,
					channel: 'slack',
				}),
			);
			if (consumeResult.status === 'duplicate') {
				return { webhookResponse: 'This HITL request was already answered.' };
			}
			if (consumeResult.status === 'conflict') {
				return { webhookResponse: 'This HITL request was already answered with a different response.' };
			}

			const consumedPending = consumeResult.record;
			const envelope = buildHitlApprovalResponseEnvelope({
				requestId: token.requestId,
				approved: token.approved,
				channel: 'slack',
				decisionId: buildChannelReplyDecisionId(token.requestId, decisionKey),
				decidedAt: new Date().toISOString(),
				resumeSessionId: consumedPending?.sessionId,
				approvedFingerprints: consumedPending?.approvedFingerprints,
				fingerprint: token.fingerprint ?? consumedPending?.fingerprint,
			});
			assertHitlResponseEnvelope(envelope);

			return {
				webhookResponse: token.approved ? 'Approved' : 'Denied',
				workflowData: buildWorkflowData(envelope as unknown as IDataObject),
			};
		}

		// Question option callback
		if (typeof token.questionIndex === 'number' && typeof token.optionIndex === 'number') {
			const resolved = resolveQuestionAnswer(pending, token.questionIndex, token.optionIndex);
			if (!resolved) {
				return { webhookResponse: 'Error: Unknown question option' };
			}

				const answers: Record<string, string | string[]> = { [resolved.question]: resolved.answer };
				const decisionKey = buildChannelReplyDecisionKey({
					kind: 'question',
					decisionType: 'answers',
					answers: { [resolved.question]: resolved.answer },
					responseAction: resolved.responseAction,
				});
			const consumeResult = consumePendingWithDecision(
				this,
				token.requestId,
				decisionKey,
				buildFallbackQuestionPendingRecord({
					requestId: token.requestId,
					sessionId: pending?.sessionId,
					approvedFingerprints: pending?.approvedFingerprints,
					questions: pending?.questions,
					message: pending?.message,
					channel: 'slack',
				}),
			);
			if (consumeResult.status === 'duplicate') {
				return { webhookResponse: 'This HITL request was already answered.' };
			}
			if (consumeResult.status === 'conflict') {
				return { webhookResponse: 'This HITL request was already answered with a different response.' };
			}

			const consumedPending = consumeResult.record;
				const envelope = buildHitlQuestionResponseEnvelope({
					requestId: token.requestId,
					answers,
					channel: 'slack',
					decisionId: buildChannelReplyDecisionId(token.requestId, decisionKey),
					decidedAt: new Date().toISOString(),
					resumeSessionId: consumedPending?.sessionId,
					approvedFingerprints: consumedPending?.approvedFingerprints,
					responseAction: resolved.responseAction,
				});
			assertHitlResponseEnvelope(envelope);

			return {
				webhookResponse: `Selected: ${resolved.answer}`,
				workflowData: buildWorkflowData(envelope as unknown as IDataObject),
			};
		}

		return { webhookResponse: 'Error: Unrecognized interaction payload' };
	}

	// --- Signed URL query path ---
	const requestId = typeof query.requestId === 'string' ? query.requestId : '';
	if (!requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	// Only allow an unsigned query decision when n8n validated the resume signature
	// upstream (waitForReply). Slack is always waitForReply, so this is a no-op here,
	// but the gate keeps every channel consistent and closes the bearer-token path.
	if (!isVerifiedProvider && !isUnsignedQueryDecisionAllowed(this)) {
		return forbiddenProviderWebhookResponse(this);
	}

	const pending = getPending(this, requestId);

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

		const decisionKey = buildChannelReplyDecisionKey({
			kind: 'approval',
			decisionType: approved ? 'approve' : 'deny',
			approved,
		});
		const consumeResult = consumePendingWithDecision(
			this,
			requestId,
			decisionKey,
			buildFallbackApprovalPendingRecord({
				requestId,
				channel: 'slack',
			}),
		);

		if (consumeResult.status === 'duplicate') {
			return { webhookResponse: 'This HITL request was already answered.' };
		}

		if (consumeResult.status === 'conflict') {
			return { webhookResponse: 'This HITL request was already answered with a different response.' };
		}

		const consumedPending = consumeResult.record;
		// Record-only: resume fields never come from the unsigned URL query.
		const resume = buildChannelResumeFields(consumedPending);
		const envelope = buildHitlApprovalResponseEnvelope({
			requestId,
			approved,
			channel: 'slack',
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

	// CSRF: a non-POST must NEVER consume. Render the form (or the missing-question
	// error) and return without consuming, even when field-* query params are present.
	// Only an explicit POST (a deliberate form submit) consumes the decision.
	if (method !== 'POST') {
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

	// Control is guaranteed POST here: answers come from the body ONLY, never the query.
	const questionBody = this.getBodyData() as Record<string, unknown>;
	const submission =
		questionBody && typeof questionBody === 'object'
			? ((questionBody.data as Record<string, unknown>) ?? questionBody)
			: {};

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
			channel: 'slack',
		}),
	);

	if (consumeResult.status === 'duplicate') {
		return { webhookResponse: 'This HITL request was already answered.' };
	}
	if (consumeResult.status === 'conflict') {
		return { webhookResponse: 'This HITL request was already answered with a different response.' };
	}

	const consumedPending = consumeResult.record;
	// Record-only: resume fields never come from the unsigned URL query.
	const resume = buildChannelResumeFields(consumedPending);
	const envelope = buildHitlQuestionResponseEnvelope({
		requestId,
		answers,
		channel: 'slack',
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
