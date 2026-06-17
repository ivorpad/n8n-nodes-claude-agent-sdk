import type { IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

import { authenticateHitlWebhookRequest } from '../webhook/auth';
import { createHitlInteractionStoreHandle } from '../hitl/interactionStore';
import type { HitlInteractionRecord } from '../hitl/interactionStore';
import { parseApprovalConfig } from '../permissions/approvalProperties';
import { parseApprovalDecision } from '../../ClaudeAgentChannelShared/core/webhookRuntime';
import { FORM_CSP, buildApprovalConfirmationHtml } from '../webhook/questionForm';
import { handlePostApproval } from './webhookApprovalHandlers';
import { type WebhookQuery, attachStreamResponse, resolveStreamKey } from './webhookHelpers';
import { handleGetQuestion, handlePostQuestion } from './webhookQuestionHandlers';

type ReadNodeParameter = (name: string, itemIndex: number, defaultValue?: unknown) => unknown;

type HitlWebhookAuthentication = Awaited<ReturnType<typeof authenticateHitlWebhookRequest>>;
type AuthenticatedHitlWebhookRequest = Extract<HitlWebhookAuthentication, { ok: true }>;

interface PreparedWebhookRequest {
	method: string;
	query: WebhookQuery;
	streamKey: string | undefined;
	isStreamFormat: boolean;
	readNodeParameter: ReadNodeParameter;
	authentication: AuthenticatedHitlWebhookRequest;
}

function createNodeParameterReader(ctx: IWebhookFunctions): ReadNodeParameter {
	return (name, _itemIndex, defaultValue) =>
		typeof ctx.getNodeParameter === 'function'
			? ctx.getNodeParameter(name, defaultValue)
			: defaultValue;
}

function isReplayOnlyRequest(args: {
	method: string;
	query: WebhookQuery;
	isStreamFormat: boolean;
}): boolean {
	return (
		args.method === 'GET' &&
		args.isStreamFormat &&
		Boolean(args.query.streamKey) &&
		(args.query.replay === 'true' || !args.query.requestId)
	);
}

async function prepareWebhookRequest(
	ctx: IWebhookFunctions,
): Promise<PreparedWebhookRequest | { response: IWebhookResponseData }> {
	const req = ctx.getRequestObject();
	const query = req.query as WebhookQuery;
	const readNodeParameter = createNodeParameterReader(ctx);
	const authentication = await authenticateHitlWebhookRequest({
		ctx,
		approvalConfig: parseApprovalConfig(readNodeParameter, 0),
	});

	if (!authentication.ok) {
		return { response: authentication.response };
	}

	return {
		method: req.method,
		query,
		streamKey: resolveStreamKey(query),
		isStreamFormat: query.format === 'stream',
		readNodeParameter,
		authentication,
	};
}

async function handleReplayOnlyRequest(args: {
	ctx: IWebhookFunctions;
	request: PreparedWebhookRequest;
}): Promise<IWebhookResponseData | undefined> {
	const { ctx, request } = args;
	if (!request.streamKey || !isReplayOnlyRequest(request)) {
		return undefined;
	}

	await attachStreamResponse({
		ctx,
		query: request.query,
		streamKey: request.streamKey,
		requireExistingState: true,
	});
	return { noWebhookResponse: true };
}

function readAuditLogging(readNodeParameter: ReadNodeParameter): boolean {
	try {
		const secOpts = readNodeParameter('securityOptions', 0, {}) as Record<string, unknown>;
		const auditSettings = (secOpts?.auditLogging as Record<string, unknown>)?.settings as Record<
			string,
			unknown
		>;
		return auditSettings?.enabled === true;
	} catch {
		return false;
	}
}

function readBody(ctx: IWebhookFunctions): Record<string, unknown> {
	const rawBody = ctx.getBodyData() as Record<string, unknown>;
	return (rawBody.data as Record<string, unknown>) || rawBody;
}

function isApprovalPost(args: {
	storedInteractionKind: string | undefined;
	body: Record<string, unknown>;
	query: WebhookQuery;
}): boolean {
	// The V6 confirmation form posts `approved` (a string) in the body and, by
	// posting to the same URL, in the query too. Recognise both — and a real
	// boolean from programmatic callers — so the explicit POST always routes to
	// the approval handler even if a proxy strips the query string.
	const bodyApproved = args.body.approved;
	return (
		args.storedInteractionKind === 'approval' ||
		typeof bodyApproved === 'boolean' ||
		typeof bodyApproved === 'string' ||
		args.query.approved !== undefined
	);
}

/**
 * V6 (CSRF-class GET auto-approval): a GET MUST NOT mutate state.
 *
 * Approve/deny URLs are emailed and posted to chat, so link scanners,
 * unfurlers and browser prefetch issue automatic GETs against them. Instead of
 * consuming the decision on GET, render a confirmation page (a plain HTML form)
 * that POSTs the decision back to the same URL. The decision is consumed only
 * by the explicit POST (the user clicking the button) — see handlePostApproval.
 */
function renderApprovalConfirmation(args: {
	ctx: IWebhookFunctions;
	query: WebhookQuery;
	storedInteraction: HitlInteractionRecord | undefined;
}): IWebhookResponseData {
	const approved = parseApprovalDecision(args.query.approved);
	if (typeof approved !== 'boolean') {
		return { webhookResponse: 'Error: Missing approved parameter' };
	}

	const toolName =
		args.storedInteraction?.kind === 'approval' ? args.storedInteraction.toolName : undefined;
	const html = buildApprovalConfirmationHtml({ approved, toolName });

	const res = args.ctx.getResponseObject();
	res.setHeader('Content-Security-Policy', FORM_CSP);
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(html);
	return { noWebhookResponse: true };
}

// ─────────────────────────────────────────────────────────────────────────
// webhook() — Handle approval clicks, POST approvals, and question forms
// ─────────────────────────────────────────────────────────────────────────

export async function webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const preparedRequest = await prepareWebhookRequest(this);
	if ('response' in preparedRequest) {
		return preparedRequest.response;
	}

	const replayResponse = await handleReplayOnlyRequest({
		ctx: this,
		request: preparedRequest,
	});
	if (replayResponse) {
		return replayResponse;
	}

	if (!preparedRequest.query.requestId) {
		return { webhookResponse: 'Error: Missing requestId parameter' };
	}

	const requestId = preparedRequest.query.requestId;
	const hitlInteractionStoreHandle = await createHitlInteractionStoreHandle({ ctx: this });
	const storedInteraction = await hitlInteractionStoreHandle.store.getInteraction(requestId);

	try {
		const effectiveStreamKey = storedInteraction?.streamKey || preparedRequest.streamKey;
		const storedQuestions =
			storedInteraction?.kind === 'question' ? storedInteraction.questions : undefined;

		const handlerArgs = {
			ctx: this as IWebhookFunctions,
			query: preparedRequest.query,
			requestId,
			storedInteraction,
			hitlInteractionStore: hitlInteractionStoreHandle.store,
			effectiveStreamKey,
			isStreamFormat: preparedRequest.isStreamFormat,
			hasAuditLogging: readAuditLogging(preparedRequest.readNodeParameter),
			authentication: preparedRequest.authentication,
		};

		if (preparedRequest.method === 'GET') {
			if (preparedRequest.query.approved !== undefined) {
				// V6: GET renders a confirmation page only — it never consumes the
				// decision. Consumption happens on the explicit POST below.
				return renderApprovalConfirmation({
					ctx: this,
					query: preparedRequest.query,
					storedInteraction,
				});
			}
			if (preparedRequest.query.type === 'question') {
				return handleGetQuestion({ ...handlerArgs, storedQuestions });
			}
			return { webhookResponse: 'Error: Unrecognised GET request' };
		}

		if (preparedRequest.method === 'POST') {
			const body = readBody(this);
			if (
				isApprovalPost({
					storedInteractionKind: storedInteraction?.kind,
					body,
					query: preparedRequest.query,
				})
			) {
				return handlePostApproval({ ...handlerArgs, body });
			}
			return handlePostQuestion({ ...handlerArgs, storedQuestions, body });
		}

		return { webhookResponse: 'Method not allowed' };
	} finally {
		// Close is deferred: n8n's webhook-waiting resume keeps the execution
		// context alive after the handler returns, so closing the pool here
		// would kill connections the execution engine still needs.
		setImmediate(() => {
			hitlInteractionStoreHandle.close().catch(() => {});
		});
	}
}
