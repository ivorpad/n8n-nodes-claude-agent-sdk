/**
 * Error Handling Integration Tests (Ollama + working directory)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';
import * as fs from 'fs';
import * as os from 'os';
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

	describe('Ollama Model Errors', () => {
		it('should provide user-friendly error when model does not support tools', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'additionalOptions') {
						return {
							apiProvider: 'ollama',
							ollamaModel: 'gemma3:4b',
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			// Simulate the Ollama API error for unsupported tools
			const ollamaError = new Error('Claude Code process exited with code 1');
			(ollamaError as Error & { apiError?: unknown }).apiError = {
				type: 'error',
				error: {
					type: 'invalid_request_error',
					message: 'registry.ollama.ai/library/gemma3:4b does not support tools',
				},
			};

			const errorAdapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce: vi.fn().mockReturnValue({
					[Symbol.asyncIterator]: async function* () {
						throw ollamaError;
					},
				}),
			};


			// Should throw a user-friendly error explaining tool support
			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: errorAdapter,
					authMethod: 'ollama',
				}),
			).rejects.toThrow(/does not support tools|tool support/i);

			// The error message should mention the model name and suggest alternatives
			try {
				await executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: errorAdapter,
					authMethod: 'ollama',
				});
			} catch (error) {
				const errorMessage = (error as Error).message;
				// Should contain helpful context
				expect(errorMessage).toMatch(/gemma3:4b|does not support tools/i);
			}
		});

		it('should handle Ollama connection errors with helpful message', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'additionalOptions') {
						return {
							apiProvider: 'ollama',
							ollamaBaseUrl: 'http://localhost:11434',
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			// Simulate connection refused error
			const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:11434');
			(connectionError as NodeJS.ErrnoException).code = 'ECONNREFUSED';

			const errorAdapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce: vi.fn().mockReturnValue({
					[Symbol.asyncIterator]: async function* () {
						throw connectionError;
					},
				}),
			};


			// Should mention Ollama connection issue
			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: errorAdapter,
					authMethod: 'ollama',
				}),
			).rejects.toThrow(/ECONNREFUSED|Ollama|connection/i);
		});
	});

	describe('Working Directory Validation', () => {
		it('should throw error when working directory does not exist', async () => {
			const missingDir = path.join(
				os.tmpdir(),
				`claude-agent-sdk-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`,
			);
			expect(fs.existsSync(missingDir)).toBe(false);

			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'workingDirectory') return missingDir;
					return defaultParams[name] ?? defaultValue;
				},
			);

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow(`Working directory does not exist: "${missingDir}"`);
		});

		it('should throw error when working directory is not a directory', async () => {
			const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-agent-sdk-test-'));
			try {
				const filePath = path.join(baseDir, 'not-a-directory.txt');
				fs.writeFileSync(filePath, 'x');

				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'workingDirectory') return filePath;
						return defaultParams[name] ?? defaultValue;
					},
				);

				await expect(
					executeTaskOperation(mockExec, 0, {
						apiKey: undefined,
						adapter: mockAdapter,
					}),
				).rejects.toThrow(`Working directory path is not a directory: "${filePath}"`);
			} finally {
				fs.rmSync(baseDir, { recursive: true, force: true });
			}
		});

		it('should allow empty working directory (uses default)', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'workingDirectory') return '';
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

			expect(result.returnData.json.summary).toBe('Done');
		});
	});
});
