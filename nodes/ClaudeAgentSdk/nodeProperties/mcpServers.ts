/**
 * MCP Servers configuration properties
 */

import type { INodeProperties } from 'n8n-workflow';

export const mcpServersProperties: INodeProperties[] = [

	{
		displayName: 'Enable MCP Servers',
		name: 'enableMcpServers',
		type: 'boolean',
		default: false,
		description: 'Whether to connect external tools via Model Context Protocol',
	},
	{
		displayName: 'MCP Servers',
		name: 'mcpServers',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add MCP Server',
		default: {},
		description: 'Configure MCP server connections',
		displayOptions: {
			show: {
				enableMcpServers: [true],
			},
		},
		options: [
			{
				displayName: 'Server',
				name: 'servers',
				values: [
					{
						displayName: 'Always Load',
						name: 'alwaysLoad',
						type: 'boolean',
						default: false,
						description: 'Whether to always load this server\'s tools instead of deferring them until first use',
					},
					{
						displayName: 'Arguments',
						name: 'args',
						type: 'string',
						default: '',
						placeholder: '@modelcontextprotocol/server-filesystem,	/data',
						description: 'Comma-separated command arguments',
					},
					{
						displayName: 'Authentication',
						name: 'authentication',
						type: 'options',
						default: 'none',
						options: [
							{
								name: 'None',
								value: 'none',
							},
							{
								name: 'Credential',
								value: 'credential',
								description: 'Use MCP Server Authentication credential',
							},
							{
								name: 'Custom Headers',
								value: 'custom',
								description: 'Provide headers as JSON',
							},
						]
					},
					{
						displayName: 'Blocked Tools',
						name: 'blockedTools',
						type: 'string',
						default: '',
						placeholder: 'dangerous_tool, admin_action',
						description: 'Comma-separated list of tool names to block (without mcp__servername__ prefix)',
					},
					{
						displayName: 'Command',
						name: 'command',
						type: 'string',
						default: '',
							required:	true,
						placeholder: 'npx',
						description: 'Executable path or command to run',
					},
					{
						displayName: 'Environment Variables (JSON)',
						name: 'env',
						type: 'string',
						default: '{}',
						placeholder: '{\'API_KEY\': \'your-key\'}',
						description: 'Environment variables for the MCP server process',
					},
					{
						displayName: 'Headers (JSON)',
						name: 'headers',
						type: 'string',
						default: '{}',
						placeholder: '{\'Authorization\': \'Bearer	${API_TOKEN}\'}',
						description: 'Custom HTTP headers as JSON object',
							hint:	'Use	${VAR}. Values resolve from secure env first, then container env.',
					},
					{
						displayName: 'Server Name',
						name: 'name',
						type: 'string',
						default: '',
							required:	true,
						placeholder: 'my-server',
						description: 'Unique identifier (tools appear as mcp__name__toolname)',
					},
					{
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						type: 'number',
						default: 0,
						description: 'Per-server startup/request timeout in milliseconds. 0 uses the SDK default.',
					},
					{
						displayName: 'Tool Permission Policies',
						name: 'toolPolicies',
						type: 'fixedCollection',
						default: {},
						placeholder: 'Add Per-Tool Policy',
						description: 'Per-tool permission policies sent to the SDK (mcp_set_servers tools[]). Only http/sse servers support this. Tools not listed fall back to the global Tool Permissions	/	Blocked Tools.',
						options: [
							{
								displayName: 'Policy',
								name: 'entries',
									values:	[
											{
												displayName: 'Tool Name',
												name: 'name',
												type: 'string',
												default: '',
												placeholder: 'search_web',
												description: 'Tool name without the mcp__servername__ prefix',
											},
											{
												displayName: 'Permission Policy',
												name: 'permission_policy',
												type: 'options',
												default: 'always_ask',
												options: [
													{
														name: 'Always Allow',
														value: 'always_allow',
													},
													{
														name: 'Always Ask',
														value: 'always_ask',
													},
													{
														name: 'Always Deny',
														value: 'always_deny',
													},
													]
											},
									]
							},
					]
					},
					{
						displayName: 'Tool Permissions',
						name: 'toolPermissions',
						type: 'options',
						default: 'all',
						options: [
							{
								name: 'Allow All Tools',
								value: 'all',
								description: 'Allow all tools from this MCP server',
							},
							{
								name: 'Block Specific Tools',
								value: 'block',
								description: 'Block specific tools (comma-separated)',
							},
					],
						description: 'Control which tools from this MCP server are allowed',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						default: 'http',
						options: [
							{
								name: 'HTTP',
								value: 'http',
								description: 'Recommended for Docker environments',
							},
							{
								name: 'SSE (Server-Sent Events)',
								value: 'sse',
								description: 'Real-time streaming transport',
							},
							{
								name: 'Stdio (Local Process)',
								value: 'stdio',
								description: 'Run local MCP server process (limited in Docker)',
							},
					]
					},
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
							required:	true,
						placeholder: 'http://mcp-server:3000/mcp',
						description: 'Full URL to the MCP server endpoint',
					},
			],
			},
		],
	},
];
