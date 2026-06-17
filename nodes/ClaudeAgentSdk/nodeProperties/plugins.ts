/**
 * Plugin configuration properties
 */

import type { INodeProperties } from 'n8n-workflow';

export const pluginsProperties: INodeProperties[] = [
	{
		displayName: 'Enable Plugins',
		name: 'enablePlugins',
		type: 'boolean',
		default: false,
		description: 'Load Claude Code plugins to extend the agent with commands, agents, skills, and hooks',
	},
	{
		displayName: 'Installed Plugins',
		name: 'selectedPlugins',
		type: 'multiOptions',
		typeOptions: {
			loadOptionsMethod: 'discoverPlugins',
		},
		default: [],
		description: 'Select from CLI-installed plugins. Hit refresh to re-scan.',
		displayOptions: {
			show: {
				enablePlugins: [true],
			},
		},
	},
	{
		displayName: 'Additional Plugin Paths',
		name: 'additionalPluginPaths',
		type: 'string',
		default: '',
		placeholder: './my-plugin, /absolute/path/to/plugin',
		description: 'Comma-separated paths to additional plugins (for development or custom plugins)',
		displayOptions: {
			show: {
				enablePlugins: [true],
			},
		},
	},
];
