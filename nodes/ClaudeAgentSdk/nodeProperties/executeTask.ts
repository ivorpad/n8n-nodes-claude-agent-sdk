/**
 * Execute Agent Task operation properties (core fields)
 *
 * The upstream unstable V2 SDK session API was removed in 0.3.142. Local
 * execution uses query() with options.resume for deterministic sessions.
 */

import type { INodeProperties } from 'n8n-workflow';
import { operationProperty } from './operation';
import { LITELLM_AUTHENTICATION_VALUES, liteLlmModelProperties } from './liteLlmModels';
import { CODEMIE_AUTHENTICATION_VALUES, codeMieModelProperties } from './codeMieModels';
import { TOOL_OPTIONS } from '../toolOptions';
import {
	CURRENT_CLAUDE_MODEL_OPTIONS,
	ADAPTIVE_THINKING_MODELS,
	OPUS_FAST_MODE_MODELS,
} from '../claudeModels';

const executeOrScriptOperation = ['executeTask', 'generatePythonSdk'];

// Core task configuration fields (top of node)
export const executeTaskCoreProperties: INodeProperties[] = [
	{
		displayName: 'Task Description',
		name: 'taskDescription',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		default: '',
		required: true,
		description: 'Describe the autonomous task you want Claude Code to execute',
		placeholder: 'Refactor the authentication module to use JWT tokens',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
			},
		},
	},
	// Operation selector — directly below Task Description
	operationProperty,
	{
		displayName: 'Execution Backend',
		name: 'backendMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Local CLI',
				value: 'localCli',
				description: 'Run Claude Code locally in the n8n environment',
			},
			{
				name: 'Managed Agent (Cloud)',
				value: 'managedAgent',
				description: 'Run on Anthropic\'s hosted infrastructure — no local CLI needed',
			},
		],
		default: 'localCli',
		description: 'Choose where the Claude agent executes',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
			},
		},
	},
	{
		displayName: 'Working Directory',
		name: 'workingDirectory',
		type: 'string',
		default: '',
		description: 'Directory where Claude Code runs (defaults to current directory)',
		placeholder: '/path/to/project',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
			},
			hide: {
				'/companionAgent.useCompanionAgent': [true],
			},
		},
	},
	{
		displayName: 'Chat Session ID',
		name: 'chatSessionId',
		type: 'string',
		default: '',
		description:
			'Stable conversation identifier (for example phone number or chat ID). In deterministic mode this is the canonical Claude session ID used for both new runs and resume.',
		placeholder: '{{ $json.sessionId }}',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
			},
		},
	},
	{
		displayName: 'Model',
		name: 'model',
		type: 'options',
		options: CURRENT_CLAUDE_MODEL_OPTIONS,
		default: '',
		description:
			'Claude model to use. Explicit IDs pin Anthropic\'s current lineup; Default uses the provider default. Non-Anthropic providers map models via their per-tier overrides in Additional Options.',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
			},
			hide: {
				authentication: [...LITELLM_AUTHENTICATION_VALUES, ...CODEMIE_AUTHENTICATION_VALUES],
			},
		},
	},
	...liteLlmModelProperties,
	...codeMieModelProperties,
	{
		displayName: 'Thinking Mode',
		name: 'thinkingMode',
		type: 'options',
		options: [
			{ name: 'Adaptive', value: 'adaptive', description: 'Claude decides when and how much to think (recommended)' },
			{ name: 'Default (No Override)', value: 'default' },
			{ name: 'Disabled', value: 'disabled', description: 'No extended thinking (on Fable 5 the thinking field is omitted — explicit disable is rejected)' },
			{ name: 'Enabled (Budget)', value: 'enabled', description: 'Fixed thinking token budget (removed on Sonnet 5 / Fable 5 / Opus 4.7+; prefer Effort)' },
		],
		default: 'default',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
				model: Array.from(ADAPTIVE_THINKING_MODELS),
			},
		},
		description: 'Controls Claude thinking behavior. Adaptive is the primary path for Sonnet 5, Fable 5, and Opus 4.7+.',
	},
	{
		displayName: 'Thinking Budget Tokens',
		name: 'thinkingBudgetTokens',
		type: 'number',
		default: 10000,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
				model: Array.from(ADAPTIVE_THINKING_MODELS),
				thinkingMode: ['enabled'],
			},
		},
		description: 'Token budget when Thinking Mode is "Enabled (Budget)"',
	},
	{
		displayName: 'Effort',
		name: 'effort',
		type: 'options',
		options: [
			{ name: 'Default (No Override)', value: '' },
			{ name: 'High', value: 'high', description: 'Deep reasoning (SDK default)' },
			{ name: 'Low', value: 'low', description: 'Minimal thinking, fastest responses' },
			{ name: 'Max', value: 'max', description: 'Maximum effort (Fable 5 / Opus 4.6+ / select Sonnet models)' },
			{ name: 'Medium', value: 'medium', description: 'Moderate thinking' },
			{ name: 'X High', value: 'xhigh', description: 'Deeper than high (Sonnet 5 / Fable 5 / Opus 4.7+)' },
		],
		default: '',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
				model: Array.from(ADAPTIVE_THINKING_MODELS),
			},
		},
		description: 'Controls reasoning effort. Works with adaptive thinking on Sonnet 5, Fable 5, and Opus 4.7+.',
	},
	{
		displayName: 'Fast Mode (Research Preview)',
		name: 'fastMode',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
				model: Array.from(OPUS_FAST_MODE_MODELS),
			},
		},
		description: 'Whether to request speed="fast" for supported Opus models on the Claude API research preview',
	},
	{
		displayName: 'Permission Mode',
		name: 'permissionMode',
		type: 'options',
		options: [
			{ name: 'Accept Edits', value: 'acceptEdits', description: 'Automatically accept file edits' },
			{ name: 'Bypass Permissions', value: 'bypassPermissions', description: 'Bypass all permission checks (use with caution)' },
			{ name: 'Default', value: 'default', description: 'Standard permission behavior (prompts for confirmations)' },
			{ name: 'Don\'t Ask', value: 'dontAsk', description: 'No prompts; skip Claude Code permission confirmations' },
			{ name: 'Plan', value: 'plan', description: 'Planning mode - no actual execution' },
		],
		default: 'default',
		description: 'How Claude Code handles native permission prompts. AGT governance enforces via PreToolUse hooks regardless of this setting.',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
			},
		},
	},
	{
		displayName: 'Allowed Tool Names or IDs',
		name: 'allowedTools',
		type: 'multiOptions',
		options: TOOL_OPTIONS,
		typeOptions: {
			loadOptionsMethod: 'listToolOptions',
		},
		default: [],
		description: 'Tools to auto-approve. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
			},
		},
	},
	{
		displayName: 'Disallowed Tool Names or IDs',
		name: 'disallowedTools',
		type: 'multiOptions',
		options: TOOL_OPTIONS,
		typeOptions: {
			loadOptionsMethod: 'listToolOptions',
		},
		default: [],
		description: 'Tools that Claude Code is not allowed to use (overrides Allowed Tools). Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
			},
		},
	},
	{
		displayName: 'Available Skill Names or IDs',
		name: 'availableSkills',
		type: 'multiOptions',
		typeOptions: {
			loadOptionsMethod: 'discoverSkills',
		},
		default: [],
		description: 'Skills discovered in the working directory and user home. Informational only; SDK discovery is runtime-driven. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				operation: executeOrScriptOperation,
				backendMode: ['localCli'],
				allowedTools: ['Skill'],
			},
		},
		noDataExpression: true,
	},
];

// Execution settings (bottom of node with Additional Options and Security)
export const executionSettingsProperty: INodeProperties = {
	displayName: 'Execution Settings',
	name: 'executionSettings',
	type: 'collection',
	placeholder: 'Add Execution Setting',
	default: {},
	displayOptions: {
		show: {
			operation: executeOrScriptOperation,
		},
	},
	options: [
		{
			displayName: 'Additional Directories',
			name: 'additionalDirectories',
			type: 'string',
			default: '',
			placeholder: '/Users/me/Downloads, /tmp',
			description: 'Comma-separated paths the agent can access beyond the working directory (applies to all tools including Bash)',
			displayOptions: {
				show: {
					'/backendMode': ['localCli'],
				},
			},
		},
		{
			displayName: 'Fork Session',
			name: 'forkSession',
			type: 'boolean',
			default: false,
			description: 'Whether to fork the resumed session to a new session ID. Useful for branching conversations. Requires Memory node and Chat Session ID.',
			displayOptions: {
				show: {
					'/backendMode': ['localCli'],
				},
			},
		},
		{
			displayName: 'Max Observability Bytes',
			name: 'maxObservabilityBytes',
			type: 'number',
			default: 262144,
			typeOptions: {
				minValue: 1024,
			},
			description: 'Approximate byte budget for observability events per invocation',
		},
		{
			displayName: 'Max Observability Events',
			name: 'maxObservabilityEvents',
			type: 'number',
			default: 500,
			typeOptions: {
				minValue: 10,
			},
			description: 'Maximum observability events to retain per invocation (oldest dropped first)',
		},
		{
			displayName: 'Max Turns',
			name: 'maxTurns',
			type: 'number',
			default: 0,
			description: 'Maximum number of conversation turns (0 for unlimited)',
			displayOptions: {
				show: {
					'/backendMode': ['localCli'],
				},
			},
		},
		{
			displayName: 'Observability Mode',
			name: 'observabilityMode',
			type: 'options',
			options: [
				{ name: 'Summary', value: 'summary', description: 'Record bounded event metadata only (recommended)' },
				{ name: 'Full', value: 'full', description: 'Record bounded event metadata plus payload snippets' },
				{ name: 'Off', value: 'off', description: 'Disable observability event collection' },
			],
			default: 'summary',
			description: 'How much per-invocation observability data to persist in task_result.observability',
		},
		{
			displayName: 'Redact Observability Payloads',
			name: 'redactObservabilityPayloads',
			type: 'boolean',
			default: true,
			description: 'Whether to apply conservative payload summarization/redaction before storing observability events',
		},
		{
			displayName: 'Treat Agent Errors as Workflow Errors',
			name: 'treatAgentErrorsAsWorkflowErrors',
			type: 'boolean',
			default: false,
			description: 'Whether to treat errors from Claude tools (Read, Bash, etc.) as workflow errors. This allows you to use n8n\'s "On Error" setting to stop the workflow, continue, or branch to an error output.',
		},
	],
};
