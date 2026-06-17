import { createHash } from 'node:crypto';

import type { HitlQuestionDefinition } from '../../ClaudeAgentSdk/hitl/contract';

export const CHANNEL_REPLY_CONTRACT_VERSION = '1.0' as const;

type ChannelReplyProvider =
	| 'whatsapp'
	| 'slack'
	| 'telegram'
	| 'email'
	| 'gmail'
	| 'discord'
	| 'webhook';

type ChannelReplyInteractionKind = 'approval' | 'question';
type ChannelReplyDecisionType = 'approve' | 'deny' | 'answers';

interface ChannelReplyResumeContext {
	sessionId: string;
	resumeSessionAt?: string;
	approvedFingerprints?: string;
	fingerprint?: string;
}

interface ChannelReplyRoutingContext {
	recipientId: string;
	providerConversationId?: string;
	providerMessageId?: string;
	templateName?: string;
	templateLocale?: string;
	providerMetadata?: Record<string, string>;
}

interface ChannelReplyPendingEnvelope {
	version: typeof CHANNEL_REPLY_CONTRACT_VERSION;
	requestId: string;
	kind: ChannelReplyInteractionKind;
	channel: ChannelReplyProvider;
	createdAt: string;
	message?: string;
	questions?: HitlQuestionDefinition[];
	resume: ChannelReplyResumeContext;
	routing: ChannelReplyRoutingContext;
}interface QuestionSelection {
	question: string;
	selectedLabels?: string[];
	freeText?: string;
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function hashText(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) {
		return '[' + value.map(canonicalJson).join(',') + ']';
	}
	const sorted = Object.keys(value as Record<string, unknown>).sort();
	const entries = sorted
		.filter((k) => (value as Record<string, unknown>)[k] !== undefined)
		.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
	return '{' + entries.join(',') + '}';
}

type NormalizedQuestionAnswerValue = string | string[];

function normalizeAnswerValue(value: string | string[]): NormalizedQuestionAnswerValue | undefined {
	if (Array.isArray(value)) {
		const normalized = value
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		return normalized.length > 0 ? normalized : undefined;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizedAnswerEntries(
	answers: Record<string, string | string[]>,
): Array<[string, NormalizedQuestionAnswerValue]> {
	return Object.entries(answers)
		.map(([key, value]) => [key.trim(), normalizeAnswerValue(value)] as const)
		.filter(
			(entry): entry is [string, NormalizedQuestionAnswerValue] =>
				entry[0].length > 0 && entry[1] !== undefined,
		)
		.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

export function buildQuestionAnswersFromSelections(
	selections: QuestionSelection[],
): Record<string, string> {
	const answers: Record<string, string> = {};
	for (const selection of selections) {
		const question = asNonEmptyString(selection.question);
		if (!question) continue;

		const labels = Array.isArray(selection.selectedLabels)
			? selection.selectedLabels
				.map((label) => label.trim())
				.filter((label) => label.length > 0)
			: [];

		const freeText = asNonEmptyString(selection.freeText);
		const value = labels.length > 0 ? labels.join(', ') : freeText;
		if (value) {
			answers[question] = value;
		}
	}
	return answers;
}

export function buildChannelReplyDecisionKey(args: {
	kind: ChannelReplyInteractionKind;
	decisionType: ChannelReplyDecisionType;
	approved?: boolean;
	answers?: Record<string, string | string[]>;
	responseAction?: 'resume' | 'complete';
	reviewerMessage?: string;
	updatedInput?: Record<string, unknown>;
}): string {
	if (args.kind === 'approval') {
		const approved =
			typeof args.approved === 'boolean'
				? args.approved
				: args.decisionType === 'approve';
		const base = `approval:${approved ? 'approved' : 'denied'}`;
		// Include reviewer message and updatedInput in the key so that
		// semantically different approval replies are not treated as duplicates.
		const extras: string[] = [];
		if (args.reviewerMessage) {
			extras.push(`msg:${hashText(args.reviewerMessage)}`);
		}
		if (args.updatedInput) {
			extras.push(`input:${hashText(canonicalJson(args.updatedInput))}`);
		}
		return extras.length > 0 ? `${base}:${extras.join(':')}` : base;
	}

	const entries = normalizedAnswerEntries(args.answers ?? {});
	if (!args.responseAction) {
		return `question:${hashText(JSON.stringify(entries))}`;
	}

	return `question:${hashText(JSON.stringify({
		entries,
		responseAction: args.responseAction,
	}))}`;
}

export function buildChannelReplyDecisionId(
	requestId: string,
	decisionKey: string,
): string {
	return `${requestId}:${hashText(decisionKey).slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Deterministic HITL reply tokens (shared across WhatsApp, Telegram, Slack, Discord)
// ---------------------------------------------------------------------------

export function buildApprovalReplyToken(
	requestId: string,
	approved: boolean,
	fingerprint?: string,
): string {
	const action = approved ? 'approve' : 'deny';
	const normalizedFingerprint =
		typeof fingerprint === 'string' && fingerprint.trim().length > 0
			? fingerprint.trim()
			: undefined;
	return normalizedFingerprint
		? `hitl|${action}|${requestId}|${normalizedFingerprint}`
		: `hitl|${action}|${requestId}`;
}

export function buildQuestionReplyToken(
	requestId: string,
	questionIndex: number,
	optionIndex: number,
): string {
	return `hitl|q|${requestId}|${questionIndex}|${optionIndex}`;
}

interface ParsedReplyToken {
	requestId: string;
	approved?: boolean;
	fingerprint?: string;
	questionIndex?: number;
	optionIndex?: number;
}

export function parseReplyToken(value: unknown): ParsedReplyToken | undefined {
	if (typeof value !== 'string' || value.trim().length === 0) return undefined;
	const token = value.trim();
	const parts = token.split('|');
	if (parts.length < 3 || parts[0] !== 'hitl') return undefined;

	if (parts[1] === 'approve') {
		return {
			requestId: parts[2],
			approved: true,
			fingerprint: asNonEmptyString(parts[3]),
		};
	}

	if (parts[1] === 'deny') {
		return {
			requestId: parts[2],
			approved: false,
			fingerprint: asNonEmptyString(parts[3]),
		};
	}

	if (parts[1] === 'q' && parts.length >= 5) {
		const questionIndex = Number(parts[3]);
		const optionIndex = Number(parts[4]);
		if (!Number.isInteger(questionIndex) || questionIndex < 0) return undefined;
		if (!Number.isInteger(optionIndex) || optionIndex < 0) return undefined;
		return {
			requestId: parts[2],
			questionIndex,
			optionIndex,
		};
	}

	return undefined;
}

// ---------------------------------------------------------------------------

export function buildChannelReplyPendingEnvelope(args: {
	requestId: string;
	kind: ChannelReplyInteractionKind;
	channel: ChannelReplyProvider;
	resume: ChannelReplyResumeContext;
	routing: ChannelReplyRoutingContext;
	message?: string;
	questions?: HitlQuestionDefinition[];
	createdAt?: string;
}): ChannelReplyPendingEnvelope {
	return {
		version: CHANNEL_REPLY_CONTRACT_VERSION,
		requestId: args.requestId.trim(),
		kind: args.kind,
		channel: args.channel,
		createdAt: args.createdAt ?? new Date().toISOString(),
		message: asNonEmptyString(args.message),
		questions: Array.isArray(args.questions) ? args.questions : undefined,
		resume: {
			sessionId: args.resume.sessionId.trim(),
			resumeSessionAt: asNonEmptyString(args.resume.resumeSessionAt),
			approvedFingerprints: asNonEmptyString(args.resume.approvedFingerprints),
			fingerprint: asNonEmptyString(args.resume.fingerprint),
		},
		routing: {
			recipientId: args.routing.recipientId.trim(),
			providerConversationId: asNonEmptyString(args.routing.providerConversationId),
			providerMessageId: asNonEmptyString(args.routing.providerMessageId),
			templateName: asNonEmptyString(args.routing.templateName),
			templateLocale: asNonEmptyString(args.routing.templateLocale),
			providerMetadata: args.routing.providerMetadata,
		},
	};
}
