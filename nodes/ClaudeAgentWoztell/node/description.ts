import type { INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { sendMessageProperties } from './sendMessageProperties';

export const claudeAgentWoztellDescription: INodeTypeDescription = {
	displayName: 'Claude Agent Woztell',
	name: 'claudeAgentWoztell',
	icon: 'file:woztell.svg',
	group: ['transform'],
	version: 1,
	subtitle: '={{ $parameter["resource"] === "sendMessage" ? "Send Message" : "HITL" }}',
	description:
		'Send messages and HITL requests through Woztell WhatsApp Bot API with interactive buttons',
	defaults: {
		name: 'Claude Agent Woztell',
	},
	inputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	outputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	credentials: [
		{
			name: 'woztellBotApi',
			required: true,
			displayName: 'Woztell Bot API',
		},
		{
			// eslint-disable-next-line n8n-nodes-base/node-class-description-credentials-name-unsuffixed
			name: 'postgres',
			required: false,
			displayOptions: { show: { resource: ['hitl'] } },
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
				'<li>Woztell Webhook Trigger → this node (in-chat replies)</li>' +
				'<li>Claude Agent SDK (HITL) → this node</li>' +
				'<li>This node → Claude Agent SDK (main input)</li>' +
				'<li>Keep SDK interactiveApprovals = pauseForApproval</li>' +
				'<li>Set SDK Pause Execution = OFF (for companion loop)</li>' +
				'<li>URL/form replies use this node\'s built-in webhook</li>' +
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
			default: 'sendMessage',
			noDataExpression: true,
			options: [
				{ name: 'HITL (Approvals & Questions)', value: 'hitl' },
				{ name: 'Send Message', value: 'sendMessage' },
			],
		},
		// ── Shared params ──
		{
			displayName: 'Channel ID',
			name: 'channelId',
			type: 'string',
			required: true,
			default: '',
			description: 'WOZTELL channel ID (from Channels page on the WOZTELL platform)',
		},
		{
			displayName: 'Recipient Phone Number',
			name: 'recipientPhoneNumber',
			type: 'string',
			required: true,
			default: '',
			description: 'Destination WhatsApp phone number including country code (e.g. 34696169382)',
		},
		// ── HITL params ──
		{
			displayName: 'Pending Store Backend',
			name: 'pendingStoreBackend',
			type: 'options',
			default: 'staticData',
			displayOptions: { show: { resource: ['hitl'] } },
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
			displayOptions: { show: { resource: ['hitl'], pendingStoreBackend: ['postgres'] } },
			description: 'Postgres table used to persist pending HITL metadata (created automatically if missing)',
		},
		{
			displayName: 'Delivery Mode',
			name: 'deliveryMode',
			type: 'options',
			default: 'interactiveReplyButtons',
			displayOptions: { show: { resource: ['hitl'] } },
			options: [
				{
					name: 'In-Chat Reply Buttons (Recommended)',
					value: 'interactiveReplyButtons',
					description:
						'Sends WhatsApp interactive reply buttons/lists via Woztell so users answer in chat',
				},
				{
					name: 'Text Links',
					value: 'textLinks',
					description: 'Sends plain text with signed approve/deny/respond URLs',
				},
				{
					name: 'Template Buttons',
					value: 'templateButtons',
					description: 'Sends a WhatsApp template payload with body parameters via Woztell',
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
			displayOptions: { show: { resource: ['hitl'] } },
			description: 'Optional intro text prepended to outgoing messages',
		},
		{
			displayName: 'Message Title',
			name: 'messageTitle',
			type: 'string',
			default: 'Claude HITL',
			displayOptions: { show: { resource: ['hitl'] } },
			description: 'Optional title line shown before HITL message details',
		},
		{
			displayName: 'Outbound Message Mode',
			name: 'outboundMessageMode',
			type: 'options',
			default: 'asIs',
			displayOptions: { show: { resource: ['hitl'] } },
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
			description: 'Controls primary HITL message text sent via Woztell',
		},
		{
			displayName: 'Max Outbound Characters',
			name: 'maxOutboundCharacters',
			type: 'number',
			typeOptions: { minValue: 1, numberPrecision: 0 },
			default: 240,
			displayOptions: { show: { resource: ['hitl'], outboundMessageMode: ['trim'] } },
			description: 'Maximum characters to keep when Outbound Message Mode is Trim',
		},
		{
			displayName: 'Fallback Message',
			name: 'fallbackMessage',
			type: 'string',
			default: '',
			displayOptions: { show: { resource: ['hitl'], outboundMessageMode: ['trim', 'none'] } },
			description:
				'Used when Outbound Message Mode is Fallback Only or when a trimmed message becomes empty',
		},
		{
			displayName: 'Template Name',
			name: 'templateName',
			type: 'string',
			default: '',
			required: true,
			displayOptions: { show: { resource: ['hitl'], deliveryMode: ['templateButtons'] } },
			description:
				'Pre-approved WhatsApp template name. Body parameters are populated as: message + URLs.',
		},
		{
			displayName: 'Template Language Code',
			name: 'templateLanguageCode',
			type: 'string',
			default: 'en_US',
			displayOptions: { show: { resource: ['hitl'], deliveryMode: ['templateButtons'] } },
			description: 'Template language code, for example en_US or es',
		},
		{
			displayName: 'Send Companion Message',
			name: 'enableCompanionMessage',
			type: 'boolean',
			default: false,
			displayOptions: { show: { resource: ['hitl'] } },
			description:
				'Whether to send an additional Woztell message payload before the HITL resume message',
		},
		{
			displayName: 'Companion Message Type',
			name: 'companionMessageType',
			type: 'options',
			default: 'text',
			displayOptions: { show: { resource: ['hitl'], enableCompanionMessage: [true] } },
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
			description:
				'Companion mode using Woztell Bot API message types. Keep HITL resume transport in Delivery Mode.',
		},
		{
			displayName: 'Companion Payload (JSON)',
			name: 'companionPayload',
			type: 'json',
			default: '{}',
			displayOptions: { show: { resource: ['hitl'], enableCompanionMessage: [true] } },
			// eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-url
			description:
				'Payload fields for the selected companion type. Image example: {"url":"https://…","text":"caption"}. Template example: {"elementName":"…","languageCode":"en","components":[…]}.',
		},
		{
			displayName: 'On Companion Send Failure',
			name: 'companionFailureBehavior',
			type: 'options',
			default: 'continue',
			displayOptions: { show: { resource: ['hitl'], enableCompanionMessage: [true] } },
			options: [
				{ name: 'Continue with HITL Message', value: 'continue' },
				{ name: 'Fail Node', value: 'fail' },
			],
			description: 'Whether a companion send failure should abort execution',
		},
		{
			displayName: 'How Claude Continues After This Message',
			name: 'replyHandlingMode',
			type: 'options',
			default: 'dispatchAndExit',
			displayOptions: { show: { resource: ['hitl'] } },
			options: [
				{
					name: 'Durable Pause and Exit (Recommended)',
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
			displayOptions: { show: { resource: ['hitl'], replyHandlingMode: ['waitForReply'] } },
			description: 'Whether to auto-resume if no reply arrives while this execution is waiting',
		},
		{
			displayName: 'Amount',
			name: 'resumeAmount',
			type: 'number',
			typeOptions: { minValue: 1, numberPrecision: 0 },
			default: 45,
			displayOptions: { show: { resource: ['hitl'], replyHandlingMode: ['waitForReply'], limitWaitTime: [true] } },
			description: 'How long to wait before auto-resume',
		},
		{
			displayName: 'Unit',
			name: 'resumeUnit',
			type: 'options',
			default: 'minutes',
			displayOptions: { show: { resource: ['hitl'], replyHandlingMode: ['waitForReply'], limitWaitTime: [true] } },
			options: [
				{ name: 'Minutes', value: 'minutes' },
				{ name: 'Hours', value: 'hours' },
				{ name: 'Days', value: 'days' },
			],
			description: 'Unit used for wait timeout',
		},
		// ── Send Message resource ──
		...sendMessageProperties,
	],
};
