import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { isAgentPlaneEnabled } from '../featureFlags';
import { normalizeCompanionAgentId } from './agentId';

export const PHOENIX_COMPANION_BASE_URL = 'http://host.docker.internal:4000';
export const PHOENIX_COMPANION_LOCAL_BASE_URL = 'http://127.0.0.1:4000';

type CompanionReadinessMode = 'checkOnly' | 'syncIfNeeded';

export interface CompanionAgentConfig {
	enabled: boolean;
	agentId: string;
	readinessMode: CompanionReadinessMode;
	requireSynced: boolean;
	lifecycleCallbacks: boolean;
}

export interface CompanionExecutionContext {
	agentId: string;
	workspaceId: string;
	executionServerId: string;
	workingDirectory: string;
	serverWorkingDirectory?: string;
	localWorkingDirectory?: string;
	directoryStatus: string;
	syncStatus: string;
	ready: boolean;
	latestRevisionWatermark?: string;
	workspaceHash?: string;
	warnings?: string[];
}

export interface CompanionRunStartPayload {
	agentId: string;
	workspaceId?: string;
	workflowId?: string;
	executionId?: string;
	nodeName: string;
	chatSessionId?: string;
	workingDirectory: string;
	task?: string;
}

export interface CompanionRunCompletionPayload {
	agentId: string;
	sessionId?: string;
	chatSessionId?: string;
	workingDirectory: string;
	summary?: string;
	usage?: unknown;
	observability?: unknown;
	toolCalls?: unknown[];
	todos?: unknown[];
	tasks?: unknown[];
}

export interface CompanionRunFailurePayload {
	agentId: string;
	error: string;
	chatSessionId?: string;
	workingDirectory?: string;
}

export interface CompanionAgentSummary {
	agentId: string;
	name: string;
	workspaceId?: string;
	description?: string;
	directoryStatus?: string;
	syncStatus?: string;
	ready?: boolean;
	workingDirectory?: string;
	serverWorkingDirectory?: string;
	localWorkingDirectory?: string;
}

interface AgentPlaneCredentials {
	apiKey?: string;
}

interface CompanionRequestOptions {
	method: 'GET' | 'POST';
	path: string;
	apiKey: string;
	body?: Record<string, unknown>;
}

const DISABLED_COMPANION_CONFIG: CompanionAgentConfig = {
	enabled: false,
	agentId: '',
	readinessMode: 'checkOnly',
	requireSynced: true,
	lifecycleCallbacks: true,
};

const LOCAL_DEV_RETRYABLE_FETCH_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ENOTFOUND',
	'EAI_AGAIN',
	'ETIMEDOUT',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_SOCKET',
]);

export function parseCompanionAgentConfig(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): CompanionAgentConfig {
	if (!isAgentPlaneEnabled()) {
		return DISABLED_COMPANION_CONFIG;
	}

	const settings = execFunctions.getNodeParameter('companionAgent', itemIndex, {}) as {
		useCompanionAgent?: boolean;
		companionAgentId?: unknown;
		companionReadinessMode?: CompanionReadinessMode;
		companionRequireSynced?: boolean;
		companionLifecycleCallbacks?: boolean;
	};

	const enabled = settings.useCompanionAgent === true;

	return {
		enabled,
		agentId: normalizeCompanionAgentId(settings.companionAgentId),
		readinessMode: settings.companionReadinessMode ?? 'checkOnly',
		requireSynced: settings.companionRequireSynced !== false,
		lifecycleCallbacks: settings.companionLifecycleCallbacks !== false,
	};
}

export async function ensureCompanionAgentReady(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	config: CompanionAgentConfig;
	chatSessionId?: string;
	workflowId?: string;
	executionId?: string;
	nodeName: string;
}): Promise<CompanionExecutionContext | undefined> {
	const { execFunctions, itemIndex, config } = args;

	if (!config.enabled) {
		return undefined;
	}

	if (!config.agentId) {
		throw new NodeOperationError(
			execFunctions.getNode(),
			'Agent Plane Agent ID is required when Agent Plane is enabled.',
			{ itemIndex },
		);
	}

	const apiKey = await loadCompanionApiKey(execFunctions, itemIndex);

	const context = await requestAgentPlane<CompanionExecutionContext>(execFunctions, itemIndex, {
		method: 'POST',
		path: `/api/n8n/agents/${encodeURIComponent(config.agentId)}/ensure-ready`,
		apiKey,
		body: {
			agentId: config.agentId,
			workflowId: args.workflowId,
			executionId: args.executionId,
			nodeName: args.nodeName,
			chatSessionId: args.chatSessionId,
			mode: config.readinessMode,
			requireSynced: config.requireSynced,
			executionPlane: 'n8nLocalCli',
			workingDirectoryTarget: 'phoenixAccessPath',
		},
	});

	if (!context.workingDirectory) {
		throw new NodeOperationError(
			execFunctions.getNode(),
			'Agent Plane ensure-ready response did not include workingDirectory.',
			{ itemIndex },
		);
	}

	if (config.requireSynced && !context.ready) {
		throw new NodeOperationError(
			execFunctions.getNode(),
			`Agent Plane reports agent "${config.agentId}" is not ready.`,
			{
				itemIndex,
				description: `directoryStatus=${context.directoryStatus}; syncStatus=${context.syncStatus}`,
			},
		);
	}

	return context;
}

export async function recordCompanionRunStarted(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	config: CompanionAgentConfig;
	payload: CompanionRunStartPayload;
}): Promise<string | undefined> {
	if (!args.config.enabled || !args.config.lifecycleCallbacks) {
		return undefined;
	}

	const apiKey = await loadCompanionApiKey(args.execFunctions, args.itemIndex);
	const response = await requestAgentPlane<{ runId?: string }>(args.execFunctions, args.itemIndex, {
		method: 'POST',
		path: '/api/n8n/runs/start',
		apiKey,
		body: args.payload as unknown as Record<string, unknown>,
	});

	return response.runId;
}

export async function recordCompanionRunCompleted(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	config: CompanionAgentConfig;
	runId: string | undefined;
	payload: CompanionRunCompletionPayload;
}): Promise<void> {
	if (!args.config.enabled || !args.config.lifecycleCallbacks || !args.runId) {
		return;
	}

	const apiKey = await loadCompanionApiKey(args.execFunctions, args.itemIndex);

	await requestAgentPlane(args.execFunctions, args.itemIndex, {
		method: 'POST',
		path: `/api/n8n/runs/${encodeURIComponent(args.runId)}/complete`,
		apiKey,
		body: {
			...args.payload,
			status: 'completed',
		},
	});
}

export async function recordCompanionRunFailed(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	config: CompanionAgentConfig;
	runId: string | undefined;
	payload: CompanionRunFailurePayload;
}): Promise<void> {
	if (!args.config.enabled || !args.config.lifecycleCallbacks || !args.runId) {
		return;
	}

	const apiKey = await loadCompanionApiKey(args.execFunctions, args.itemIndex);

	await requestAgentPlane(args.execFunctions, args.itemIndex, {
		method: 'POST',
		path: `/api/n8n/runs/${encodeURIComponent(args.runId)}/fail`,
		apiKey,
		body: {
			...args.payload,
			status: 'failed',
		},
	});
}

export async function listCompanionAgents(apiKey: string): Promise<CompanionAgentSummary[]> {
	const response = await fetchAgentPlane({
		method: 'GET',
		path: '/api/n8n/agents',
		apiKey,
	});
	const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

	if (!response.ok) {
		const error =
			stringValue(responseBody.error) || response.statusText || `HTTP ${response.status}`;
		throw new Error(`Agent Plane request failed: ${error}`);
	}

	const agents = Array.isArray(responseBody.agents) ? responseBody.agents : [];
	return agents.flatMap((agent) => {
		const parsed = parseCompanionAgentSummary(agent);
		return parsed ? [parsed] : [];
	});
}

export function completionPayloadFromTaskResult(args: {
	agentId: string;
	chatSessionId?: string;
	workingDirectory: string;
	resultJson: IDataObject;
}): CompanionRunCompletionPayload {
	const { resultJson } = args;

	return {
		agentId: args.agentId,
		sessionId: stringValue(resultJson.sessionId),
		chatSessionId: args.chatSessionId || stringValue(resultJson.chatSessionId),
		workingDirectory: args.workingDirectory,
		summary: stringValue(resultJson.summary),
		usage: resultJson.usage ?? {},
		observability: resultJson.observability ?? {},
		toolCalls: arrayValue(resultJson.toolCalls),
		todos: arrayValue(resultJson.todos),
		tasks: arrayValue(resultJson.tasks),
	};
}

async function loadCompanionApiKey(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): Promise<string> {
	const credentials = (await execFunctions.getCredentials(
		'claudeAgentCompanionApi',
	)) as AgentPlaneCredentials;
	const apiKey = String(credentials.apiKey ?? '').trim();

	if (!apiKey) {
		throw new NodeOperationError(
			execFunctions.getNode(),
			'Agent Plane API credential is missing an API key.',
			{ itemIndex },
		);
	}

	return apiKey;
}

async function requestAgentPlane<T = Record<string, unknown>>(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	options: CompanionRequestOptions,
): Promise<T> {
	const response = await fetchAgentPlane(options);
	const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

	if (!response.ok) {
		const error =
			stringValue(responseBody.error) || response.statusText || `HTTP ${response.status}`;
		throw new NodeOperationError(execFunctions.getNode(), `Agent Plane request failed: ${error}`, {
			itemIndex,
			description: agentPlaneErrorDescription(options, response.status, responseBody),
		});
	}

	return responseBody as T;
}

function agentPlaneErrorDescription(
	options: CompanionRequestOptions,
	status: number,
	responseBody: Record<string, unknown>,
): string {
	const details = [`${options.method} ${options.path} returned ${status}`];
	const directoryStatus = stringValue(responseBody.directoryStatus);
	const syncStatus = stringValue(responseBody.syncStatus);
	const warnings = arrayValue(responseBody.warnings).filter(
		(warning): warning is string => typeof warning === 'string' && warning.length > 0,
	);

	if (directoryStatus || syncStatus) {
		details.push(
			`directoryStatus=${directoryStatus ?? 'unknown'}; syncStatus=${syncStatus ?? 'unknown'}`,
		);
	}

	if (warnings.length > 0) {
		details.push(`warnings=${warnings.join('; ')}`);
	}

	return details.join('; ');
}

async function fetchAgentPlane(options: CompanionRequestOptions): Promise<Response> {
	const requestInit: RequestInit = {
		method: options.method,
		headers: {
			Authorization: `Bearer ${options.apiKey}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
	};
	const primaryUrl = `${PHOENIX_COMPANION_BASE_URL}${options.path}`;
	const localUrl = `${PHOENIX_COMPANION_LOCAL_BASE_URL}${options.path}`;

	try {
		return await fetch(primaryUrl, requestInit);
	} catch (error) {
		if (!shouldRetryLocalAgentPlane(error)) {
			throw buildAgentPlaneNetworkError(options, [PHOENIX_COMPANION_BASE_URL], error);
		}

		try {
			return await fetch(localUrl, requestInit);
		} catch (localError) {
			throw buildAgentPlaneNetworkError(
				options,
				[PHOENIX_COMPANION_BASE_URL, PHOENIX_COMPANION_LOCAL_BASE_URL],
				localError,
			);
		}
	}
}

function shouldRetryLocalAgentPlane(error: unknown): boolean {
	const code = getFetchErrorCode(error);
	if (code && LOCAL_DEV_RETRYABLE_FETCH_CODES.has(code)) {
		return true;
	}

	const message = error instanceof Error ? error.message : '';
	return message === 'fetch failed' || message.includes('Failed to fetch');
}

function getFetchErrorCode(error: unknown): string | undefined {
	if (error && typeof error === 'object' && 'code' in error) {
		const code = (error as Record<string, unknown>).code;
		if (typeof code === 'string') return code;
	}

	const cause = error instanceof Error ? error.cause : undefined;
	const causeRecord = cause && typeof cause === 'object' ? (cause as Record<string, unknown>) : {};
	const code = causeRecord.code;
	return typeof code === 'string' ? code : undefined;
}

function buildAgentPlaneNetworkError(
	options: CompanionRequestOptions,
	baseUrls: string[],
	error: unknown,
): Error {
	const code = getFetchErrorCode(error);
	const suffix = code ? ` Last network error: ${code}.` : '';
	return new Error(
		`Agent Plane request failed: unable to reach Agent Plane for ${options.method} ${options.path}. ` +
			`Tried ${baseUrls.join(' and ')}.${suffix} ` +
			'Make sure Agent Plane is running on port 4000 and reachable from n8n.',
	);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function parseCompanionAgentSummary(value: unknown): CompanionAgentSummary | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	const agentId = stringValue(record.agentId);
	const name = stringValue(record.name) || agentId;
	if (!agentId || !name) return undefined;

	return {
		agentId,
		name,
		workspaceId: stringValue(record.workspaceId),
		description: stringValue(record.description),
		directoryStatus: stringValue(record.directoryStatus),
		syncStatus: stringValue(record.syncStatus),
		ready: typeof record.ready === 'boolean' ? record.ready : undefined,
		workingDirectory: stringValue(record.workingDirectory),
		serverWorkingDirectory: stringValue(record.serverWorkingDirectory),
		localWorkingDirectory: stringValue(record.localWorkingDirectory),
	};
}
