import { describe, it, expect, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

import { generatePythonSdkScript } from '../../operations/generatePythonSdk';

function createMockContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: vi.fn((name: string, _index: number, defaultValue?: unknown) => {
			if (name in params) return params[name];
			return defaultValue;
		}),
		getNode: vi.fn(() => ({
			parameters: params,
		})),
	} as unknown as IExecuteFunctions;
}

describe('generatePythonSdkScript', () => {
	it('generates a production-quality query script with defaults', () => {
		const ctx = createMockContext({
			taskDescription: 'What is 2 + 2?',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(result.json.type).toBe('python_sdk_script');

		// Structure
		expect(script).toContain('#!/usr/bin/env python3');
		expect(script).toContain('from __future__ import annotations');
		expect(script).toContain('import argparse');
		expect(script).toContain('import anyio');
		expect(script).toContain('from claude_agent_sdk import');

		// Functions
		expect(script).toContain('def build_options()');
		expect(script).toContain('def handle_message(');
		expect(script).toContain('async def main()');

		// Message handling
		expect(script).toContain('AssistantMessage');
		expect(script).toContain('SystemMessage');
		expect(script).toContain('ResultMessage');
		expect(script).toContain('TextBlock');
		expect(script).toContain('ToolUseBlock');

		// CLI argparse
		expect(script).toContain('parser.add_argument("--prompt"');
		expect(script).toContain('query(prompt=args.prompt');

		// Runner
		expect(script).toContain('anyio.run(main)');
		expect(script).not.toContain('ClaudeSDKClient');

		// Binary output
		expect(result.binary).toBeDefined();
		expect(result.binary!.data.mimeType).toBe('text/x-python');
		const decoded = Buffer.from(result.binary!.data.data, 'base64').toString('utf-8');
		expect(decoded).toBe(script);
	});

	it('generates a streaming script with interactive mode', () => {
		const ctx = createMockContext({
			taskDescription: 'Build a web app',
			workingDirectory: '/home/user/project',
			model: 'sonnet',
			permissionMode: 'acceptEdits',
			allowedTools: ['Read', 'Write', 'Bash'],
			disallowedTools: ['WebFetch'],
			enableStreaming: true,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				systemPrompt: 'You are a helpful coder.',
				maxBudgetUsd: 0.5,
			},
			executionSettings: { maxTurns: 10 },
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		// Streaming-specific
		expect(script).toContain('import asyncio');
		expect(script).toContain('ClaudeSDKClient');
		expect(script).toContain('asyncio.run(main())');
		expect(script).toContain('StreamEvent');
		expect(script).toContain('UserMessage');

		// Interactive mode
		expect(script).toContain('--interactive');
		expect(script).toContain('run_interactive');
		expect(script).toContain('run_single');

		// Options
		expect(script).toContain('permission_mode="acceptEdits"');
		expect(script).toContain('model="sonnet"');
		expect(script).toContain('allowed_tools=["Read", "Write", "Bash"]');
		expect(script).toContain('disallowed_tools=["WebFetch"]');
		expect(script).toContain('max_turns=10');
		expect(script).toContain('max_budget_usd=0.5');
		expect(script).toContain('cwd="/home/user/project"');
	});

	it('uses triple-quoted strings for long system prompts', () => {
		const longPrompt = 'You are a specialist.\nAlways respond in Spanish.\nBe professional and concise.';
		const ctx = createMockContext({
			taskDescription: 'Do something',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { systemPrompt: longPrompt },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		// Should use SystemPromptPreset TypedDict constructor with triple quotes
		expect(script).toContain('SystemPromptPreset(');
		expect(script).toContain('"""You are a specialist.');
	});

	it('includes subagent definitions with proper formatting', () => {
		const ctx = createMockContext({
			taskDescription: 'Review code',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: true,
			subagents: {
				agents: [
					{
						name: 'code-reviewer',
						description: 'Reviews code for bugs',
						prompt: 'You are a code reviewer.',
						toolRestrictions: 'readonly',
						model: 'sonnet',
					},
				],
			},
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('AgentDefinition');
		expect(script).toContain('"code-reviewer": AgentDefinition(');
		expect(script).toContain('tools=["Read", "Grep", "Glob"]');
		expect(script).toContain('model="sonnet"');
	});

	it('generates multi-line MCP server configs', () => {
		const ctx = createMockContext({
			taskDescription: 'Use tools',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: true,
			mcpServers: {
				servers: [
					{
						name: 'filesystem',
						type: 'stdio',
						command: 'npx',
						args: '@modelcontextprotocol/server-filesystem, /data',
						env: '{}',
					},
					{
						name: 'api-server',
						type: 'http',
						url: 'http://localhost:3000/mcp',
						authentication: 'none',
					},
				],
			},
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('mcp_servers={');
		expect(script).toContain('"filesystem": {');
		expect(script).toContain('"command": "npx"');
		expect(script).toContain('"api-server": {');
		expect(script).toContain('"type": "http"');
	});

	it('handles thinking and effort configuration', () => {
		const ctx = createMockContext({
			taskDescription: 'Think deeply',
			workingDirectory: '',
			model: 'opus',
			permissionMode: 'default',
			thinkingMode: 'enabled',
			thinkingBudgetTokens: 20000,
			effort: 'max',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('ThinkingConfigAdaptive');
		expect(script).toContain('ThinkingConfigAdaptive(type="adaptive")');
		expect(script).not.toContain('budget_tokens=20000');
		expect(script).toContain('effort="max"');
	});

	it('handles empty setting_sources', () => {
		const ctx = createMockContext({
			taskDescription: 'Isolated',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { loadProjectClaudeMd: false, loadUserSettings: false },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('setting_sources=[]');
	});

	it('includes structured output handling when enabled', () => {
		const ctx = createMockContext({
			taskDescription: 'Extract data',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: true,
			schemaType: 'manual',
			outputJsonSchema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}',
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('output_format=');
		expect(script).toContain('structured_output');
		expect(script).toContain('json.dumps(message.structured_output');
	});

	it('uses placeholder prompt when task description is empty', () => {
		const ctx = createMockContext({
			taskDescription: '',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"Describe your task here"');
	});

	it('handles undefined/null parameter values without crashing', () => {
		// Simulate n8n returning undefined for parameters (common in runtime)
		const ctx = createMockContext({
			taskDescription: undefined,
			workingDirectory: undefined,
			model: undefined,
			permissionMode: undefined,
			allowedTools: undefined,
			disallowedTools: undefined,
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		// Should not throw
		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('#!/usr/bin/env python3');
		expect(script).toContain('def build_options()');
		expect(script).toContain('"Describe your task here"');
	});

	it('handles null parameter values without crashing', () => {
		const ctx = createMockContext({
			taskDescription: null,
			workingDirectory: null,
			model: null,
			permissionMode: null,
			allowedTools: null,
			disallowedTools: null,
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('#!/usr/bin/env python3');
		expect(script).toContain('"Describe your task here"');
	});

	it('handles missing parameter keys gracefully (uses defaults)', () => {
		// Simulate minimal context where most params are not set at all
		const ctx = createMockContext({
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('#!/usr/bin/env python3');
		expect(script).toContain('ClaudeAgentOptions');
		expect(script).toContain('"Describe your task here"');
	});

	it('uses SystemPromptPreset constructor for short system prompts with project settings', () => {
		const ctx = createMockContext({
			taskDescription: 'Test',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { systemPrompt: 'Be concise.' },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		// Short prompt with project settings should use SystemPromptPreset constructor
		expect(script).toContain('SystemPromptPreset(');
		expect(script).toContain('type="preset"');
		expect(script).toContain('preset="claude_code"');
		expect(script).toContain('append="Be concise."');
		// Should import SystemPromptPreset
		expect(script).toContain('    SystemPromptPreset,');
	});

	it('uses plain string for system prompt without project settings', () => {
		const ctx = createMockContext({
			taskDescription: 'Test',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				systemPrompt: 'Custom instructions.',
				loadProjectClaudeMd: false,
				loadUserSettings: false,
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		// No project settings = plain string, not SystemPromptPreset
		expect(script).toContain('system_prompt="Custom instructions."');
		expect(script).not.toContain('SystemPromptPreset(');
	});

	// ─── API Provider Tests ─────────────────────────────────────────────

	it('sets OpenRouter env vars in generated script', () => {
		const ctx = createMockContext({
			taskDescription: 'Test OpenRouter',
			workingDirectory: '',
			model: 'sonnet',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { apiProvider: 'openrouter' },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"ANTHROPIC_BASE_URL": "https://openrouter.ai/api"');
		expect(script).toContain('"ANTHROPIC_AUTH_TOKEN": "YOUR_OPENROUTER_API_KEY"');
		expect(script).toContain('"ANTHROPIC_API_KEY": ""');
		// API key comment
		expect(script).toContain('export ANTHROPIC_AUTH_TOKEN=');
		expect(script).toContain('openrouter');
	});

	it('sets Ollama env vars and model override in generated script', () => {
		const ctx = createMockContext({
			taskDescription: 'Test Ollama',
			workingDirectory: '',
			model: 'sonnet',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				apiProvider: 'ollama',
				ollamaBaseUrl: 'http://gpu-server:11434',
				ollamaModel: 'llama3.2:latest',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"ANTHROPIC_BASE_URL": "http://gpu-server:11434"');
		expect(script).toContain('"ANTHROPIC_AUTH_TOKEN": "ollama"');
		expect(script).toContain('"ANTHROPIC_API_KEY": "ollama"');
		// Model override from ollamaModel
		expect(script).toContain('model="llama3.2:latest"');
		// Should NOT use the n8n model selector value
		expect(script).not.toContain('model="sonnet"');
		// API key comment
		expect(script).toContain('ollama serve');
	});

	it('sets LiteLLM env vars and uses the selected model alias in generated script', () => {
		const ctx = createMockContext({
			authentication: 'claudeAgentSdkLiteLlmApi',
			taskDescription: 'Run through LiteLLM',
			workingDirectory: '',
			model: 'sonnet',
			liteLlmModel: 'listed-alias',
			liteLlmModelAlias: 'manual-alias',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"ANTHROPIC_BASE_URL": "http://localhost:4000"');
		expect(script).toContain('"ANTHROPIC_AUTH_TOKEN": "YOUR_LITELLM_API_KEY"');
		expect(script).toContain('"ANTHROPIC_API_KEY": ""');
		expect(script).toContain('"ANTHROPIC_MODEL": "manual-alias"');
		expect(script).toContain('model="manual-alias"');
		expect(script).not.toContain('model="sonnet"');
	});

	it('sets custom endpoint ANTHROPIC_BASE_URL in generated script', () => {
		const ctx = createMockContext({
			taskDescription: 'Test Custom',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				apiProvider: 'custom',
				customApiEndpoint: 'https://my-proxy.corp.com/v1',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"ANTHROPIC_BASE_URL": "https://my-proxy.corp.com/v1"');
	});

	it('does not emit ANTHROPIC_BASE_URL for default anthropic provider', () => {
		const ctx = createMockContext({
			taskDescription: 'Test Anthropic default',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { apiProvider: 'anthropic' },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).not.toContain('ANTHROPIC_BASE_URL');
		// Should still have the default API key comment
		expect(script).toContain('export ANTHROPIC_API_KEY=');
	});

	// ─── Blocked Tools Tests ────────────────────────────────────────────

	it('merges blockedTools into disallowed_tools', () => {
		const ctx = createMockContext({
			taskDescription: 'Test blocked tools',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: ['WebFetch'],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { blockedTools: 'Bash, mcp__server__danger' },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('disallowed_tools=');
		expect(script).toContain('"WebFetch"');
		expect(script).toContain('"Bash"');
		expect(script).toContain('"mcp__server__danger"');
	});

	it('does not duplicate tools that appear in both disallowedTools and blockedTools', () => {
		const ctx = createMockContext({
			taskDescription: 'Test dedup',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: ['Bash'],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { blockedTools: 'Bash, WebFetch' },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		// Should contain Bash only once
		const matches = script.match(/"Bash"/g);
		expect(matches).toHaveLength(1);
		expect(script).toContain('"WebFetch"');
	});

	// ─── User Prompt Context Tests ──────────────────────────────────────

	it('prepends userPromptContext to the default prompt', () => {
		const ctx = createMockContext({
			taskDescription: 'Build a widget',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				userPromptContext: 'Always use TypeScript.',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		// The prompt default should contain both context and task
		expect(script).toContain('Always use TypeScript.');
		expect(script).toContain('Build a widget');
	});

	it('uses userPromptContext alone when task description is empty', () => {
		const ctx = createMockContext({
			taskDescription: '',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				userPromptContext: 'Follow coding standards.',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('Follow coding standards.');
		// Should NOT show placeholder prompt since userPromptContext provides a prompt
		expect(script).not.toContain('Describe your task here');
	});

	// ─── Proxy Settings Tests ───────────────────────────────────────────

	it('includes proxy env vars when proxy manager is enabled', () => {
		const ctx = createMockContext({
			taskDescription: 'Test proxy',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				useProxyManager: true,
				proxyHttpUrl: 'http://proxy:8080',
				proxyHttpsUrl: 'https://proxy:8443',
				proxyNoProxy: 'localhost,127.0.0.1',
				proxyCaBundlePath: '/etc/ssl/proxy-ca.pem',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"HTTP_PROXY": "http://proxy:8080"');
		expect(script).toContain('"http_proxy": "http://proxy:8080"');
		expect(script).toContain('"HTTPS_PROXY": "https://proxy:8443"');
		expect(script).toContain('"https_proxy": "https://proxy:8443"');
		expect(script).toContain('"NO_PROXY": "localhost,127.0.0.1"');
		expect(script).toContain('"no_proxy": "localhost,127.0.0.1"');
		expect(script).toContain('"SSL_CERT_FILE": "/etc/ssl/proxy-ca.pem"');
		expect(script).toContain('"CURL_CA_BUNDLE": "/etc/ssl/proxy-ca.pem"');
		expect(script).toContain('"NODE_EXTRA_CA_CERTS": "/etc/ssl/proxy-ca.pem"');
		expect(script).toContain('"REQUESTS_CA_BUNDLE": "/etc/ssl/proxy-ca.pem"');
		expect(script).toContain('"GIT_SSL_CAINFO": "/etc/ssl/proxy-ca.pem"');
	});

	it('does not include proxy env vars when proxy manager is disabled', () => {
		const ctx = createMockContext({
			taskDescription: 'Test no proxy',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				useProxyManager: false,
				proxyHttpUrl: 'http://proxy:8080',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).not.toContain('HTTP_PROXY');
		expect(script).not.toContain('http_proxy');
	});

	// ─── Claude Config Dir Tests ────────────────────────────────────────

	it('includes CLAUDE_CONFIG_DIR in env when claudeConfigDir is set', () => {
		const ctx = createMockContext({
			taskDescription: 'Test config dir',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { claudeConfigDir: '/data/claude-config' },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"CLAUDE_CONFIG_DIR": "/data/claude-config"');
	});

	// ─── Combined Env Tests ─────────────────────────────────────────────

	it('merges user env JSON with provider and proxy env vars (user takes precedence)', () => {
		const ctx = createMockContext({
			taskDescription: 'Test merged env',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				apiProvider: 'openrouter',
				claudeConfigDir: '/config',
				env: '{"CUSTOM_VAR": "hello", "ANTHROPIC_AUTH_TOKEN": "my-override-key"}',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		// Provider sets ANTHROPIC_BASE_URL
		expect(script).toContain('"ANTHROPIC_BASE_URL": "https://openrouter.ai/api"');
		// User-provided env overrides provider default for ANTHROPIC_AUTH_TOKEN
		expect(script).toContain('"ANTHROPIC_AUTH_TOKEN": "my-override-key"');
		// Custom user var included
		expect(script).toContain('"CUSTOM_VAR": "hello"');
		// Config dir
		expect(script).toContain('"CLAUDE_CONFIG_DIR": "/config"');
	});

	// ─── Metadata Output Tests ──────────────────────────────────────────

	it('includes new fields in JSON metadata output', () => {
		const ctx = createMockContext({
			taskDescription: 'Test metadata',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				apiProvider: 'ollama',
				claudeConfigDir: '/config',
				userPromptContext: 'Context here',
				useProxyManager: true,
				blockedTools: 'Bash',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const params = result.json.params as Record<string, unknown>;

		expect(params.apiProvider).toBe('ollama');
		expect(params.claudeConfigDir).toBe('/config');
		expect(params.userPromptContext).toBe('Context here');
		expect(params.proxyEnabled).toBe(true);
		// blockedTools merged into disallowedTools
		expect(params.disallowedTools).toContain('Bash');
	});

	// ─── Max Buffer Size Tests ──────────────────────────────────────────

	it('emits max_buffer_size when > 1 MB', () => {
		const ctx = createMockContext({
			taskDescription: 'Test buffer',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { maxBufferSizeMb: 10 },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('max_buffer_size=10485760');
		expect(script).toContain('# 10 MB');

		const params = result.json.params as Record<string, unknown>;
		expect(params.maxBufferSizeMb).toBe(10);
	});

	it('does not emit max_buffer_size at default 1 MB', () => {
		const ctx = createMockContext({
			taskDescription: 'Test default buffer',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { maxBufferSizeMb: 1 },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).not.toContain('max_buffer_size');
	});

	it('overrides provider from authentication and exports OpenRouter tier model defaults', () => {
		const ctx = createMockContext({
			authentication: 'openrouter',
			taskDescription: 'Test auth override',
			workingDirectory: '',
			model: 'sonnet',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			openrouterSonnetModel: 'openrouter/anthropic/claude-sonnet-4',
			openrouterOpusModel: 'openrouter/anthropic/claude-opus-4',
			openrouterHaikuModel: 'openrouter/anthropic/claude-haiku-4',
			additionalOptions: { apiProvider: 'anthropic' },
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"ANTHROPIC_BASE_URL": "https://openrouter.ai/api"');
		expect(script).toContain('"ANTHROPIC_DEFAULT_SONNET_MODEL": "openrouter/anthropic/claude-sonnet-4"');
		expect(script).toContain('"ANTHROPIC_DEFAULT_OPUS_MODEL": "openrouter/anthropic/claude-opus-4"');
		expect(script).toContain('"ANTHROPIC_DEFAULT_HAIKU_MODEL": "openrouter/anthropic/claude-haiku-4"');
	});

	it('exports Alibaba provider env and uses Sonnet tier as primary model', () => {
		const ctx = createMockContext({
			authentication: 'alibaba',
			taskDescription: 'Test Alibaba',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			thinkingMode: 'default',
			effort: 'max',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			alibabaSonnetModel: 'qwen3.5-plus',
			alibabaOpusModel: '',
			alibabaHaikuModel: '',
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"ANTHROPIC_BASE_URL": "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic"');
		expect(script).toContain('"ANTHROPIC_AUTH_TOKEN": "YOUR_ALIBABA_API_KEY"');
		expect(script).toContain('"ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3.5-plus"');
		expect(script).toContain('"ANTHROPIC_MODEL": "qwen3.5-plus"');
		expect(script).toContain('model="qwen3.5-plus"');
		// Alibaba defaults to disabled thinking unless a budget is provided
		expect(script).toContain('ThinkingConfigDisabled');
		// Effort is ignored for Alibaba runtime parity
		expect(script).not.toContain('effort=');
	});

	it('exports plugins from selected and additional paths with deduplication', () => {
		const ctx = createMockContext({
			taskDescription: 'Test plugins',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			enablePlugins: true,
			selectedPlugins: ['/plugins/a', '__none__', '/plugins/b'],
			additionalPluginPaths: '/plugins/b, /plugins/c',
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;
		const params = result.json.params as Record<string, unknown>;

		expect(script).toContain('plugins=');
		expect(script).toContain('"path": "/plugins/a"');
		expect(script).toContain('"path": "/plugins/b"');
		expect(script).toContain('"path": "/plugins/c"');
		expect(params.plugins).toEqual(['/plugins/a', '/plugins/b', '/plugins/c']);
	});

	it('uses plain system prompt and explicit tools preset when Claude Code preset is disabled', () => {
		const ctx = createMockContext({
			taskDescription: 'Test preset off',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				systemPrompt: 'Act as a support assistant.',
				loadProjectClaudeMd: true,
				loadUserSettings: true,
				useClaudeCodePreset: false,
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('system_prompt="Act as a support assistant."');
		expect(script).toContain('tools={');
		expect(script).toContain('"type": "preset"');
		expect(script).toContain('"preset": "claude_code"');
		expect(script).not.toContain('SystemPromptPreset(');
	});

	it('renders selected Claude Code prompt sections as a plain system prompt and keeps the tools preset', () => {
		const ctx = createMockContext({
			taskDescription: 'Test prompt sections',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'Skill', 'AskUserQuestion', 'Task', 'TodoWrite'],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				systemPrompt: 'Act as a support assistant.',
				loadProjectClaudeMd: true,
				loadUserSettings: false,
				useClaudeCodePreset: false,
				claudeCodePromptSections: ['usingTools', 'sessionGuidance'],
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;
		const params = result.json.params as Record<string, unknown>;

		expect(script).toContain('# Using your tools');
		expect(script).toContain('# Session guidance');
		expect(script).toContain('Act as a support assistant.');
		expect(script).toContain('tools={');
		expect(script).toContain('"preset": "claude_code"');
		expect(script).not.toContain('SystemPromptPreset(');
		expect(params.claudeCodePromptSections).toEqual(['usingTools', 'sessionGuidance']);
	});

	it('ignores the removed legacy Claude Code prompt-section selector shape', () => {
		const ctx = createMockContext({
			taskDescription: 'Test legacy prompt sections',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: ['Read', 'Bash'],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			claudeCodePromptSectionsSelection: ['sessionGuidance'],
			additionalOptions: {
				systemPrompt: 'Act as a support assistant.',
				loadProjectClaudeMd: true,
				loadUserSettings: false,
				useClaudeCodePreset: false,
				claudeCodePromptSections: [],
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;
		const params = result.json.params as Record<string, unknown>;

		expect(script).not.toContain('# Session guidance');
		expect(params.claudeCodePromptSections).toBeUndefined();
	});

	it('prefers top-level Claude Code preset controls over legacy additional options values', () => {
		const ctx = createMockContext({
			taskDescription: 'Test top-level prompt controls',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: ['Read', 'Bash'],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			useClaudeCodePreset: false,
			additionalOptions: {
				systemPrompt: 'Act as a support assistant.',
				useClaudeCodePreset: true,
				claudeCodePromptSections: ['usingTools'],
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;
		const params = result.json.params as Record<string, unknown>;

		expect(script).toContain('# Using your tools');
		expect(script).not.toContain('# Session guidance');
		expect(params.useClaudeCodePreset).toBe(false);
		expect(params.claudeCodePromptSections).toEqual(['usingTools']);
	});

	it('applies env allowlist mode to generated env dict', () => {
		const ctx = createMockContext({
			taskDescription: 'Test env allowlist',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				envSecurityMode: 'allowlist',
				allowedEnvVarNames: 'CUSTOM_ALLOWED',
				env: '{"CUSTOM_ALLOWED":"ok","CUSTOM_BLOCKED":"nope"}',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;

		expect(script).toContain('"CUSTOM_ALLOWED": "ok"');
		expect(script).not.toContain('CUSTOM_BLOCKED');
	});

	it('resolves isolated Claude config directory from working directory when enabled', () => {
		const ctx = createMockContext({
			taskDescription: 'Test isolation',
			chatSessionId: 'user/42',
			workingDirectory: '/workspace/app',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				isolateClaudeConfigDir: true,
				claudeConfigIsolationMode: 'perSession',
			},
			executionSettings: {},
		});

		const result = generatePythonSdkScript(ctx, 0);
		const script = result.json.script as string;
		const params = result.json.params as Record<string, unknown>;

		expect(script).toContain('"CLAUDE_CONFIG_DIR": "/workspace/app/.claude-n8n/user-42"');
		expect(params.claudeConfigDir).toBe('/workspace/app/.claude-n8n/user-42');
	});

	// ─────────────────────────────────────────────────────────────────────────
	// V13: triple-quoted literal breakout hardening (escTriple)
	// ─────────────────────────────────────────────────────────────────────────

	it('does not let a prompt ending in a backslash break the triple-quoted literal (V13)', () => {
		// >60 chars so the triple-quoted branch is taken; trailing backslash would
		// otherwise escape the closing """ and continue/break the literal.
		const longEnough = 'You are a careful specialist agent that follows instructions.';
		const ctx = createMockContext({
			taskDescription: 'Do something',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { systemPrompt: `${longEnough}\\`, useClaudeCodePreset: false },
			executionSettings: {},
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		// Every backslash run immediately before a `"""` delimiter must be EVEN:
		// an odd run means the last backslash escapes the delimiter and breaks
		// out of the literal. A trailing `\` becomes `\\` (even) -> safe.
		for (const match of script.matchAll(/(\\*)"""/g)) {
			expect(match[1].length % 2).toBe(0);
		}
	});

	it('does not let a prompt containing """ break out into code (V13)', () => {
		const longEnough = 'You are a careful specialist agent that follows instructions.';
		const ctx = createMockContext({
			taskDescription: 'Do something',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: {
				systemPrompt: `${longEnough}\n"""; import os; os.system("id")`,
				useClaudeCodePreset: false,
			},
			executionSettings: {},
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		// Only the literal delimiters may be unescaped triple-quotes -> even count.
		const tripleQuotes = (script.match(/(?<!\\)"""/g) ?? []).length;
		expect(tripleQuotes % 2).toBe(0);
		// The injected payload's triple-quote must be escaped, not verbatim.
		expect(script).not.toContain('"""; import os');
	});

	it('round-trips a normal multi-line prompt verbatim in the triple-quoted literal (V13)', () => {
		const normalPrompt = 'You are a specialist.\nAlways respond in Spanish.\nBe professional.';
		const ctx = createMockContext({
			taskDescription: 'Do something',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: false,
			additionalOptions: { systemPrompt: normalPrompt, useClaudeCodePreset: false },
			executionSettings: {},
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		// No quotes/backslashes -> emitted unchanged between the delimiters.
		expect(script).toContain(`"""${normalPrompt}"""`);
	});

	it('escapes a backslash in a subagent prompt (V13)', () => {
		const ctx = createMockContext({
			taskDescription: 'Review code',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: true,
			subagents: {
				agents: [
					{
						name: 'reviewer',
						description: 'Reviews code\\',
						prompt: 'You are a code reviewer that always finishes its sentences.\\',
						toolRestrictions: 'readonly',
						model: 'sonnet',
					},
				],
			},
			structuredOutput: false,
			additionalOptions: {},
			executionSettings: {},
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		// Same parity guard as above: no odd backslash run may abut a delimiter.
		for (const match of script.matchAll(/(\\*)"""/g)) {
			expect(match[1].length % 2).toBe(0);
		}
	});
});
