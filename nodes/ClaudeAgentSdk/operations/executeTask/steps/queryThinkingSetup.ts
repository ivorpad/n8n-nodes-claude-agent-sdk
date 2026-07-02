/**
 * Thinking/effort resolution for query setup. Split out of
 * querySetupParts.ts (file-size guard).
 */

import type { IExecuteFunctions } from 'n8n-workflow';

import { isAdaptiveThinkingModel, isFableModel } from '../../../claudeModels';
import { ALIBABA_MAX_THINKING_BUDGET_TOKENS } from './querySetupHelpers';
import {
	readNumberParameter,
	readStringParameter,
	readTrimmedString,
} from './querySetupContext';
import type { QuerySetupContext, ThinkingSetup } from './querySetupTypes';
import type { EffortLevel } from '../../../sdk/types';
import { debugWarn } from '../../../diagnostics';

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[];

function parseEffortLevel(value: string | undefined): EffortLevel | undefined {
	return value && (EFFORT_LEVELS as readonly string[]).includes(value)
		? (value as EffortLevel)
		: undefined;
}

function buildStandardThinkingSetup(args: {
	thinkingMode: string;
	thinkingBudgetTokens: number;
	legacyMaxThinkingTokens: number;
	model: string;
	effort?: EffortLevel;
}): ThinkingSetup {
	if (isAdaptiveThinkingModel(args.model)) {
		if (args.thinkingMode === 'disabled') {
			// Fable 5 rejects an explicit thinking disable with HTTP 400 — the
			// supported "no thinking" path is omitting the field entirely.
			if (isFableModel(args.model)) {
				return { legacyThinkingTokens: 0, effort: args.effort };
			}
			return {
				thinking: { type: 'disabled' },
				legacyThinkingTokens: 0,
				effort: args.effort,
			};
		}
		if (
			(args.thinkingMode === 'enabled' && args.thinkingBudgetTokens > 0) ||
			args.legacyMaxThinkingTokens > 0
		) {
			debugWarn(
				'[Claude Agent SDK] Fixed thinking budgets are not supported on Sonnet 5 / Fable 5 / Opus 4.7+. Using adaptive thinking and effort instead.',
			);
		}
		return {
			thinking: { type: 'adaptive' },
			legacyThinkingTokens: 0,
			effort: args.effort,
		};
	}

	if (args.thinkingMode === 'adaptive') {
		return {
			thinking: { type: 'adaptive' },
			legacyThinkingTokens: args.legacyMaxThinkingTokens,
			effort: args.effort,
		};
	}
	if (args.thinkingMode === 'disabled') {
		return {
			thinking: { type: 'disabled' },
			legacyThinkingTokens: args.legacyMaxThinkingTokens,
			effort: args.effort,
		};
	}
	if (args.thinkingMode === 'enabled' && args.thinkingBudgetTokens > 0) {
		return {
			thinking: { type: 'enabled', budgetTokens: args.thinkingBudgetTokens },
			legacyThinkingTokens: args.legacyMaxThinkingTokens,
			effort: args.effort,
		};
	}
	return { legacyThinkingTokens: args.legacyMaxThinkingTokens, effort: args.effort };
}

function buildAlibabaThinkingSetup(args: {
	thinkingMode: string;
	thinkingBudgetTokens: number;
	legacyMaxThinkingTokens: number;
}): ThinkingSetup {
	const requestedBudget =
		args.thinkingMode === 'enabled'
			? args.thinkingBudgetTokens
			: args.legacyMaxThinkingTokens > 0
				? args.legacyMaxThinkingTokens
				: undefined;

	if (
		typeof requestedBudget !== 'number' ||
		!Number.isFinite(requestedBudget) ||
		requestedBudget <= 0
	) {
		return { thinking: { type: 'disabled' }, legacyThinkingTokens: 0 };
	}

	const normalizedBudget = Math.max(
		1,
		Math.min(ALIBABA_MAX_THINKING_BUDGET_TOKENS, Math.floor(requestedBudget)),
	);
	if (normalizedBudget !== Math.floor(requestedBudget)) {
		debugWarn(
			`[Claude Agent SDK] Alibaba thinking budget ${requestedBudget} adjusted to ${normalizedBudget} (allowed range: 1-${ALIBABA_MAX_THINKING_BUDGET_TOKENS}).`,
		);
	}
	return {
		thinking: { type: 'enabled', budgetTokens: normalizedBudget },
		legacyThinkingTokens: 0,
	};
}

export function buildThinkingSetup(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	context: QuerySetupContext;
}): ThinkingSetup {
	const thinkingMode = readStringParameter(
		args.execFunctions,
		args.itemIndex,
		'thinkingMode',
		'default',
	);
	const thinkingBudgetTokens = readNumberParameter(
		args.execFunctions,
		args.itemIndex,
		'thinkingBudgetTokens',
		0,
	);
	const legacyMaxThinkingTokens = args.context.additionalOptions.maxThinkingTokens ?? 0;
	const effort = parseEffortLevel(
		readTrimmedString(args.execFunctions.getNodeParameter('effort', args.itemIndex, '')),
	);

	if (args.context.apiProvider === 'alibaba') {
		return buildAlibabaThinkingSetup({
			thinkingMode,
			thinkingBudgetTokens,
			legacyMaxThinkingTokens,
		});
	}

	return buildStandardThinkingSetup({
		thinkingMode,
		thinkingBudgetTokens,
		legacyMaxThinkingTokens,
		model: args.context.model,
		effort,
	});
}
