import type { INodeProperties } from 'n8n-workflow';

import { isAgentPlaneEnabled } from '../featureFlags';

const companionAgentProperty: INodeProperties = {
	displayName: 'Agent Plane',
	name: 'companionAgent',
	type: 'collection',
	placeholder: 'Add Agent Plane Setting',
	default: {},
	description: 'Resolve the local CLI working directory from Agent Plane using agent ID',
	displayOptions: {
		show: {
			operation: ['executeTask'],
			backendMode: ['localCli'],
		},
	},
	options: [
		{
			displayName: 'Agent',
			name: 'companionAgentId',
			type: 'resourceLocator',
			default: { mode: 'list', value: '' },
			description:
				'Agent Plane agent to use. Choose from the list, or specify the stable Agent Plane agent ID.',
			modes: [
				{
					displayName: 'From List',
					name: 'list',
					type: 'list',
					placeholder: 'Select an Agent Plane agent...',
					typeOptions: {
						searchListMethod: 'listCompanionAgents',
						searchable: true,
						searchFilterRequired: false,
					},
				},
				{
					displayName: 'By ID',
					name: 'id',
					type: 'string',
					placeholder: 'e.g. agt_support_t1JTxDs7',
				},
			],
		},
		{
			displayName: 'Lifecycle Callbacks',
			name: 'companionLifecycleCallbacks',
			type: 'boolean',
			default: true,
			description: 'Whether to record run start/completion/failure callbacks in Agent Plane',
		},
		{
			displayName: 'Readiness Mode',
			name: 'companionReadinessMode',
			type: 'options',
			options: [
				{
					name: 'Check Only',
					value: 'checkOnly',
					description: 'Verify directory and sync status without publishing',
				},
				{
					name: 'Sync If Needed',
					value: 'syncIfNeeded',
					description: 'Ask Agent Plane to publish pending revisions before returning',
				},
			],
			default: 'checkOnly',
			description: 'How Agent Plane should prepare the agent before this node runs',
		},
		{
			displayName: 'Require Synced Workspace',
			name: 'companionRequireSynced',
			type: 'boolean',
			default: true,
			description:
				'Whether to fail fast when Agent Plane reports the workspace is not ready or not synced',
		},
		{
			displayName: 'Use Agent Plane',
			name: 'useCompanionAgent',
			type: 'boolean',
			default: false,
			description: 'Whether to resolve workingDirectory from Agent Plane before execution',
		},
	],
};

export const companionAgentProperties: INodeProperties[] = isAgentPlaneEnabled()
	? [companionAgentProperty]
	: [];

export { companionAgentProperty };
