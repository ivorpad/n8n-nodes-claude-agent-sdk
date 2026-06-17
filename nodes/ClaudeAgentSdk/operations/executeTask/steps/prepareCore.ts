/**
 * Core-parameter extraction for executeTask: task description, session ids,
 * working-directory validation, observability collector construction, and
 * binary-input preprocessing.
 */

import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import * as fs from 'fs';

import { maybeProcessBinaryInputs } from '../binaryInputs';
import type { SecretsRedactor } from '../secretsRedaction';
import { InvocationObservabilityCollector } from '../observability';
import { parseObservabilityPersistenceConfig } from '../observabilityPostgres';
import {
	normalizeObservabilityMode,
	normalizePositiveInt,
	type ExecutionSettingsObservability,
} from '../executeTaskHelpers';

export async function prepareCoreParams(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	backendMode: 'localCli' | 'managedAgent';
	secretRedactor: SecretsRedactor;
}): Promise<{
	taskDescription: string;
	chatSessionId: string;
	workingDirectory: string;
	node: INode;
	workflowId: string | undefined;
	observabilityPersistenceConfig: ReturnType<typeof parseObservabilityPersistenceConfig>;
	observabilityCollector: InvocationObservabilityCollector;
}> {
	const { execFunctions, itemIndex, backendMode, secretRedactor } = args;

	// Read task description - may be overridden by resume data below
	// Validation is deferred until after resume data processing
	let taskDescription = execFunctions.getNodeParameter('taskDescription', itemIndex, '') as string;

	const chatSessionId = execFunctions.getNodeParameter('chatSessionId', itemIndex, '') as string;
		const workingDirectory = execFunctions.getNodeParameter('workingDirectory', itemIndex, '') as string;
	const node = execFunctions.getNode();
	const workflowId = execFunctions.getWorkflow?.()?.id;
	const executionSettings = execFunctions.getNodeParameter('executionSettings', itemIndex, {}) as ExecutionSettingsObservability;
	const observabilityMode = normalizeObservabilityMode(executionSettings.observabilityMode);
	const observabilityPersistenceConfig = parseObservabilityPersistenceConfig(
		executionSettings as Record<string, unknown>,
	);
	const observabilityCollector = new InvocationObservabilityCollector({
		mode: observabilityMode,
		maxEvents: normalizePositiveInt(executionSettings.maxObservabilityEvents, 500, 10, 5000),
		maxBytes: normalizePositiveInt(executionSettings.maxObservabilityBytes, 262_144, 1024, 5 * 1024 * 1024),
		redactPayloads: executionSettings.redactObservabilityPayloads !== false,
		secretRedactor,
		context: {
			nodeName: node.name,
			itemIndex,
			workflowId,
			chatSessionId: chatSessionId || undefined,
		},
	});
	observabilityCollector.record({
		eventType: 'execute_task.start',
		status: 'started',
		payload: {
			backendMode,
		},
	});


	// Validate working directory exists if specified
	if (workingDirectory) {
		if (!fs.existsSync(workingDirectory)) {
			throw new ApplicationError(
				`Working directory does not exist: "${workingDirectory}". ` +
				`Please ensure the directory exists before running the task.`,
			);
		}
		try {
			const stat = fs.statSync(workingDirectory);
			if (!stat.isDirectory()) {
				throw new ApplicationError(
					`Working directory path is not a directory: "${workingDirectory}". ` +
					`Please provide a valid directory path.`,
				);
			}
		} catch (error) {
			if (error instanceof ApplicationError) throw error;
			throw new ApplicationError(
				`Cannot access working directory "${workingDirectory}": ${(error as Error).message}`,
			);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// 1a. Binary inputs handling - download files and process placeholders
	// ─────────────────────────────────────────────────────────────────────────────

	taskDescription = await maybeProcessBinaryInputs({
		execFunctions,
		itemIndex,
		taskDescription,
		workingDirectory,
	});

	return {
		taskDescription,
		chatSessionId,
		workingDirectory,
		node,
		workflowId,
		observabilityPersistenceConfig,
		observabilityCollector,
	};
}
