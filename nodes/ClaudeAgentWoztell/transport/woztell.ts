import type { IExecuteFunctions } from 'n8n-workflow';
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

const WOZTELL_BOT_BASE_URL = 'https://bot.api.woztell.com';
const WOZTELL_TEXT_BODY_MAX_CHARS = 4096;

interface WoztellCredentials {
	accessToken: string;
}

function sanitizeRecipientId(value: string): string {
	return value.replace(/[-()+ \s]/g, '');
}

async function getCredentialToken(ctx: IExecuteFunctions): Promise<string> {
	const credentials = (await ctx.getCredentials('woztellBotApi')) as unknown as WoztellCredentials;
	const accessToken = String(credentials?.accessToken ?? '').trim();
	if (!accessToken) {
		throw new NodeOperationError(ctx.getNode(), 'Woztell credential is missing Access Token');
	}
	return accessToken;
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

	if (resolved.trim().length > 0) return resolved;
	if (args.fallbackMessage.trim().length > 0) return args.fallbackMessage;
	return args.defaultMessage;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTrailingPrompt(message: string, prompt: string): string {
	const normalizedMessage = message.trim();
	const normalizedPrompt = prompt.trim();
	if (!normalizedMessage || !normalizedPrompt) return normalizedMessage;

	const trailingPromptPattern = new RegExp(`(?:\\n\\s*)*${escapeRegExp(normalizedPrompt)}\\s*$`);
	const stripped = normalizedMessage.replace(trailingPromptPattern, '').trim();
	return stripped.length > 0 ? stripped : normalizedMessage;
}

function resolveNarrativeCandidateMessage(args: {
	candidate: string;
	singleQuestionPrompt: string;
}): string | undefined {
	const trimmedCandidate = args.candidate.trim();
	if (!trimmedCandidate) return undefined;
	if (!args.singleQuestionPrompt) return trimmedCandidate;

	const stripped = stripTrailingPrompt(trimmedCandidate, args.singleQuestionPrompt);
	if (!stripped || stripped === args.singleQuestionPrompt) return undefined;
	return stripped;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

// ---------------------------------------------------------------------------
// Woztell message payload builders
// ---------------------------------------------------------------------------

export function buildTextPayload(text: string): Record<string, unknown> {
	return { type: 'TEXT', text };
}

export function buildReplyButtonsPayload(
	bodyText: string,
	buttons: Array<{ payload: string; title: string }>,
): Record<string, unknown> {
	return {
		type: 'WHATSAPP_REPLY_BUTTONS',
		body: { text: bodyText },
		action: {
			buttons: buttons.map((button) => ({
				type: 'reply',
				reply: {
					payload: button.payload,
					title: button.title.slice(0, 20),
				},
			})),
		},
	};
}

export function buildListPayload(
	bodyText: string,
	buttonText: string,
	rows: Array<{ payload: string; title: string; description?: string }>,
): Record<string, unknown> {
	return {
		type: 'WHATSAPP_LIST',
		body: { text: bodyText },
		action: {
			button: buttonText.slice(0, 20),
			sections: [
				{
					title: 'Options',
					rows: rows.map((row) => ({
						payload: row.payload,
						title: row.title.slice(0, 24),
						...(row.description ? { description: row.description.slice(0, 72) } : {}),
					})),
				},
			],
		},
	};
}

export function buildTemplatePayload(
	name: string,
	languageCode: string,
	bodyParameters: string[],
): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		type: 'TEMPLATE',
		elementName: name,
		languageCode,
	};

	if (bodyParameters.length > 0) {
		payload.components = [
			{
				type: 'body',
				parameters: bodyParameters.map((value) => ({ type: 'text', text: value })),
			},
		];
	}

	return payload;
}

// ---------------------------------------------------------------------------
// Text chunking
// ---------------------------------------------------------------------------

function splitTextBodyIntoChunks(body: string): string[] {
	if (body.length <= WOZTELL_TEXT_BODY_MAX_CHARS) return [body];

	const chunks: string[] = [];
	let remaining = body;
	while (remaining.length > WOZTELL_TEXT_BODY_MAX_CHARS) {
		let splitIndex = remaining.lastIndexOf('\n', WOZTELL_TEXT_BODY_MAX_CHARS);
		if (splitIndex <= 0) {
			splitIndex = remaining.lastIndexOf(' ', WOZTELL_TEXT_BODY_MAX_CHARS);
		}
		if (splitIndex <= 0 || splitIndex < Math.floor(WOZTELL_TEXT_BODY_MAX_CHARS * 0.5)) {
			splitIndex = WOZTELL_TEXT_BODY_MAX_CHARS;
		}

		const chunk = remaining.slice(0, splitIndex).trimEnd();
		chunks.push(chunk.length > 0 ? chunk : remaining.slice(0, WOZTELL_TEXT_BODY_MAX_CHARS));
		remaining = remaining.slice(splitIndex).trimStart();
	}

	if (remaining.length > 0) {
		chunks.push(remaining);
	}
	return chunks;
}

// ---------------------------------------------------------------------------
// Core send
// ---------------------------------------------------------------------------

export async function sendResponses(
	ctx: IExecuteFunctions,
	channelId: string,
	recipientId: string,
	responsePayload: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
	const accessToken = await getCredentialToken(ctx);
	const sanitizedRecipient = sanitizeRecipientId(recipientId);

	const response = await ctx.helpers.httpRequest({
		method: 'POST',
		url: `${WOZTELL_BOT_BASE_URL}/sendResponses`,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
		},
		body: {
			channelId,
			recipientId: sanitizedRecipient,
			response: responsePayload,
		},
		json: true,
	});

	const data = typeof response === 'object' && response !== null
		? (response as Record<string, unknown>)
		: {};

	if (data.ok !== 1) {
		const errMsg = typeof data.error === 'string' ? data.error : 'Unknown Woztell API error';
		throw new NodeOperationError(ctx.getNode(), `Woztell Bot API error: ${errMsg}`);
	}

	return data;
}

function extractProviderMessageId(response: Record<string, unknown>): string | undefined {
	const result = Array.isArray(response.result) ? response.result : undefined;
	if (!result || result.length === 0) return undefined;
	const firstResult = asRecord(result[0]);
	const innerResult = asRecord(firstResult?.result);
	const messages = Array.isArray(innerResult?.messages) ? innerResult.messages : undefined;
	if (!messages || messages.length === 0) return undefined;
	const first = asRecord(messages[0]);
	const id = first?.id;
	return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

async function sendAndExtractId(
	ctx: IExecuteFunctions,
	channelId: string,
	recipientId: string,
	payloads: Record<string, unknown>[],
): Promise<SendMessageResult> {
	const response = await sendResponses(ctx, channelId, recipientId, payloads);
	return { providerMessageId: extractProviderMessageId(response) };
}

async function sendTextWithChunking(
	ctx: IExecuteFunctions,
	channelId: string,
	recipientId: string,
	text: string,
): Promise<SendMessageResult> {
	const chunks = splitTextBodyIntoChunks(text);
	let lastResult: SendMessageResult = {};
	for (const chunk of chunks) {
		lastResult = await sendAndExtractId(ctx, channelId, recipientId, [buildTextPayload(chunk)]);
	}
	return lastResult;
}

// ---------------------------------------------------------------------------
// Resolve outbound messages (approval / question)
// ---------------------------------------------------------------------------

function resolveApprovalPrimaryMessage(context: ApprovalSendContext): string {
	const defaultRawMessage = `Claude requests approval for ${context.request.toolName || 'tool'}.`;
	const baseMessage = context.request.message || defaultRawMessage;
	const primaryBaseMessage = context.deliveryMode === 'templateButtons'
		? baseMessage
		: buildBaseText(context.messagePrefix, context.title, baseMessage);
	const fallbackPrimaryMessage = context.deliveryMode === 'templateButtons'
		? (context.fallbackMessage || '')
		: buildBaseText(context.messagePrefix, context.title, context.fallbackMessage || '');
	const defaultPrimaryMessage = context.deliveryMode === 'templateButtons'
		? defaultRawMessage
		: buildBaseText(context.messagePrefix, context.title, defaultRawMessage);

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
	const primaryBaseMessage = context.deliveryMode === 'templateButtons'
		? baseMessage
		: buildBaseText(context.messagePrefix, context.title, baseMessage);
	const fallbackPrimaryMessage = context.deliveryMode === 'templateButtons'
		? (context.fallbackMessage || '')
		: buildBaseText(context.messagePrefix, context.title, context.fallbackMessage || '');
	const defaultPrimaryMessage = context.deliveryMode === 'templateButtons'
		? defaultRawMessage
		: buildBaseText(context.messagePrefix, context.title, defaultRawMessage);

	return resolveOutboundMessage({
		mode: context.outboundMessageMode,
		maxCharacters: context.maxOutboundCharacters,
		message: primaryBaseMessage,
		fallbackMessage: fallbackPrimaryMessage,
		defaultMessage: defaultPrimaryMessage,
	});
}

function resolveQuestionSummaryMessage(context: QuestionSendContext): string | undefined {
	const requestQuestions = Array.isArray(context.request.questions)
		? context.request.questions
		: [];
	const singleQuestionPrompt = requestQuestions.length === 1
		&& typeof requestQuestions[0]?.question === 'string'
		? requestQuestions[0].question.trim()
		: '';
	const requestMessage = typeof context.request.message === 'string'
		? context.request.message.trim()
		: '';
	const narrativeMessage = resolveNarrativeCandidateMessage({
		candidate: requestMessage,
		singleQuestionPrompt,
	});

	const requestResult = asRecord(context.request.agent_sdk_result) ?? asRecord(context.request.hitl_result);
	const summary = typeof requestResult?.summary === 'string' ? requestResult.summary.trim() : '';
	if (!summary) return undefined;
	const narrativeSummary = resolveNarrativeCandidateMessage({
		candidate: summary,
		singleQuestionPrompt,
	});
	const messageToSend = narrativeMessage || narrativeSummary;
	if (!messageToSend) return undefined;

	const baseMessage = buildBaseText(context.messagePrefix, context.title, messageToSend);
	const fallbackMessage = buildBaseText(context.messagePrefix, context.title, context.fallbackMessage || '');
	return resolveOutboundMessage({
		mode: context.outboundMessageMode,
		maxCharacters: context.maxOutboundCharacters,
		message: baseMessage,
		fallbackMessage,
		defaultMessage: messageToSend,
	});
}

function buildMultiQuestionResponsePrompt(args: {
	questions: QuestionSendContext['request']['questions'];
	responseUrl: string;
}): string {
	const { questions, responseUrl } = args;
	const lines: string[] = [
		'Multiple inputs are required to continue. Please answer all questions in the response form.',
	];

	for (const [questionIndex, question] of (questions ?? []).entries()) {
		lines.push(`${questionIndex + 1}. ${question.question}`);
		const options = Array.isArray(question.options) ? question.options : [];
		for (const [optionIndex, option] of options.slice(0, 10).entries()) {
			lines.push(`   ${optionIndex + 1}) ${option.label}`);
		}
		if (options.length > 10) {
			lines.push(`   ...and ${options.length - 10} more option(s)`);
		}
	}

	lines.push('', `Respond: ${responseUrl}`);
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public send functions
// ---------------------------------------------------------------------------

export async function sendApprovalMessage(
	ctx: IExecuteFunctions,
	context: ApprovalSendContext,
): Promise<SendMessageResult> {
	const primaryMessage = resolveApprovalPrimaryMessage(context);

	if (context.deliveryMode === 'interactiveReplyButtons') {
		const payload = buildReplyButtonsPayload(
			`${primaryMessage}\n\nChoose approve or deny in this chat.`,
			[
				{
					payload: buildApprovalReplyToken(
						context.request.requestId,
						true,
						context.request.fingerprint,
					),
					title: 'Approve',
				},
				{
					payload: buildApprovalReplyToken(
						context.request.requestId,
						false,
						context.request.fingerprint,
					),
					title: 'Deny',
				},
			],
		);
		return sendAndExtractId(ctx, context.channelId, context.recipientId, [payload]);
	}

	if (context.deliveryMode === 'templateButtons' && context.templateName) {
		const payload = buildTemplatePayload(
			context.templateName,
			context.templateLanguageCode || 'en_US',
			[primaryMessage, context.approveUrl, context.denyUrl],
		);
		return sendAndExtractId(ctx, context.channelId, context.recipientId, [payload]);
	}

	// textLinks fallback
	const text = `${primaryMessage}\n\nApprove: ${context.approveUrl}\nDeny: ${context.denyUrl}`;
	return sendTextWithChunking(ctx, context.channelId, context.recipientId, text);
}

export async function sendQuestionMessage(
	ctx: IExecuteFunctions,
	context: QuestionSendContext,
): Promise<SendMessageResult> {
	const primaryMessage = resolveQuestionPrimaryMessage(context);

	if (context.deliveryMode === 'interactiveReplyButtons') {
		const questions = Array.isArray(context.request.questions)
			? context.request.questions
			: [];
		const firstQuestion = questions.length > 0 ? questions[0] : undefined;
		const hasMultipleQuestions = questions.length > 1;
		const questionText = firstQuestion?.question || primaryMessage || 'Claude needs your input to continue.';
		const options = Array.isArray(firstQuestion?.options) ? firstQuestion.options : [];
		const summaryMessage = resolveQuestionSummaryMessage(context);

		if (summaryMessage && (options.length > 0 || hasMultipleQuestions)) {
			await sendTextWithChunking(ctx, context.channelId, context.recipientId, summaryMessage);
		}

		if (hasMultipleQuestions) {
			const multiQuestionRawMessage = buildMultiQuestionResponsePrompt({
				questions,
				responseUrl: context.responseUrl,
			});
			const multiQuestionMessage = resolveOutboundMessage({
				mode: context.outboundMessageMode,
				maxCharacters: context.maxOutboundCharacters,
				message: buildBaseText(context.messagePrefix, context.title, multiQuestionRawMessage),
				fallbackMessage: buildBaseText(
					context.messagePrefix,
					context.title,
					context.fallbackMessage || '',
				),
				defaultMessage: multiQuestionRawMessage,
			});
			return sendTextWithChunking(ctx, context.channelId, context.recipientId, multiQuestionMessage);
		}

		if (options.length > 0 && options.length <= 3) {
			const payload = buildReplyButtonsPayload(
				questionText,
				options.map((option, optionIndex) => ({
					payload: buildQuestionReplyToken(context.request.requestId, 0, optionIndex),
					title: option.label,
				})),
			);
			return sendAndExtractId(ctx, context.channelId, context.recipientId, [payload]);
		}

		if (options.length > 3) {
			const payload = buildListPayload(
				questionText,
				'Choose',
				options.slice(0, 10).map((option, optionIndex) => ({
					payload: buildQuestionReplyToken(context.request.requestId, 0, optionIndex),
					title: option.label,
					description: option.description,
				})),
			);
			return sendAndExtractId(ctx, context.channelId, context.recipientId, [payload]);
		}

		// Free text question
		const text = `${primaryMessage}\n\nReply in this chat with your answer.`;
		return sendTextWithChunking(ctx, context.channelId, context.recipientId, text);
	}

	if (context.deliveryMode === 'templateButtons' && context.templateName) {
		const payload = buildTemplatePayload(
			context.templateName,
			context.templateLanguageCode || 'en_US',
			[primaryMessage, context.responseUrl],
		);
		return sendAndExtractId(ctx, context.channelId, context.recipientId, [payload]);
	}

	// textLinks fallback
	const text = `${primaryMessage}\n\nRespond: ${context.responseUrl}`;
	return sendTextWithChunking(ctx, context.channelId, context.recipientId, text);
}
