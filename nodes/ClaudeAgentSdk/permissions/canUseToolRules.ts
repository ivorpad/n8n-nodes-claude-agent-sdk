/**
 * Pure helpers for the canUseTool callback: permission-rule evaluation and
 * AskUserQuestion input/answer normalization.
 */

import type { HitlQuestionDefinition } from '../hitl/contractTypes';
import type { PermissionsConfig, PreToolUseHookInput, PermissionCheckResult } from './types';
import { evaluatePermissionDecision } from './evaluatePermission';
import { checkContentFilter } from './ContentFilter';
import { isFreeTextQuestion } from '../hitl/questionPolicy';

// ─────────────────────────────────────────────────────────────────────────────
// Permission Check Helper
// ─────────────────────────────────────────────────────────────────────────────

export function checkPermissionRules(
	toolName: string,
	toolInput: Record<string, unknown>,
	permissionsConfig: PermissionsConfig,
	allowedTools: string[],
	blockedTools: string[],
	cwd = '.',
): PermissionCheckResult {
	const hookInput: PreToolUseHookInput = {
		session_id: '',
		transcript_path: '',
		cwd: cwd || '.',
		hook_event_name: 'PreToolUse',
		tool_name: toolName,
		tool_input: toolInput,
		tool_use_id: '',
	};

	// Core chain: blocked → path sandbox → tool permissions
	const coreResult = evaluatePermissionDecision(hookInput, permissionsConfig, blockedTools);

	if (coreResult.decision === 'deny') {
		return coreResult;
	}

	// Content filter check (mirrors hook path so canUseTool cannot bypass it)
	if (permissionsConfig.contentFilter?.enabled) {
		const contentResult = checkContentFilter(hookInput, permissionsConfig.contentFilter);
		if (contentResult.blocked) {
			return {
				decision: 'deny',
				reason: contentResult.reason || 'Content is blocked by filter',
				context: { source: 'contentFilter', matchedRule: contentResult.matchedRule },
			};
		}
	}

	// If tool permissions were enabled, they made an explicit decision
	if (permissionsConfig.toolPermissions?.enabled) {
		return coreResult;
	}

	// Tool permissions not enabled — apply allowedTools list fallback
	if (allowedTools.includes(toolName)) {
		return {
			decision: 'allow',
			reason: `Tool "${toolName}" is in allowed tools list`,
		};
	}

	// Default: ask for approval
	return {
		decision: 'ask',
		reason: `Tool "${toolName}" requires user approval`,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// AskUserQuestion Input Interface
// ─────────────────────────────────────────────────────────────────────────────

export type AskUserQuestionArray = HitlQuestionDefinition[];

export function isAskUserQuestionInput(input: Record<string, unknown>): input is { questions: AskUserQuestionArray } {
	return (
		Array.isArray(input.questions) &&
		input.questions.length > 0 &&
		input.questions.every(
			(q: unknown) =>
				typeof q === 'object' &&
				q !== null &&
				'question' in q &&
				typeof (q as Record<string, unknown>).question === 'string',
		)
	);
}

export function normalizeAnswerValue(value: string | string[] | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) {
		const joined = value
			.map((entry) => String(entry).trim())
			.filter((entry) => entry.length > 0)
			.join(', ');
		return joined.length > 0 ? joined : undefined;
	}
	const normalized = String(value).trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizeAnswerLookupKey(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}

export function isAnswerCompatibleWithQuestion(question: AskUserQuestionArray[number], answer: string): boolean {
	const options = Array.isArray(question.options) ? question.options : [];
	if (options.length === 0 || isFreeTextQuestion(question)) return true;

	const optionLabels = new Set(
		options
			.map((option) => normalizeAnswerLookupKey(option.label))
			.filter((label): label is string => Boolean(label)),
	);
	if (optionLabels.size === 0) return true;

	if (question.multiSelect) {
		const selections = answer
			.split(',')
			.map((selection) => normalizeAnswerLookupKey(selection))
			.filter((selection): selection is string => Boolean(selection));
		if (selections.length === 0) return false;
		return selections.every((selection) => optionLabels.has(selection));
	}

	const normalizedAnswer = normalizeAnswerLookupKey(answer);
	return normalizedAnswer ? optionLabels.has(normalizedAnswer) : false;
}

export function resolveQueuedAnswerForQuestion(args: {
	queuedAnswers: Record<string, string | string[]>;
	queuedAnswerLookup: Map<string, string | string[]>;
	question: AskUserQuestionArray[number];
	questionIndex: number;
}): string | string[] | undefined {
	const {
		queuedAnswers,
		queuedAnswerLookup,
		question,
		questionIndex,
	} = args;

	const candidateKeys = [
		question.question,
		question.header,
		`${question.header}: ${question.question}`,
	];

	for (const key of candidateKeys) {
		const normalizedKey = normalizeAnswerLookupKey(key);
		if (normalizedKey && queuedAnswerLookup.has(normalizedKey)) {
			return queuedAnswerLookup.get(normalizedKey);
		}
	}

	const indexedFieldKey = `field-${questionIndex}`;
	if (indexedFieldKey in queuedAnswers) {
		return queuedAnswers[indexedFieldKey];
	}

	return undefined;
}
