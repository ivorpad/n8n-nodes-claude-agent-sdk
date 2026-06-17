/**
 * Subagents configuration properties
 */

import type { INodeProperties } from 'n8n-workflow';

export const subagentsProperties: INodeProperties[] = [

	{
		displayName: 'Enable Subagents',
		name: 'enableSubagents',
		type: 'boolean',
		default: false,
		description: 'Whether to define specialized subagents that the main agent can delegate tasks to',
	},
	{
		displayName: 'Subagents',
		name: 'subagents',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Subagent',
		default: {},
		description: 'Configure specialized subagents for task delegation',
		displayOptions: {
			show: {
				enableSubagents: [true],
			},
		},
		options: [
			{
				displayName: 'Subagent',
				name: 'agents',
				values: [
					{
						displayName: 'Allowed Tools',
						name: 'tools',
						type: 'string',
						default: 'Read, Grep, Glob',
						placeholder: 'Read, Grep, Glob, Edit',
						description: 'Comma-separated list of allowed tools',
						displayOptions: {
							show: {
								toolRestrictions: ['custom'],
							},
						},
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						typeOptions: { rows: 2 },
						default: '',
						required: true,
						placeholder: 'Use for HR-related queries about policies, benefits, and employee matters',
						description: 'When should the main agent delegate to this subagent?',
					},
					{
						displayName: 'Model Override',
						name: 'model',
						type: 'options',
						default: 'inherit',
						options: [
							{ name: 'Fable', value: 'fable' },
							{ name: 'Haiku', value: 'haiku' },
							{ name: 'Inherit From Parent', value: 'inherit' },
							{ name: 'Opus', value: 'opus' },
							{ name: 'Sonnet', value: 'sonnet' },
						],
						description: 'Override the model used by this subagent',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'hr-expert',
						description: 'Unique identifier for this subagent (lowercase, hyphens). Used by Task tool.',
					},
					{
						displayName: 'System Prompt',
						name: 'prompt',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						required: true,
						placeholder: 'You are an HR specialist with expertise in company policies...',
						description: 'Instructions that define this subagent\'s role and behavior',
					},
					{
						displayName: 'Tool Restrictions',
						name: 'toolRestrictions',
						type: 'options',
						default: 'inherit',
						options: [
							{ name: 'Inherit All Tools', value: 'inherit', description: 'Use all tools available to main agent' },
							{ name: 'Read Only', value: 'readonly', description: 'Only Read, Grep, Glob' },
							{ name: 'Custom', value: 'custom', description: 'Specify exact tools' },
						],
					},
				],
			},
		],
	},
];
