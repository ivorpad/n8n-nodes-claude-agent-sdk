/**
 * Shared execution-lifecycle state and teardown helpers for executeTask:
 * observability persistence flush, session-lock release, and store closers.
 * State lives here so phase modules and the orchestrator mutate one place.
 */

import type { StreamStoreHandle } from '../../../streaming';
import type { HitlInteractionStoreHandle } from '../../../hitl/interactionStore';
import { InvocationObservabilityCollector } from '../observability';
import {
	type ObservabilityPersistenceResult,
	type ObservabilityPersistenceStatus,
} from '../observabilityPostgres';
import type { ISessionMemory } from '../../../types';

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
	itemIndex: number;
	workflowId: string | undefined;
	nodeName: string;
	chatSessionId: string;
	observabilityCollector: InvocationObservabilityCollector;
	sessionMemory: ISessionMemory | undefined;
	persistSessionEnabled: boolean;
	getDurableStreamKey: () => string | undefined;
}): ExecutionLifecycle {
	const {
		itemIndex,
		workflowId,
		nodeName,
		chatSessionId,
		observabilityCollector,
		sessionMemory,
		persistSessionEnabled,
		getDurableStreamKey,
	} = args;
	const durablePersistence = persistSessionEnabled ? sessionMemory?.durablePersistence : undefined;

	const state: ExecutionLifecycleState = {};
	let observabilityPersistenceResult: ObservabilityPersistenceResult = {
		backend: durablePersistence ? 'postgres' : 'runDataOnly',
		attempted: false,
		persisted: false,
		tableName: durablePersistence?.observabilityTableName,
		rowCount: 0,
	};
	let observabilityPersistenceFlushed = false;

	const buildObservabilityMetadata = (): Record<string, string | number | boolean> => ({
		...observabilityCollector.toMetadataHints(),
		agentStreamKey: getDurableStreamKey() ?? '',
		agentObsPersistenceBackend: observabilityPersistenceResult.backend,
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
		if (!durablePersistence) {
			observabilityPersistenceResult = {
				backend: 'runDataOnly',
				attempted: false,
				persisted: false,
				rowCount: 0,
			};
			return;
		}
		try {
			observabilityPersistenceResult = await durablePersistence.persistInvocationObservability({
				observability: observabilityCollector.toTaskResultObservability(),
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
			});
		} catch (error) {
			observabilityPersistenceResult = {
				backend: 'postgres',
				attempted: true,
				persisted: false,
				tableName: durablePersistence.observabilityTableName,
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
