/**
 * Hook Handlers UI properties
 *
 * Exposes SDK hook events as configurable handlers on the node.
 * Supports webhook (sync/fire-and-forget) and command (local script) modes.
 */

import type { INodeProperties } from 'n8n-workflow';

export const hookHandlersProperties: INodeProperties[] = [
	{
		displayName: 'Enable Hook Handlers',
		name: 'enableHookHandlers',
		type: 'boolean',
		default: false,
		description:
			'Whether to run custom logic on SDK hook events (tool use, errors, notifications) via webhooks or local commands',
	},
	{
		displayName: 'Hook Handlers',
		name: 'hookHandlers',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Hook Handler',
		default: {},
		description: 'Configure handlers that run on SDK hook events',
		displayOptions: {
			show: {
				enableHookHandlers: [true],
			},
		},
		options: [
			{
				displayName: 'Handler',
				name: 'handlers',
				values: [
					{
						displayName: 'Command',
						name: 'command',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'python3 /scripts/check-tool.py',
						description: 'Shell command to run. Hook event JSON is piped to stdin. For sync mode, stdout is parsed as JSON response. Non-zero exit code = block.',
						displayOptions: {
							show: {
								handlerType: ['command'],
							},
						},
					},
					{
						displayName: 'Event',
						name: 'event',
						type: 'options',
						options: [
							{
								name: 'Notification',
								value: 'Notification',
								description: 'Agent notifications — forward to external systems',
							},
							{
								name: 'PermissionDenied',
								value: 'PermissionDenied',
								description: 'When a tool permission is denied — use for audit or retry logic. Caution: returning retry with HITL temporary denies can cause loops.',
							},
							{
								name: 'PostToolUse',
								value: 'PostToolUse',
								description: 'After a tool runs — use for audit logging or notifications',
							},
							{
								name: 'PostToolUseFailure',
								value: 'PostToolUseFailure',
								description: 'When a tool fails — visibility into denied tools and errors',
							},
							{
								name: 'PreToolUse',
								value: 'PreToolUse',
								description: 'Before a tool runs — use for custom approval or interception',
							},
							{
								name: 'SessionStart',
								value: 'SessionStart',
								description: 'When the agent session starts',
							},
							{
								name: 'Stop',
								value: 'Stop',
								description: 'When the agent finishes — external notifications',
							},
						],
						default: 'PostToolUseFailure',
						description: 'Which SDK hook event to listen for',
					},
					{
						displayName: 'Handler Type',
						name: 'handlerType',
						type: 'options',
						options: [
							{
								name: 'Command',
								value: 'command',
								description: 'Run a local shell command (Bash, Python, etc.) with event JSON on stdin',
							},
							{
								name: 'Webhook',
								value: 'webhook',
								description: 'POST event JSON to an HTTP endpoint',
							},
						],
						default: 'webhook',
						description: 'Whether to call a webhook or run a local command',
					},
					{
						displayName: 'Mode',
						name: 'mode',
						type: 'options',
						options: [
							{
								name: 'Fire-and-Forget',
								value: 'fireAndForget',
								description: 'Run handler and continue immediately — use for logging and notifications',
							},
							{
								name: 'Sync',
								value: 'sync',
								description: 'Wait for handler response — use for approvals that return { continue: true/false }',
							},
						],
						default: 'fireAndForget',
						description: 'Whether to wait for the handler response before continuing',
					},
					{
						displayName: 'On Failure',
						name: 'failBehaviour',
						type: 'options',
						options: [
							{
								name: 'Block (Fail-Closed)',
								value: 'block',
								description: 'If handler times out or errors, block the tool',
							},
							{
								name: 'Continue (Fail-Open)',
								value: 'continue',
								description: 'If handler times out or errors, allow the tool to proceed',
							},
						],
						default: 'continue',
						description: 'What to do when the handler is unreachable or returns an error (sync mode only)',
						displayOptions: {
							show: {
								mode: ['sync'],
							},
						},
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeoutSeconds',
						type: 'number',
						default: 30,
						description: 'Maximum time to wait for the handler response (sync mode only)',
						displayOptions: {
							show: {
								mode: ['sync'],
							},
						},
					},
					{
						displayName: 'Tool Filter',
						name: 'matcher',
						type: 'string',
						default: '',
						placeholder: 'Bash',
						description:
							'Optional tool name pattern (only for PreToolUse, PostToolUse, PostToolUseFailure). Leave empty to match all tools.',
						displayOptions: {
							show: {
								event: ['PermissionDenied', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure'],
							},
						},
					},
					{
						displayName: 'Webhook URL',
						name: 'webhookUrl',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'https://your-n8n.example.com/webhook/hook-handler',
						description: 'URL to POST the hook event payload to',
						displayOptions: {
							show: {
								handlerType: ['webhook'],
							},
						},
					},
				],
			},
		],
	},
];
