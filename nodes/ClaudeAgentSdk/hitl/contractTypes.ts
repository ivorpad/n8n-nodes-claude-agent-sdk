export const HITL_CONTRACT_VERSION = '1.0' as const;

type HitlRequestType = 'approval_request' | 'question_request';
type HitlResponseType = 'approval_response' | 'question_response';

export interface HitlQuestionOption {
	label: string;
	description?: string;
	value?: string;
	preview?: string;
	action?: 'resume' | 'complete';
}

export interface HitlQuestionDefinition {
	question: string;
	header?: string;
	options?: HitlQuestionOption[];
	multiSelect?: boolean;
}

export interface HitlRequestBase {
	version?: typeof HITL_CONTRACT_VERSION;
	type: HitlRequestType;
	requestId: string;
	streamKey?: string;
	sessionId?: string;
	createdAt?: string;
	approvedFingerprints?: string;
	message?: string;
	responseType?: string;
	hitl_result?: Record<string, unknown>;
	agent_sdk_result?: Record<string, unknown>;
}

export interface HitlResponderIdentity {
	id: string;
	source: string;
	authMode: 'basicAuth' | 'headerAuth' | 'jwtAuth';
}

export interface HitlApprovalRequestEnvelope extends HitlRequestBase {
	type: 'approval_request';
	toolName?: string;
	toolInput?: Record<string, unknown>;
	fingerprint?: string;
}

export interface HitlQuestionRequestEnvelope extends HitlRequestBase {
	type: 'question_request';
	questions?: HitlQuestionDefinition[];
	formFields?: Array<Record<string, unknown>>;
}

export type HitlRequestEnvelope =
	| HitlApprovalRequestEnvelope
	| HitlQuestionRequestEnvelope;

interface HitlResponseBase {
	version: typeof HITL_CONTRACT_VERSION;
	type: HitlResponseType;
	requestId: string;
	decisionId: string;
	decidedAt: string;
	channel: string;
	originalTask?: string;
	resumeSessionId?: string;
	resumeSessionAt?: string;
	approvedFingerprints?: string;
	streamingRequestId?: string;
	streamKey?: string;
	responder?: HitlResponderIdentity;
}

export interface HitlApprovalResponseEnvelope extends HitlResponseBase {
	type: 'approval_response';
	approved: boolean;
	fingerprint?: string;
	permissionModeOverride?: string;
	reviewerMessage?: string;
	updatedInput?: Record<string, unknown>;
}

export interface HitlQuestionResponseEnvelope extends HitlResponseBase {
	type: 'question_response';
	answers: Record<string, string | string[]>;
	responseAction?: 'resume' | 'complete';
}

export type HitlResponseEnvelope =
	| HitlApprovalResponseEnvelope
	| HitlQuestionResponseEnvelope;
