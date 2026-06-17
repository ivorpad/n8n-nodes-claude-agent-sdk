import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildApprovalReplyToken,
	buildQuestionReplyToken,
} from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import type {
	ApprovalSendContext,
	OutboundMessageMode,
	QuestionSendContext,
	SendMessageResult,
} from '../types';

interface TelegramCredentials {
	accessToken: string;
	baseUrl?: string;
}

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

	if (resolved.trim().length === 0) {
		if (args.fallbackMessage.trim().length > 0) {
			resolved = args.fallbackMessage;
		} else {
			resolved = args.defaultMessage;
		}
	}

	// Telegram Bot API text limit for sendMessage.
	if (resolved.length > 4096) {
		resolved = resolved.slice(0, 4096);
	}
	return resolved;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

async function sendMessage(ctx: IExecuteFunctions, body: IDataObject): Promise<SendMessageResult> {
	const credentials = await ctx.getCredentials<TelegramCredentials>('telegramApi');
	const accessToken = String(credentials?.accessToken ?? '').trim();
	const baseUrl = String(credentials?.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');

	if (!accessToken) {
		throw new NodeOperationError(ctx.getNode(), 'Telegram credential is missing Access Token');
	}

	const response = await ctx.helpers.httpRequest({
		method: 'POST',
		url: `${baseUrl}/bot${accessToken}/sendMessage`,
		body,
		json: true,
	});

	const data = asRecord(response);
	if (data?.ok !== true) {
		const description =
			typeof data?.description === 'string' ? data.description : 'Unknown Telegram API error';
		throw new NodeOperationError(ctx.getNode(), `Telegram API error: ${description}`);
	}

	const result = asRecord(data?.result);
	const rawMessageId = result?.message_id;
	const providerMessageId = typeof rawMessageId === 'number' || typeof rawMessageId === 'string'
		? String(rawMessageId)
		: undefined;
	return { providerMessageId };
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
): Promise<SendMessageResult> {
	const primaryMessage = resolveApprovalPrimaryMessage(context);
	const { requestId, fingerprint } = context.request;

	return sendMessage(ctx, {
		chat_id: context.chatId,
		text: primaryMessage,
		disable_web_page_preview: true,
		reply_markup: {
			inline_keyboard: [
				[
					{
						text: 'Approve',
						callback_data: buildApprovalReplyToken(requestId, true, fingerprint),
					},
					{
						text: 'Deny',
						callback_data: buildApprovalReplyToken(requestId, false, fingerprint),
					},
				],
			],
		},
	});
}

export async function sendQuestionMessage(
	ctx: IExecuteFunctions,
	context: QuestionSendContext,
): Promise<SendMessageResult> {
	const primaryMessage = resolveQuestionPrimaryMessage(context);
	const { requestId } = context.request;
	const questions = Array.isArray(context.request.questions) ? context.request.questions : [];
	const firstQuestion = questions[0];
	const options = Array.isArray(firstQuestion?.options) ? firstQuestion.options : [];

	// For single question with ≤3 options, use inline callback buttons
	if (questions.length === 1 && options.length > 0 && options.length <= 3) {
		const questionText = firstQuestion?.question || primaryMessage;
		return sendMessage(ctx, {
			chat_id: context.chatId,
			text: questionText,
			disable_web_page_preview: true,
			reply_markup: {
				inline_keyboard: options.map((option, optionIndex) => [
					{
						text: (option.label || `Option ${optionIndex + 1}`).slice(0, 64),
						callback_data: buildQuestionReplyToken(requestId, 0, optionIndex),
					},
				]),
			},
		});
	}

	// Fallback: URL button for free-text or multi-question
	return sendMessage(ctx, {
		chat_id: context.chatId,
		text: primaryMessage,
		disable_web_page_preview: true,
		reply_markup: {
			inline_keyboard: [
				[
					{
						text: 'Answer',
						url: context.responseUrl,
					},
				],
			],
		},
	});
}
