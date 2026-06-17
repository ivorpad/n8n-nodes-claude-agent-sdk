import type { HitlQuestionDefinition } from '../../ClaudeAgentSdk/hitl/contract';

type PendingCompanionInteractionKind = 'approval' | 'question';
type PendingCompanionInteractionStatus = 'pending' | 'consumed';

export interface PendingCompanionHitlRecord {
	requestId: string;
	kind: PendingCompanionInteractionKind;
	status: PendingCompanionInteractionStatus;
	createdAt: number;
	consumedAt?: number;
	consumedDecisionKey?: string;
	timeoutMs: number;
	sessionId?: string;
	approvedFingerprints?: string;
	message?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	fingerprint?: string;
	questions?: HitlQuestionDefinition[];
	agentSdkResult?: Record<string, unknown>;
	channel?: string;
	recipientId?: string;
	providerMessageId?: string;
	providerConversationId?: string;
	providerMetadata?: Record<string, string>;
}

type PendingCompanionConsumeStatus = 'accepted' | 'duplicate' | 'conflict' | 'missing';

export interface PendingCompanionConsumeResult<TRecord extends PendingCompanionHitlRecord> {
	status: PendingCompanionConsumeStatus;
	record?: TRecord;
}

export type PendingCompanionStoreBackend = 'staticData' | 'postgres';

export type CompanionReplyHandlingMode = 'waitForReply' | 'dispatchAndExit';
