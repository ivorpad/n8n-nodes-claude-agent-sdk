import type { INodeProperties } from 'n8n-workflow';

const lifecycleShow = {
	operation: ['manageManagedAgent'],
};

const authoringOperations = ['create', 'update'] as const;

export const managedAgentLifecycleProperties: INodeProperties[] = [
	{
		displayName: 'Managed Agent Operation',
		name: 'managedAgentOperation',
		type: 'options',
		noDataExpression: true,
		default: 'inspect',
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new Anthropic Managed Agent',
			},
			{
				name: 'Inspect',
				value: 'inspect',
				description: 'Retrieve the current or pinned Managed Agent definition',
			},
			{
				name: 'List Versions',
				value: 'listVersions',
				description: 'List versions for a Managed Agent',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a Managed Agent using optimistic version checking',
			},
		],
		displayOptions: {
			show: lifecycleShow,
		},
	},
	{
		displayName: 'Agent Name or ID',
		name: 'managedLifecycleAgentId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'listManagedAgents',
		},
		default: '',
		required: true,
			description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: ['inspect', 'update', 'listVersions'],
			},
		},
	},
	{
		displayName: 'Version',
		name: 'managedLifecycleAgentVersion',
		type: 'number',
		default: 0,
		typeOptions: {
			minValue: 0,
		},
		description: 'Optional version to inspect. Use 0 to retrieve the latest version.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: ['inspect'],
			},
		},
	},
	{
		displayName: 'Expected Current Version',
		name: 'managedAgentExpectedVersion',
		type: 'number',
		default: 1,
		typeOptions: {
			minValue: 1,
		},
		required: true,
		description: 'Current agent version expected by this edit. The API rejects the update if another edit has already produced a newer version.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: ['update'],
			},
		},
	},
	{
		displayName: 'Name',
		name: 'managedAuthoringName',
		type: 'string',
		default: '',
		description: 'Managed Agent name. Required for create; omitted on update when blank.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Model',
		name: 'managedAuthoringModel',
		type: 'string',
		default: '',
		placeholder: 'claude-sonnet-4-6',
		description: 'Managed Agent model ID. Required for create; omitted on update when blank.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Model Speed',
		name: 'managedAuthoringModelSpeed',
		type: 'options',
		default: '',
		options: [
			{ name: 'Default', value: '' },
			{ name: 'Standard', value: 'standard' },
			{ name: 'Fast', value: 'fast' },
		],
		description: 'Optional model speed mode for Managed Agent create/update',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'System Prompt',
		name: 'managedAuthoringSystem',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 5,
		},
		description: 'Managed Agent system prompt. Omitted on update when blank; use Raw Config JSON to send null and clear it.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Description',
		name: 'managedAuthoringDescription',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 3,
		},
		description: 'Managed Agent description. Omitted on update when blank; use Raw Config JSON to send null and clear it.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Metadata (JSON)',
		name: 'managedAuthoringMetadataJson',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 3,
		},
		placeholder: '{"team":"ops"}',
		description: 'Create uses a string map. Update uses a string/null patch where null deletes a key.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Tools (JSON Array)',
		name: 'managedAuthoringToolsJson',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 5,
		},
		description: 'Optional tools array. Supports agent_toolset_20260401, mcp_toolset, and custom tool objects from the Managed Agents API.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'MCP Servers (JSON Array)',
		name: 'managedAuthoringMcpServersJson',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 4,
		},
			description: 'Optional URL MCP server definitions for the Managed Agent',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Skills (JSON Array)',
		name: 'managedAuthoringSkillsJson',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 4,
		},
			description: 'Optional Managed Agent skills array',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Multiagent Config (JSON)',
		name: 'managedAuthoringMultiagentJson',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 4,
		},
		description: 'Optional multiagent coordinator config object. Use null in Raw Config JSON to clear it on update.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
	{
		displayName: 'Raw Config JSON',
		name: 'managedAuthoringRawJson',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 5,
		},
		description: 'Advanced JSON object merged last into the create/update payload for fast-moving Managed Agent fields. Values are runtime-validated as JSON before use.',
		displayOptions: {
			show: {
				operation: ['manageManagedAgent'],
				managedAgentOperation: [...authoringOperations],
			},
		},
	},
];
