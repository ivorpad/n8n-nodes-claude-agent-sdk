import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class ClaudeAgentSdkProviderApi implements ICredentialType {
	name = 'claudeAgentSdkProviderApi';
	displayName = 'Claude Agent SDK Provider API';
	documentationUrl = 'https://github.com/ivorpad/n8n-nodes-claude-agent-sdk';
	icon = { light: 'file:../nodes/ClaudeAgentSdk/claude-color.svg', dark: 'file:../nodes/ClaudeAgentSdk/claude-color.svg' } as const;
	properties: INodeProperties[] = [];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://example.com',
			url: '/',
			method: 'GET',
		},
	};
}
