import type { INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export const claudeAgentSlackDescription: INodeTypeDescription = {
	displayName: 'Claude Agent Slack',
	name: 'claudeAgentSlack',
	icon: 'file:claudeAgentSlack.svg',
	group: ['transform'],
	version: 1,
	subtitle: 'Send Approval / Question and Wait',
	description: 'Send Claude Agent SDK HITL requests through Slack and wait for responses',
	defaults: {
		name: 'Claude Agent Slack',
	},
	inputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	outputs: [{ displayName: '', type: NodeConnectionTypes.Main }],
	credentials: [
		{
			name: 'slackApi',
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
			displayName: 'Slack Channel ID',
			name: 'channelId',
			type: 'string',
			required: true,
			default: '',
			description: 'Destination channel ID (for example C12345678)',
		},
		{
			displayName: 'Slack Signing Secret',
			name: 'slackSigningSecret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
			description:
				'Slack app signing secret used to verify inbound interaction callbacks before HITL replies are accepted',
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
			description: 'Controls primary HITL message text sent to Slack',
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
