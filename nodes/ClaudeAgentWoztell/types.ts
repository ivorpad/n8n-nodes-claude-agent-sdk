import type {
	HitlApprovalRequestEnvelope,
	HitlQuestionRequestEnvelope,
} from '../ClaudeAgentSdk/hitl/contract';
import type {
	CompanionReplyHandlingMode,
	PendingCompanionHitlRecord,
	PendingCompanionStoreBackend,
} from '../ClaudeAgentChannelShared/core/types';

export type WoztellHitlDeliveryMode =
	| 'textLinks'
	| 'templateButtons'
	| 'interactiveReplyButtons';
export type OutboundMessageMode = 'asIs' | 'trim' | 'none';
export type WoztellCompanionFailureBehavior = 'continue' | 'fail';
export type WoztellCompanionMessageType =
	| 'text'
	| 'image'
	| 'video'
	| 'audio'
	| 'file'
	| 'sticker'
	| 'location'
	| 'contacts'
	| 'reaction'
	| 'template'
	| 'interactiveReplyButtons'
	| 'interactiveList'
	| 'locationRequest';
export type PendingStoreBackend = PendingCompanionStoreBackend;
export type ReplyHandlingMode = CompanionReplyHandlingMode;

export type PendingWoztellHitlRecord = PendingCompanionHitlRecord;

interface BaseSendContext {
	channelId: string;
	recipientId: string;
	deliveryMode: WoztellHitlDeliveryMode;
	messagePrefix?: string;
	title?: string;
	outboundMessageMode?: OutboundMessageMode;
	maxOutboundCharacters?: number;
	fallbackMessage?: string;
	companionMessageType?: WoztellCompanionMessageType;
	companionPayload?: Record<string, unknown>;
	companionFailureBehavior?: WoztellCompanionFailureBehavior;
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
