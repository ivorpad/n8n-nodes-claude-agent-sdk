import type { HitlQuestionDefinition } from './contractTypes';

type HitlInteractionKind = 'approval' | 'question';
type HitlInteractionStatus = 'pending' | 'answered';
type HitlDecisionStatus = 'accepted' | 'duplicate' | 'conflict' | 'missing';
type HitlStoreBackend = 'staticData' | 'postgres';

interface HitlInteractionBase {
	requestId: string;
	kind: HitlInteractionKind;
	status: HitlInteractionStatus;
	createdAt: number;
	timeoutMs: number;
	executionId?: string;
	chatSessionId?: string;
	sessionId?: string;
	streamKey?: string;
	originalTaskBase64?: string;
	approvedFingerprints?: string;
	resumeSessionAt?: string;
	answeredAt?: number;
	decisionKey?: string;
	decisionId?: string;
	decisionChannel?: string;
}

export interface ApprovalInteractionRecord extends HitlInteractionBase {
	kind: 'approval';
	fingerprint?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	approved?: boolean;
	permissionModeOverride?: string;
	reviewerMessage?: string;
	updatedInput?: Record<string, unknown>;
}

export interface QuestionInteractionRecord extends HitlInteractionBase {
	kind: 'question';
	questions: HitlQuestionDefinition[];
	answers?: Record<string, string | string[]>;
	responseAction?: 'resume' | 'complete';
}

export type HitlInteractionRecord =
	| ApprovalInteractionRecord
	| QuestionInteractionRecord;

export interface ConsumeApprovalDecisionArgs {
	requestId: string;
	decisionKey: string;
	decisionId: string;
	decidedAt: number;
	channel: string;
	approved: boolean;
	fingerprint?: string;
	permissionModeOverride?: string;
	reviewerMessage?: string;
	updatedInput?: Record<string, unknown>;
}

export interface ConsumeQuestionDecisionArgs {
	requestId: string;
	decisionKey: string;
	decisionId: string;
	decidedAt: number;
	channel: string;
	answers: Record<string, string | string[]>;
	responseAction?: 'resume' | 'complete';
}

export interface HitlDecisionResult<TRecord extends HitlInteractionRecord> {
	status: HitlDecisionStatus;
	record?: TRecord;
}

export interface HitlInteractionStore {
	backend: HitlStoreBackend;
	saveInteraction(record: HitlInteractionRecord): Promise<void>;
	getInteraction(requestId: string): Promise<HitlInteractionRecord | undefined>;
	consumeApprovalDecision(args: ConsumeApprovalDecisionArgs): Promise<HitlDecisionResult<ApprovalInteractionRecord>>;
	consumeQuestionDecision(args: ConsumeQuestionDecisionArgs): Promise<HitlDecisionResult<QuestionInteractionRecord>>;
}

export interface HitlInteractionStoreHandle {
	store: HitlInteractionStore;
	backend: HitlStoreBackend;
	close: () => Promise<void>;
}
