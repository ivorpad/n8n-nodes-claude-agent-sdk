/**
 * In-process n8n MCP server properties
 */

import type { INodeProperties } from 'n8n-workflow';
import { isN8nMcpInProcessEnabled } from '../featureFlags';

const ENABLE_N8N_MCP_IN_PROCESS = isN8nMcpInProcessEnabled();

const n8nMcpPropertyEnabled: INodeProperties = {
	displayName: 'N8N MCP (In-Process)',
	name: 'n8nMcp',
	type: 'collection',
	placeholder: 'Add n8n MCP Option',
	default: {},
	options: [
		{
			displayName: 'Allow Output Writes',
			name: 'allowOutputWrite',
			type: 'boolean',
			default: false,
			description: 'Whether Set Output JSON can mutate the final node output',
			displayOptions: {
				show: {
					enabled: [true],
				},
			},
		},
		{
			displayName: 'Enable',
			name: 'enabled',
			type: 'boolean',
			default: false,
			description: 'Whether to enable an in-process MCP server with n8n-native tools',
		},
		{
			displayName: 'Include Execution Metadata',
			name: 'includeExecutionMetadata',
			type: 'boolean',
			default: true,
			description: 'Whether Get Execution Context includes node and backend metadata',
			displayOptions: {
				show: {
					enabled: [true],
				},
			},
		},
		{
			displayName: 'Server Name',
			name: 'serverName',
			type: 'string',
			default: 'n8n',
			description: 'MCP server name (tools appear as mcp__name__tool)',
			displayOptions: {
				show: {
					enabled: [true],
				},
			},
		},
		{
			displayName: 'Tools',
			name: 'tools',
			type: 'multiOptions',
			default: [],
			description: 'Select which in-process n8n MCP tools are available to Claude',
			displayOptions: {
				show: {
					enabled: [true],
				},
			},
			options: [
				{
					name: 'Get Item JSON',
					value: 'getItemJson',
					description: 'Read input JSON for current item',
				},
				{
					name: 'Get Execution Context',
					value: 'getExecutionContext',
					description: 'Read safe execution metadata',
				},
				{
					name: 'Log',
					value: 'log',
					description: 'Write log events to execution output',
				},
				{
					name: 'Set Output JSON',
					value: 'setOutputJson',
					description: 'Set or replace final node output JSON',
				},
			],
		},
		{
			displayName: 'Enable Skill Tools',
			name: 'enableSkillTools',
			type: 'boolean',
			default: false,
			description:
				'Whether to auto-load local skills as MCP tools (supports runnable entrypoints and frontmatter-only SKILL.md instructions)',
			displayOptions: {
				show: {
					enabled: [true],
				},
			},
		},
		{
			displayName: 'Skill Tools Server Name',
			name: 'skillToolsServerName',
			type: 'string',
			default: 'skills',
			description: 'MCP server name for auto-loaded skill tools',
			displayOptions: {
				show: {
					enabled: [true],
					enableSkillTools: [true],
				},
			},
		},
		{
			displayName: 'Skill Tool Selection',
			name: 'skillToolsSelectionMode',
			type: 'options',
			default: 'all',
			description: 'How to select skills that become tools',
			displayOptions: {
				show: {
					enabled: [true],
					enableSkillTools: [true],
				},
			},
			options: [
				{
					name: 'All',
					value: 'all',
					description: 'Auto-load all discovered skills',
				},
				{
					name: 'Selected',
					value: 'selected',
					description: 'Only load selected skills',
				},
				{
					name: 'All Except',
					value: 'except',
					description: 'Load all skills except selected ones',
				},
			],
		},
		{
			displayName: 'Skill Tools',
			name: 'skillTools',
			type: 'multiOptions',
			typeOptions: {
				loadOptionsMethod: 'discoverSkills',
			},
			default: [],
			description: 'Skills to include or exclude based on Skill Tool Selection',
			displayOptions: {
				show: {
					enabled: [true],
					enableSkillTools: [true],
					skillToolsSelectionMode: ['selected', 'except'],
				},
			},
			noDataExpression: true,
		},
		{
			displayName: 'Skill Tool Timeout (ms)',
			name: 'skillToolTimeoutMs',
			type: 'number',
			default: 120000,
			typeOptions: {
				minValue: 1000,
			},
			description:
				'Default timeout per skill execution. A skill-specific timeout in TOOL.json overrides this value.',
			displayOptions: {
				show: {
					enabled: [true],
					enableSkillTools: [true],
				},
			},
		},
	],
};

const n8nMcpPropertyDisabled: INodeProperties = {
	displayName: 'N8N MCP (In-Process)',
	name: 'n8nMcp',
	type: 'hidden',
	default: {},
};

export const n8nMcpProperties: INodeProperties[] = [
	ENABLE_N8N_MCP_IN_PROCESS ? n8nMcpPropertyEnabled : n8nMcpPropertyDisabled,
];
