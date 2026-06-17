import { ApplicationError } from 'n8n-workflow';

import type {
	AgentCreateParams,
	AgentUpdateParams,
	BetaManagedAgentsAgentParams,
	BetaManagedAgentsFileResourceParams,
	BetaManagedAgentsGitHubRepositoryResourceParams,
	BetaManagedAgentsMemoryStoreResourceParam,
	SessionCreateParams,
} from '@anthropic-ai/sdk/resources/beta/index.js';

export type ManagedSessionResourceParam =
	| BetaManagedAgentsFileResourceParams
	| BetaManagedAgentsGitHubRepositoryResourceParams
	| BetaManagedAgentsMemoryStoreResourceParam;

export interface ManagedSessionCreateConfig {
	agentId: string;
	environmentId: string;
	agentVersion?: number;
	title?: string;
	metadata?: Record<string, string>;
	vaultIds?: string[];
	resources?: ManagedSessionResourceParam[];
}

export interface ManagedAgentAuthoringConfig {
	name?: string;
	model?: string;
	modelSpeed?: 'standard' | 'fast';
	system?: string | null;
	description?: string | null;
	metadata?: Record<string, string>;
	metadataPatch?: Record<string, string | null>;
	tools?: unknown[];
	mcpServers?: unknown[];
	skills?: unknown[];
	multiagent?: unknown;
	rawConfig?: Record<string, unknown>;
}

type ManagedAgentCreatePatch = Omit<AgentCreateParams, 'model' | 'name'> & {
	model?: AgentCreateParams['model'];
	name?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function parseJson(value: string | undefined, fieldName: string): unknown | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch (error) {
		throw new ApplicationError(
			`Invalid JSON for ${fieldName}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function parseJsonObject(value: string | undefined, fieldName: string): Record<string, unknown> | undefined {
	const parsed = parseJson(value, fieldName);
	if (parsed === undefined) {
		return undefined;
	}
	if (!isRecord(parsed)) {
		throw new ApplicationError(`${fieldName} must be a JSON object`);
	}
	return parsed;
}

export function parseJsonArray(value: string | undefined, fieldName: string): unknown[] | undefined {
	const parsed = parseJson(value, fieldName);
	if (parsed === undefined) {
		return undefined;
	}
	if (!Array.isArray(parsed)) {
		throw new ApplicationError(`${fieldName} must be a JSON array`);
	}
	return parsed;
}

function parseStringMapRecord(
	value: Record<string, unknown> | undefined,
	fieldName: string,
): Record<string, string> | undefined {
	if (!value) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') {
			throw new ApplicationError(`${fieldName}.${key} must be a string`);
		}
		out[key] = entry;
	}
	return out;
}

function parseStringPatchRecord(
	value: Record<string, unknown> | undefined,
	fieldName: string,
): Record<string, string | null> | undefined {
	if (!value) {
		return undefined;
	}
	const out: Record<string, string | null> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== null && typeof entry !== 'string') {
			throw new ApplicationError(`${fieldName}.${key} must be a string or null`);
		}
		out[key] = entry;
	}
	return out;
}

export function parseMetadataJson(value: string | undefined, fieldName = 'Metadata JSON'): Record<string, string> | undefined {
	return parseStringMapRecord(parseJsonObject(value, fieldName), fieldName);
}

export function parseMetadataPatchJson(value: string | undefined, fieldName = 'Metadata Patch JSON'): Record<string, string | null> | undefined {
	return parseStringPatchRecord(parseJsonObject(value, fieldName), fieldName);
}

export function parseCommaSeparatedIds(value: string | undefined): string[] | undefined {
	const ids = (value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	return ids.length > 0 ? ids : undefined;
}

export function parsePositiveInteger(value: number | string | undefined, fieldName: string): number | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new ApplicationError(`${fieldName} must be a positive integer`);
	}
	return parsed;
}

export function buildManagedSessionCreateParams(
	config: ManagedSessionCreateConfig,
): SessionCreateParams {
	const agent: string | BetaManagedAgentsAgentParams = config.agentVersion
		? {
			type: 'agent',
			id: config.agentId,
			version: config.agentVersion,
		}
		: config.agentId;
	const params: SessionCreateParams = {
		agent,
		environment_id: config.environmentId,
	};

	if (config.title) {
		params.title = config.title;
	}
	if (config.metadata && Object.keys(config.metadata).length > 0) {
		params.metadata = config.metadata;
	}
	if (config.vaultIds && config.vaultIds.length > 0) {
		params.vault_ids = config.vaultIds;
	}
	if (config.resources && config.resources.length > 0) {
		params.resources = config.resources;
	}
	return params;
}

function buildModelConfig(config: ManagedAgentAuthoringConfig): AgentCreateParams['model'] | undefined {
	if (!config.model) {
		return undefined;
	}
	if (!config.modelSpeed) {
		return config.model;
	}
	return {
		id: config.model,
		speed: config.modelSpeed,
	};
}

function applyAuthoringFields<T extends ManagedAgentCreatePatch | AgentUpdateParams>(
	params: T,
	config: ManagedAgentAuthoringConfig,
): T {
	const model = buildModelConfig(config);
	if (config.name !== undefined) {
		params.name = config.name;
	}
	if (model !== undefined) {
		params.model = model;
	}
	if (config.system !== undefined) {
		params.system = config.system;
	}
	if (config.description !== undefined) {
		params.description = config.description;
	}
	if ('metadataPatch' in config && config.metadataPatch !== undefined) {
		(params as AgentUpdateParams).metadata = config.metadataPatch;
	} else if (config.metadata !== undefined) {
		(params as ManagedAgentCreatePatch).metadata = config.metadata;
	}
	if (config.tools !== undefined) {
		params.tools = config.tools as T['tools'];
	}
	if (config.mcpServers !== undefined) {
		params.mcp_servers = config.mcpServers as T['mcp_servers'];
	}
	if (config.skills !== undefined) {
		params.skills = config.skills as T['skills'];
	}
	if (config.multiagent !== undefined) {
		params.multiagent = config.multiagent as T['multiagent'];
	}
	if (config.rawConfig) {
		Object.assign(params, config.rawConfig);
	}
	return params;
}

export function buildManagedAgentCreateParams(
	config: ManagedAgentAuthoringConfig,
): AgentCreateParams {
	const params = applyAuthoringFields<ManagedAgentCreatePatch>({}, config);
	if (!params.name) {
		throw new ApplicationError('Managed Agent name is required for create');
	}
	if (!params.model) {
		throw new ApplicationError('Managed Agent model is required for create');
	}
	return params as AgentCreateParams;
}

export function buildManagedAgentUpdateParams(args: {
	expectedVersion: number;
	config: ManagedAgentAuthoringConfig;
}): AgentUpdateParams {
	const params = applyAuthoringFields<AgentUpdateParams>(
		{ version: args.expectedVersion },
		args.config,
	);
	return params;
}

function readCollectionValues(value: unknown, key: string): Record<string, unknown>[] {
	if (!isRecord(value)) {
		return [];
	}
	const group = value[key];
	if (!isRecord(group) || !Array.isArray(group.values)) {
		return [];
	}
	return group.values.filter(isRecord);
}

export function parseManagedSessionResources(value: unknown): ManagedSessionResourceParam[] | undefined {
	const resources: ManagedSessionResourceParam[] = [];

	for (const entry of readCollectionValues(value, 'fileResources')) {
		const fileId = normalizeOptionalString(typeof entry.fileId === 'string' ? entry.fileId : undefined);
		if (!fileId) continue;
		const mountPath = normalizeOptionalString(typeof entry.mountPath === 'string' ? entry.mountPath : undefined);
		resources.push({
			type: 'file',
			file_id: fileId,
			...(mountPath ? { mount_path: mountPath } : {}),
		});
	}

	for (const entry of readCollectionValues(value, 'githubRepositoryResources')) {
		const url = normalizeOptionalString(typeof entry.url === 'string' ? entry.url : undefined);
		const token = normalizeOptionalString(typeof entry.authorizationToken === 'string' ? entry.authorizationToken : undefined);
		if (!url || !token) continue;
		const mountPath = normalizeOptionalString(typeof entry.mountPath === 'string' ? entry.mountPath : undefined);
		const checkoutType = entry.checkoutType;
		const branch = normalizeOptionalString(typeof entry.checkoutBranch === 'string' ? entry.checkoutBranch : undefined);
		const commit = normalizeOptionalString(typeof entry.checkoutCommit === 'string' ? entry.checkoutCommit : undefined);
		const checkout =
			checkoutType === 'branch' && branch
				? { type: 'branch' as const, name: branch }
				: checkoutType === 'commit' && commit
					? { type: 'commit' as const, sha: commit }
					: undefined;
		resources.push({
			type: 'github_repository',
			url,
			authorization_token: token,
			...(mountPath ? { mount_path: mountPath } : {}),
			...(checkout ? { checkout } : {}),
		});
	}

	for (const entry of readCollectionValues(value, 'memoryStoreResources')) {
		const memoryStoreId = normalizeOptionalString(typeof entry.memoryStoreId === 'string' ? entry.memoryStoreId : undefined);
		if (!memoryStoreId) continue;
		const access = entry.access === 'read_write' || entry.access === 'read_only'
			? entry.access
			: undefined;
		const instructions = normalizeOptionalString(typeof entry.instructions === 'string' ? entry.instructions : undefined);
		resources.push({
			type: 'memory_store',
			memory_store_id: memoryStoreId,
			...(access ? { access } : {}),
			...(instructions ? { instructions } : {}),
		});
	}

	return resources.length > 0 ? resources : undefined;
}
