/**
 * Small parameter-parsing and formatting helpers for the executeTask
 * orchestrator (kept separate so index.ts stays an orchestration layer).
 */

import type { IExecuteFunctions } from 'n8n-workflow';

import { InvocationObservabilityCollector } from './observability';

import type { JsonSchema, ObservabilityMode } from '../../types';
import type { HookHandlerConfig } from '../../hooks/webhookHooks';
import type { NodeQueryOptions } from '../../sdk/types';


/**
 * Streaming text/token channels require partial SDK events.
 * For assistant/user-only streaming, forcing partials causes duplicate
 * transcript chunks in downstream consumers.
 */
export function shouldForceIncludePartialMessagesForStreaming(streamConfig: { contentTypes: Set<string> }): boolean {
	return streamConfig.contentTypes.has('text')
		|| streamConfig.contentTypes.has('structuredOutputDelta')
		|| streamConfig.contentTypes.has('stream_event')
		|| streamConfig.contentTypes.has('all');
}

export type StructuredOutputFailureMode = 'continueWithError' | 'throwError' | 'fallbackToUnstructured';

export const STRUCTURED_OUTPUT_RETRY_EXHAUSTED = 'error_max_structured_output_retries';
export const STRUCTURED_OUTPUT_RETRY_EXHAUSTED_MESSAGE = 'Could not produce valid structured output after max retries';

export function formatStopDetailsForError(stopDetails: unknown): string {
	if (!stopDetails || typeof stopDetails !== 'object') {
		return 'Claude returned a structured refusal.';
	}

	const details = stopDetails as Record<string, unknown>;
	const reason = typeof details.reason === 'string' ? details.reason : undefined;
	const message = typeof details.message === 'string' ? details.message : undefined;
	const type = typeof details.type === 'string' ? details.type : undefined;

	return message ?? reason ?? (type ? `Claude returned stop_details type "${type}".` : 'Claude returned a structured refusal.');
}

export function parseStructuredOutputFailureMode(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): StructuredOutputFailureMode {
	const value = execFunctions.getNodeParameter(
		'structuredOutputFailureMode',
		itemIndex,
		'continueWithError',
	);

	if (
		value === 'continueWithError'
		|| value === 'throwError'
		|| value === 'fallbackToUnstructured'
	) {
		return value;
	}

	return 'continueWithError';
}

export function getRequestedStructuredOutputSchema(
	queryOptions: NodeQueryOptions,
): JsonSchema | undefined {
	const schema = queryOptions.outputFormat?.schema;
	return schema ? (schema as JsonSchema) : undefined;
}

/**
 * Parse hook handler configs from node parameters.
 */
export function parseHookHandlerConfigs(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): HookHandlerConfig[] {
	const enabled = execFunctions.getNodeParameter(
		'enableHookHandlers',
		itemIndex,
		false,
	) as boolean;
	if (!enabled) return [];

	const hookHandlers = execFunctions.getNodeParameter(
		'hookHandlers',
		itemIndex,
		{},
	) as { handlers?: Array<{
		event: string;
		handlerType?: string;
		mode: string;
		webhookUrl?: string;
		command?: string;
		matcher?: string;
		timeoutSeconds?: number;
		failBehaviour?: string;
	}> };

	const handlers = hookHandlers.handlers;
	if (!handlers || handlers.length === 0) return [];

	return handlers
		.filter((h) => h.webhookUrl || h.command)
		.map((h) => ({
			event: h.event as HookHandlerConfig['event'],
			handlerType: (h.handlerType || 'webhook') as HookHandlerConfig['handlerType'],
			mode: (h.mode || 'fireAndForget') as HookHandlerConfig['mode'],
			...(h.webhookUrl && { webhookUrl: h.webhookUrl }),
			...(h.command && { command: h.command }),
			...(h.matcher && { matcher: h.matcher }),
			timeoutSeconds: h.timeoutSeconds ?? 30,
			failBehaviour: (h.failBehaviour || 'continue') as HookHandlerConfig['failBehaviour'],
		}));
}

export interface ExecutionSettingsObservability {
	observabilityMode?: ObservabilityMode;
	maxObservabilityEvents?: number;
	maxObservabilityBytes?: number;
	redactObservabilityPayloads?: boolean;
	observabilityPersistenceBackend?: 'auto' | 'runDataOnly' | 'postgres';
	observabilityPersistenceStrict?: boolean;
	observabilityPostgresTable?: string;
	observabilityPostgresCredentialName?: string;
}

export function normalizeObservabilityMode(value: unknown): ObservabilityMode {
	if (value === 'off' || value === 'summary' || value === 'full') {
		return value;
	}
	return 'summary';
}

export function normalizePositiveInt(
	value: unknown,
	defaultValue: number,
	minValue: number,
	maxValue: number,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return defaultValue;
	}
	const rounded = Math.floor(value);
	if (rounded < minValue) return minValue;
	if (rounded > maxValue) return maxValue;
	return rounded;
}

export function setObservabilityMetadata(
	execFunctions: IExecuteFunctions,
	metadata: Record<string, string | number | boolean>,
): void {
	const metadataHost = execFunctions as unknown as {
		setMetadata?: (data: Record<string, string | number | boolean>) => void;
	};
	if (typeof metadataHost.setMetadata !== 'function') {
		return;
	}
	try {
		// setMetadata relies on execution-context `this` in n8n internals.
		// Call via host binding to avoid "reading 'executeData'" runtime errors.
		metadataHost.setMetadata.call(execFunctions, {
			claudeAgentSdk: JSON.stringify(metadata),
			...metadata,
		});
	} catch (error) {
		console.warn(
			`[Claude Agent SDK] Failed to persist observability metadata hints: ${(error as Error).message}`,
		);
	}
}

/**
 * Execution scope ID (prefer real n8n execution ID; fall back to a per-run
 * synthetic ID so pending HITL interactions stay scoped to this run).
 */
export function resolveExecutionScope(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	observabilityCollector: InvocationObservabilityCollector,
): { executionId: string | undefined; interactionExecutionId: string } {
	let executionId: string | undefined;
	try {
		const dataProxy = execFunctions.getWorkflowDataProxy(itemIndex);
		executionId = (dataProxy as unknown as { $execution?: { id?: string } }).$execution?.id;
	} catch {
		// Execution ID not available in this context
	}
	const interactionExecutionId = executionId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	observabilityCollector.updateContext({
		executionId: interactionExecutionId,
	});
	observabilityCollector.record({
		eventType: 'execution.scope.resolved',
		status: executionId ? 'n8n_execution_id' : 'synthetic_execution_id',
		payload: {
			interactionExecutionId,
		},
	});
	return { executionId, interactionExecutionId };
}
