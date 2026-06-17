import { describe, expect, it } from 'vitest';

import {
	buildManagedAgentCreateParams,
	buildManagedAgentUpdateParams,
	buildManagedSessionCreateParams,
	parseManagedSessionResources,
	parseMetadataJson,
	parseMetadataPatchJson,
} from '../../managedAgent/configuration';

describe('managed agent configuration helpers', () => {
	it('builds latest and pinned session create payloads', () => {
		expect(buildManagedSessionCreateParams({
			agentId: 'agent_123',
			environmentId: 'env_123',
		})).toEqual({
			agent: 'agent_123',
			environment_id: 'env_123',
		});

		expect(buildManagedSessionCreateParams({
			agentId: 'agent_123',
			environmentId: 'env_123',
			agentVersion: 7,
			vaultIds: ['vlt_123'],
			metadata: { workflow: 'qa' },
			title: 'QA run',
		})).toEqual({
			agent: {
				type: 'agent',
				id: 'agent_123',
				version: 7,
			},
			environment_id: 'env_123',
			vault_ids: ['vlt_123'],
			metadata: { workflow: 'qa' },
			title: 'QA run',
		});
	});

	it('parses typed managed session resources', () => {
		const repositoryAccessToken = 'repository-access-placeholder';
		const resources = parseManagedSessionResources({
			fileResources: {
				values: [
					{ fileId: 'file_123', mountPath: '/mnt/session/uploads/spec.md' },
				],
			},
			githubRepositoryResources: {
				values: [
					{
						url: 'https://github.com/org/repo',
						authorizationToken: repositoryAccessToken,
						checkoutType: 'branch',
						checkoutBranch: 'main',
						mountPath: '/workspace/repo',
					},
				],
			},
			memoryStoreResources: {
				values: [
					{
						memoryStoreId: 'memstore_123',
						access: 'read_only',
						instructions: 'Use for customer preferences.',
					},
				],
			},
		});

		expect(resources).toHaveLength(3);
		expect(resources?.[0]).toEqual(
			{
				type: 'file',
				file_id: 'file_123',
				mount_path: '/mnt/session/uploads/spec.md',
			},
		);
		expect(resources?.[1]).toMatchObject(
			{
				type: 'github_repository',
				url: 'https://github.com/org/repo',
				checkout: { type: 'branch', name: 'main' },
				mount_path: '/workspace/repo',
			},
		);
		expect(resources?.[1]).toHaveProperty('authorization_token');
		expect(resources?.[2]).toEqual(
			{
				type: 'memory_store',
				memory_store_id: 'memstore_123',
				access: 'read_only',
				instructions: 'Use for customer preferences.',
			},
		);
	});

	it('builds create and update payloads with structured fields and raw overrides', () => {
		expect(buildManagedAgentCreateParams({
			name: 'Researcher',
			model: 'claude-sonnet-4-6',
			modelSpeed: 'fast',
			system: 'Be precise.',
			metadata: { team: 'ops' },
			tools: [{ type: 'agent_toolset_20260401' }],
		})).toEqual({
			name: 'Researcher',
			model: {
				id: 'claude-sonnet-4-6',
				speed: 'fast',
			},
			system: 'Be precise.',
			metadata: { team: 'ops' },
			tools: [{ type: 'agent_toolset_20260401' }],
		});

		expect(buildManagedAgentUpdateParams({
			expectedVersion: 4,
			config: {
				name: 'Updated',
				metadataPatch: { team: null, owner: 'ivor' },
				rawConfig: { system: null },
			},
		})).toEqual({
			version: 4,
			name: 'Updated',
			metadata: { team: null, owner: 'ivor' },
			system: null,
		});
	});

	it('validates metadata value types', () => {
		expect(parseMetadataJson('{"team":"ops"}')).toEqual({ team: 'ops' });
		expect(parseMetadataPatchJson('{"team":null,"owner":"ivor"}')).toEqual({
			team: null,
			owner: 'ivor',
		});
		expect(() => parseMetadataJson('{"team":123}')).toThrow(/team must be a string/);
		expect(() => parseMetadataPatchJson('{"team":123}')).toThrow(/team must be a string or null/);
	});
});
