import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ClaudeApi implements ICredentialType {
	name = 'claudeApi';
	displayName = 'Claude Agent SDK Anthropic API';
	documentationUrl = 'https://docs.anthropic.com/en/api/getting-started';
	icon = { light: 'file:../nodes/ClaudeAgentSdk/claude-color.svg', dark: 'file:../nodes/ClaudeAgentSdk/claude-color.svg' } as const;
	extends = ['claudeAgentSdkProviderApi'];
	properties: INodeProperties[] = [
		{
			displayName: 'Authentication Type',
			name: 'authType',
			type: 'options',
			options: [
				{ name: 'API Key', value: 'apiKey' },
				{ name: 'Claude Code CLI (Subscription)', value: 'cliExecutable' },
			],
			default: 'apiKey',
			description: 'How to authenticate with Claude',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			displayOptions: {
				show: {
					authType: ['apiKey'],
				},
			},
			description: 'Your Anthropic API key',
		},
		{
			displayName: 'Claude Code Executable Path',
			name: 'executablePath',
			type: 'string',
			default: '',
			required: false,
			displayOptions: {
				show: {
					authType: ['cliExecutable'],
				},
			},
			description:
				'Optional absolute path to a custom Claude Code CLI binary. Leave empty to use the npm-installed @anthropic-ai/claude-code peer dependency. Requires a Claude Code login for the n8n runtime user.',
			placeholder: 'Auto-detected from npm install',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
				'anthropic-version': '2023-06-01',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.anthropic.com',
			url: '/v1/models',
			method: 'GET',
		},
	};

}
