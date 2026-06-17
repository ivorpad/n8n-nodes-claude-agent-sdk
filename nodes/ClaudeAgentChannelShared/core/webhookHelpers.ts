import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import type { HitlQuestionDefinition } from '../../ClaudeAgentSdk/hitl/contract';
import type { PendingCompanionHitlRecord } from './types';

export function buildWorkflowData(payload: IDataObject): INodeExecutionData[][] {
	return [[{ json: payload }]];
}

export function buildFallbackApprovalPendingRecord(args: {
	requestId: string;
	sessionId?: string;
	approvedFingerprints?: string;
	fingerprint?: string;
	channel: string;
}): PendingCompanionHitlRecord {
	return {
		requestId: args.requestId,
		kind: 'approval',
		status: 'pending',
		createdAt: Date.now(),
		timeoutMs: 0,
		sessionId: args.sessionId,
		approvedFingerprints: args.approvedFingerprints,
		fingerprint: args.fingerprint,
		channel: args.channel,
	};
}

export function buildFallbackQuestionPendingRecord(args: {
	requestId: string;
	sessionId?: string;
	approvedFingerprints?: string;
	questions?: HitlQuestionDefinition[];
	message?: string;
	channel: string;
}): PendingCompanionHitlRecord {
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
		channel: args.channel,
	};
}

export function resolveQuestionAnswer(
	pending: { questions?: HitlQuestionDefinition[] } | undefined,
	questionIndex: number,
	optionIndex: number,
): { question: string; answer: string; responseAction: 'resume' | 'complete' } | undefined {
	const question = pending?.questions?.[questionIndex];
	if (!question) return undefined;
	const options = Array.isArray(question.options) ? question.options : [];
	const option = options[optionIndex];
	if (!option) return undefined;
	return {
		question: question.question,
		answer: option.label,
		responseAction: option.action === 'complete' ? 'complete' : 'resume',
	};
}

export function normalizeAnswersForDecision(
	answers: Record<string, string | string[]>,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(answers)) {
		if (Array.isArray(value)) {
			normalized[key] = value.map((entry) => String(entry)).join(', ');
		} else {
			normalized[key] = String(value);
		}
	}
	return normalized;
}
