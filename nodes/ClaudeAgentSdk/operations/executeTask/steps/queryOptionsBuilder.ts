/**
 * Final queryOptions assembly for the Agent SDK query() call. Split out of
 * querySetupParts.ts (file-size guard).
 *
 * queryOptions is typed as NodeQueryOptions (upstream Options + managed-agent
 * extras) so non-canonical keys fail tsc instead of being silently dropped at
 * the SDK boundary.
 */

import type { IExecuteFunctions } from 'n8n-workflow';

import type { NodeQueryOptions, PermissionMode, UpstreamQueryOptions } from '../../../sdk/types';
import { resolvePermissionMode } from '../../../permissions/resolvePermissionMode';
import { parseManagedSettings, parseSkillsFilter } from './querySetupHelpers';
import {
	readBooleanParameter,
	readString,
	readStringListParameter,
	readTrimmedString,
} from './querySetupContext';
import type { PromptSetup, QueryOptionsArgs, QuerySetupContext } from './querySetupTypes';
import { applyResumeQueryOptions } from './resumeQueryOptions';

function setWhen<K extends keyof NodeQueryOptions>(
	queryOptions: NodeQueryOptions,
	condition: boolean,
	key: K,
	value: NodeQueryOptions[K],
): void {
	if (condition) {
		queryOptions[key] = value;
	}
}

function setDefined<K extends keyof NodeQueryOptions>(
	queryOptions: NodeQueryOptions,
	key: K,
	value: NodeQueryOptions[K] | undefined,
): void {
	setWhen(queryOptions, value !== undefined, key, value as NodeQueryOptions[K]);
}

function resolveModelOption(context: QuerySetupContext): string | undefined {
	if (context.apiProvider === 'ollama') return context.ollamaModel;
	if (context.apiProvider === 'alibaba') return context.modelOverrides.alibabaSonnetModel;
	if (context.apiProvider === 'litellm') return context.liteLlmModel;
	if (context.apiProvider === 'codemie') return context.codeMieModel;
	return context.model || undefined;
}

function applyFeatureOptions(
	queryOptions: NodeQueryOptions,
	context: QuerySetupContext,
	promptSetup: PromptSetup,
): void {
	const { additionalOptions } = context;
	setWhen(
		queryOptions,
		additionalOptions.includePartialMessages === true,
		'includePartialMessages',
		true,
	);
	setWhen(
		queryOptions,
		additionalOptions.forwardSubagentText === true,
		'forwardSubagentText',
		true,
	);
	setDefined(queryOptions, 'skills', parseSkillsFilter(additionalOptions.skillsFilter));
	setDefined(
		queryOptions,
		'managedSettings',
		parseManagedSettings(additionalOptions.managedSettings),
	);
	setWhen(
		queryOptions,
		Number(additionalOptions.maxBudgetUsd) > 0,
		'maxBudgetUsd',
		Number(additionalOptions.maxBudgetUsd),
	);
	setWhen(
		queryOptions,
		additionalOptions.enableFileCheckpointing === true,
		'enableFileCheckpointing',
		true,
	);
	// Fast mode rides on the fast-mode beta header (context.betas includes
	// FAST_MODE_BETA when enabled). The CLI accepts beta strings the SDK's
	// SdkBeta union has not caught up with yet — hence the cast.
	setWhen(
		queryOptions,
		context.betas.length > 0,
		'betas',
		context.betas as UpstreamQueryOptions['betas'],
	);
	setWhen(
		queryOptions,
		context.disallowedTools.length > 0,
		'disallowedTools',
		context.disallowedTools,
	);
	setWhen(queryOptions, additionalOptions.promptSuggestions === true, 'promptSuggestions', true);
	setWhen(queryOptions, additionalOptions.persistSession === false, 'persistSession', false);
	setDefined(queryOptions, 'outputFormat', promptSetup.outputFormat);
}

function applySessionOptions(
	queryOptions: NodeQueryOptions,
	context: QuerySetupContext,
	chatSessionId: string,
	resumeSessionId: string | undefined,
): void {
	const sessionTitle = readTrimmedString(context.additionalOptions.sessionTitle);
	const shouldResume = Boolean(context.additionalOptions.persistSession !== false && resumeSessionId);
	if (shouldResume && resumeSessionId) {
		applyResumeQueryOptions(queryOptions, resumeSessionId);
		return;
	}

	setWhen(queryOptions, Boolean(sessionTitle && !resumeSessionId), 'title', sessionTitle);
	setWhen(queryOptions, Boolean(chatSessionId && !resumeSessionId), 'sessionId', chatSessionId);
	setWhen(queryOptions, context.executionSettings.forkSession && !resumeSessionId, 'forkSession', true);
}

export function buildQueryOptions(
	args: QueryOptionsArgs,
): { queryOptions: NodeQueryOptions; permissionMode: PermissionMode } {
	const { context, promptSetup, thinkingSetup } = args;
	// Single source of truth for the initial permission-mode resolution:
	// operator allowlist clamp + HITL-enabled downgrade + dangerous-skip flag.
	const permission = resolvePermissionMode({
		requestedMode: context.permissionMode,
		hitlEnabled: args.hitlEnabled,
		allowedPermissionModes: args.operatorPolicy.allowedPermissionModes,
	});
	const queryOptions: NodeQueryOptions = {
		permissionMode: permission.mode,
		env: args.env,
		stderr: args.stderrCapture.stderr,
		abortController: args.stderrCapture.abortController,
	};

	setWhen(
		queryOptions,
		permission.allowDangerouslySkipPermissions,
		'allowDangerouslySkipPermissions',
		true,
	);
	setWhen(queryOptions, context.allowedTools.length > 0, 'allowedTools', context.allowedTools);
	setDefined(queryOptions, 'cwd', args.workingDirectory || undefined);
	setDefined(
		queryOptions,
		'additionalDirectories',
		context.executionSettings.additionalDirectories,
	);
	setWhen(
		queryOptions,
		context.executionSettings.maxTurns > 0,
		'maxTurns',
		context.executionSettings.maxTurns,
	);
	setWhen(
		queryOptions,
		promptSetup.settingSources.length > 0,
		'settingSources',
		promptSetup.settingSources,
	);
	setDefined(queryOptions, 'systemPrompt', promptSetup.systemPrompt);
	setWhen(queryOptions, !promptSetup.usesFullClaudeCodePreset, 'tools', {
		type: 'preset',
		preset: 'claude_code',
	});
	setDefined(queryOptions, 'thinking', thinkingSetup.thinking);
	setWhen(
		queryOptions,
		!thinkingSetup.thinking && thinkingSetup.legacyThinkingTokens > 0,
		'maxThinkingTokens',
		thinkingSetup.legacyThinkingTokens,
	);
	setDefined(queryOptions, 'effort', thinkingSetup.effort);
	setDefined(queryOptions, 'model', resolveModelOption(context));
	applyFeatureOptions(queryOptions, context, promptSetup);
	applySessionOptions(queryOptions, context, args.chatSessionId, args.resumeSessionId);
	setDefined(queryOptions, 'pathToClaudeCodeExecutable', args.cliExecutablePath);
	return { queryOptions, permissionMode: permission.mode };
}

function readPluginPaths(execFunctions: IExecuteFunctions, itemIndex: number): string[] {
	const selectedPlugins = readStringListParameter(
		execFunctions,
		itemIndex,
		'selectedPlugins',
	).filter((plugin) => plugin !== '__none__');
	const additionalPluginPaths =
		readString(execFunctions.getNodeParameter('additionalPluginPaths', itemIndex, ''))
			?.split(',')
			.map((path) => path.trim())
			.filter(Boolean) ?? [];
	return [...selectedPlugins, ...additionalPluginPaths];
}

export function applyPluginOptions(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	queryOptions: NodeQueryOptions;
}): void {
	const enablePlugins = readBooleanParameter(
		args.execFunctions,
		args.itemIndex,
		'enablePlugins',
		false,
	);
	if (!enablePlugins) return;

	const pluginPaths = readPluginPaths(args.execFunctions, args.itemIndex);
	setWhen(
		args.queryOptions,
		pluginPaths.length > 0,
		'plugins',
		pluginPaths.map((path) => ({ type: 'local' as const, path })),
	);
}
