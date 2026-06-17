/**
 * MCP Server Configuration Tests
 *
 * Tests for MCP server configuration utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { buildMcpServersConfig, buildBlockedToolsList } from '../mcp';
import type { McpServerUI } from '../types';

describe('MCP Server Configuration', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockExec = mock<IExecuteFunctions>();
	});

	describe('buildMcpServersConfig', () => {
		describe('HTTP/SSE servers', () => {
			it('should build HTTP server config', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'test-server',
						type: 'http',
						url: 'https://api.example.com/mcp',
						authentication: 'none',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['test-server']).toEqual({
					type: 'http',
					url: 'https://api.example.com/mcp',
				});
			});

			it('should build SSE server config', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'sse-server',
						type: 'sse',
						url: 'https://api.example.com/events',
						authentication: 'none',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['sse-server']).toEqual({
					type: 'sse',
					url: 'https://api.example.com/events',
				});
			});

			it('should add headers from credential', async () => {
				mockExec.getCredentials.mockResolvedValue({
					headerName: 'X-API-Key',
					headerValue: 'secret-key-123',
				});

				const servers: McpServerUI[] = [
					{
						name: 'auth-server',
						type: 'http',
						url: 'https://api.example.com',
						authentication: 'credential',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['auth-server'].headers).toEqual({
					'X-API-Key': 'secret-key-123',
				});
			});

			it('should throw when credential authentication fails', async () => {
				mockExec.getCredentials.mockRejectedValue(new Error('No credentials'));

				const servers: McpServerUI[] = [
					{
						name: 'auth-server',
						type: 'http',
						url: 'https://api.example.com',
						authentication: 'credential',
					},
				];

				await expect(buildMcpServersConfig(mockExec, servers)).rejects.toThrow(
					'requires authentication',
				);
			});

			it('should add custom headers', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'custom-header-server',
						type: 'http',
						url: 'https://api.example.com',
						authentication: 'custom',
						headers: '{"Authorization": "Bearer token123", "X-Custom": "value"}',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['custom-header-server'].headers).toEqual({
					'Authorization': 'Bearer token123',
					'X-Custom': 'value',
				});
			});

			it('should resolve custom header env vars from process env', async () => {
				const previousToken = process.env.MCP_TEST_PROCESS_TOKEN;
				process.env.MCP_TEST_PROCESS_TOKEN = 'process-token-123';

				try {
					const servers: McpServerUI[] = [
						{
							name: 'env-header-server',
							type: 'http',
							url: 'https://api.example.com',
							authentication: 'custom',
							headers: '{"Authorization": "Bearer ${MCP_TEST_PROCESS_TOKEN}"}',
						},
					];

					const config = await buildMcpServersConfig(mockExec, servers, { ...process.env });

					expect(config['env-header-server'].headers).toEqual({
						Authorization: 'Bearer process-token-123',
					});
				} finally {
					if (previousToken === undefined) {
						delete process.env.MCP_TEST_PROCESS_TOKEN;
					} else {
						process.env.MCP_TEST_PROCESS_TOKEN = previousToken;
					}
				}
			});

			it('should prefer secure env vars over process env when resolving custom headers', async () => {
				const previousToken = process.env.MCP_TEST_SHARED_TOKEN;
				process.env.MCP_TEST_SHARED_TOKEN = 'process-token-123';

				try {
					const servers: McpServerUI[] = [
						{
							name: 'secure-header-server',
							type: 'http',
							url: 'https://api.example.com',
							authentication: 'custom',
							headers: '{"Authorization": "Bearer ${MCP_TEST_SHARED_TOKEN}", "X-Trace": "${MCP_TEST_TRACE_ID}"}',
						},
					];

					const config = await buildMcpServersConfig(mockExec, servers, {
						...process.env,
						MCP_TEST_SHARED_TOKEN: 'secure-token-456',
						MCP_TEST_TRACE_ID: 'trace-789',
					});

					expect(config['secure-header-server'].headers).toEqual({
						Authorization: 'Bearer secure-token-456',
						'X-Trace': 'trace-789',
					});
				} finally {
					if (previousToken === undefined) {
						delete process.env.MCP_TEST_SHARED_TOKEN;
					} else {
						process.env.MCP_TEST_SHARED_TOKEN = previousToken;
					}
				}
			});

			it('should throw on invalid custom headers JSON', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'bad-headers',
						type: 'http',
						url: 'https://api.example.com',
						authentication: 'custom',
						headers: 'not valid json',
					},
				];

				await expect(buildMcpServersConfig(mockExec, servers)).rejects.toThrow(
					'Invalid JSON in headers',
				);
			});
		});

		describe('stdio servers', () => {
			it('should build stdio server config', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'stdio-server',
						type: 'stdio',
						command: 'node',
						args: 'server.js, --port, 8080',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['stdio-server']).toEqual({
					type: 'stdio',
					command: 'node',
					args: ['server.js', '--port', '8080'],
				});
			});

			it('should handle empty args', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'no-args-server',
						type: 'stdio',
						command: 'python',
						args: '',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['no-args-server']).toEqual({
					type: 'stdio',
					command: 'python',
					args: undefined,
				});
			});

			it('should handle undefined args', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'undefined-args-server',
						type: 'stdio',
						command: 'python',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['undefined-args-server'].args).toBeUndefined();
			});

			it('should add environment variables', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'env-server',
						type: 'stdio',
						command: 'node',
						args: 'server.js',
						env: '{"API_KEY": "secret", "DEBUG": "true"}',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(config['env-server'].env).toEqual({
					'API_KEY': 'secret',
					'DEBUG': 'true',
				});
			});

			it('should throw on invalid env JSON', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'bad-env',
						type: 'stdio',
						command: 'node',
						env: 'not valid json',
					},
				];

				await expect(buildMcpServersConfig(mockExec, servers)).rejects.toThrow(
					'Invalid JSON in environment variables',
				);
			});
		});

		describe('edge cases', () => {
			it('should return empty object for undefined servers', async () => {
				const config = await buildMcpServersConfig(mockExec, undefined);
				expect(config).toEqual({});
			});

			it('should return empty object for empty servers array', async () => {
				const config = await buildMcpServersConfig(mockExec, []);
				expect(config).toEqual({});
			});

			it('should skip servers without name', async () => {
				const servers: McpServerUI[] = [
					{
						name: '',
						type: 'http',
						url: 'https://api.example.com',
					},
					{
						name: 'valid-server',
						type: 'http',
						url: 'https://api.example.com',
						authentication: 'none',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(Object.keys(config)).toEqual(['valid-server']);
			});

			it('should handle multiple servers', async () => {
				const servers: McpServerUI[] = [
					{
						name: 'server1',
						type: 'http',
						url: 'https://api1.example.com',
						authentication: 'none',
					},
					{
						name: 'server2',
						type: 'sse',
						url: 'https://api2.example.com',
						authentication: 'none',
					},
					{
						name: 'server3',
						type: 'stdio',
						command: 'node',
						args: 'server.js',
					},
				];

				const config = await buildMcpServersConfig(mockExec, servers);

				expect(Object.keys(config)).toHaveLength(3);
				expect(config['server1'].type).toBe('http');
				expect(config['server2'].type).toBe('sse');
				expect(config['server3'].type).toBe('stdio');
			});
		});
	});

	describe('buildBlockedToolsList', () => {
		it('should return empty array for no input', () => {
			const result = buildBlockedToolsList(undefined, undefined);
			expect(result).toEqual([]);
		});

		it('should parse global blocked tools', () => {
			const result = buildBlockedToolsList('tool1, tool2, tool3', undefined);
			expect(result).toEqual(['tool1', 'tool2', 'tool3']);
		});

		it('should handle global blocked tools with extra whitespace', () => {
			const result = buildBlockedToolsList('  tool1  ,  tool2  ', undefined);
			expect(result).toEqual(['tool1', 'tool2']);
		});

		it('should filter empty strings from global blocked tools', () => {
			const result = buildBlockedToolsList('tool1,,tool2,', undefined);
			expect(result).toEqual(['tool1', 'tool2']);
		});

		it('should add per-server blocked tools with prefix', () => {
			const servers: McpServerUI[] = [
				{
					name: 'myserver',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'block',
					blockedTools: 'dangerous_tool, another_tool',
				},
			];

			const result = buildBlockedToolsList(undefined, servers);

			expect(result).toContain('mcp__myserver__dangerous_tool');
			expect(result).toContain('mcp__myserver__another_tool');
		});

		it('should not add prefix if tool already has mcp__ prefix', () => {
			const servers: McpServerUI[] = [
				{
					name: 'myserver',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'block',
					blockedTools: 'mcp__myserver__existing_tool',
				},
			];

			const result = buildBlockedToolsList(undefined, servers);

			expect(result).toContain('mcp__myserver__existing_tool');
			expect(result).not.toContain('mcp__myserver__mcp__myserver__existing_tool');
		});

		it('should preserve full mcp prefix for different server', () => {
			const servers: McpServerUI[] = [
				{
					name: 'myserver',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'block',
					blockedTools: 'mcp__otherserver__tool',
				},
			];

			const result = buildBlockedToolsList(undefined, servers);

			expect(result).toContain('mcp__otherserver__tool');
		});

		it('should ignore servers without block permission', () => {
			const servers: McpServerUI[] = [
				{
					name: 'server1',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'allow',
					blockedTools: 'should_not_appear',
				},
				{
					name: 'server2',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'block',
					blockedTools: 'blocked_tool',
				},
			];

			const result = buildBlockedToolsList(undefined, servers);

			expect(result).not.toContain('should_not_appear');
			expect(result).toContain('mcp__server2__blocked_tool');
		});

		it('should combine global and per-server blocked tools', () => {
			const servers: McpServerUI[] = [
				{
					name: 'server1',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'block',
					blockedTools: 'server_tool',
				},
			];

			const result = buildBlockedToolsList('global_tool', servers);

			expect(result).toContain('global_tool');
			expect(result).toContain('mcp__server1__server_tool');
		});

		it('should handle servers with empty blockedTools', () => {
			const servers: McpServerUI[] = [
				{
					name: 'server1',
					type: 'http',
					url: 'https://api.example.com',
					toolPermissions: 'block',
					blockedTools: '',
				},
			];

			const result = buildBlockedToolsList(undefined, servers);
			expect(result).toEqual([]);
		});
	});
});
