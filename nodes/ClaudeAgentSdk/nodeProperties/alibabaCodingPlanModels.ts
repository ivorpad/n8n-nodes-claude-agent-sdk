import type { INodeProperties } from 'n8n-workflow';

const ALIBABA_MODELS = [
	{ name: 'qwen3.5-plus (vision)', value: 'qwen3.5-plus' },
	{ name: 'kimi-k2.5 (vision)', value: 'kimi-k2.5' },
	{ name: 'glm-5', value: 'glm-5' },
	{ name: 'MiniMax-M2.5', value: 'MiniMax-M2.5' },
	{ name: 'qwen3-max-2026-01-23 (Pro)', value: 'qwen3-max-2026-01-23' },
	{ name: 'qwen3-coder-next (Pro)', value: 'qwen3-coder-next' },
	{ name: 'qwen3-coder-plus (Pro)', value: 'qwen3-coder-plus' },
	{ name: 'glm-4.7 (Pro)', value: 'glm-4.7' },
];

interface ModelTier {
	tier: string;
	paramName: string;
}

const MODEL_TIERS: ModelTier[] = [
	{ tier: 'Sonnet', paramName: 'alibabaSonnetModel' },
	{ tier: 'Opus', paramName: 'alibabaOpusModel' },
	{ tier: 'Haiku', paramName: 'alibabaHaikuModel' },
];

function makeAlibabaCodingPlanModelProperty({ tier, paramName }: ModelTier): INodeProperties {
	return {
		displayName: `${tier} Model`,
		name: paramName,
		type: 'options',
		default: '',
		options: [
			{ name: '(Default)', value: '' },
			...ALIBABA_MODELS,
		],
		description: `Model for ${tier} tier. Leave empty for default.`,
		displayOptions: {
			// 'alibaba' = pre-selector legacy saves (same pattern as ollamaModels).
			show: {
				authentication: ['alibabaCodingPlanApi', 'alibaba'],
			},
		},
	};
}

export const alibabaCodingPlanModelProperties: INodeProperties[] = MODEL_TIERS.map(makeAlibabaCodingPlanModelProperty);
