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
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
	parseReplyToken,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import {
	asNonEmptyString,
	normalizeRawAnswers,
	parseQuestionsFromQuery,
	toQuestionFormDefinition,
} from '../../ClaudeAgentChannelShared/core/webhookRuntime';
import {
	buildFallbackApprovalPendingRecord,
	buildFallbackQuestionPendingRecord,
	buildWorkflowData,
	normalizeAnswersForDecision,
	resolveQuestionAnswer,
} from '../../ClaudeAgentChannelShared/core/webhookHelpers';
import { forbiddenProviderWebhookResponse } from '../../ClaudeAgentChannelShared/core/providerWebhookAuth';
import {
	isUnsignedQueryDecisionAllowed,
	verifyChannelWebhook,
} from '../../ClaudeAgentChannelShared/core/verifyChannelWebhook';
import { consumePendingWithDecision, getPending } from '../store/PendingDiscordHitlStore';

/** Discord interaction response type 1 = PONG (the required reply to a type 1 PING). */
const DISCORD_PONG_RESPONSE = JSON.stringify({ type: 1 });

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const req = this.getRequestObject();
	const method = req.method;
	const query = req.query as Record<string, unknown>;

	// --- Discord interaction payload path (Message Component button clicks) ---
	const body = this.getBodyData() as Record<string, unknown>;

	// Discord REQUIRES verifying X-Signature-Ed25519 + X-Signature-Timestamp against
	// the application public key before processing ANY interaction, and answering the
	// type:1 PING handshake with a type:1 PONG.
	const verification = verifyChannelWebhook(this, 'discord', {
		discordPublicKey: this.getNodeParameter('discordPublicKey', ''),
	});
	if (verification.outcome === 'reject') {
		// Invalid/missing signature on a Discord interaction → 401, do not consume.
		const res = this.getResponseObject();
		res.statusCode = 401;
		return { webhookResponse: 'Error: Invalid Discord request signature' };
	}
	if (verification.outcome === 'discord-pong') {
		return { webhookResponse: DISCORD_PONG_RESPONSE };
	}
	const isVerifiedProvider = verification.outcome === 'verified-provider';

	// Discord interaction type 3 = MESSAGE_COMPONENT
	if (body?.type === 3) {
		const data = typeof body.data === 'object' && body.data !== null
			? (body.data as Record<string, unknown>)
			: undefined;
		const token = parseReplyToken(data?.custom_id);
		if (!token) {
			return { webhookResponse: JSON.stringify({ type: 4, data: { content: 'Unrecognized interaction' } }) };
		}

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
					channel: 'discord',
				}),
			);
			if (consumeResult.status === 'duplicate') {
				return { webhookResponse: JSON.stringify({ type: 4, data: { content: 'Already answered.' } }) };
			}
			if (consumeResult.status === 'conflict') {
				return { webhookResponse: JSON.stringify({ type: 4, data: { content: 'Already answered differently.' } }) };
			}

			const consumedPending = consumeResult.record;
			const envelope = buildHitlApprovalResponseEnvelope({
				requestId: token.requestId,
				approved: token.approved,
				channel: 'discord',
				decisionId: buildChannelReplyDecisionId(token.requestId, decisionKey),
				decidedAt: new Date().toISOString(),
				resumeSessionId: consumedPending?.sessionId,
				approvedFingerprints: consumedPending?.approvedFingerprints,
				fingerprint: token.fingerprint ?? consumedPending?.fingerprint,
			});
			assertHitlResponseEnvelope(envelope);

			return {
				webhookResponse: JSON.stringify({ type: 4, data: { content: token.approved ? 'Approved' : 'Denied' } }),
				workflowData: buildWorkflowData(envelope as unknown as IDataObject),
			};
		}

		// Question option callback
		if (typeof token.questionIndex === 'number' && typeof token.optionIndex === 'number') {
			const resolved = resolveQuestionAnswer(pending, token.questionIndex, token.optionIndex);
			if (!resolved) {
				return { webhookResponse: JSON.stringify({ type: 4, data: { content: 'Unknown question option' } }) };
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
					channel: 'discord',
				}),
			);
			if (consumeResult.status === 'duplicate') {
				return { webhookResponse: JSON.stringify({ type: 4, data: { content: 'Already answered.' } }) };
			}
			if (consumeResult.status === 'conflict') {
				return { webhookResponse: JSON.stringify({ type: 4, data: { content: 'Already answered differently.' } }) };
			}

			const consumedPending = consumeResult.record;
				const envelope = buildHitlQuestionResponseEnvelope({
					requestId: token.requestId,
					answers,
					channel: 'discord',
					decisionId: buildChannelReplyDecisionId(token.requestId, decisionKey),
					decidedAt: new Date().toISOString(),
					resumeSessionId: consumedPending?.sessionId,
					approvedFingerprints: consumedPending?.approvedFingerprints,
					responseAction: resolved.responseAction,
				});
			assertHitlResponseEnvelope(envelope);

			return {
				webhookResponse: JSON.stringify({ type: 4, data: { content: `Selected: ${resolved.answer}` } }),
				workflowData: buildWorkflowData(envelope as unknown as IDataObject),
			};
		}

		return { webhookResponse: JSON.stringify({ type: 4, data: { content: 'Unrecognized callback' } }) };
	}

	// --- Signed URL query path ---
	const requestId = typeof query.requestId === 'string' ? query.requestId : '';
	if (!requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	// Only allow an unsigned query decision when n8n validated the resume signature
	// upstream (waitForReply). Discord is always waitForReply, so this is a no-op here,
	// but the gate keeps every channel consistent and closes the bearer-token path.
	if (!isVerifiedProvider && !isUnsignedQueryDecisionAllowed(this)) {
		return forbiddenProviderWebhookResponse(this);
	}

	const pending = getPending(this, requestId);
	const querySessionId = asNonEmptyString(query.sid);
	const queryApprovedFingerprints = asNonEmptyString(query.afps);
	const queryFingerprint = asNonEmptyString(query.fp);

	if (pending?.status === 'consumed') {
		return { webhookResponse: 'This HITL request was already answered.' };
	}

	if (query.approved !== undefined || pending?.kind === 'approval') {
		const approved = query.approved === 'true';
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
				sessionId: querySessionId,
				approvedFingerprints: queryApprovedFingerprints,
				fingerprint: queryFingerprint,
				channel: 'discord',
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
			requestId,
			approved,
			channel: 'discord',
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

	const questionBody = this.getBodyData() as Record<string, unknown>;
	const submission =
		method === 'POST' && questionBody && typeof questionBody === 'object'
			? ((questionBody.data as Record<string, unknown>) ?? questionBody)
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
		answers: normalizeAnswersForDecision(answers),
		responseAction,
	});
	const consumeResult = consumePendingWithDecision(
		this,
		requestId,
		decisionKey,
		buildFallbackQuestionPendingRecord({
			requestId,
			sessionId: querySessionId,
			approvedFingerprints: queryApprovedFingerprints,
			questions,
			message: pending?.message,
			channel: 'discord',
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
		requestId,
		answers,
		channel: 'discord',
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
