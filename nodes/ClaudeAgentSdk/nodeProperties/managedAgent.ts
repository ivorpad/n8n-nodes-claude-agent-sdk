/**
 * Node properties for the Managed Agent execution backend.
 *
 * These only show when backendMode = 'managedAgent'.
 */

import type { INodeProperties } from 'n8n-workflow';

export const managedAgentProperties: INodeProperties[] = [
	{
		displayName: 'Agent Name or ID',
		name: 'managedAgentId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'listManagedAgents',
		},
		default: '',
		required: true,
		description:
			'Pick a Managed Agent from your Anthropic workspace. Use the Manage Managed Agent operation to create, inspect, update, and version agents from n8n. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
	},
	{
		displayName: 'Environment Name or ID',
		name: 'managedEnvironmentId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'listManagedEnvironments',
		},
		default: '',
		required: true,
		description:
			'Pick an environment for the Managed Agent session. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
	},
	{
		displayName: 'Agent Version',
		name: 'managedAgentVersionMode',
		type: 'options',
		default: 'latest',
		options: [
			{
				name: 'Latest',
				value: 'latest',
				description: 'Start new sessions with the latest agent version',
			},
			{
				name: 'Pinned',
				value: 'pinned',
				description: 'Start new sessions with a specific agent version',
			},
		],
		description: 'Whether new Managed Agent sessions use the latest agent version or a pinned version',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
	},
	{
		displayName: 'Pinned Agent Version',
		name: 'managedAgentVersion',
		type: 'number',
		default: 1,
		typeOptions: {
			minValue: 1,
		},
		description: 'Specific Managed Agent version to use for newly-created sessions',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
				managedAgentVersionMode: ['pinned'],
			},
		},
	},
	{
		displayName: 'Session Title',
		name: 'managedSessionTitle',
		type: 'string',
		default: '',
		description: 'Optional human-readable title for new Managed Agent sessions',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
	},
	{
		displayName: 'Session Metadata (JSON)',
		name: 'managedSessionMetadataJson',
		type: 'string',
		default: '',
		typeOptions: {
			rows: 3,
		},
		placeholder: '{"workflow":"support"}',
		description: 'Optional JSON object of string metadata for new Managed Agent sessions',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
	},
	{
		displayName: 'Vault IDs',
		name: 'managedVaultIds',
		type: 'string',
		default: '',
		placeholder: 'vlt_..., vlt_...',
		description: 'Comma-separated existing Anthropic vault IDs to attach at session creation. Values are sent to Anthropic but not echoed in node output.',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
	},
	{
		displayName: 'Session Resources',
		name: 'managedSessionResources',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Resource',
		default: {},
		description: 'Files, GitHub repositories, and memory stores to mount when creating a new Managed Agent session',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
		options: [
			{
				displayName: 'File',
				name: 'fileResources',
				values: [
					{
						displayName: 'File ID',
						name: 'fileId',
						type: 'string',
						default: '',
						placeholder: 'file_...',
						description: 'Anthropic Files API file ID to mount',
					},
					{
						displayName: 'Mount Path',
						name: 'mountPath',
						type: 'string',
						default: '',
						placeholder: '/mnt/session/uploads/report.pdf',
						description: 'Optional mount path in the session container',
					},
				],
			},
			{
					displayName: 'GitHub Repository',
					name: 'githubRepositoryResources',
					values: [
						{
							displayName: 'Authorization Token',
							name: 'authorizationToken',
							type: 'string',
						typeOptions: {
							password: true,
						},
							default: '',
							description: 'GitHub token used by Anthropic to clone the repository. This value is never echoed in node output.',
						},
						{
							displayName: 'Branch Name',
							name: 'checkoutBranch',
							type: 'string',
							default: '',
							displayOptions: {
								show: {
									checkoutType: ['branch'],
								},
							},
						},
						{
							displayName: 'Checkout Type',
							name: 'checkoutType',
							type: 'options',
						default: 'default',
						options: [
							{ name: 'Default Branch', value: 'default' },
							{ name: 'Branch', value: 'branch' },
							{ name: 'Commit', value: 'commit' },
							],
						},
						{
							displayName: 'Commit SHA',
							name: 'checkoutCommit',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								checkoutType: ['commit'],
							},
						},
					},
					{
						displayName: 'Mount Path',
						name: 'mountPath',
						type: 'string',
						default: '',
							placeholder: '/workspace/repo',
							description: 'Optional mount path in the session container',
						},
						{
							displayName: 'Repository URL',
							name: 'url',
							type: 'string',
							default: '',
							placeholder: 'https://github.com/org/repo',
							description: 'GitHub repository URL to mount',
						},
					],
				},
			{
				displayName: 'Memory Store',
				name: 'memoryStoreResources',
				values: [
					{
						displayName: 'Memory Store ID',
						name: 'memoryStoreId',
						type: 'string',
						default: '',
						placeholder: 'memstore_...',
						description: 'Anthropic Memory Store ID to attach at session creation',
					},
					{
						displayName: 'Access',
						name: 'access',
						type: 'options',
						default: 'read_write',
						options: [
							{ name: 'Read/Write', value: 'read_write' },
							{ name: 'Read Only', value: 'read_only' },
						],
					},
					{
						displayName: 'Instructions',
						name: 'instructions',
						type: 'string',
						default: '',
						typeOptions: {
							rows: 3,
						},
						description: 'Optional guidance for how the agent should use this memory store',
					},
				],
			},
		],
	},
];
