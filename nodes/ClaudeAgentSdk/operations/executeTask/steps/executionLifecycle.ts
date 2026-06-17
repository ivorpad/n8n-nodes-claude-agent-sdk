/**
 * Shared execution-lifecycle state and teardown helpers for executeTask:
 * observability persistence flush, session-lock release, and store closers.
 * State lives here so phase modules and the orchestrator mutate one place.
 */

import type { IExecuteFunctions } from 'n8n-workflow';

import type { StreamStoreHandle } from '../../../streaming';
import type { HitlInteractionStoreHandle } from '../../../hitl/interactionStore';
import { InvocationObservabilityCollector } from '../observability';
import {
	persistInvocationObservability,
	parseObservabilityPersistenceConfig,
	type ObservabilityPersistenceResult,
	type ObservabilityPersistenceStatus,
} from '../observabilityPostgres';

type ObservabilityPersistenceConfig = ReturnType<typeof parseObservabilityPersistenceConfig>;

export interface ExecutionLifecycleState {
	releaseSessionExecutionLock?: () => Promise<void>;
	durableStreamStoreHandle?: StreamStoreHandle;
	hitlInteractionStoreHandle?: HitlInteractionStoreHandle;
	interactionExecutionIdForPersistence?: string;
	executionSessionIdForPersistence?: string;
	observabilityCorrelationId?: string;
}

export interface ExecutionLifecycle {
	state: ExecutionLifecycleState;
	buildObservabilityMetadata: () => Record<string, string | number | boolean>;
	flushObservability: (
		terminalStatus: ObservabilityPersistenceStatus,
		options?: { allowFailure?: boolean },
	) => Promise<void>;
	releaseSessionExecutionLockIfNeeded: () => Promise<void>;
	closeDurableStreamStoreIfNeeded: () => Promise<void>;
	closeHitlInteractionStoreIfNeeded: () => Promise<void>;
}

export function createExecutionLifecycle(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	workflowId: string | undefined;
	nodeName: string;
	chatSessionId: string;
	observabilityCollector: InvocationObservabilityCollector;
	observabilityPersistenceConfig: ObservabilityPersistenceConfig;
	getDurableStreamKey: () => string | undefined;
}): ExecutionLifecycle {
	const {
		execFunctions,
		itemIndex,
		workflowId,
		nodeName,
		chatSessionId,
		observabilityCollector,
		observabilityPersistenceConfig,
		getDurableStreamKey,
	} = args;

	const state: ExecutionLifecycleState = {};
	let observabilityPersistenceResult: ObservabilityPersistenceResult = {
		backend: observabilityPersistenceConfig.backend,
		attempted: false,
		persisted: false,
		tableName: observabilityPersistenceConfig.backend === 'postgres'
			? observabilityPersistenceConfig.tableName
			: undefined,
		rowCount: 0,
	};
	let observabilityPersistenceFlushed = false;

	const buildObservabilityMetadata = (): Record<string, string | number | boolean> => ({
		...observabilityCollector.toMetadataHints(),
		agentStreamKey: getDurableStreamKey() ?? '',
		agentObsPersistenceBackend: observabilityPersistenceConfig.backend,
		agentObsPersistenceAttempted: observabilityPersistenceResult.attempted,
		agentObsPersistencePersisted: observabilityPersistenceResult.persisted,
		agentObsPersistenceRows: observabilityPersistenceResult.rowCount,
		agentObsPersistenceTable: observabilityPersistenceResult.tableName ?? '',
		agentObsPersistenceError: observabilityPersistenceResult.error ?? '',
	});

	const flushObservability = async (
		terminalStatus: ObservabilityPersistenceStatus,
		options?: { allowFailure?: boolean },
	): Promise<void> => {
		if (observabilityPersistenceFlushed) {
			return;
		}
		observabilityPersistenceFlushed = true;
		try {
			observabilityPersistenceResult = await persistInvocationObservability({
				execFunctions,
				collector: observabilityCollector,
				terminalStatus,
				context: {
					workflowId,
					nodeName,
					executionId: state.interactionExecutionIdForPersistence,
					itemIndex,
					chatSessionId: chatSessionId || undefined,
					sessionId: state.executionSessionIdForPersistence,
					correlationId: state.observabilityCorrelationId,
				},
				config: observabilityPersistenceConfig,
			});
		} catch (error) {
			observabilityPersistenceResult = {
				backend: observabilityPersistenceConfig.backend,
				attempted: true,
				persisted: false,
				tableName: observabilityPersistenceConfig.tableName,
				rowCount: 0,
				error: (error as Error).message,
			};
			if (options?.allowFailure === true) {
				console.warn(
					`[Claude Agent SDK] Observability persistence failed on ${terminalStatus} path: ${(error as Error).message}`,
				);
				return;
			}
			throw error;
		}
	};

	const releaseSessionExecutionLockIfNeeded = async (): Promise<void> => {
		if (!state.releaseSessionExecutionLock) return;
		const release = state.releaseSessionExecutionLock;
		state.releaseSessionExecutionLock = undefined;
		try {
			await release();
		} catch (error) {
			console.warn(
				`[Claude Agent SDK] Failed to release session execution lock: ${(error as Error).message}`,
			);
		}
	};

	const closeDurableStreamStoreIfNeeded = async (): Promise<void> => {
		if (!state.durableStreamStoreHandle) return;
		const handle = state.durableStreamStoreHandle;
		state.durableStreamStoreHandle = undefined;
		try {
			await handle.close();
		} catch (error) {
			console.warn(
				`[Claude Agent SDK] Failed to close durable stream store: ${(error as Error).message}`,
			);
		}
	};

	const closeHitlInteractionStoreIfNeeded = async (): Promise<void> => {
		if (!state.hitlInteractionStoreHandle) return;
		const handle = state.hitlInteractionStoreHandle;
		state.hitlInteractionStoreHandle = undefined;
		try {
			await handle.close();
		} catch (error) {
			console.warn(
				`[Claude Agent SDK] Failed to close HITL interaction store: ${(error as Error).message}`,
			);
		}
	};

	return {
		state,
		buildObservabilityMetadata,
		flushObservability,
		releaseSessionExecutionLockIfNeeded,
		closeDurableStreamStoreIfNeeded,
		closeHitlInteractionStoreIfNeeded,
	};
}
