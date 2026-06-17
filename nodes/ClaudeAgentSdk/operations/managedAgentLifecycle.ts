import Anthropic from '@anthropic-ai/sdk';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildManagedAgentCreateParams,
	buildManagedAgentUpdateParams,
	parseJsonArray,
	parseJsonObject,
	parseMetadataJson,
	parseMetadataPatchJson,
	parsePositiveInteger,
	type ManagedAgentAuthoringConfig,
} from '../managedAgent/configuration';

type ManagedAgentOperation = 'create' | 'inspect' | 'update' | 'listVersions';

function readTrimmed(
	execFunctions: IExecuteFunctions,
	name: string,
	itemIndex: number,
): string | undefined {
	const value = execFunctions.getNodeParameter(name, itemIndex, '') as string;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function readNullableTrimmed(
	execFunctions: IExecuteFunctions,
	name: string,
	itemIndex: number,
): string | null | undefined {
	const value = readTrimmed(execFunctions, name, itemIndex);
	return value === undefined ? undefined : value;
}

function readModelSpeed(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): 'standard' | 'fast' | undefined {
	const value = execFunctions.getNodeParameter('managedAuthoringModelSpeed', itemIndex, '') as string;
	if (value === 'standard' || value === 'fast') {
		return value;
	}
	return undefined;
}

function buildAuthoringConfig(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	operation: Extract<ManagedAgentOperation, 'create' | 'update'>,
): ManagedAgentAuthoringConfig {
	const metadataJson = readTrimmed(execFunctions, 'managedAuthoringMetadataJson', itemIndex);
	return {
		name: readTrimmed(execFunctions, 'managedAuthoringName', itemIndex),
		model: readTrimmed(execFunctions, 'managedAuthoringModel', itemIndex),
		modelSpeed: readModelSpeed(execFunctions, itemIndex),
		system: readNullableTrimmed(execFunctions, 'managedAuthoringSystem', itemIndex),
		description: readNullableTrimmed(execFunctions, 'managedAuthoringDescription', itemIndex),
		metadata: operation === 'create' ? parseMetadataJson(metadataJson) : undefined,
		metadataPatch: operation === 'update' ? parseMetadataPatchJson(metadataJson) : undefined,
		tools: parseJsonArray(readTrimmed(execFunctions, 'managedAuthoringToolsJson', itemIndex), 'Tools JSON'),
		mcpServers: parseJsonArray(
			readTrimmed(execFunctions, 'managedAuthoringMcpServersJson', itemIndex),
			'MCP Servers JSON',
		),
		skills: parseJsonArray(readTrimmed(execFunctions, 'managedAuthoringSkillsJson', itemIndex), 'Skills JSON'),
		multiagent: parseJsonObject(
			readTrimmed(execFunctions, 'managedAuthoringMultiagentJson', itemIndex),
			'Multiagent Config JSON',
		),
		rawConfig: parseJsonObject(readTrimmed(execFunctions, 'managedAuthoringRawJson', itemIndex), 'Raw Config JSON'),
	};
}

function readAgentId(execFunctions: IExecuteFunctions, itemIndex: number): string {
	const agentId = readTrimmed(execFunctions, 'managedLifecycleAgentId', itemIndex);
	if (!agentId) {
		throw new NodeOperationError(
			execFunctions.getNode(),
			'Managed Agent ID is required for this operation.',
			{ itemIndex },
		);
	}
	return agentId;
}

async function collectPage<T>(page: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const entry of page) {
		out.push(entry);
	}
	return out;
}

function changedFieldsFromUpdatePayload(payload: Record<string, unknown>): string[] {
	return Object.keys(payload).filter((key) => key !== 'version' && key !== 'betas');
}

export async function managedAgentLifecycleOperation(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	apiKey: string;
}): Promise<INodeExecutionData> {
	const { execFunctions, itemIndex, apiKey } = args;
	const operation = execFunctions.getNodeParameter(
		'managedAgentOperation',
		itemIndex,
		'inspect',
	) as ManagedAgentOperation;
	const client = new Anthropic({ apiKey });

	if (operation === 'create') {
		const payload = buildManagedAgentCreateParams(
			buildAuthoringConfig(execFunctions, itemIndex, operation),
		);
		const agent = await client.beta.agents.create(payload);
		return {
			json: {
				type: 'managed_agent',
				operation,
				agentId: agent.id,
				version: agent.version,
				agent,
			},
			pairedItem: { item: itemIndex },
		};
	}

	const agentId = readAgentId(execFunctions, itemIndex);

	if (operation === 'inspect') {
		const version = parsePositiveInteger(
			execFunctions.getNodeParameter('managedLifecycleAgentVersion', itemIndex, 0) as number,
			'Version',
		);
		const agent = version
			? await client.beta.agents.retrieve(agentId, { version })
			: await client.beta.agents.retrieve(agentId);
		return {
			json: {
				type: 'managed_agent',
				operation,
				agentId: agent.id,
				version: agent.version,
				agent,
			},
			pairedItem: { item: itemIndex },
		};
	}

	if (operation === 'listVersions') {
		const versions = await collectPage(client.beta.agents.versions.list(agentId));
		return {
			json: {
				type: 'managed_agent_versions',
				operation,
				agentId,
				count: versions.length,
				versions,
			},
			pairedItem: { item: itemIndex },
		};
	}

	const expectedVersion = parsePositiveInteger(
		execFunctions.getNodeParameter('managedAgentExpectedVersion', itemIndex, 1) as number,
		'Expected Current Version',
	);
	if (!expectedVersion) {
		throw new NodeOperationError(
			execFunctions.getNode(),
			'Expected Current Version is required for Managed Agent updates.',
			{ itemIndex },
		);
	}
	const current = await client.beta.agents.retrieve(agentId);
	if (current.version !== expectedVersion) {
		throw new NodeOperationError(
			execFunctions.getNode(),
			`Managed Agent version mismatch. Expected version ${expectedVersion}, but Anthropic returned version ${current.version}. Inspect the agent and retry with the current version.`,
			{ itemIndex },
		);
	}
	const payload = buildManagedAgentUpdateParams({
		expectedVersion,
		config: buildAuthoringConfig(execFunctions, itemIndex, operation),
	});
	const updated = await client.beta.agents.update(agentId, payload);
	return {
		json: {
			type: 'managed_agent',
			operation,
			agentId: updated.id,
			previousVersion: current.version,
			version: updated.version,
			changedFields: changedFieldsFromUpdatePayload(payload as unknown as Record<string, unknown>),
			agent: updated,
		},
		pairedItem: { item: itemIndex },
	};
}
