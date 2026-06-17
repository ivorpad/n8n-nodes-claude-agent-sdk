/**
 * Provider auth-method resolution, shared by Execute Task (node/execute.ts)
 * and Generate Python SDK (operations/generatePythonSdk) — previously two
 * identical copies.
 *
 * Maps every parameter generation onto one AuthMethod:
 * - current single authentication dropdown (value = credential type name),
 * - the removed 'predefinedCredentialType' + nodeCredentialType selector,
 * - pre-selector authentication-only values
 *   ('apiCredentials'/'cliSession'/'openrouter'/'alibaba'/'litellm'/'ollama').
 */

export const AUTH_METHOD_VALUES = [
	'apiCredentials',
	'cliSession',
	'openrouter',
	'ollama',
	'alibaba',
	'litellm',
	'codemie',
] as const;

export type AuthMethod = (typeof AUTH_METHOD_VALUES)[number];

export const NODE_CREDENTIAL_TYPE_VALUES = [
	'claudeApi',
	'anthropicApi',
	'openRouterApi',
	'claudeAgentSdkOpenRouterApi',
	'alibabaCodingPlanApi',
	'claudeAgentSdkLiteLlmApi',
	'codeMieSsoApi',
] as const;

export type NodeCredentialType = (typeof NODE_CREDENTIAL_TYPE_VALUES)[number];

export function isNodeCredentialType(value: string): value is NodeCredentialType {
	return (
		value === 'claudeApi' ||
		value === 'anthropicApi' ||
		value === 'openRouterApi' ||
		value === 'claudeAgentSdkOpenRouterApi' ||
		value === 'alibabaCodingPlanApi' ||
		value === 'claudeAgentSdkLiteLlmApi' ||
		value === 'codeMieSsoApi'
	);
}

export function resolveAuthMethod(authentication: string, nodeCredentialType: string): AuthMethod {
	// Current dropdown values: the provider choice is the credential type name.
	if (authentication === 'claudeApi') {
		return 'apiCredentials';
	}
	if (authentication === 'claudeAgentSdkOpenRouterApi') {
		return 'openrouter';
	}
	if (authentication === 'alibabaCodingPlanApi') {
		return 'alibaba';
	}
	if (authentication === 'claudeAgentSdkLiteLlmApi') {
		return 'litellm';
	}
	if (authentication === 'codeMieSsoApi') {
		return 'codemie';
	}
	// Legacy authentication-only values (pre-selector saves).
	if (authentication === 'apiCredentials' || authentication === 'cliSession') {
		return authentication;
	}
	if (
		authentication === 'openrouter' ||
		authentication === 'alibaba' ||
		authentication === 'litellm' ||
		authentication === 'codemie'
	) {
		return authentication;
	}
	if (authentication === 'ollama' || authentication === 'none') {
		return 'ollama';
	}

	// Legacy 'predefinedCredentialType' saves: the selector value decides.
	if (!isNodeCredentialType(nodeCredentialType)) {
		return 'apiCredentials';
	}
	if (
		nodeCredentialType === 'openRouterApi' ||
		nodeCredentialType === 'claudeAgentSdkOpenRouterApi'
	) {
		return 'openrouter';
	}
	if (nodeCredentialType === 'alibabaCodingPlanApi') {
		return 'alibaba';
	}
	if (nodeCredentialType === 'claudeAgentSdkLiteLlmApi') {
		return 'litellm';
	}
	if (nodeCredentialType === 'codeMieSsoApi') {
		return 'codemie';
	}
	return 'apiCredentials';
}
