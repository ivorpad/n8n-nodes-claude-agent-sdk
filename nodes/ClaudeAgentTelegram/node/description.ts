import type { INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export const claudeAgentTelegramDescription: INodeTypeDescription = {
	displayName: 'Claude Agent Telegram',
	name: 'claudeAgentTelegram',
	icon: 'file:claudeAgentTelegram.svg',
	group: ['transform'],
	version: 1,
	subtitle: 'Send Approval / Question',
	description:
		'Send Claude Agent SDK HITL requests through Telegram (wait-in-place or durable dispatch/exit)',
	defaults: {
		name: 'Claude Agent Telegram',
	},
	inputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	outputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	credentials: [
		{
			name: 'telegramApi',
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
				'<li>this node → Claude Agent SDK (main input)</li>' +
				'<li>SDK: interactiveApprovals = pauseForApproval</li>' +
				'<li>SDK: Pause Execution in SDK = OFF (for multi-hop)</li>' +
				'</ul>',
			name: 'wiringNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Pending Store Backend',
			name: 'pendingStoreBackend',
			type: 'options',
			default: 'staticData',
			options: [
				{
					name: 'Workflow Static Data',
					value: 'staticData',
					description: 'Stores pending HITL records in n8n workflow static data',
				},
				{
					name: 'Postgres (Durable)',
					value: 'postgres',
					description:
						'Stores pending HITL records in Postgres for restart-safe Telegram reply resume',
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
					pendingStoreBackend: ['postgres'],
				},
			},
			description:
				'Postgres table used to persist pending HITL metadata (created automatically if missing)',
		},
		{
			displayName: 'Telegram Chat ID',
			name: 'chatId',
			type: 'string',
			required: true,
			default: '',
			description: 'Destination Telegram chat ID (for example 123456789)',
		},
		{
			displayName: 'Webhook Secret Token',
			name: 'telegramWebhookSecretToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
			description:
				'Secret token expected in X-Telegram-Bot-Api-Secret-Token for inbound callback queries',
		},
		{
			displayName: 'Message Prefix',
			name: 'messagePrefix',
			type: 'string',
			default: '',
			description: 'Optional intro text prepended to outgoing messages',
		},
		{
			displayName: 'Message Title',
			name: 'messageTitle',
			type: 'string',
			default: 'Claude HITL',
			description: 'Optional title line shown before HITL message details',
		},
		{
			displayName: 'Outbound Message Mode',
			name: 'outboundMessageMode',
			type: 'options',
			default: 'asIs',
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
			description: 'Controls primary HITL message text sent to Telegram',
		},
		{
			displayName: 'Max Outbound Characters',
			name: 'maxOutboundCharacters',
			type: 'number',
			typeOptions: {
				minValue: 1,
				numberPrecision: 0,
			},
			default: 400,
			displayOptions: {
				show: {
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
					outboundMessageMode: ['trim', 'none'],
				},
			},
			description:
				'Used when Outbound Message Mode is Fallback Only or when a trimmed message becomes empty',
		},
		{
			displayName: 'How Claude Continues After This Message',
			name: 'replyHandlingMode',
			type: 'options',
			default: 'dispatchAndExit',
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
	],
};
