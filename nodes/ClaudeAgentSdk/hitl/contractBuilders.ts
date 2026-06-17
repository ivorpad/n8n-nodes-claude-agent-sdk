import { ApplicationError } from 'n8n-workflow';

import {
	HITL_CONTRACT_VERSION,
	type HitlApprovalResponseEnvelope,
	type HitlQuestionResponseEnvelope,
	type HitlResponseEnvelope,
	type HitlResponderIdentity,
} from './contractTypes';
import { parseHitlResponseEnvelope } from './contractParsers';

function createDecisionId(requestId: string, decisionId?: string): string {
	if (decisionId && decisionId.trim().length > 0) {
		return decisionId;
	}
	return `${requestId}:${Date.now()}`;
}

export function buildHitlApprovalResponseEnvelope(args: {
	requestId: string;
	approved: boolean;
	channel: string;
	decisionId?: string;
	decidedAt?: string;
	resumeSessionId?: string;
	resumeSessionAt?: string;
	approvedFingerprints?: string;
	streamingRequestId?: string;
	streamKey?: string;
	fingerprint?: string;
	permissionModeOverride?: string;
	responder?: HitlResponderIdentity;
	reviewerMessage?: string;
	updatedInput?: Record<string, unknown>;
}): HitlApprovalResponseEnvelope {
	const decidedAt = args.decidedAt ?? new Date().toISOString();
	return {
		version: HITL_CONTRACT_VERSION,
		type: 'approval_response',
		requestId: args.requestId,
		decisionId: createDecisionId(args.requestId, args.decisionId),
		decidedAt,
		channel: args.channel,
		approved: args.approved,
		resumeSessionId: args.resumeSessionId,
		resumeSessionAt: args.resumeSessionAt,
		approvedFingerprints: args.approvedFingerprints,
		streamingRequestId: args.streamingRequestId,
		streamKey: args.streamKey,
		responder: args.responder,
		fingerprint: args.fingerprint,
		permissionModeOverride: args.permissionModeOverride,
		reviewerMessage: args.reviewerMessage,
		updatedInput: args.updatedInput,
	};
}

export function buildHitlQuestionResponseEnvelope(args: {
	requestId: string;
	answers: Record<string, string | string[]>;
	channel: string;
	decisionId?: string;
	decidedAt?: string;
	resumeSessionId?: string;
	resumeSessionAt?: string;
	approvedFingerprints?: string;
	streamingRequestId?: string;
	streamKey?: string;
	responseAction?: 'resume' | 'complete';
	responder?: HitlResponderIdentity;
}): HitlQuestionResponseEnvelope {
	if (!args.answers || Object.keys(args.answers).length === 0) {
		throw new ApplicationError('answers must be a non-empty object for question_response');
	}

	const decidedAt = args.decidedAt ?? new Date().toISOString();
	return {
		version: HITL_CONTRACT_VERSION,
		type: 'question_response',
		requestId: args.requestId,
		decisionId: createDecisionId(args.requestId, args.decisionId),
		decidedAt,
		channel: args.channel,
		answers: args.answers,
		resumeSessionId: args.resumeSessionId,
		resumeSessionAt: args.resumeSessionAt,
		approvedFingerprints: args.approvedFingerprints,
		streamingRequestId: args.streamingRequestId,
		streamKey: args.streamKey,
		responseAction: args.responseAction,
		responder: args.responder,
	};
}

export function buildEngineHitlResponseEnvelope(args: {
	interactionKind: 'approval' | 'question';
	requestId: string;
	rawPayload: unknown;
	actionId?: string;
	sessionId: string;
	approvedFingerprints?: string;
	channel?: string;
}): HitlResponseEnvelope {
	const { requestId, rawPayload } = args;

	// Engine callback responses must provide strict v1.0 envelopes.
	const strict = parseHitlResponseEnvelope(rawPayload);
	if (strict.ok) {
		if (strict.value.requestId !== requestId) {
			throw new ApplicationError(
				`Invalid HITL response payload: requestId mismatch (expected "${requestId}", got "${strict.value.requestId}")`,
			);
		}
		return strict.value;
	}

	throw new ApplicationError(
		'Invalid HITL tool response payload: expected strict HITL v1.0 response envelope',
	);
}
