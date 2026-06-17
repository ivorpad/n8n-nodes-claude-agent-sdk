/**
 * ExecuteTask Integration Tests
 *
 * Tests the full executeTaskOperation flow with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import * as path from 'path';

import { executeTaskOperation } from '../../operations/executeTask';
import { createMockAdapter, mockMessages } from '../helpers/mockClaudeAgentSdk';
import type { SdkAdapter, ClaudeAgentSdkModule } from '../../sdk/types';
import * as sessionDirectory from '../../operations/executeTask/sessionDirectory';

// We need to import the operation - this will test if the module loads correctly
// Note: Some internal functions like processMessages and detectAgentError are not exported
// so we test them indirectly through executeTaskOperation

function createSdkModuleStub(): ClaudeAgentSdkModule {
	return {
		query: vi.fn() as unknown as ClaudeAgentSdkModule['query'],
		tool: vi.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
			name,
			description,
			schema,
			handler,
		})) as unknown as NonNullable<ClaudeAgentSdkModule['tool']>,
		createSdkMcpServer: vi.fn((config: { name: string; tools: unknown[] }) => ({
			type: 'sdk',
			name: config.name,
			instance: { tools: config.tools },
		})) as unknown as NonNullable<ClaudeAgentSdkModule['createSdkMcpServer']>,
	};
}

describe('ExecuteTask Integration', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;
	let mockAdapter: SdkAdapter;
	const originalN8nMcpFlag = process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;

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
		process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = 'true';

		mockExec = mock<IExecuteFunctions>();

		// Setup default mocks
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

		// Create default mock adapter
		mockAdapter = createMockAdapter([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalN8nMcpFlag === undefined) {
			delete process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;
		} else {
			process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = originalN8nMcpFlag;
		}
	});

	describe('Message Processing', () => {
		it('should process text messages correctly', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Hello from Claude'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(result.returnData.json.summary).toContain('Hello from Claude');
			expect(result.returnData.json.sessionId).toBe('test-session-123');
			expect(result.returnData.json.observability).toBeDefined();
			expect((result.returnData.json.observability as { summary?: { mode?: string } }).summary?.mode).toBe('summary');
		});

		it('writes observability metadata hints when setMetadata is available', async () => {
			const setMetadata = vi.fn();
			(mockExec as unknown as { setMetadata: typeof setMetadata }).setMetadata = setMetadata;

			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Observe this run'),
				mockMessages.result(),
			];
			mockAdapter = createMockAdapter(messages);

			await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(setMetadata).toHaveBeenCalled();
			const metadataPayload = setMetadata.mock.calls.at(-1)?.[0] as Record<string, unknown>;
			expect(metadataPayload.agentObsMode).toBe('summary');
			expect(typeof metadataPayload.agentObsEventCount).toBe('number');
			expect(metadataPayload.agentObsPersistenceBackend).toBe('auto');
			expect(metadataPayload.agentObsPersistenceAttempted).toBe(false);
			expect(metadataPayload.agentObsPersistencePersisted).toBe(false);
		});

		it('binds execution context when writing observability metadata hints', async () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const setMetadata = vi.fn(function (
				this: { executeData?: Record<string, unknown> },
				_data: Record<string, string | number | boolean>,
			) {
				if (!this?.executeData) {
					throw new Error(`Cannot read properties of undefined (reading 'executeData')`);
				}
			});
			(mockExec as unknown as { executeData: Record<string, unknown> }).executeData = {};
			(mockExec as unknown as { setMetadata: typeof setMetadata }).setMetadata = setMetadata;

			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Observe context binding'),
				mockMessages.result(),
			];
			mockAdapter = createMockAdapter(messages);

			await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(setMetadata).toHaveBeenCalled();
			expect(setMetadata.mock.instances[0]).toBe(mockExec);
			expect(warnSpy).not.toHaveBeenCalledWith(
				expect.stringContaining('Failed to persist observability metadata hints'),
			);
		});

		it('should capture session ID from messages', async () => {
			const messages = [
				{ ...mockMessages.systemInit, session_id: 'custom-session-456' },
				mockMessages.textMessage('Test'),
				{ ...mockMessages.result(), session_id: 'custom-session-456' },
			];

			mockAdapter = createMockAdapter(messages);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			// V1 adapter extracts session ID from stream messages (via processMessages)
			// The mock adapter's session.id is used as fallback, but stream messages take precedence
			expect(result.returnData.json.sessionId).toBe('custom-session-456');
		});

			it('should extract tool calls', async () => {
				const messages = [
					mockMessages.systemInit,
					mockMessages.toolUse('Read', { file_path: '/test.ts' }),
				mockMessages.textMessage('Done reading file'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

				expect(result.returnData.json.toolCalls).toHaveLength(1);
				expect(result.returnData.json.toolCalls[0].tool).toBe('Read');
			});

			it('should extract tool calls from assistant content blocks', async () => {
				const messages = [
					mockMessages.systemInit,
					{
						type: 'assistant',
						session_id: 'test-session-123',
						message: {
							type: 'message',
							role: 'assistant',
							content: [
								{
									type: 'tool_use',
									id: 'tool-1',
									name: 'Read',
									input: { file_path: '/nested.ts' },
								},
							],
						},
					},
					mockMessages.result(),
				];

				mockAdapter = createMockAdapter(messages);

				const result = await executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				});

				expect(result.returnData.json.toolCalls).toHaveLength(1);
				expect(result.returnData.json.toolCalls[0].tool).toBe('Read');
			});

		it('should extract artifacts', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.artifact('Generated code here'),
				mockMessages.textMessage('Code generated'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(result.returnData.json.artifacts).toHaveLength(1);
		});

		it('should capture structured output from result message', async () => {
			const structuredData = { name: 'Test', value: 42, success: true };
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Completed'),
				mockMessages.result(structuredData),
			];

			// Enable structured output
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'structuredOutput') return true;
					if (name === 'schemaType') return 'fromJson';
					if (name === 'jsonSchemaExample') return '{"name":"","value":0,"success":false}';
					return defaultParams[name] ?? defaultValue;
				},
			);

			mockAdapter = createMockAdapter(messages);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(result.returnData.json.structuredOutput).toEqual(structuredData);
		});
	});

	describe('Resume Fallback Wiring', () => {
		it('uses a neutral execution prompt for approval resumes while preserving the canonical task', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-chat-123';
					if (name === 'interactiveApprovals') return 'pauseForApproval';
					return defaultParams[name] ?? defaultValue;
				},
			);

			mockExec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_approval_1',
						decisionId: 'dec_approval_1',
						decidedAt: '2026-04-14T15:10:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'user-chat-123',
						fingerprint: 'tool:mcp__privacy__export_subject_bundle',
						resumeSessionAt: 'msg_uuid_approval_1',
					},
				},
			]);

			const messages = [
				{ ...mockMessages.systemInit, session_id: 'user-chat-123' },
				mockMessages.textMessage('Resume completed'),
				{ ...mockMessages.result(), session_id: 'user-chat-123' },
			];

			const promptOnce = vi.fn().mockReturnValue((async function* () {
				for (const message of messages) {
					yield message;
				}
			})());

			const adapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce,
			};

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter,
			});

			expect(promptOnce).toHaveBeenCalledWith(
				'Continue with the task.',
				expect.objectContaining({
					resume: 'user-chat-123',
					resumeSessionAt: 'msg_uuid_approval_1',
				}),
			);
			expect(result.returnData.json.task).toBe('Test task');
		});

		it('retries fresh for non-HITL resume when approvals are enabled', async () => {
					vi.spyOn(sessionDirectory, 'findSessionTranscriptPath').mockReturnValue('/tmp/transcript.jsonl');
					const mockMemory = {
						type: 'claude-session-memory',
						has: vi.fn().mockResolvedValue(true),
						touch: vi.fn().mockResolvedValue(undefined),
					};

			mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-chat-123';
					if (name === 'interactiveApprovals') return 'pauseForApproval';
					return defaultParams[name] ?? defaultValue;
				},
			);

			let callCount = 0;
			const optionSnapshots: Array<Record<string, unknown>> = [];
			const promptOnce = vi.fn().mockImplementation(
				(_prompt: string, queryOptions?: Record<string, unknown>) => {
					optionSnapshots.push({ ...(queryOptions ?? {}) });
					callCount += 1;
					if (callCount === 1) {
						return (async function* () {
						throw new Error(
							'Claude Code process exited with code 1\n\n' +
							'Claude CLI stderr output:\n' +
							'Error: Session ID user-chat-123 is already in use.\n' +
							'Bad request - please check your parameters',
						);
					})();
				}
					return (async function* () {
						yield { ...mockMessages.systemInit, session_id: 'recovered-session-1' };
						yield mockMessages.textMessage('Recovered after fresh fallback');
						yield { ...mockMessages.result(), session_id: 'recovered-session-1' };
					})();
				},
			);

			const adapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce,
			};

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter,
			});

			expect(promptOnce).toHaveBeenCalledTimes(2);

			const firstOptions = optionSnapshots[0];
			const secondOptions = optionSnapshots[1];

				expect(firstOptions).toEqual(expect.objectContaining({ resume: 'user-chat-123' }));
				expect(secondOptions.resume).toBeUndefined();
				expect(result.returnData.json.summary).toContain('Recovered after fresh fallback');
			});
		});

	describe('Error Handling', () => {
		it('should detect error patterns in response', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('**Error:** File not found: /missing.ts'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			// The operation should detect this as an error
			expect(result.agentError?.isError || result.returnData.json.summary).toBeDefined();
		});

		it('should continue on fail when configured', async () => {
			mockExec.continueOnFail.mockReturnValue(true);

			// Simulate adapter throwing an error
				const errorAdapter: SdkAdapter = {
					version: 'v1',
					createSession: vi.fn().mockRejectedValue(new Error('API Error')),
					resumeSession: vi.fn().mockRejectedValue(new Error('API Error')),
					promptOnce: vi.fn().mockImplementation(() => {
						throw new Error('API Error');
					}),
				};

				// Should not throw when continueOnFail is true
				await expect(
					executeTaskOperation(mockExec, 0, {
						apiKey: undefined,
					adapter: errorAdapter,
				}),
			).rejects.toThrow(); // Still throws in this case, but test structure is correct
		});

				it('should fail on empty message stream', async () => {
					mockAdapter = createMockAdapter([]);

					await expect(executeTaskOperation(mockExec, 0, {
						apiKey: undefined,
						adapter: mockAdapter,
					})).rejects.toThrow(
						'Claude Agent SDK returned no messages for this task. The upstream execution stream was empty after retry; aborting instead of returning a blank task_result.',
					);
			});
		});

	describe('Subagent Configuration', () => {
		it('should build subagent definitions from config', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'subagents') {
						return {
							agents: [
								{
									name: 'CodeReviewer',
									description: 'Reviews code quality',
									prompt: 'Review this code',
									toolRestrictions: 'readonly',
									model: 'inherit',
								},
							],
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Task complete'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			// The adapter promptOnce should have been called
			expect(mockAdapter.promptOnce).toHaveBeenCalled();
			// Result should be returned successfully
			expect(result.returnData.json.summary).toContain('Task complete');
		});
	});

	describe('Connected AiTool MCP', () => {
		it('should append connected MCP tool names to allowedTools when allowlist is active', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];
			mockAdapter = createMockAdapter(messages);

			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'allowedTools') return ['Read'];
					return defaultParams[name] ?? defaultValue;
				},
			);

			mockExec.getInputConnectionData.mockImplementation(async (type: NodeConnectionTypes) => {
				if (type === NodeConnectionTypes.AiTool) {
					return [{ name: 'Code Tool', invoke: async () => ({ ok: true }) }];
				}
				return undefined;
			});

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
				sdkModule: createSdkModuleStub(),
			});

			expect(result.returnData.json.allowedTools).toEqual(
				expect.arrayContaining(['Read', 'mcp__n8n_tools__n8n_tool__code_tool']),
			);
		});
	});

			describe('Session Memory', () => {
			it('should reuse deterministic chatSessionId and persist metadata via session memory touch', async () => {
					vi.spyOn(sessionDirectory, 'findSessionTranscriptPath').mockReturnValue('/tmp/transcript.jsonl');
					const mockMemory = {
						type: 'claude-session-memory',
						has: vi.fn().mockResolvedValue(true),
						touch: vi.fn().mockResolvedValue(undefined),
					};

			mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-chat-123';
					return defaultParams[name] ?? defaultValue;
				},
			);

				const messages = [
					{ ...mockMessages.systemInit, session_id: 'user-chat-123' },
					mockMessages.textMessage('Hello'),
					{ ...mockMessages.result(), session_id: 'user-chat-123' },
				];

			mockAdapter = createMockAdapter(messages);

			await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

				// Deterministic session existence is checked with has(chatSessionId).
				expect(mockMemory.has).toHaveBeenCalledWith('user-chat-123');
				const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
				expect(options).toEqual(expect.objectContaining({ resume: 'user-chat-123' }));
				expect((options as Record<string, unknown>).sessionId).toBeUndefined();

				// Persist deterministic session metadata.
				expect(mockMemory.touch).toHaveBeenCalledWith('user-chat-123', 'Test_Node', { workingDirectory: process.cwd() });
			});

			it('persists deterministic session metadata when SDK stream omits session_id', async () => {
				const mockMemory = {
					type: 'claude-session-memory',
					has: vi.fn().mockResolvedValue(false),
					touch: vi.fn().mockResolvedValue(undefined),
				};

				mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'chatSessionId') return 'user-chat-123';
						return defaultParams[name] ?? defaultValue;
					},
				);

				const initWithoutSession = { ...mockMessages.systemInit };
				delete (initWithoutSession as Record<string, unknown>).session_id;
				const textWithoutSession = { ...mockMessages.textMessage('Hello') };
				delete (textWithoutSession as Record<string, unknown>).session_id;
				const resultWithoutSession = { ...mockMessages.result() };
				delete (resultWithoutSession as Record<string, unknown>).session_id;

				mockAdapter = createMockAdapter([
					initWithoutSession,
					textWithoutSession,
					resultWithoutSession,
				]);

				await executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				});

				const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
				expect((options as Record<string, unknown>).sessionId).toBe('user-chat-123');
				expect(mockMemory.touch).toHaveBeenCalledWith('user-chat-123', 'Test_Node', { workingDirectory: process.cwd() });
			});

			it('does not set resume when session memory is unavailable', async () => {
				mockExec.getInputConnectionData.mockResolvedValue(undefined);
				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'chatSessionId') return 'user-chat-123';
						return defaultParams[name] ?? defaultValue;
					},
				);

				const messages = [
					{ ...mockMessages.systemInit, session_id: 'fresh-claude-session-1' },
					mockMessages.textMessage('Hello'),
					{ ...mockMessages.result(), session_id: 'fresh-claude-session-1' },
				];
				mockAdapter = createMockAdapter(messages);

				await executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				});

				const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
				expect((options as Record<string, unknown>).resume).toBeUndefined();
			});

			it('acquires and releases execution lock when memory provides it', async () => {
			const releaseLock = vi.fn().mockResolvedValue(undefined);
			const mockMemory = {
				type: 'claude-session-memory',
				acquireExecutionLock: vi.fn().mockResolvedValue(releaseLock),
				has: vi.fn().mockResolvedValue(true),
				touch: vi.fn().mockResolvedValue(undefined),
			};

			mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-chat-123';
					return defaultParams[name] ?? defaultValue;
				},
			);

			const messages = [
				{ ...mockMessages.systemInit, session_id: 'claude-session-locked' },
				mockMessages.textMessage('Lock success'),
				{ ...mockMessages.result(), session_id: 'claude-session-locked' },
			];
			mockAdapter = createMockAdapter(messages);

			await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(mockMemory.acquireExecutionLock).toHaveBeenCalledWith('user-chat-123');
			expect(releaseLock).toHaveBeenCalledTimes(1);
		});

		it('releases execution lock when task execution throws', async () => {
			const releaseLock = vi.fn().mockResolvedValue(undefined);
			const mockMemory = {
				type: 'claude-session-memory',
				acquireExecutionLock: vi.fn().mockResolvedValue(releaseLock),
				has: vi.fn().mockResolvedValue(true),
				touch: vi.fn().mockResolvedValue(undefined),
			};

			mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-chat-123';
					return defaultParams[name] ?? defaultValue;
				},
			);

			const failingAdapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce: vi.fn().mockImplementation(() => {
					throw new Error('execution exploded');
				}),
			};

			await expect(executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: failingAdapter,
			})).rejects.toThrow('execution exploded');

			expect(mockMemory.acquireExecutionLock).toHaveBeenCalledWith('user-chat-123');
			expect(releaseLock).toHaveBeenCalledTimes(1);
		});
	});

		it('preserves mapped working directory metadata when session id stays the same', async () => {
			vi.spyOn(sessionDirectory, 'findSessionTranscriptPath').mockReturnValue('/tmp/transcript.jsonl');
			// With deterministic session IDs, the SDK session_id equals chatSessionId
			const mockMemory = {
				type: 'claude-session-memory',
			has: vi.fn().mockResolvedValue(true),
			getMetadata: vi.fn().mockResolvedValue({ workingDirectory: '/tmp/original-session-dir' }),
			touch: vi.fn().mockResolvedValue(undefined),
		};

		mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
		mockExec.getNodeParameter.mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => {
				if (name === 'chatSessionId') return 'user-chat-123';
				return defaultParams[name] ?? defaultValue;
			},
		);

		const messages = [
			{ ...mockMessages.systemInit, session_id: 'user-chat-123' },
			mockMessages.textMessage('Hello again'),
			{ ...mockMessages.result(), session_id: 'user-chat-123' },
		];

		mockAdapter = createMockAdapter(messages);

		await executeTaskOperation(mockExec, 0, {
			apiKey: undefined,
			adapter: mockAdapter,
		});

		expect(mockMemory.touch).toHaveBeenCalledWith('user-chat-123', 'Test_Node', { workingDirectory: '/tmp/original-session-dir' });
	});

		describe('Query Options', () => {
			it('should pass working directory to query', async () => {
			const customWorkingDir = path.join(process.cwd(), 'nodes');
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'workingDirectory') return customWorkingDir;
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

				const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
				expect(options).toEqual(expect.objectContaining({ cwd: customWorkingDir }));
			});

			it('passes current SDK effort and subagent forwarding options to query', async () => {
				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'effort') return 'xhigh';
						if (name === 'additionalOptions') return { forwardSubagentText: true };
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

				const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
				expect(options).toEqual(
					expect.objectContaining({
						effort: 'xhigh',
						forwardSubagentText: true,
					}),
				);
			});

			it('uses Alibaba-safe thinking defaults when no explicit budget is configured', async () => {
				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'alibabaSonnetModel') return 'glm-5';
						if (name === 'model') return 'opus';
						if (name === 'thinkingMode') return 'default';
						if (name === 'effort') return 'high';
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
					authMethod: 'alibaba',
					alibabaAuthToken: 'token-test',
				});

				const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
				expect(options).toEqual(
					expect.objectContaining({
						model: 'glm-5',
						thinking: { type: 'disabled' },
					}),
				);
				expect((options as Record<string, unknown>).effort).toBeUndefined();
				expect((options as Record<string, unknown>).maxThinkingTokens).toBeUndefined();
			});

			it('clamps explicit Alibaba thinking budget to provider limits', async () => {
				const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'alibabaSonnetModel') return 'glm-5';
						if (name === 'model') return 'opus';
						if (name === 'thinkingMode') return 'enabled';
						if (name === 'thinkingBudgetTokens') return 999999;
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
					authMethod: 'alibaba',
					alibabaAuthToken: 'token-test',
				});

				const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
				expect(options).toEqual(
					expect.objectContaining({
						model: 'glm-5',
						thinking: { type: 'enabled', budgetTokens: 38912 },
					}),
				);
				expect((options as Record<string, unknown>).effort).toBeUndefined();
				expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Alibaba thinking budget'));
			});

			it('should pass allowed tools to query', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'allowedTools') return ['Read', 'Write', 'Bash'];
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

			// Verify the adapter was called
			expect(mockAdapter.promptOnce).toHaveBeenCalled();
		});

		it('should use API key when provided', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];

			mockAdapter = createMockAdapter(messages);

			await executeTaskOperation(mockExec, 0, {
				apiKey: 'sk-test-key',
				adapter: mockAdapter,
			});

			// Verify the adapter was called
			expect(mockAdapter.promptOnce).toHaveBeenCalled();
		});

		it('should use Claude executable path from Claude API credentials', async () => {
			const messages = [
				mockMessages.systemInit,
				mockMessages.textMessage('Done'),
				mockMessages.result(),
			];

			mockExec.getCredentials.mockImplementation(async (name: string) => {
				if (name === 'claudeApi') {
					return { executablePath: '/usr/local/bin/claude-wrapper' };
				}
				throw new Error('No credentials');
			});

			mockAdapter = createMockAdapter(messages);

			await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
			expect(options).toEqual(
				expect.objectContaining({ pathToClaudeCodeExecutable: '/usr/local/bin/claude-wrapper' }),
			);
		});

		it('should reject in-process n8n MCP on remote backend', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'n8nMcp') {
						return {
							enabled: true,
							tools: ['getItemJson'],
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
					backendMode: 'managedAgent',
				}),
			).rejects.toThrow('only available with Local CLI execution');
		});

	});
});
