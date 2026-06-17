import type { IExecuteFunctions } from 'n8n-workflow';
import type { NodeQueryOptions } from '../../../sdk/types';
import { ApplicationError } from 'n8n-workflow';

import type { QueryHandle, SdkAdapter } from '../../../sdk/types';
import type { StreamingConfig, SendChunkFn, StreamErrorContent } from '../../../streaming/types';
import type { SharedExecutionState } from '../../../permissions/canUseToolCallback';
import { getSendChunkFn } from '../../../streaming';
import type { InvocationObservabilityCollector } from '../observability';
import { NOOP_SECRETS_REDACTOR, type SecretsRedactor } from '../secretsRedaction';

import { executeNonStreaming, executeStreaming } from '../execution';
import type { ExecutionResult } from '../types';

type ResumeRecoveryAction =
	| { kind: 'retry_plain_resume' }
	| { kind: 'retry_fresh' }
	| { kind: 'rethrow' };

/** Sub-reason for fresh-session fallback after a failed resume (observability). */
type ResumeFreshRetryHeuristic =
	| 'invalid_replay_signature'
	| 'session_markers'
	| 'generic_exit_code_1';

function classifyResumeFreshRetry(error: unknown): ResumeFreshRetryHeuristic | null {
	if (!(error instanceof Error)) {
		return null;
	}

	const message = error.message.toLowerCase();

	const nonRetryableMarkers = [
		'usage policy',
		'content policy',
		'does not support tools',
		'invalid api key',
		'unauthorized',
		'permission denied',
	];
	if (nonRetryableMarkers.some((marker) => message.includes(marker))) {
		return null;
	}

	const invalidReplayMarkers = [
		'invalid `signature` in `thinking` block',
		"invalid 'signature' in `thinking` block",
		'invalid `signature` in thinking block',
		'invalid signature in `thinking` block',
		'invalid signature in thinking block',
	];
	if (invalidReplayMarkers.some((marker) => message.includes(marker))) {
		return 'invalid_replay_signature';
	}

	const hasCliFailureSignal =
		message.includes('exited with code 1')
		|| message.includes('bad request - please check your parameters');
	if (!hasCliFailureSignal) {
		return null;
	}

	const retryableMarkers = [
		'session id',
		'session',
		'resume',
		'not found',
		'already in use',
		'bad request',
	];
	if (retryableMarkers.some((marker) => message.includes(marker))) {
		return 'session_markers';
	}

	// NOTE: Surprising SDK/CLI behavior seen in production logs:
	// some failures surface as a generic "exited with code 1" with no stderr.
	// For resume flows, treat this as retryable once unless explicitly non-retryable.
	return 'generic_exit_code_1';
}

function shouldRetryResumeAsFresh(error: unknown): boolean {
	return classifyResumeFreshRetry(error) !== null;
}

function shouldRetryDeterministicSessionBootstrapAsResume(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();
	const hasCliFailureSignal =
		message.includes('exited with code 1')
		|| message.includes('bad request - please check your parameters');
	if (!hasCliFailureSignal) {
		return false;
	}

	return message.includes('session id') && message.includes('already in use');
}

function classifyResumeRecoveryAction(args: {
	error: unknown;
	hasResume: boolean;
	resumeSessionAt: unknown;
	isApprovalResume: boolean;
	preventFreshFallbackOnResumeFailure: boolean;
}): ResumeRecoveryAction {
	const {
		error,
		hasResume,
		resumeSessionAt,
		isApprovalResume,
		preventFreshFallbackOnResumeFailure,
	} = args;

	const isResumeSessionAtLookupFailure = hasResume
		&& typeof resumeSessionAt === 'string'
		&& error instanceof Error
		&& error.message.includes('No message found with message.uuid');
	if (isResumeSessionAtLookupFailure) {
		return { kind: 'retry_plain_resume' };
	}

	const isResumeFailure = hasResume
		&& !isApprovalResume
		&& shouldRetryResumeAsFresh(error);
	if (!isResumeFailure) {
		return { kind: 'rethrow' };
	}

	if (preventFreshFallbackOnResumeFailure) {
		return { kind: 'rethrow' };
	}

	return { kind: 'retry_fresh' };
}

function isEmptyExecutionResult(result: ExecutionResult): boolean {
	return (
		result.messages.length === 0
		&& result.textMessages.length === 0
		&& Object.keys(result.messageTypeCounts).length === 0
	);
}

export async function runAgentExecution(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	adapter: SdkAdapter;
	taskDescription: string;
	queryOptions: NodeQueryOptions;
	shouldStream: boolean;
	activeSendChunkFn?: SendChunkFn;
	streamConfig: StreamingConfig;
	stderrOutput: string[];
	correlationId?: string;
	streamKey?: string;
	sharedState: SharedExecutionState;
	isApprovalResume: boolean;
	shouldHaltOnPendingInteraction?: () => boolean;
	preventFreshFallbackOnResumeFailure?: boolean;
	suppressReplayStreamingMessages?: boolean;
	observabilityCollector?: InvocationObservabilityCollector;
	/** Redacts secrets from assembled error/stderr before throwing. */
	secretRedactor?: SecretsRedactor;
}): Promise<ExecutionResult> {
	const {
		execFunctions,
		itemIndex,
		adapter,
		taskDescription,
		queryOptions,
		shouldStream,
		activeSendChunkFn,
		streamConfig,
		stderrOutput,
		correlationId,
		streamKey,
		sharedState,
		isApprovalResume,
		shouldHaltOnPendingInteraction,
		preventFreshFallbackOnResumeFailure = false,
		suppressReplayStreamingMessages = false,
		observabilityCollector,
		secretRedactor = NOOP_SECRETS_REDACTOR,
	} = args;

	let attempt = 0;
	const executeQuery = async (opts: NodeQueryOptions) => {
		attempt += 1;
		observabilityCollector?.record({
			eventType: 'execution.query.attempt',
			status: 'start',
			payload: {
				attempt,
				hasResume: Boolean(opts.resume),
				hasSessionId: typeof opts.sessionId === 'string',
				hasResumeSessionAt: Boolean(opts.resumeSessionAt),
			},
		});
		const qr: QueryHandle = adapter.promptOnce(taskDescription, opts);

		if (shouldStream) {
			const sendChunkFn = activeSendChunkFn || getSendChunkFn(execFunctions);
			if (!sendChunkFn) {
				throw new ApplicationError('Streaming is enabled but sendChunk function is not available');
			}

			try {
				const result = await executeStreaming({
					execFunctions,
					itemIndex,
					queryResult: qr,
					streamConfig,
					sendChunkFn,
					stderrOutput,
					correlationId,
					streamKey,
					sharedState,
					suppressReplayStreamingMessages,
					shouldHaltOnPendingInteraction,
					secretRedactor,
				});
				observabilityCollector?.record({
					eventType: 'execution.query.attempt',
					status: 'completed',
					payload: {
						attempt,
					},
				});
				return result;
			} catch (streamingError) {
				observabilityCollector?.record({
					eventType: 'execution.streaming.error',
					status: 'failed',
					level: 'error',
					payload: {
						attempt,
						message: streamingError instanceof Error ? streamingError.message : String(streamingError),
					},
				});
				// Emit NDJSON error line + end sentinel so relay doesn't hang
				try {
					const errorPayload: StreamErrorContent = {
						type: 'error',
						source: 'worker',
						itemIndex,
						correlationId,
						message: streamingError instanceof Error ? streamingError.message : 'Unknown streaming error',
						details: streamingError instanceof Error ? {
							name: streamingError.name,
							stack: streamingError.stack?.split('\n').slice(0, 5).join('\n'),
						} : undefined,
					};
					await sendChunkFn('error', itemIndex, errorPayload);
					await sendChunkFn('end', itemIndex);
				} catch {
					// Failed to emit error line on streaming failure
				}
				throw streamingError;
			}
		}

		const result = await executeNonStreaming({
			queryResult: qr,
			stderrOutput,
			shouldHaltOnPendingInteraction,
			secretRedactor,
		});
		observabilityCollector?.record({
			eventType: 'execution.query.attempt',
			status: 'completed',
			payload: {
				attempt,
			},
		});
		return result;
	};

	let executionResult: ExecutionResult;
	const recoverFromResumeError = async (
		error: unknown,
		retrySource: 'initial' | 'bootstrap_resume',
	): Promise<ExecutionResult> => {
		const recoveryAction = classifyResumeRecoveryAction({
			error,
			hasResume: Boolean(queryOptions.resume),
			resumeSessionAt: queryOptions.resumeSessionAt,
			isApprovalResume,
			preventFreshFallbackOnResumeFailure,
		});

		if (recoveryAction.kind === 'retry_plain_resume') {
			observabilityCollector?.record({
				eventType: 'execution.retry.plain_resume',
				status: 'retrying',
				level: 'warn',
				payload: {
					attempt,
					retrySource,
					reason: error instanceof Error ? error.message : String(error),
				},
			});
			console.warn(
				`[Claude Agent SDK] resumeSessionAt lookup failed for session ${String(queryOptions.resume).substring(0, 8)}... — ` +
				`retrying with plain resume. Original error: ${(error as Error).message}`,
			);
			delete queryOptions.resumeSessionAt;
			stderrOutput.length = 0;
			return await executeQuery(queryOptions);
		}

		if (recoveryAction.kind === 'retry_fresh') {
			const resumeFreshHeuristic = classifyResumeFreshRetry(error);
			if (resumeFreshHeuristic === 'generic_exit_code_1') {
				console.warn(
					'[Claude Agent SDK] Resume failed with exit code 1 but no session/resume markers in stderr — ' +
					'falling back to a fresh session. If this was not a transient CLI quirk, the task context was dropped.',
				);
			}
			observabilityCollector?.record({
				eventType: 'execution.retry.fresh_session',
				status: 'retrying',
				level: 'warn',
				payload: {
					attempt,
					retrySource,
					reason: error instanceof Error ? error.message : String(error),
					resumeFreshHeuristic: resumeFreshHeuristic ?? 'unknown',
				},
			});
			const sid = String(queryOptions.resume);
			console.warn(
				`[Claude Agent SDK] Resume failed for session ${sid.substring(0, 8)}... — ` +
				`starting fresh session. Original error: ${(error as Error).message}`,
			);
			delete queryOptions.resume;
			delete queryOptions.sessionId;
			delete queryOptions.resumeSessionAt;
			stderrOutput.length = 0;
			return await executeQuery(queryOptions);
		}

		observabilityCollector?.record({
			eventType: 'execution.retry.none',
			status: 'failed',
			level: 'error',
			payload: {
				attempt,
				retrySource,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
		throw error;
	};

	try {
		executionResult = await executeQuery(queryOptions);
	} catch (firstError) {
		const bootstrapSessionId = typeof queryOptions.sessionId === 'string'
			? queryOptions.sessionId
			: undefined;
		const hasResume = typeof queryOptions.resume === 'string'
			&& (queryOptions.resume as string).length > 0;

		if (
			!hasResume
			&& bootstrapSessionId
			&& shouldRetryDeterministicSessionBootstrapAsResume(firstError)
		) {
			observabilityCollector?.record({
				eventType: 'execution.retry.bootstrap_resume',
				status: 'retrying',
				level: 'warn',
				payload: {
					attempt,
					reason: firstError instanceof Error ? firstError.message : String(firstError),
				},
			});
			console.warn(
				`[Claude Agent SDK] Deterministic session bootstrap collided for ${bootstrapSessionId.substring(0, 8)}... ` +
				'— retrying with resume on the same session ID.',
			);
			queryOptions.resume = bootstrapSessionId;
			delete queryOptions.sessionId;
			delete queryOptions.resumeSessionAt;
			stderrOutput.length = 0;
			try {
				executionResult = await executeQuery(queryOptions);
			} catch (bootstrapResumeError) {
				executionResult = await recoverFromResumeError(bootstrapResumeError, 'bootstrap_resume');
			}
		} else {
			executionResult = await recoverFromResumeError(firstError, 'initial');
		}
	}

	// tool_deferred is a valid terminal state — the SDK deferred a tool for
	// external handling. Do not treat it as empty or failed.
	if (executionResult.terminalReason === 'tool_deferred') {
		observabilityCollector?.record({
			eventType: 'execution.return',
			status: 'ok',
			payload: {
				attempts: attempt,
				messageCount: executionResult.messages.length,
				terminalReason: 'tool_deferred',
			},
		});
		return executionResult;
	}

	if (isEmptyExecutionResult(executionResult)) {
		const hadResume = typeof queryOptions.resume === 'string' && (queryOptions.resume as string).length > 0;

		if (hadResume && !isApprovalResume && !preventFreshFallbackOnResumeFailure) {
			observabilityCollector?.record({
				eventType: 'execution.retry.empty_stream_fresh',
				status: 'retrying',
				level: 'warn',
				payload: {
					attempt,
				},
			});
			const sid = String(queryOptions.resume);
			console.warn(
				`[Claude Agent SDK] Empty message stream for resumed session ${sid.substring(0, 8)}... — ` +
				'retrying once as fresh session.',
			);
			delete queryOptions.resume;
			delete queryOptions.resumeSessionAt;
			stderrOutput.length = 0;
			executionResult = await executeQuery(queryOptions);
		} else {
			observabilityCollector?.record({
				eventType: 'execution.retry.empty_stream_same_query',
				status: 'retrying',
				level: 'warn',
				payload: {
					attempt,
					hadResume,
				},
			});
			const retryMode = hadResume ? 'resumed' : 'new';
			console.warn(
				`[Claude Agent SDK] Empty message stream for ${retryMode} execution — retrying once with same query options.`,
			);
			stderrOutput.length = 0;
			executionResult = await executeQuery(queryOptions);
		}

		if (isEmptyExecutionResult(executionResult)) {
			observabilityCollector?.record({
				eventType: 'execution.empty_stream.abort',
				status: 'failed',
				level: 'error',
				payload: {
					attempt,
				},
			});
			throw new ApplicationError(
				'Claude Agent SDK returned no messages for this task. ' +
				'The upstream execution stream was empty after retry; aborting instead of returning a blank task_result.',
			);
		}
	}
	observabilityCollector?.record({
		eventType: 'execution.return',
		status: 'ok',
		payload: {
			attempts: attempt,
			messageCount: executionResult.messages.length,
		},
	});

	return executionResult;
}
