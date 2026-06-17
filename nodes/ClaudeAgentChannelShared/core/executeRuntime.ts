import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type {
	HitlApprovalRequestEnvelope,
	HitlQuestionRequestEnvelope,
} from '../../ClaudeAgentSdk/hitl/contract';
import { assertStrictHitlRequestEnvelope } from '../../ClaudeAgentSdk/hitl/contract';
import type { CompanionReplyHandlingMode, PendingCompanionHitlRecord } from './types';

import { asNonEmptyString, buildStoredAgentSdkResult, isRecord } from './storedAgentResult';
import { requestSignatureValidationIfAvailable } from './compat';
import { handleCompanionItemError } from './itemError';

type CompanionOutboundMessageMode = 'asIs' | 'trim' | 'none';

interface CompanionOutboundMessageSettings {
	messagePrefix?: string;
	outboundMessageMode?: CompanionOutboundMessageMode;
	maxOutboundCharacters?: number;
	fallbackMessage?: string;
}

interface CompanionApprovalSendFields {
	request: HitlApprovalRequestEnvelope;
	approveUrl: string;
	denyUrl: string;
}

interface CompanionQuestionSendFields {
	request: HitlQuestionRequestEnvelope;
	responseUrl: string;
}

interface CompanionMessageSettings extends CompanionOutboundMessageSettings {
	channelId: string;
	title?: string;
}

interface CompanionMailMessageSettings extends CompanionOutboundMessageSettings {
	toEmail: string;
	fromEmail: string;
	subjectPrefix?: string;
}

interface CompanionExecuteAdapters<TSettings extends object> {
	readMessageSettings(execFunctions: IExecuteFunctions, itemIndex: number): TSettings;
	savePending(ctx: IExecuteFunctions, record: PendingCompanionHitlRecord): void;
	sendApprovalMessage(
		ctx: IExecuteFunctions,
		context: TSettings & CompanionApprovalSendFields,
	): Promise<void>;
	sendQuestionMessage(
		ctx: IExecuteFunctions,
		context: TSettings & CompanionQuestionSendFields,
	): Promise<void>;
}

function readStringNodeParameter(
	execFunctions: IExecuteFunctions,
	parameterName: string,
	itemIndex: number,
	fallback = '',
): string {
	const value = execFunctions.getNodeParameter(parameterName, itemIndex, fallback);
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return fallback;
}

function readOutboundMessageMode(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): CompanionOutboundMessageMode {
	const mode = readStringNodeParameter(execFunctions, 'outboundMessageMode', itemIndex, 'asIs');
	if (mode === 'trim' || mode === 'none') return mode;
	return 'asIs';
}

export function computeCompanionTimeoutMs(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): number {
	const limitWaitTime = execFunctions.getNodeParameter('limitWaitTime', itemIndex, true);
	if (!limitWaitTime) return 0;

	const amount = Number(execFunctions.getNodeParameter('resumeAmount', itemIndex, 45));
	const unit = execFunctions.getNodeParameter('resumeUnit', itemIndex, 'minutes');
	if (!Number.isFinite(amount) || amount <= 0) return 0;

	switch (unit) {
		case 'days':
			return Math.floor(amount * 24 * 60 * 60 * 1000);
		case 'hours':
			return Math.floor(amount * 60 * 60 * 1000);
		default:
			return Math.floor(amount * 60 * 1000);
	}
}

export function computeCompanionWaitTill(timeoutMs: number): Date {
	if (timeoutMs <= 0) {
		return new Date('3000-01-01T00:00:00.000Z');
	}
	return new Date(Date.now() + timeoutMs);
}

export function addSignedQueryParam(
	target: Record<string, string>,
	key: string,
	value: unknown,
): void {
	if (typeof value !== 'string') return;
	const trimmed = value.trim();
	if (!trimmed) return;
	target[key] = trimmed;
}

export function buildDurableCompanionWebhookUrl(
	execFunctions: IExecuteFunctions,
	parameters: Record<string, string>,
): string {
	const node = execFunctions.getNode();
	const webhookId = asNonEmptyString(node.webhookId);
	if (!webhookId) {
		throw new NodeOperationError(
			node,
			`Missing webhookId on ${node.name}. Durable reply links require a node webhook ID.`,
		);
	}

	const baseUrl = asNonEmptyString(execFunctions.getInstanceBaseUrl());
	if (!baseUrl) {
		throw new NodeOperationError(
			node,
			`Missing instance base URL on ${node.name}. Durable reply links require a configured n8n base URL.`,
		);
	}

	const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	const callbackUrl = new URL(`webhook/${webhookId}`, normalizedBaseUrl);
	for (const [key, value] of Object.entries(parameters)) {
		callbackUrl.searchParams.set(key, value);
	}
	return callbackUrl.toString();
}

export function buildResumeUrl(
	execFunctions: IExecuteFunctions,
	replyHandlingMode: 'waitForReply' | 'dispatchAndExit',
	parameters: Record<string, string>,
): string {
	return replyHandlingMode === 'waitForReply'
		? execFunctions.getSignedResumeUrl(parameters)
		: buildDurableCompanionWebhookUrl(execFunctions, parameters);
}

export function normalizeCompanionPayload(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined || value === null) return undefined;

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return undefined;

		try {
			const parsed: unknown = JSON.parse(trimmed);
			return isRecord(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	if (isRecord(value)) {
		return value;
	}

	return undefined;
}

export function buildPendingRecordFromRequest(
	request: HitlApprovalRequestEnvelope | HitlQuestionRequestEnvelope,
	timeoutMs: number,
): PendingCompanionHitlRecord {
	const storedAgentSdkResult = buildStoredAgentSdkResult(request);
	const base: PendingCompanionHitlRecord = {
		requestId: request.requestId,
		kind: request.type === 'approval_request' ? 'approval' : 'question',
		status: 'pending',
		createdAt: Date.now(),
		timeoutMs,
		sessionId: request.sessionId,
		approvedFingerprints: request.approvedFingerprints,
		message: request.message,
		...(storedAgentSdkResult ? { agentSdkResult: storedAgentSdkResult } : {}),
	};

	if (request.type === 'approval_request') {
		return {
			...base,
			toolName: request.toolName,
			toolInput: request.toolInput,
			fingerprint: request.fingerprint,
		};
	}

	return {
		...base,
		questions: request.questions,
	};
}

function addCommonResumeParams(
	target: Record<string, string>,
	request: HitlApprovalRequestEnvelope | HitlQuestionRequestEnvelope,
): void {
	const commonParams: Array<[string, unknown]> = [
		['sid', request.sessionId],
		['afps', request.approvedFingerprints],
	];

	for (const [key, value] of commonParams) {
		addSignedQueryParam(target, key, value);
	}
}

function buildApprovalParams(
	request: HitlApprovalRequestEnvelope,
	approved: boolean,
): Record<string, string> {
	const params: Record<string, string> = {
		requestId: request.requestId,
		approved: approved ? 'true' : 'false',
	};
	addCommonResumeParams(params, request);
	addSignedQueryParam(params, 'fp', request.fingerprint);
	return params;
}

function encodeQuestionsForResume(request: HitlQuestionRequestEnvelope): string | undefined {
	if (!Array.isArray(request.questions) || request.questions.length === 0) {
		return undefined;
	}
	return Buffer.from(JSON.stringify(request.questions)).toString('base64');
}

function buildQuestionParams(request: HitlQuestionRequestEnvelope): Record<string, string> {
	const params: Record<string, string> = {
		requestId: request.requestId,
		type: 'question',
	};
	addCommonResumeParams(params, request);
	const encodedQuestions = encodeQuestionsForResume(request);
	if (encodedQuestions) {
		params.q = encodedQuestions;
	}
	return params;
}

function isCompanionHitlItem(item: INodeExecutionData | undefined): boolean {
	if (!isRecord(item?.json)) return false;
	const itemType = item.json.type;
	return itemType === 'approval_request' || itemType === 'question_request';
}

export function readChannelCompanionMessageSettings(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): CompanionMessageSettings {
	return {
		channelId: readStringNodeParameter(execFunctions, 'channelId', itemIndex),
		messagePrefix: readStringNodeParameter(execFunctions, 'messagePrefix', itemIndex),
		title: readStringNodeParameter(execFunctions, 'messageTitle', itemIndex),
		outboundMessageMode: readOutboundMessageMode(execFunctions, itemIndex),
		maxOutboundCharacters: Number(
			execFunctions.getNodeParameter('maxOutboundCharacters', itemIndex, 400),
		),
		fallbackMessage: readStringNodeParameter(execFunctions, 'fallbackMessage', itemIndex),
	};
}

export function readMailCompanionMessageSettings(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): CompanionMailMessageSettings {
	return {
		toEmail: readStringNodeParameter(execFunctions, 'toEmail', itemIndex),
		fromEmail: readStringNodeParameter(execFunctions, 'fromEmail', itemIndex),
		subjectPrefix: readStringNodeParameter(execFunctions, 'subjectPrefix', itemIndex),
		messagePrefix: readStringNodeParameter(execFunctions, 'messagePrefix', itemIndex),
		outboundMessageMode: readOutboundMessageMode(execFunctions, itemIndex),
		maxOutboundCharacters: Number(
			execFunctions.getNodeParameter('maxOutboundCharacters', itemIndex, 400),
		),
		fallbackMessage: readStringNodeParameter(execFunctions, 'fallbackMessage', itemIndex),
	};
}

function buildCompanionApprovalUrls(
	execFunctions: IExecuteFunctions,
	replyHandlingMode: CompanionReplyHandlingMode,
	request: HitlApprovalRequestEnvelope,
): { approveUrl: string; denyUrl: string } {
	return {
		approveUrl: buildResumeUrl(
			execFunctions,
			replyHandlingMode,
			buildApprovalParams(request, true),
		),
		denyUrl: buildResumeUrl(execFunctions, replyHandlingMode, buildApprovalParams(request, false)),
	};
}

function buildCompanionQuestionUrl(
	execFunctions: IExecuteFunctions,
	replyHandlingMode: CompanionReplyHandlingMode,
	request: HitlQuestionRequestEnvelope,
): string {
	return buildResumeUrl(execFunctions, replyHandlingMode, buildQuestionParams(request));
}

async function sendCompanionHitlMessage<TSettings extends object>(
	execFunctions: IExecuteFunctions,
	adapters: CompanionExecuteAdapters<TSettings>,
	request: HitlApprovalRequestEnvelope | HitlQuestionRequestEnvelope,
	settings: TSettings,
): Promise<void> {
	if (request.type === 'approval_request') {
		const { approveUrl, denyUrl } = buildCompanionApprovalUrls(
			execFunctions,
			'waitForReply',
			request,
		);
		await adapters.sendApprovalMessage(execFunctions, {
			...settings,
			request,
			approveUrl,
			denyUrl,
		});
		return;
	}

	await adapters.sendQuestionMessage(execFunctions, {
		...settings,
		request,
		responseUrl: buildCompanionQuestionUrl(execFunctions, 'waitForReply', request),
	});
}

export async function executeCompanionNode<TSettings extends object>(
	execFunctions: IExecuteFunctions,
	adapters: CompanionExecuteAdapters<TSettings>,
): Promise<INodeExecutionData[][]> {
	const items = execFunctions.getInputData();
	const outputItems = [...items];
	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		if (!isCompanionHitlItem(items[itemIndex])) continue;

		try {
			requestSignatureValidationIfAvailable(execFunctions);

			const request = assertStrictHitlRequestEnvelope(items[itemIndex].json);
			const settings = adapters.readMessageSettings(execFunctions, itemIndex);
			const timeoutMs = computeCompanionTimeoutMs(execFunctions, itemIndex);
			adapters.savePending(execFunctions, buildPendingRecordFromRequest(request, timeoutMs));

			const waitTill = computeCompanionWaitTill(timeoutMs);
			await execFunctions.putExecutionToWait(waitTill);

			await sendCompanionHitlMessage(execFunctions, adapters, request, settings);
		} catch (error) {
			outputItems[itemIndex] = handleCompanionItemError(execFunctions, error, itemIndex);
		}
	}

	return [outputItems];
}
