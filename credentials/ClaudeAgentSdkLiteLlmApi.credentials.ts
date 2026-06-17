import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { PROVIDER_DEFAULTS } from '../nodes/ClaudeAgentSdk/providerConfig';

export class ClaudeAgentSdkLiteLlmApi implements ICredentialType {
	name = 'claudeAgentSdkLiteLlmApi';
	displayName = 'Claude Agent SDK LiteLLM API';
	documentationUrl = 'https://docs.litellm.ai/docs/proxy/quick_start';
	icon = {
		light: 'file:../nodes/ClaudeAgentSdk/claude-color.svg',
		dark: 'file:../nodes/ClaudeAgentSdk/claude-color.svg',
	} as const;
	extends = ['claudeAgentSdkProviderApi'];
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: PROVIDER_DEFAULTS.liteLlmBaseUrl,
			description: 'LiteLLM proxy root URL. Use the proxy root, not the /v1 path.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
			description: 'Your LiteLLM proxy API key',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: `={{String($credentials.baseUrl || "${PROVIDER_DEFAULTS.liteLlmBaseUrl}").trim().replace(/\\/+$/, "").replace(/\\/v1$/, "")}}`,
			url: '/v1/models',
			method: 'GET',
		},
	};
}
