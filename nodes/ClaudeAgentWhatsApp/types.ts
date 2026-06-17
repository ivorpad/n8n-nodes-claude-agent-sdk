import type {
	HitlApprovalRequestEnvelope,
	HitlQuestionRequestEnvelope,
} from '../ClaudeAgentSdk/hitl/contract';
import type {
	PendingCompanionHitlRecord,
	PendingCompanionStoreBackend,
	CompanionReplyHandlingMode,
} from '../ClaudeAgentChannelShared/core/types';

export type WhatsAppHitlDeliveryMode =
	| 'textLinks'
	| 'templateButtons'
	| 'interactiveCtaButtons'
	| 'interactiveReplyButtons';
export type OutboundMessageMode = 'asIs' | 'trim' | 'none';
export type WhatsAppCompanionFailureBehavior = 'continue' | 'fail';
export type WhatsAppCompanionMessageType =
	| 'text'
	| 'template'
	| 'image'
	| 'video'
	| 'audio'
	| 'document'
	| 'sticker'
	| 'location'
	| 'contacts'
	| 'reaction'
	| 'interactiveButton'
	| 'interactiveList'
	| 'interactiveCtaUrl'
	| 'interactiveLocationRequest'
	| 'interactiveFlow'
	| 'interactiveAddress';
export type PendingStoreBackend = PendingCompanionStoreBackend;
export type ReplyHandlingMode = CompanionReplyHandlingMode;

export type PendingWhatsAppHitlRecord = PendingCompanionHitlRecord;
interface BaseSendContext {
	recipientPhoneNumber: string;
	deliveryMode: WhatsAppHitlDeliveryMode;
	messagePrefix?: string;
	title?: string;
	outboundMessageMode?: OutboundMessageMode;
	maxOutboundCharacters?: number;
	fallbackMessage?: string;
	companionMessageType?: WhatsAppCompanionMessageType;
	companionPayload?: Record<string, unknown>;
	companionFailureBehavior?: WhatsAppCompanionFailureBehavior;
}

export interface SendMessageResult {
	providerMessageId?: string;
}

export interface ApprovalSendContext extends BaseSendContext {
	request: HitlApprovalRequestEnvelope;
	approveUrl: string;
	denyUrl: string;
	templateName?: string;
	templateLanguageCode?: string;
}

export interface QuestionSendContext extends BaseSendContext {
	request: HitlQuestionRequestEnvelope;
	responseUrl: string;
	templateName?: string;
	templateLanguageCode?: string;
}
