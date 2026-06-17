import type { INodeProperties } from 'n8n-workflow';

/**
 * CodeMie Proxy provider properties. Included in the node description only when
 * the companion package is detected (see node/description.ts). Shown for the
 * local-CLI Execute Task path when CodeMie Proxy authentication is selected.
 * Legacy 'codemie' is accepted alongside the credential-type value.
 */

export const CODEMIE_AUTHENTICATION_VALUES = ['codeMieSsoApi', 'codemie'];
const CODEMIE_OPERATION_VALUES = ['executeTask', 'generatePythonSdk'];

export const codeMieModelProperties: INodeProperties[] = [
	{
		displayName: 'Model Name or ID',
		name: 'codeMieModel',
		type: 'options',
		default: '',
		description:
			'Model served via the CodeMie proxy (loaded from /v1/llm_models). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				operation: CODEMIE_OPERATION_VALUES,
				backendMode: ['localCli'],
				authentication: CODEMIE_AUTHENTICATION_VALUES,
			},
		},
		typeOptions: {
			loadOptionsMethod: 'listCodeMieModels',
		},
	},
	{
		displayName: 'Manual Model',
		name: 'codeMieModelManual',
		type: 'string',
		default: '',
		placeholder: 'claude-sonnet-4-5-20250929',
		description:
			'Manual CodeMie model ID, used when model loading is unavailable or the model is not listed. When set, this overrides the selected model above.',
		displayOptions: {
			show: {
				operation: CODEMIE_OPERATION_VALUES,
				backendMode: ['localCli'],
				authentication: CODEMIE_AUTHENTICATION_VALUES,
			},
		},
	},
];
