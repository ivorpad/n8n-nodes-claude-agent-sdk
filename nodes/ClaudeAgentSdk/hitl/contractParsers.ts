import { ApplicationError } from 'n8n-workflow';

import {
	HITL_CONTRACT_VERSION,
	type HitlApprovalRequestEnvelope,
	type HitlQuestionDefinition,
	type HitlQuestionOption,
	type HitlRequestBase,
	type HitlRequestEnvelope,
	type HitlResponseEnvelope,
	type HitlResponderIdentity,
} from './contractTypes';

type ParsedHitlResponse = {
	ok: true;
	value: HitlResponseEnvelope;
} | {
	ok: false;
	error: string;
};

type ParsedHitlRequest = {
	ok: true;
	value: HitlRequestEnvelope;
} | {
	ok: false;
	error: string;
};

interface ParseHitlRequestOptions {
	requireVersion: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	if (value.trim().length === 0) return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const mapped = value.map((item) => String(item));
	return mapped;
}

function normalizeResponderIdentity(value: unknown): HitlResponderIdentity | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const id = asString(value.id);
	const source = asString(value.source);
	const authMode = value.authMode;
	if (!id || !source) {
		return undefined;
	}
	if (authMode !== 'basicAuth' && authMode !== 'headerAuth' && authMode !== 'jwtAuth') {
		return undefined;
	}

	return {
		id,
		source,
		authMode,
	};
}

function normalizeAnswers(value: unknown): Record<string, string | string[]> | undefined {
	if (!isRecord(value)) return undefined;
	const normalized: Record<string, string | string[]> = {};

	for (const [key, raw] of Object.entries(value)) {
		const arr = toStringArray(raw);
		if (arr) {
			normalized[key] = arr;
			continue;
		}

		if (
			typeof raw === 'string'
			|| typeof raw === 'number'
			|| typeof raw === 'boolean'
			|| raw === null
		) {
			normalized[key] = String(raw ?? '');
			continue;
		}

		return undefined;
	}

	return normalized;
}

function normalizeQuestionOptions(value: unknown): HitlQuestionOption[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized: HitlQuestionOption[] = [];
	for (const item of value) {
		if (!isRecord(item)) return undefined;
		const label = asString(item.label);
		if (!label) return undefined;
		normalized.push({
			label,
			description: asString(item.description),
			value: asString(item.value),
			preview: asString(item.preview),
			action: item.action === 'complete' ? 'complete' : item.action === 'resume' ? 'resume' : undefined,
		});
	}
	return normalized;
}

function normalizeQuestions(value: unknown): HitlQuestionDefinition[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized: HitlQuestionDefinition[] = [];
	for (const item of value) {
		if (!isRecord(item)) return undefined;
		const question = asString(item.question);
		if (!question) return undefined;
		const options = normalizeQuestionOptions(item.options);
		if (item.options !== undefined && !options) return undefined;
		normalized.push({
			question,
			header: asString(item.header),
			options,
			multiSelect: typeof item.multiSelect === 'boolean' ? item.multiSelect : false,
		});
	}
	return normalized;
}

function parseHitlRequestEnvelopeWithOptions(
	input: unknown,
	options: ParseHitlRequestOptions,
): ParsedHitlRequest {
	if (!isRecord(input)) {
		return { ok: false, error: 'payload must be an object' };
	}

	if (options.requireVersion && input.version !== HITL_CONTRACT_VERSION) {
		return { ok: false, error: `version must be ${HITL_CONTRACT_VERSION}` };
	}

	const type = input.type;
	if (type !== 'approval_request' && type !== 'question_request') {
		return { ok: false, error: 'type must be approval_request or question_request' };
	}

	const requestId = asString(input.requestId);
	if (!requestId) {
		return { ok: false, error: 'requestId is required' };
	}

	if ('hitlResult' in input) {
		return { ok: false, error: 'hitlResult is not supported; use hitl_result or agent_sdk_result' };
	}

	const hitlResult = isRecord(input.agent_sdk_result)
		? input.agent_sdk_result
		: (isRecord(input.hitl_result)
			? input.hitl_result
			: undefined);

	const base: HitlRequestBase = {
		version: input.version === HITL_CONTRACT_VERSION ? HITL_CONTRACT_VERSION : undefined,
		type,
		requestId,
		streamKey: asString(input.streamKey),
		sessionId: asString(input.sessionId),
		createdAt: asString(input.createdAt),
		approvedFingerprints: asString(input.approvedFingerprints),
		message: asString(input.message),
		responseType: asString(input.responseType),
		hitl_result: hitlResult,
		agent_sdk_result: hitlResult,
	};

	if (type === 'approval_request') {
		const envelope: HitlApprovalRequestEnvelope = {
			...base,
			type,
			toolName: asString(input.toolName),
			toolInput: isRecord(input.toolInput) ? input.toolInput : undefined,
			fingerprint: asString(input.fingerprint),
		};
		return { ok: true, value: envelope };
	}

	const questions = normalizeQuestions(input.questions);
	if (input.questions !== undefined && !questions) {
		return { ok: false, error: 'questions must be an array of valid question objects' };
	}

	const formFields = Array.isArray(input.formFields) ? input.formFields.filter(isRecord) : undefined;

	return {
		ok: true,
		value: {
			...base,
			type,
			questions,
			formFields,
		},
	};
}

export function parseHitlRequestEnvelope(input: unknown): ParsedHitlRequest {
	return parseHitlRequestEnvelopeWithOptions(input, { requireVersion: false });
}

export function parseStrictHitlRequestEnvelope(input: unknown): ParsedHitlRequest {
	return parseHitlRequestEnvelopeWithOptions(input, { requireVersion: true });
}

export function assertHitlRequestEnvelope(input: unknown): HitlRequestEnvelope {
	const parsed = parseHitlRequestEnvelope(input);
	if (!parsed.ok) {
		throw new ApplicationError(`Invalid HITL request payload: ${parsed.error}`);
	}
	return parsed.value;
}

export function assertStrictHitlRequestEnvelope(input: unknown): HitlRequestEnvelope {
	const parsed = parseStrictHitlRequestEnvelope(input);
	if (!parsed.ok) {
		throw new ApplicationError(`Invalid HITL request payload: ${parsed.error}`);
	}
	return parsed.value;
}

function normalizeUpdatedInput(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			if (isRecord(parsed)) return parsed;
		} catch {
			return undefined;
		}
		return undefined;
	}
	if (isRecord(value)) return value;
	return undefined;
}

export function parseHitlResponseEnvelope(input: unknown): ParsedHitlResponse {
	if (!isRecord(input)) {
		return { ok: false, error: 'payload must be an object' };
	}

	const type = input.type;
	if (type !== 'approval_response' && type !== 'question_response') {
		return { ok: false, error: 'type must be approval_response or question_response' };
	}

	if (input.version !== HITL_CONTRACT_VERSION) {
		return { ok: false, error: `version must be ${HITL_CONTRACT_VERSION}` };
	}

	const requestId = asString(input.requestId);
	if (!requestId) {
		return { ok: false, error: 'requestId is required' };
	}

	const decisionId = asString(input.decisionId);
	if (!decisionId) {
		return { ok: false, error: 'decisionId is required' };
	}

	if (!isIsoDate(input.decidedAt)) {
		return { ok: false, error: 'decidedAt must be an ISO-8601 timestamp' };
	}

	const channel = asString(input.channel);
	if (!channel) {
		return { ok: false, error: 'channel is required' };
	}

	const base = {
		version: HITL_CONTRACT_VERSION,
		type,
		requestId,
		decisionId,
		decidedAt: input.decidedAt,
		channel,
		originalTask: asString(input.originalTask),
		resumeSessionId: asString(input.resumeSessionId),
		resumeSessionAt: asString(input.resumeSessionAt),
		approvedFingerprints: asString(input.approvedFingerprints),
		streamingRequestId: asString(input.streamingRequestId),
		streamKey: asString(input.streamKey),
		responder: input.responder === undefined ? undefined : normalizeResponderIdentity(input.responder),
	};

	if (input.responder !== undefined && !base.responder) {
		return { ok: false, error: 'responder must be a valid identity object when provided' };
	}

	if (type === 'approval_response') {
		if (typeof input.approved !== 'boolean') {
			return { ok: false, error: 'approved must be a boolean for approval_response' };
		}

		const updatedInput = normalizeUpdatedInput(input.updatedInput);
		if (input.updatedInput !== undefined && input.updatedInput !== null && !updatedInput) {
			return { ok: false, error: 'updatedInput must be a plain JSON object when provided' };
		}

		return {
			ok: true,
			value: {
				...base,
				type,
				approved: input.approved,
				fingerprint: asString(input.fingerprint),
				permissionModeOverride: asString(input.permissionModeOverride),
				reviewerMessage: asString(input.reviewerMessage),
				updatedInput,
			},
		};
	}

	const answers = normalizeAnswers(input.answers);
	if (!answers || Object.keys(answers).length === 0) {
		return { ok: false, error: 'answers must be a non-empty object for question_response' };
	}

	return {
		ok: true,
		value: {
			...base,
			type,
			answers,
			responseAction:
				input.responseAction === 'complete'
					? 'complete'
					: input.responseAction === 'resume'
						? 'resume'
						: undefined,
		},
	};
}

export function assertHitlResponseEnvelope(input: unknown): HitlResponseEnvelope {
	const parsed = parseHitlResponseEnvelope(input);
	if (!parsed.ok) {
		throw new ApplicationError(`Invalid HITL response payload: ${parsed.error}`);
	}
	return parsed.value;
}
