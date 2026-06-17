import type { INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export const claudeAgentWhatsAppDescription: INodeTypeDescription = {
	displayName: 'Claude Agent WhatsApp',
	name: 'claudeAgentWhatsApp',
	icon: 'file:claudeAgentWhatsApp.svg',
	group: ['transform'],
	version: 1,
	subtitle: '={{ $parameter["resource"] === "sendMessage" ? "Send Message" : "HITL" }}',
	description:
		'Send messages and HITL requests through WhatsApp Cloud API with auto-chunking for long text',
	defaults: {
		name: 'Claude Agent WhatsApp',
	},
	inputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	outputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	credentials: [
		{
			name: 'whatsAppBusinessCloudApi',
			required: true,
		},
		{
			name: 'postgres',
			required: false,
		},
	],
	webhooks: [
		{
			name: 'default',
			httpMethod: 'GET',
			responseMode: 'onReceived',
			path: '={{ $nodeId }}',
			restartWebhook: true,
			isFullPath: true,
		},
		{
			name: 'default',
			httpMethod: 'POST',
			responseMode: 'onReceived',
			path: '={{ $nodeId }}',
			restartWebhook: true,
			isFullPath: true,
		},
	],
	properties: [
		{
				displayName:
					'Wiring guide:' +
					'<ul>' +
					'<li>Claude Agent SDK (HITL) → this node</li>' +
					'<li>This node → Claude Agent SDK (main input)</li>' +
					'<li>Keep SDK interactiveApprovals = pauseForApproval</li>' +
					'<li>Set SDK Pause Execution in SDK = OFF (for companion loop)</li>' +
					'</ul>',
				name: 'wiringNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						resource: ['hitl'],
					},
				},
			},
		{
			displayName: 'Resource',
			name: 'resource',
			type: 'options',
			default: 'hitl',
			noDataExpression: true,
			options: [
				{ name: 'HITL (Approvals & Questions)', value: 'hitl' },
				{ name: 'Send Message', value: 'sendMessage' },
			],
		},
		{
			displayName: 'Pending Store Backend',
			name: 'pendingStoreBackend',
			type: 'options',
			default: 'staticData',
			displayOptions: {
				show: {
					resource: ['hitl'],
				},
			},
			options: [
				{
					name: 'Workflow Static Data',
					value: 'staticData',
					description: 'Stores pending HITL records in n8n workflow static data',
				},
				{
					name: 'Postgres (Durable)',
					value: 'postgres',
					description: 'Stores pending HITL records in Postgres for restart-safe channel reply resume',
				},
			],
		},
		{
			displayName: 'Pending Store Table',
			name: 'pendingStoreTableName',
			type: 'string',
			default: 'claude_hitl_pending',
			displayOptions: {
				show: {
					resource: ['hitl'],
					pendingStoreBackend: ['postgres'],
				},
			},
			description: 'Postgres table used to persist pending HITL metadata (created automatically if missing)',
		},
		{
			displayName: 'Recipient Phone Number',
			name: 'recipientPhoneNumber',
			type: 'string',
			required: true,
			default: '',
			description: 'Destination WhatsApp phone number (E.164 format recommended)',
		},
		{
			displayName: 'Delivery Mode',
			name: 'deliveryMode',
			type: 'options',
			default: 'interactiveReplyButtons',
			displayOptions: {
				show: {
					resource: ['hitl'],
				},
			},
			options: [
				{
					name: 'In-Chat Reply Buttons (Recommended)',
					value: 'interactiveReplyButtons',
					description:
						'Sends WhatsApp interactive reply buttons/lists so users answer in chat without opening browser URLs',
				},
				{
					name: 'Text Links',
					value: 'textLinks',
					description: 'Sends plain text with signed approve/deny/respond URLs',
				},
				{
					name: 'Template Buttons',
					value: 'templateButtons',
					description: 'Sends a WhatsApp template payload with body parameters',
				},
				{
					name: 'Interactive CTA Buttons',
					value: 'interactiveCtaButtons',
					description: 'Sends interactive button message(s) that open signed resume URLs',
				},
			],
			description:
				'Choose whether responses happen in-chat (reply buttons) or by opening signed URLs',
		},
		{
			displayName: 'Message Prefix',
			name: 'messagePrefix',
			type: 'string',
			default: '',
			displayOptions: {
				show: {
					resource: ['hitl'],
				},
			},
			description: 'Optional intro text prepended to outgoing messages',
		},
		{
			displayName: 'Message Title',
			name: 'messageTitle',
			type: 'string',
			default: 'Claude HITL',
			displayOptions: {
				show: {
					resource: ['hitl'],
				},
			},
			description: 'Optional title line shown before HITL message details',
		},
		{
			displayName: 'Outbound Message Mode',
			name: 'outboundMessageMode',
			type: 'options',
			default: 'asIs',
			displayOptions: {
				show: {
					resource: ['hitl'],
				},
			},
			options: [
				{
					name: 'As Is',
					value: 'asIs',
					description: 'Send generated HITL message text unchanged',
				},
				{
					name: 'Trim',
					value: 'trim',
					description: 'Trim generated HITL message text to a maximum length',
				},
				{
					name: 'Fallback Only',
					value: 'none',
					description: 'Do not send generated message text; send fallback message instead',
				},
			],
			description:
				'Controls primary HITL message text sent to WhatsApp. Companion message settings are unaffected.',
		},
		{
			displayName: 'Max Outbound Characters',
			name: 'maxOutboundCharacters',
			type: 'number',
			typeOptions: {
				minValue: 1,
				numberPrecision: 0,
			},
			default: 240,
			displayOptions: {
				show: {
					resource: ['hitl'],
					outboundMessageMode: ['trim'],
				},
			},
			description: 'Maximum characters to keep when Outbound Message Mode is Trim',
		},
		{
			displayName: 'Fallback Message',
			name: 'fallbackMessage',
			type: 'string',
			default: '',
			displayOptions: {
				show: {
					resource: ['hitl'],
					outboundMessageMode: ['trim', 'none'],
				},
			},
			description:
				'Used when Outbound Message Mode is Fallback Only or when a trimmed message becomes empty',
		},
		{
			displayName: 'Template Name',
			name: 'templateName',
			type: 'string',
			default: '',
			required: true,
			displayOptions: {
				show: {
					resource: ['hitl'],
					deliveryMode: ['templateButtons'],
				},
			},
			description:
				'Pre-approved WhatsApp template name. Body parameters are populated as: message + URLs',
		},
		{
			displayName: 'Template Language Code',
			name: 'templateLanguageCode',
			type: 'string',
			default: 'en_US',
			displayOptions: {
				show: {
					resource: ['hitl'],
					deliveryMode: ['templateButtons'],
				},
			},
			description: 'Template language code, for example en_US or es',
		},
		{
			displayName: 'Send Companion Message',
			name: 'enableCompanionMessage',
			type: 'boolean',
			default: false,
			displayOptions: {
				show: {
					resource: ['hitl'],
				},
			},
			description:
				'Optionally send an additional WhatsApp message payload before the HITL resume message',
		},
		{
			displayName: 'Companion Message Type',
			name: 'companionMessageType',
			type: 'options',
			default: 'text',
			displayOptions: {
				show: {
					resource: ['hitl'],
					enableCompanionMessage: [true],
				},
			},
			options: [
				{ name: 'Text', value: 'text' },
				{ name: 'Template', value: 'template' },
				{ name: 'Image', value: 'image' },
				{ name: 'Video', value: 'video' },
				{ name: 'Audio', value: 'audio' },
				{ name: 'Document', value: 'document' },
				{ name: 'Sticker', value: 'sticker' },
				{ name: 'Location', value: 'location' },
				{ name: 'Contacts', value: 'contacts' },
				{ name: 'Reaction', value: 'reaction' },
				{ name: 'Interactive: Buttons', value: 'interactiveButton' },
				{ name: 'Interactive: List', value: 'interactiveList' },
				{ name: 'Interactive: CTA URL', value: 'interactiveCtaUrl' },
				{ name: 'Interactive: Location Request', value: 'interactiveLocationRequest' },
				{ name: 'Interactive: Flow', value: 'interactiveFlow' },
				{ name: 'Interactive: Address', value: 'interactiveAddress' },
			],
			description:
				'Companion mode using WhatsApp Cloud API message types. Keep HITL resume transport in Delivery Mode.',
		},
		{
			displayName: 'Companion Payload (JSON)',
			name: 'companionPayload',
			type: 'json',
			default: '{}',
			displayOptions: {
				show: {
					resource: ['hitl'],
					enableCompanionMessage: [true],
				},
			},
			description:
				'Payload fields for selected companion type. Example for text: {"text":{"preview_url":true,"body":"Hello"}}. For interactive types provide "interactive".',
		},
		{
			displayName: 'On Companion Send Failure',
			name: 'companionFailureBehavior',
			type: 'options',
			default: 'continue',
			displayOptions: {
				show: {
					resource: ['hitl'],
					enableCompanionMessage: [true],
				},
			},
			options: [
				{ name: 'Continue with HITL message', value: 'continue' },
				{ name: 'Fail node', value: 'fail' },
			],
			description: 'Whether a companion send failure should abort execution',
		},
		{
			displayName: 'How Claude Continues After This Message',
			name: 'replyHandlingMode',
			type: 'options',
			default: 'dispatchAndExit',
			displayOptions: {
				show: {
					resource: ['hitl'],
				},
			},
			options: [
				{
					name: 'Durable Pause and Exit (Recommended for WhatsApp/Telegram)',
					value: 'dispatchAndExit',
					description:
						'Saves Claude request/session metadata, sends the message, exits immediately, and resumes later from a new inbound reply execution',
				},
				{
					name: 'Keep This Workflow Waiting (For Web UI Streaming)',
					value: 'waitForReply',
					description:
						'Uses n8n putExecutionToWait() so the same execution resumes in-place when the user replies',
				},
			],
			description:
				'Controls whether this node waits in memory or uses durable Claude HITL request/response envelopes across separate executions',
		},
		{
			displayName: 'Limit Wait Time',
			name: 'limitWaitTime',
			type: 'boolean',
			default: true,
			displayOptions: {
				show: {
					resource: ['hitl'],
					replyHandlingMode: ['waitForReply'],
				},
			},
			description: 'Whether to auto-resume if no reply arrives while this execution is waiting',
		},
		{
			displayName: 'Amount',
			name: 'resumeAmount',
			type: 'number',
			typeOptions: {
				minValue: 1,
				numberPrecision: 0,
			},
			default: 45,
			displayOptions: {
				show: {
					resource: ['hitl'],
					replyHandlingMode: ['waitForReply'],
					limitWaitTime: [true],
				},
			},
			description: 'How long to wait before auto-resume',
		},
		{
			displayName: 'Unit',
			name: 'resumeUnit',
			type: 'options',
			default: 'minutes',
			displayOptions: {
				show: {
					resource: ['hitl'],
					replyHandlingMode: ['waitForReply'],
					limitWaitTime: [true],
				},
			},
			options: [
				{ name: 'Minutes', value: 'minutes' },
				{ name: 'Hours', value: 'hours' },
				{ name: 'Days', value: 'days' },
			],
			description: 'Unit used for wait timeout',
		},
		// ── Send Message resource ──
		{
			displayName: 'Sender Phone Number ID',
			name: 'senderPhoneNumberId',
			type: 'string',
			default: '',
			displayOptions: {
				show: {
					resource: ['sendMessage'],
				},
			},
			description: 'WhatsApp Business phone number ID used to send. Leave empty to use the ID from the credential.',
		},
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
				{ name: 'Text', value: 'text' },
				{ name: 'Image', value: 'image' },
				{ name: 'Video', value: 'video' },
				{ name: 'Audio', value: 'audio' },
				{ name: 'Document', value: 'document' },
				{ name: 'Template', value: 'template' },
				{ name: 'Sticker', value: 'sticker' },
				{ name: 'Location', value: 'location' },
				{ name: 'Contacts', value: 'contacts' },
				{ name: 'Reaction', value: 'reaction' },
				{ name: 'Interactive: Buttons', value: 'interactiveButton' },
				{ name: 'Interactive: List', value: 'interactiveList' },
				{ name: 'Interactive: CTA URL', value: 'interactiveCtaUrl' },
			],
			description: 'WhatsApp Cloud API message type to send',
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
			description: 'Message body text. Messages longer than 4096 characters are automatically split into multiple WhatsApp messages.',
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
			description: 'JSON payload for the selected message type (e.g. {"image":{"link":"https://..."}} for image)',
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
	],
};
