import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { PHOENIX_COMPANION_LOCAL_BASE_URL } from '../nodes/ClaudeAgentSdk/companion/client';

const shouldRestrictToSupportedNodes = () => process.env.N8N_DEV_RELOAD !== 'true';

export class ClaudeAgentCompanionApi implements ICredentialType {
	name = 'claudeAgentCompanionApi';
	displayName = 'Agent Plane API';
	documentationUrl = 'https://github.com/ivorpad/n8n-nodes-claude-agent-sdk';
	icon = {
		light: 'file:../nodes/ClaudeAgentSdk/claude-color.svg',
		dark: 'file:../nodes/ClaudeAgentSdk/claude-color.svg',
	} as const;
	supportedNodes = ['claudeAgentSdk'];
	restrictToSupportedNodes?: true;
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};
	properties: INodeProperties[] = [
		{
			displayName: 'Agent Plane API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'Agent Plane API key generated in Agent Plane and stored in n8n',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			url: `${PHOENIX_COMPANION_LOCAL_BASE_URL}/api/n8n/credential-test`,
			method: 'GET',
		},
	};

	constructor() {
		if (shouldRestrictToSupportedNodes()) {
			this.restrictToSupportedNodes = true;
		}
	}
}
