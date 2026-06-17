import { ApplicationError, type IDataObject, type IExecuteFunctions } from 'n8n-workflow';

import { HITL_CONTRACT_VERSION } from '../../../hitl/contract';
import type { HitlInteractionRecord, HitlInteractionStore } from '../../../hitl/interactionStore';
import type { ISessionMemory } from '../../../types';
import type { ApprovalHandler } from '../../../permissions';
import type { AskUserQuestionArray, NotificationChannel } from '../../../notifications/types';
import type { SendChunkFn } from '../../../streaming/types';
import { toQuestionFormDefinition } from '../../../../ClaudeAgentChannelShared/core/webhookRuntime';

import { processMessages } from '../messages';
import type { ExecuteTaskResult } from '../types';
import { resolveTranscriptWorkingDirectory } from '../sessionDirectory';
import type { InvocationObservabilityCollector } from '../observability';
import type { RuntimePendingInteraction, RuntimePendingState } from '../hitlRuntimeState';

interface WaitForPendingInteractionsArgs {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	messages: unknown[];
	backendMode?: 'localCli' | 'managedAgent';
	approvalHandler?: ApprovalHandler;
	approvalConfig: {
		timeoutSeconds: number;
		mode?: 'pauseForApproval' | 'disabled';
		sdkOwnsWaitResume?: boolean;
		handleAskUserQuestion?: boolean;
	};
	approvalNotificationChannel?: NotificationChannel;
	shouldStream: boolean;
	activeSendChunkFn?: SendChunkFn;
	taskDescription: string;
	chatSessionId: string;
	workingDirectory: string;
	mappedWorkingDirectory?: string;
	resumeSessionId?: string;
	sessionMemory?: ISessionMemory;
	hitlResult?: IDataObject;
	hasAuditLogging: boolean;
	executionId?: string;
	runtimePendingState: RuntimePendingState;
	hitlInteractionStore?: HitlInteractionStore;
	observabilityCollector?: InvocationObservabilityCollector;
}

function parseQuestions(interaction: RuntimePendingInteraction): AskUserQuestionArray {
	if (!interaction.questionsBase64) return [];
	try {
		const decoded = Buffer.from(interaction.questionsBase64, 'base64').toString('utf-8');
		const parsed = JSON.parse(decoded);
		return Array.isArray(parsed) ? (parsed as AskUserQuestionArray) : [];
	} catch {
		return [];
	}
}

function buildPendingHitlBasePayload(args: {
	interaction: RuntimePendingInteraction;
	taskDescription: string;
	chatSessionId: string;
	hitlResult?: IDataObject;
}): IDataObject {
	const { interaction, taskDescription, chatSessionId, hitlResult } = args;
	const createdAt = new Date(interaction.createdAt).toISOString();
	return {
		version: HITL_CONTRACT_VERSION,
		type: interaction.kind === 'approval' ? 'approval_request' : 'question_request',
		requestId: interaction.requestId,
		streamKey: interaction.streamKey,
		sessionId: interaction.sessionId || undefined,
		createdAt,
		approvedFingerprints: interaction.approvedFingerprintsBase64 || undefined,
		task: taskDescription,
		status: 'waiting_for_approval',
		chatSessionId: chatSessionId || undefined,
		...(hitlResult ? { hitl_result: hitlResult, agent_sdk_result: hitlResult } : {}),
	};
}

function buildPendingApprovalRequest(args: {
	basePayload: IDataObject;
	interaction: RuntimePendingInteraction;
}): IDataObject {
	const { basePayload, interaction } = args;
	const toolName = interaction.toolName || 'unknown';
	const toolInput = (interaction.toolInput ?? {}) as IDataObject;
	const serializedInput = JSON.stringify(toolInput, null, 2);
	return {
		...basePayload,
		responseType: 'approval',
		message: `Claude wants to use ${toolName}.\n\n${serializedInput}`,
		toolName,
		toolInput,
		fingerprint: interaction.fingerprint,
	};
}

function buildQuestionPrompt(questions: AskUserQuestionArray): string {
	return (
		questions.map((question) => question.question).join('\n') ||
		'Please answer the pending question.'
	);
}

function resolveQuestionSummary(args: {
	hitlResult?: IDataObject;
	assistantSummaryFallback?: string;
}): string {
	const { hitlResult, assistantSummaryFallback } = args;
	const hitlSummary = typeof hitlResult?.summary === 'string' ? hitlResult.summary.trim() : '';
	const fallbackSummary = assistantSummaryFallback?.trim() ?? '';
	return hitlSummary || fallbackSummary;
}

function buildPendingQuestionRequest(args: {
	basePayload: IDataObject;
	interaction: RuntimePendingInteraction;
	hitlResult?: IDataObject;
	assistantSummaryFallback?: string;
}): IDataObject {
	const { basePayload, interaction, hitlResult, assistantSummaryFallback } = args;
	const questions = parseQuestions(interaction);
	const questionPrompt = buildQuestionPrompt(questions);
	const summary = resolveQuestionSummary({ hitlResult, assistantSummaryFallback });
	return {
		...basePayload,
		responseType: 'customForm',
		message: summary ? `${summary}\n\n${questionPrompt}` : questionPrompt,
		questions,
	};
}

function buildPendingHitlRequest(args: {
	interaction: RuntimePendingInteraction;
	taskDescription: string;
	chatSessionId: string;
	hitlResult?: IDataObject;
	assistantSummaryFallback?: string;
}): IDataObject {
	const { interaction, taskDescription, chatSessionId, hitlResult, assistantSummaryFallback } =
		args;
	const basePayload = buildPendingHitlBasePayload({
		interaction,
		taskDescription,
		chatSessionId,
		hitlResult,
	});

	if (interaction.kind === 'approval') {
		return buildPendingApprovalRequest({ basePayload, interaction });
	}

	return buildPendingQuestionRequest({
		basePayload,
		interaction,
		hitlResult,
		assistantSummaryFallback,
	});
}

function scanPendingInteractions(args: {
	runtimePendingState: RuntimePendingState;
	executionId?: string;
	approvalConfig: WaitForPendingInteractionsArgs['approvalConfig'];
	messages: unknown[];
	observabilityCollector?: InvocationObservabilityCollector;
}): RuntimePendingInteraction[] {
	const { runtimePendingState, executionId, approvalConfig, messages, observabilityCollector } =
		args;
	const pendingInteractions = runtimePendingState.getPendingForExecution(executionId);
	observabilityCollector?.record({
		eventType: 'hitl.pending.scan',
		status: pendingInteractions.length > 0 ? 'pending' : 'none',
		payload: {
			pendingCount: pendingInteractions.length,
			executionId,
		},
	});
	console.log(
		`[Claude Agent SDK] waitForPendingInteractions — pendingCount=${pendingInteractions.length}, mode=${approvalConfig.mode}, handleAskUserQuestion=${approvalConfig.handleAskUserQuestion}, executionId=${executionId}, messageCount=${messages.length}`,
	);
	return pendingInteractions;
}

async function syncPendingSessionMetadata(args: {
	execFunctions: IExecuteFunctions;
	backendMode: 'localCli' | 'managedAgent';
	executionSessionId?: string;
	runtimePendingState: RuntimePendingState;
	approvalHandler: ApprovalHandler;
	taskDescription: string;
	executionId?: string;
	chatSessionId: string;
	sessionMemory?: ISessionMemory;
	workingDirectory: string;
	mappedWorkingDirectory?: string;
	previousResumeSessionId?: string;
}): Promise<void> {
	const {
		execFunctions,
		backendMode,
		executionSessionId,
		runtimePendingState,
		approvalHandler,
		taskDescription,
		executionId,
		chatSessionId,
		sessionMemory,
		workingDirectory,
		mappedWorkingDirectory,
		previousResumeSessionId,
	} = args;

	if (!executionSessionId) {
		return;
	}

	runtimePendingState.enrichPendingWithSession({
		sessionId: executionSessionId,
		originalTaskBase64: Buffer.from(taskDescription).toString('base64'),
		approvedFingerprintsBase64: approvalHandler.serializeApprovedFingerprints(),
		executionId,
	});

	if (!chatSessionId || !sessionMemory) {
		return;
	}

	if (backendMode === 'managedAgent') {
		try {
			const nodeName = execFunctions.getNode().name.replace(/\s+/g, '_');
			await sessionMemory.touch(chatSessionId, nodeName, {
				managedAgentSessionId: executionSessionId,
			});
		} catch (error) {
			// eslint-disable-next-line no-console
			console.warn(
				`[Claude Agent SDK] Managed session memory touch failed (non-fatal): ${(error as Error).message}`,
			);
		}
		return;
	}

	if (executionSessionId === chatSessionId) {
		const nodeName = execFunctions.getNode().name.replace(/\s+/g, '_');
		const mappingWorkingDirectory = resolveTranscriptWorkingDirectory({
			defaultWorkingDirectory: workingDirectory,
			mappedWorkingDirectory,
			resumeSessionId: previousResumeSessionId,
			executionSessionId,
		});
		await sessionMemory.touch(chatSessionId, nodeName, {
			workingDirectory: mappingWorkingDirectory,
		});
		return;
	}

	// eslint-disable-next-line no-console
	console.warn(
		`[Claude Agent SDK] Session drift before HITL wait: expected ${chatSessionId.slice(0, 8)}... ` +
			`but execution produced ${executionSessionId.slice(0, 8)}.... ` +
			'Clearing deterministic session memory entry to force re-bootstrap.',
	);
	if (typeof sessionMemory.forget === 'function') {
		await sessionMemory.forget(chatSessionId);
	}
}

function buildInteractionRecord(args: {
	interaction: RuntimePendingInteraction;
	chatSessionId: string;
}): HitlInteractionRecord {
	const { interaction, chatSessionId } = args;
	const baseRecord = {
		requestId: interaction.requestId,
		status: 'pending' as const,
		createdAt: interaction.createdAt,
		timeoutMs: interaction.timeoutMs,
		executionId: interaction.executionId,
		chatSessionId: chatSessionId || undefined,
		sessionId: interaction.sessionId,
		streamKey: interaction.streamKey,
		originalTaskBase64: interaction.originalTaskBase64,
		approvedFingerprints: interaction.approvedFingerprintsBase64,
		resumeSessionAt: interaction.resumeSessionAt,
	};

	if (interaction.kind === 'approval') {
		return {
			...baseRecord,
			kind: 'approval',
			fingerprint: interaction.fingerprint,
			toolName: interaction.toolName,
			toolInput: interaction.toolInput,
		};
	}

	return {
		...baseRecord,
		kind: 'question',
		questions: parseQuestions(interaction),
	};
}

async function persistPendingInteractions(args: {
	pendingInteractions: RuntimePendingInteraction[];
	hitlInteractionStore?: HitlInteractionStore;
	chatSessionId: string;
}): Promise<void> {
	const { pendingInteractions, hitlInteractionStore, chatSessionId } = args;
	if (!hitlInteractionStore) {
		return;
	}

	for (const interaction of pendingInteractions) {
		await hitlInteractionStore.saveInteraction(
			buildInteractionRecord({
				interaction,
				chatSessionId,
			}),
		);
	}
}

function assertSinglePendingInteraction(args: {
	pendingInteractions: RuntimePendingInteraction[];
	observabilityCollector?: InvocationObservabilityCollector;
}): void {
	const { pendingInteractions, observabilityCollector } = args;
	if (pendingInteractions.length <= 1) {
		return;
	}

	observabilityCollector?.record({
		eventType: 'hitl.pending.error',
		status: 'multiple_pending',
		level: 'error',
		payload: {
			pendingCount: pendingInteractions.length,
		},
	});
	const pendingSummary = pendingInteractions
		.map((interaction) => `${interaction.kind}:${interaction.requestId}`)
		.join(', ');
	throw new ApplicationError(
		`Multiple pending HITL interactions detected in a single execution (${pendingSummary}). ` +
			'Durable companion dispatch expects one active interaction. ' +
			'Please ensure the agent pauses after the first pending AskUserQuestion/approval.',
	);
}

function resolveSdkOwnsWaitResume(args: {
	backendMode: 'localCli' | 'managedAgent';
	approvalConfig: WaitForPendingInteractionsArgs['approvalConfig'];
}): boolean {
	const { backendMode, approvalConfig } = args;
	return backendMode === 'managedAgent' ? true : approvalConfig.sdkOwnsWaitResume !== false;
}

function resolveWaitDeadline(args: {
	latestInteraction?: RuntimePendingInteraction;
	timeoutSeconds: number;
}): { timeoutMs: number; waitTill: Date } {
	const { latestInteraction, timeoutSeconds } = args;
	const timeoutMs = latestInteraction?.timeoutMs || timeoutSeconds * 1000;
	const waitTill =
		timeoutMs <= 0 ? new Date('3000-01-01T00:00:00.000Z') : new Date(Date.now() + timeoutMs);
	return { timeoutMs, waitTill };
}

async function putExecutionToWaitIfOwned(args: {
	execFunctions: IExecuteFunctions;
	sdkOwnsWaitResume: boolean;
	waitTill: Date;
	latestInteraction?: RuntimePendingInteraction;
	timeoutMs: number;
	observabilityCollector?: InvocationObservabilityCollector;
}): Promise<void> {
	const {
		execFunctions,
		sdkOwnsWaitResume,
		waitTill,
		latestInteraction,
		timeoutMs,
		observabilityCollector,
	} = args;

	if (!sdkOwnsWaitResume) {
		return;
	}

	observabilityCollector?.record({
		eventType: 'hitl.wait.enter',
		status: 'waiting',
		payload: {
			requestId: latestInteraction?.requestId,
			interactionKind: latestInteraction?.kind,
			timeoutMs,
		},
	});
	await execFunctions.putExecutionToWait(waitTill);
}

async function notifyApprovalInteraction(args: {
	interaction: RuntimePendingInteraction;
	approvalHandler: ApprovalHandler;
	approvalNotificationChannel: NotificationChannel;
	waitTill: Date;
}): Promise<void> {
	const { interaction, approvalHandler, approvalNotificationChannel, waitTill } = args;
	const approvalUrls = approvalHandler.createApprovalUrls(
		interaction.requestId,
		interaction.fingerprint || '',
		interaction.originalTaskBase64 || '',
		interaction.sessionId || '',
		interaction.resumeSessionAt || undefined,
		interaction.streamKey,
	);
	await approvalNotificationChannel.sendApproval({
		requestId: interaction.requestId,
		toolName: interaction.toolName || 'unknown',
		toolInput: interaction.toolInput || {},
		approveUrl: approvalUrls.approveUrl,
		denyUrl: approvalUrls.denyUrl,
		expiresAt: waitTill.toISOString(),
		sessionId: interaction.sessionId || undefined,
	});
}

async function notifyQuestionInteraction(args: {
	interaction: RuntimePendingInteraction;
	approvalHandler: ApprovalHandler;
	approvalNotificationChannel: NotificationChannel;
	waitTill: Date;
}): Promise<void> {
	const { interaction, approvalHandler, approvalNotificationChannel, waitTill } = args;
	const questions = parseQuestions(interaction);
	const formQuestions = toQuestionFormDefinition(questions);
	const questionUrl = approvalHandler.createQuestionUrl(
		interaction.requestId,
		interaction.originalTaskBase64 || '',
		interaction.sessionId || '',
		formQuestions,
		interaction.resumeSessionAt || undefined,
		interaction.streamKey,
	);
	await approvalNotificationChannel.sendQuestion({
		requestId: interaction.requestId,
		questions,
		responseUrl: questionUrl,
		expiresAt: waitTill.toISOString(),
		sessionId: interaction.sessionId || undefined,
	});
}

async function sendDeferredHitlNotifications(args: {
	pendingInteractions: RuntimePendingInteraction[];
	approvalHandler: ApprovalHandler;
	approvalNotificationChannel?: NotificationChannel;
	waitTill: Date;
}): Promise<void> {
	const { pendingInteractions, approvalHandler, approvalNotificationChannel, waitTill } = args;
	if (!approvalNotificationChannel) {
		return;
	}

	for (const interaction of pendingInteractions) {
		if (interaction.notifiedImmediately) continue;
		try {
			if (interaction.kind === 'approval') {
				await notifyApprovalInteraction({
					interaction,
					approvalHandler,
					approvalNotificationChannel,
					waitTill,
				});
				continue;
			}

			await notifyQuestionInteraction({
				interaction,
				approvalHandler,
				approvalNotificationChannel,
				waitTill,
			});
		} catch (notifyError) {
			console.warn(
				'[Claude Agent SDK] Failed to emit deferred HITL notification:',
				(notifyError as Error).message,
			);
		}
	}
}

function closeActiveStreamIfNeeded(args: {
	shouldStream: boolean;
	activeSendChunkFn?: SendChunkFn;
	itemIndex: number;
}): void {
	const { shouldStream, activeSendChunkFn, itemIndex } = args;
	if (shouldStream && activeSendChunkFn) {
		activeSendChunkFn('end', itemIndex);
	}
}

function buildPendingInteractionResult(args: {
	interaction: RuntimePendingInteraction;
	itemIndex: number;
	taskDescription: string;
	chatSessionId: string;
	hitlResult?: IDataObject;
	assistantSummaryFallback?: string;
	hasAuditLogging: boolean;
	observabilityCollector?: InvocationObservabilityCollector;
}): ExecuteTaskResult {
	const {
		interaction,
		itemIndex,
		taskDescription,
		chatSessionId,
		hitlResult,
		assistantSummaryFallback,
		hasAuditLogging,
		observabilityCollector,
	} = args;

	if (hitlResult && observabilityCollector) {
		hitlResult.observability =
			observabilityCollector.toTaskResultObservability() as unknown as IDataObject;
	}
	const pendingRequest = buildPendingHitlRequest({
		interaction,
		taskDescription,
		chatSessionId,
		hitlResult,
		assistantSummaryFallback,
	});
	observabilityCollector?.record({
		eventType: 'hitl.request.returned',
		status: interaction.kind,
		payload: {
			requestId: interaction.requestId,
		},
	});

	return {
		returnData: {
			json: pendingRequest,
			pairedItem: { item: itemIndex },
		},
		auditLogData: [],
		hasAuditLogging,
		agentError: undefined,
	};
}

export async function waitForPendingInteractions(
	args: WaitForPendingInteractionsArgs,
): Promise<ExecuteTaskResult | null> {
	const {
		execFunctions,
		itemIndex,
		backendMode = 'localCli',
		messages,
		approvalHandler,
		approvalConfig,
		approvalNotificationChannel,
		shouldStream,
		activeSendChunkFn,
		taskDescription,
		chatSessionId,
		workingDirectory,
		mappedWorkingDirectory,
		resumeSessionId: previousResumeSessionId,
		sessionMemory,
		hitlResult,
		hasAuditLogging,
		executionId,
		runtimePendingState,
		hitlInteractionStore,
		observabilityCollector,
	} = args;

	if (!approvalHandler) {
		return null;
	}

	let pendingInteractions = scanPendingInteractions({
		runtimePendingState,
		executionId,
		approvalConfig,
		messages,
		observabilityCollector,
	});
	if (pendingInteractions.length === 0) {
		return null;
	}

	const processed = processMessages(messages);
	const executionSessionId = processed.sessionId;
	const assistantSummaryFallback = processed.textMessages.join('\n').trim();

	await syncPendingSessionMetadata({
		execFunctions,
		backendMode,
		executionSessionId,
		runtimePendingState,
		approvalHandler,
		taskDescription,
		executionId,
		chatSessionId,
		sessionMemory,
		workingDirectory,
		mappedWorkingDirectory,
		previousResumeSessionId,
	});

	pendingInteractions = runtimePendingState.getPendingForExecution(executionId);
	if (pendingInteractions.length === 0) {
		return null;
	}

	await persistPendingInteractions({
		pendingInteractions,
		hitlInteractionStore,
		chatSessionId,
	});
	assertSinglePendingInteraction({
		pendingInteractions,
		observabilityCollector,
	});

	// Pause-for-approval mode: the SDK node owns the wait/resume cycle.
	// When companion loopback mode is enabled, the companion node owns wait/resume
	// and SDK must only emit the strict HITL request payload.
	// Managed agents MUST use SDK-owned wait/resume — there is no companion
	// loopback implementation for managed HITL yet. Without putExecutionToWait,
	// the execution row is persisted as finished and webhook-waiting returns 409.
	const sdkOwnsWaitResume = resolveSdkOwnsWaitResume({ backendMode, approvalConfig });
	const latestInteraction = pendingInteractions[pendingInteractions.length - 1];
	if (!latestInteraction) {
		return null;
	}
	const { timeoutMs, waitTill } = resolveWaitDeadline({
		latestInteraction,
		timeoutSeconds: approvalConfig.timeoutSeconds,
	});
	await putExecutionToWaitIfOwned({
		execFunctions,
		sdkOwnsWaitResume,
		waitTill,
		latestInteraction,
		timeoutMs,
		observabilityCollector,
	});
	await sendDeferredHitlNotifications({
		pendingInteractions,
		approvalHandler,
		approvalNotificationChannel,
		waitTill,
	});
	closeActiveStreamIfNeeded({
		shouldStream,
		activeSendChunkFn,
		itemIndex,
	});

	return buildPendingInteractionResult({
		interaction: latestInteraction,
		itemIndex,
		taskDescription,
		chatSessionId,
		hitlResult,
		assistantSummaryFallback,
		hasAuditLogging,
		observabilityCollector,
	});
}
