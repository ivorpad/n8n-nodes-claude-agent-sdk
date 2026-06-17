/**
 * Permissions UI Properties
 *
 * n8n node property definitions for the permissions module.
 * All security options are inside a collection so they only appear when added.
 */

import type { INodeProperties } from 'n8n-workflow';

import { TOOL_OPTIONS } from '../toolOptions';

/**
 * Security Options - contains Path Sandboxing, Content Filtering, Tool Permissions, Audit Logging
 * Each option only appears when added via "Add Option"
 */
export const permissionsProperties: INodeProperties[] = [
	// Block Env Files - enabled by default, at top level for visibility
	{
		displayName: 'Block Env Files',
		name: 'blockEnvFiles',
		type: 'boolean',
		default: true,
		description: 'Whether to block access to .env files and environment-dump attempts via Read, Write, Edit, Glob, Grep, and Bash tools',
	},
	{
		displayName: 'Security Options',
		name: 'securityOptions',
		type: 'collection',
		placeholder: 'Add Security Option',
		default: {},
		options: [
			// AGT Governance (Microsoft Agent Governance Toolkit)
			{
				displayName: 'AGT Governance',
				name: 'agtGovernance',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description:
					'Policy-as-code governance via @microsoft/agentmesh-sdk. Evaluates rules against every tool call and can allow, deny, or route through HITL.',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Agent DID',
								name: 'agentDid',
								type: 'string',
								default: '',
								placeholder: 'did:agentmesh:order-returns',
								description:
									'Decentralised identifier for this agent, used for policy scoping and rate limits. Leave blank to auto-derive a stable DID from workflow/node/session.',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
							{
								displayName: 'Conflict Strategy',
								name: 'conflictStrategy',
								type: 'options',
								options: [
									{ name: 'Allow Overrides', value: 'allowOverrides', description: 'Any matching allow rule wins' },
									{ name: 'Deny Overrides', value: 'denyOverrides', description: 'Any matching deny rule wins (safest)' },
									{ name: 'Most Specific Wins', value: 'mostSpecificWins', description: 'Rule with the tightest condition wins' },
									{ name: 'Priority First Match', value: 'priorityFirstMatch', description: 'Highest-priority matching rule wins' },
								],
								default: 'priorityFirstMatch',
								description: 'How conflicting rules are resolved when multiple match',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
							{
								displayName: 'Default Action',
								name: 'defaultAction',
								type: 'options',
								options: [
									{ name: 'Allow', value: 'allow' },
									{ name: 'Deny', value: 'deny' },
								],
								default: 'deny',
								description: 'What to do when no rule matches. Default deny is the safer baseline for policy-as-code.',
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
								default: true,
								description: 'Whether to enforce AGT governance rules on tool calls',
							},
							{
								displayName: 'Rules',
								name: 'rules',
								type: 'fixedCollection',
								typeOptions: {
									multipleValues: true,
									sortable: true,
								},
								default: {},
								placeholder: 'Add Rule',
								description: 'Ordered list of policy rules evaluated against each tool call',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
								options: [
									{
										displayName: 'Rule',
										name: 'values',
										values: [
											{
												displayName: 'Approvers',
												name: 'approvers',
												type: 'string',
												default: '',
												placeholder: 'ops@company.com, lead@company.com',
												description: 'Comma-separated approver identifiers (informational — actual HITL routing uses the node HITL settings)',
												displayOptions: {
													show: {
														decision: ['require_approval'],
													},
												},
											},
											{
												displayName: 'Conditions',
												name: 'conditions',
												type: 'filter',
												default: {},
												typeOptions: {
													filter: {
														version: 3,
														caseSensitive: true,
														typeValidation: 'strict',
													},
												},
												description:
													'Optional conditions on tool input. Supported operators: equals, notEquals, gt, gte, lt, lte. String methods (contains, startsWith, endsWith) are not supported by the AGT engine. Use exact equality for strings and comparison operators for numbers (e.g. amount < 50).',
											},
											{
												displayName: 'Decision',
												name: 'decision',
												type: 'options',
												options: [
													{ name: 'Allow', value: 'allow' },
													{ name: 'Deny', value: 'deny' },
													{
														name: 'Require Approval',
														value: 'require_approval',
														description: 'Route through HITL. Fails closed when HITL is disabled on the node.',
													},
												],
												default: 'deny',
												description: 'Action to take when this rule matches',
											},
											{
												displayName: 'Name',
												name: 'name',
												type: 'string',
												default: '',
												placeholder: 'block-large-refunds',
												description: 'Optional rule identifier. Blank rows are auto-named.',
											},
											{
												displayName: 'Priority',
												name: 'priority',
												type: 'number',
												default: 100,
												description: 'Higher priority rules are evaluated first',
											},
											{
												displayName: 'Rate Limit',
												name: 'limit',
												type: 'string',
												default: '',
												placeholder: '20/hour',
												description: 'Optional rate cap, e.g. "20/hour" or "3/minute". Exceeded calls are denied with a rate_limited reason.',
											},
											{
												displayName: 'Tool Names or IDs',
												name: 'tools',
												type: 'multiOptions',
												options: TOOL_OPTIONS,
												typeOptions: {
													loadOptionsMethod: 'listToolOptions',
												},
												default: [],
												description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
											},
										],
									},
								],
							},
						],
					},
				],
			},

			// Audit Logging
			{
				displayName: 'Audit Logging',
				name: 'auditLogging',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Capture detailed logs of all tool executions (outputs to second connector)',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Enable',
								name: 'enabled',
								type: 'boolean',
								default: true,
								description: 'Whether to capture audit logs of tool executions',
							},
							{
								displayName: 'Log Tool Inputs',
								name: 'logInputs',
								type: 'boolean',
								default: true,
								description: 'Whether to include tool input parameters in the audit log',
							},
							{
								displayName: 'Log Tool Outputs',
								name: 'logOutputs',
								type: 'boolean',
								default: false,
								description: 'Whether to include tool outputs in the audit log (can be large)',
							},
							{
								displayName: 'Max Log Entries',
								name: 'maxEntries',
								type: 'number',
								default: 1000,
								description: 'Maximum number of audit entries to keep (oldest are removed first)',
							},
							{
								displayName: 'Redact Patterns',
								name: 'redactPatterns',
								type: 'string',
								default: '',
								placeholder: 'password=.*,api_key=\\w+',
								description: 'Comma-separated regex patterns to redact from logs',
							},
						],
					},
				],
			},

			// Content Filtering
			{
				displayName: 'Content Filtering',
				name: 'contentFilter',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Block tool usage based on dangerous content patterns',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Enable',
								name: 'enabled',
								type: 'boolean',
								default: true,
								description: 'Whether to block tool usage based on content patterns',
							},
							{
								displayName: 'Security Presets',
								name: 'presets',
								type: 'multiOptions',
								options: [
									{
										name: 'Dangerous Commands',
										value: 'dangerous-commands',
										description: 'Block rm -rf, sudo, curl|sh, chmod 777, etc',
									},
									{
										name: 'Secrets Patterns',
										value: 'secrets-patterns',
										description: 'Block API keys, private keys, hardcoded passwords',
									},
									{
										name: 'System Files',
										value: 'system-files',
										description: 'Block access to /etc/passwd, .ssh/, .env files',
									},
								],
								default: ['dangerous-commands'],
								description: 'Built-in security rule presets',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
							{
								displayName: 'Custom Rules (JSON)',
								name: 'customRules',
								type: 'json',
								default: '[]',
								description: 'Custom blocking rules as JSON array. Format: [{"ruleId": "my-rule", "pattern": "regex", "tools": ["Bash"], "targetField": "command"}].',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
						],
					},
				],
			},

			// Path Sandboxing
			{
				displayName: 'Path Sandboxing',
				name: 'pathSandbox',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Restrict file operations to specific directories',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Enable',
								name: 'enabled',
								type: 'boolean',
								default: true,
								description: 'Whether to restrict file operations to specific directories',
							},
							{
								displayName: 'Base Path Mode',
								name: 'basePathMode',
								type: 'options',
								options: [
									{
										name: 'Working Directory',
										value: 'workingDirectory',
										description: 'Use the Working Directory as the sandbox root',
									},
									{
										name: 'Custom Path',
										value: 'custom',
										description: 'Specify an explicit sandbox root path',
									},
								],
								default: 'workingDirectory',
								description: 'How to determine the sandbox base path. "Working Directory" uses the CWD set on this node.',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
							{
								displayName: 'Sandbox Base Path',
								name: 'basePath',
								type: 'string',
								default: '',
								placeholder: '/safe/sandbox/directory',
								description: 'The base directory for all file operations. Operations outside this path will be blocked.',
								displayOptions: {
									show: {
										enabled: [true],
										basePathMode: ['custom'],
									},
								},
							},
							{
								displayName: 'Affected Tools',
								name: 'affectedTools',
								type: 'multiOptions',
								options: [
									{ name: 'Edit', value: 'Edit' },
									{ name: 'Glob', value: 'Glob' },
									{ name: 'Grep', value: 'Grep' },
									{ name: 'Read', value: 'Read' },
									{ name: 'Write', value: 'Write' },
								],
								default: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
								description: 'Which file operation tools are affected by the sandbox. Additional allowed paths are configured via the "Additional Directories" field above.',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
						],
					},
				],
			},

			// Tool Permissions
			{
				displayName: 'Tool Permissions',
				name: 'toolPermissions',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Fine-grained control over which tools can be used',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Enable',
								name: 'enabled',
								type: 'boolean',
								default: true,
								description: 'Whether to apply custom tool permission rules',
							},
							{
								displayName: 'Default Decision',
								name: 'defaultDecision',
								type: 'options',
								options: [
									{ name: 'Allow', value: 'allow' },
									{ name: 'Deny', value: 'deny' },
								],
								default: 'allow',
								description: 'What to do when no rules match',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
							{
								displayName: 'Ask Fallback',
								name: 'askFallback',
								type: 'options',
								options: [
									{ name: 'Allow', value: 'allow' },
									{ name: 'Deny', value: 'deny' },
								],
								default: 'deny',
								description: 'When a rule says "ask" but no interactive prompt is available (n8n is non-interactive)',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
							{
								displayName: 'Permission Rules (JSON)',
								name: 'rules',
								type: 'json',
								default: '[]',
								description: 'Permission rules as JSON array. Format: [{"toolPattern": "Bash", "decision": "deny", "condition": "input.command.includes(\'rm\')", "reason": "Block rm commands"}]. Supports glob patterns like "mcp__*".',
								displayOptions: {
									show: {
										enabled: [true],
									},
								},
							},
						],
					},
				],
			},

		],
	},
];
