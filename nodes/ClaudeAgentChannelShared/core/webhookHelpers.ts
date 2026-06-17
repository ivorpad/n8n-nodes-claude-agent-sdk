import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import type { HitlQuestionDefinition } from '../../ClaudeAgentSdk/hitl/contract';
import type { PendingCompanionHitlRecord } from './types';

export function buildWorkflowData(payload: IDataObject): INodeExecutionData[][] {
	return [[{ json: payload }]];
}

/**
 * Trust boundary for HITL companion resume.
 *
 * A fallback record exists precisely BECAUSE there is no persisted interaction
 * for this requestId. The companion resume URL is delivered out-of-band (email,
 * chat) and n8n's resume token signs only the execution + node path, NOT the
 * query string — so `?sid=&afps=&fp=` are attacker-controllable by anyone who
 * holds the URL. Folding them into the record would let a forged URL approve an
 * arbitrary tool fingerprint or hijack a session on resume.
 *
 * These builders therefore carry ONLY non-authorizing fields (requestId,
 * channel, and the question/message text needed to render a form). Every
 * security-relevant resume field is left undefined — the safe-empty posture,
 * matching the SDK node's record-only `fromRecord()`. Legitimate session /
 * fingerprint restore across a restart requires the persisted Postgres pending
 * store, not the query string. See buildChannelResumeFields below for the
 * single record-only source of those fields.
 */
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
		questions: args.questions,
		message: args.message,
		channel: args.channel,
	};
}

/**
 * Resolve the security-relevant resume fields for a channel HITL response from
 * the PERSISTED record ONLY (never the unsigned query string). When no record
 * exists these are all undefined — the correct, safe posture: a request that
 * arrives with no stored interaction cannot carry authority via the URL.
 *
 * NOTE: provider-button channels (Slack/Discord/Telegram) additionally hold a
 * provider-signature-verified `token.fingerprint`; those verified branches may
 * prefer the verified token value over `fingerprint` here. The unsigned query
 * path must use this helper's record-only values exclusively.
 */
export function buildChannelResumeFields(record: PendingCompanionHitlRecord | undefined): {
	resumeSessionId?: string;
	approvedFingerprints?: string;
	fingerprint?: string;
} {
	return {
		resumeSessionId: record?.sessionId,
		approvedFingerprints: record?.approvedFingerprints,
		fingerprint: record?.kind === 'approval' ? record.fingerprint : undefined,
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
