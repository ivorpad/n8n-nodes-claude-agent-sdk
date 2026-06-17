/**
 * Environment, stderr capture, prompt setup, and CLI path resolution for
 * query setup.
 *
 * Formerly also held parameter readers, thinking resolution, and the final
 * options assembly — those now live in querySetupContext.ts,
 * queryThinkingSetup.ts, and queryOptionsBuilder.ts (file-size guard).
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';

import { usesFullClaudeCodePromptPreset } from '../../../claudeCodePromptSections';
import type { AdditionalOptions } from '../../../types';
import { buildEnvironment, buildStructuredOutputConfig, buildSystemPromptConfig } from '../config';
import { createSecretsRedactor, collectSecretsForRedaction } from '../secretsRedaction';
import { buildSubagentInstructions } from '../subagents';
import type { ExecuteTaskOptions } from '../types';
import { parseCommaSeparatedNames, resolveIsolatedClaudeConfigDir } from './querySetupHelpers';
import { isRecord, readTrimmedString } from './querySetupContext';
import type {
	ApiProvider,
	EnvironmentArgs,
	PromptSetup,
	PromptSetupArgs,
	StderrCapture,
} from './querySetupTypes';
import type { SettingSource, UpstreamQueryOptions } from '../../../sdk/types';
import { resolveNpmClaudeCodeExecutable } from '../../../sdk/claudeCodeExecutable';

export { buildQuerySetupContext } from './querySetupContext';
export { buildThinkingSetup } from './queryThinkingSetup';
export { applyPluginOptions, buildQueryOptions } from './queryOptionsBuilder';

function resolveClaudeConfigDir(args: EnvironmentArgs): string | undefined {
	return (
		args.context.additionalOptions.claudeConfigDir?.trim() ||
		resolveIsolatedClaudeConfigDir({
			isolate: args.context.additionalOptions.isolateClaudeConfigDir,
			mode: args.context.additionalOptions.claudeConfigIsolationMode,
			workingDirectory: args.workingDirectory,
			workflowId: args.workflowId,
			chatSessionId: args.chatSessionId,
			resumeSessionId: args.resumeSessionId,
			itemIndex: args.itemIndex,
		})
	);
}

function validateProviderEnvironment(apiProvider: ApiProvider, env: Record<string, unknown>): void {
	if (apiProvider === 'openrouter' && !env.ANTHROPIC_AUTH_TOKEN) {
		throw new ApplicationError(
			'OpenRouter requires an API key. ' +
				'Please provide your OpenRouter API key in OpenRouter credentials, ' +
				'and leave the Anthropic API key credential empty.',
		);
	}
	if (apiProvider === 'alibaba' && !env.ANTHROPIC_AUTH_TOKEN) {
		throw new ApplicationError(
			'Alibaba Coding Plan requires an API key. ' +
				'Please provide your Alibaba Coding Plan API key in Alibaba credentials.',
		);
	}
	if (apiProvider === 'alibaba' && !env.ANTHROPIC_MODEL) {
		throw new ApplicationError(
			'Alibaba Coding Plan requires a model to be selected. ' +
				'Please select at least a Sonnet Model in the Alibaba Coding Plan model tier dropdowns.',
		);
	}
	if (apiProvider === 'litellm' && !env.ANTHROPIC_AUTH_TOKEN) {
		throw new ApplicationError(
			'LiteLLM requires an API key. Please provide your LiteLLM proxy API key in LiteLLM credentials.',
		);
	}
	if (apiProvider === 'litellm' && !env.ANTHROPIC_MODEL) {
		throw new ApplicationError(
			'LiteLLM requires a model alias. Select one from the LiteLLM Model dropdown or type a LiteLLM Model Alias.',
		);
	}
	if (apiProvider === 'codemie' && !env.ANTHROPIC_AUTH_TOKEN) {
		throw new ApplicationError(
			'CodeMie Proxy is not ready. Authenticate the CodeMie SSO credential (enter the Instance URL, ' +
				'open the Authenticate link, paste the token, and click Test) and try again.',
		);
	}
	if (apiProvider === 'codemie' && !env.ANTHROPIC_MODEL) {
		throw new ApplicationError(
			'CodeMie Proxy requires a model. Select one from the CodeMie Model dropdown or type a Manual Model.',
		);
	}
}

export function buildQueryEnvironment(args: EnvironmentArgs): UpstreamQueryOptions['env'] {
	const { context, options } = args;
	const env = buildEnvironment({
		apiKey: options.apiKey,
		additionalEnv: context.additionalOptions.env,
		apiProvider: context.apiProvider,
		customApiEndpoint: context.customApiEndpoint,
		ollamaBaseUrl: context.ollamaBaseUrl,
		openrouterAuthToken: options.openrouterAuthToken,
		openrouterBaseUrl: options.openrouterBaseUrl,
		ollamaAuthToken: options.ollamaAuthToken,
		openrouterSonnetModel: context.modelOverrides.openrouterSonnetModel,
		openrouterOpusModel: context.modelOverrides.openrouterOpusModel,
		openrouterHaikuModel: context.modelOverrides.openrouterHaikuModel,
		alibabaAuthToken: options.alibabaAuthToken,
		alibabaBaseUrl: options.alibabaBaseUrl,
		alibabaSonnetModel: context.modelOverrides.alibabaSonnetModel,
		alibabaOpusModel: context.modelOverrides.alibabaOpusModel,
		alibabaHaikuModel: context.modelOverrides.alibabaHaikuModel,
		secureEnv: options.secureEnv,
		environmentSecurity: {
			envSecurityMode: context.additionalOptions.envSecurityMode,
			allowedEnvVarNames: parseCommaSeparatedNames(context.additionalOptions.allowedEnvVarNames),
			policyAllowedEnvVarNames: args.operatorPolicy.allowedEnvVarNames,
			claudeConfigDir: resolveClaudeConfigDir(args),
		},
		proxyManager: {
			enabled: context.proxySetup.useProxyManager,
			httpProxyUrl: context.proxySetup.httpProxyUrl,
			httpsProxyUrl: context.proxySetup.httpsProxyUrl,
			noProxy: context.proxySetup.noProxy,
			caBundlePath: context.proxySetup.caBundlePath,
		},
		anthropicBaseUrl: options.anthropicBaseUrl,
		liteLlmAuthToken: options.liteLlmAuthToken,
		liteLlmBaseUrl: options.liteLlmBaseUrl,
		liteLlmModel: context.liteLlmModel,
		codeMieBaseUrl: options.codeMieBaseUrl,
		codeMieAuthToken: options.codeMieAuthToken,
		codeMieModel: context.codeMieModel,
	});
	validateProviderEnvironment(context.apiProvider, env);
	return env;
}

function hasCancelSignal(
	execFunctions: IExecuteFunctions,
): execFunctions is IExecuteFunctions & { getExecutionCancelSignal: () => AbortSignal } {
	return (
		'getExecutionCancelSignal' in execFunctions &&
		typeof execFunctions.getExecutionCancelSignal === 'function'
	);
}

function hasCancelCallback(
	execFunctions: IExecuteFunctions,
): execFunctions is IExecuteFunctions & { onExecutionCancellation: (cb: () => void) => void } {
	return (
		'onExecutionCancellation' in execFunctions &&
		typeof execFunctions.onExecutionCancellation === 'function'
	);
}

export function createStderrCapture(
	execFunctions: IExecuteFunctions,
	options: ExecuteTaskOptions,
): StderrCapture {
	const stderrOutput: string[] = [];
	const secretRedactor = createSecretsRedactor(collectSecretsForRedaction(options));
	const abortController = new AbortController();

	if (hasCancelSignal(execFunctions)) {
		const cancelSignal = execFunctions.getExecutionCancelSignal();
		if (!cancelSignal) {
			// Older n8n runtimes may expose the method without an active signal.
		} else if (cancelSignal.aborted) {
			abortController.abort();
		} else {
			cancelSignal.addEventListener('abort', () => abortController.abort());
		}
	}
	if (hasCancelCallback(execFunctions)) {
		execFunctions.onExecutionCancellation(() => abortController.abort());
	}

	return {
		stderrOutput,
		abortController,
		stderr: (data: string) => {
			stderrOutput.push(secretRedactor.redactString(data));
		},
	};
}

function buildSettingSources(additionalOptions: AdditionalOptions): SettingSource[] {
	return [
		additionalOptions.loadProjectClaudeMd ? ('project' as const) : undefined,
		additionalOptions.loadUserSettings ? ('user' as const) : undefined,
	].filter((source): source is 'project' | 'user' => Boolean(source));
}

function warnWhenSkillSettingsMissing(allowedTools: string[], settingSources: string[]): void {
	if (!allowedTools.includes('Skill') || settingSources.length > 0) return;
	console.warn(
		'[Claude Agent SDK] Warning: "Skill" is in allowed tools but no settings sources are enabled. ' +
			'Skills require "Load Project CLAUDE.md" or "Load User Settings" to be enabled in Additional Options.',
	);
}

export function buildPromptSetup(args: PromptSetupArgs): PromptSetup {
	const settingSources = buildSettingSources(args.context.additionalOptions);
	warnWhenSkillSettingsMissing(args.context.allowedTools, settingSources);

	const outputFormat = buildStructuredOutputConfig(args.execFunctions, args.itemIndex);
	const structuredOutputHint = outputFormat
		? '\n\nIMPORTANT: Before completing your response, you MUST call the StructuredOutput tool to produce your final answer in the required JSON format. Never end the conversation without producing structured output.'
		: '';
	const useClaudeCodePreset =
		args.context.useClaudeCodePresetToggle ??
		args.context.additionalOptions.useClaudeCodePreset !== false;
	const usesFullClaudeCodePreset = usesFullClaudeCodePromptPreset({
		useClaudeCodePreset,
		selectedSections: args.context.claudeCodePromptSections,
	});

	return {
		settingSources,
		systemPrompt: buildSystemPromptConfig(
			settingSources,
			args.context.additionalOptions.systemPrompt,
			buildSubagentInstructions(args.agents) + structuredOutputHint,
			useClaudeCodePreset,
			args.context.claudeCodePromptSections,
			{
				allowedTools: args.context.allowedTools,
				settingSources,
			},
		),
		outputFormat,
		usesFullClaudeCodePreset,
	};
}

export async function resolveCliExecutablePath(
	execFunctions: IExecuteFunctions,
): Promise<string | undefined> {
	try {
		const cliCredentials = await execFunctions.getCredentials('claudeApi');
		const configuredPath = isRecord(cliCredentials)
			? readTrimmedString(cliCredentials.executablePath)
			: undefined;
		return configuredPath ?? resolveNpmClaudeCodeExecutable();
	} catch {
		return resolveNpmClaudeCodeExecutable();
	}
}
