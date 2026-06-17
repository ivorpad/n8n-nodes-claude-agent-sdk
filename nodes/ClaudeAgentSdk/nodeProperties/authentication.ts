/**
 * Authentication configuration properties
 *
 * One dropdown: the provider choice IS the credential-type choice (each
 * option's value is the credential type name, plus 'none' for local Ollama).
 * The matching credential picker is rendered by the provider entries declared
 * in node/description.ts, gated on this value.
 *
 * Deliberately NOT the HTTP Request authentication + credentialsSelect shape:
 * that pattern was tried and reverted twice. credentialsSelect renders its own
 * override credential picker in addition to the declared-credential picker
 * (duplicate rows), and its dynamic type resolution only works end-to-end for
 * the built-in HTTP Request node — the sole holder of n8n core's fullAccess
 * getCredentials() bypass. Legacy saved values from both prior shapes
 * ('apiCredentials'/'cliSession'/'openrouter'/'alibaba'/'ollama' and
 * 'predefinedCredentialType' + nodeCredentialType) keep executing — the
 * runtime reads raw saved parameters.
 */

import type { INodeProperties } from 'n8n-workflow';

export const authenticationProperty: INodeProperties = {
	displayName: 'Authentication',
	name: 'authentication',
	type: 'options',
	required: true,
	noDataExpression: true,
	options: [
		{
			name: 'Anthropic API',
			value: 'claudeApi',
			description: 'Anthropic API key or Claude CLI session',
		},
		{
			name: 'OpenRouter API',
			value: 'claudeAgentSdkOpenRouterApi',
			description: 'OpenRouter API key (Anthropic-compatible gateway)',
		},
		{
			name: 'Alibaba Coding Plan API',
			value: 'alibabaCodingPlanApi',
			description: 'Alibaba Coding Plan token (Anthropic-compatible gateway)',
		},
		{
			name: 'Ollama (Local)',
			value: 'none',
			description: 'Use local Ollama endpoint (no credentials required)',
		},
	],
	default: 'claudeApi',
	description: 'How to authenticate with Claude',
};
