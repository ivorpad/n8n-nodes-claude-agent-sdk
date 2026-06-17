/**
 * Node-parameter readers, provider/proxy validation, and the query-setup
 * context builder. Split out of querySetupParts.ts (file-size guard).
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';

import type { AdditionalOptions, ISessionMemory } from '../../../types';
import type { OperatorPolicy } from '../../../permissions/policy';
import { addFastModeBeta, supportsOpusFastMode } from '../../../claudeModels';
import { parseClaudeCodePromptSections } from './querySetupHelpers';
import type {
	ApiProvider,
	ExecutionSettings,
	ModelOverrides,
	ProxySetup,
	QuerySetupContext,
	QuerySetupContextArgs,
	ResolvedAuthMethod,
} from './querySetupTypes';

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

export function readTrimmedString(value: unknown): string | undefined {
	const stringValue = readString(value)?.trim();
	return stringValue && stringValue.length > 0 ? stringValue : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((item): item is string => typeof item === 'string');
	return strings.length > 0 ? strings : undefined;
}

function readApiProvider(value: unknown): ApiProvider | undefined {
	if (
		value === 'anthropic' ||
		value === 'openrouter' ||
		value === 'ollama' ||
		value === 'custom' ||
		value === 'alibaba'
	) {
		return value;
	}
	return undefined;
}

function readEnvSecurityMode(value: unknown): AdditionalOptions['envSecurityMode'] {
	return value === 'blocklist' || value === 'allowlist' ? value : undefined;
}

function readClaudeConfigIsolationMode(
	value: unknown,
): AdditionalOptions['claudeConfigIsolationMode'] {
	return value === 'perWorkflow' || value === 'perSession' ? value : undefined;
}

function readAdditionalOptions(value: unknown): AdditionalOptions {
	const raw = isRecord(value) ? value : {};
	return {
		apiProvider: readApiProvider(raw.apiProvider),
		customApiEndpoint: readTrimmedString(raw.customApiEndpoint),
		ollamaBaseUrl: readTrimmedString(raw.ollamaBaseUrl),
		ollamaModel: readTrimmedString(raw.ollamaModel),
		useProxyManager: readBoolean(raw.useProxyManager),
		proxyHttpUrl: readString(raw.proxyHttpUrl),
		proxyHttpsUrl: readString(raw.proxyHttpsUrl),
		proxyNoProxy: readString(raw.proxyNoProxy),
		proxyCaBundlePath: readString(raw.proxyCaBundlePath),
		envSecurityMode: readEnvSecurityMode(raw.envSecurityMode),
		allowedEnvVarNames: readString(raw.allowedEnvVarNames),
		claudeConfigDir: readString(raw.claudeConfigDir),
		isolateClaudeConfigDir: readBoolean(raw.isolateClaudeConfigDir),
		claudeConfigIsolationMode: readClaudeConfigIsolationMode(raw.claudeConfigIsolationMode),
		env: readString(raw.env),
		includePartialMessages: readBoolean(raw.includePartialMessages),
		forwardSubagentText: readBoolean(raw.forwardSubagentText),
		loadProjectClaudeMd: readBoolean(raw.loadProjectClaudeMd),
		loadUserSettings: readBoolean(raw.loadUserSettings),
		useClaudeCodePreset: readBoolean(raw.useClaudeCodePreset),
		claudeCodePromptSections: readStringArray(raw.claudeCodePromptSections),
		maxThinkingTokens: readNumber(raw.maxThinkingTokens),
		systemPrompt: readString(raw.systemPrompt),
		maxBudgetUsd: readNumber(raw.maxBudgetUsd),
		enableFileCheckpointing: readBoolean(raw.enableFileCheckpointing),
		betas: readStringArray(raw.betas),
		correlationId: readString(raw.correlationId),
		promptSuggestions: readBoolean(raw.promptSuggestions),
		persistSession: readBoolean(raw.persistSession),
		maxBufferSizeMb: readNumber(raw.maxBufferSizeMb),
		sessionTitle: readString(raw.sessionTitle),
		skillsFilter: readString(raw.skillsFilter),
		managedSettings: readString(raw.managedSettings),
	};
}

export function readStringListParameter(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	name: string,
): string[] {
	return readStringArray(execFunctions.getNodeParameter(name, itemIndex, [])) ?? [];
}

export function readStringParameter(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	name: string,
	defaultValue: string,
): string {
	return readString(execFunctions.getNodeParameter(name, itemIndex, defaultValue)) ?? defaultValue;
}

export function readBooleanParameter(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	name: string,
	defaultValue: boolean,
): boolean {
	return readBoolean(execFunctions.getNodeParameter(name, itemIndex, defaultValue)) ?? defaultValue;
}

export function readNumberParameter(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	name: string,
	defaultValue: number,
): number {
	return readNumber(execFunctions.getNodeParameter(name, itemIndex, defaultValue)) ?? defaultValue;
}

function parseAdditionalDirectories(value: unknown): string[] | undefined {
	const directories = readString(value)
		?.split(',')
		.map((path) => path.trim())
		.filter(Boolean);
	return directories && directories.length > 0 ? directories : undefined;
}

function readExecutionSettings(value: unknown): ExecutionSettings {
	const raw = isRecord(value) ? value : {};
	return {
		forkSession: readBoolean(raw.forkSession) ?? false,
		additionalDirectories: parseAdditionalDirectories(raw.additionalDirectories),
		maxTurns: readNumber(raw.maxTurns) ?? 0,
		treatAgentErrorsAsWorkflowErrors: readBoolean(raw.treatAgentErrorsAsWorkflowErrors) ?? false,
	};
}

function validateForkSession(args: {
	forkSession: boolean;
	sessionMemory?: ISessionMemory;
	chatSessionId: string;
	resumeSessionId?: string;
}): void {
	if (!args.forkSession) return;
	if (!args.sessionMemory) {
		throw new ApplicationError(
			'Fork Session requires a Memory node to be connected. ' +
				'Please connect a Session Memory node (Simple, Redis, or Postgres) to store and retrieve session IDs.',
		);
	}
	if (!args.chatSessionId) {
		throw new ApplicationError(
			'Fork Session requires a Chat Session ID to identify the session to fork from. ' +
				'Please provide a Chat Session ID.',
		);
	}
	if (!args.resumeSessionId) {
		throw new ApplicationError(
			'Fork Session requires an existing session to fork from. ' +
				`No session found for Chat Session ID "${args.chatSessionId}". ` +
				'Run the workflow at least once without Fork Session enabled to create a session first.',
		);
	}
}

function readModelOverrides(execFunctions: IExecuteFunctions, itemIndex: number): ModelOverrides {
	return {
		openrouterSonnetModel: readStringParameter(
			execFunctions,
			itemIndex,
			'openrouterSonnetModel',
			'',
		),
		openrouterOpusModel: readStringParameter(execFunctions, itemIndex, 'openrouterOpusModel', ''),
		openrouterHaikuModel: readStringParameter(execFunctions, itemIndex, 'openrouterHaikuModel', ''),
		alibabaSonnetModel: readStringParameter(execFunctions, itemIndex, 'alibabaSonnetModel', ''),
		alibabaOpusModel: readStringParameter(execFunctions, itemIndex, 'alibabaOpusModel', ''),
		alibabaHaikuModel: readStringParameter(execFunctions, itemIndex, 'alibabaHaikuModel', ''),
		ollamaModelOverride: readStringParameter(execFunctions, itemIndex, 'ollamaModel', ''),
	};
}

function validateProxyUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.username.length > 0 || parsed.password.length > 0;
	} catch {
		return false;
	}
}

function validateProxySetup(args: {
	requestedUseProxyManager: boolean;
	sandboxEnablesProxyManager: boolean;
	useProxyManager: boolean;
	httpProxyUrl: string;
	httpsProxyUrl: string;
}): void {
	if (args.requestedUseProxyManager && !args.sandboxEnablesProxyManager) {
		throw new ApplicationError(
			'Proxy Manager is enabled, but sandboxing is disabled. Enable Sandbox or operator policy force-sandboxing.',
		);
	}
	if (args.useProxyManager && !args.httpProxyUrl && !args.httpsProxyUrl) {
		throw new ApplicationError(
			'Proxy Manager is enabled, but no proxy URL is configured. Set Proxy HTTP URL and/or Proxy HTTPS URL.',
		);
	}
	if (args.useProxyManager && [args.httpProxyUrl, args.httpsProxyUrl].some(validateProxyUrl)) {
		console.warn(
			'[Claude Agent SDK] Proxy URL contains inline credentials. Prefer Secure Environment Variables for secrets.',
		);
	}
}

function buildProxySetup(args: {
	additionalOptions: AdditionalOptions;
	enableSandbox: boolean;
	operatorPolicy: OperatorPolicy;
}): ProxySetup {
	const sandboxEnablesProxyManager = args.enableSandbox || args.operatorPolicy.forceSandbox;
	const requestedUseProxyManager = args.additionalOptions.useProxyManager ?? false;
	const useProxyManager = requestedUseProxyManager && sandboxEnablesProxyManager;
	const httpProxyUrl = (args.additionalOptions.proxyHttpUrl ?? '').trim();
	const httpsProxyUrl = (args.additionalOptions.proxyHttpsUrl ?? '').trim();

	validateProxySetup({
		requestedUseProxyManager,
		sandboxEnablesProxyManager,
		useProxyManager,
		httpProxyUrl,
		httpsProxyUrl,
	});

	return {
		useProxyManager,
		httpProxyUrl,
		httpsProxyUrl,
		noProxy: (args.additionalOptions.proxyNoProxy ?? '').trim(),
		caBundlePath: (args.additionalOptions.proxyCaBundlePath ?? '').trim(),
	};
}

function normalizeBetas(value: string[] | undefined): string[] {
	return (value ?? []).map((beta) =>
		beta === '1m_context_window' ? 'context-1m-2025-08-07' : beta,
	);
}

function resolveApiProvider(
	additionalOptions: AdditionalOptions,
	resolvedAuthMethod: ResolvedAuthMethod,
): ApiProvider {
	if (resolvedAuthMethod === 'openrouter') return 'openrouter';
	if (resolvedAuthMethod === 'alibaba') return 'alibaba';
	if (resolvedAuthMethod === 'ollama') return 'ollama';
	return additionalOptions.apiProvider ?? 'anthropic';
}

function validateOllamaBaseUrl(baseUrl: string): void {
	try {
		new URL(baseUrl);
	} catch {
		throw new ApplicationError(
			`Invalid Ollama Base URL: "${baseUrl}". ` +
				'Please provide a valid URL (e.g., http://localhost:11434).',
		);
	}
	if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
		console.warn(
			'[Claude Agent SDK] Warning: Ollama Base URL uses localhost. ' +
				'If running in Docker, use host.docker.internal instead of localhost ' +
				'to access services on the host machine.',
		);
	}
}

function validateProviderRequest(args: {
	apiProvider: ApiProvider;
	customApiEndpoint?: string;
	ollamaBaseUrl?: string;
}): void {
	if (args.apiProvider === 'custom' && !args.customApiEndpoint) {
		throw new ApplicationError(
			'Custom API Endpoint is required when using Custom Endpoint provider. ' +
				'Please specify the endpoint URL in Additional Options.',
		);
	}
	if (args.apiProvider === 'ollama') {
		validateOllamaBaseUrl(args.ollamaBaseUrl || 'http://localhost:11434');
	}
}

function validateFastModeRequest(args: {
	fastMode: boolean;
	apiProvider: ApiProvider;
	model: string;
}): void {
	if (!args.fastMode) return;
	if (args.apiProvider !== 'anthropic' || !supportsOpusFastMode(args.model)) {
		throw new ApplicationError(
			'Fast Mode is a Claude API research preview for supported Opus models only. Disable Fast Mode or choose a supported Opus model on the Anthropic API provider.',
		);
	}
}

export function buildQuerySetupContext(args: QuerySetupContextArgs): QuerySetupContext {
	const additionalOptions = readAdditionalOptions(
		args.execFunctions.getNodeParameter('additionalOptions', args.itemIndex, {}),
	);
	const executionSettings = readExecutionSettings(
		args.execFunctions.getNodeParameter('executionSettings', args.itemIndex, {}),
	);
	validateForkSession({
		forkSession: executionSettings.forkSession,
		sessionMemory: args.sessionMemory,
		chatSessionId: args.chatSessionId,
		resumeSessionId: args.resumeSessionId,
	});

	const enableSandbox = readBooleanParameter(
		args.execFunctions,
		args.itemIndex,
		'enableSandbox',
		false,
	);
	const modelOverrides = readModelOverrides(args.execFunctions, args.itemIndex);
	const apiProvider = resolveApiProvider(additionalOptions, args.resolvedAuthMethod);
	const customApiEndpoint = additionalOptions.customApiEndpoint;
	const ollamaBaseUrl = args.options.ollamaBaseUrl || additionalOptions.ollamaBaseUrl;
	validateProviderRequest({ apiProvider, customApiEndpoint, ollamaBaseUrl });
	const model = readStringParameter(args.execFunctions, args.itemIndex, 'model', '');
	const fastMode = readBooleanParameter(args.execFunctions, args.itemIndex, 'fastMode', false);
	validateFastModeRequest({ fastMode, apiProvider, model });
	const normalizedBetas = normalizeBetas(additionalOptions.betas);

	return {
		allowedTools: readStringListParameter(args.execFunctions, args.itemIndex, 'allowedTools'),
		disallowedTools: readStringListParameter(args.execFunctions, args.itemIndex, 'disallowedTools'),
		permissionMode: readStringParameter(
			args.execFunctions,
			args.itemIndex,
			'permissionMode',
			'default',
		),
		model,
		fastMode,
		executionSettings,
		additionalOptions,
		useClaudeCodePresetToggle: readBoolean(
			args.execFunctions.getNode().parameters.useClaudeCodePreset,
		),
		claudeCodePromptSections: parseClaudeCodePromptSections(
			additionalOptions.claudeCodePromptSections,
		),
		modelOverrides,
		proxySetup: buildProxySetup({
			additionalOptions,
			enableSandbox,
			operatorPolicy: args.operatorPolicy,
		}),
		betas: fastMode ? addFastModeBeta(normalizedBetas) : normalizedBetas,
		correlationId: readTrimmedString(additionalOptions.correlationId),
		apiProvider,
		customApiEndpoint,
		ollamaBaseUrl,
		ollamaModel: modelOverrides.ollamaModelOverride || additionalOptions.ollamaModel,
	};
}
