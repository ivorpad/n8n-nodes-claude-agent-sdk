import type { EngineResponse } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';

import {
	assertHitlResponseEnvelope,
	buildEngineHitlResponseEnvelope,
	buildHitlApprovalResponseEnvelope,
	buildHitlQuestionResponseEnvelope,
	type HitlResponseEnvelope,
} from '../../../hitl/contract';

interface HitlMetadata {
	sessionId?: string;
	taskDescriptionBase64?: string;
	chatSessionId?: string;
	approvedFingerprints?: string;
	interactionKind?: 'approval' | 'question';
	requestId?: string;
	toolName?: string;
	fingerprint?: string;
	workingDirectory?: string;
	mappedWorkingDirectory?: string;
}

type ParsedWhatsAppToken =
	| { kind: 'approval'; requestId: string; approved: boolean; fingerprint?: string }
	| { kind: 'question'; requestId: string; questionIndex: number };

interface WhatsAppSelection {
	token?: ParsedWhatsAppToken;
	selectedLabel?: string;
}

interface InteractiveReply {
	id?: unknown;
	title?: unknown;
}

interface HitlResumeSource {
	source: 'webhook_envelope' | 'whatsapp_fallback';
	response: HitlResponseEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asInteractionKind(value: unknown): 'approval' | 'question' | undefined {
	return value === 'approval' || value === 'question' ? value : undefined;
}

function readHitlMetadata(value: unknown): HitlMetadata | undefined {
	if (!isRecord(value)) return undefined;

	return {
		sessionId: asString(value.sessionId),
		taskDescriptionBase64: asString(value.taskDescriptionBase64),
		chatSessionId: asString(value.chatSessionId),
		approvedFingerprints: asString(value.approvedFingerprints),
		interactionKind: asInteractionKind(value.interactionKind),
		requestId: asString(value.requestId),
		toolName: asString(value.toolName),
		fingerprint: asString(value.fingerprint),
		workingDirectory: asString(value.workingDirectory),
		mappedWorkingDirectory: asString(value.mappedWorkingDirectory),
	};
}

function isHitlResponseEnvelopeShape(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	return value.type === 'approval_response' || value.type === 'question_response';
}

function parseWhatsAppApprovalToken(parts: string[]): ParsedWhatsAppToken | undefined {
	if (parts[1] === 'approve' || parts[1] === 'deny') {
		return {
			kind: 'approval',
			requestId: parts[2],
			approved: parts[1] === 'approve',
			fingerprint: asString(parts[3]),
		};
	}

	return undefined;
}

function parseWhatsAppQuestionToken(parts: string[]): ParsedWhatsAppToken | undefined {
	if (parts[1] !== 'q' || parts.length < 5) return undefined;

	const questionIndex = Number(parts[3]);
	if (!Number.isInteger(questionIndex) || questionIndex < 0) return undefined;

	return {
		kind: 'question',
		requestId: parts[2],
		questionIndex,
	};
}

function parseWhatsAppToken(value: unknown): ParsedWhatsAppToken | undefined {
	const token = asString(value);
	if (!token) return undefined;

	const parts = token.split('|');
	if (parts.length < 3 || parts[0] !== 'hitl') return undefined;

	return parseWhatsAppApprovalToken(parts) ?? parseWhatsAppQuestionToken(parts);
}

function readInteractiveReply(
	interactive: Record<string, unknown> | undefined,
): InteractiveReply | undefined {
	const interactiveType = asString(interactive?.type);

	if (interactiveType === 'button_reply') {
		return isRecord(interactive?.button_reply) ? interactive.button_reply : undefined;
	}

	if (interactiveType === 'list_reply') {
		return isRecord(interactive?.list_reply) ? interactive.list_reply : undefined;
	}

	return undefined;
}

function parseInteractiveReply(
	interactive: Record<string, unknown> | undefined,
): WhatsAppSelection {
	const reply = readInteractiveReply(interactive);
	return {
		token: parseWhatsAppToken(reply?.id),
		selectedLabel: asString(reply?.title),
	};
}

function parseWhatsAppSelection(message: Record<string, unknown>): WhatsAppSelection {
	const selection = parseInteractiveReply(
		isRecord(message.interactive) ? message.interactive : undefined,
	);

	if (selection.token) {
		return selection;
	}

	const legacyButton = isRecord(message.button) ? message.button : undefined;
	return {
		token: parseWhatsAppToken(legacyButton?.payload),
		selectedLabel: selection.selectedLabel ?? asString(legacyButton?.text),
	};
}

function buildWhatsAppDecisionId(message: Record<string, unknown>, requestId: string): string {
	const providerMessageId = asString(message.id);
	return providerMessageId
		? `whatsapp:${providerMessageId}`
		: `whatsapp:${requestId}:${Date.now()}`;
}

function buildWhatsAppApprovalResponse(args: {
	token: Extract<ParsedWhatsAppToken, { kind: 'approval' }>;
	decisionId: string;
	fallbackResumeSessionId?: string;
}): HitlResponseEnvelope {
	return buildHitlApprovalResponseEnvelope({
		requestId: args.token.requestId,
		approved: args.token.approved,
		channel: 'whatsapp',
		decisionId: args.decisionId,
		decidedAt: new Date().toISOString(),
		resumeSessionId: args.fallbackResumeSessionId,
		fingerprint: args.token.fingerprint,
	});
}

function buildWhatsAppQuestionResponse(args: {
	token: Extract<ParsedWhatsAppToken, { kind: 'question' }>;
	answer: string;
	decisionId: string;
	fallbackResumeSessionId?: string;
}): HitlResponseEnvelope {
	return buildHitlQuestionResponseEnvelope({
		requestId: args.token.requestId,
		answers: { [`field-${args.token.questionIndex}`]: args.answer },
		channel: 'whatsapp',
		decisionId: args.decisionId,
		decidedAt: new Date().toISOString(),
		resumeSessionId: args.fallbackResumeSessionId,
	});
}

function readFirstWhatsAppMessage(
	rawResumeData: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const messages = Array.isArray(rawResumeData.messages) ? rawResumeData.messages : undefined;
	return messages && messages.length > 0 && isRecord(messages[0]) ? messages[0] : undefined;
}

function buildWhatsAppResponseFromSelection(args: {
	token: ParsedWhatsAppToken;
	message: Record<string, unknown>;
	selectedLabel?: string;
	fallbackResumeSessionId?: string;
}): HitlResponseEnvelope | undefined {
	const decisionId = buildWhatsAppDecisionId(args.message, args.token.requestId);

	if (args.token.kind === 'approval') {
		return buildWhatsAppApprovalResponse({
			token: args.token,
			decisionId,
			fallbackResumeSessionId: args.fallbackResumeSessionId,
		});
	}

	const textAnswer = asString(isRecord(args.message.text) ? args.message.text.body : undefined);
	const answer = args.selectedLabel ?? textAnswer;
	if (!answer) return undefined;

	return buildWhatsAppQuestionResponse({
		token: args.token,
		answer,
		decisionId,
		fallbackResumeSessionId: args.fallbackResumeSessionId,
	});
}

function parseRawWhatsAppInteractiveEnvelope(args: {
	rawResumeData: Record<string, unknown>;
	fallbackResumeSessionId?: string;
}): HitlResponseEnvelope | undefined {
	const message = readFirstWhatsAppMessage(args.rawResumeData);
	if (!message) return undefined;

	const { token, selectedLabel } = parseWhatsAppSelection(message);
	if (!token) return undefined;

	return buildWhatsAppResponseFromSelection({
		token,
		message,
		selectedLabel,
		fallbackResumeSessionId: args.fallbackResumeSessionId,
	});
}

function parseStringifiedEnvelope(candidate: unknown): Record<string, unknown> | undefined {
	const value = asString(candidate);
	if (!value || !value.startsWith('{')) return undefined;

	try {
		const parsed: unknown = JSON.parse(value);
		return isHitlResponseEnvelopeShape(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function unwrapStringifiedWebhookEnvelope(
	rawResumeData: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const body = isRecord(rawResumeData.body) ? rawResumeData.body : undefined;
	const bodyQuery = isRecord(body?.query) ? body.query : undefined;
	return parseStringifiedEnvelope(bodyQuery?.task);
}

function unwrapLegacyStringifiedWebhookEnvelope(
	rawResumeData: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const topQuery = isRecord(rawResumeData.query) ? rawResumeData.query : undefined;
	return parseStringifiedEnvelope(topQuery?.task);
}

function unwrapBodyWebhookEnvelope(
	rawResumeData: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const body = isRecord(rawResumeData.body) ? rawResumeData.body : undefined;
	return isHitlResponseEnvelopeShape(body) ? body : undefined;
}

function unwrapWebhookLoopbackEnvelope(
	rawResumeData: Record<string, unknown>,
): Record<string, unknown> {
	if (rawResumeData.type) {
		return rawResumeData;
	}

	return (
		unwrapStringifiedWebhookEnvelope(rawResumeData) ??
		unwrapLegacyStringifiedWebhookEnvelope(rawResumeData) ??
		unwrapBodyWebhookEnvelope(rawResumeData) ??
		rawResumeData
	);
}

export function extractEngineHitlResponse(engineResponse: EngineResponse): HitlResponseEnvelope {
	const meta = readHitlMetadata(engineResponse.metadata);
	const hitlResult = engineResponse.actionResponses?.[0];
	// The engine rewires tool-node output to `ai_tool` when action.type is AiTool,
	// matching n8n's HITL response shape at data.data.ai_tool[0][0].json.
	const hitlData =
		hitlResult?.data?.data?.ai_tool?.[0]?.[0]?.json || hitlResult?.data?.data?.main?.[0]?.[0]?.json;

	if (!isRecord(hitlData)) {
		throw new ApplicationError(
			'Missing HITL tool response payload in engine callback. Ensure the connected tool returns data.',
		);
	}
	if (!meta?.interactionKind || !meta.requestId || !meta.sessionId) {
		throw new ApplicationError('Missing HITL engine metadata in callback response.');
	}

	return buildEngineHitlResponseEnvelope({
		interactionKind: meta.interactionKind,
		requestId: meta.requestId,
		rawPayload: hitlData,
		actionId: hitlResult?.action?.id,
		sessionId: meta.sessionId,
		approvedFingerprints: meta.approvedFingerprints,
		channel: hitlResult?.action?.nodeName || 'send_and_wait_tool',
	});
}

export function extractWebhookHitlResponse(args: {
	rawResumeData: Record<string, unknown>;
	fallbackResumeSessionId?: string;
}): HitlResumeSource | undefined {
	const rawResumeData = unwrapWebhookLoopbackEnvelope(args.rawResumeData);

	if (isHitlResponseEnvelopeShape(rawResumeData)) {
		return {
			source: 'webhook_envelope',
			response: assertHitlResponseEnvelope(rawResumeData),
		};
	}

	const whatsAppFallback = parseRawWhatsAppInteractiveEnvelope({
		rawResumeData,
		fallbackResumeSessionId: args.fallbackResumeSessionId,
	});
	if (whatsAppFallback) {
		return {
			source: 'whatsapp_fallback',
			response: assertHitlResponseEnvelope(whatsAppFallback),
		};
	}

	if ('data' in rawResumeData) {
		throw new ApplicationError('HITL payloads must use the strict HITL v1.0 response envelope.');
	}

	return undefined;
}

export function toRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

export function readTaskDescriptionBase64FromHitlMetadata(value: unknown): string | undefined {
	return readHitlMetadata(value)?.taskDescriptionBase64;
}
