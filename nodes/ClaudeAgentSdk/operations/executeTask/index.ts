/**
 * Execute Agent Task Operation Handler
 *
 * This module orchestrates the execution of Claude agent tasks.
 * The implementation is split across focused modules:
 * - types.ts - Type definitions
 * - subagents.ts - Subagent configuration
 * - config.ts - Query configuration builders
 * - messages.ts - Message processing
 * - execution.ts - Streaming/non-streaming execution loops
 */

import type { IExecuteFunctions, EngineRequest } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';

import {
	parseApprovalConfig,
	parseOperatorPolicyFromEnv,
	applyOperatorSandboxPolicy,
} from '../../permissions';
import type { SharedExecutionState } from '../../permissions/canUseToolCallback';
import type { AuditLogEntry } from '../../permissions/types';
import {
	buildDurableStreamKey,
	flushDurableSendChunk,
	parseStreamingConfig,
	isStreamingAvailable,
	getSendChunkFn,
} from '../../streaming';
import { parseSandboxConfig } from '../../sandbox';

// Local module imports
import type { ExecuteTaskOptions, ExecuteTaskResult } from './types';
import { buildSubagents } from './subagents';
import { buildQuerySetup } from './steps/querySetup';
import { setupInteractiveApprovals } from './steps/interactiveApprovals';
import { runAgentExecution } from './steps/runExecution';
import { finalizeExecution } from './steps/finalizeExecution';
import { setupStreamTransport, setupApprovalWiring } from './steps/streamAndApprovalWiring';
import { wireToolingAndHooks } from './steps/toolingWiring';
import { createExecutionLifecycle } from './steps/executionLifecycle';
import {
	fetchSessionMemory,
	resolveSessionState,
	wireManagedResumeToolConfirmation,
	wireManagedResumeToolResult,
} from './steps/sessionResolve';
import { prepareCoreParams } from './steps/prepareCore';
import { createSecretsRedactor, collectSecretsForRedaction, resolveMcpHeaderAuthSecrets } from './secretsRedaction';
import { resolveClaudeConfigDirectory } from './sessionDirectory';
import { createRuntimePendingState } from './hitlRuntimeState';

import {
	shouldForceIncludePartialMessagesForStreaming,
	parseStructuredOutputFailureMode,
	resolveExecutionScope,
	setObservabilityMetadata,
} from './executeTaskHelpers';

/**
 * Execute the executeTask operation
 */
export async function executeTaskOperation(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	options: ExecuteTaskOptions,
): Promise<ExecuteTaskResult | EngineRequest> {
	const {
		adapter,
		authMethod,
		backendMode = 'localCli',
		secureEnv,
		sdkModule,
	} = options;
	const resolvedAuthMethod = authMethod ?? 'apiCredentials';
	// The mcpHeaderAuthApi bearer token is injected into MCP HTTP/SSE requests
	// later (buildMcpServersConfig), but must be redacted from every sink —
	// resolve the underlying credential value now, at redactor build.
	const mcpHeaderAuthValues = await resolveMcpHeaderAuthSecrets(execFunctions, itemIndex);
	const secretRedactor = createSecretsRedactor(
		collectSecretsForRedaction({ ...options, mcpHeaderAuthValues }),
	);
	const operatorPolicy = parseOperatorPolicyFromEnv();
	const preflightApprovalConfig = parseApprovalConfig(
		(name, idx, def) => execFunctions.getNodeParameter(name, idx, def),
		itemIndex,
	);


	// ─────────────────────────────────────────────────────────────────────────────
	// 1. Validate and extract core parameters (+ binary-input preprocessing)
	// ─────────────────────────────────────────────────────────────────────────────

	const core = await prepareCoreParams({ execFunctions, itemIndex, backendMode, secretRedactor });
	const {
		chatSessionId,
		workingDirectory,
		node,
		workflowId,
		observabilityPersistenceConfig,
		observabilityCollector,
	} = core;
	let taskDescription = core.taskDescription;

	// ─────────────────────────────────────────────────────────────────────────────
	// 2. Session memory handling
	// ─────────────────────────────────────────────────────────────────────────────

	const sessionMemory = await fetchSessionMemory(execFunctions);

	// Session memory tracks deterministic session existence + metadata.
	// chatSessionId is the canonical Claude session ID for both new runs and resume.
	// When persistSession is false, skip session memory entirely — sessions cannot be resumed.
	const earlyAdditionalOptions = execFunctions.getNodeParameter('additionalOptions', itemIndex, {}) as {
		persistSession?: boolean;
		claudeConfigDir?: string;
	};
	const persistSessionEnabled = earlyAdditionalOptions.persistSession !== false;
	const claudeConfigDirectory = resolveClaudeConfigDirectory(earlyAdditionalOptions.claudeConfigDir);
	let resumeSessionId: string | undefined;
	let managedAgentResumeSessionId: string | undefined;
	const isManagedAgent = backendMode === 'managedAgent';
	let mappedWorkingDirectory: string | undefined;
	let sharedState: SharedExecutionState = {};
	let getAuditLogFn: (() => AuditLogEntry[]) | undefined;
	let activeSendChunkFn = undefined as ReturnType<typeof getSendChunkFn> | undefined;
	let shouldStream = false;
	let durableStreamKey: string | undefined;

	const lifecycle = createExecutionLifecycle({
		execFunctions,
		itemIndex,
		workflowId,
		nodeName: node.name,
		chatSessionId,
		observabilityCollector,
		observabilityPersistenceConfig,
		getDurableStreamKey: () => durableStreamKey,
	});
	const {
		buildObservabilityMetadata,
		flushObservability,
		releaseSessionExecutionLockIfNeeded,
		closeDurableStreamStoreIfNeeded,
		closeHitlInteractionStoreIfNeeded,
	} = lifecycle;

	try {
		const sessionResolution = await resolveSessionState({
			chatSessionId,
			persistSessionEnabled,
			isManagedAgent,
			sessionMemory,
			claudeConfigDirectory,
			observabilityCollector,
		});
		resumeSessionId = sessionResolution.resumeSessionId;
		managedAgentResumeSessionId = sessionResolution.managedAgentResumeSessionId;
		mappedWorkingDirectory = sessionResolution.mappedWorkingDirectory;
		lifecycle.state.releaseSessionExecutionLock = sessionResolution.releaseSessionExecutionLock;


		// ─────────────────────────────────────────────────────────────────────────────
		// 3. Build subagents
		// ─────────────────────────────────────────────────────────────────────────────

		const agents = buildSubagents(execFunctions, itemIndex);

		// ─────────────────────────────────────────────────────────────────────────────
		// 4-6. Build query options (params, env, prompts, cancel hooks)
		// ─────────────────────────────────────────────────────────────────────────────

		const {
			allowedTools,
			permissionMode,
			model,
			additionalDirectories,
			additionalOptions,
			correlationId,
			treatAgentErrorsAsWorkflowErrors,
			queryOptions,
			stderrOutput,
		} = await buildQuerySetup({
			execFunctions,
			itemIndex,
			options,
			resolvedAuthMethod,
			workingDirectory,
			chatSessionId,
			sessionMemory,
			resumeSessionId,
			agents,
			operatorPolicy,
			hitlEnabled: preflightApprovalConfig.enabled,
		});
		// buildQuerySetup already applied the operator-policy clamp and the
		// HITL-enabled downgrade (and synced queryOptions), so the returned mode
		// is the effective one. Kept as a named binding for downstream readers.
		const effectivePermissionMode = permissionMode;

		// For managed agent backend: thread resume session ID through query options
		// so ManagedAgentAdapter.promptOnce can pick it up.
		if (isManagedAgent && managedAgentResumeSessionId) {
			queryOptions.managedAgentResumeSessionId = managedAgentResumeSessionId;
		}
		observabilityCollector.updateContext({
			correlationId,
		});
		const structuredOutputFailureMode = parseStructuredOutputFailureMode(execFunctions, itemIndex);
		lifecycle.state.observabilityCorrelationId = correlationId;
		observabilityCollector.record({
			eventType: 'query.setup.complete',
			status: 'ok',
			payload: {
				permissionMode: effectivePermissionMode,
				model: model || undefined,
				allowedToolCount: allowedTools.length,
				isResume: Boolean(resumeSessionId),
			},
		});

		// Fail fast: HITL requires session persistence for resume
		if (!persistSessionEnabled && preflightApprovalConfig.enabled) {
			throw new ApplicationError(
				'Interactive Approvals (HITL) requires session persistence. ' +
				'Either enable "Persist Session" in Additional Options, or disable Interactive Approvals.',
			);
		}

		// Shared state for callbacks and in-process MCP tools.
		sharedState = {};
		const runtimePendingState = createRuntimePendingState();

		const { executionId, interactionExecutionId } = resolveExecutionScope(
			execFunctions,
			itemIndex,
			observabilityCollector,
		);
		lifecycle.state.interactionExecutionIdForPersistence = interactionExecutionId;

		// ─────────────────────────────────────────────────────────────────────────────
		// 7-8a. Wire MCP servers, blocked tools, and permission/AGT/webhook hooks
		// ─────────────────────────────────────────────────────────────────────────────

		const tooling = await wireToolingAndHooks({
			execFunctions,
			itemIndex,
			node,
			secureEnv,
			sdkModule,
			backendMode,
			sharedState,
			queryOptions,
			workingDirectory,
			chatSessionId,
			effectivePermissionMode,
			allowedTools,
			agents,
			executionId,
			correlationId,
			interactionExecutionId,
			additionalOptions,
			additionalDirectories,
			operatorPolicy,
		});
		const { allBlockedTools, permissionsConfig, hasAuditLogging } = tooling;
		getAuditLogFn = tooling.getAuditLogFn;

		// ─────────────────────────────────────────────────────────────────────────────
		// 8b. Parse interactive approval settings and process resume data
		// ─────────────────────────────────────────────────────────────────────────────

		const {
			approvalConfig,
			approvalHandler,
			isApprovalResume,
			executionPrompt,
			pendingStreamKey,
			pendingStreamingRequestId,
			pendingQuestionResponse,
			pendingApprovalResolution,
			taskDescription: resolvedTaskDescription,
			resumeSessionId: resolvedResumeSessionId,
		} = await setupInteractiveApprovals({
			execFunctions,
			itemIndex,
			permissionMode: effectivePermissionMode,
			queryOptions,
			taskDescription,
			backendMode,
			chatSessionId,
			resumeSessionId,
			engineResponse: options.engineResponse,
			operatorPolicy,
			observabilityCollector,
		});

		taskDescription = resolvedTaskDescription;
		resumeSessionId = resolvedResumeSessionId;
		const promptForExecution = executionPrompt ?? taskDescription;
		durableStreamKey = pendingStreamKey || buildDurableStreamKey({
			executionId: interactionExecutionId,
			itemIndex,
		});

		wireManagedResumeToolResult({
			isManagedAgent,
			isApprovalResume,
			pendingQuestionResponse,
			managedAgentResumeSessionId,
			resumeSessionId,
			queryOptions,
			observabilityCollector,
		});
		wireManagedResumeToolConfirmation({
			isManagedAgent,
			isApprovalResume,
			pendingApprovalResolution,
			managedAgentResumeSessionId,
			resumeSessionId,
			queryOptions,
			observabilityCollector,
		});

		// ─────────────────────────────────────────────────────────────────────────────
		// 9. Parse sandbox configuration
		// ─────────────────────────────────────────────────────────────────────────────

		const parsedSandboxConfig = parseSandboxConfig(execFunctions, itemIndex);
		const sandboxConfig = applyOperatorSandboxPolicy(parsedSandboxConfig, operatorPolicy);
		if (sandboxConfig?.enabled) {
			queryOptions.sandbox = sandboxConfig;
		}

		// ─────────────────────────────────────────────────────────────────────────────
		// 10. Parse streaming configuration
		// ─────────────────────────────────────────────────────────────────────────────

		const streamConfig = parseStreamingConfig(execFunctions, itemIndex);
		const streamingAvailable = isStreamingAvailable(execFunctions);

		shouldStream = streamConfig.enabled && (streamingAvailable || Boolean(pendingStreamKey));

		if (shouldStream && shouldForceIncludePartialMessagesForStreaming(streamConfig)) {
			queryOptions.includePartialMessages = true;
		}

		// ─────────────────────────────────────────────────────────────────────────────
		// 10b. Get sendChunk function
		// ─────────────────────────────────────────────────────────────────────────────

		const streamTransport = await setupStreamTransport({
			execFunctions,
			shouldStream,
			durableStreamKey,
			pendingStreamKey,
			pendingStreamingRequestId,
			workflowId: workflowId ? String(workflowId) : undefined,
			interactionExecutionId,
			chatSessionId,
			secretRedactor,
			observabilityCollector,
		});
		activeSendChunkFn = streamTransport.activeSendChunkFn;
		lifecycle.state.durableStreamStoreHandle = streamTransport.durableStreamStoreHandle;
		shouldStream = streamTransport.shouldStream;

		// ─────────────────────────────────────────────────────────────────────────────
		// 10c. Configure canUseTool callback if interactive approvals are enabled
		// ─────────────────────────────────────────────────────────────────────────────

		const approvalWiring = await setupApprovalWiring({
			execFunctions,
			itemIndex,
			approvalConfig,
			approvalHandler,
			secretRedactor,
			observabilityCollector,
			activeSendChunkFn,
			streamConfig,
			allowedTools,
			queryOptions,
			permissionsConfig,
			allBlockedTools,
			resumeSessionId,
			chatSessionId,
			taskDescription,
			workingDirectory,
			interactionExecutionId,
			sharedState,
			runtimePendingState,
			pendingQuestionResponse,
			pendingApprovalResolution,
			durableStreamKey,
		});
		const approvalNotificationChannel = approvalWiring.approvalNotificationChannel;
		lifecycle.state.hitlInteractionStoreHandle = approvalWiring.hitlInteractionStoreHandle;

		// ─────────────────────────────────────────────────────────────────────────────
		// 11. Execute the agent task
		// ─────────────────────────────────────────────────────────────────────────────

		const executionResult = await runAgentExecution({
			execFunctions,
			itemIndex,
			adapter,
			taskDescription: promptForExecution,
			queryOptions,
			shouldStream,
			activeSendChunkFn,
			streamConfig,
			stderrOutput,
			correlationId,
			streamKey: durableStreamKey,
			sharedState,
			isApprovalResume,
			shouldHaltOnPendingInteraction: () =>
				runtimePendingState.getPendingForExecution(interactionExecutionId).length > 0,
			preventFreshFallbackOnResumeFailure: isApprovalResume,
			suppressReplayStreamingMessages: Boolean(pendingStreamingRequestId),
			observabilityCollector,
			secretRedactor,
		});


		return await finalizeExecution({
			execFunctions,
			itemIndex,
			backendMode,
			isManagedAgent,
			chatSessionId,
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
			durableStreamStoreHandle: lifecycle.state.durableStreamStoreHandle,
			hitlInteractionStore: lifecycle.state.hitlInteractionStoreHandle?.store,
			runtimePendingState,
			interactionExecutionId,
			resumeSessionId,
			sessionMemory,
			persistSessionEnabled,
			managedAgentResumeSessionId,
			onExecutionSessionId: (sessionId: string | undefined) => {
				lifecycle.state.executionSessionIdForPersistence = sessionId;
			},
			flushObservability,
			persistObservabilityMetadata: () => setObservabilityMetadata(execFunctions, buildObservabilityMetadata()),
			releaseSessionExecutionLockIfNeeded,
			closeHitlInteractionStoreIfNeeded,
			closeDurableStreamStoreIfNeeded,
		});
	} catch (error) {
		if (sharedState.n8nMcpEvents?.length) {
			observabilityCollector.recordN8nMcpEvents(sharedState.n8nMcpEvents);
		}
		const auditEntries = getAuditLogFn ? getAuditLogFn() : [];
		if (auditEntries.length > 0) {
			observabilityCollector.recordAuditEntries(auditEntries);
		}
		observabilityCollector.record({
			eventType: 'execute_task.error',
			status: 'failed',
			level: 'error',
			payload: {
				message: error instanceof Error ? error.message : String(error),
			},
		});
		await flushDurableSendChunk(activeSendChunkFn);
		if (lifecycle.state.durableStreamStoreHandle && durableStreamKey) {
			try {
				await lifecycle.state.durableStreamStoreHandle.store.markTerminal({
					streamKey: durableStreamKey,
					status: 'failed',
					errorMessage: error instanceof Error ? error.message : String(error),
				});
				observabilityCollector.record({
					eventType: 'stream.status.marked',
					status: 'failed',
					payload: {
						streamKey: durableStreamKey,
					},
				});
			} catch (streamError) {
				console.warn(
					`[Claude Agent SDK] Failed to mark durable stream as failed: ${(streamError as Error).message}`,
				);
			}
		}
		await flushObservability('failed', { allowFailure: true });
		setObservabilityMetadata(execFunctions, buildObservabilityMetadata());
		await releaseSessionExecutionLockIfNeeded();
		await closeHitlInteractionStoreIfNeeded();
		await closeDurableStreamStoreIfNeeded();
		throw error;
	}
}
