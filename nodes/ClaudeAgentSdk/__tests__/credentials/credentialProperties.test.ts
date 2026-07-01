import { afterEach, describe, it, expect, vi } from 'vitest';

import { ClaudeAgentSdkOpenRouterApi } from '../../../../credentials/ClaudeAgentSdkOpenRouterApi.credentials';
import { ClaudeAgentSdkProviderApi } from '../../../../credentials/ClaudeAgentSdkProviderApi.credentials';
import { ClaudeApi } from '../../../../credentials/ClaudeApi.credentials';
import { AlibabaCodingPlanApi } from '../../../../credentials/AlibabaCodingPlanApi.credentials';
import { ClaudeAgentSdkLiteLlmApi } from '../../../../credentials/ClaudeAgentSdkLiteLlmApi.credentials';
import { ClaudeAgentCompanionApi } from '../../../../credentials/ClaudeAgentCompanionApi.credentials';
import { PHOENIX_COMPANION_BASE_URL } from '../../companion/client';

const SDK_PROVIDER_BASE = 'claudeAgentSdkProviderApi';

describe('Credential properties', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('keeps Claude Code executable path only on the Claude API credential', () => {
		const claudeProps = new ClaudeApi().properties;
		const alibabaProps = new AlibabaCodingPlanApi().properties;

		expect(claudeProps.some((prop) => prop.name === 'executablePath')).toBe(true);
		expect(alibabaProps.some((prop) => prop.name === 'executablePath')).toBe(false);
	});

	it('makes the Claude Code executable path an optional npm dependency override', () => {
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
		expect(new ClaudeAgentSdkLiteLlmApi().extends).toEqual([SDK_PROVIDER_BASE]);
	});

	it('stores only the Agent Plane API key in n8n credentials', () => {
		const credential = new ClaudeAgentCompanionApi();
		const propertyNames = credential.properties.map((property) => property.name);

		expect(credential.name).toBe('claudeAgentCompanionApi');
		expect(credential.displayName).toBe('Agent Plane API');
		expect(propertyNames).toEqual(['apiKey']);
		expect(propertyNames).not.toContain('baseUrl');
		expect(propertyNames).not.toContain('n8nApiKey');
		expect(credential.supportedNodes).toEqual([
			'claudeAgentSdk',
			'CUSTOM.claudeAgentSdk',
			'n8n-nodes-claude-agent-sdk.claudeAgentSdk',
		]);
		expect(credential.restrictToSupportedNodes).toBe(true);
		expect(credential.test.request.url).toBe(
			`${PHOENIX_COMPANION_BASE_URL}/api/n8n/credential-test`,
		);
		expect(credential.authenticate).toMatchObject({
			properties: {
				headers: {
					Authorization: '=Bearer {{$credentials.apiKey}}',
				},
			},
		});
	});

	it('omits supported-node restriction under the n8n custom dev loader', () => {
		vi.stubEnv('N8N_DEV_RELOAD', 'true');

		expect(new ClaudeAgentCompanionApi().restrictToSupportedNodes).toBeUndefined();
	});

	it('omits supported-node restriction under the n8n custom extension loader', () => {
		vi.stubEnv('N8N_CUSTOM_EXTENSIONS', '/opt/n8n-git-nodes/node_modules');

		expect(new ClaudeAgentCompanionApi().restrictToSupportedNodes).toBeUndefined();
	});

	it('keeps the SDK OpenRouter credential distinct from n8n LangChain OpenRouter', () => {
		expect(new ClaudeAgentSdkOpenRouterApi().name).toBe('claudeAgentSdkOpenRouterApi');
		expect(new ClaudeAgentSdkOpenRouterApi().displayName).toBe('Claude Agent SDK OpenRouter API');
	});

	it('defines LiteLLM proxy root and API key credential fields', () => {
		const credential = new ClaudeAgentSdkLiteLlmApi();
		const baseUrl = credential.properties.find((prop) => prop.name === 'baseUrl');
		const apiKey = credential.properties.find((prop) => prop.name === 'apiKey');

		expect(credential.name).toBe('claudeAgentSdkLiteLlmApi');
		expect(baseUrl).toMatchObject({
			displayName: 'Base URL',
			required: true,
			default: 'http://localhost:4000',
		});
		expect(apiKey).toMatchObject({
			displayName: 'API Key',
			required: true,
			typeOptions: { password: true },
		});
		expect(credential.authenticate).toMatchObject({
			properties: {
				headers: {
					Authorization: '=Bearer {{$credentials.apiKey}}',
				},
			},
		});
		expect(credential.test.request).toMatchObject({
			url: '/v1/models',
			method: 'GET',
		});
	});
});
