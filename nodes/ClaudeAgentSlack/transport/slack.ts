import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildApprovalReplyToken,
	buildQuestionReplyToken,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import type { ApprovalSendContext, OutboundMessageMode, QuestionSendContext } from '../types';

const CREDENTIAL_TYPE = 'slackApi';
const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

function buildBaseText(prefix: string | undefined, title: string | undefined, message: string): string {
	const parts = [prefix, title, message]
		.map((part) => (part ?? '').trim())
		.filter((part) => part.length > 0);
	return parts.join('\n\n');
}

function resolveOutboundMessage(args: {
	mode?: OutboundMessageMode;
	maxCharacters?: number;
	message: string;
	fallbackMessage: string;
	defaultMessage: string;
}): string {
	let resolved = args.message;
	if (args.mode === 'none') {
		resolved = '';
	} else if (args.mode === 'trim') {
		const max = Number(args.maxCharacters);
		if (Number.isFinite(max) && max > 0 && resolved.length > max) {
			resolved = resolved.slice(0, max);
		}
	}

	if (resolved.trim().length > 0) return resolved;
	if (args.fallbackMessage.trim().length > 0) return args.fallbackMessage;
	return args.defaultMessage;
}

function toSlackMrkdwn(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

async function sendMessage(ctx: IExecuteFunctions, body: IDataObject): Promise<void> {
	const requestOptions: IHttpRequestOptions = {
		method: 'POST',
		url: POST_MESSAGE_URL,
		body,
		json: true,
		headers: {
			'Content-Type': 'application/json',
		},
	};

	const response = await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		CREDENTIAL_TYPE,
		requestOptions,
	);
	const data = asRecord(response);
	if (data?.ok !== true) {
		const error = typeof data?.error === 'string' ? data.error : 'unknown_error';
		throw new NodeOperationError(ctx.getNode(), `Slack API error: ${error}`);
	}
}

function resolveApprovalPrimaryMessage(context: ApprovalSendContext): string {
	const defaultRawMessage = `Claude requests approval for ${context.request.toolName || 'tool'}.`;
	const baseMessage = context.request.message || defaultRawMessage;
	const primaryBaseMessage = buildBaseText(context.messagePrefix, context.title, baseMessage);
	const fallbackPrimaryMessage = buildBaseText(
		context.messagePrefix,
		context.title,
		context.fallbackMessage || '',
	);
	const defaultPrimaryMessage = buildBaseText(context.messagePrefix, context.title, defaultRawMessage);

	return resolveOutboundMessage({
		mode: context.outboundMessageMode,
		maxCharacters: context.maxOutboundCharacters,
		message: primaryBaseMessage,
		fallbackMessage: fallbackPrimaryMessage,
		defaultMessage: defaultPrimaryMessage,
	});
}

function resolveQuestionPrimaryMessage(context: QuestionSendContext): string {
	const defaultRawMessage = 'Claude needs your input to continue.';
	const baseMessage = context.request.message || defaultRawMessage;
	const primaryBaseMessage = buildBaseText(context.messagePrefix, context.title, baseMessage);
	const fallbackPrimaryMessage = buildBaseText(
		context.messagePrefix,
		context.title,
		context.fallbackMessage || '',
	);
	const defaultPrimaryMessage = buildBaseText(context.messagePrefix, context.title, defaultRawMessage);

	return resolveOutboundMessage({
		mode: context.outboundMessageMode,
		maxCharacters: context.maxOutboundCharacters,
		message: primaryBaseMessage,
		fallbackMessage: fallbackPrimaryMessage,
		defaultMessage: defaultPrimaryMessage,
	});
}

export async function sendApprovalMessage(
	ctx: IExecuteFunctions,
	context: ApprovalSendContext,
): Promise<void> {
	const primaryMessage = resolveApprovalPrimaryMessage(context);
	const { requestId, fingerprint } = context.request;

	await sendMessage(ctx, {
		channel: context.channelId,
		text: 'Claude approval request',
		blocks: [
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: toSlackMrkdwn(primaryMessage),
				},
			},
			{
				type: 'actions',
				elements: [
					{
						type: 'button',
						text: { type: 'plain_text', text: 'Approve' },
						style: 'primary',
						action_id: 'hitl_approve',
						value: buildApprovalReplyToken(requestId, true, fingerprint),
					},
					{
						type: 'button',
						text: { type: 'plain_text', text: 'Deny' },
						style: 'danger',
						action_id: 'hitl_deny',
						value: buildApprovalReplyToken(requestId, false, fingerprint),
					},
				],
			},
		],
	});
}

export async function sendQuestionMessage(
	ctx: IExecuteFunctions,
	context: QuestionSendContext,
): Promise<void> {
	const primaryMessage = resolveQuestionPrimaryMessage(context);
	const { requestId } = context.request;
	const questions = Array.isArray(context.request.questions) ? context.request.questions : [];
	const firstQuestion = questions[0];
	const options = Array.isArray(firstQuestion?.options) ? firstQuestion.options : [];

	// For single question with ≤3 options, use inline callback buttons
	if (questions.length === 1 && options.length > 0 && options.length <= 3) {
		const questionText = firstQuestion?.question || primaryMessage;
		await sendMessage(ctx, {
			channel: context.channelId,
			text: 'Claude question request',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: toSlackMrkdwn(questionText),
					},
				},
				{
					type: 'actions',
					elements: options.map((option, optionIndex) => ({
						type: 'button',
						text: { type: 'plain_text', text: (option.label || `Option ${optionIndex + 1}`).slice(0, 75) },
						action_id: `hitl_q_0_${optionIndex}`,
						value: buildQuestionReplyToken(requestId, 0, optionIndex),
					})),
				},
			],
		});
		return;
	}

	// Fallback: URL button for free-text or multi-question
	await sendMessage(ctx, {
		channel: context.channelId,
		text: 'Claude question request',
		blocks: [
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: toSlackMrkdwn(primaryMessage),
				},
			},
			{
				type: 'actions',
				elements: [
					{
						type: 'button',
						text: { type: 'plain_text', text: 'Answer' },
						style: 'primary',
						url: context.responseUrl,
					},
				],
			},
		],
	});
}

