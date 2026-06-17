import { EventEmitter } from 'node:events';

import type { INode, ISupplyDataFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import type { ISessionMemory } from '../../SimpleSessionMemory/SimpleSessionMemory.node';
import { RedisSessionMemory } from '../RedisSessionMemory.node';

const redisMocks = vi.hoisted(() => ({
	createClient: vi.fn(),
}));

vi.mock('redis', () => ({
	createClient: redisMocks.createClient,
}));

class FakeRedisClient extends EventEmitter {
	connect = vi.fn(async () => undefined);
	quit = vi.fn(async () => undefined);
	disconnect = vi.fn(async () => undefined);
	exists = vi.fn(async () => 0);
	hGet = vi.fn(async () => undefined);
	hSet = vi.fn(async () => undefined);
	expire = vi.fn(async () => undefined);
}

function createSupplyContext(): ISupplyDataFunctions {
	const node = {
		name: 'Redis Session Memory',
		type: 'redisSessionMemory',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	} as INode;

	const ctx: Partial<ISupplyDataFunctions> & { parentNode: { name: string } } = {
		parentNode: { name: 'Claude Agent SDK' },
		getCredentials: vi.fn(async () => ({
			host: 'localhost',
			port: 6379,
			database: 0,
		})),
		getNodeParameter: vi.fn((_name: string, _itemIndex: number, defaultValue?: unknown) => defaultValue),
		getWorkflow: vi.fn(() => ({ id: 'workflow-1' }) as never),
		getNode: vi.fn(() => node),
	};

	return ctx as ISupplyDataFunctions;
}

describe('RedisSessionMemory', () => {
	it('stores async Redis client errors and surfaces them from awaited memory methods', async () => {
		const fakeClient = new FakeRedisClient();
		redisMocks.createClient.mockReturnValue(fakeClient);

		const node = new RedisSessionMemory();
		const supply = await node.supplyData.call(createSupplyContext(), 0);
		const memory = supply.response as ISessionMemory;

		expect(() => fakeClient.emit('error', new Error('boom'))).not.toThrow();
		expect(fakeClient.quit).toHaveBeenCalledTimes(1);

		await expect(memory.has('chat-1')).rejects.toThrow(/Redis Error: boom/);
		await expect(memory.getMetadata?.('chat-1')).rejects.toThrow(/Redis Error: boom/);
		await expect(memory.touch('chat-1')).rejects.toThrow(/Redis Error: boom/);

		expect(fakeClient.exists).not.toHaveBeenCalled();
		expect(fakeClient.hSet).not.toHaveBeenCalled();
	});
});
