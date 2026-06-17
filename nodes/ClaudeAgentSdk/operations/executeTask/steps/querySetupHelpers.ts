import { ApplicationError } from 'n8n-workflow';

export const ALIBABA_MAX_THINKING_BUDGET_TOKENS = 38912;

export function parseCommaSeparatedNames(value: string | undefined): string[] | undefined {
	if (!value || value.trim() === '') return undefined;
	const names = value
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);
	return names.length > 0 ? names : undefined;
}

export function parseClaudeCodePromptSections(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
	}
	return [];
}

function sanitizePathSegment(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return 'default';
	const sanitized = trimmed
		.replace(/\\/g, '-')
		.replace(/\//g, '-')
		.replace(/:/g, '-')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
	return sanitized || 'default';
}

export function resolveIsolatedClaudeConfigDir(args: {
	isolate: boolean | undefined;
	mode: 'perWorkflow' | 'perSession' | undefined;
	workingDirectory: string;
	workflowId: string;
	chatSessionId: string;
	resumeSessionId?: string;
	itemIndex: number;
}): string | undefined {
	const { isolate, mode, workingDirectory, workflowId, chatSessionId, resumeSessionId, itemIndex } = args;
	if (!isolate) return undefined;
	if (!workingDirectory) return undefined;

	const basePath = `${workingDirectory}/.claude-n8n/${sanitizePathSegment(workflowId)}`;
	if (mode === 'perSession') {
		const sessionKey = sanitizePathSegment(resumeSessionId || chatSessionId || `item-${itemIndex}`);
		return `${basePath}/${sessionKey}`;
	}
	return basePath;
}

export function parseSkillsFilter(value: string | undefined): string[] | 'all' | undefined {
	if (!value || value.trim() === '') return undefined;
	const trimmed = value.trim();
	if (trimmed.toLowerCase() === 'all') return 'all';
	const names = trimmed.split(',').map((name) => name.trim()).filter(Boolean);
	return names.length > 0 ? names : undefined;
}

export function parseManagedSettings(value: string | undefined): Record<string, unknown> | undefined {
	if (!value || value.trim() === '') return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new ApplicationError(`Invalid JSON in Managed Settings: ${error}`);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new ApplicationError('Managed Settings must be a JSON object');
	}
	return parsed as Record<string, unknown>;
}
