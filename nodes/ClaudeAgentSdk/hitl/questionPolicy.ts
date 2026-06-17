import type {
	HitlQuestionDefinition,
	HitlQuestionOption,
} from './contract';

type HitlAnswerMap = Record<string, string | string[]>;

const HITL_FREE_TEXT_OPTION_VALUES = [
	'__free_text__',
	'__free_text_alt__',
] as const;

function normalizeLookupValue(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}

export function isFreeTextQuestion(question: HitlQuestionDefinition): boolean {
	if (!Array.isArray(question.options) || question.options.length !== 2) {
		return false;
	}

	const expected = new Set(HITL_FREE_TEXT_OPTION_VALUES);
	const values = question.options
		.map((option) => normalizeLookupValue(option.value))
		.filter((value): value is string => Boolean(value));

	return values.length === 2 && values.every((value) => expected.has(value as typeof HITL_FREE_TEXT_OPTION_VALUES[number]));
}

function normalizeQuestionResponseAction(
	value: unknown,
): 'resume' | 'complete' | undefined {
	if (value === 'complete') {
		return 'complete';
	}
	if (value === 'resume') {
		return 'resume';
	}
	return undefined;
}

function splitSelections(raw: string | string[] | undefined, multiSelect: boolean): string[] {
	if (raw === undefined) {
		return [];
	}

	if (Array.isArray(raw)) {
		return raw
			.map((entry) => String(entry).trim())
			.filter((entry) => entry.length > 0);
	}

	const text = String(raw).trim();
	if (text.length === 0) {
		return [];
	}

	if (!multiSelect || !text.includes(',')) {
		return [text];
	}

	return text
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function buildQuestionLookupKeys(
	question: HitlQuestionDefinition,
	index: number,
): string[] {
	const keys = new Set<string>([`field-${index}`]);
	const candidateValues = [
		question.header,
		question.question,
		question.header ? `${question.header}: ${question.question}` : undefined,
	];

	for (const candidate of candidateValues) {
		const trimmed = candidate?.trim();
		if (!trimmed) {
			continue;
		}

		keys.add(trimmed);
		keys.add(`field-${trimmed}`);
	}

	return [...keys];
}

function resolveAnswerForQuestion(args: {
	answers: HitlAnswerMap;
	question: HitlQuestionDefinition;
	questionIndex: number;
}): string | string[] | undefined {
	const { answers, question, questionIndex } = args;
	for (const key of buildQuestionLookupKeys(question, questionIndex)) {
		if (answers[key] !== undefined) {
			return answers[key];
		}
	}
	return undefined;
}

function findOptionBySelection(args: {
	question: HitlQuestionDefinition;
	selection: string;
}): HitlQuestionOption | undefined {
	const { question, selection } = args;
	const normalizedSelection = normalizeLookupValue(selection);
	if (!normalizedSelection) {
		return undefined;
	}

	return question.options?.find((option) => {
		const normalizedLabel = normalizeLookupValue(option.label);
		const normalizedValue = normalizeLookupValue(option.value);
		return normalizedSelection === normalizedLabel || normalizedSelection === normalizedValue;
	});
}

export function canonicalizeHitlQuestions(
	questions: HitlQuestionDefinition[],
): HitlQuestionDefinition[] {
	return questions.map((question, questionIndex) => ({
		...question,
		options: question.options?.map((option, optionIndex) => ({
			...option,
			value: option.value?.trim() || `q${questionIndex}o${optionIndex}`,
			action: option.action === 'complete' ? 'complete' : option.action === 'resume' ? 'resume' : undefined,
		})),
	}));
}

export function mapSelectionsToQuestionLabels(args: {
	question: HitlQuestionDefinition;
	selectionValue: string | string[] | undefined;
}): string[] {
	const { question, selectionValue } = args;
	const selections = splitSelections(selectionValue, question.multiSelect ?? false);
	if (!Array.isArray(question.options) || question.options.length === 0 || isFreeTextQuestion(question)) {
		return selections;
	}

	return selections
		.map((selection) => findOptionBySelection({ question, selection })?.label ?? selection)
		.filter((selection) => selection.trim().length > 0);
}

function deriveQuestionResponseActionFromQuestions(args: {
	questions: HitlQuestionDefinition[];
	answers: HitlAnswerMap;
}): 'resume' | 'complete' | undefined {
	const { questions, answers } = args;
	let sawResume = false;
	let sawComplete = false;

	for (const [questionIndex, question] of questions.entries()) {
		const rawAnswer = resolveAnswerForQuestion({
			answers,
			question,
			questionIndex,
		});
		const selections = splitSelections(rawAnswer, question.multiSelect ?? false);

		for (const selection of selections) {
			const matchedOption = findOptionBySelection({ question, selection });
			if (matchedOption?.action === 'resume') {
				sawResume = true;
			}
			if (matchedOption?.action === 'complete') {
				sawComplete = true;
			}
		}
	}

	if (sawResume) {
		return 'resume';
	}

	if (sawComplete) {
		return 'complete';
	}

	return undefined;
}

export function resolveQuestionResponseAction(args: {
	questions?: HitlQuestionDefinition[];
	answers: HitlAnswerMap;
	explicitResponseAction?: unknown;
}): 'resume' | 'complete' | undefined {
	const questions = Array.isArray(args.questions) ? args.questions : [];
	if (questions.length > 0) {
		const derived = deriveQuestionResponseActionFromQuestions({
			questions,
			answers: args.answers,
		});
		if (derived) {
			return derived;
		}
	}

	const explicit = normalizeQuestionResponseAction(args.explicitResponseAction);
	if (explicit) {
		return explicit;
	}

	return Object.keys(args.answers).length > 0 ? 'resume' : undefined;
}
