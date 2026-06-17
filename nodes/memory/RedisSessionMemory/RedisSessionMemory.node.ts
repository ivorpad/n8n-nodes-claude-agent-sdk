import {
	NodeConnectionTypes,
	NodeOperationError,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';
import type { RedisClientOptions } from 'redis';
import { createClient } from 'redis';

import type { ISessionMemory } from '../SimpleSessionMemory/SimpleSessionMemory.node';

interface RedisCredentials {
	host: string;
	port: number;
	database: number;
	password?: string;
	ssl?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasParentNode(
	ctx: ISupplyDataFunctions,
): ctx is ISupplyDataFunctions & { parentNode: { name: string } } {
	const parentNode = Reflect.get(ctx, 'parentNode');
	return (
		isRecord(parentNode)
		&& typeof parentNode.name === 'string'
	);
}

export class RedisSessionMemory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Redis Session Memory',
		name: 'redisSessionMemory',
		icon: 'file:redis.svg',
		group: ['transform'],
		version: 1,
		description: 'Tracks session existence and metadata in Redis for deterministic session resume',
		defaults: {
			name: 'Redis Session Memory',
		},
		credentials: [
			{
				name: 'redis',
				required: true,
			},
		],
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Memory'],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiMemory],
		outputNames: ['Memory'],
		properties: [
			{
				displayName: 'Key Prefix',
				name: 'keyPrefix',
				type: 'string',
				default: 'claude_session:',
				description: 'Prefix for Redis keys storing session metadata',
			},
			{
				displayName: 'Session TTL (Seconds)',
				name: 'sessionTTL',
				type: 'number',
				default: 3600,
				description: 'How long to keep sessions in Redis (in seconds). Set to 0 for no expiration.',
			},
		],
		usableAsTool: true,
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials<RedisCredentials>('redis');
		const keyPrefix = this.getNodeParameter('keyPrefix', itemIndex, 'claude_session:') as string;
		const sessionTTL = this.getNodeParameter('sessionTTL', itemIndex, 3600) as number;
		const workflowId = this.getWorkflow().id;

		// Get parent node name for namespacing (e.g., "Claude Agent SDK HR" -> "Claude_Agent_SDK_HR")
		const parentNodeName = hasParentNode(this)
			? this.parentNode.name.replace(/\s+/g, '_')
			: 'default';

		const redisOptions: RedisClientOptions = {
			socket: {
				host: credentials.host as string,
				port: credentials.port as number,
				tls: credentials.ssl === true,
			},
			database: credentials.database as number,
		};

		if (credentials.password) {
			redisOptions.password = credentials.password as string;
		}

		const client = createClient(redisOptions);
		const node = this.getNode();
		let connectionError: Error | undefined;
		let closingAfterError = false;

		const rememberConnectionError = (error: Error) => {
			connectionError = error;
			if (closingAfterError) return;
			closingAfterError = true;
			void client.quit().catch(() => {
				void client.disconnect().catch(() => undefined);
			});
		};

		const assertRedisHealthy = () => {
			if (!connectionError) return;
			throw new NodeOperationError(node, `Redis Error: ${connectionError.message}`);
		};

		client.on('error', rememberConnectionError);

		await client.connect();

		const sessionMemory: ISessionMemory = {
			type: 'claude-session-memory',
			async has(sessionId: string): Promise<boolean> {
				assertRedisHealthy();
				// Key is workflowId + sessionId only (not parentNodeName) so renaming nodes doesn't break sessions
				const key = `${keyPrefix}${workflowId}:${sessionId}`;
				const exists = await client.exists(key);
				assertRedisHealthy();
				return exists === 1;
			},
			async getMetadata(sessionId: string): Promise<{ workingDirectory?: string; managedAgentSessionId?: string } | undefined> {
				assertRedisHealthy();
				const key = `${keyPrefix}${workflowId}:${sessionId}`;
				const workingDirectory = await client.hGet(key, 'workingDirectory');
				const managedAgentSessionId = await client.hGet(key, 'managedAgentSessionId');
				assertRedisHealthy();
				if (!workingDirectory && !managedAgentSessionId) return undefined;
				return {
					...(workingDirectory && { workingDirectory }),
					...(managedAgentSessionId && { managedAgentSessionId }),
				};
			},
			async touch(
				sessionId: string,
				nodeNameForAnalytics?: string,
				metadata?: { workingDirectory?: string; managedAgentSessionId?: string },
			): Promise<void> {
				assertRedisHealthy();
				// Key is workflowId + sessionId only; parentNodeName stored separately for analytics
				const key = `${keyPrefix}${workflowId}:${sessionId}`;
				const payload: Record<string, string> = {
					sessionId,
					parentNodeName: nodeNameForAnalytics || parentNodeName,
					updatedAt: new Date().toISOString(),
				};
				if (metadata?.workingDirectory) {
					payload.workingDirectory = metadata.workingDirectory;
				}
				if (metadata?.managedAgentSessionId) {
					payload.managedAgentSessionId = metadata.managedAgentSessionId;
				}
				await client.hSet(key, payload);
				if (sessionTTL > 0) {
					await client.expire(key, sessionTTL);
				}
				assertRedisHealthy();
			},
		};

		return {
			response: sessionMemory,
			closeFunction: async () => {
				await client.disconnect();
			},
		};
	}
}
