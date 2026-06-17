import { beforeEach, describe, expect, it, vi } from 'vitest';

import { managedAgentLifecycleOperation } from '../../operations/managedAgentLifecycle';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

const anthropicMocks = vi.hoisted(() => ({
	agentsCreate: vi.fn(),
	agentsRetrieve: vi.fn(),
	agentsUpdate: vi.fn(),
	versionsList: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: vi.fn(function AnthropicMock() {
		return {
			beta: {
				agents: {
					create: anthropicMocks.agentsCreate,
					retrieve: anthropicMocks.agentsRetrieve,
					update: anthropicMocks.agentsUpdate,
					versions: {
						list: anthropicMocks.versionsList,
					},
				},
			},
		};
	}),
}));

function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}

describe('managedAgentLifecycleOperation', () => {
	beforeEach(() => {
		anthropicMocks.agentsCreate.mockReset();
		anthropicMocks.agentsRetrieve.mockReset();
		anthropicMocks.agentsUpdate.mockReset();
		anthropicMocks.versionsList.mockReset();
	});

	it('creates a managed agent', async () => {
		anthropicMocks.agentsCreate.mockResolvedValue({
			id: 'agent_new',
			version: 1,
			name: 'New Agent',
		});
		const ctx = createMockExecuteFunctions({
			managedAgentOperation: 'create',
			managedAuthoringName: 'New Agent',
			managedAuthoringModel: 'claude-sonnet-4-6',
			managedAuthoringSystem: 'Be useful.',
		});

		const result = await managedAgentLifecycleOperation({
			execFunctions: ctx,
			itemIndex: 0,
			apiKey: 'test-api-key',
		});

		expect(anthropicMocks.agentsCreate).toHaveBeenCalledWith({
			name: 'New Agent',
			model: 'claude-sonnet-4-6',
			system: 'Be useful.',
		});
		expect(result.json).toMatchObject({
			type: 'managed_agent',
			operation: 'create',
			agentId: 'agent_new',
			version: 1,
		});
	});

	it('inspects a pinned agent version', async () => {
		anthropicMocks.agentsRetrieve.mockResolvedValue({
			id: 'agent_123',
			version: 4,
			name: 'Pinned Agent',
		});
		const ctx = createMockExecuteFunctions({
			managedAgentOperation: 'inspect',
			managedLifecycleAgentId: 'agent_123',
			managedLifecycleAgentVersion: 4,
		});

		const result = await managedAgentLifecycleOperation({
			execFunctions: ctx,
			itemIndex: 0,
			apiKey: 'test-api-key',
		});

		expect(anthropicMocks.agentsRetrieve).toHaveBeenCalledWith('agent_123', { version: 4 });
		expect(result.json).toMatchObject({
			type: 'managed_agent',
			operation: 'inspect',
			agentId: 'agent_123',
			version: 4,
		});
	});

	it('updates only after expected version matches current version', async () => {
		anthropicMocks.agentsRetrieve.mockResolvedValue({
			id: 'agent_123',
			version: 5,
			name: 'Current Agent',
		});
		anthropicMocks.agentsUpdate.mockResolvedValue({
			id: 'agent_123',
			version: 6,
			name: 'Updated Agent',
		});
		const ctx = createMockExecuteFunctions({
			managedAgentOperation: 'update',
			managedLifecycleAgentId: 'agent_123',
			managedAgentExpectedVersion: 5,
			managedAuthoringName: 'Updated Agent',
			managedAuthoringMetadataJson: '{"owner":"ops"}',
		});

		const result = await managedAgentLifecycleOperation({
			execFunctions: ctx,
			itemIndex: 0,
			apiKey: 'test-api-key',
		});

		expect(anthropicMocks.agentsRetrieve).toHaveBeenCalledWith('agent_123');
		expect(anthropicMocks.agentsUpdate).toHaveBeenCalledWith('agent_123', {
			version: 5,
			name: 'Updated Agent',
			metadata: { owner: 'ops' },
		});
		expect(result.json).toMatchObject({
			type: 'managed_agent',
			operation: 'update',
			agentId: 'agent_123',
			previousVersion: 5,
			version: 6,
			changedFields: ['name', 'metadata'],
		});
	});

	it('rejects update when expected version is stale', async () => {
		anthropicMocks.agentsRetrieve.mockResolvedValue({
			id: 'agent_123',
			version: 6,
			name: 'Current Agent',
		});
		const ctx = createMockExecuteFunctions({
			managedAgentOperation: 'update',
			managedLifecycleAgentId: 'agent_123',
			managedAgentExpectedVersion: 5,
			managedAuthoringName: 'Updated Agent',
		});

		await expect(managedAgentLifecycleOperation({
			execFunctions: ctx,
			itemIndex: 0,
			apiKey: 'test-api-key',
		})).rejects.toThrow(/version mismatch/i);
		expect(anthropicMocks.agentsUpdate).not.toHaveBeenCalled();
	});

	it('lists managed agent versions', async () => {
		anthropicMocks.versionsList.mockReturnValue(makeAsyncIterable([
			{ id: 'agent_123', version: 1 },
			{ id: 'agent_123', version: 2 },
		]));
		const ctx = createMockExecuteFunctions({
			managedAgentOperation: 'listVersions',
			managedLifecycleAgentId: 'agent_123',
		});

		const result = await managedAgentLifecycleOperation({
			execFunctions: ctx,
			itemIndex: 0,
			apiKey: 'test-api-key',
		});

		expect(anthropicMocks.versionsList).toHaveBeenCalledWith('agent_123');
		expect(result.json).toEqual({
			type: 'managed_agent_versions',
			operation: 'listVersions',
			agentId: 'agent_123',
			count: 2,
			versions: [
				{ id: 'agent_123', version: 1 },
				{ id: 'agent_123', version: 2 },
			],
		});
	});
});
