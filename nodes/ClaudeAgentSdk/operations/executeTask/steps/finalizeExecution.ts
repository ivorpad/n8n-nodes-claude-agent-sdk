/**
 * Post-execution phase for executeTask: message processing, structured-output
 * validation, agent-error detection, HITL pending handling, session metadata
 * persistence, managed generated-file fan-out, and final return assembly.
 */

import type { IDataObject, IExecuteFunctions, INodeExecutionData, EngineRequest } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';

import type { ISessionMemory } from '../../../types';
import type { NotificationChannel } from '../../../notifications/types';
import type { SharedExecutionState } from '../../../permissions/canUseToolCallback';
import type { AuditLogEntry } from '../../../permissions/types';
import type { ApprovalConfig } from '../../../permissions/approvalProperties';
import type { ApprovalHandler } from '../../../permissions/ApprovalHandler';
import { flushDurableSendChunk, getSendChunkFn } from '../../../streaming';
import type { StreamStoreHandle } from '../../../streaming';
import type { HitlInteractionStore } from '../../../hitl/interactionStore';
import { validateStructuredOutputValue } from '../../../schema';
import { injectManagedHitlInteraction } from '../../../managedAgent/hitlBridge';
import type { ManagedHitlMetadata } from '../../../managedAgent/hitlBridge';

import type { ExecuteTaskResult, ExecutionResult, ProcessedMessages } from '../types';
import type { NodeQueryOptions } from '../../../sdk/types';
import { processMessages, detectAgentError } from '../messages';
import { persistSessionMetadata, bindManagedGeneratedFiles } from './sessionPersistence';
import { buildTaskResultCore } from './resultAssembly';
import type { SecretsRedactor } from '../secretsRedaction';
import type { RuntimePendingState } from '../hitlRuntimeState';
import { waitForPendingInteractions } from './pendingInteractions';
import { InvocationObservabilityCollector } from '../observability';
import type { ObservabilityPersistenceStatus } from '../observabilityPostgres';
import { resolveDurableFullSessionContent } from './fullSessionContent';
import {
	STRUCTURED_OUTPUT_RETRY_EXHAUSTED,
	STRUCTURED_OUTPUT_RETRY_EXHAUSTED_MESSAGE,
	formatStopDetailsForError,
	getRequestedStructuredOutputSchema,
	type StructuredOutputFailureMode,
} from '../executeTaskHelpers';

function normalizedNodeName(execFunctions: IExecuteFunctions): string {
	return execFunctions.getNode().name.replace(/\s+/g, '_') || 'default';
}

async function persistDurableFullSession(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	chatSessionId: string;
	claudeConfigDirectory: string;
	interactionExecutionId: string;
	executionSessionId: string | undefined;
	resumeSessionId: string | undefined;
	sessionMemory: ISessionMemory | undefined;
	persistSessionEnabled: boolean;
	secretRedactor: SecretsRedactor;
	taskResultCore: IDataObject;
	processed: ProcessedMessages;
}): Promise<void> {
	const {
		execFunctions,
		itemIndex,
		chatSessionId,
		claudeConfigDirectory,
		interactionExecutionId,
		executionSessionId,
		resumeSessionId,
		sessionMemory,
		persistSessionEnabled,
		secretRedactor,
		taskResultCore,
		processed,
	} = args;
	const durablePersistence = persistSessionEnabled ? sessionMemory?.durablePersistence : undefined;
	if (!durablePersistence) {
		return;
	}

	const fallbackMessages = Array.isArray(taskResultCore.messages)
		? taskResultCore.messages
		: [];
	const fullSessionContent = resolveDurableFullSessionContent({
		claudeConfigDirectory,
		sessionIds: [chatSessionId, executionSessionId, resumeSessionId],
		fallbackMessages,
		secretRedactor,
	});

	await durablePersistence.persistFullSession({
		context: {
			workflowId: execFunctions.getWorkflow?.()?.id,
			nodeName: execFunctions.getNode().name,
			executionId: interactionExecutionId,
			itemIndex,
			chatSessionId: chatSessionId || undefined,
			sessionId: executionSessionId,
		},
		sessionContent: fullSessionContent.sessionContent,
		messageCount: fullSessionContent.messageCount,
		totalInputTokens: processed.executionUsage?.usage.inputTokens,
		totalOutputTokens: processed.executionUsage?.usage.outputTokens,
		parentNodeName: normalizedNodeName(execFunctions),
	});
}

export interface FinalizeExecutionArgs {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	backendMode: 'localCli' | 'managedAgent';
	isManagedAgent: boolean;
	chatSessionId: string;
	claudeConfigDirectory: string;
	workingDirectory: string;
	mappedWorkingDirectory: string | undefined;
	taskDescription: string;
	queryOptions: NodeQueryOptions;
	model: string;
	allowedTools: string[];
	effectivePermissionMode: string;
	treatAgentErrorsAsWorkflowErrors: boolean;
	structuredOutputFailureMode: StructuredOutputFailureMode;
	secretRedactor: SecretsRedactor;
	observabilityCollector: InvocationObservabilityCollector;
	sharedState: SharedExecutionState;
	getAuditLogFn: (() => AuditLogEntry[]) | undefined;
	hasAuditLogging: boolean;
	executionResult: ExecutionResult;
	approvalConfig: ApprovalConfig;
	approvalHandler: ApprovalHandler | undefined;
	approvalNotificationChannel: NotificationChannel | undefined;
	shouldStream: boolean;
	activeSendChunkFn: ReturnType<typeof getSendChunkFn> | undefined;
	durableStreamKey: string | undefined;
	durableStreamStoreHandle: StreamStoreHandle | undefined;
	hitlInteractionStore: HitlInteractionStore | undefined;
	runtimePendingState: RuntimePendingState;
	interactionExecutionId: string;
	resumeSessionId: string | undefined;
	sessionMemory: ISessionMemory | undefined;
	persistSessionEnabled: boolean;
	managedAgentResumeSessionId: string | undefined;
	onExecutionSessionId: (sessionId: string | undefined) => void;
	flushObservability: (
		terminalStatus: ObservabilityPersistenceStatus,
		options?: { allowFailure?: boolean },
	) => Promise<void>;
	persistObservabilityMetadata: () => void;
	releaseSessionExecutionLockIfNeeded: () => Promise<void>;
	closeHitlInteractionStoreIfNeeded: () => Promise<void>;
	closeDurableStreamStoreIfNeeded: () => Promise<void>;
}

export async function finalizeExecution(args: FinalizeExecutionArgs): Promise<ExecuteTaskResult | EngineRequest> {
	const {
		execFunctions,
		itemIndex,
		backendMode,
		isManagedAgent,
		chatSessionId,
		claudeConfigDirectory,
		workingDirectory,
		mappedWorkingDirectory,
		taskDescription,
		queryOptions,
		model,
		allowedTools,
		effectivePermissionMode,
		treatAgentErrorsAsWorkflowErrors,
		structuredOutputFailureMode,
		secretRedactor,
		observabilityCollector,
		sharedState,
		getAuditLogFn,
		hasAuditLogging,
		executionResult,
		approvalConfig,
		approvalHandler,
		approvalNotificationChannel,
		shouldStream,
		activeSendChunkFn,
		durableStreamKey,
		durableStreamStoreHandle,
		hitlInteractionStore,
		runtimePendingState,
		interactionExecutionId,
		resumeSessionId,
		sessionMemory,
		persistSessionEnabled,
		managedAgentResumeSessionId,
		onExecutionSessionId,
		flushObservability,
		persistObservabilityMetadata,
		releaseSessionExecutionLockIfNeeded,
		closeHitlInteractionStoreIfNeeded,
		closeDurableStreamStoreIfNeeded,
	} = args;

	const { messages, textMessages, latestTodos, latestTasks, messageTypeCounts } = executionResult;
	let finalText = '';
	let agentError: ExecuteTaskResult['agentError'];

		// ─────────────────────────────────────────────────────────────────────────────
		// 12. Process messages and detect errors
		// ─────────────────────────────────────────────────────────────────────────────

			const processed = processMessages(messages, secretRedactor);
			const executionSessionId = processed.sessionId;
			onExecutionSessionId(executionSessionId);
		finalText = secretRedactor.redactString(textMessages.join('\n'));
		const requestedStructuredOutputSchema = getRequestedStructuredOutputSchema(queryOptions);
		const structuredOutputRetryExhausted = processed.resultSubtype === STRUCTURED_OUTPUT_RETRY_EXHAUSTED;
		let structuredOutputValidationError: string | undefined;

		if (requestedStructuredOutputSchema && processed.rawStructuredOutputResult !== undefined) {
			const validationResult = validateStructuredOutputValue(
				processed.rawStructuredOutputResult,
				requestedStructuredOutputSchema,
			);

			if (!validationResult.success) {
				structuredOutputValidationError = validationResult.error;
				console.warn(
					`[Claude Agent SDK] Structured output passed SDK but failed node-side validation: ${validationResult.error}`,
				);
				observabilityCollector.record({
					eventType: 'structured_output.post_validation',
					status: 'warning',
					level: 'warn',
					payload: {
						error: validationResult.error,
					},
				});
			}
		}

		if (structuredOutputRetryExhausted) {
			observabilityCollector.record({
				eventType: 'structured_output.retry_exhausted',
				status: structuredOutputFailureMode,
				level: structuredOutputFailureMode === 'throwError' ? 'error' : 'warn',
				payload: {
					failureMode: structuredOutputFailureMode,
					subtype: processed.resultSubtype,
				},
			});

			if (structuredOutputFailureMode === 'throwError') {
				throw new ApplicationError(
					`${STRUCTURED_OUTPUT_RETRY_EXHAUSTED_MESSAGE}. ` +
					'Adjust the schema or select a different "On Structured Output Failure" mode.',
				);
			}
		}

		if (treatAgentErrorsAsWorkflowErrors && processed.terminalReason !== 'tool_deferred') {
			// Canonical result diagnostics first (SDKResultError is_error/errors/
			// subtype), then structured refusal, then regex text heuristics.
			if (processed.resultIsError === true) {
				const detail = processed.resultErrors.length > 0
					? processed.resultErrors.join('; ')
					: `result subtype: ${processed.resultSubtype ?? 'unknown'}`;
				agentError = {
					message: `Claude execution error: ${detail}`,
				};
			} else if (processed.stopReason === 'refusal') {
				agentError = {
					message: `Claude refusal: ${formatStopDetailsForError(processed.stopDetails)}`,
				};
			} else {
				const errorCheck = detectAgentError(finalText);
				if (errorCheck.isError) {
					agentError = {
						message: `Claude tool error: ${errorCheck.errorMessage}`,
					};
				}
			}
		}
		observabilityCollector.record({
			eventType: 'execution.completed',
			status: agentError ? 'agent_error' : 'ok',
			payload: {
				messageTypeCounts,
				todoCount: latestTodos.length,
				taskCount: latestTasks.length,
				...(processed.terminalReason && { terminalReason: processed.terminalReason }),
				...(processed.stopReason && { stopReason: processed.stopReason }),
				hasDeferredToolUse: Boolean(processed.deferredToolUse),
			},
		});
		observabilityCollector.recordToolCalls(processed.toolCalls);
		if (sharedState.n8nMcpEvents?.length) {
			observabilityCollector.recordN8nMcpEvents(sharedState.n8nMcpEvents);
		}
		const auditEntries = getAuditLogFn ? getAuditLogFn() : [];
		observabilityCollector.recordAuditEntries(auditEntries);

		const taskResultCore = buildTaskResultCore({
			taskDescription,
			finalText,
			processed,
			structuredOutputRetryExhausted,
			structuredOutputFailureMode,
			structuredOutputValidationError,
			requestedStructuredOutputSchema,
			executionSessionId,
			chatSessionId,
			queryOptions,
			workingDirectory,
			effectivePermissionMode,
			model,
			allowedTools,
			messages,
			latestTodos,
			latestTasks,
			messageTypeCounts,
			sharedState,
			secretRedactor,
			observabilityCollector,
		});

		// ─────────────────────────────────────────────────────────────────────────────
		// 11b. Managed Agent HITL bridge — inject pending interaction from stream
		// ─────────────────────────────────────────────────────────────────────────────
		// For managed agents, custom tools (ask_user_question) cause the session to
		// pause server-side (requires_action). The bridge scans collected messages,
		// finds the custom_tool_use event, and injects a RuntimePendingInteraction
		// into runtimePendingState so waitForPendingInteractions picks it up.
		let managedHitlMetadata: ManagedHitlMetadata | null = null;
		if (isManagedAgent && approvalConfig.enabled) {
			managedHitlMetadata = injectManagedHitlInteraction({
				messages,
				sessionId: executionSessionId ?? '',
				runtimePendingState,
				executionId: interactionExecutionId,
				streamKey: durableStreamKey,
				taskDescription,
				timeoutMs: (approvalConfig.timeoutSeconds ?? 1800) * 1000,
			});
			if (managedHitlMetadata) {
				observabilityCollector.record({
					eventType: 'managed_hitl.bridge.injected',
					status: 'ok',
					payload: {
						kind: managedHitlMetadata.kind,
						managedSessionId: managedHitlMetadata.managedSessionId,
						customToolUseId: managedHitlMetadata.customToolUseId,
						toolUseId: managedHitlMetadata.toolUseId,
						hasSessionThreadId: Boolean(managedHitlMetadata.sessionThreadId),
					},
				});
			}
		}

		// ─────────────────────────────────────────────────────────────────────────────
		// 11c. Check for pending approvals and emit HITL request payload
		// ─────────────────────────────────────────────────────────────────────────────

		if (approvalConfig.enabled && approvalHandler) {
			const pendingInteractionResult = await waitForPendingInteractions({
				execFunctions,
				itemIndex,
				messages,
				backendMode,
				approvalHandler,
				approvalConfig,
				approvalNotificationChannel,
				shouldStream,
				activeSendChunkFn,
				taskDescription,
				chatSessionId,
				workingDirectory,
				mappedWorkingDirectory,
				resumeSessionId,
				sessionMemory,
				hitlResult: taskResultCore,
				hasAuditLogging,
				executionId: interactionExecutionId,
				runtimePendingState,
				hitlInteractionStore,
				observabilityCollector,
			});

			if (pendingInteractionResult) {
				await flushDurableSendChunk(activeSendChunkFn);
				if (durableStreamStoreHandle && durableStreamKey) {
					await durableStreamStoreHandle.store.markTerminal({
						streamKey: durableStreamKey,
						status: 'paused_hitl',
					});
					observabilityCollector.record({
						eventType: 'stream.status.marked',
						status: 'paused_hitl',
						payload: {
							streamKey: durableStreamKey,
						},
					});
				}
				taskResultCore.observability = observabilityCollector.toTaskResultObservability() as unknown as IDataObject;
				await persistDurableFullSession({
					execFunctions,
					itemIndex,
					chatSessionId,
					claudeConfigDirectory,
					interactionExecutionId,
					executionSessionId,
					resumeSessionId,
					sessionMemory,
					persistSessionEnabled,
					secretRedactor,
					taskResultCore,
					processed,
				});
				await flushObservability('paused_hitl');
				persistObservabilityMetadata();
				await releaseSessionExecutionLockIfNeeded();
				await closeHitlInteractionStoreIfNeeded();
				await closeDurableStreamStoreIfNeeded();
				return pendingInteractionResult;
			}
		}
		taskResultCore.observability = observabilityCollector.toTaskResultObservability() as unknown as IDataObject;

		// Close the NDJSON stream for completed (non-HITL) executions.
		// For HITL cases, 'end' was already sent above before the early return.
		if (shouldStream && activeSendChunkFn) {
			activeSendChunkFn('end', itemIndex);
		}
		await flushDurableSendChunk(activeSendChunkFn);
		if (durableStreamStoreHandle && durableStreamKey) {
			await durableStreamStoreHandle.store.markTerminal({
				streamKey: durableStreamKey,
				status: 'completed',
			});
			observabilityCollector.record({
				eventType: 'stream.status.marked',
				status: 'completed',
				payload: {
					streamKey: durableStreamKey,
				},
			});
		}
		// ─────────────────────────────────────────────────────────────────────────────
		// 13. Persist deterministic session metadata
		// ─────────────────────────────────────────────────────────────────────────────

		await persistSessionMetadata({
			execFunctions,
			isManagedAgent,
			persistSessionEnabled,
			chatSessionId,
			sessionMemory,
			executionSessionId,
			managedAgentResumeSessionId,
			resumeSessionId,
			queryOptions,
			workingDirectory,
			mappedWorkingDirectory,
			observabilityCollector,
		});
		taskResultCore.observability = observabilityCollector.toTaskResultObservability() as unknown as IDataObject;
		await persistDurableFullSession({
			execFunctions,
			itemIndex,
			chatSessionId,
			claudeConfigDirectory,
			interactionExecutionId,
			executionSessionId,
			resumeSessionId,
			sessionMemory,
			persistSessionEnabled,
			secretRedactor,
			taskResultCore,
			processed,
		});

		// ─────────────────────────────────────────────────────────────────────────────
		// 13a. Managed-agent generated files → n8n binary fan-out (success path only)
		// ─────────────────────────────────────────────────────────────────────────────
		const generatedFileAttachments = await bindManagedGeneratedFiles({
			execFunctions,
			itemIndex,
			isManagedAgent,
			processedArtifacts: processed.artifacts,
			taskResultCore,
			observabilityCollector,
		});

		// ─────────────────────────────────────────────────────────────────────────────
		// 13b. Build return data
		// ─────────────────────────────────────────────────────────────────────────────

		const baseResultJson: IDataObject = {
			...taskResultCore,
		};

		let finalResultJson = baseResultJson;
		if (sharedState.outputOverride) {
			const overrideJson = sharedState.outputOverride.json as IDataObject;
			if (sharedState.outputOverride.mode === 'replace') {
				finalResultJson = {
					...overrideJson,
					type: 'task_result',
				};
			} else {
				finalResultJson = {
					...baseResultJson,
					...overrideJson,
				};
			}
		}

		if (secretRedactor.hasSecrets) {
			finalResultJson = secretRedactor.redactUnknown(finalResultJson) as IDataObject;
		}

		const primaryReturnItem: INodeExecutionData = {
			json: finalResultJson,
			pairedItem: { item: itemIndex },
		};

		// Fan out one item per generated file. Each carries the same JSON +
		// one binary at key 'data' (n8n convention). When zero files, output
		// is unchanged: a single primary item with no binary.
		let returnData: INodeExecutionData = primaryReturnItem;
		let extraReturnItems: INodeExecutionData[] | undefined;
		if (generatedFileAttachments.length > 0) {
			const fanOut: INodeExecutionData[] = generatedFileAttachments.map((g) => ({
				json: finalResultJson,
				binary: { data: g.binary },
				pairedItem: { item: itemIndex },
			}));
			returnData = fanOut[0];
			extraReturnItems = fanOut.slice(1);
		}

		// Collect audit log entries
		const auditLogData: INodeExecutionData[] = [];
		for (const entry of auditEntries) {
			auditLogData.push({
				json: (secretRedactor.hasSecrets
					? secretRedactor.redactUnknown(entry)
					: entry) as unknown as IDataObject,
				pairedItem: { item: itemIndex },
			});
		}

		await flushObservability('completed');
		persistObservabilityMetadata();
		await releaseSessionExecutionLockIfNeeded();
		await closeHitlInteractionStoreIfNeeded();
		await closeDurableStreamStoreIfNeeded();
		return {
			returnData,
			extraReturnItems,
			auditLogData,
			hasAuditLogging,
			agentError,
		};
}
