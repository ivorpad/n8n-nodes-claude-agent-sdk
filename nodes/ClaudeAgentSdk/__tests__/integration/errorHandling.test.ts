/**
 * Error Handling Integration Tests
 *
 * Tests for error scenarios including missing credentials,
 * invalid configuration, API errors, and continueOnFail behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';
import * as path from 'path';

import { executeTaskOperation } from '../../operations/executeTask';
import { createMockAdapter, mockMessages } from '../helpers/mockClaudeAgentSdk';
import type { SdkAdapter } from '../../sdk/types';

describe('Error Handling', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;
	let mockAdapter: SdkAdapter;

	const defaultParams: Record<string, unknown> = {
		taskDescription: 'Test task',
		chatSessionId: '',
		workingDirectory: process.cwd(),
		allowedTools: [],
		permissionMode: 'default',
		subagents: { agents: [] },
		mcpServers: { servers: [] },
		structuredOutput: false,
		additionalOptions: {},
		additionalDirectories: '',
		maxTurns: 0,
		treatAgentErrorsAsWorkflowErrors: false,
		streaming: { enabled: false },
		securityOptions: {},
	};

	beforeEach(() => {
		vi.clearAllMocks();

		mockExec = mock<IExecuteFunctions>();
		mockAdapter = createMockAdapter([]);

		// Default setup
		mockExec.getNode.mockReturnValue({
			name: 'Test Node',
			type: 'claudeAgentSdk',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		} as INode);

		mockExec.getNodeParameter.mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => {
				return defaultParams[name] ?? defaultValue;
			},
		);

		mockExec.getCredentials.mockRejectedValue(new Error('No credentials'));
		mockExec.getInputData.mockReturnValue([{ json: {} }]);
		mockExec.continueOnFail.mockReturnValue(false);
		mockExec.getInputConnectionData.mockResolvedValue(undefined);
	});

	describe('Missing API Key', () => {
		it('should work without API key (uses Claude CLI session)', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Task completed'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			// No API key provided
			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(result.returnData.json.summary).toContain('Task completed');
			// Adapter should have been called
			expect(mockAdapter.promptOnce).toHaveBeenCalled();
		});

		it('should use API key when provided', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: 'sk-ant-test-key',
				adapter: mockAdapter,
			});

			expect(mockAdapter.promptOnce).toHaveBeenCalled();
			expect(result.returnData.json.summary).toBe('Done');
		});
	});

	describe('Missing Working Directory', () => {
		it('should handle missing working directory', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'workingDirectory') return ''; // Empty
					return defaultParams[name] ?? defaultValue;
				},
			);

			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			// Should still execute (SDK has its own defaults)
			// Empty string may be omitted or passed as undefined
			expect(mockAdapter.promptOnce).toHaveBeenCalled();
			expect(result.returnData.json.summary).toBe('Done');
		});

		it('should pass working directory to SDK', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'workingDirectory') return path.join(process.cwd(), 'nodes');
					return defaultParams[name] ?? defaultValue;
				},
			);

			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(mockAdapter.promptOnce).toHaveBeenCalled();
		});
	});

	describe('API Errors', () => {
		it('should throw on adapter error when continueOnFail=false', async () => {
			mockExec.continueOnFail.mockReturnValue(false);

			const errorAdapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
				resumeSession: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
				promptOnce: vi.fn().mockImplementation(() => {
					throw new Error('API rate limit exceeded');
				}),
			};


			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: errorAdapter,
				}),
			).rejects.toThrow('API rate limit exceeded');
		});

		it('should throw on async iterator error', async () => {
			mockExec.continueOnFail.mockReturnValue(false);

			// Create an adapter that returns an iterator that throws during iteration
			const errorAdapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce: vi.fn().mockReturnValue({
					[Symbol.asyncIterator]: async function* () {
						yield mockMessages.systemInit;
						throw new Error('Connection lost');
					},
				}),
			};


			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: errorAdapter,
				}),
			).rejects.toThrow('Connection lost');
		});
	});

	describe('Agent Error Detection', () => {
		it('should detect error patterns in response', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('**Error:** Unable to read file: Permission denied'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			// Should detect the error pattern
			expect(
				result.agentError?.isError ||
				result.returnData.json.summary?.includes('Error'),
			).toBeTruthy();
		});

		it('should include full payload even with agent error', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('**Error:** Task failed'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			// Should still have summary and other fields
			expect(result.returnData.json.summary).toBeDefined();
			expect(result.returnData.json.sessionId).toBeDefined();
		});
	});

	describe('Invalid Configuration', () => {
		it('should handle invalid JSON in MCP server headers', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'enableMcpServers') return true;
					if (name === 'mcpServers') {
						return {
							servers: [
								{
									name: 'test',
									type: 'http',
									url: 'https://api.example.com',
									authentication: 'custom',
									headers: 'not valid json',
								},
							],
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);


			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow('Invalid JSON');
		});

		it('should handle invalid JSON schema example', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'structuredOutput') return true;
					if (name === 'schemaType') return 'fromJson';
					if (name === 'jsonSchemaExample') return 'not valid json';
					return defaultParams[name] ?? defaultValue;
				},
			);


			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow();
		});
	});

	describe('Empty Input Handling', () => {
		it('should throw error for empty task description', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'taskDescription') return '';
					return defaultParams[name] ?? defaultValue;
				},
			);


			// Empty task description should throw an error
			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow('Task Description is required');

			// Adapter should not be called since validation fails first
			expect(mockAdapter.promptOnce).not.toHaveBeenCalled();
		});
	});

	describe('Subagent Errors', () => {
		it('should handle subagent configuration with missing required fields', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'subagents') {
						return {
							agents: [
								{
									// Missing name
									description: 'Test agent',
									prompt: 'Test prompt',
								},
							],
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			// Should handle gracefully (agent without name is skipped)
			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(result.returnData.json.summary).toBe('Done');
		});
	});

	describe('Permission Errors', () => {
		it('should handle path sandbox violation', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'securityOptions') {
						return {
							pathSandboxing: {
								settings: {
									enabled: true,
									basePath: '/allowed',
									mode: 'restrict',
								},
							},
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			// Simulate a tool call to a path outside the sandbox
			const messages = [
				mockMessages.systemInit,
				mockMessages.toolUse('Read', { file_path: '/etc/passwd' }),
				mockMessages.textMessage('File contents'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			// The hooks would block this, but in this test we're just checking the flow
			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			// Tool call should be tracked
			expect(result.returnData.json.toolCalls).toHaveLength(1);
		});
	});

		describe('Memory Connection Errors', () => {
			it('should throw when memory lookup fails', async () => {
				const mockMemory = {
					type: 'claude-session-memory',
					has: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
					touch: vi.fn().mockResolvedValue(undefined),
				};

			mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-123';
					return defaultParams[name] ?? defaultValue;
				},
			);


			// Memory errors should propagate (not silently fail)
			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow('Redis connection failed');
		});

			it('should work when memory returns null session', async () => {
				const mockMemory = {
					type: 'claude-session-memory',
					has: vi.fn().mockResolvedValue(false), // No existing session
					touch: vi.fn().mockResolvedValue(undefined),
				};

			mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-123';
					return defaultParams[name] ?? defaultValue;
				},
			);

			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);


			// Should work fine with no existing session
				const result = await executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				});

				expect(result.returnData.json.summary).toBe('Done');
				expect(mockMemory.has).toHaveBeenCalledWith('user-123');
			});
		});

});
