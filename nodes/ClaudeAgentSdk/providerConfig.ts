/**
 * Shared provider types and defaults for the node UI, runtime env assembly,
 * credentials, and generated Python exporter.
 */

export const API_PROVIDER_VALUES = [
	'anthropic',
	'openrouter',
	'ollama',
	'custom',
	'alibaba',
	'litellm',
	'codemie',
] as const;

export type ApiProvider = (typeof API_PROVIDER_VALUES)[number];

export const DEFAULT_API_PROVIDER: ApiProvider = 'anthropic';

export const PROVIDER_DEFAULTS = {
	anthropicBaseUrl: 'https://api.anthropic.com',
	openrouterBaseUrl: 'https://openrouter.ai/api',
	openrouterCredentialBaseUrl: 'https://openrouter.ai/api/v1',
	alibabaBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
	liteLlmBaseUrl: 'http://localhost:4000',
	codeMieProxyBaseUrl: 'http://127.0.0.1:4001',
	ollamaBaseUrl: 'http://localhost:11434',
	ollamaModel: 'qwen2.5-coder:latest',
	ollamaAuthToken: 'ollama',
	claudeAgentSdkClientApp: 'n8n-claude-agent-sdk',
} as const;

export function isApiProvider(value: unknown): value is ApiProvider {
	return API_PROVIDER_VALUES.includes(value as ApiProvider);
}
