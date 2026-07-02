import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdditionalOptions, ISessionMemory } from '../../types';
import { buildQuerySetup } from '../../operations/executeTask/steps/querySetup';
import type { ExecuteTaskOptions } from '../../operations/executeTask/types';
import type { OperatorPolicy } from '../../permissions/policy';
import { createMockAdapter } from '../helpers/mockClaudeAgentSdk';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

const defaultOperatorPolicy: OperatorPolicy = {
	blockedToolPatterns: [],
	forceSandbox: false,
	disallowUnsandboxedCommands: false,
};

const originalDebugLogsFlag = process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS;

afterEach(() => {
	if (originalDebugLogsFlag === undefined) {
		delete process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS;
	} else {
		process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS = originalDebugLogsFlag;
	}
	vi.restoreAllMocks();
});

function createParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		allowedTools: [],
		disallowedTools: [],
		permissionMode: 'default',
		model: 'claude-sonnet-4-5',
		executionSettings: {},
		additionalOptions: {},
		enableSandbox: false,
		openrouterSonnetModel: '',
		openrouterOpusModel: '',
		openrouterHaikuModel: '',
		alibabaSonnetModel: '',
		alibabaOpusModel: '',
		alibabaHaikuModel: '',
		liteLlmModel: '',
		liteLlmModelAlias: '',
		ollamaModel: '',
		structuredOutput: false,
		thinkingMode: 'default',
		thinkingBudgetTokens: 0,
		effort: '',
		fastMode: false,
		enablePlugins: false,
		selectedPlugins: [],
		additionalPluginPaths: '',
		...overrides,
	};
}

function createOptions(overrides: Partial<ExecuteTaskOptions> = {}): ExecuteTaskOptions {
	return {
		apiKey: 'anthropic-key',
		adapter: createMockAdapter(),
		...overrides,
	};
}

async function setupQuery(
	overrides: {
		params?: Record<string, unknown>;
		options?: Partial<ExecuteTaskOptions>;
		resolvedAuthMethod?: 'apiCredentials' | 'cliSession' | 'openrouter' | 'ollama' | 'alibaba' | 'litellm';
		resumeSessionId?: string;
		sessionMemory?: ISessionMemory;
		operatorPolicy?: OperatorPolicy;
		additionalOptions?: AdditionalOptions;
	} = {},
) {
	const additionalOptions = overrides.additionalOptions ?? {};
	const execFunctions = createMockExecuteFunctions(
		createParams({
			...overrides.params,
			additionalOptions,
		}),
	);

	return buildQuerySetup({
		execFunctions,
		itemIndex: 0,
		options: createOptions(overrides.options),
		resolvedAuthMethod: overrides.resolvedAuthMethod ?? 'apiCredentials',
		workingDirectory: '/workspace/project',
		chatSessionId: 'chat-session-1',
		sessionMemory: overrides.sessionMemory,
		resumeSessionId: overrides.resumeSessionId,
		agents: {},
		operatorPolicy: overrides.operatorPolicy ?? defaultOperatorPolicy,
	});
}

describe('buildQuerySetup', () => {
	it('uses deterministic sessionId for new sessions and resume for existing sessions', async () => {
		const fresh = await setupQuery({
			additionalOptions: { sessionTitle: 'Initial task' },
		});

		expect(fresh.queryOptions).toMatchObject({
			sessionId: 'chat-session-1',
			title: 'Initial task',
		});
		expect(fresh.queryOptions.resume).toBeUndefined();

		const resumed = await setupQuery({
			resumeSessionId: 'chat-session-1',
			additionalOptions: { sessionTitle: 'Should not apply on resume' },
		});

		expect(resumed.queryOptions).toMatchObject({
			resume: 'chat-session-1',
		});
		expect(resumed.queryOptions.sessionId).toBeUndefined();
		expect(resumed.queryOptions.title).toBeUndefined();
	});

	it('does not carry forkSession into resume query options', async () => {
		const resumed = await setupQuery({
			resumeSessionId: 'chat-session-1',
			sessionMemory: {
				type: 'claude-session-memory',
				has: async () => true,
				touch: async () => {},
			},
			params: {
				executionSettings: {
					forkSession: true,
				},
			},
		});

		expect(resumed.queryOptions.resume).toBe('chat-session-1');
		expect(resumed.queryOptions.sessionId).toBeUndefined();
		expect(resumed.queryOptions.forkSession).toBeUndefined();
	});

	it('clamps Alibaba thinking budget and removes incompatible effort options', async () => {
		process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS = 'true';
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const setup = await setupQuery({
			resolvedAuthMethod: 'alibaba',
			options: { apiKey: undefined, alibabaAuthToken: 'alibaba-token' },
			params: {
				alibabaSonnetModel: 'qwen-coder',
				thinkingMode: 'enabled',
				thinkingBudgetTokens: 999999,
				effort: 'xhigh',
			},
		});

		expect(setup.apiProvider).toBe('alibaba');
		expect(setup.queryOptions).toMatchObject({
			model: 'qwen-coder',
			thinking: { type: 'enabled', budgetTokens: 38912 },
		});
		expect(setup.queryOptions.effort).toBeUndefined();
		expect(setup.queryOptions.maxThinkingTokens).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Alibaba thinking budget'));
		warnSpy.mockRestore();
	});

	it('combines selected plugins and additional plugin paths', async () => {
		const setup = await setupQuery({
			params: {
				enablePlugins: true,
				selectedPlugins: ['/plugins/a', '__none__', '/plugins/b'],
				additionalPluginPaths: ' /plugins/c, ,/plugins/d ',
			},
		});

		expect(setup.queryOptions.plugins).toEqual([
			{ type: 'local', path: '/plugins/a' },
			{ type: 'local', path: '/plugins/b' },
			{ type: 'local', path: '/plugins/c' },
			{ type: 'local', path: '/plugins/d' },
		]);
	});

	it('uses LiteLLM manual model aliases for query options and provider env', async () => {
		const setup = await setupQuery({
			resolvedAuthMethod: 'litellm',
			options: {
				apiKey: undefined,
				liteLlmAuthToken: 'sk-litellm-token',
				liteLlmBaseUrl: 'http://proxy.local:4000/v1/',
			},
			params: {
				liteLlmModel: 'listed-alias',
				liteLlmModelAlias: 'manual-alias',
			},
		});

		expect(setup.apiProvider).toBe('litellm');
		expect(setup.queryOptions.model).toBe('manual-alias');
		expect(setup.queryOptions.env).toMatchObject({
			ANTHROPIC_BASE_URL: 'http://proxy.local:4000',
			ANTHROPIC_AUTH_TOKEN: 'sk-litellm-token',
			ANTHROPIC_API_KEY: '',
			ANTHROPIC_MODEL: 'manual-alias',
		});
	});

	it('defaults Opus 4.8 to adaptive thinking without a fixed budget', async () => {
		const setup = await setupQuery({
			params: {
				model: 'claude-opus-4-8',
				thinkingMode: 'default',
			},
		});

		expect(setup.queryOptions).toMatchObject({
			model: 'claude-opus-4-8',
			thinking: { type: 'adaptive' },
		});
		expect(setup.queryOptions.maxThinkingTokens).toBeUndefined();
	});

	it('defaults Sonnet 5 to adaptive thinking without a fixed budget', async () => {
		const setup = await setupQuery({
			params: {
				model: 'claude-sonnet-5',
				thinkingMode: 'default',
			},
		});

		expect(setup.queryOptions).toMatchObject({
			model: 'claude-sonnet-5',
			thinking: { type: 'adaptive' },
		});
		expect(setup.queryOptions.maxThinkingTokens).toBeUndefined();
	});

	it('suppresses fixed thinking budgets for Sonnet 5 and keeps xhigh effort', async () => {
		process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS = 'true';
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const setup = await setupQuery({
			params: {
				model: 'claude-sonnet-5',
				thinkingMode: 'enabled',
				thinkingBudgetTokens: 64000,
				effort: 'xhigh',
			},
			additionalOptions: {
				maxThinkingTokens: 32000,
			},
		});

		expect(setup.queryOptions).toMatchObject({
			model: 'claude-sonnet-5',
			thinking: { type: 'adaptive' },
			effort: 'xhigh',
		});
		expect(setup.queryOptions.maxThinkingTokens).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Fixed thinking budgets are not supported'));
		warnSpy.mockRestore();
	});

	it('suppresses fixed thinking budgets for Opus 4.8 and keeps effort', async () => {
		process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS = 'true';
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const setup = await setupQuery({
			params: {
				model: 'claude-opus-4-8',
				thinkingMode: 'enabled',
				thinkingBudgetTokens: 64000,
				effort: 'xhigh',
			},
			additionalOptions: {
				maxThinkingTokens: 32000,
			},
		});

		expect(setup.queryOptions).toMatchObject({
			model: 'claude-opus-4-8',
			thinking: { type: 'adaptive' },
			effort: 'xhigh',
		});
		expect(setup.queryOptions.maxThinkingTokens).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Fixed thinking budgets are not supported'));
		warnSpy.mockRestore();
	});

	it('defaults Fable 5 to adaptive thinking', async () => {
		const setup = await setupQuery({
			params: {
				model: 'claude-fable-5',
				thinkingMode: 'default',
			},
		});

		expect(setup.queryOptions).toMatchObject({
			model: 'claude-fable-5',
			thinking: { type: 'adaptive' },
		});
	});

	it('omits the thinking field for Fable 5 when thinking is disabled (explicit disable returns 400)', async () => {
		const setup = await setupQuery({
			params: {
				model: 'claude-fable-5',
				thinkingMode: 'disabled',
				effort: 'high',
			},
		});

		expect(setup.queryOptions.thinking).toBeUndefined();
		expect(setup.queryOptions).toMatchObject({
			model: 'claude-fable-5',
			effort: 'high',
		});
		expect(setup.queryOptions.maxThinkingTokens).toBeUndefined();
	});

	it('keeps the explicit thinking disable for Opus 4.8 (still accepted there)', async () => {
		const setup = await setupQuery({
			params: {
				model: 'claude-opus-4-8',
				thinkingMode: 'disabled',
			},
		});

		expect(setup.queryOptions).toMatchObject({
			model: 'claude-opus-4-8',
			thinking: { type: 'disabled' },
		});
	});

	it('maps fast mode to the fast-mode beta on supported official Opus models', async () => {
		const setup = await setupQuery({
			params: {
				model: 'claude-opus-4-8',
				fastMode: true,
			},
			additionalOptions: {
				betas: ['context-1m-2025-08-07'],
			},
		});

		// Fast mode rides exclusively on the beta header; a 'speed' query-option
		// key does not exist in the SDK Options and was silently dropped.
		expect(setup.queryOptions).toMatchObject({
			model: 'claude-opus-4-8',
		});
		expect(setup.queryOptions).not.toHaveProperty('speed');
		expect(setup.queryOptions.betas).toEqual([
			'context-1m-2025-08-07',
			'fast-mode-2026-02-01',
		]);
	});

	it('rejects fast mode outside the official Claude API Opus preview surface', async () => {
		await expect(
			setupQuery({
				params: {
					model: 'claude-sonnet-4-6',
					fastMode: true,
				},
			}),
		).rejects.toThrow(/Fast Mode is a Claude API research preview/);

		await expect(
			setupQuery({
				resolvedAuthMethod: 'openrouter',
				options: {
					apiKey: undefined,
					openrouterAuthToken: 'openrouter-token',
				},
				params: {
					model: 'claude-opus-4-8',
					fastMode: true,
				},
			}),
		).rejects.toThrow(/Fast Mode is a Claude API research preview/);
	});

	it('rejects proxy manager when neither sandbox nor operator policy enables sandboxing', async () => {
		await expect(
			setupQuery({
				additionalOptions: {
					useProxyManager: true,
					proxyHttpUrl: 'http://proxy.local:8080',
				},
			}),
		).rejects.toThrow(/Proxy Manager is enabled, but sandboxing is disabled/);
	});
});
