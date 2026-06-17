import type { INodeProperties } from 'n8n-workflow';

/** Metadata for each OpenRouter model tier */
interface ModelTier {
	tier: string;     // e.g. 'Sonnet', 'Opus', 'Haiku'
	paramName: string; // e.g. 'openrouterSonnetModel'
}

const MODEL_TIERS: ModelTier[] = [
	{ tier: 'Sonnet', paramName: 'openrouterSonnetModel' },
	{ tier: 'Opus', paramName: 'openrouterOpusModel' },
	{ tier: 'Haiku', paramName: 'openrouterHaikuModel' },
];

/** Creates an INodeProperties for an OpenRouter model tier selector */
function makeOpenRouterModelProperty({ tier, paramName }: ModelTier): INodeProperties {
	return {
		displayName: `${tier} Model`,
		name: paramName,
		type: 'options',
		default: '',
		description: `Model for ${tier} tier. Only tool-supporting models are shown. Leave empty for default.`,
		displayOptions: {
			// 'openrouter' = pre-selector legacy saves (same pattern as ollamaModels).
			show: {
				authentication: ['claudeAgentSdkOpenRouterApi', 'openrouter'],
			},
		},
		typeOptions: {
			loadOptions: {
				routing: {
					request: {
						method: 'GET',
						url: '={{(() => { const base = String($credentials.baseUrl || $credentials.url || "https://openrouter.ai/api/v1").replace(/\\/$/, ""); return base.endsWith("/api") ? `${base}/v1/models` : `${base}/models`; })()}}',
					},
					output: {
						postReceive: [
							{ type: 'rootProperty', properties: { property: 'data' } },
							{
								type: 'filter',
								properties: {
									pass: "={{$responseItem.supported_parameters && $responseItem.supported_parameters.includes('tools')}}",
								},
							},
							{
								type: 'setKeyValue',
								properties: {
									name: '={{$responseItem.name}} ({{$responseItem.id}})',
									value: '={{$responseItem.id}}',
								},
							},
							{ type: 'sort', properties: { key: 'name' } },
						],
					},
				},
			},
		},
	};
}

export const openrouterModelProperties: INodeProperties[] = MODEL_TIERS.map(makeOpenRouterModelProperty);
