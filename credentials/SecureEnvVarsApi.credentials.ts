import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SecureEnvVarsApi implements ICredentialType {
	name = 'secureEnvVarsApi';
	displayName = 'Secure Environment Variables';
	documentationUrl = 'https://docs.n8n.io/credentials/';
	icon = {
		light: 'file:../nodes/ClaudeAgentSdk/claude-color.svg',
		dark: 'file:../nodes/ClaudeAgentSdk/claude-color.svg',
	} as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Environment Variables',
			name: 'vars',
			type: 'fixedCollection',
			typeOptions: {
				multipleValues: true,
			},
			default: {},
			placeholder: 'Add Variable',
			options: [
				{
					displayName: 'Variable',
					name: 'values',
					values: [
						{
							displayName: 'Name',
							name: 'key',
							type: 'string',
							default: '',
							placeholder: 'OPENAI_API_KEY',
							description: 'Environment variable name (e.g. OPENAI_API_KEY)',
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'string',
							typeOptions: {
								password: true,
							},
							default: '',
							description: 'Secret value (encrypted at rest)',
						},
					],
				},
			],
			description: 'API keys and secrets to inject as environment variables into the Claude subprocess. Values are encrypted at rest by n8n and decrypted only during execution.',
		},
	];
}
