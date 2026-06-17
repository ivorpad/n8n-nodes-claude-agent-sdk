/**
 * Session-metadata persistence (deterministic chatSessionId mapping) and
 * managed-agent generated-file binary binding for executeTask finalization.
 */

import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import type { ISessionMemory } from '../../../types';
import type { NodeQueryOptions } from '../../../sdk/types';
import {
	collectGeneratedFileBinaries,
	parseGeneratedFilesConfig,
	type GeneratedFileAttachment,
} from '../managedAgentBinaryOutputs';
import { resolveTranscriptWorkingDirectory } from '../sessionDirectory';
import { InvocationObservabilityCollector } from '../observability';

export async function persistSessionMetadata(args: {
	execFunctions: IExecuteFunctions;
	isManagedAgent: boolean;
	persistSessionEnabled: boolean;
	chatSessionId: string;
	sessionMemory: ISessionMemory | undefined;
	executionSessionId: string | undefined;
	managedAgentResumeSessionId: string | undefined;
	resumeSessionId: string | undefined;
	queryOptions: NodeQueryOptions;
	workingDirectory: string;
	mappedWorkingDirectory: string | undefined;
	observabilityCollector: InvocationObservabilityCollector;
}): Promise<void> {
	const {
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
	} = args;


	if (persistSessionEnabled && chatSessionId && sessionMemory) {
		if (isManagedAgent) {
			// Managed agent: persist the Anthropic session ID (sesn_...) returned
			// by the API under managedAgentSessionId. This is how we resume on the
			// next run. The ID is NEVER equal to chatSessionId (server-generated).
			const managedSessionIdToPersist = executionSessionId ?? managedAgentResumeSessionId;
			if (managedSessionIdToPersist) {
				const nodeName = execFunctions.getNode().name.replace(/\s+/g, '_');
				await sessionMemory.touch(chatSessionId, nodeName, {
					managedAgentSessionId: managedSessionIdToPersist,
				});
				observabilityCollector.record({
					eventType: 'session.memory.persist_managed',
					status: managedSessionIdToPersist === managedAgentResumeSessionId ? 'reused' : 'new',
					payload: {
						managedAgentSessionId: managedSessionIdToPersist,
					},
				});
			}
		} else {
			// Local CLI path
			const isForkSession = queryOptions.forkSession === true;
			const fallbackSessionIdFromQuery =
				(typeof queryOptions.resume === 'string' && queryOptions.resume.length > 0)
					? queryOptions.resume
					: (typeof queryOptions.sessionId === 'string' && queryOptions.sessionId.length > 0)
						? queryOptions.sessionId
						: undefined;
			const sessionIdToPersist = executionSessionId ?? fallbackSessionIdFromQuery;
			if (!executionSessionId && sessionIdToPersist) {
				observabilityCollector.record({
					eventType: 'session.memory.persist_fallback',
					status: 'fallback',
					level: 'warn',
					payload: {
						sessionIdToPersist,
					},
				});
			}
			if (sessionIdToPersist && (isForkSession || sessionIdToPersist === chatSessionId)) {
				const nodeName = execFunctions.getNode().name.replace(/\s+/g, '_');
				const mappingWorkingDirectory = resolveTranscriptWorkingDirectory({
					defaultWorkingDirectory: workingDirectory,
					mappedWorkingDirectory,
					resumeSessionId,
					executionSessionId: sessionIdToPersist,
				});
				// Persist deterministic session metadata keyed by chatSessionId.
				await sessionMemory.touch(chatSessionId, nodeName, {
					workingDirectory: mappingWorkingDirectory,
				});
			} else if (sessionIdToPersist && sessionIdToPersist !== chatSessionId) {
				console.warn(
					`[Claude Agent SDK] Session drift detected: expected deterministic chat session ` +
					`${chatSessionId.slice(0, 8)}... but execution returned ${sessionIdToPersist.slice(0, 8)}.... ` +
					'Clearing deterministic session memory entry to force re-bootstrap on the next run.',
				);
				if (typeof sessionMemory.forget === 'function') {
					await sessionMemory.forget(chatSessionId);
				}
			}
		}
	}
}

export async function bindManagedGeneratedFiles(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	isManagedAgent: boolean;
	processedArtifacts: unknown[];
	taskResultCore: IDataObject;
	observabilityCollector: InvocationObservabilityCollector;
}): Promise<GeneratedFileAttachment[]> {
	const {
		execFunctions,
		itemIndex,
		isManagedAgent,
		processedArtifacts,
		taskResultCore,
		observabilityCollector,
	} = args;

	let generatedFileAttachments: GeneratedFileAttachment[] = [];
	if (isManagedAgent) {
		const generatedFilesConfig = parseGeneratedFilesConfig(execFunctions, itemIndex);
		if (generatedFilesConfig.enabled) {
			const result = await collectGeneratedFileBinaries({
				artifacts: processedArtifacts,
				config: generatedFilesConfig,
				execFunctions,
			});
			generatedFileAttachments = result.attachments;
			if (result.artifactsForJson !== processedArtifacts) {
				taskResultCore.artifacts = result.artifactsForJson;
			}
			if (generatedFileAttachments.length > 0) {
				taskResultCore.generatedFiles = generatedFileAttachments.map((g) => g.meta);
			}
			for (const w of result.warnings) {
				observabilityCollector.record({
					eventType: 'managed_agent.generated_files.warning',
					status: 'warn',
					level: 'warn',
					payload: { message: w },
				});
			}
			observabilityCollector.record({
				eventType: 'managed_agent.generated_files.bound',
				status: 'ok',
				payload: {
					attachedCount: generatedFileAttachments.length,
					artifactsScanned: processedArtifacts.length,
					warnings: result.warnings.length,
				},
			});
		}
	}
	return generatedFileAttachments;
}
