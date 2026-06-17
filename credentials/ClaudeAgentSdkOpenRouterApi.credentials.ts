import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { PROVIDER_DEFAULTS } from '../nodes/ClaudeAgentSdk/providerConfig';

export class ClaudeAgentSdkOpenRouterApi implements ICredentialType {
	name = 'claudeAgentSdkOpenRouterApi';
	displayName = 'Claude Agent SDK OpenRouter API';
	documentationUrl = 'https://openrouter.ai/docs';
	icon = {
		light: 'file:../icons/openrouter.svg',
		dark: 'file:../icons/openrouter.dark.svg',
	} as const;
	extends = ['claudeAgentSdkProviderApi'];
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
			description: 'Your OpenRouter API key',
		},
		{
			displayName: 'Base URL',
			name: 'url',
			type: 'hidden',
			default: PROVIDER_DEFAULTS.openrouterCredentialBaseUrl,
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
			baseURL: '={{$credentials.url}}',
			url: '/key',
		},
	};
}
