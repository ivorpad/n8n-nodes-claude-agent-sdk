import type { INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export const woztellSendDescription: INodeTypeDescription = {
	displayName: 'Woztell Send',
	name: 'woztellSend',
	icon: 'file:woztell.svg',
	group: ['output'],
	version: 1,
	subtitle: '={{ {"sendText":"Send Text","sendTemplate":"Send Template","sendList":"Send List"}[$parameter["operation"]] || "Send Text" }}',
	description: 'Send messages through Woztell WhatsApp Bot API',
	defaults: {
		name: 'Woztell Send',
	},
	inputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	outputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	credentials: [
		{
			name: 'woztellBotApi',
			required: true,
		},
	],
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			default: 'sendText',
			options: [
				{
					name: 'Send Text',
					value: 'sendText',
					description: 'Send a plain text message via Woztell Bot API',
					action: 'Send a text message',
				},
				{
					name: 'Send Template',
					value: 'sendTemplate',
					description: 'Send a pre-approved WhatsApp template message',
					action: 'Send a template message',
				},
				{
					name: 'Send List',
					value: 'sendList',
					description: 'Send an interactive WhatsApp list message with sections and rows',
					action: 'Send a list message',
				},
			],
		},
		{
			displayName: 'Channel ID',
			name: 'channelId',
			type: 'string',
			required: true,
			default: '',
			description: 'WOZTELL channel ID (from Channels page on the WOZTELL platform)',
		},
		{
			displayName: 'Recipient ID',
			name: 'recipientId',
			type: 'string',
			required: true,
			default: '',
			description:
				'WhatsApp phone number of the recipient including country code (e.g. 34696169382). Dashes, parentheses, plus signs and spaces are stripped automatically.',
		},
		{
			displayName: 'Message',
			name: 'message',
			type: 'string',
			typeOptions: {
				rows: 4,
			},
			required: true,
			default: '',
			displayOptions: {
				show: {
					operation: ['sendText'],
				},
			},
			description: 'Text message to send',
		},
		{
			displayName: 'Template',
			name: 'templateId',
			type: 'options',
			default: '',
			required: true,
			typeOptions: {
				loadOptionsMethod: 'getTemplates',
			},
			displayOptions: {
				show: {
					operation: ['sendTemplate'],
				},
			},
			description: 'Select an approved WhatsApp message template',
		},
		{
			displayName: 'Template Body Parameters',
			name: 'templateBodyParameters',
			type: 'string',
			typeOptions: {
				rows: 2,
			},
			default: '',
			displayOptions: {
				show: {
					operation: ['sendTemplate'],
				},
			},
			description:
				'Comma-separated values for template body parameters (e.g. "John,Order #123"). Leave empty if the template has no body parameters.',
		},
		// ── Send List fields ────────────────────────────────────────────────
		{
			displayName: 'Preceding Text Message',
			name: 'listPrecedingText',
			type: 'string',
			typeOptions: {
				rows: 5,
			},
			default: '',
			displayOptions: {
				show: {
					operation: ['sendList'],
				},
			},
			description:
				'Optional formatted text message sent before the list. Use this for long descriptions that don\'t fit in 72-char row descriptions. Supports WhatsApp formatting (*bold*, _italic_, ~strike~, ```mono```).',
		},
		{
			displayName: 'Header',
			name: 'listHeader',
			type: 'string',
			default: '',
			displayOptions: {
				show: {
					operation: ['sendList'],
				},
			},
			description: 'Optional header text shown above the list (max 60 chars)',
		},
		{
			displayName: 'Body',
			name: 'listBody',
			type: 'string',
			typeOptions: {
				rows: 3,
			},
			required: true,
			default: '',
			displayOptions: {
				show: {
					operation: ['sendList'],
				},
			},
			description: 'Body text shown in the message (max 4096 chars)',
		},
		{
			displayName: 'Button Text',
			name: 'listButtonText',
			type: 'string',
			required: true,
			default: 'View options',
			displayOptions: {
				show: {
					operation: ['sendList'],
				},
			},
			description: 'Text on the button that opens the list (max 20 chars)',
		},
		{
			displayName: 'Sections JSON',
			name: 'listSections',
			type: 'json',
			required: true,
			default: '[\n  {\n    "title": "Section 1",\n    "rows": [\n      { "payload": "row_1", "title": "Option 1", "description": "Description" }\n    ]\n  }\n]',
			displayOptions: {
				show: {
					operation: ['sendList'],
				},
			},
			description:
				'JSON array of sections. Each section has "title" and "rows". Each row has "payload" (ID string), "title" (max 24 chars), and optional "description" (max 72 chars). Max 10 sections, max 10 rows total. Use expressions for dynamic data.',
		},
		{
			displayName: 'Footer',
			name: 'listFooter',
			type: 'string',
			default: '',
			displayOptions: {
				show: {
					operation: ['sendList'],
				},
			},
			description: 'Optional footer text shown below the list',
		},
	],
};
