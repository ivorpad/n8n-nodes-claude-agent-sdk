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
	resolveQuestionAnswer,
} from '../../ClaudeAgentChannelShared/core/webhookHelpers';
import { forbiddenProviderWebhookResponse } from '../../ClaudeAgentChannelShared/core/providerWebhookAuth';
import {
	isUnsignedQueryDecisionAllowed,
	verifyChannelWebhook,
} from '../../ClaudeAgentChannelShared/core/verifyChannelWebhook';
import {
	consumePendingWithDecision,
	getPending,
	type PendingStoreConfig,
} from '../store/PendingTelegramHitlStore';
import type { PendingStoreBackend } from '../types';

function resolveStoreConfig(ctx: IWebhookFunctions): PendingStoreConfig {
	const backend = ctx.getNodeParameter('pendingStoreBackend', 'staticData') as PendingStoreBackend;
	const tableName = ctx.getNodeParameter('pendingStoreTableName', 'claude_hitl_pending') as string;
	return {
		backend,
		tableName,
	};
}

async function answerCallbackQuery(
	ctx: IWebhookFunctions,
	callbackQueryId: string,
	text?: string,
): Promise<void> {
	try {
		const credentials = await ctx.getCredentials('telegramApi') as { accessToken?: string; baseUrl?: string };
		const accessToken = String(credentials?.accessToken ?? '').trim();
		const baseUrl = String(credentials?.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
		if (!accessToken) return;
		await ctx.helpers.httpRequest({
			method: 'POST',
			url: `${baseUrl}/bot${accessToken}/answerCallbackQuery`,
			body: { callback_query_id: callbackQueryId, text },
			json: true,
		});
	} catch {
		// Best-effort — don't fail the webhook if acknowledgement fails
	}
}

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const req = this.getRequestObject();
	const method = req.method;
	const query = req.query as Record<string, unknown>;
	const storeConfig = resolveStoreConfig(this);

	// --- Telegram callback_query path (inline button taps) ---
	const body = this.getBodyData() as Record<string, unknown>;
	const callbackQuery = typeof body?.callback_query === 'object' && body.callback_query !== null
		? (body.callback_query as Record<string, unknown>)
		: undefined;

	// Provider-shape detection and secret-token verification are centralized so
	// they always run before any decision is consumed.
	const verification = verifyChannelWebhook(this, 'telegram', {
		telegramWebhookSecretToken: this.getNodeParameter('telegramWebhookSecretToken', ''),
	});
	if (verification.outcome === 'reject') {
		return forbiddenProviderWebhookResponse(this);
	}
	const isVerifiedProvider = verification.outcome === 'verified-provider';

	if (callbackQuery) {
		const callbackQueryId = String(callbackQuery.id ?? '');
		const token = parseReplyToken(callbackQuery.data);
		if (!token) {
			await answerCallbackQuery(this, callbackQueryId, 'Invalid callback data');
			return { webhookResponse: 'OK' };
		}

		const pending = await getPending(this, token.requestId, storeConfig);

		// Approval callback
		if (typeof token.approved === 'boolean') {
			const decisionKey = buildChannelReplyDecisionKey({
				kind: 'approval',
				decisionType: token.approved ? 'approve' : 'deny',
				approved: token.approved,
			});
			const consumeResult = await consumePendingWithDecision(
				this,
				token.requestId,
				decisionKey,
				storeConfig,
				buildFallbackApprovalPendingRecord({
					requestId: token.requestId,
					sessionId: pending?.sessionId,
					approvedFingerprints: pending?.approvedFingerprints,
					fingerprint: token.fingerprint ?? pending?.fingerprint,
					channel: 'telegram',
				}),
			);
			if (consumeResult.status === 'duplicate') {
				await answerCallbackQuery(this, callbackQueryId, 'Already answered');
				return { webhookResponse: 'OK' };
			}
			if (consumeResult.status === 'conflict') {
				await answerCallbackQuery(this, callbackQueryId, 'Already answered differently');
				return { webhookResponse: 'OK' };
			}

			const consumedPending = consumeResult.record;
			const envelope = buildHitlApprovalResponseEnvelope({
				requestId: token.requestId,
				approved: token.approved,
				channel: 'telegram',
				decisionId: buildChannelReplyDecisionId(token.requestId, decisionKey),
				decidedAt: new Date().toISOString(),
				resumeSessionId: consumedPending?.sessionId,
				approvedFingerprints: consumedPending?.approvedFingerprints,
				fingerprint: token.fingerprint ?? consumedPending?.fingerprint,
			});
			assertHitlResponseEnvelope(envelope);

			await answerCallbackQuery(this, callbackQueryId, token.approved ? 'Approved' : 'Denied');
			return {
				webhookResponse: 'OK',
				workflowData: buildWorkflowData(envelope as unknown as IDataObject),
			};
		}

		// Question option callback
		if (typeof token.questionIndex === 'number' && typeof token.optionIndex === 'number') {
			const resolved = resolveQuestionAnswer(pending, token.questionIndex, token.optionIndex);
			if (!resolved) {
				await answerCallbackQuery(this, callbackQueryId, 'Unknown question option');
				return { webhookResponse: 'OK' };
			}

				const answers: Record<string, string | string[]> = { [resolved.question]: resolved.answer };
				const decisionKey = buildChannelReplyDecisionKey({
					kind: 'question',
					decisionType: 'answers',
					answers: { [resolved.question]: resolved.answer },
					responseAction: resolved.responseAction,
				});
			const consumeResult = await consumePendingWithDecision(
				this,
				token.requestId,
				decisionKey,
				storeConfig,
				buildFallbackQuestionPendingRecord({
					requestId: token.requestId,
					sessionId: pending?.sessionId,
					approvedFingerprints: pending?.approvedFingerprints,
					questions: pending?.questions,
					message: pending?.message,
					channel: 'telegram',
				}),
			);
			if (consumeResult.status === 'duplicate') {
				await answerCallbackQuery(this, callbackQueryId, 'Already answered');
				return { webhookResponse: 'OK' };
			}
			if (consumeResult.status === 'conflict') {
				await answerCallbackQuery(this, callbackQueryId, 'Already answered differently');
				return { webhookResponse: 'OK' };
			}

			const consumedPending = consumeResult.record;
				const envelope = buildHitlQuestionResponseEnvelope({
					requestId: token.requestId,
					answers,
					channel: 'telegram',
					decisionId: buildChannelReplyDecisionId(token.requestId, decisionKey),
					decidedAt: new Date().toISOString(),
					resumeSessionId: consumedPending?.sessionId,
					approvedFingerprints: consumedPending?.approvedFingerprints,
					responseAction: resolved.responseAction,
				});
			assertHitlResponseEnvelope(envelope);

			await answerCallbackQuery(this, callbackQueryId, `Selected: ${resolved.answer}`);
			return {
				webhookResponse: 'OK',
				workflowData: buildWorkflowData(envelope as unknown as IDataObject),
			};
		}

		await answerCallbackQuery(this, callbackQueryId, 'Unrecognized callback');
		return { webhookResponse: 'OK' };
	}

	// --- Signed URL query path ---
	const requestId = typeof query.requestId === 'string' ? query.requestId : '';
	if (!requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	// Only allow an unsigned query decision when n8n validated the resume signature
	// upstream (waitForReply). In dispatchAndExit mode (Telegram's default) the durable
	// companion URL carries no n8n signature, so reject unsigned query decisions.
	if (!isVerifiedProvider && !isUnsignedQueryDecisionAllowed(this)) {
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
				channel: 'telegram',
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
			channel: 'telegram',
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
			channel: 'telegram',
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
		channel: 'telegram',
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
