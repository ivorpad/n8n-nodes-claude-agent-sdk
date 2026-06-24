import { ApprovalHandler } from '../../../permissions/ApprovalHandler';
import type { parseApprovalConfig } from '../../../permissions/approvalProperties';
import type { OperatorPolicy } from '../../../permissions/policy';
import { clampPermissionMode } from '../../../permissions/resolvePermissionMode';
import type { HitlApprovalResponseEnvelope, HitlResponseEnvelope } from '../../../hitl/contract';
import type { PendingHitlResolution } from '../types';
import type { NodeQueryOptions } from '../../../sdk/types';
import type { InvocationObservabilityCollector } from '../observability';
import { applyResumeQueryOptions } from './resumeQueryOptions';

type ApprovalConfig = ReturnType<typeof parseApprovalConfig>;
type BackendMode = 'localCli' | 'managedAgent';

export const HITL_APPROVAL_RESUME_PROMPT_MARKER = '<HITL_APPROVAL_RESUME>' as const;
export const HITL_APPROVAL_RESUME_PROMPT = HITL_APPROVAL_RESUME_PROMPT_MARKER;
export const HITL_APPROVAL_RESUME_PROMPT_CLASSIFICATION =
	'control_plane_hitl_approval_resume' as const;

export interface HitlResponseState {
	taskDescription: string;
	resumeSessionId?: string;
	isApprovalResume: boolean;
	executionPrompt?: string;
	executionPromptClassification?: typeof HITL_APPROVAL_RESUME_PROMPT_CLASSIFICATION;
	pendingResumeSessionAt?: string;
	pendingStreamKey?: string;
	pendingStreamingRequestId?: string;
	pendingQuestionResponse?: {
		requestId: string;
		answers: Record<string, string | string[]>;
	};
	pendingApprovalResolution?: PendingHitlResolution;
}

function decodeCanonicalTask(value: string): string {
	try {
		const decoded = Buffer.from(value, 'base64').toString('utf-8');
		const canonicalRoundTrip = Buffer.from(decoded, 'utf-8').toString('base64').replace(/=+$/u, '');
		if (decoded.length > 0 && canonicalRoundTrip === value.replace(/=+$/u, '')) {
			return decoded;
		}
	} catch {
		// Fall back to the raw value below.
	}

	return value;
}

export function resolveCanonicalResumeSessionId(args: {
	backendMode: BackendMode;
	chatSessionId?: string;
	currentResumeSessionId?: string;
	incomingSessionId?: string;
}): string | undefined {
	const incomingSessionId = args.incomingSessionId?.trim();
	const currentResumeSessionId = args.currentResumeSessionId?.trim();

	if (args.backendMode === 'managedAgent') {
		// Managed agents: preserve the real sesn_... session ID from the HITL
		// response envelope. chatSessionId is a user-supplied UUID namespace.
		return incomingSessionId || currentResumeSessionId || undefined;
	}

	const chatSessionId = args.chatSessionId?.trim();
	// CLI: prefer chatSessionId because deterministic sessions are authoritative.
	return chatSessionId || incomingSessionId || undefined;
}

function recordHitlResponseReceived(
	collector: InvocationObservabilityCollector | undefined,
	hitlResponse: HitlResponseEnvelope,
): void {
	collector?.record({
		eventType: 'hitl.response.received',
		status: hitlResponse.type,
		payload: {
			requestId: hitlResponse.requestId,
			channel: hitlResponse.channel,
		},
	});
}

function restoreApprovedFingerprints(
	approvalHandler: ApprovalHandler | undefined,
	approvedFingerprints?: string,
): void {
	if (!approvedFingerprints) return;

	const previousFps = ApprovalHandler.deserializeApprovedFingerprints(approvedFingerprints);
	if (previousFps.length > 0) {
		approvalHandler?.markMultipleApproved(previousFps);
	}
}

function applyCommonHitlResponseState(args: {
	hitlResponse: HitlResponseEnvelope;
	state: HitlResponseState;
	queryOptions: NodeQueryOptions;
	backendMode: BackendMode;
	chatSessionId?: string;
}): void {
	const { hitlResponse, state, queryOptions } = args;

	// Webhook loopback executions arrive with the response envelope string as
	// the node task. Restore the canonical task from the stored interaction so
	// later approvals/questions keep replaying against the real user task.
	if (hitlResponse.originalTask) {
		state.taskDescription = decodeCanonicalTask(hitlResponse.originalTask);
	}

	const canonicalResumeSessionId = resolveCanonicalResumeSessionId({
		backendMode: args.backendMode,
		chatSessionId: args.chatSessionId,
		currentResumeSessionId: state.resumeSessionId,
		incomingSessionId: hitlResponse.resumeSessionId,
	});
	if (canonicalResumeSessionId) {
		state.isApprovalResume = true;
		state.resumeSessionId = canonicalResumeSessionId;
		applyResumeQueryOptions(queryOptions, canonicalResumeSessionId);
	}

	const streamKey = hitlResponse.streamKey || hitlResponse.streamingRequestId;
	if (streamKey) {
		state.pendingStreamKey = streamKey;
		state.pendingStreamingRequestId = streamKey;
	}
}

function applyResumeAnchor(
	state: HitlResponseState,
	queryOptions: NodeQueryOptions,
	resumeSessionAt?: string,
): void {
	if (resumeSessionAt) {
		state.pendingResumeSessionAt = resumeSessionAt;
	}
	if (state.pendingResumeSessionAt && queryOptions.resume) {
		queryOptions.resumeSessionAt = state.pendingResumeSessionAt;
	}
}

function recordApprovalApplied(
	collector: InvocationObservabilityCollector | undefined,
	hitlResponse: HitlApprovalResponseEnvelope,
): void {
	collector?.record({
		eventType: 'hitl.approval.applied',
		status: hitlResponse.approved ? 'approved' : 'denied',
		payload: {
			requestId: hitlResponse.requestId,
			resumeSessionAt: hitlResponse.resumeSessionAt,
			resumeSessionId: hitlResponse.resumeSessionId,
		},
	});
}

function isSdkOwnedPauseForApprovalResume(args: {
	approvalConfig: ApprovalConfig;
	backendMode: BackendMode;
	queryOptions: NodeQueryOptions;
	state: HitlResponseState;
}): boolean {
	return (
		args.state.isApprovalResume &&
		typeof args.queryOptions.resume === 'string' &&
		args.queryOptions.resume.length > 0 &&
		args.approvalConfig.enabled &&
		args.approvalConfig.mode === 'pauseForApproval' &&
		(args.backendMode === 'managedAgent' || args.approvalConfig.sdkOwnsWaitResume !== false)
	);
}

function applyPermissionModeOverride(args: {
	hitlResponse: HitlApprovalResponseEnvelope;
	approvalConfig: ApprovalConfig;
	queryOptions: NodeQueryOptions;
	operatorPolicy?: OperatorPolicy;
}): void {
	const { hitlResponse, approvalConfig, queryOptions } = args;
	if (!hitlResponse.approved) return;
	if (!approvalConfig.allowPermissionModeOverride) return;
	if (!hitlResponse.permissionModeOverride) return;
	if (!approvalConfig.allowedOverrideModes.includes(hitlResponse.permissionModeOverride)) return;

	// Operator policy is a hard constraint applied on top of the workflow's
	// allowedOverrideModes: a forbidden mode (e.g. bypassPermissions) is clamped
	// to 'default' so an approval responder cannot escalate past the operator.
	queryOptions.permissionMode = clampPermissionMode(
		hitlResponse.permissionModeOverride,
		args.operatorPolicy?.allowedPermissionModes,
	);
}

function applyApprovalHitlResponse(args: {
	hitlResponse: HitlApprovalResponseEnvelope;
	state: HitlResponseState;
	queryOptions: NodeQueryOptions;
	approvalConfig: ApprovalConfig;
	backendMode: BackendMode;
	approvalHandler?: ApprovalHandler;
	operatorPolicy?: OperatorPolicy;
	observabilityCollector?: InvocationObservabilityCollector;
}): void {
	const { hitlResponse, state, queryOptions, approvalHandler } = args;

	recordApprovalApplied(args.observabilityCollector, hitlResponse);
	// Set resumeSessionAt for both approve AND deny when present, so the tool
	// call replays through canUseTool on resume.
	applyResumeAnchor(state, queryOptions, hitlResponse.resumeSessionAt);

	// Approval replay is driven by pendingApprovalResolution during canUseTool.
	// Keep the model-facing resume prompt neutral so Claude does not need to
	// reinterpret prior STOP/denial text from conversation history.
	if (
		isSdkOwnedPauseForApprovalResume({
			approvalConfig: args.approvalConfig,
			backendMode: args.backendMode,
			queryOptions,
			state,
		})
	) {
		state.executionPrompt = HITL_APPROVAL_RESUME_PROMPT;
		state.executionPromptClassification = HITL_APPROVAL_RESUME_PROMPT_CLASSIFICATION;
		args.observabilityCollector?.record({
			eventType: 'hitl.approval.resume_prompt',
			status: 'control_plane',
			payload: {
				requestId: hitlResponse.requestId,
				inputClassification: HITL_APPROVAL_RESUME_PROMPT_CLASSIFICATION,
				promptMarker: HITL_APPROVAL_RESUME_PROMPT_MARKER,
			},
		});
	}
	state.pendingApprovalResolution = {
		kind: 'approval',
		requestId: hitlResponse.requestId,
		approved: hitlResponse.approved,
		fingerprint: hitlResponse.fingerprint,
		reviewerMessage: hitlResponse.reviewerMessage,
		updatedInput: hitlResponse.updatedInput,
	};

	if (hitlResponse.approved && hitlResponse.fingerprint) {
		approvalHandler?.markApproved(hitlResponse.fingerprint);
	}

	applyPermissionModeOverride({
		hitlResponse,
		approvalConfig: args.approvalConfig,
		queryOptions,
		operatorPolicy: args.operatorPolicy,
	});
}

function applyQuestionHitlResponse(args: {
	hitlResponse: Exclude<HitlResponseEnvelope, HitlApprovalResponseEnvelope>;
	state: HitlResponseState;
	queryOptions: NodeQueryOptions;
	observabilityCollector?: InvocationObservabilityCollector;
}): void {
	const { hitlResponse, state, queryOptions } = args;

	args.observabilityCollector?.record({
		eventType: 'hitl.question.applied',
		status: 'answered',
		payload: {
			requestId: hitlResponse.requestId,
			answerCount: Object.keys(hitlResponse.answers).length,
			resumeSessionAt: hitlResponse.resumeSessionAt,
		},
	});
	applyResumeAnchor(state, queryOptions, hitlResponse.resumeSessionAt);
	state.pendingQuestionResponse = {
		requestId: hitlResponse.requestId,
		answers: hitlResponse.answers,
	};
}

export function applyHitlResponse(args: {
	hitlResponse: HitlResponseEnvelope;
	state: HitlResponseState;
	queryOptions: NodeQueryOptions;
	approvalConfig: ApprovalConfig;
	backendMode: BackendMode;
	chatSessionId?: string;
	approvalHandler?: ApprovalHandler;
	operatorPolicy?: OperatorPolicy;
	observabilityCollector?: InvocationObservabilityCollector;
}): void {
	const { hitlResponse } = args;

	recordHitlResponseReceived(args.observabilityCollector, hitlResponse);
	restoreApprovedFingerprints(args.approvalHandler, hitlResponse.approvedFingerprints);
	applyCommonHitlResponseState(args);

	if (hitlResponse.type === 'approval_response') {
		applyApprovalHitlResponse({
			...args,
			hitlResponse,
		});
		return;
	}

	applyQuestionHitlResponse({
		hitlResponse,
		state: args.state,
		queryOptions: args.queryOptions,
		observabilityCollector: args.observabilityCollector,
	});
}
