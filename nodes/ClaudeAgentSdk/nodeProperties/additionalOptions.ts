/**
 * Additional Options configuration properties
 */

import type { INodeProperties } from 'n8n-workflow';
import { CLAUDE_CODE_PROMPT_SECTION_OPTIONS } from '../claudeCodePromptSections';
import { DEFAULT_API_PROVIDER, PROVIDER_DEFAULTS } from '../providerConfig';

export const claudeCodePresetProperties: INodeProperties[] = [
	{
		displayName: 'Use Claude Code Preset',
		name: 'useClaudeCodePreset',
		type: 'boolean',
		default: true,
		description:
			'When enabled, uses Claude Code\'s built-in system prompt (which establishes a "Claude Code" identity). ' +
			'Disable for chatbot or custom-identity agents — the System Prompt field becomes the full system prompt ' +
			'and CLAUDE.md instructions take effect without being overridden by the Claude Code identity.',
	},
	{
		displayName: 'Claude Code Prompt Sections',
		name: 'claudeCodePromptSections',
		type: 'multiOptions',
		options: CLAUDE_CODE_PROMPT_SECTION_OPTIONS,
		default: [],
		displayOptions: {
			show: {
				useClaudeCodePreset: [false],
			},
		},
		description:
			'Optional cached Claude Code guidance blocks for local CLI. Leave empty to use the full preset when enabled, or no preset blocks when disabled. Selecting one or more sections switches to a cherry-picked prompt foundation while still keeping the Claude Code tool preset available.',
	},
];

export const additionalOptionsProperty: INodeProperties = {
	displayName: 'Additional Options',
	name: 'additionalOptions',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	options: [
		{
			displayName: 'Alibaba Coding Plan Setup',
			name: 'alibabaNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					'/additionalOptions.apiProvider': ['alibaba'],
				},
			},
			description:
				'Alibaba Coding Plan uses the Alibaba credential. Credential Type = Alibaba Coding Plan API takes precedence over API Provider.',
		},
		{
			displayName: 'Allowlisted Environment Variables',
			name: 'allowedEnvVarNames',
			type: 'string',
			typeOptions: { rows: 2 },
			default: '',
			placeholder: 'NODE_ENV, LOG_LEVEL',
			displayOptions: {
				show: {
					'/additionalOptions.envSecurityMode': ['allowlist'],
				},
			},
			description:
				'Comma-separated env variable names to allow in addition to essential Claude variables',
		},
		{
			displayName: 'API Provider',
			name: 'apiProvider',
			type: 'options',
			options: [
				{ name: 'Alibaba Coding Plan', value: 'alibaba' },
				{ name: 'Anthropic (Official)', value: 'anthropic' },
				{ name: 'Custom Endpoint', value: 'custom' },
				{ name: 'LiteLLM', value: 'litellm' },
				{ name: 'Ollama (Local)', value: 'ollama' },
				{ name: 'OpenRouter', value: 'openrouter' },
			],
			default: DEFAULT_API_PROVIDER,
			description:
				'Execution provider for Claude Code. Credential Type set to OpenRouter/Alibaba, or Authentication set to Ollama, overrides this selector.',
		},
		{
			displayName: 'Betas',
			name: 'betas',
			type: 'multiOptions',
			options: [
				{
					name: '1M Context Window',
					value: 'context-1m-2025-08-07',
					description: 'Enable 1M context window beta',
				},
			],
			default: [],
			description: 'Enable SDK beta features',
		},
		{
			displayName: 'Blocked Tools',
			name: 'blockedTools',
			type: 'string',
			default: '',
			placeholder: 'Bash, mcp__server__dangerous_tool',
			description:
				'Comma-separated tools to block globally. Supports built-ins and full MCP tool names.',
		},
		{
			displayName: 'Claude Config Directory',
			name: 'claudeConfigDir',
			type: 'string',
			default: '',
			placeholder: '/data/claude-config',
			description:
				'Custom path for Claude config and session data (sets CLAUDE_CONFIG_DIR). ' +
				'Use this to persist sessions on a mounted volume instead of the default ~/.claude. ' +
				'Leave empty to use the default.',
		},
		{
			displayName: 'Claude Config Isolation Mode',
			name: 'claudeConfigIsolationMode',
			type: 'options',
			options: [
				{
					name: 'Per Workflow',
					value: 'perWorkflow',
				},
				{
					name: 'Per Session',
					value: 'perSession',
				},
			],
			default: 'perWorkflow',
			displayOptions: {
				show: {
					'/additionalOptions.isolateClaudeConfigDir': [true],
				},
			},
			description:
				'Per Workflow keeps state stable across runs of the same workflow. ' +
				'Per Session isolates each deterministic chat/session ID further.',
		},
		{
			displayName: 'Correlation ID',
			name: 'correlationId',
			type: 'string',
			default: '',
			description: 'Optional correlation ID for tracing this execution',
		},
		{
			displayName: 'Custom API Endpoint',
			name: 'customApiEndpoint',
			type: 'string',
			default: '',
			placeholder: 'https://your-custom-endpoint.com/v1',
			displayOptions: {
				show: {
					'/additionalOptions.apiProvider': ['custom'],
				},
			},
			description:
				'Anthropic-compatible endpoint URL. Used when API Provider is "Custom Endpoint" and Authentication is Anthropic API.',
		},
		{
			displayName: 'Enable File Checkpointing',
			name: 'enableFileCheckpointing',
			type: 'boolean',
			default: false,
			description: 'Whether to enable file checkpointing during execution',
		},
		{
			displayName: 'Enable Prompt Suggestions',
			name: 'promptSuggestions',
			type: 'boolean',
			default: false,
			description:
				'Whether to emit a suggested next user prompt after each turn. Useful for chat UIs building autocomplete.',
		},
		{
			displayName: 'Enable Proxy Manager',
			name: 'useProxyManager',
			type: 'boolean',
			default: false,
			displayOptions: {
				show: {
					'/enableSandbox': [true],
				},
			},
			description: 'Whether to route Claude egress traffic through an external proxy manager',
		},
		{
			displayName: 'Environment Security Mode',
			name: 'envSecurityMode',
			type: 'options',
			options: [
				{
					name: 'Blocklist (Default)',
					value: 'blocklist',
				},
				{
					name: 'Allowlist (Strict)',
					value: 'allowlist',
				},
			],
			default: 'blocklist',
			description:
				'Blocklist removes known-dangerous env vars. Allowlist passes only approved variables.',
		},
		{
			displayName: 'Environment Variables (JSON)',
			name: 'env',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '{}',
			description: 'Environment variables as JSON object (non-secret values)',
			placeholder: '{"NODE_ENV": "production"}',
		},
		{
			displayName: 'Forward Subagent Text',
			name: 'forwardSubagentText',
			type: 'boolean',
			default: false,
			description:
				'Whether to forward nested subagent text and thinking blocks with parent tool-use attribution for streaming clients',
		},
		{
			displayName: 'Include Partial Messages',
			name: 'includePartialMessages',
			type: 'boolean',
			default: false,
			description: 'Whether to include partial message events in output',
		},
		{
			displayName: 'Inject Secure Environment Variables',
			name: 'useSecureEnv',
			type: 'boolean',
			default: false,
			description:
				'Whether to inject API keys and secrets from the "Secure Environment Variables" credential into the Claude subprocess and resolve ${VAR} placeholders in MCP HTTP headers. Values are encrypted at rest and best-effort redacted from the node output, streamed events, observability log, HITL store, and error messages (exact-value masking).',
		},
		{
			displayName: 'Isolate Claude Config Directory',
			name: 'isolateClaudeConfigDir',
			type: 'boolean',
			default: false,
			displayOptions: {
				show: {
					'/additionalOptions.claudeConfigDir': [''],
				},
			},
			description:
				'Whether to store Claude session/config state in a workflow/session-scoped directory inside the working directory',
		},
		{
			displayName: 'Load Project CLAUDE.md',
			name: 'loadProjectClaudeMd',
			type: 'boolean',
			default: true,
			description:
				'Whether to load CLAUDE.md, settings, and skills from the working directory .claude/ folder',
		},
		{
			displayName: 'Load User Settings',
			name: 'loadUserSettings',
			type: 'boolean',
			default: false,
			description: 'Whether to load settings and skills from ~/.claude/',
		},
		{
			displayName: 'LiteLLM Setup',
			name: 'liteLlmNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					'/additionalOptions.apiProvider': ['litellm'],
				},
			},
			description:
				'LiteLLM uses the Claude Agent SDK LiteLLM API credential. Authentication = LiteLLM is recommended so the credential picker and model alias loader are available.',
		},
		{
			displayName: 'Managed Settings (JSON)',
			name: 'managedSettings',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			placeholder: '{"sandbox":{"network":{"allowManagedDomainsOnly":true}}}',
			description:
				'Policy-tier settings injected into the spawned CLI. Loaded into the managed (policy) layer; user/project settings cannot widen restrictions set here. Must be a JSON object.',
		},
		{
			displayName: 'Max Budget (USD)',
			name: 'maxBudgetUsd',
			type: 'number',
			default: 0,
			description: 'Maximum USD budget for execution (0 uses SDK default)',
		},
		{
			displayName: 'Max Buffer Size (MB)',
			name: 'maxBufferSizeMb',
			type: 'number',
			default: 1,
			description:
				'Maximum buffer size in MB for CLI stdout messages. Increase when working with large files (e.g., PDFs). Default is 1 MB.',
		},
		{
			displayName: 'Max Thinking Tokens (Deprecated)',
			name: 'maxThinkingTokens',
			type: 'number',
			default: 0,
			description:
				'Deprecated. Prefer Thinking Mode when Model is Opus. Applies only when Thinking Mode is not set and value > 0.',
		},
		{
			displayName: 'Ollama Base URL',
			name: 'ollamaBaseUrl',
			type: 'string',
			default: PROVIDER_DEFAULTS.ollamaBaseUrl,
			placeholder: PROVIDER_DEFAULTS.ollamaBaseUrl,
			displayOptions: {
				show: {
					'/additionalOptions.apiProvider': ['ollama'],
				},
			},
			description: 'Ollama base URL. Use host.docker.internal:11434 when running in Docker.',
		},
		{
			displayName: 'Ollama Model',
			name: 'ollamaModel',
			type: 'string',
			default: PROVIDER_DEFAULTS.ollamaModel,
			placeholder: PROVIDER_DEFAULTS.ollamaModel,
			displayOptions: {
				show: {
					'/additionalOptions.apiProvider': ['ollama'],
				},
			},
			description: 'Ollama model name to use',
		},
		{
			displayName: 'Ollama Setup',
			name: 'ollamaNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					'/additionalOptions.apiProvider': ['ollama'],
				},
			},
			description:
				'Ollama requires Anthropic API compatibility. Run "ollama serve" first. In Docker, use host.docker.internal:11434.',
		},
		{
			displayName: 'OpenRouter Setup',
			name: 'openrouterNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					'/additionalOptions.apiProvider': ['openrouter'],
				},
			},
			description:
				'OpenRouter uses the Claude Agent SDK OpenRouter API credential. Credential Type = Claude Agent SDK OpenRouter API takes precedence over API Provider.',
		},
		{
			displayName: 'Persist Session',
			name: 'persistSession',
			type: 'boolean',
			default: true,
			description:
				'Whether to persist session state to disk so sessions can be resumed later. ' +
				'When disabled, Human-in-the-Loop approvals are unavailable and Chat Session ID becomes optional.',
		},
		{
			displayName: 'Proxy CA Bundle Path',
			name: 'proxyCaBundlePath',
			type: 'string',
			default: '',
			placeholder: '/etc/pki/ca-trust/source/anchors/proxy-ca.pem',
			displayOptions: {
				show: {
					'/additionalOptions.useProxyManager': [true],
				},
			},
			description:
				'Path to proxy CA certificate bundle inside the Claude subprocess (for TLS interception)',
		},
		{
			displayName: 'Proxy HTTP URL',
			name: 'proxyHttpUrl',
			type: 'string',
			default: '',
			placeholder: 'http://proxy.internal:8080',
			displayOptions: {
				show: {
					'/additionalOptions.useProxyManager': [true],
				},
			},
			description:
				'Proxy endpoint for non-TLS traffic. Leave empty to skip and only configure HTTPS.',
		},
		{
			displayName: 'Proxy HTTPS URL',
			name: 'proxyHttpsUrl',
			type: 'string',
			default: '',
			placeholder: 'https://proxy.internal:8443',
			displayOptions: {
				show: {
					'/additionalOptions.useProxyManager': [true],
				},
			},
			description: 'Proxy endpoint for TLS interception traffic. Use the URL your proxy exposes.',
		},
		{
			displayName: 'Proxy No-Proxy List',
			name: 'proxyNoProxy',
			type: 'string',
			default: '',
			placeholder: 'localhost,127.0.0.1,.internal',
			displayOptions: {
				show: {
					'/additionalOptions.useProxyManager': [true],
				},
			},
			description: 'Comma-separated hostnames, domains, or CIDRs to bypass the proxy',
		},
		{
			displayName: 'Session Title',
			name: 'sessionTitle',
			type: 'string',
			default: '',
			description:
				'Custom title for new sessions. When omitted, the SDK auto-generates one from the first user message. Ignored when resuming an existing session.',
		},
		{
			displayName: 'Skills Filter',
			name: 'skillsFilter',
			type: 'string',
			default: '',
			placeholder: 'all  OR  pdf, docx',
			description:
				'Filter Skills loaded into the session. Use "all" to enable every discovered skill, or comma-separated names to enable a subset. Leave empty for SDK default (no filter).',
		},
		{
			displayName: 'System Prompt',
			name: 'systemPrompt',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description:
				'Custom system prompt. If CLAUDE.md is loaded, this appends to the Claude Code preset.',
		},
		{
			displayName: 'User Prompt Context',
			name: 'userPromptContext',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			placeholder: 'Always follow the project coding standards. Use TypeScript for all new code.',
			description: 'Additional context injected with every user prompt',
		},
	],
};
