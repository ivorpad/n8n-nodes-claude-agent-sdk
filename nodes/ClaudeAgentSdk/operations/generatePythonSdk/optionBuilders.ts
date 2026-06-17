/**
 * ClaudeAgentOptions field builders for the generated Python SDK script.
 * Split out of generatePythonSdk/index.ts (file-size guard).
 */

import { jsonParse } from 'n8n-workflow';

import {
	buildSelectedClaudeCodePrompt,
	usesFullClaudeCodePromptPreset,
} from '../../claudeCodePromptSections';
import { isAdaptiveThinkingModel, isFableModel } from '../../claudeModels';
import { DEFAULT_API_PROVIDER, PROVIDER_DEFAULTS } from '../../providerConfig';
import type { ExtractedParams } from './params';
import { esc, escTriple, pyDict, pyList } from './pythonLiterals';

export function buildApiKeyComment(p: ExtractedParams): string {
	const provider = p.apiProvider || DEFAULT_API_PROVIDER;
	if (provider === 'openrouter') {
		return '\nAPI Key:\n    export ANTHROPIC_AUTH_TOKEN="your-openrouter-key"  # via openrouter.ai\n';
	}
	if (provider === 'alibaba') {
		return '\nAPI Key:\n    export ANTHROPIC_AUTH_TOKEN="your-alibaba-key"  # via Alibaba Coding Plan\n';
	}
	if (provider === 'litellm') {
		return '\nAPI Key:\n    export ANTHROPIC_AUTH_TOKEN="your-litellm-key"  # via LiteLLM proxy\n';
	}
	if (provider === 'ollama') {
		return '\nSetup:\n    ollama serve  # ensure Ollama is running\n';
	}
	if (provider === 'custom') {
		return '\nAPI Key:\n    export ANTHROPIC_API_KEY="your-api-key"\n';
	}
	return '\nAPI Key:\n    export ANTHROPIC_API_KEY="sk-..."  # via console.anthropic.com\n';
}

export function buildThinkingOption(
	p: ExtractedParams,
): { importName: string; value: string } | undefined {
	if (p.apiProvider === 'alibaba') {
		const alibabaBudget =
			p.thinkingMode === 'enabled'
				? p.thinkingBudgetTokens
				: p.maxThinkingTokens > 0
					? p.maxThinkingTokens
					: 0;
		if (alibabaBudget > 0) {
			const normalized = Math.max(1, Math.min(38912, Math.floor(alibabaBudget)));
			return {
				importName: 'ThinkingConfigEnabled',
				value: `ThinkingConfigEnabled(type="enabled", budget_tokens=${normalized})`,
			};
		}
		return {
			importName: 'ThinkingConfigDisabled',
			value: 'ThinkingConfigDisabled(type="disabled")',
		};
	}

	if (isAdaptiveThinkingModel(p.model)) {
		if (p.thinkingMode === 'disabled') {
			// Fable 5 rejects an explicit thinking disable with HTTP 400 — the
			// supported "no thinking" path is omitting the parameter entirely.
			if (isFableModel(p.model)) {
				return undefined;
			}
			return {
				importName: 'ThinkingConfigDisabled',
				value: 'ThinkingConfigDisabled(type="disabled")',
			};
		}
		return {
			importName: 'ThinkingConfigAdaptive',
			value: 'ThinkingConfigAdaptive(type="adaptive")',
		};
	}

	if (p.thinkingMode === 'adaptive') {
		return {
			importName: 'ThinkingConfigAdaptive',
			value: 'ThinkingConfigAdaptive(type="adaptive")',
		};
	}
	// Mirror runtime buildStandardThinkingSetup: enabled requires budget > 0,
	// otherwise fall through to the legacy max_thinking_tokens path.
	if (p.thinkingMode === 'enabled' && p.thinkingBudgetTokens > 0) {
		return {
			importName: 'ThinkingConfigEnabled',
			value: `ThinkingConfigEnabled(type="enabled", budget_tokens=${p.thinkingBudgetTokens})`,
		};
	}
	if (p.thinkingMode === 'disabled') {
		return {
			importName: 'ThinkingConfigDisabled',
			value: 'ThinkingConfigDisabled(type="disabled")',
		};
	}
	return undefined;
}

export function buildSystemPromptBlock(
	p: ExtractedParams,
	imports: Set<string>,
): string | undefined {
	const hasSources = p.loadProjectClaudeMd || p.loadUserSettings;
	const usePreset =
		hasSources &&
		usesFullClaudeCodePromptPreset({
			useClaudeCodePreset: p.useClaudeCodePreset,
			selectedSections: p.claudeCodePromptSections,
		});
	const selectedClaudeCodePrompt = buildSelectedClaudeCodePrompt({
		selectedSections: p.claudeCodePromptSections,
		context: {
			allowedTools: p.allowedTools,
			settingSources: buildSettingSourceValues(p),
		},
	});
	const effectivePrompt = [selectedClaudeCodePrompt, p.systemPrompt]
		.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
		.join('\n\n');

	if (!effectivePrompt && usePreset) {
		return undefined;
	}

	if (effectivePrompt && usePreset) {
		// Use SystemPromptPreset TypedDict constructor for type safety
		imports.add('SystemPromptPreset');
		if (effectivePrompt.includes('\n') || effectivePrompt.length > 60) {
			return [
				'        system_prompt=SystemPromptPreset(',
				'            type="preset",',
				'            preset="claude_code",',
				`            append="""${escTriple(effectivePrompt)}""",`,
				'        ),',
			].join('\n');
		}
		return `        system_prompt=SystemPromptPreset(type="preset", preset="claude_code", append="${esc(effectivePrompt)}"),`;
	}

	if (effectivePrompt) {
		if (effectivePrompt.includes('\n') || effectivePrompt.length > 60) {
			return `        system_prompt="""${escTriple(effectivePrompt)}""",`;
		}
		return `        system_prompt="${esc(effectivePrompt)}",`;
	}

	return undefined;
}

function buildSettingSourceValues(p: ExtractedParams): string[] {
	const sources: string[] = [];
	if (p.loadUserSettings) sources.push('user');
	if (p.loadProjectClaudeMd) sources.push('project');
	return sources;
}

export function buildSettingSources(p: ExtractedParams): string | undefined {
	const sources = buildSettingSourceValues(p);
	if (sources.length === 0) return '[]';

	return pyList(sources);
}

/**
 * Build the full env dict by merging:
 * 1. API provider env vars (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.)
 * 2. Proxy env vars (HTTP_PROXY, HTTPS_PROXY, SSL_CERT_FILE, etc.)
 * 3. Claude config dir (CLAUDE_CONFIG_DIR)
 * 4. User-provided env JSON (takes precedence over all above)
 *
 * Emits a comment about API key setup for non-Anthropic providers.
 */
export function buildFullEnvDict(p: ExtractedParams): string | undefined {
	const env: Record<string, string> = {};

	// 1. API provider env vars
	const provider = p.apiProvider || DEFAULT_API_PROVIDER;
	if (provider === 'openrouter') {
		env.ANTHROPIC_BASE_URL = PROVIDER_DEFAULTS.openrouterBaseUrl;
		env.ANTHROPIC_AUTH_TOKEN = 'YOUR_OPENROUTER_API_KEY';
		env.ANTHROPIC_API_KEY = '';
		if (p.openrouterSonnetModel.trim())
			env.ANTHROPIC_DEFAULT_SONNET_MODEL = p.openrouterSonnetModel.trim();
		if (p.openrouterOpusModel.trim())
			env.ANTHROPIC_DEFAULT_OPUS_MODEL = p.openrouterOpusModel.trim();
		if (p.openrouterHaikuModel.trim())
			env.ANTHROPIC_DEFAULT_HAIKU_MODEL = p.openrouterHaikuModel.trim();
	} else if (provider === 'alibaba') {
		env.ANTHROPIC_BASE_URL = PROVIDER_DEFAULTS.alibabaBaseUrl;
		env.ANTHROPIC_AUTH_TOKEN = 'YOUR_ALIBABA_API_KEY';
		env.ANTHROPIC_API_KEY = '';
		if (p.alibabaSonnetModel.trim())
			env.ANTHROPIC_DEFAULT_SONNET_MODEL = p.alibabaSonnetModel.trim();
		if (p.alibabaOpusModel.trim()) env.ANTHROPIC_DEFAULT_OPUS_MODEL = p.alibabaOpusModel.trim();
		if (p.alibabaHaikuModel.trim()) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = p.alibabaHaikuModel.trim();
		const alibabaPrimaryModel =
			p.alibabaSonnetModel.trim() || p.alibabaOpusModel.trim() || p.alibabaHaikuModel.trim();
		if (alibabaPrimaryModel) {
			env.ANTHROPIC_MODEL = alibabaPrimaryModel;
		}
	} else if (provider === 'litellm') {
		env.ANTHROPIC_BASE_URL = PROVIDER_DEFAULTS.liteLlmBaseUrl;
		env.ANTHROPIC_AUTH_TOKEN = 'YOUR_LITELLM_API_KEY';
		env.ANTHROPIC_API_KEY = '';
		if (p.liteLlmModel.trim()) {
			env.ANTHROPIC_MODEL = p.liteLlmModel.trim();
		}
	} else if (provider === 'ollama') {
		env.ANTHROPIC_BASE_URL = p.ollamaBaseUrl || PROVIDER_DEFAULTS.ollamaBaseUrl;
		env.ANTHROPIC_AUTH_TOKEN = PROVIDER_DEFAULTS.ollamaAuthToken;
		env.ANTHROPIC_API_KEY = PROVIDER_DEFAULTS.ollamaAuthToken;
	} else if (provider === 'custom' && p.customApiEndpoint) {
		env.ANTHROPIC_BASE_URL = p.customApiEndpoint;
	}
	// For 'anthropic' provider, don't set ANTHROPIC_BASE_URL (use SDK default)

	// 2. Claude config dir
	if (p.claudeConfigDir) {
		env.CLAUDE_CONFIG_DIR = p.claudeConfigDir;
	}

	// 3. Proxy env vars (only when proxy manager is enabled)
	if (p.useProxyManager) {
		if (p.proxyHttpUrl) {
			env.HTTP_PROXY = p.proxyHttpUrl;
			env.http_proxy = p.proxyHttpUrl;
		}
		if (p.proxyHttpsUrl) {
			env.HTTPS_PROXY = p.proxyHttpsUrl;
			env.https_proxy = p.proxyHttpsUrl;
		}
		if (p.proxyNoProxy) {
			env.NO_PROXY = p.proxyNoProxy;
			env.no_proxy = p.proxyNoProxy;
		}
		if (p.proxyCaBundlePath) {
			env.SSL_CERT_FILE = p.proxyCaBundlePath;
			env.CURL_CA_BUNDLE = p.proxyCaBundlePath;
			env.NODE_EXTRA_CA_CERTS = p.proxyCaBundlePath;
			env.REQUESTS_CA_BUNDLE = p.proxyCaBundlePath;
			env.GIT_SSL_CAINFO = p.proxyCaBundlePath;
		}
	}

	// 4. User-provided env JSON (takes precedence)
	if (p.env && p.env !== '{}') {
		try {
			const userEnv = jsonParse<Record<string, string>>(p.env);
			Object.assign(env, userEnv);
		} catch {
			// Invalid JSON — skip user env
		}
	}

	if (p.envSecurityMode === 'allowlist') {
		const allowlistedUserNames = p.allowedEnvVarNames
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean);
		const allowlist = new Set<string>([
			'PATH',
			'HOME',
			'SHELL',
			'USER',
			'TERM',
			'LANG',
			'LC_ALL',
			'CLAUDE_CONFIG_DIR',
			'CLAUDE_AGENT_SDK_CLIENT_APP',
			'ANTHROPIC_API_KEY',
			'ANTHROPIC_AUTH_TOKEN',
			'ANTHROPIC_BASE_URL',
			'ANTHROPIC_MODEL',
			'ANTHROPIC_DEFAULT_SONNET_MODEL',
			'ANTHROPIC_DEFAULT_OPUS_MODEL',
			'ANTHROPIC_DEFAULT_HAIKU_MODEL',
			'HTTP_PROXY',
			'HTTPS_PROXY',
			'NO_PROXY',
			'http_proxy',
			'https_proxy',
			'no_proxy',
			'SSL_CERT_FILE',
			'CURL_CA_BUNDLE',
			'NODE_EXTRA_CA_CERTS',
			'REQUESTS_CA_BUNDLE',
			'GIT_SSL_CAINFO',
			...allowlistedUserNames,
		]);
		for (const key of Object.keys(env)) {
			if (!allowlist.has(key)) {
				delete env[key];
			}
		}
	}

	if (Object.keys(env).length === 0) return undefined;

	// Multi-line for readability when more than 2 entries
	if (Object.keys(env).length > 2) {
		const lines = Object.entries(env).map(
			([k, v]) => `            "${esc(k)}": "${esc(String(v))}",`,
		);
		return `{\n${lines.join('\n')}\n        }`;
	}
	return pyDict(env);
}

/**
 * Docstring notes for configured node settings that the Python SDK cannot
 * express (TS-SDK-only options, n8n-runtime-only features). Silently dropping
 * them would misrepresent the workflow; emitting them crashes the script.
 */
export function buildExportNotes(p: ExtractedParams): string[] {
	const notes: string[] = [];
	if (p.persistSession === false) {
		notes.push(
			'Persist Session=off is TypeScript-SDK-only; the Python SDK always writes session transcripts.',
		);
	}
	if (p.promptSuggestions) {
		notes.push('Prompt Suggestions is TypeScript-SDK-only and was omitted.');
	}
	if (p.correlationId) {
		notes.push(`Correlation ID ("${p.correlationId}") is TypeScript-SDK-only and was omitted.`);
	}
	if (p.sessionTitle) {
		notes.push(`Session Title ("${p.sessionTitle}") is TypeScript-SDK-only and was omitted.`);
	}
	if (p.chatSessionId) {
		notes.push(
			'session_id is pinned from the n8n parameter; change or remove it for independent runs.',
		);
	}
	if (p.enableHookHandlers) {
		notes.push(
			'n8n hook handlers (HITL webhooks/commands) are not exported; implement hooks= callbacks in Python if needed.',
		);
	}
	if (p.n8nMcpEnabled) {
		notes.push('n8n workflow MCP tools exist only inside n8n and are not exported.');
	}
	if (p.envSecurityMode === 'allowlist') {
		notes.push(
			'Env allowlist: the Python SDK merges env= over os.environ, so inherited variables are NOT stripped. Launch with a clean environment for real isolation.',
		);
	}
	return notes;
}

export function buildMcpServersBlock(p: ExtractedParams): string | undefined {
	if (!p.enableMcpServers || p.mcpServers.length === 0) return undefined;

	const entries: string[] = [];
	for (const server of p.mcpServers) {
		const name = server.name || 'unnamed';
		if (server.type === 'stdio') {
			const args = (server.args || '')
				.split(',')
				.map((a) => a.trim())
				.filter(Boolean);
			const parts: string[] = [`                "command": "${esc(server.command)}"`];
			if (args.length > 0) {
				parts.push(`                "args": ${pyList(args)}`);
			}
			if (server.env && server.env !== '{}') {
				try {
					const envParsed = jsonParse<Record<string, string>>(server.env);
					if (Object.keys(envParsed).length > 0) {
						parts.push(`                "env": ${pyDict(envParsed)}`);
					}
				} catch {
					/* skip */
				}
			}
			entries.push(`            "${esc(name)}": {\n${parts.join(',\n')},\n            },`);
		} else {
			const type = server.type || 'http';
			const parts: string[] = [
				`                "type": "${type}"`,
				`                "url": "${esc(server.url)}"`,
			];
			if (server.authentication === 'custom' && server.headers && server.headers !== '{}') {
				try {
					const headers = jsonParse<Record<string, string>>(server.headers);
					if (Object.keys(headers).length > 0) {
						parts.push(`                "headers": ${pyDict(headers)}`);
					}
				} catch {
					/* skip */
				}
			}
			entries.push(`            "${esc(name)}": {\n${parts.join(',\n')},\n            },`);
		}
	}

	return `        mcp_servers={\n${entries.join('\n')}\n        },`;
}

export function buildAgentsBlock(p: ExtractedParams): string | undefined {
	if (!p.enableSubagents || p.subagents.length === 0) return undefined;

	const entries: string[] = [];
	for (const agent of p.subagents) {
		const name = agent.name || 'unnamed';
		const parts: string[] = [];

		// Description — triple-quote if long
		const desc = agent.description || '';
		if (desc.includes('\n') || desc.length > 60) {
			parts.push(`                description="""${escTriple(desc)}"""`);
		} else {
			parts.push(`                description="${esc(desc)}"`);
		}

		// Prompt — always triple-quote (system prompts tend to be long)
		const prompt = agent.prompt || '';
		parts.push(`                prompt="""${escTriple(prompt)}"""`);

		// Tools
		const toolRestrictions = agent.toolRestrictions || 'inherit';
		if (toolRestrictions === 'readonly') {
			parts.push('                tools=["Read", "Grep", "Glob"]');
		} else if (toolRestrictions === 'custom' && agent.tools) {
			const tools = agent.tools
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			if (tools.length > 0) {
				parts.push(`                tools=${pyList(tools)}`);
			}
		}

		// Model
		if (agent.model && agent.model !== 'inherit') {
			parts.push(`                model="${agent.model}"`);
		}

		entries.push(
			`            "${esc(name)}": AgentDefinition(\n${parts.join(',\n')},\n            ),`,
		);
	}

	return `        agents={\n${entries.join('\n')}\n        },`;
}
