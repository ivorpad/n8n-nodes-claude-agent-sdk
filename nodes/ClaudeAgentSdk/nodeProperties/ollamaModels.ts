import type { INodeProperties } from 'n8n-workflow';
import { PROVIDER_DEFAULTS } from '../providerConfig';

export const ollamaModelProperty: INodeProperties = {
	displayName: 'Model',
	name: 'ollamaModel',
	type: 'options',
	default: '',
	required: true,
	description: 'Ollama model to use',
	displayOptions: { show: { authentication: ['none', 'ollama'] } },
	typeOptions: {
		loadOptions: {
			routing: {
				request: {
					method: 'GET',
					url:
						`={{String($parameter.additionalOptions?.ollamaBaseUrl || "${PROVIDER_DEFAULTS.ollamaBaseUrl}")` +
						'.replace(/\\/$/, "") + "/api/tags"}}',
				},
				output: {
					postReceive: [
						{ type: 'rootProperty', properties: { property: 'models' } },
						{
							type: 'setKeyValue',
							properties: {
								name: '={{$responseItem.name}}',
								value: '={{$responseItem.name}}',
							},
						},
						{ type: 'sort', properties: { key: 'name' } },
					],
				},
			},
		},
	},
};
