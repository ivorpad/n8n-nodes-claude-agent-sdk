/**
 * Top-level operation selector
 */

import type { INodeProperties } from 'n8n-workflow';

export const operationProperty: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	options: [
		{
			name: 'Execute Task',
			value: 'executeTask',
			description: 'Run an autonomous coding task with Claude Agent SDK',
		},
		{
			name: 'Generate Python SDK Script',
			value: 'generatePythonSdk',
			description: 'Generate a downloadable Python script that mirrors this configuration (no LLM call)',
		},
		{
			name: 'Manage Managed Agent',
			value: 'manageManagedAgent',
			description: 'Create, inspect, update, and list versions for Anthropic Managed Agents',
		},
	],
	default: 'executeTask',
};
