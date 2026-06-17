import type { HitlQuestionDefinition } from '../../ClaudeAgentSdk/hitl/contract';

interface QuestionFormDefinition {
	question: string;
	header: string;
	options: Array<{
		label: string;
		description: string;
		action?: 'resume' | 'complete';
	}>;
	multiSelect: boolean;
}

export function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseApprovalDecision(value: unknown): boolean | undefined {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return undefined;
}

export function parseQuestionsFromQuery(value: unknown): HitlQuestionDefinition[] {
	if (typeof value !== 'string' || value.trim().length === 0) return [];

	try {
		const decoded = Buffer.from(value, 'base64').toString('utf-8');
		const parsed = JSON.parse(decoded);
		if (!Array.isArray(parsed)) return [];
		return parsed as HitlQuestionDefinition[];
	} catch {
		return [];
	}
}

export function toQuestionFormDefinition(
	questions: HitlQuestionDefinition[],
): QuestionFormDefinition[] {
	return questions.map((question) => ({
		question: question.question,
		header: question.header || question.question,
		options: (question.options || []).map((option) => ({
			label: option.label,
			description: option.description || '',
		})),
		multiSelect: question.multiSelect === true,
	}));
}

export function normalizeRawAnswers(
	input: Record<string, unknown>,
): Record<string, string | string[]> {
	const answers: Record<string, string | string[]> = {};

	for (const [key, value] of Object.entries(input)) {
		if (key === 'requestId' || key === 'type' || key === 'approved') continue;
		if (value == null) continue;

		if (Array.isArray(value)) {
			const normalized = value
				.map((item) => String(item).trim())
				.filter((item) => item.length > 0);
			if (normalized.length > 0) {
				answers[key] = normalized;
			}
			continue;
		}

		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			const normalized = String(value).trim();
			if (normalized.length > 0) {
				answers[key] = normalized;
			}
		}
	}

	return answers;
}
