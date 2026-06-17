/**
 * Edge Cases - MCP
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';

import { buildMcpServersConfig, buildBlockedToolsList } from '../mcp';

describe('Edge Cases - MCP', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;

	beforeEach(() => {
		mockExec = mock<IExecuteFunctions>();
	});

	it('should handle server name with special characters', async () => {
		const servers = [
			{
				name: 'server/with:special$chars',
				type: 'http' as const,
				url: 'https://api.example.com',
				authentication: 'none' as const,
			},
		];

		const config = await buildMcpServersConfig(mockExec, servers);
		expect(config['server/with:special$chars']).toBeDefined();
	});

	it('should handle URL with credentials', async () => {
		const servers = [
			{
				name: 'test',
				type: 'http' as const,
				url: 'https://user:pass@api.example.com',
				authentication: 'none' as const,
			},
		];

		const config = await buildMcpServersConfig(mockExec, servers);
		expect(config.test.url).toContain('user:pass');
	});

	it('should handle very long args string', async () => {
		const servers = [
			{
				name: 'test',
				type: 'stdio' as const,
				command: 'node',
				args: Array(1000).fill('arg').join(','),
			},
		];

		const config = await buildMcpServersConfig(mockExec, servers);
		expect(config.test.args?.length).toBe(1000);
	});

	it('should handle empty headers JSON', async () => {
		const servers = [
			{
				name: 'test',
				type: 'http' as const,
				url: 'https://api.example.com',
				authentication: 'custom' as const,
				headers: '{}',
			},
		];

		const config = await buildMcpServersConfig(mockExec, servers);
		// Empty headers should not be included
		expect(config.test.headers).toBeUndefined();
	});

	it('emits per-tool permission_policy on http servers (SDK 0.2.111)', async () => {
		const servers = [
			{
				name: 'corp-api',
				type: 'http' as const,
				url: 'https://api.example.com',
				toolPolicies: {
					entries: [
						{ name: 'search_web', permission_policy: 'always_allow' as const },
						{ name: 'delete_user', permission_policy: 'always_deny' as const },
						{ name: '   ', permission_policy: 'always_ask' as const },
					],
				},
			},
		];

		const config = await buildMcpServersConfig(mockExec, servers);
		const httpConfig = config['corp-api'] as { tools?: Array<{ name: string; permission_policy: string }> };
		expect(httpConfig.tools).toEqual([
			{ name: 'search_web', permission_policy: 'always_allow' },
			{ name: 'delete_user', permission_policy: 'always_deny' },
		]);
	});

	it('omits tools key when no policies are defined', async () => {
		const servers = [
			{
				name: 'plain',
				type: 'http' as const,
				url: 'https://api.example.com',
			},
		];

		const config = await buildMcpServersConfig(mockExec, servers);
		expect((config.plain as { tools?: unknown }).tools).toBeUndefined();
	});

	describe('buildBlockedToolsList edge cases', () => {
		it('should handle tools with mcp__ prefix from wrong server', () => {
			const result = buildBlockedToolsList(undefined, [
				{
					name: 'server1',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'block',
					blockedTools: 'mcp__server2__tool', // Different server prefix
				},
			]);

			// Should preserve the original prefix
			expect(result).toContain('mcp__server2__tool');
			expect(result).not.toContain('mcp__server1__mcp__server2__tool');
		});
	});
});

