import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class WoztellBotApi implements ICredentialType {
	name = 'woztellBotApi';

	displayName = 'Woztell Bot API';

	documentationUrl = 'https://doc.woztell.com/docs/reference/bot-api-reference';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'WOZTELL access token. Create at Settings > Access Tokens on the WOZTELL platform. Requires permissions: channel:list, botapi:sendResponses.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://open.api.woztell.com',
			url: '/v3',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				query: 'query { apiViewer { channels(first: 1, type: "whatsapp-cloud") { edges { node { _id } } } } }',
			}),
		},
	};
}
