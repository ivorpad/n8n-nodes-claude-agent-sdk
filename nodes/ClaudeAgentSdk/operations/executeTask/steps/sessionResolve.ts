/**
 * Deterministic session-memory resolution for executeTask: AiMemory input
 * fetch, execution-lock acquisition, and resume-session resolution for both
 * the local CLI (transcript-gated) and managed-agent (metadata-gated) paths.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { ISessionMemory } from '../../../types';
import type { NodeQueryOptions } from '../../../sdk/types';
import { findSessionTranscriptPath } from '../sessionDirectory';
import { InvocationObservabilityCollector } from '../observability';
import { decodeManagedRequestId } from '../../../managedAgent/hitlBridge';
import type { PendingHitlResolution } from '../types';
import { debugLog, debugWarn } from '../../../diagnostics';

export async function fetchSessionMemory(
	execFunctions: IExecuteFunctions,
): Promise<ISessionMemory | undefined> {
	try {
		const memoryInput = await execFunctions.getInputConnectionData(NodeConnectionTypes.AiMemory, 0);
		if (memoryInput && typeof memoryInput === 'object' && 'type' in memoryInput && memoryInput.type === 'claude-session-memory') {
			return memoryInput as ISessionMemory;
		}
	} catch {
		// No memory connected
	}
	return undefined;
}

export interface SessionResolution {
	resumeSessionId: string | undefined;
	managedAgentResumeSessionId: string | undefined;
	mappedWorkingDirectory: string | undefined;
	releaseSessionExecutionLock: (() => Promise<void>) | undefined;
}

export async function resolveSessionState(args: {
	chatSessionId: string;
	persistSessionEnabled: boolean;
	isManagedAgent: boolean;
	sessionMemory: ISessionMemory | undefined;
	claudeConfigDirectory: string;
	observabilityCollector: InvocationObservabilityCollector;
}): Promise<SessionResolution> {
	const {
		chatSessionId,
		persistSessionEnabled,
		isManagedAgent,
		sessionMemory,
		claudeConfigDirectory,
		observabilityCollector,
	} = args;

	let resumeSessionId: string | undefined;
	let managedAgentResumeSessionId: string | undefined;
	let mappedWorkingDirectory: string | undefined;
	let releaseSessionExecutionLock: (() => Promise<void>) | undefined;

	if (
		persistSessionEnabled
		&& chatSessionId
		&& sessionMemory
		&& typeof sessionMemory.acquireExecutionLock === 'function'
	) {
		releaseSessionExecutionLock = await sessionMemory.acquireExecutionLock(chatSessionId);
	}

	if (persistSessionEnabled && chatSessionId && sessionMemory) {
		const hasStoredSession = await sessionMemory.has(chatSessionId);

		// Load metadata first — both backends need it
		let storedMetadata: { workingDirectory?: string; managedAgentSessionId?: string } | undefined;
		if (typeof sessionMemory.getMetadata === 'function') {
			storedMetadata = await sessionMemory.getMetadata(chatSessionId);
			mappedWorkingDirectory = storedMetadata?.workingDirectory;
		}

		if (hasStoredSession) {
			if (isManagedAgent) {
				// Managed agent: use stored Anthropic session ID from metadata.
				// No transcript file on disk; the Managed Agents API is the source of truth.
				managedAgentResumeSessionId = storedMetadata?.managedAgentSessionId;
				resumeSessionId = undefined;
				if (!managedAgentResumeSessionId) {
					debugWarn(
						`[Claude Agent SDK] Managed agent session memory entry exists for ${chatSessionId.slice(0, 8)}... ` +
						'but no managedAgentSessionId stored — starting fresh session.',
					);
				}
			} else {
				// Local CLI: transcript file presence gates resume
				const transcriptPath = findSessionTranscriptPath({
					claudeConfigDirectory,
					sessionId: chatSessionId,
				});
				if (transcriptPath) {
					resumeSessionId = chatSessionId;
				} else {
					debugWarn(
						`[Claude Agent SDK] Stale deterministic session memory entry detected for ${chatSessionId.slice(0, 8)}...: ` +
						`no transcript found under ${claudeConfigDirectory}/projects. ` +
						'Clearing memory entry and bootstrapping deterministic session on this run.',
					);
					if (typeof sessionMemory.forget === 'function') {
						await sessionMemory.forget(chatSessionId);
					}
					resumeSessionId = undefined;
				}
			}
		} else {
			resumeSessionId = undefined;
			managedAgentResumeSessionId = undefined;
		}
		observabilityCollector.record({
			eventType: 'session.memory.resolve',
			status: hasStoredSession
				? (isManagedAgent
					? (managedAgentResumeSessionId ? 'managed_resume' : 'managed_stale')
					: (resumeSessionId ? 'resume' : 'stale'))
				: 'new',
			payload: {
				hasStoredSession,
				resumeSessionId,
				managedAgentResumeSessionId,
			},
		});

		debugLog(
			`[Claude Agent SDK] Session resolution: chat=${chatSessionId.slice(0, 8)}... ` +
			`memoryHas=${hasStoredSession} ` +
			(isManagedAgent
				? `managedResume=${managedAgentResumeSessionId ? managedAgentResumeSessionId.slice(0, 12) + '...' : 'none'}`
				: `resume=${Boolean(resumeSessionId)} configDir=${claudeConfigDirectory}`),
		);
	}

	return {
		resumeSessionId,
		managedAgentResumeSessionId,
		mappedWorkingDirectory,
		releaseSessionExecutionLock,
	};
}

/**
 * Managed Agent HITL resume: when re-entering after a managed-agent
 * question_response, thread the tool result through queryOptions so the
 * adapter sends user.custom_tool_result instead of user.message.
 */
export function wireManagedResumeToolResult(args: {
	isManagedAgent: boolean;
	isApprovalResume: boolean;
	pendingQuestionResponse: { requestId: string; answers: Record<string, string | string[]> } | undefined;
	managedAgentResumeSessionId: string | undefined;
	resumeSessionId: string | undefined;
	queryOptions: NodeQueryOptions;
	observabilityCollector: InvocationObservabilityCollector;
}): void {
	const {
		isManagedAgent,
		isApprovalResume,
		pendingQuestionResponse,
		managedAgentResumeSessionId,
		resumeSessionId,
		queryOptions,
		observabilityCollector,
	} = args;

	if (!isManagedAgent || !isApprovalResume || !pendingQuestionResponse) {
		return;
	}
	const prefix = 'managed_hitl_';
	const decoded = decodeManagedRequestId(pendingQuestionResponse.requestId, prefix);
	if (!decoded) {
		return;
	}
	const managedSessionId = managedAgentResumeSessionId || resumeSessionId || '';
	const answerText = Object.values(pendingQuestionResponse.answers)
		.flat()
		.join(', ');
	queryOptions.managedResumeWithToolResult = {
		sessionId: managedSessionId,
		customToolUseId: decoded.toolUseId,
		content: answerText,
		sessionThreadId: decoded.sessionThreadId,
	};
	observabilityCollector.record({
		eventType: 'managed_hitl.resume.wired',
		status: 'ok',
		payload: {
			managedSessionId,
			customToolUseId: decoded.toolUseId,
			hasSessionThreadId: Boolean(decoded.sessionThreadId),
			answerLength: answerText.length,
		},
	});
}

/**
 * Managed Agent tool-confirmation resume: approval_response maps to
 * user.tool_confirmation. This is intentionally separate from custom-tool
 * question answers.
 */
export function wireManagedResumeToolConfirmation(args: {
	isManagedAgent: boolean;
	isApprovalResume: boolean;
	pendingApprovalResolution: PendingHitlResolution | undefined;
	managedAgentResumeSessionId: string | undefined;
	resumeSessionId: string | undefined;
	queryOptions: NodeQueryOptions;
	observabilityCollector: InvocationObservabilityCollector;
}): void {
	const {
		isManagedAgent,
		isApprovalResume,
		pendingApprovalResolution,
		managedAgentResumeSessionId,
		resumeSessionId,
		queryOptions,
		observabilityCollector,
	} = args;

	if (!isManagedAgent || !isApprovalResume || !pendingApprovalResolution) {
		return;
	}
	const decoded = decodeManagedRequestId(
		pendingApprovalResolution.requestId,
		'managed_tool_confirmation_',
	);
	if (!decoded) {
		return;
	}
	const managedSessionId = managedAgentResumeSessionId || resumeSessionId || '';
	queryOptions.managedResumeWithToolConfirmation = {
		sessionId: managedSessionId,
		toolUseId: decoded.toolUseId,
		approved: pendingApprovalResolution.approved,
		denyMessage: pendingApprovalResolution.approved
			? undefined
			: pendingApprovalResolution.reviewerMessage,
		sessionThreadId: decoded.sessionThreadId,
	};
	observabilityCollector.record({
		eventType: 'managed_hitl.tool_confirmation.wired',
		status: pendingApprovalResolution.approved ? 'allow' : 'deny',
		payload: {
			managedSessionId,
			toolUseId: decoded.toolUseId,
			hasSessionThreadId: Boolean(decoded.sessionThreadId),
		},
	});
}
