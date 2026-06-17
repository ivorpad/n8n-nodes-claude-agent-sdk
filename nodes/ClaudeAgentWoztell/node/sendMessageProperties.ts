import type { INodeProperties } from 'n8n-workflow';

export const sendMessageProperties: INodeProperties[] = [
	{
		displayName: 'Message Type',
		name: 'sendMessageType',
		type: 'options',
		default: 'text',
		displayOptions: {
			show: {
				resource: ['sendMessage'],
			},
		},
		options: [
			{ name: 'Audio', value: 'audio' },
			{ name: 'Contacts', value: 'contacts' },
			{ name: 'File', value: 'file' },
			{ name: 'Image', value: 'image' },
			{ name: 'Interactive: List', value: 'interactiveList' },
			{ name: 'Interactive: Reply Buttons', value: 'interactiveReplyButtons' },
			{ name: 'Location', value: 'location' },
			{ name: 'Location Request', value: 'locationRequest' },
			{ name: 'Reaction', value: 'reaction' },
			{ name: 'Sticker', value: 'sticker' },
			{ name: 'Template', value: 'template' },
			{ name: 'Text', value: 'text' },
			{ name: 'Video', value: 'video' },
		],
		description: 'Woztell Bot API message type to send',
	},
	{
		displayName: 'Text',
		name: 'sendMessageText',
		type: 'string',
		typeOptions: {
			rows: 5,
		},
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['sendMessage'],
				sendMessageType: ['text'],
			},
		},
		description: 'Message body text. Messages longer than 4096 characters are automatically split into multiple messages.',
	},
	{
		displayName: 'Payload (JSON)',
		name: 'sendMessagePayload',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				resource: ['sendMessage'],
			},
			hide: {
				sendMessageType: ['text'],
			},
		},
		// eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-url
		description: 'JSON payload for the selected message type (e.g. {"url":"https://…"} for image)',
	},
	{
		displayName: 'Preview URL',
		name: 'sendPreviewUrl',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['sendMessage'],
				sendMessageType: ['text'],
			},
		},
		description: 'Whether to enable link previews in text messages',
	},
];
