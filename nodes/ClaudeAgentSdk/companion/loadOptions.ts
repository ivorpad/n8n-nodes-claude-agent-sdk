import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';

import { type CompanionAgentSummary, listCompanionAgents } from './client';
import { COMPANION_AGENT_OPTION_VALUES, normalizeCompanionAgentId } from './agentId';

interface AgentPlaneCredentials {
	apiKey?: string;
}

export async function listCompanionAgentsLoadOption(
	ctx: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const options = await listCompanionAgentOptions(ctx);
	return prependStaleWarning(options, readCurrentCompanionAgentId(ctx));
}

export async function listCompanionAgentsSearch(
	ctx: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const options = await listCompanionAgentOptions(ctx);
	const normalizedFilter = filter?.trim().toLowerCase();
	const results = options
		.filter((option) => {
			if (!normalizedFilter) return true;
			return (
				option.name.toLowerCase().includes(normalizedFilter) ||
				String(option.value).toLowerCase().includes(normalizedFilter) ||
				option.description?.toLowerCase().includes(normalizedFilter)
			);
		})
		.map((option): INodeListSearchItems => ({
			name: option.name,
			value: option.value,
			description: option.description,
		}));

	return { results };
}

async function listCompanionAgentOptions(
	ctx: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const apiKey = await resolveCompanionApiKey(ctx);
	if (!apiKey) {
		return [
			{
				name: 'Set an Agent Plane Credential to Load Agents',
				value: COMPANION_AGENT_OPTION_VALUES.missingCredential,
			},
		];
	}

	try {
		const agents = await listCompanionAgents(apiKey);
		if (agents.length === 0) {
			return [
				{
					name: 'No Agent Plane Agents Found for This API Key',
					value: COMPANION_AGENT_OPTION_VALUES.noAgents,
				},
			];
		}

		return buildAgentOptions(agents);
	} catch (error) {
		return [
			{
				name: `Failed to Load Agent Plane Agents: ${
					error instanceof Error ? error.message : String(error)
				}`,
				value: COMPANION_AGENT_OPTION_VALUES.loadFailed,
			},
		];
	}
}

async function resolveCompanionApiKey(ctx: ILoadOptionsFunctions): Promise<string | undefined> {
	try {
		const credentials = await ctx.getCredentials<AgentPlaneCredentials>('claudeAgentCompanionApi');
		const apiKey = credentials.apiKey?.trim();
		return apiKey || undefined;
	} catch {
		return undefined;
	}
}

function readCurrentCompanionAgentId(ctx: ILoadOptionsFunctions): string {
	for (const parameterName of ['companionAgent.companionAgentId', 'companionAgentId']) {
		try {
			const currentValue = ctx.getCurrentNodeParameter(parameterName);
			const normalized = normalizeCompanionAgentId(currentValue);
			if (normalized) return normalized;
		} catch {
			// Fall through to the next current-value source.
		}
	}

	try {
		const companionAgent = ctx.getNodeParameter('companionAgent', {});
		const currentValue = readCompanionAgentIdFromObject(companionAgent);
		if (currentValue) return currentValue;
	} catch {
		// Fall through to current-node parameters below.
	}

	const parameters = ctx.getCurrentNodeParameters();
	return readCompanionAgentIdFromObject(parameters?.companionAgent);
}

function readCompanionAgentIdFromObject(value: unknown): string {
	if (!value || typeof value !== 'object') return '';
	const currentValue = (value as Record<string, unknown>).companionAgentId;
	return normalizeCompanionAgentId(currentValue);
}

function buildAgentOptions(agents: CompanionAgentSummary[]): INodePropertyOptions[] {
	const options = agents.map((agent) => ({
		name: `${agent.name} (${agent.agentId})`,
		value: agent.agentId,
		description: buildAgentDescription(agent),
	}));
	options.sort((a, b) => a.name.localeCompare(b.name));
	return options;
}

function buildAgentDescription(agent: {
	agentId: string;
	description?: string;
	directoryStatus?: string;
	syncStatus?: string;
	workingDirectory?: string;
	localWorkingDirectory?: string;
}): string {
	const status = [agent.directoryStatus, agent.syncStatus].filter(Boolean).join(' / ');
	const visibleWorkingDirectory = agent.localWorkingDirectory ?? agent.workingDirectory;
	return [agent.description, agent.agentId, status, visibleWorkingDirectory]
		.filter((value): value is string => typeof value === 'string' && value.length > 0)
		.join(' - ');
}

function prependStaleWarning(
	options: INodePropertyOptions[],
	storedValue: string,
): INodePropertyOptions[] {
	if (!storedValue) return options;
	if (options.some((option) => option.value === storedValue)) return options;
	return [
		{
			name: `Stale Agent Plane Agent (${storedValue}) - Re-Pick Below`,
			value: storedValue,
			description: `${storedValue} is not visible to the current Agent Plane API key.`,
		},
		...options,
	];
}
