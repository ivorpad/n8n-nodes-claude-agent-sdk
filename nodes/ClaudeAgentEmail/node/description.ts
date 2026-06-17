import type { INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export const claudeAgentEmailDescription: INodeTypeDescription = {
	displayName: 'Claude Agent Email',
	name: 'claudeAgentEmail',
	icon: 'file:claudeAgentEmail.svg',
	group: ['transform'],
	version: 1,
	subtitle: 'Send Approval / Question and Wait',
	description: 'Send Claude Agent SDK HITL requests through SMTP email and wait for responses',
	defaults: {
		name: 'Claude Agent Email',
	},
	inputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	outputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	credentials: [
		{
			name: 'smtp',
			required: true,
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
			displayName: 'To Email',
			name: 'toEmail',
			type: 'string',
			required: true,
			default: '',
			description: 'Recipient email address',
		},
		{
			displayName: 'From Email',
			name: 'fromEmail',
			type: 'string',
			required: true,
			default: '',
			description: 'Sender email address',
		},
		{
			displayName: 'Subject Prefix',
			name: 'subjectPrefix',
			type: 'string',
			default: 'Claude HITL',
			description: 'Prefix for email subject lines',
		},
		{
			displayName: 'Message Prefix',
			name: 'messagePrefix',
			type: 'string',
			default: '',
			description: 'Optional intro text prepended to outgoing messages',
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
			description: 'Controls primary HITL message text sent to email',
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
			displayName: 'Limit Wait Time',
			name: 'limitWaitTime',
			type: 'boolean',
			default: true,
			description: 'Whether to resume automatically after a timeout',
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
