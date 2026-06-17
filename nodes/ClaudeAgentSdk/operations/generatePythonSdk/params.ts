/**
 * Node-parameter extraction for the generated Python SDK script.
 * Split out of generatePythonSdk/index.ts (file-size guard).
 */

import type { IExecuteFunctions } from 'n8n-workflow';

import type { McpServerUI, SubagentUI } from '../../types';
import { buildStructuredOutputConfig } from '../executeTask/config';
import { resolveAuthMethod } from '../../authMethod';
import type { AuthMethod } from '../../authMethod';

export type SupportedApiProvider = 'anthropic' | 'openrouter' | 'ollama' | 'custom' | 'alibaba';

function resolveApiProvider(preferred: SupportedApiProvider, authMethod: AuthMethod): SupportedApiProvider {
	if (authMethod === 'openrouter' || authMethod === 'ollama' || authMethod === 'alibaba') {
		return authMethod;
	}
	return preferred;
}

function parseClaudeCodePromptSections(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
	}

	return [];
}

function sanitizePathSegment(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return 'default';
	const sanitized = trimmed
		.replace(/\\/g, '-')
		.replace(/\//g, '-')
		.replace(/:/g, '-')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
	return sanitized || 'default';
}

function resolveIsolatedClaudeConfigDir(args: {
	workingDirectory: string;
	chatSessionId: string;
	itemIndex: number;
	isolate: boolean;
	mode: 'perWorkflow' | 'perSession';
}): string {
	const { workingDirectory, chatSessionId, itemIndex, isolate, mode } = args;
	if (!isolate || !workingDirectory) return '';

	const normalizedWorkingDirectory = workingDirectory.replace(/\/$/, '');
	const base = `${normalizedWorkingDirectory}/.claude-n8n`;
	if (mode === 'perSession') {
		const sessionKey = sanitizePathSegment(chatSessionId || `item-${itemIndex}`);
		return `${base}/${sessionKey}`;
	}
	return base;
}

export interface ExtractedParams {
	authMethod: AuthMethod;
	taskDescription: string;
	workingDirectory: string;
	chatSessionId: string;
	model: string;
	permissionMode: string;
	thinkingMode: string;
	thinkingBudgetTokens: number;
	effort: string;
	allowedTools: string[];
	disallowedTools: string[];
	maxTurns: number;
	forkSession: boolean;
	additionalDirectories: string;
	enableMcpServers: boolean;
	mcpServers: McpServerUI[];
	enableSubagents: boolean;
	subagents: SubagentUI[];
	structuredOutput: boolean;
	outputFormat: { type: string; schema: Record<string, unknown> } | undefined;
	enableStreaming: boolean;
	systemPrompt: string;
	env: string;
	maxBudgetUsd: number;
	includePartialMessages: boolean;
	enableFileCheckpointing: boolean;
	betas: string[];
	loadProjectClaudeMd: boolean;
	loadUserSettings: boolean;
	claudeCodePromptSections: string[];
	maxThinkingTokens: number;
	// API provider & endpoint configuration
	userPromptContext: string;
	apiProvider: SupportedApiProvider;
	customApiEndpoint: string;
	ollamaBaseUrl: string;
	ollamaModel: string;
	openrouterSonnetModel: string;
	openrouterOpusModel: string;
	openrouterHaikuModel: string;
	alibabaSonnetModel: string;
	alibabaOpusModel: string;
	alibabaHaikuModel: string;
	blockedTools: string;
	claudeConfigDir: string;
	useClaudeCodePreset: boolean;
	envSecurityMode: 'blocklist' | 'allowlist';
	allowedEnvVarNames: string;
	isolateClaudeConfigDir: boolean;
	claudeConfigIsolationMode: 'perWorkflow' | 'perSession';
	useSecureEnv: boolean;
	correlationId: string;
	promptSuggestions: boolean;
	persistSession: boolean;
	fastMode: boolean;
	skillsFilter: string;
	sessionTitle: string;
	enableHookHandlers: boolean;
	n8nMcpEnabled: boolean;
	// Proxy settings
	useProxyManager: boolean;
	proxyHttpUrl: string;
	proxyHttpsUrl: string;
	proxyNoProxy: string;
	proxyCaBundlePath: string;
	maxBufferSizeMb: number;
	plugins: string[];
}

export function readAllParams(ctx: IExecuteFunctions, i: number): ExtractedParams {
	const get = <T>(name: string, def: T): T => {
		try {
			return ctx.getNodeParameter(name, i, def) as T;
		} catch {
			return def;
		}
	};

	const additionalOptions = get<Record<string, unknown>>('additionalOptions', {});
	const rawNodeParameters = (((ctx.getNode as (() => { parameters?: Record<string, unknown> }) | undefined)?.())?.parameters ??
		{}) as Record<string, unknown>;
	const topLevelUseClaudeCodePreset =
		typeof rawNodeParameters.useClaudeCodePreset === 'boolean'
			? rawNodeParameters.useClaudeCodePreset
			: undefined;
	const configuredClaudeCodePromptSections = parseClaudeCodePromptSections(
		additionalOptions.claudeCodePromptSections,
	);
	const executionSettings = get<Record<string, unknown>>('executionSettings', {});
	const authentication = get<string>('authentication', 'predefinedCredentialType');
	const nodeCredentialType = get<string>('nodeCredentialType', 'claudeApi');
	const authMethod = resolveAuthMethod(authentication, nodeCredentialType);
	const chatSessionId = get<string>('chatSessionId', '') || '';

	const enableMcpServers = get<boolean>('enableMcpServers', false);
	let mcpServers: McpServerUI[] = [];
	if (enableMcpServers) {
		const mcpConfig = get<{ servers?: McpServerUI[] }>('mcpServers', {});
		mcpServers = mcpConfig.servers || [];
	}

	const enableSubagents = get<boolean>('enableSubagents', false);
	let subagents: SubagentUI[] = [];
	if (enableSubagents) {
		const subagentsConfig = get<{ agents?: SubagentUI[] }>('subagents', {});
		subagents = subagentsConfig.agents || [];
	}

	const structuredOutput = get<boolean>('structuredOutput', false);
	let outputFormat: { type: string; schema: Record<string, unknown> } | undefined;
	if (structuredOutput) {
		outputFormat = buildStructuredOutputConfig(ctx, i) as
			| { type: string; schema: Record<string, unknown> }
			| undefined;
	}

	const preferredProvider = (additionalOptions.apiProvider as SupportedApiProvider) || 'anthropic';
	const apiProvider = resolveApiProvider(preferredProvider, authMethod);

	const rawClaudeConfigDir = ((additionalOptions.claudeConfigDir as string) || '').trim();
	const claudeConfigIsolationMode =
		((additionalOptions.claudeConfigIsolationMode as 'perWorkflow' | 'perSession') || 'perWorkflow');
	const isolateClaudeConfigDir = additionalOptions.isolateClaudeConfigDir === true && !rawClaudeConfigDir;
	const resolvedClaudeConfigDir = rawClaudeConfigDir || resolveIsolatedClaudeConfigDir({
		workingDirectory: get<string>('workingDirectory', '') || '',
		chatSessionId,
		itemIndex: i,
		isolate: isolateClaudeConfigDir,
		mode: claudeConfigIsolationMode,
	});

	const ollamaModelOverride = get<string>('ollamaModel', '').trim();
	const ollamaModelFromAdditional = ((additionalOptions.ollamaModel as string) || '').trim();
	const ollamaModel = ollamaModelOverride || ollamaModelFromAdditional;

	const enablePlugins = get<boolean>('enablePlugins', false);
	const selectedPlugins = enablePlugins
		? (get<string[]>('selectedPlugins', []) || []).filter((v) => v && v !== '__none__')
		: [];
	const additionalPluginPaths = enablePlugins ? (get<string>('additionalPluginPaths', '') || '') : '';
	const pluginPaths = new Set<string>(selectedPlugins);
	for (const path of additionalPluginPaths.split(',').map((s) => s.trim()).filter(Boolean)) {
		pluginPaths.add(path);
	}

	return {
		authMethod,
		taskDescription: get<string>('taskDescription', '') || '',
		workingDirectory: get<string>('workingDirectory', '') || '',
		chatSessionId,
		model: get<string>('model', '') || '',
		permissionMode: get<string>('permissionMode', 'default') || 'default',
		thinkingMode: get<string>('thinkingMode', 'default') || 'default',
		thinkingBudgetTokens: get<number>('thinkingBudgetTokens', 10000),
		effort: get<string>('effort', '') || '',
		allowedTools: get<string[]>('allowedTools', []) || [],
		disallowedTools: get<string[]>('disallowedTools', []) || [],
		maxTurns: (executionSettings.maxTurns as number) || 0,
		forkSession: (executionSettings.forkSession as boolean) || false,
		additionalDirectories: (executionSettings.additionalDirectories as string) || '',
		enableMcpServers,
		mcpServers,
		enableSubagents,
		subagents,
		structuredOutput,
		outputFormat,
		enableStreaming: get<boolean>('enableStreaming', false),
		systemPrompt: (additionalOptions.systemPrompt as string) || '',
		env: (additionalOptions.env as string) || '{}',
		maxBudgetUsd: (additionalOptions.maxBudgetUsd as number) || 0,
		includePartialMessages: (additionalOptions.includePartialMessages as boolean) || false,
		enableFileCheckpointing: (additionalOptions.enableFileCheckpointing as boolean) || false,
		betas: (additionalOptions.betas as string[]) || [],
		loadProjectClaudeMd: additionalOptions.loadProjectClaudeMd !== false,
		loadUserSettings: additionalOptions.loadUserSettings !== false,
		claudeCodePromptSections: configuredClaudeCodePromptSections,
		maxThinkingTokens: (additionalOptions.maxThinkingTokens as number) || 0,
		// API provider & endpoint configuration
		userPromptContext: (additionalOptions.userPromptContext as string) || '',
		apiProvider,
		customApiEndpoint: (additionalOptions.customApiEndpoint as string) || '',
		ollamaBaseUrl: (additionalOptions.ollamaBaseUrl as string) || '',
		ollamaModel,
		openrouterSonnetModel: get<string>('openrouterSonnetModel', '') || '',
		openrouterOpusModel: get<string>('openrouterOpusModel', '') || '',
		openrouterHaikuModel: get<string>('openrouterHaikuModel', '') || '',
		alibabaSonnetModel: get<string>('alibabaSonnetModel', '') || '',
		alibabaOpusModel: get<string>('alibabaOpusModel', '') || '',
		alibabaHaikuModel: get<string>('alibabaHaikuModel', '') || '',
		blockedTools: (additionalOptions.blockedTools as string) || '',
		claudeConfigDir: resolvedClaudeConfigDir,
		useClaudeCodePreset: topLevelUseClaudeCodePreset ?? (additionalOptions.useClaudeCodePreset !== false),
		envSecurityMode: ((additionalOptions.envSecurityMode as 'blocklist' | 'allowlist') || 'blocklist'),
		allowedEnvVarNames: ((additionalOptions.allowedEnvVarNames as string) || '').trim(),
		isolateClaudeConfigDir,
		claudeConfigIsolationMode,
		useSecureEnv: additionalOptions.useSecureEnv === true,
		correlationId: ((additionalOptions.correlationId as string) || '').trim(),
		promptSuggestions: additionalOptions.promptSuggestions === true,
		persistSession: additionalOptions.persistSession !== false,
		fastMode: get<boolean>('fastMode', false),
		skillsFilter: ((additionalOptions.skillsFilter as string) || '').trim(),
		sessionTitle: ((additionalOptions.sessionTitle as string) || '').trim(),
		enableHookHandlers: get<boolean>('enableHookHandlers', false),
		n8nMcpEnabled: (get<{ enabled?: boolean }>('n8nMcp', {}) || {}).enabled === true,
		// Proxy settings
		useProxyManager: (additionalOptions.useProxyManager as boolean) || false,
		proxyHttpUrl: (additionalOptions.proxyHttpUrl as string) || '',
		proxyHttpsUrl: (additionalOptions.proxyHttpsUrl as string) || '',
		proxyNoProxy: (additionalOptions.proxyNoProxy as string) || '',
		proxyCaBundlePath: (additionalOptions.proxyCaBundlePath as string) || '',
		maxBufferSizeMb: (additionalOptions.maxBufferSizeMb as number) || 1,
		plugins: [...pluginPaths],
	};
}

/** Strip sensitive/runtime-only fields for the output JSON metadata. */
export function sanitizeParamsForOutput(p: ExtractedParams): Record<string, unknown> {
	// Merge blocked tools into disallowed for metadata
	const allDisallowed = [...p.disallowedTools];
	if (p.blockedTools) {
		const blocked = p.blockedTools.split(',').map((t) => t.trim()).filter(Boolean);
		for (const tool of blocked) {
			if (!allDisallowed.includes(tool)) allDisallowed.push(tool);
		}
	}

	return {
		authMethod: p.authMethod !== 'apiCredentials' ? p.authMethod : undefined,
		model: p.model || undefined,
		permissionMode: p.permissionMode,
		thinkingMode: p.thinkingMode !== 'default' ? p.thinkingMode : undefined,
		effort: p.effort || undefined,
		chatSessionId: p.chatSessionId || undefined,
		allowedTools: p.allowedTools.length > 0 ? p.allowedTools : undefined,
		disallowedTools: allDisallowed.length > 0 ? allDisallowed : undefined,
		maxTurns: p.maxTurns || undefined,
		maxBudgetUsd: p.maxBudgetUsd || undefined,
		enableStreaming: p.enableStreaming || undefined,
		enableMcpServers: p.enableMcpServers || undefined,
		enableSubagents: p.enableSubagents || undefined,
		structuredOutput: p.structuredOutput || undefined,
		settingSources: [
			...(p.loadUserSettings ? ['user'] : []),
			...(p.loadProjectClaudeMd ? ['project'] : []),
		],
		apiProvider: p.apiProvider !== 'anthropic' ? p.apiProvider : undefined,
		claudeConfigDir: p.claudeConfigDir || undefined,
		userPromptContext: p.userPromptContext || undefined,
		useClaudeCodePreset: p.useClaudeCodePreset === false ? false : undefined,
		claudeCodePromptSections:
			p.claudeCodePromptSections.length > 0 ? p.claudeCodePromptSections : undefined,
		correlationId: p.correlationId || undefined,
		promptSuggestions: p.promptSuggestions || undefined,
		persistSession: p.persistSession === false ? false : undefined,
		fastMode: p.fastMode || undefined,
		skillsFilter: p.skillsFilter || undefined,
		sessionTitle: p.sessionTitle || undefined,
		envSecurityMode: p.envSecurityMode === 'allowlist' ? 'allowlist' : undefined,
		allowedEnvVarNames: p.allowedEnvVarNames || undefined,
		isolateClaudeConfigDir: p.isolateClaudeConfigDir || undefined,
		claudeConfigIsolationMode: p.isolateClaudeConfigDir ? p.claudeConfigIsolationMode : undefined,
		useSecureEnv: p.useSecureEnv || undefined,
		proxyEnabled: p.useProxyManager || undefined,
		plugins: p.plugins.length > 0 ? p.plugins : undefined,
		openrouterModels: (p.openrouterSonnetModel || p.openrouterOpusModel || p.openrouterHaikuModel)
			? {
				sonnet: p.openrouterSonnetModel || undefined,
				opus: p.openrouterOpusModel || undefined,
				haiku: p.openrouterHaikuModel || undefined,
			}
			: undefined,
		alibabaModels: (p.alibabaSonnetModel || p.alibabaOpusModel || p.alibabaHaikuModel)
			? {
				sonnet: p.alibabaSonnetModel || undefined,
				opus: p.alibabaOpusModel || undefined,
				haiku: p.alibabaHaikuModel || undefined,
			}
			: undefined,
		maxBufferSizeMb: p.maxBufferSizeMb > 1 ? p.maxBufferSizeMb : undefined,
	};
}
