/**
 * Stream transport setup (durable Postgres-backed sendChunk with live/webhook
 * fallbacks) and interactive-approval wiring (HITL store, NDJSON notification
 * channel, canUseTool callback) for executeTask.
 */

import type { IExecuteFunctions } from 'n8n-workflow';

import type { NotificationChannel } from '../../../notifications/types';
import { NdjsonChannel } from '../../../notifications/channels/NdjsonChannel';
import {
	createDurableSendChunk,
	createPostgresStreamStoreHandle,
	getSendChunkFn,
	retrieveRequestResponse,
	touchRequestResponse,
	clearRequestResponse,
	StreamingHandler,
} from '../../../streaming';
import type { StreamStoreHandle } from '../../../streaming';
import type { StreamingConfig } from '../../../streaming/types';
import { createCanUseToolCallback } from '../../../permissions';
import type { SharedExecutionState } from '../../../permissions/canUseToolCallback';
import type { PermissionsConfig } from '../../../permissions/types';
import type { ApprovalConfig } from '../../../permissions/approvalProperties';
import type { ApprovalHandler } from '../../../permissions/ApprovalHandler';
import {
	createHitlInteractionStoreHandle,
	type HitlInteractionStoreHandle,
} from '../../../hitl/interactionStore';
import type { SecretsRedactor } from '../secretsRedaction';
import type { RuntimePendingState } from '../hitlRuntimeState';
import type { PendingHitlResolution } from '../types';
import type { NodeQueryOptions } from '../../../sdk/types';
import { InvocationObservabilityCollector } from '../observability';

type ActiveSendChunkFn = ReturnType<typeof getSendChunkFn> | undefined;

export async function setupStreamTransport(args: {
	execFunctions: IExecuteFunctions;
	shouldStream: boolean;
	durableStreamKey: string | undefined;
	pendingStreamKey: string | undefined;
	pendingStreamingRequestId: string | undefined;
	workflowId: string | undefined;
	interactionExecutionId: string;
	chatSessionId: string;
	secretRedactor: SecretsRedactor;
	observabilityCollector: InvocationObservabilityCollector;
}): Promise<{
	activeSendChunkFn: ActiveSendChunkFn;
	durableStreamStoreHandle: StreamStoreHandle | undefined;
	shouldStream: boolean;
}> {
	const {
		execFunctions,
		durableStreamKey,
		pendingStreamKey,
		pendingStreamingRequestId,
		workflowId,
		interactionExecutionId,
		chatSessionId,
		secretRedactor,
		observabilityCollector,
	} = args;
	let { shouldStream } = args;

	let activeSendChunkFn: ActiveSendChunkFn = shouldStream ? getSendChunkFn(execFunctions) : undefined;
	let durableStreamStoreHandle: StreamStoreHandle | undefined;

	if (shouldStream && durableStreamKey) {
		try {
			durableStreamStoreHandle = await createPostgresStreamStoreHandle({
				execFunctions,
			});
			if (durableStreamStoreHandle) {
				await durableStreamStoreHandle.store.ensureStream({
					streamKey: durableStreamKey,
					status: 'live',
					workflowId: workflowId ? String(workflowId) : undefined,
					executionId: interactionExecutionId,
					chatSessionId: chatSessionId || undefined,
				});
				observabilityCollector.record({
					eventType: 'stream.durable.enabled',
					status: 'postgres',
					payload: {
						streamKey: durableStreamKey,
						executionId: interactionExecutionId,
					},
				});
				activeSendChunkFn = createDurableSendChunk({
					streamStore: durableStreamStoreHandle.store,
					streamKey: durableStreamKey,
					requestId: pendingStreamingRequestId,
					executionId: interactionExecutionId,
					chatSessionId: chatSessionId || undefined,
					workflowId: workflowId ? String(workflowId) : undefined,
					secretRedactor,
					liveSendChunk: activeSendChunkFn,
					responseStore: {
						retrieveRequestResponse,
						touchRequestResponse,
						clearRequestResponse,
					},
					onPersistError: (error) => {
						observabilityCollector.record({
							eventType: 'stream.persist.error',
							status: 'failed',
							level: 'error',
							payload: {
								streamKey: durableStreamKey,
								message: error.message,
							},
						});
					},
				});
			}
		} catch (error) {
			console.warn(
				`[Claude Agent SDK] Durable stream persistence unavailable: ${(error as Error).message}`,
			);
			observabilityCollector.record({
				eventType: 'stream.durable.disabled',
				status: 'init_failed',
				level: 'warn',
				payload: {
					streamKey: durableStreamKey,
					message: (error as Error).message,
				},
			});
			if (durableStreamStoreHandle) {
				const handle = durableStreamStoreHandle;
				durableStreamStoreHandle = undefined;
				try {
					await handle.close();
				} catch (closeError) {
					console.warn(
						`[Claude Agent SDK] Failed to close durable stream store: ${(closeError as Error).message}`,
					);
				}
			}
		}
	}

	// Fallback for webhook-driven resume streaming when Postgres durability is
	// unavailable: write directly to the active response if it still exists.
	if (!durableStreamStoreHandle && pendingStreamKey && durableStreamKey) {
		const storedRes = retrieveRequestResponse(durableStreamKey);
		if (storedRes && !storedRes.writableEnded) {
			const streamKey = durableStreamKey;
			activeSendChunkFn = (type: string, _idx: number, data?: unknown) => {
				if (storedRes.writableEnded) return;
				touchRequestResponse(streamKey);
				if (type === 'begin' || type === 'end') {
					storedRes.write(JSON.stringify({ type }) + '\n');
					if (type === 'end') {
						storedRes.end();
						clearRequestResponse(streamKey);
					}
				} else if (data !== undefined) {
					storedRes.write(JSON.stringify({ type: 'item', content: data }) + '\n');
				}
			};
		} else if (!activeSendChunkFn) {
			shouldStream = false;
			observabilityCollector.record({
				eventType: 'stream.live_response.missing',
				status: 'recoverable',
				level: 'warn',
				payload: {
					streamKey: durableStreamKey,
				},
			});
		}
	}

	return { activeSendChunkFn, durableStreamStoreHandle, shouldStream };
}

export async function setupApprovalWiring(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	approvalConfig: ApprovalConfig;
	approvalHandler: ApprovalHandler | undefined;
	secretRedactor: SecretsRedactor;
	observabilityCollector: InvocationObservabilityCollector;
	activeSendChunkFn: ActiveSendChunkFn;
	streamConfig: StreamingConfig;
	allowedTools: string[];
	queryOptions: NodeQueryOptions;
	permissionsConfig: PermissionsConfig;
	allBlockedTools: string[];
	resumeSessionId: string | undefined;
	chatSessionId: string;
	taskDescription: string;
	workingDirectory: string;
	interactionExecutionId: string;
	sharedState: SharedExecutionState;
	runtimePendingState: RuntimePendingState;
	pendingQuestionResponse: { requestId: string; answers: Record<string, string | string[]> } | undefined;
	pendingApprovalResolution: PendingHitlResolution | undefined;
	durableStreamKey: string | undefined;
}): Promise<{
	approvalNotificationChannel: NotificationChannel | undefined;
	hitlInteractionStoreHandle: HitlInteractionStoreHandle | undefined;
}> {
	const {
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
	} = args;

	// Notification channel for HITL payloads. Deferred sends in
	// waitForPendingInteractions run AFTER putExecutionToWait() (409-safe).
	// The same channel may also be passed as immediateNotificationChannel for
	// early NDJSON preview during canUseTool; see AGENTS.md / hitl-learnings.md.
	let approvalNotificationChannel: NotificationChannel | undefined;
	let hitlInteractionStoreHandle: HitlInteractionStoreHandle | undefined;

	if (approvalConfig.enabled && approvalHandler) {
		hitlInteractionStoreHandle = await createHitlInteractionStoreHandle({
			ctx: execFunctions,
			secretRedactor,
		});
		observabilityCollector.record({
			eventType: 'hitl.store.enabled',
			status: hitlInteractionStoreHandle.backend,
			payload: {
				backend: hitlInteractionStoreHandle.backend,
			},
		});

		// Build in-stream notification channel (NDJSON only).
		// External notification channels (Webhook, Slack) are now handled by
		// the dedicated channel nodes (Claude Agent Slack/Telegram/...) when they receive the approval request.
		if (activeSendChunkFn) {
			const streamHandler = new StreamingHandler(streamConfig, activeSendChunkFn, itemIndex);
			approvalNotificationChannel = new NdjsonChannel(streamHandler);
		}

		// When HITL handles AskUserQuestion, remove it from allowedTools so the
		// SDK actually calls canUseToolCallback instead of auto-approving it.
		// See: HITL-LEARNINGS — "AskUserQuestion allowedTools bypass" root cause.
		if (approvalConfig.handleAskUserQuestion) {
			const idx = allowedTools.indexOf('AskUserQuestion');
			if (idx >= 0) {
				allowedTools.splice(idx, 1);
				if (allowedTools.length > 0) {
					queryOptions.allowedTools = allowedTools;
				} else {
					delete queryOptions.allowedTools;
				}
				console.log('[Claude Agent SDK] Removed AskUserQuestion from allowedTools — HITL canUseToolCallback will intercept it.');
			}
		}

		const canUseToolCallback = createCanUseToolCallback({
			approvalHandler,
			approvalConfig,
			streamKey: durableStreamKey,
			runtimePendingState,
			interactionStore: hitlInteractionStoreHandle.store,
			pendingQuestionResponse,
			pendingApprovalResolution,
			permissionsConfig,
			allowedTools,
			blockedTools: allBlockedTools,
			sessionId: resumeSessionId || chatSessionId || '',
			originalTask: taskDescription,
			workingDirectory: (queryOptions.cwd as string) || workingDirectory || '.',
			executionId: interactionExecutionId,
			sharedState,
			// Emit approval notifications immediately into the NDJSON stream
			// so channel/webhook UIs can render buttons without waiting.
			immediateNotificationChannel: approvalNotificationChannel,
		});

		queryOptions.canUseTool = canUseToolCallback;
	}

	return { approvalNotificationChannel, hitlInteractionStoreHandle };
}
