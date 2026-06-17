import type {
	HitlApprovalRequestEnvelope,
	HitlQuestionRequestEnvelope,
} from '../ClaudeAgentSdk/hitl/contract';
import type {
	PendingCompanionHitlRecord,
} from '../ClaudeAgentChannelShared/core/types';

export type OutboundMessageMode = 'asIs' | 'trim' | 'none';
export type PendingSlackHitlRecord = PendingCompanionHitlRecord;

interface BaseSendContext {
	channelId: string;
	messagePrefix?: string;
	title?: string;
	outboundMessageMode?: OutboundMessageMode;
	maxOutboundCharacters?: number;
	fallbackMessage?: string;
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
