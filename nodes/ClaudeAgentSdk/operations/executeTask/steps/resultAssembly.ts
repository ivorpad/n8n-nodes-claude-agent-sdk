/**
 * task_result JSON assembly for executeTask finalization. Field set is part
 * of the node's public output contract.
 */

import type { IDataObject } from 'n8n-workflow';

import type { TaskItem, TodoItem, JsonSchema } from '../../../types';
import type { NodeQueryOptions, PermissionMode, NodeStreamMessage } from '../../../sdk/types';
import type { SecretsRedactor } from '../secretsRedaction';
import type { SharedExecutionState } from '../../../permissions/sharedExecutionState';
import { InvocationObservabilityCollector } from '../observability';
import type { ProcessedMessages } from '../types';
import {
	STRUCTURED_OUTPUT_RETRY_EXHAUSTED_MESSAGE,
	type StructuredOutputFailureMode,
} from '../executeTaskHelpers';

export function buildTaskResultCore(args: {
	taskDescription: string;
	finalText: string;
	processed: ProcessedMessages;
	structuredOutputRetryExhausted: boolean;
	structuredOutputFailureMode: StructuredOutputFailureMode;
	structuredOutputValidationError: string | undefined;
	requestedStructuredOutputSchema: JsonSchema | undefined;
	executionSessionId: string | undefined;
	chatSessionId: string;
	queryOptions: NodeQueryOptions;
	workingDirectory: string;
	effectivePermissionMode: PermissionMode | string;
	model: string;
	allowedTools: string[];
	messages: NodeStreamMessage[];
	latestTodos: TodoItem[];
	latestTasks: TaskItem[];
	messageTypeCounts: Record<string, number>;
	sharedState: SharedExecutionState;
	secretRedactor: SecretsRedactor;
	observabilityCollector: InvocationObservabilityCollector;
}): IDataObject {
	const {
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
	} = args;

	return {
		type: 'task_result',
		task: taskDescription,
		summary: finalText,
		...(
			processed.structuredOutputResult !== undefined
			&& !(structuredOutputRetryExhausted && structuredOutputFailureMode === 'fallbackToUnstructured')
			&& { structuredOutput: processed.structuredOutputResult as IDataObject }
		),
		...(structuredOutputRetryExhausted && structuredOutputFailureMode === 'continueWithError' && {
			structuredOutputError: STRUCTURED_OUTPUT_RETRY_EXHAUSTED_MESSAGE,
			structuredOutputFailureSubtype: processed.resultSubtype,
			structuredOutputFailureMode: 'continueWithError',
			...(requestedStructuredOutputSchema && {
				requestedStructuredOutputSchema: requestedStructuredOutputSchema as unknown as IDataObject,
			}),
		}),
		...(structuredOutputRetryExhausted && structuredOutputFailureMode === 'fallbackToUnstructured' && {
			structuredOutputFailureSubtype: processed.resultSubtype,
			structuredOutputFailureMode: 'fallbackToUnstructured',
			structuredOutputFallbackReason: STRUCTURED_OUTPUT_RETRY_EXHAUSTED_MESSAGE,
			...(requestedStructuredOutputSchema && {
				requestedStructuredOutputSchema: requestedStructuredOutputSchema as unknown as IDataObject,
			}),
		}),
		...(structuredOutputValidationError && {
			structuredOutputValidationError,
		}),
		sessionId: executionSessionId,
		chatSessionId: chatSessionId || undefined,
		isResumedSession: typeof queryOptions.resume === 'string' && (queryOptions.resume as string).length > 0,
		messages: secretRedactor.hasSecrets ? secretRedactor.redactUnknown(messages) : messages,
		artifacts: processed.artifacts,
		toolCalls: processed.toolCalls,
		...(processed.toolDenials.length > 0 && {
			toolDenials: processed.toolDenials,
			toolDenialCount: processed.toolDenials.length,
		}),
		...(processed.permissionDenials.length > 0 && {
			permissionDenials: processed.permissionDenials as unknown as IDataObject[],
		}),
		...(processed.resultIsError !== undefined && { resultIsError: processed.resultIsError }),
		...(processed.resultErrors.length > 0 && { resultErrors: processed.resultErrors }),
		todos: latestTodos,
		tasks: latestTasks,
		mcpServers: processed.mcpServerStatus,
		...(processed.sessionFiles && {
			sessionFiles: processed.sessionFiles as unknown as IDataObject,
		}),
		workingDirectory: (queryOptions.cwd as string) || workingDirectory || '.',
		permissionMode: effectivePermissionMode,
		model: model || undefined,
		allowedTools,
		...(processed.terminalReason && { terminalReason: processed.terminalReason }),
		...(processed.deferredToolUse && { deferredToolUse: processed.deferredToolUse as unknown as IDataObject }),
		...(processed.stopReason && { stopReason: processed.stopReason }),
		...(processed.stopDetails !== undefined && { stopDetails: processed.stopDetails as IDataObject }),
		...(sharedState.n8nMcpEvents?.length
			? { n8nMcpEvents: secretRedactor.hasSecrets ? secretRedactor.redactUnknown(sharedState.n8nMcpEvents) : sharedState.n8nMcpEvents }
			: {}),
		...(processed.executionUsage && {
			usage: {
				totalCostUsd: processed.executionUsage.totalCostUsd,
				numTurns: processed.executionUsage.numTurns,
				durationMs: processed.executionUsage.durationMs,
				durationApiMs: processed.executionUsage.durationApiMs,
				tokens: processed.executionUsage.usage,
				modelBreakdown: processed.executionUsage.modelUsage,
				...(processed.executionUsage.warnings?.length
					? { warnings: processed.executionUsage.warnings }
					: {}),
			},
		}),
		observability: observabilityCollector.toTaskResultObservability() as unknown as IDataObject,
		_debug: {
			messageTypeCounts,
		},
	};
}
