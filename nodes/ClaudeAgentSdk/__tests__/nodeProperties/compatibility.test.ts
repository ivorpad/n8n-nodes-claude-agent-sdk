import { describe, expect, it } from 'vitest';

import { executeTaskCoreProperties, executionSettingsProperty } from '../../nodeProperties/executeTask';
import { nodeProperties } from '../../nodeProperties';
import { companionAgentProperty } from '../../nodeProperties/companionAgent';
import { additionalOptionsProperty } from '../../nodeProperties/additionalOptions';
import { structuredOutputProperties } from '../../nodeProperties/structuredOutput';
import { approvalProperties } from '../../permissions/approvalProperties';
import { permissionsProperties } from '../../permissions/properties';
import {
	PHOENIX_COMPANION_BASE_URL,
	PHOENIX_COMPANION_LOCAL_BASE_URL,
} from '../../companion/client';

function findProperty(
	properties: Array<{
		name: string;
		default?: unknown;
		type?: unknown;
		typeOptions?: unknown;
		options?: unknown;
		values?: unknown;
	}>,
	name: string,
): {
	name: string;
	default?: unknown;
	type?: unknown;
	typeOptions?: unknown;
	options?: unknown;
	values?: unknown;
} {
	const property = properties.find((entry) => entry.name === name);
	if (!property) {
		throw new Error(`Missing property: ${name}`);
	}
	return property;
}

function hasLoadOptionsMethod(property: { typeOptions?: unknown }, methodName: string): boolean {
	if (!property.typeOptions || typeof property.typeOptions !== 'object') {
		return false;
	}

	const record = Object.fromEntries(Object.entries(property.typeOptions));
	return record.loadOptionsMethod === methodName;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	return Object.fromEntries(Object.entries(value));
}

function findNamedChild(
	items: unknown,
	name: string,
): Record<string, unknown> | undefined {
	if (!Array.isArray(items)) {
		return undefined;
	}

	for (const item of items) {
		const record = asRecord(item);
		if (record?.name === name) {
			return record;
		}
	}

	return undefined;
}

function findAgtRuleToolsProperty(): { name: string; typeOptions?: unknown } {
	const securityOptions = findProperty(permissionsProperties, 'securityOptions');
	const agtGovernance = findNamedChild(securityOptions.options, 'agtGovernance');
	if (!agtGovernance) {
		throw new Error('Missing AGT governance property');
	}

	const settings = findNamedChild(agtGovernance.options, 'settings');
	if (!settings) {
		throw new Error('Missing AGT settings property');
	}

	const rules = findNamedChild(settings.values, 'rules');
	if (!rules) {
		throw new Error('Missing AGT rules property');
	}

	const ruleGroup = findNamedChild(rules.options, 'values');
	if (!ruleGroup) {
		throw new Error('Missing AGT rule group');
	}

	const toolProperty = findNamedChild(ruleGroup.values, 'tools');
	if (!toolProperty) {
		throw new Error('Missing AGT tools property');
	}

	return toolProperty;
}

describe('node properties compatibility', () => {
	it('keeps execute task core parameter names stable', () => {
		const names = executeTaskCoreProperties.map((property) => property.name);

		expect(names).toEqual(
			expect.arrayContaining([
				'taskDescription',
				'workingDirectory',
				'chatSessionId',
				'model',
				'thinkingMode',
				'thinkingBudgetTokens',
				'effort',
				'fastMode',
				'permissionMode',
				'allowedTools',
				'disallowedTools',
				'availableSkills',
			]),
		);
	});

	it('does not define a blank credentials slot marker', () => {
		expect(executeTaskCoreProperties.some((property) => property.type === 'credentials')).toBe(false);
		expect(executeTaskCoreProperties.some((property) => property.name === '')).toBe(false);
	});

	it('keeps execute task core defaults stable for key fields', () => {
		expect(findProperty(executeTaskCoreProperties, 'taskDescription').default).toBe('');
		expect(findProperty(executeTaskCoreProperties, 'workingDirectory').default).toBe('');
		expect(findProperty(executeTaskCoreProperties, 'chatSessionId').default).toBe('');
		expect(findProperty(executeTaskCoreProperties, 'model').default).toBe('');
		expect(findProperty(executeTaskCoreProperties, 'thinkingMode').default).toBe('default');
		expect(findProperty(executeTaskCoreProperties, 'thinkingBudgetTokens').default).toBe(10000);
		expect(findProperty(executeTaskCoreProperties, 'effort').default).toBe('');
		expect(findProperty(executeTaskCoreProperties, 'fastMode').default).toBe(false);
		expect(findProperty(executeTaskCoreProperties, 'permissionMode').default).toBe('default');
		expect(findProperty(executeTaskCoreProperties, 'allowedTools').default).toEqual([]);
		expect(findProperty(executeTaskCoreProperties, 'disallowedTools').default).toEqual([]);
		expect(findProperty(executeTaskCoreProperties, 'availableSkills').default).toEqual([]);
	});

	it('exposes current SDK effort levels', () => {
		const effort = findProperty(executeTaskCoreProperties, 'effort') as {
			options?: Array<{ value: string }>;
		};
		const values = (effort.options ?? []).map((option) => option.value);

		expect(values).toEqual(expect.arrayContaining(['', 'low', 'medium', 'high', 'xhigh', 'max']));
	});

	it('exposes the consolidated Anthropic model lineup (Default + 4 current models)', () => {
		const model = findProperty(executeTaskCoreProperties, 'model') as {
			options?: Array<{ value: string }>;
		};
		const values = (model.options ?? []).map((option) => option.value);

		expect(values).toEqual([
			'',
			'claude-fable-5',
			'claude-opus-4-8',
			'claude-sonnet-4-6',
			'claude-haiku-4-5',
		]);
	});

	it('loads allowed and disallowed tools dynamically from configured MCP servers', () => {
		expect(hasLoadOptionsMethod(findProperty(executeTaskCoreProperties, 'allowedTools'), 'listToolOptions')).toBe(true);
		expect(hasLoadOptionsMethod(findProperty(executeTaskCoreProperties, 'disallowedTools'), 'listToolOptions')).toBe(true);
	});

	it('loads LiteLLM model aliases via a node loadOptions method', () => {
		const property = findProperty(executeTaskCoreProperties, 'liteLlmModel');
		const typeOptions = asRecord(property.typeOptions);

		expect(hasLoadOptionsMethod(property, 'listLiteLlmModels')).toBe(true);
		expect(typeOptions?.loadOptions).toBeUndefined();
	});

	it('loads AGT and HITL tool selectors dynamically from configured MCP servers', () => {
		expect(hasLoadOptionsMethod(findProperty(approvalProperties, 'toolsRequiringApproval'), 'listToolOptions')).toBe(true);
		expect(hasLoadOptionsMethod(findAgtRuleToolsProperty(), 'listToolOptions')).toBe(true);
	});

	it('keeps execution settings parameter names and defaults stable', () => {
		const options = (executionSettingsProperty.options ?? []) as Array<{
			name: string;
			default?: unknown;
		}>;

		expect(options.map((option) => option.name)).toEqual(
			expect.arrayContaining([
				'maxTurns',
				'treatAgentErrorsAsWorkflowErrors',
				'observabilityMode',
				'maxObservabilityEvents',
				'maxObservabilityBytes',
				'redactObservabilityPayloads',
				'forkSession',
				'additionalDirectories',
			]),
		);
		expect(options.map((option) => option.name)).not.toEqual(
			expect.arrayContaining([
				'observabilityPersistenceBackend',
				'observabilityPersistenceStrict',
				'observabilityPostgresTable',
			]),
		);

		expect(findProperty(options, 'maxTurns').default).toBe(0);
		expect(findProperty(options, 'treatAgentErrorsAsWorkflowErrors').default).toBe(false);
		expect(findProperty(options, 'observabilityMode').default).toBe('summary');
		expect(findProperty(options, 'maxObservabilityEvents').default).toBe(500);
		expect(findProperty(options, 'maxObservabilityBytes').default).toBe(262144);
		expect(findProperty(options, 'redactObservabilityPayloads').default).toBe(true);
		expect(findProperty(options, 'forkSession').default).toBe(false);
		expect(findProperty(options, 'additionalDirectories').default).toBe('');
	});

	it('keeps additional options parameter names and defaults stable', () => {
		const options = (additionalOptionsProperty.options ?? []) as Array<{
			name: string;
			default?: unknown;
		}>;

		expect(options.map((option) => option.name)).toEqual(
			expect.arrayContaining([
				'apiProvider',
				'customApiEndpoint',
				'liteLlmNotice',
				'ollamaBaseUrl',
				'ollamaModel',
				'ollamaNotice',
				'openrouterNotice',
				'systemPrompt',
				'userPromptContext',
				'env',
				'useProxyManager',
				'proxyHttpUrl',
				'proxyHttpsUrl',
				'proxyNoProxy',
				'proxyCaBundlePath',
				'envSecurityMode',
				'allowedEnvVarNames',
				'isolateClaudeConfigDir',
				'claudeConfigIsolationMode',
				'useSecureEnv',
				'loadProjectClaudeMd',
				'loadUserSettings',
				'maxBudgetUsd',
				'includePartialMessages',
				'forwardSubagentText',
				'sessionTitle',
				'skillsFilter',
				'managedSettings',
				'enableFileCheckpointing',
				'correlationId',
				'blockedTools',
				'betas',
				'maxThinkingTokens',
			]),
		);

		expect(findProperty(options, 'apiProvider').default).toBe('anthropic');
		expect(findProperty(options, 'customApiEndpoint').default).toBe('');
		expect(findProperty(options, 'liteLlmNotice').default).toBe('');
		expect(findProperty(options, 'ollamaBaseUrl').default).toBe('http://localhost:11434');
		expect(findProperty(options, 'ollamaModel').default).toBe('qwen2.5-coder:latest');
		expect(findProperty(options, 'env').default).toBe('{}');
		expect(findProperty(options, 'useProxyManager').default).toBe(false);
		expect(findProperty(options, 'proxyHttpUrl').default).toBe('');
		expect(findProperty(options, 'proxyHttpsUrl').default).toBe('');
		expect(findProperty(options, 'proxyNoProxy').default).toBe('');
		expect(findProperty(options, 'proxyCaBundlePath').default).toBe('');
		expect(findProperty(options, 'envSecurityMode').default).toBe('blocklist');
		expect(findProperty(options, 'allowedEnvVarNames').default).toBe('');
		expect(findProperty(options, 'isolateClaudeConfigDir').default).toBe(false);
		expect(findProperty(options, 'claudeConfigIsolationMode').default).toBe('perWorkflow');
		expect(findProperty(options, 'useSecureEnv').default).toBe(false);
		expect(findProperty(options, 'loadProjectClaudeMd').default).toBe(true);
		expect(findProperty(options, 'loadUserSettings').default).toBe(false);
		expect(findProperty(options, 'maxBudgetUsd').default).toBe(0);
		expect(findProperty(options, 'includePartialMessages').default).toBe(false);
		expect(findProperty(options, 'forwardSubagentText').default).toBe(false);
		expect(findProperty(options, 'sessionTitle').default).toBe('');
		expect(findProperty(options, 'skillsFilter').default).toBe('');
		expect(findProperty(options, 'managedSettings').default).toBe('');
		expect(findProperty(options, 'enableFileCheckpointing').default).toBe(false);
		expect(findProperty(options, 'correlationId').default).toBe('');
		expect(findProperty(options, 'blockedTools').default).toBe('');
		expect(findProperty(options, 'betas').default).toEqual([]);
		expect(findProperty(options, 'maxThinkingTokens').default).toBe(0);
	});

	it('keeps Claude Code preset controls as top-level local CLI properties', () => {
		expect(findProperty(nodeProperties, 'useClaudeCodePreset').default).toBe(true);
		expect(findProperty(nodeProperties, 'claudeCodePromptSections').default).toEqual([]);
	});

	it('keeps Agent Plane configured by agent ID with a hard-coded base URL', () => {
		const options = (companionAgentProperty.options ?? []) as Array<{
			name: string;
			displayOptions?: unknown;
		}>;
		const optionNames = options.map((option) => option.name);
		const allPropertyNames = nodeProperties.map((property) => property.name);
		const serializedCompanionProperty = JSON.stringify(companionAgentProperty).toLowerCase();

		expect(PHOENIX_COMPANION_BASE_URL).toBe('http://host.docker.internal:4000');
		expect(PHOENIX_COMPANION_LOCAL_BASE_URL).toBe('http://127.0.0.1:4000');
		expect(optionNames).toEqual([
			'companionAgentId',
			'companionLifecycleCallbacks',
			'companionReadinessMode',
			'companionRequireSynced',
			'useCompanionAgent',
		]);
		expect(allPropertyNames).not.toContain('companionBaseUrl');
		expect(allPropertyNames).not.toContain('phoenixBaseUrl');
		expect(serializedCompanionProperty).not.toContain('baseurl');
		expect(serializedCompanionProperty).not.toContain('n8napikey');
		expect(options.every((option) => option.displayOptions === undefined)).toBe(true);

		const agentProperty = options.find((option) => option.name === 'companionAgentId') as
			| {
					type?: string;
					default?: unknown;
					modes?: Array<{ name: string; typeOptions?: { searchListMethod?: string } }>;
			  }
			| undefined;
		expect(agentProperty).toMatchObject({
			type: 'resourceLocator',
			default: { mode: 'list', value: '' },
		});
		expect(agentProperty?.modes?.map((mode) => mode.name)).toEqual(['list', 'id']);
		expect(agentProperty?.modes?.[0]).toMatchObject({
			typeOptions: { searchListMethod: 'listCompanionAgents' },
		});
	});

	it('hides manual working directory when Agent Plane owns workspace resolution', () => {
		expect(findProperty(nodeProperties, 'workingDirectory').displayOptions).toMatchObject({
			hide: {
				'/companionAgent.useCompanionAgent': [true],
			},
		});
	});

	it('keeps structured output failure policy parameter stable', () => {
		const names = structuredOutputProperties.map((property) => property.name);
		expect(names).toContain('structuredOutputFailureMode');
		expect(findProperty(structuredOutputProperties, 'structuredOutputFailureMode').default).toBe(
			'continueWithError',
		);
	});
});
