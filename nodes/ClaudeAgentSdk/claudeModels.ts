import type { INodePropertyOptions } from 'n8n-workflow';

// Anthropic's current API lineup (July 2026): Sonnet 5 is the default Sonnet
// tier and has native 1M context. The picker lists explicit IDs only — tier
// aliases (opus/sonnet/haiku) were dropped because they duplicated these
// entries on the Anthropic provider, while non-Anthropic providers route
// through their own per-tier override dropdowns. Alias values saved in older
// workflows still execute (the CLI resolves them) and keep their reasoning
// fields via the constants below.
export const CURRENT_CLAUDE_MODEL_OPTIONS = [
	{ name: 'Default', value: '', description: 'Provider default model' },
	{
		name: 'Claude Sonnet 5',
		value: 'claude-sonnet-5',
		description: 'Default Sonnet tier with native 1M context',
	},
	{
		name: 'Claude Fable 5',
		value: 'claude-fable-5',
		description: 'Most powerful model — frontier tier above Opus',
	},
	{ name: 'Claude Opus 4.8', value: 'claude-opus-4-8' },
	{ name: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
	{ name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
] satisfies INodePropertyOptions[];

// Fable 5 rejects an explicit thinking disable (HTTP 400) — the supported
// "no thinking" path is omitting the thinking field entirely.
const FABLE_MODELS = ['fable', 'claude-fable-5'] as const;

// Models whose reasoning controls follow the adaptive-thinking path
// (fixed budgets removed). Tier aliases stay listed so workflows saved
// before the picker consolidation keep their reasoning fields visible.
export const ADAPTIVE_THINKING_MODELS = [
	...FABLE_MODELS,
	'sonnet',
	'claude-sonnet-5',
	'opus',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'claude-opus-4-6',
] as const;

export const OPUS_FAST_MODE_MODELS = [
	'opus',
	'claude-opus-4-8',
	'claude-opus-4-7',
] as const;

const FAST_MODE_BETA = 'fast-mode-2026-02-01';

function normalizeModel(model: string | undefined): string {
	return (model ?? '').trim().toLowerCase();
}

export function isAdaptiveThinkingModel(model: string | undefined): boolean {
	const normalized = normalizeModel(model);

	return ADAPTIVE_THINKING_MODELS.some((candidate) => candidate === normalized);
}

export function isFableModel(model: string | undefined): boolean {
	const normalized = normalizeModel(model);

	return FABLE_MODELS.some((candidate) => candidate === normalized);
}

export function supportsOpusFastMode(model: string | undefined): boolean {
	const normalized = normalizeModel(model);

	return OPUS_FAST_MODE_MODELS.some((candidate) => candidate === normalized);
}

export function addFastModeBeta(betas: string[]): string[] {
	return betas.includes(FAST_MODE_BETA) ? betas : [...betas, FAST_MODE_BETA];
}
