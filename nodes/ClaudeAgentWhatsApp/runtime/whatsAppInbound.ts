import { createHash } from 'node:crypto';

import { parseReplyToken } from '../../ClaudeAgentChannelShared/core/channelReplyContract';
import { asNonEmptyString } from './webhookRuntime';
import type { PendingWhatsAppHitlRecord } from '../types';

/**
 * WhatsApp Business Cloud inbound parsing + decision helpers.
 *
 * Extracted from `node/webhook.ts` so that file stays small enough to keep
 * adding the webhook-authentication gating without tripping the repo's
 * file-size guard. Pure functions only — no n8n I/O.
 */

function buildDecisionDigest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function buildDecisionId(requestId: string, decisionKey: string): string {
	return `${requestId}:${buildDecisionDigest(decisionKey).slice(0, 24)}`;
}

export function buildQuestionDecisionKey(
	answers: Record<string, string | string[]>,
	responseAction?: 'resume' | 'complete',
): string {
	const normalizedEntries = Object.entries(answers)
		.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
		.map(([key, value]) => [
			key,
			Array.isArray(value) ? [...value].map((entry) => String(entry)) : String(value),
		]);
	const payload = responseAction
		? { entries: normalizedEntries, responseAction }
		: normalizedEntries;
	return `question:${buildDecisionDigest(JSON.stringify(payload))}`;
}

export function normalizeRecipientId(phoneNumber: string): string {
	return phoneNumber.replace(/[\s\-()+]/g, '');
}

export interface ParsedWhatsAppInbound {
	requestId?: string;
	approved?: boolean;
	fingerprint?: string;
	senderId?: string;
	contextMessageId?: string;
	textAnswer?: string;
	selectedLabel?: string;
	selectedDescription?: string;
	questionIndex?: number;
	optionIndex?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function parseWhatsAppInbound(body: unknown): ParsedWhatsAppInbound {
	const payload = asRecord(body);
	if (!payload) return {};

	const entry = Array.isArray(payload.entry) ? asRecord(payload.entry[0]) : undefined;
	const change = entry && Array.isArray(entry.changes) ? asRecord(entry.changes[0]) : undefined;
	const value = change ? asRecord(change.value) : undefined;
	const message = value && Array.isArray(value.messages) ? asRecord(value.messages[0]) : undefined;
	if (!message) return {};

	const inbound: ParsedWhatsAppInbound = {
		senderId: asNonEmptyString(message.from),
		contextMessageId: asNonEmptyString(asRecord(message.context)?.id),
		textAnswer: asNonEmptyString(asRecord(message.text)?.body),
	};

	const interactive = asRecord(message.interactive);
	const interactiveType = asNonEmptyString(interactive?.type);
	if (interactiveType === 'button_reply') {
		const buttonReply = asRecord(interactive?.button_reply);
		const token = parseReplyToken(buttonReply?.id);
			if (token) {
				inbound.requestId = token.requestId;
				inbound.approved = token.approved;
				inbound.fingerprint = token.fingerprint;
				inbound.questionIndex = token.questionIndex;
				inbound.optionIndex = token.optionIndex;
			}
		inbound.selectedLabel = asNonEmptyString(buttonReply?.title);
	} else if (interactiveType === 'list_reply') {
		const listReply = asRecord(interactive?.list_reply);
		const token = parseReplyToken(listReply?.id);
			if (token) {
				inbound.requestId = token.requestId;
				inbound.fingerprint = token.fingerprint;
				inbound.questionIndex = token.questionIndex;
				inbound.optionIndex = token.optionIndex;
			}
		inbound.selectedLabel = asNonEmptyString(listReply?.title);
		inbound.selectedDescription = asNonEmptyString(listReply?.description);
	}

	const button = asRecord(message.button);
	if (!inbound.requestId) {
		const token = parseReplyToken(button?.payload);
			if (token) {
				inbound.requestId = token.requestId;
				inbound.approved = token.approved;
				inbound.fingerprint = token.fingerprint;
				inbound.questionIndex = token.questionIndex;
				inbound.optionIndex = token.optionIndex;
			}
	}
	if (!inbound.selectedLabel) {
		inbound.selectedLabel = asNonEmptyString(button?.text);
	}

	return inbound;
}

export function hasWhatsAppProviderPayload(body: unknown): boolean {
	const payload = asRecord(body);
	return Array.isArray(payload?.entry);
}

export function parseApprovalFromText(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return undefined;
	if (['approve', 'approved', 'yes', 'y', 'allow', 'ok'].includes(normalized)) return true;
	if (['deny', 'denied', 'no', 'n', 'reject', 'block'].includes(normalized)) return false;
	return undefined;
}

export function buildQuestionAnswersFromInbound(args: {
	pending?: PendingWhatsAppHitlRecord;
	inbound: ParsedWhatsAppInbound;
}): Record<string, string | string[]> {
	const { pending, inbound } = args;
	if (!pending?.questions || pending.questions.length === 0) return {};

	const questionIndex = inbound.questionIndex ?? 0;
	const question = pending.questions[questionIndex];
	if (!question) return {};

	const answers: Record<string, string> = {};
	const questionText = question.question;

	if (
		typeof inbound.optionIndex === 'number'
		&& Array.isArray(question.options)
		&& question.options[inbound.optionIndex]
	) {
		answers[questionText] = question.options[inbound.optionIndex].label;
		return answers;
	}

	if (inbound.selectedLabel && Array.isArray(question.options) && question.options.length > 0) {
		const matched = question.options.find((option) => option.label === inbound.selectedLabel);
		if (matched) {
			answers[questionText] = matched.label;
			return answers;
		}
	}

	if (inbound.textAnswer) {
		answers[questionText] = inbound.textAnswer;
	}

	return answers;
}

export function buildFallbackApprovalPendingRecord(args: {
	requestId: string;
	sessionId?: string;
	approvedFingerprints?: string;
	fingerprint?: string;
	recipientId?: string;
	providerMessageId?: string;
}): PendingWhatsAppHitlRecord {
	return {
		requestId: args.requestId,
		kind: 'approval',
		status: 'pending',
		createdAt: Date.now(),
		timeoutMs: 0,
		sessionId: args.sessionId,
		approvedFingerprints: args.approvedFingerprints,
		fingerprint: args.fingerprint,
		channel: 'whatsapp',
		recipientId: args.recipientId,
		providerMessageId: args.providerMessageId,
	};
}

export function buildFallbackQuestionPendingRecord(args: {
	requestId: string;
	sessionId?: string;
	approvedFingerprints?: string;
	questions: PendingWhatsAppHitlRecord['questions'];
	message?: string;
	recipientId?: string;
	providerMessageId?: string;
}): PendingWhatsAppHitlRecord {
	return {
		requestId: args.requestId,
		kind: 'question',
		status: 'pending',
		createdAt: Date.now(),
		timeoutMs: 0,
		sessionId: args.sessionId,
		approvedFingerprints: args.approvedFingerprints,
		questions: args.questions,
		message: args.message,
		channel: 'whatsapp',
		recipientId: args.recipientId,
		providerMessageId: args.providerMessageId,
	};
}
