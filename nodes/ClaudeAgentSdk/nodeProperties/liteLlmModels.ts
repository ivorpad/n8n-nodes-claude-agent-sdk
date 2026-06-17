import type { INodeProperties } from 'n8n-workflow';

export const LITELLM_AUTHENTICATION_VALUES = ['claudeAgentSdkLiteLlmApi', 'litellm'];

const LITELLM_OPERATION_VALUES = ['executeTask', 'generatePythonSdk'];

export const liteLlmModelProperties: INodeProperties[] = [
	{
		displayName: 'Model Name or ID',
		name: 'liteLlmModel',
		type: 'options',
		default: '',
		description:
			'LiteLLM model alias loaded from the proxy /v1/models endpoint. The proxy maps this alias to the configured upstream model. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				operation: LITELLM_OPERATION_VALUES,
				backendMode: ['localCli'],
				authentication: LITELLM_AUTHENTICATION_VALUES,
			},
		},
		typeOptions: {
			loadOptionsMethod: 'listLiteLlmModels',
		},
	},
	{
		displayName: 'Manual Model Alias',
		name: 'liteLlmModelAlias',
		type: 'string',
		default: '',
		placeholder: 'claude-sonnet-4-6',
		description:
			'Manual LiteLLM model alias to use when model loading is unavailable or the alias is not listed. When set, this overrides the selected model above.',
		displayOptions: {
			show: {
				operation: LITELLM_OPERATION_VALUES,
				backendMode: ['localCli'],
				authentication: LITELLM_AUTHENTICATION_VALUES,
			},
		},
	},
];
