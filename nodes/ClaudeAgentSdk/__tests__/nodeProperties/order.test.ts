import { describe, it, expect } from 'vitest';

import { nodeProperties } from '../../nodeProperties';
import { executeTaskCoreProperties, executionSettingsProperty } from '../../nodeProperties/executeTask';
import { additionalOptionsProperty } from '../../nodeProperties/additionalOptions';
import { structuredOutputProperties } from '../../nodeProperties/structuredOutput';

function getOptionNames(property: { options?: Array<{ name: string }> }): string[] {
	return (property.options ?? []).map((option) => option.name);
}

describe('node properties order', () => {
	it('keeps execute task core properties grouped in operational order', () => {
		expect(executeTaskCoreProperties.map((property) => property.name)).toEqual([
			'taskDescription',
			'operation',
			'backendMode',
			'workingDirectory',
			'chatSessionId',
			'model',
			'liteLlmModel',
			'liteLlmModelAlias',
			'codeMieModel',
			'codeMieModelManual',
			'thinkingMode',
			'thinkingBudgetTokens',
			'effort',
			'fastMode',
			'permissionMode',
			'allowedTools',
			'disallowedTools',
			'availableSkills',
		]);
	});

	it('keeps execution settings alphabetised (n8n collection lint rule)', () => {
		expect(getOptionNames(executionSettingsProperty as { options?: Array<{ name: string }> })).toEqual([
			'additionalDirectories',
			'forkSession',
			'maxObservabilityBytes',
			'maxObservabilityEvents',
			'maxTurns',
			'observabilityMode',
			'redactObservabilityPayloads',
			'treatAgentErrorsAsWorkflowErrors',
		]);
	});

	it('keeps additional options alphabetised by displayName (n8n collection lint rule)', () => {
		expect(getOptionNames(additionalOptionsProperty as { options?: Array<{ name: string }> })).toEqual([
			'alibabaNotice',           // Alibaba Coding Plan Setup
			'allowedEnvVarNames',      // Allowlisted Environment Variables
			'apiProvider',             // API Provider
			'betas',                   // Betas
			'blockedTools',            // Blocked Tools
			'claudeConfigDir',         // Claude Config Directory
			'claudeConfigIsolationMode', // Claude Config Isolation Mode
			'correlationId',           // Correlation ID
			'customApiEndpoint',       // Custom API Endpoint
			'enableFileCheckpointing', // Enable File Checkpointing
			'promptSuggestions',       // Enable Prompt Suggestions
			'useProxyManager',         // Enable Proxy Manager
			'envSecurityMode',         // Environment Security Mode
			'env',                     // Environment Variables (JSON)
			'forwardSubagentText',     // Forward Subagent Text
			'includePartialMessages',  // Include Partial Messages
			'useSecureEnv',            // Inject Secure Environment Variables
			'isolateClaudeConfigDir',  // Isolate Claude Config Directory
			'liteLlmNotice',           // LiteLLM Setup
			'loadProjectClaudeMd',     // Load Project CLAUDE.md
			'loadUserSettings',        // Load User Settings
			'managedSettings',         // Managed Settings (JSON)
			'maxBudgetUsd',            // Max Budget (USD)
			'maxBufferSizeMb',         // Max Buffer Size (MB)
			'maxThinkingTokens',       // Max Thinking Tokens (Deprecated)
			'ollamaBaseUrl',           // Ollama Base URL
			'ollamaModel',             // Ollama Model
			'ollamaNotice',            // Ollama Setup
			'openrouterNotice',        // OpenRouter Setup
			'persistSession',          // Persist Session
			'proxyCaBundlePath',       // Proxy CA Bundle Path
			'proxyHttpUrl',            // Proxy HTTP URL
			'proxyHttpsUrl',           // Proxy HTTPS URL
			'proxyNoProxy',            // Proxy No-Proxy List
			'sessionTitle',            // Session Title
			'skillsFilter',            // Skills Filter
			'systemPrompt',            // System Prompt
			'userPromptContext',       // User Prompt Context
		]);
	});

	it('keeps top-level sections in the intended order', () => {
		const names = nodeProperties.map((property) => property.name);

		
		// backendMode inside executeTaskCoreProperties, after operation
		expect(names.indexOf('backendMode')).toBeGreaterThan(names.indexOf('operation'));
		expect(names.indexOf('authentication')).toBeGreaterThanOrEqual(0);
		expect(names.indexOf('authentication')).toBeLessThan(names.indexOf('taskDescription'));

		// Operation selector sits directly after task description
		expect(names.indexOf('taskDescription')).toBeLessThan(names.indexOf('operation'));
		expect(names.indexOf('operation')).toBeLessThan(names.indexOf('workingDirectory'));

		expect(names.indexOf('taskDescription')).toBeLessThan(names.indexOf('executionSettings'));
		expect(names.indexOf('permissionMode')).toBeLessThan(names.indexOf('interactiveApprovals'));
		expect(names.indexOf('interactiveApprovals')).toBeLessThan(names.indexOf('executionSettings'));
		expect(names.indexOf('executionSettings')).toBeLessThan(names.indexOf('useClaudeCodePreset'));
		expect(names.indexOf('useClaudeCodePreset')).toBeLessThan(names.indexOf('claudeCodePromptSections'));
		expect(names.indexOf('claudeCodePromptSections')).toBeLessThan(names.indexOf('additionalOptions'));
		expect(names.indexOf('model')).toBeLessThan(names.indexOf('liteLlmModel'));
		expect(names.indexOf('liteLlmModel')).toBeLessThan(names.indexOf('thinkingMode'));
		expect(names.indexOf('openrouterHaikuModel')).toBeLessThan(names.indexOf('ollamaModel'));
		expect(names.indexOf('liteLlmModel')).toBeLessThan(names.indexOf('ollamaModel'));
	});

	it('places structured output failure policy after schema inputs', () => {
		expect(structuredOutputProperties.map((property) => property.name)).toEqual([
			'structuredOutput',
			'schemaType',
			'outputAttributes',
			'jsonSchemaExample',
			'jsonSchemaNotice',
			'outputJsonSchema',
			'structuredOutputFailureMode',
		]);
	});
});
