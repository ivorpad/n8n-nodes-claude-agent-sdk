import type {
	HitlApprovalRequestEnvelope,
	HitlQuestionRequestEnvelope,
} from '../ClaudeAgentSdk/hitl/contract';
import type {
	CompanionReplyHandlingMode,
	PendingCompanionHitlRecord,
	PendingCompanionStoreBackend,
} from '../ClaudeAgentChannelShared/core/types';

export type OutboundMessageMode = 'asIs' | 'trim' | 'none';
export type PendingStoreBackend = PendingCompanionStoreBackend;
export type ReplyHandlingMode = CompanionReplyHandlingMode;

export type PendingTelegramHitlRecord = PendingCompanionHitlRecord;

interface BaseSendContext {
	chatId: string;
	messagePrefix?: string;
	title?: string;
	outboundMessageMode?: OutboundMessageMode;
	maxOutboundCharacters?: number;
	fallbackMessage?: string;
}

export interface SendMessageResult {
	providerMessageId?: string;
}

export interface ApprovalSendContext extends BaseSendContext {
	request: HitlApprovalRequestEnvelope;
	approveUrl: string;
	denyUrl: string;
}

export interface QuestionSendContext extends BaseSendContext {
	request: HitlQuestionRequestEnvelope;
	responseUrl: string;
}
