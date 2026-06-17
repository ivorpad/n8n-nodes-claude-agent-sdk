import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class WhatsAppBusinessCloudApi implements ICredentialType {
	name = 'whatsAppBusinessCloudApi';

	displayName = 'WhatsApp Business Cloud API';

	documentationUrl = 'https://developers.facebook.com/docs/whatsapp/cloud-api';

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
			description: 'Permanent or temporary WhatsApp Cloud API token',
		},
		{
			displayName: 'Phone Number ID',
			name: 'phoneNumberId',
			type: 'string',
			default: '',
			required: true,
			description: 'WhatsApp Business phone number ID used to send messages',
		},
		{
			displayName: 'App Secret',
			name: 'appSecret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description:
				'Meta app secret used to verify inbound WhatsApp webhook signatures. Required for in-chat HITL replies.',
		},
		{
			displayName: 'API Version',
			name: 'apiVersion',
			type: 'string',
			default: 'v22.0',
			description: 'Graph API version used for message requests',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://graph.facebook.com',
			description: 'WhatsApp Graph API base URL',
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
			baseURL: '={{$credentials.baseUrl}}',
			url: '={{"/" + $credentials.apiVersion + "/" + $credentials.phoneNumberId}}',
			method: 'GET',
		},
	};
}
