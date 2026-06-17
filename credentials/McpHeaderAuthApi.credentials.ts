import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class McpHeaderAuthApi implements ICredentialType {
	name = 'mcpHeaderAuthApi';
	displayName = 'MCP Server Authentication API';
	documentationUrl = 'https://modelcontextprotocol.io/';
	icon = { light: 'file:../nodes/ClaudeAgentSdk/claude-color.svg', dark: 'file:../nodes/ClaudeAgentSdk/claude-color.svg' } as const;
	properties: INodeProperties[] = [
		{
			displayName: 'Header Name',
			name: 'headerName',
			type: 'string',
			default: 'Authorization',
			description: 'The HTTP header name for authentication',
		},
		{
			displayName: 'Header Value',
			name: 'headerValue',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'Bearer sk-xxx or your API key',
			description: 'The value for the authentication header',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://example.com',
			url: '/',
			method: 'GET',
		},
	};
}
