import type {
	HitlApprovalRequestEnvelope,
	HitlQuestionRequestEnvelope,
} from '../ClaudeAgentSdk/hitl/contract';
import type {
	PendingCompanionHitlRecord,
} from '../ClaudeAgentChannelShared/core/types';

export type OutboundMessageMode = 'asIs' | 'trim' | 'none';
export type PendingGmailHitlRecord = PendingCompanionHitlRecord;

interface BaseSendContext {
	toEmail: string;
	fromEmail: string;
	subjectPrefix?: string;
	messagePrefix?: string;
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
