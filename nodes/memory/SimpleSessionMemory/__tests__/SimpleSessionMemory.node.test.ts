import type { INode, ISupplyDataFunctions } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ISessionMemory } from '../SimpleSessionMemory.node';
import { SimpleSessionMemory } from '../SimpleSessionMemory.node';

let workflowCounter = 0;

function createSupplyContext(sessionTTL: number): ISupplyDataFunctions {
	const node = {
		name: 'Simple Session Memory',
		type: 'simpleSessionMemory',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	} as INode;
	const workflowId = `workflow-simple-${workflowCounter++}`;

	const ctx: Partial<ISupplyDataFunctions> & { parentNode: { name: string } } = {
		parentNode: { name: 'Claude Agent SDK' },
		getNodeParameter: vi.fn((name: string, _itemIndex: number, defaultValue?: unknown) => {
			if (name === 'sessionTTL') return sessionTTL;
			return defaultValue;
		}),
		getWorkflow: vi.fn(() => ({ id: workflowId }) as never),
		getNode: vi.fn(() => node),
	};

	return ctx as ISupplyDataFunctions;
}

async function createMemory(sessionTTL: number): Promise<ISessionMemory> {
	const node = new SimpleSessionMemory();
	const supply = await node.supplyData.call(createSupplyContext(sessionTTL), 0);
	return supply.response as ISessionMemory;
}

describe('SimpleSessionMemory', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('expires sessions after the configured TTL in hours', async () => {
		const memory = await createMemory(0.5);

		await memory.touch('chat-ttl');
		expect(await memory.has('chat-ttl')).toBe(true);

		vi.setSystemTime(new Date('2026-01-01T00:31:00.000Z'));

		expect(await memory.has('chat-ttl')).toBe(false);
	});

	it('keeps sessions indefinitely when TTL is 0', async () => {
		const memory = await createMemory(0);

		await memory.touch('chat-no-expiry');
		vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

		expect(await memory.has('chat-no-expiry')).toBe(true);
	});
});
