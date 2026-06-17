import type { IExecuteFunctions } from 'n8n-workflow';

import type { AdditionalOptions, AgentDefinition, ISessionMemory } from '../../../types';
import type { ExecuteTaskOptions } from '../types';
import type { NodeQueryOptions, PermissionMode } from '../../../sdk/types';
import type { OperatorPolicy } from '../../../permissions/policy';
import {
	applyPluginOptions,
	buildPromptSetup,
	buildQueryEnvironment,
	buildQueryOptions,
	buildQuerySetupContext,
	buildThinkingSetup,
	createStderrCapture,
	resolveCliExecutablePath,
} from './querySetupParts';

interface QuerySetupResult {
	allowedTools: string[];
	disallowedTools: string[];
	permissionMode: PermissionMode;
	model: string;
	additionalDirectories?: string[];
	additionalOptions: AdditionalOptions;
	betas: string[];
	correlationId?: string;
	apiProvider: string;
	ollamaModel?: string;
	maxTurns: number;
	treatAgentErrorsAsWorkflowErrors: boolean;
	queryOptions: NodeQueryOptions;
	stderrOutput: string[];
}

export async function buildQuerySetup(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	options: ExecuteTaskOptions;
	resolvedAuthMethod: 'apiCredentials' | 'cliSession' | 'openrouter' | 'ollama' | 'alibaba';
	workingDirectory: string;
	chatSessionId: string;
	sessionMemory?: ISessionMemory;
	resumeSessionId?: string;
	agents: Record<string, AgentDefinition>;
	operatorPolicy: OperatorPolicy;
	/**
	 * Whether HITL approvals are enabled. Threaded in so the initial
	 * permission-mode resolution (operator clamp + HITL downgrade) is computed
	 * in one place inside buildQueryOptions. Defaults to false to preserve the
	 * non-HITL resolution for callers that have not opted in.
	 */
	hitlEnabled?: boolean;
}): Promise<QuerySetupResult> {
	const context = buildQuerySetupContext(args);
	const workflowId = args.execFunctions.getWorkflow?.()?.id || 'unknown-workflow';
	const env = buildQueryEnvironment({
		context,
		options: args.options,
		operatorPolicy: args.operatorPolicy,
		workingDirectory: args.workingDirectory,
		chatSessionId: args.chatSessionId,
		resumeSessionId: args.resumeSessionId,
		itemIndex: args.itemIndex,
		workflowId,
	});
	const stderrCapture = createStderrCapture(args.execFunctions, args.options);
	const promptSetup = buildPromptSetup({
		execFunctions: args.execFunctions,
		itemIndex: args.itemIndex,
		context,
		agents: args.agents,
	});
	const cliExecutablePath = await resolveCliExecutablePath(args.execFunctions);
	const thinkingSetup = buildThinkingSetup({
		execFunctions: args.execFunctions,
		itemIndex: args.itemIndex,
		context,
	});
	const { queryOptions, permissionMode } = buildQueryOptions({
		context,
		env,
		stderrCapture,
		promptSetup,
		thinkingSetup,
		workingDirectory: args.workingDirectory,
		chatSessionId: args.chatSessionId,
		resumeSessionId: args.resumeSessionId,
		cliExecutablePath,
		hitlEnabled: args.hitlEnabled ?? false,
		operatorPolicy: args.operatorPolicy,
	});
	applyPluginOptions({
		execFunctions: args.execFunctions,
		itemIndex: args.itemIndex,
		queryOptions,
	});

	return {
		allowedTools: context.allowedTools,
		disallowedTools: context.disallowedTools,
		// Resolved mode (operator clamp + HITL downgrade applied), so callers do
		// not need to re-resolve it.
		permissionMode,
		model: context.model,
		additionalDirectories: context.executionSettings.additionalDirectories,
		additionalOptions: context.additionalOptions,
		betas: context.betas,
		correlationId: context.correlationId,
		apiProvider: context.apiProvider,
		ollamaModel: context.ollamaModel,
		maxTurns: context.executionSettings.maxTurns,
		treatAgentErrorsAsWorkflowErrors: context.executionSettings.treatAgentErrorsAsWorkflowErrors,
		queryOptions,
		stderrOutput: stderrCapture.stderrOutput,
	};
}
