import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
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

const CREDENTIAL_TYPE = 'whatsAppBusinessCloudApi';
const WHATSAPP_TEXT_BODY_MAX_CHARS = 4096;

interface WhatsAppCredential {
	baseUrl?: string;
	apiVersion?: string;
	phoneNumberId?: string;
}

function trimTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, '');
}

export function sanitizePhoneNumber(phoneNumber: string): string {
	return phoneNumber.replace(/[\s\-()+]/g, '');
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

function asArray(value: unknown): unknown[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

async function buildRequestOptions(
	ctx: IExecuteFunctions,
	body: IDataObject,
	overridePhoneNumberId?: string,
): Promise<IHttpRequestOptions> {
	const credentials = await ctx.getCredentials(CREDENTIAL_TYPE) as WhatsAppCredential;
	const baseUrl = trimTrailingSlashes((credentials.baseUrl || 'https://graph.facebook.com').trim());
	const apiVersion = (credentials.apiVersion || 'v22.0').trim();
	const phoneNumberId = (overridePhoneNumberId || credentials.phoneNumberId || '').trim();

	if (!phoneNumberId) {
		throw new NodeOperationError(ctx.getNode(), 'Missing Phone Number ID in WhatsApp credential');
	}

	return {
		method: 'POST',
		url: `${baseUrl}/${apiVersion}/${phoneNumberId}/messages`,
		body,
		json: true,
	};
}

function splitTextBodyIntoChunks(body: string): string[] {
	if (body.length <= WHATSAPP_TEXT_BODY_MAX_CHARS) return [body];

	const chunks: string[] = [];
	let remaining = body;
	while (remaining.length > WHATSAPP_TEXT_BODY_MAX_CHARS) {
		let splitIndex = remaining.lastIndexOf('\n', WHATSAPP_TEXT_BODY_MAX_CHARS);
		if (splitIndex <= 0) {
			splitIndex = remaining.lastIndexOf(' ', WHATSAPP_TEXT_BODY_MAX_CHARS);
		}
		if (splitIndex <= 0 || splitIndex < Math.floor(WHATSAPP_TEXT_BODY_MAX_CHARS * 0.5)) {
			splitIndex = WHATSAPP_TEXT_BODY_MAX_CHARS;
		}

		const chunk = remaining.slice(0, splitIndex).trimEnd();
		chunks.push(chunk.length > 0 ? chunk : remaining.slice(0, WHATSAPP_TEXT_BODY_MAX_CHARS));
		remaining = remaining.slice(splitIndex).trimStart();
	}

	if (remaining.length > 0) {
		chunks.push(remaining);
	}
	return chunks;
}

function extractProviderMessageId(response: unknown): string | undefined {
	if (typeof response !== 'object' || response === null) return undefined;
	const messages = (response as { messages?: unknown }).messages;
	if (!Array.isArray(messages) || messages.length === 0) return undefined;
	const first = messages[0];
	if (typeof first !== 'object' || first === null) return undefined;
	const id = (first as { id?: unknown }).id;
	return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

export async function sendMessage(
	ctx: IExecuteFunctions,
	body: IDataObject,
	overridePhoneNumberId?: string,
): Promise<SendMessageResult> {
	const textPayload = asRecord(body.text);
	const textBody = typeof textPayload?.body === 'string' ? textPayload.body : undefined;
	if (body.type === 'text' && textBody && textBody.length > WHATSAPP_TEXT_BODY_MAX_CHARS) {
		const chunks = splitTextBodyIntoChunks(textBody);
		let lastProviderMessageId: string | undefined;
		for (const chunk of chunks) {
			const chunkBody: IDataObject = {
				...body,
				text: {
					...(textPayload as IDataObject),
					body: chunk,
				},
			};
			const requestOptions = await buildRequestOptions(ctx, chunkBody, overridePhoneNumberId);
			const response = await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				CREDENTIAL_TYPE,
				requestOptions,
			);
			lastProviderMessageId = extractProviderMessageId(response) ?? lastProviderMessageId;
		}
		return { providerMessageId: lastProviderMessageId };
	}

	const requestOptions = await buildRequestOptions(ctx, body, overridePhoneNumberId);
	const response = await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		CREDENTIAL_TYPE,
		requestOptions,
	);
	return { providerMessageId: extractProviderMessageId(response) };
}

export function buildCompanionBody(args: {
	recipientPhoneNumber: string;
	companionMessageType?: string;
	companionPayload?: Record<string, unknown>;
	defaultMessage: string;
}): IDataObject | undefined {
	const { recipientPhoneNumber, companionMessageType, companionPayload, defaultMessage } = args;
	if (!companionMessageType) return undefined;

	const payload = companionPayload ?? {};
	const common = {
		messaging_product: 'whatsapp',
		to: sanitizePhoneNumber(recipientPhoneNumber),
	} as const;

	switch (companionMessageType) {
		case 'text':
			return {
				...common,
				type: 'text',
				text: asRecord(payload.text) ?? { preview_url: true, body: defaultMessage },
			};
		case 'template': {
			const template = asRecord(payload.template);
			if (!template) {
				throw new Error('Companion template payload must include a template object');
			}
			return { ...common, type: 'template', template };
		}
		case 'image':
			return { ...common, type: 'image', image: asRecord(payload.image) ?? payload };
		case 'video':
			return { ...common, type: 'video', video: asRecord(payload.video) ?? payload };
		case 'audio':
			return { ...common, type: 'audio', audio: asRecord(payload.audio) ?? payload };
		case 'document':
			return { ...common, type: 'document', document: asRecord(payload.document) ?? payload };
		case 'sticker':
			return { ...common, type: 'sticker', sticker: asRecord(payload.sticker) ?? payload };
		case 'location':
			return { ...common, type: 'location', location: asRecord(payload.location) ?? payload };
		case 'contacts':
			return {
				...common,
				type: 'contacts',
				contacts: asArray(payload.contacts) ?? [],
			};
		case 'reaction':
			return { ...common, type: 'reaction', reaction: asRecord(payload.reaction) ?? payload };
		case 'interactiveButton':
			return {
				...common,
				type: 'interactive',
				interactive: asRecord(payload.interactive) ?? {
					type: 'button',
					body: { text: defaultMessage },
					action: {
						buttons: [
							{ type: 'reply', reply: { id: 'hitl_btn_1', title: 'Option 1' } },
							{ type: 'reply', reply: { id: 'hitl_btn_2', title: 'Option 2' } },
						],
					},
				},
			};
		case 'interactiveList':
			return {
				...common,
				type: 'interactive',
				interactive: asRecord(payload.interactive) ?? {
					type: 'list',
					body: { text: defaultMessage },
					action: {
						button: 'View options',
						sections: [
							{
								title: 'Options',
								rows: [
									{ id: 'hitl_row_1', title: 'Option 1', description: 'First option' },
									{ id: 'hitl_row_2', title: 'Option 2', description: 'Second option' },
								],
							},
						],
					},
				},
			};
		case 'interactiveCtaUrl':
		case 'interactiveLocationRequest':
		case 'interactiveFlow':
		case 'interactiveAddress':
			return {
				...common,
				type: 'interactive',
				interactive: asRecord(payload.interactive) ?? payload,
			};
		default:
			return undefined;
	}
}

async function sendCompanionMessage(
	ctx: IExecuteFunctions,
	args: {
		recipientPhoneNumber: string;
		companionMessageType?: string;
		companionPayload?: Record<string, unknown>;
		companionFailureBehavior?: 'continue' | 'fail';
		defaultMessage: string;
	},
): Promise<void> {
	const body = buildCompanionBody(args);
	if (!body) return;
	try {
		await sendMessage(ctx, body);
	} catch (error) {
		if (args.companionFailureBehavior === 'fail') {
			throw error;
		}
	}
}

function buildApprovalTextMessage(context: ApprovalSendContext, resolvedMessage: string): IDataObject {
	return {
		messaging_product: 'whatsapp',
		to: sanitizePhoneNumber(context.recipientPhoneNumber),
		type: 'text',
		text: {
			preview_url: true,
			body: `${resolvedMessage}\n\nApprove: ${context.approveUrl}\nDeny: ${context.denyUrl}`,
		},
	};
}

function buildQuestionTextMessage(context: QuestionSendContext, resolvedMessage: string): IDataObject {
	return {
		messaging_product: 'whatsapp',
		to: sanitizePhoneNumber(context.recipientPhoneNumber),
		type: 'text',
		text: {
			preview_url: true,
			body: `${resolvedMessage}\n\nRespond: ${context.responseUrl}`,
		},
	};
}

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

function buildTemplateMessage(args: {
	recipientPhoneNumber: string;
	templateName: string;
	templateLanguageCode: string;
	bodyParameters: string[];
}): IDataObject {
	return {
		messaging_product: 'whatsapp',
		to: sanitizePhoneNumber(args.recipientPhoneNumber),
		type: 'template',
		template: {
			name: args.templateName,
			language: { code: args.templateLanguageCode },
			components: [
				{
					type: 'body',
					parameters: args.bodyParameters.map((value) => ({ type: 'text', text: value })),
				},
			],
		},
	};
}

function buildInteractiveCtaUrlMessage(args: {
	recipientPhoneNumber: string;
	bodyText: string;
	displayText: string;
	url: string;
	title?: string;
}): IDataObject {
	return {
		messaging_product: 'whatsapp',
		to: sanitizePhoneNumber(args.recipientPhoneNumber),
		type: 'interactive',
		interactive: {
			type: 'cta_url',
			header: args.title ? { type: 'text', text: args.title } : undefined,
			body: { text: args.bodyText },
			action: {
				name: 'cta_url',
				parameters: {
					display_text: args.displayText,
					url: args.url,
				},
			},
		},
	};
}

function buildInteractiveReplyButtonsMessage(args: {
	recipientPhoneNumber: string;
	bodyText: string;
	title?: string;
	buttons: Array<{ id: string; title: string }>;
}): IDataObject {
	return {
		messaging_product: 'whatsapp',
		to: sanitizePhoneNumber(args.recipientPhoneNumber),
		type: 'interactive',
		interactive: {
			type: 'button',
			header: args.title ? { type: 'text', text: args.title } : undefined,
			body: { text: args.bodyText },
			action: {
				buttons: args.buttons.map((button) => ({
					type: 'reply',
					reply: {
						id: button.id,
						title: button.title.slice(0, 20),
					},
				})),
			},
		},
	};
}

function buildInteractiveReplyListMessage(args: {
	recipientPhoneNumber: string;
	bodyText: string;
	title?: string;
	buttonText?: string;
	rows: Array<{ id: string; title: string; description?: string }>;
}): IDataObject {
	return {
		messaging_product: 'whatsapp',
		to: sanitizePhoneNumber(args.recipientPhoneNumber),
		type: 'interactive',
		interactive: {
			type: 'list',
			header: args.title ? { type: 'text', text: args.title } : undefined,
			body: { text: args.bodyText },
			action: {
				button: (args.buttonText || 'Choose').slice(0, 20),
				sections: [
					{
						title: 'Options',
						rows: args.rows.map((row) => ({
							id: row.id,
							title: row.title.slice(0, 24),
							description: row.description?.slice(0, 72),
						})),
					},
				],
			},
		},
	};
}

export async function sendApprovalMessage(
	ctx: IExecuteFunctions,
	context: ApprovalSendContext,
): Promise<SendMessageResult> {
	const companionMessage =
		context.request.message || `Claude requests approval for ${context.request.toolName || 'tool'}.`;
	await sendCompanionMessage(ctx, {
		recipientPhoneNumber: context.recipientPhoneNumber,
		companionMessageType: context.companionMessageType,
		companionPayload: context.companionPayload,
		companionFailureBehavior: context.companionFailureBehavior,
		defaultMessage: companionMessage,
	});
	const primaryMessage = resolveApprovalPrimaryMessage(context);

	let body: IDataObject;
	if (context.deliveryMode === 'interactiveReplyButtons') {
		body = buildInteractiveReplyButtonsMessage({
			recipientPhoneNumber: context.recipientPhoneNumber,
			title: context.title,
			bodyText: `${primaryMessage}\n\nChoose approve or deny in this chat.`,
			buttons: [
					{
						id: buildApprovalReplyToken(
							context.request.requestId,
							true,
							context.request.fingerprint,
						),
						title: 'Approve',
					},
					{
						id: buildApprovalReplyToken(
							context.request.requestId,
							false,
							context.request.fingerprint,
						),
						title: 'Deny',
					},
				],
		});
		return sendMessage(ctx, body);
	}

	if (context.deliveryMode === 'interactiveCtaButtons') {
		const approveSendResult = await sendMessage(
			ctx,
			buildInteractiveCtaUrlMessage({
				recipientPhoneNumber: context.recipientPhoneNumber,
				title: context.title,
				bodyText: `${primaryMessage}\n\nChoose approve to continue this action.`,
				displayText: 'Approve',
				url: context.approveUrl,
			}),
		);
		await sendMessage(
			ctx,
			buildInteractiveCtaUrlMessage({
				recipientPhoneNumber: context.recipientPhoneNumber,
				title: context.title,
				bodyText: `${primaryMessage}\n\nChoose deny to block this action.`,
				displayText: 'Deny',
				url: context.denyUrl,
			}),
		);
		return approveSendResult;
	}

	if (context.deliveryMode === 'templateButtons' && context.templateName) {
		body = buildTemplateMessage({
			recipientPhoneNumber: context.recipientPhoneNumber,
			templateName: context.templateName,
			templateLanguageCode: context.templateLanguageCode || 'en_US',
			bodyParameters: [
				primaryMessage,
				context.approveUrl,
				context.denyUrl,
			],
		});
	} else {
		body = buildApprovalTextMessage(context, primaryMessage);
	}

	return sendMessage(ctx, body);
}

export async function sendQuestionMessage(
	ctx: IExecuteFunctions,
	context: QuestionSendContext,
): Promise<SendMessageResult> {
	const companionMessage = context.request.message || 'Claude needs your input to continue.';
	await sendCompanionMessage(ctx, {
		recipientPhoneNumber: context.recipientPhoneNumber,
		companionMessageType: context.companionMessageType,
		companionPayload: context.companionPayload,
		companionFailureBehavior: context.companionFailureBehavior,
		defaultMessage: companionMessage,
	});
	const primaryMessage = resolveQuestionPrimaryMessage(context);

	let body: IDataObject;
	if (context.deliveryMode === 'interactiveReplyButtons') {
		const questions = Array.isArray(context.request.questions)
			? context.request.questions
			: [];
		const firstQuestion = questions.length > 0
			? questions[0]
			: undefined;
		const hasMultipleQuestions = questions.length > 1;
		const questionText = firstQuestion?.question || primaryMessage || 'Claude needs your input to continue.';
		const options = Array.isArray(firstQuestion?.options) ? firstQuestion.options : [];
		const summaryMessage = resolveQuestionSummaryMessage(context);

		if (summaryMessage && (options.length > 0 || hasMultipleQuestions)) {
			await sendMessage(ctx, {
				messaging_product: 'whatsapp',
				to: sanitizePhoneNumber(context.recipientPhoneNumber),
				type: 'text',
				text: {
					preview_url: false,
					body: summaryMessage,
				},
			});
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

			return sendMessage(ctx, {
				messaging_product: 'whatsapp',
				to: sanitizePhoneNumber(context.recipientPhoneNumber),
				type: 'text',
				text: {
					preview_url: false,
					body: multiQuestionMessage,
				},
			});
		}

		if (options.length > 0 && options.length <= 3) {
			body = buildInteractiveReplyButtonsMessage({
				recipientPhoneNumber: context.recipientPhoneNumber,
				title: context.title,
				bodyText: questionText,
				buttons: options.map((option, optionIndex) => ({
					id: buildQuestionReplyToken(context.request.requestId, 0, optionIndex),
					title: option.label,
				})),
			});
			return sendMessage(ctx, body);
		}

		if (options.length > 3) {
			body = buildInteractiveReplyListMessage({
				recipientPhoneNumber: context.recipientPhoneNumber,
				title: context.title,
				bodyText: questionText,
				buttonText: 'Choose',
				rows: options.slice(0, 10).map((option, optionIndex) => ({
					id: buildQuestionReplyToken(context.request.requestId, 0, optionIndex),
					title: option.label,
					description: option.description,
				})),
			});
			return sendMessage(ctx, body);
		}

		body = {
			messaging_product: 'whatsapp',
			to: sanitizePhoneNumber(context.recipientPhoneNumber),
			type: 'text',
			text: {
				preview_url: false,
				body: `${primaryMessage}\n\nReply in this chat with your answer.`,
			},
		};
		return sendMessage(ctx, body);
	}

	if (context.deliveryMode === 'interactiveCtaButtons') {
		return sendMessage(
			ctx,
			buildInteractiveCtaUrlMessage({
				recipientPhoneNumber: context.recipientPhoneNumber,
				title: context.title,
				bodyText: `${primaryMessage}\n\nTap the button to submit your answer.`,
				displayText: 'Answer',
				url: context.responseUrl,
			}),
		);
	}

	if (context.deliveryMode === 'templateButtons' && context.templateName) {
		body = buildTemplateMessage({
			recipientPhoneNumber: context.recipientPhoneNumber,
			templateName: context.templateName,
			templateLanguageCode: context.templateLanguageCode || 'en_US',
			bodyParameters: [primaryMessage, context.responseUrl],
		});
	} else {
		body = buildQuestionTextMessage(context, primaryMessage);
	}

	return sendMessage(ctx, body);
}
