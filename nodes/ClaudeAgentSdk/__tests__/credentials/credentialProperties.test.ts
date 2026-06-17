import { describe, it, expect } from 'vitest';

import { ClaudeAgentSdkOpenRouterApi } from '../../../../credentials/ClaudeAgentSdkOpenRouterApi.credentials';
import { ClaudeAgentSdkProviderApi } from '../../../../credentials/ClaudeAgentSdkProviderApi.credentials';
import { ClaudeApi } from '../../../../credentials/ClaudeApi.credentials';
import { AlibabaCodingPlanApi } from '../../../../credentials/AlibabaCodingPlanApi.credentials';

const SDK_PROVIDER_BASE = 'claudeAgentSdkProviderApi';

describe('Credential properties', () => {
	it('keeps Claude Code executable path only on the Claude API credential', () => {
		const claudeProps = new ClaudeApi().properties;
		const alibabaProps = new AlibabaCodingPlanApi().properties;

		expect(claudeProps.some((prop) => prop.name === 'executablePath')).toBe(true);
		expect(alibabaProps.some((prop) => prop.name === 'executablePath')).toBe(false);
	});

	it('makes the Claude Code executable path an optional npm peer override', () => {
		const executablePath = new ClaudeApi().properties.find((prop) => prop.name === 'executablePath');

		expect(executablePath).toMatchObject({
			required: false,
			placeholder: 'Auto-detected from npm install',
		});
		expect(executablePath?.description).toContain('@anthropic-ai/claude-code');
	});

	it('labels the SDK Anthropic credential distinctly from n8n LangChain Anthropic', () => {
		expect(new ClaudeApi().displayName).toBe('Claude Agent SDK Anthropic API');
	});

	it('uses an SDK provider base type for credentialsSelect filtering', () => {
		expect(new ClaudeAgentSdkProviderApi().properties).toEqual([]);
		expect(new ClaudeApi().extends).toEqual([SDK_PROVIDER_BASE]);
		expect(new ClaudeAgentSdkOpenRouterApi().extends).toEqual([SDK_PROVIDER_BASE]);
		expect(new AlibabaCodingPlanApi().extends).toEqual([SDK_PROVIDER_BASE]);
	});

	it('keeps the SDK OpenRouter credential distinct from n8n LangChain OpenRouter', () => {
		expect(new ClaudeAgentSdkOpenRouterApi().name).toBe('claudeAgentSdkOpenRouterApi');
		expect(new ClaudeAgentSdkOpenRouterApi().displayName).toBe('Claude Agent SDK OpenRouter API');
	});
});
