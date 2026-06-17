import { ApplicationError, type EngineResponse, type IExecuteFunctions } from 'n8n-workflow';
import type { NodeQueryOptions } from '../../../sdk/types';

import { createApprovalHandler, ApprovalHandler } from '../../../permissions/ApprovalHandler';
import { parseApprovalConfig } from '../../../permissions/approvalProperties';
import type { OperatorPolicy } from '../../../permissions/policy';
import {
	applyHitlResponse,
	resolveCanonicalResumeSessionId,
	type HitlResponseState,
} from './hitlResponseApplication';
import {
	extractEngineHitlResponse,
	extractWebhookHitlResponse,
	readTaskDescriptionBase64FromHitlMetadata,
	toRecord,
} from './hitlResumeSources';
import type { PendingHitlResolution } from '../types';
import type { InvocationObservabilityCollector } from '../observability';

interface InteractiveApprovalsResult {
	approvalConfig: ReturnType<typeof parseApprovalConfig>;
	approvalHandler?: ApprovalHandler;
	isApprovalResume: boolean;
	executionPrompt?: string;
	pendingResumeSessionAt?: string;
	pendingStreamKey?: string;
	pendingStreamingRequestId?: string;
	pendingQuestionResponse?: {
		requestId: string;
		answers: Record<string, string | string[]>;
	};
	pendingApprovalResolution?: PendingHitlResolution;
	taskDescription: string;
	resumeSessionId?: string;
}

interface SetupInteractiveApprovalsArgs {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	permissionMode: string;
	queryOptions: NodeQueryOptions;
	taskDescription: string;
	backendMode?: 'localCli' | 'managedAgent';
	chatSessionId?: string;
	resumeSessionId?: string;
	engineResponse?: EngineResponse;
	executionId?: string;
	operatorPolicy?: OperatorPolicy;
	observabilityCollector?: InvocationObservabilityCollector;
}

function recoverTaskDescriptionFromEngineMetadata(
	state: HitlResponseState,
	engineResponse: EngineResponse | undefined,
): void {
	if (!engineResponse?.metadata) return;
	if (state.taskDescription && state.taskDescription.trim() !== '') return;

	const taskDescriptionBase64 = readTaskDescriptionBase64FromHitlMetadata(engineResponse.metadata);
	if (taskDescriptionBase64) {
		state.taskDescription = Buffer.from(taskDescriptionBase64, 'base64').toString('utf-8');
	}
}

function applyEngineHitlResponse(args: {
	engineResponse: EngineResponse;
	state: HitlResponseState;
	queryOptions: NodeQueryOptions;
	approvalConfig: ReturnType<typeof parseApprovalConfig>;
	backendMode: 'localCli' | 'managedAgent';
	chatSessionId?: string;
	approvalHandler?: ApprovalHandler;
	operatorPolicy?: OperatorPolicy;
	observabilityCollector?: InvocationObservabilityCollector;
}): void {
	args.observabilityCollector?.record({
		eventType: 'hitl.resume.source',
		status: 'engine_response',
	});
	applyHitlResponse({
		hitlResponse: extractEngineHitlResponse(args.engineResponse),
		state: args.state,
		queryOptions: args.queryOptions,
		approvalConfig: args.approvalConfig,
		backendMode: args.backendMode,
		chatSessionId: args.chatSessionId,
		approvalHandler: args.approvalHandler,
		operatorPolicy: args.operatorPolicy,
		observabilityCollector: args.observabilityCollector,
	});
}

function extractWebhookResumeSource(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	backendMode: 'localCli' | 'managedAgent';
	chatSessionId?: string;
	resumeSessionId?: string;
}) {
	const inputData = args.execFunctions.getInputData();
	const rawResumeData = toRecord(inputData?.[args.itemIndex]?.json);
	if (!rawResumeData) return undefined;

	return extractWebhookHitlResponse({
		rawResumeData,
		fallbackResumeSessionId: resolveCanonicalResumeSessionId({
			backendMode: args.backendMode,
			chatSessionId: args.chatSessionId,
			currentResumeSessionId: args.resumeSessionId,
			incomingSessionId: args.resumeSessionId,
		}),
	});
}

function applyWebhookHitlResponse(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	state: HitlResponseState;
	queryOptions: NodeQueryOptions;
	approvalConfig: ReturnType<typeof parseApprovalConfig>;
	backendMode: 'localCli' | 'managedAgent';
	chatSessionId?: string;
	approvalHandler?: ApprovalHandler;
	operatorPolicy?: OperatorPolicy;
	observabilityCollector?: InvocationObservabilityCollector;
}): void {
	try {
		const resumeSource = extractWebhookResumeSource({
			execFunctions: args.execFunctions,
			itemIndex: args.itemIndex,
			backendMode: args.backendMode,
			chatSessionId: args.chatSessionId,
			resumeSessionId: args.state.resumeSessionId,
		});
		if (!resumeSource) return;

		args.observabilityCollector?.record({
			eventType: 'hitl.resume.source',
			status: resumeSource.source,
		});
		applyHitlResponse({
			hitlResponse: resumeSource.response,
			state: args.state,
			queryOptions: args.queryOptions,
			approvalConfig: args.approvalConfig,
			backendMode: args.backendMode,
			chatSessionId: args.chatSessionId,
			approvalHandler: args.approvalHandler,
			operatorPolicy: args.operatorPolicy,
			observabilityCollector: args.observabilityCollector,
		});
	} catch (error) {
		if (error instanceof ApplicationError) {
			throw error;
		}
		// No resume data or non-resume input item.
	}
}

function applyAvailableHitlResponse(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	state: HitlResponseState;
	queryOptions: NodeQueryOptions;
	approvalConfig: ReturnType<typeof parseApprovalConfig>;
	backendMode: 'localCli' | 'managedAgent';
	chatSessionId?: string;
	approvalHandler?: ApprovalHandler;
	engineResponse?: EngineResponse;
	operatorPolicy?: OperatorPolicy;
	observabilityCollector?: InvocationObservabilityCollector;
}): void {
	if (args.engineResponse) {
		applyEngineHitlResponse({
			...args,
			engineResponse: args.engineResponse,
		});
		return;
	}

	applyWebhookHitlResponse(args);
}

export async function setupInteractiveApprovals(
	args: SetupInteractiveApprovalsArgs,
): Promise<InteractiveApprovalsResult> {
	const {
		execFunctions,
		itemIndex,
		permissionMode,
		queryOptions,
		engineResponse,
		backendMode = 'localCli',
		chatSessionId,
		operatorPolicy,
		observabilityCollector,
	} = args;
	const state: HitlResponseState = {
		taskDescription: args.taskDescription,
		resumeSessionId: args.resumeSessionId,
		isApprovalResume: false,
	};

	const approvalConfig = parseApprovalConfig(
		(name, idx, def) => execFunctions.getNodeParameter(name, idx, def),
		itemIndex,
	);

	let approvalHandler: ApprovalHandler | undefined;

	recoverTaskDescriptionFromEngineMetadata(state, engineResponse);

	if (approvalConfig.enabled && permissionMode === 'default') {
		approvalHandler = createApprovalHandler(execFunctions, itemIndex, {
			approvalMatchMode: approvalConfig.approvalMatchMode,
		});

		applyAvailableHitlResponse({
			execFunctions,
			itemIndex,
			state,
			queryOptions,
			approvalConfig,
			backendMode,
			chatSessionId,
			approvalHandler,
			engineResponse,
			operatorPolicy,
			observabilityCollector,
		});
	}

	if (!state.taskDescription || state.taskDescription.trim() === '') {
		throw new ApplicationError(
			'Task Description is required. Please provide a description of the task for Claude to execute.',
		);
	}

	return {
		approvalConfig,
		approvalHandler,
		isApprovalResume: state.isApprovalResume,
		executionPrompt: state.executionPrompt,
		pendingResumeSessionAt: state.pendingResumeSessionAt,
		pendingStreamKey: state.pendingStreamKey,
		pendingStreamingRequestId: state.pendingStreamingRequestId,
		pendingQuestionResponse: state.pendingQuestionResponse,
		pendingApprovalResolution: state.pendingApprovalResolution,
		taskDescription: state.taskDescription,
		resumeSessionId: state.resumeSessionId,
	};
}
