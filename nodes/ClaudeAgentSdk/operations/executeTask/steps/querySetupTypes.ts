/**
 * Shared types for the query-setup pipeline.
 *
 * Split out of querySetupParts.ts so the reader/context, thinking, options,
 * and environment modules can share shapes without import cycles.
 */

import type { IExecuteFunctions } from 'n8n-workflow';

import type { AdditionalOptions, AgentDefinition, ISessionMemory } from '../../../types';
import type { OperatorPolicy } from '../../../permissions/policy';
import type {
	EffortLevel,
	SettingSource,
	ThinkingConfig,
	UpstreamQueryOptions,
} from '../../../sdk/types';
import type { ExecuteTaskOptions } from '../types';

export type ResolvedAuthMethod = 'apiCredentials' | 'cliSession' | 'openrouter' | 'ollama' | 'alibaba';
export type ApiProvider = 'anthropic' | 'openrouter' | 'ollama' | 'custom' | 'alibaba';

export interface ExecutionSettings {
	forkSession: boolean;
	additionalDirectories?: string[];
	maxTurns: number;
	treatAgentErrorsAsWorkflowErrors: boolean;
}

export interface ModelOverrides {
	openrouterSonnetModel: string;
	openrouterOpusModel: string;
	openrouterHaikuModel: string;
	alibabaSonnetModel: string;
	alibabaOpusModel: string;
	alibabaHaikuModel: string;
	ollamaModelOverride: string;
}

export interface ProxySetup {
	useProxyManager: boolean;
	httpProxyUrl: string;
	httpsProxyUrl: string;
	noProxy: string;
	caBundlePath: string;
}

export interface QuerySetupContext {
	allowedTools: string[];
	disallowedTools: string[];
	permissionMode: string;
	model: string;
	fastMode: boolean;
	executionSettings: ExecutionSettings;
	additionalOptions: AdditionalOptions;
	useClaudeCodePresetToggle?: boolean;
	claudeCodePromptSections: string[];
	modelOverrides: ModelOverrides;
	proxySetup: ProxySetup;
	betas: string[];
	correlationId?: string;
	apiProvider: ApiProvider;
	customApiEndpoint?: string;
	ollamaBaseUrl?: string;
	ollamaModel?: string;
}

export interface QuerySetupContextArgs {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	options: ExecuteTaskOptions;
	resolvedAuthMethod: ResolvedAuthMethod;
	workingDirectory: string;
	chatSessionId: string;
	sessionMemory?: ISessionMemory;
	resumeSessionId?: string;
	operatorPolicy: OperatorPolicy;
}

export interface EnvironmentArgs {
	context: QuerySetupContext;
	options: ExecuteTaskOptions;
	operatorPolicy: OperatorPolicy;
	workingDirectory: string;
	chatSessionId: string;
	resumeSessionId?: string;
	itemIndex: number;
	workflowId: string;
}

export interface StderrCapture {
	stderrOutput: string[];
	abortController: AbortController;
	stderr: (data: string) => void;
}

export interface PromptSetupArgs {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	context: QuerySetupContext;
	agents: Record<string, AgentDefinition>;
}

export interface PromptSetup {
	settingSources: SettingSource[];
	systemPrompt?: UpstreamQueryOptions['systemPrompt'];
	outputFormat?: UpstreamQueryOptions['outputFormat'];
	usesFullClaudeCodePreset: boolean;
}

export interface ThinkingSetup {
	thinking?: ThinkingConfig;
	legacyThinkingTokens: number;
	effort?: EffortLevel;
}

export interface QueryOptionsArgs {
	context: QuerySetupContext;
	env: UpstreamQueryOptions['env'];
	stderrCapture: StderrCapture;
	promptSetup: PromptSetup;
	thinkingSetup: ThinkingSetup;
	workingDirectory: string;
	chatSessionId: string;
	resumeSessionId?: string;
	cliExecutablePath?: string;
	hitlEnabled: boolean;
	operatorPolicy: OperatorPolicy;
}
