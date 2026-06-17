import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class AlibabaCodingPlanApi implements ICredentialType {
	name = 'alibabaCodingPlanApi';
	displayName = 'Alibaba Coding Plan API';
	documentationUrl = 'https://help.aliyun.com/zh/model-studio/developer-reference/China-coding-plan';
	icon = { light: 'file:../icons/alibaba.svg', dark: 'file:../icons/alibaba.dark.svg' } as const;
	extends = ['claudeAgentSdkProviderApi'];
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
			description: 'Alibaba Coding Plan base URL (DashScope endpoint)',
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
			description: 'Your Alibaba Coding Plan API key',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey || $credentials.authToken}}',
			},
		},
	};

	// Alibaba Coding Plan does not expose a /v1/models or health endpoint.
	// Send a minimal messages request — a valid key returns 400 (missing body),
	// an invalid key returns 401. We accept any non-401 as "connected".
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/messages',
			method: 'POST',
			body: {
				model: 'qwen3.5-plus',
				max_tokens: 1,
				messages: [{ role: 'user', content: 'hi' }],
			},
		},
	};
}
