import type { IExecuteFunctions } from 'n8n-workflow';

import type { WoztellCompanionMessageType } from '../types';
import { sendResponses } from './woztell';

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asArray(value: unknown): unknown[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

/**
 * Build a Woztell Bot API response payload for the given companion message type.
 * Returns undefined when the type is not recognised or no type is provided.
 */
export function buildCompanionPayload(args: {
	companionMessageType?: WoztellCompanionMessageType;
	companionPayload?: Record<string, unknown>;
	defaultMessage: string;
}): Record<string, unknown> | undefined {
	const { companionMessageType, companionPayload, defaultMessage } = args;
	if (!companionMessageType) return undefined;

	const payload = companionPayload ?? {};

	switch (companionMessageType) {
		case 'text':
			return {
				type: 'TEXT',
				text: typeof payload.text === 'string' ? payload.text : defaultMessage,
			};

		case 'image':
			return {
				type: 'IMAGE',
				...(payload.url ? { url: payload.url } : {}),
				...(payload.attachment_id ? { attachment_id: payload.attachment_id } : {}),
				...(payload.text ? { text: payload.text } : {}),
			};

		case 'video':
			return {
				type: 'VIDEO',
				...(payload.url ? { url: payload.url } : {}),
				...(payload.attachment_id ? { attachment_id: payload.attachment_id } : {}),
				...(payload.text ? { text: payload.text } : {}),
			};

		case 'audio':
			return {
				type: 'AUDIO',
				...(payload.url ? { url: payload.url } : {}),
				...(payload.attachment_id ? { attachment_id: payload.attachment_id } : {}),
			};

		case 'file':
			return {
				type: 'FILE',
				...(payload.url ? { url: payload.url } : {}),
				...(payload.attachment_id ? { attachment_id: payload.attachment_id } : {}),
				...(payload.filename ? { filename: payload.filename } : {}),
			};

		case 'sticker':
			return {
				type: 'STICKER',
				...(payload.url ? { url: payload.url } : {}),
				...(payload.attachment_id ? { attachment_id: payload.attachment_id } : {}),
			};

		case 'location':
			return {
				type: 'LOCATION',
				location: asRecord(payload.location) ?? {
					lat: payload.lat ?? payload.latitude,
					long: payload.long ?? payload.longitude,
					...(payload.name ? { name: payload.name } : {}),
					...(payload.address ? { address: payload.address } : {}),
				},
			};

		case 'contacts':
			return {
				type: 'CONTACTS',
				contacts: asArray(payload.contacts) ?? [],
			};

		case 'reaction':
			return {
				type: 'REACTION',
				message_id: payload.message_id,
				emoji: payload.emoji,
			};

		case 'template': {
			const elementName = payload.elementName ?? payload.name;
			if (!elementName) return undefined;
			return {
				type: 'TEMPLATE',
				elementName,
				languageCode: payload.languageCode ?? 'en',
				...(payload.components ? { components: payload.components } : {}),
				...(payload.namespace ? { namespace: payload.namespace } : {}),
			};
		}

		case 'interactiveReplyButtons':
			return {
				type: 'WHATSAPP_REPLY_BUTTONS',
				...(asRecord(payload.body) ? { body: payload.body } : { body: { text: defaultMessage } }),
				...(asRecord(payload.action) ? { action: payload.action } : {}),
				...(asRecord(payload.header) ? { header: payload.header } : {}),
				...(asRecord(payload.footer) ? { footer: payload.footer } : {}),
			};

		case 'interactiveList':
			return {
				type: 'WHATSAPP_LIST',
				...(asRecord(payload.body) ? { body: payload.body } : { body: { text: defaultMessage } }),
				...(asRecord(payload.action) ? { action: payload.action } : {}),
				...(asRecord(payload.header) ? { header: payload.header } : {}),
				...(asRecord(payload.footer) ? { footer: payload.footer } : {}),
			};

		case 'locationRequest':
			return {
				type: 'LOCATION_REQUEST_MESSAGE',
				body: asRecord(payload.body) ?? { text: defaultMessage },
				action: asRecord(payload.action) ?? { name: 'send_location' },
			};

		default:
			return undefined;
	}
}

/**
 * Send a companion message before the HITL message.
 * Swallows errors when failureBehavior is 'continue'.
 */
export async function sendCompanionMessage(
	ctx: IExecuteFunctions,
	args: {
		channelId: string;
		recipientId: string;
		companionMessageType?: WoztellCompanionMessageType;
		companionPayload?: Record<string, unknown>;
		companionFailureBehavior?: 'continue' | 'fail';
		defaultMessage: string;
	},
): Promise<void> {
	const payload = buildCompanionPayload(args);
	if (!payload) return;

	try {
		await sendResponses(ctx, args.channelId, args.recipientId, [payload]);
	} catch (error) {
		if (args.companionFailureBehavior === 'fail') {
			throw error;
		}
	}
}
