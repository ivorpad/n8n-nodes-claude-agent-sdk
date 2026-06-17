import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildApprovalReplyToken,
	buildQuestionReplyToken,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import type { ApprovalSendContext, OutboundMessageMode, QuestionSendContext } from '../types';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

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

async function sendMessage(
	ctx: IExecuteFunctions,
	channelId: string,
	body: Record<string, unknown>,
): Promise<void> {
	const requestOptions: IHttpRequestOptions = {
		method: 'POST',
		url: `${DISCORD_API_BASE}/channels/${channelId}/messages`,
		body,
		json: true,
	};

	try {
		await ctx.helpers.requestWithAuthentication.call(ctx, 'discordBotApi', requestOptions);
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), error as Error);
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

	await sendMessage(ctx, context.channelId, {
		content: primaryMessage,
		components: [
			{
				type: 1, // ACTION_ROW
				components: [
					{
						type: 2, // BUTTON
						style: 3, // SUCCESS (green)
						label: 'Approve',
						custom_id: buildApprovalReplyToken(requestId, true, fingerprint),
					},
					{
						type: 2,
						style: 4, // DANGER (red)
						label: 'Deny',
						custom_id: buildApprovalReplyToken(requestId, false, fingerprint),
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
		await sendMessage(ctx, context.channelId, {
			content: questionText,
			components: [
				{
					type: 1,
					components: options.map((option, optionIndex) => ({
						type: 2,
						style: 1, // PRIMARY (blurple)
						label: (option.label || `Option ${optionIndex + 1}`).slice(0, 80),
						custom_id: buildQuestionReplyToken(requestId, 0, optionIndex),
					})),
				},
			],
		});
		return;
	}

	// Fallback: URL button for free-text or multi-question
	await sendMessage(ctx, context.channelId, {
		content: primaryMessage,
		components: [
			{
				type: 1,
				components: [
					{
						type: 2,
						style: 5, // LINK
						label: 'Answer',
						url: context.responseUrl,
					},
				],
			},
		],
	});
}
