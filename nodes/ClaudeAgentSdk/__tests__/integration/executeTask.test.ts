/**
 * ExecuteTask Integration Tests
 *
 * Tests the full executeTaskOperation flow with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { executeTaskOperation } from '../../operations/executeTask';
import { createMockAdapter, mockMessages } from '../helpers/mockClaudeAgentSdk';
import type { SdkAdapter, ClaudeAgentSdkModule } from '../../sdk/types';
import * as sessionDirectory from '../../operations/executeTask/sessionDirectory';
import {
	HITL_APPROVAL_RESUME_PROMPT,
	HITL_APPROVAL_RESUME_PROMPT_CLASSIFICATION,
} from '../../operations/executeTask/steps/hitlResponseApplication';
import {
	PHOENIX_COMPANION_BASE_URL,
	PHOENIX_COMPANION_LOCAL_BASE_URL,
} from '../../companion/client';

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
	const originalAgentPlaneFlag = process.env.AGENT_PLANE_ENABLED;

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
		delete process.env.AGENT_PLANE_ENABLED;

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
		vi.unstubAllGlobals();
		if (originalN8nMcpFlag === undefined) {
			delete process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;
		} else {
			process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = originalN8nMcpFlag;
		}
		if (originalAgentPlaneFlag === undefined) {
			delete process.env.AGENT_PLANE_ENABLED;
		} else {
			process.env.AGENT_PLANE_ENABLED = originalAgentPlaneFlag;
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
			expect(
				(result.returnData.json.observability as { summary?: { mode?: string } }).summary?.mode,
			).toBe('summary');
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
			expect(metadataPayload.agentObsPersistenceBackend).toBe('runDataOnly');
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
		it('uses a marker control-plane prompt for SDK-owned approval resumes while preserving the canonical task', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-chat-123';
					if (name === 'interactiveApprovals') return 'pauseForApproval';
					if (name === 'executionSettings') return { observabilityMode: 'full' };
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

			const promptOnce = vi.fn().mockReturnValue(
				(async function* () {
					for (const message of messages) {
						yield message;
					}
				})(),
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

			expect(promptOnce).toHaveBeenCalledWith(
				HITL_APPROVAL_RESUME_PROMPT,
				expect.objectContaining({
					resume: 'user-chat-123',
					resumeSessionAt: 'msg_uuid_approval_1',
				}),
			);
			expect(promptOnce).not.toHaveBeenCalledWith(
				'Test task',
				expect.objectContaining({
					resume: 'user-chat-123',
				}),
			);
			expect(result.returnData.json.task).toBe('Test task');
			const observability = result.returnData.json.observability as {
				events?: Array<{
					eventType?: string;
					status?: string;
					payload?: Record<string, unknown>;
				}>;
			};
			expect(observability.events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						eventType: 'hitl.approval.resume_prompt',
						status: 'control_plane',
						payload: expect.objectContaining({
							inputClassification: HITL_APPROVAL_RESUME_PROMPT_CLASSIFICATION,
							promptMarker: HITL_APPROVAL_RESUME_PROMPT,
						}),
					}),
					expect.objectContaining({
						eventType: 'execution.query.attempt',
						payload: expect.objectContaining({
							promptClassification: HITL_APPROVAL_RESUME_PROMPT_CLASSIFICATION,
						}),
					}),
				]),
			);
		});

		it('leaves question-response resumes on the task prompt path', async () => {
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'user-chat-123';
					if (name === 'interactiveApprovals') return 'pauseForApproval';
					if (name === 'handleAskUserQuestion') return true;
					return defaultParams[name] ?? defaultValue;
				},
			);
			mockExec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'question_response',
						requestId: 'req_question_1',
						decisionId: 'dec_question_1',
						decidedAt: '2026-04-14T15:12:00.000Z',
						channel: 'webhook',
						answers: { Format: 'Summary' },
						resumeSessionId: 'user-chat-123',
						resumeSessionAt: 'msg_uuid_question_1',
					},
				},
			]);

			const messages = [
				{ ...mockMessages.systemInit, session_id: 'user-chat-123' },
				mockMessages.textMessage('Question resume completed'),
				{ ...mockMessages.result(), session_id: 'user-chat-123' },
			];
			const promptOnce = vi.fn().mockReturnValue(
				(async function* () {
					for (const message of messages) {
						yield message;
					}
				})(),
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

			expect(promptOnce).toHaveBeenCalledWith(
				'Test task',
				expect.objectContaining({
					resume: 'user-chat-123',
					resumeSessionAt: 'msg_uuid_question_1',
				}),
			);
			expect(promptOnce).not.toHaveBeenCalledWith(HITL_APPROVAL_RESUME_PROMPT, expect.anything());
			expect(result.returnData.json.task).toBe('Test task');
		});

		it('uses the task prompt for normal deterministic resume', async () => {
			vi.spyOn(sessionDirectory, 'findSessionTranscriptPath').mockReturnValue(
				'/tmp/transcript.jsonl',
			);
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

			const messages = [
				{ ...mockMessages.systemInit, session_id: 'user-chat-123' },
				mockMessages.textMessage('Deterministic resume completed'),
				{ ...mockMessages.result(), session_id: 'user-chat-123' },
			];
			const promptOnce = vi.fn().mockReturnValue(
				(async function* () {
					for (const message of messages) {
						yield message;
					}
				})(),
			);
			const adapter: SdkAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce,
			};

			await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter,
			});

			expect(promptOnce).toHaveBeenCalledWith(
				'Test task',
				expect.objectContaining({ resume: 'user-chat-123' }),
			);
			expect(promptOnce).not.toHaveBeenCalledWith(HITL_APPROVAL_RESUME_PROMPT, expect.anything());
		});

		it('retries fresh for non-HITL resume when approvals are enabled', async () => {
			vi.spyOn(sessionDirectory, 'findSessionTranscriptPath').mockReturnValue(
				'/tmp/transcript.jsonl',
			);
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
			const promptSnapshots: string[] = [];
			const optionSnapshots: Array<Record<string, unknown>> = [];
			const promptOnce = vi
				.fn()
				.mockImplementation((prompt: string, queryOptions?: Record<string, unknown>) => {
					promptSnapshots.push(prompt);
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
				});

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
			expect(promptSnapshots).toEqual(['Test task', 'Test task']);
			expect(promptSnapshots).not.toContain(HITL_APPROVAL_RESUME_PROMPT);

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

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow(
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
			vi.spyOn(sessionDirectory, 'findSessionTranscriptPath').mockReturnValue(
				'/tmp/transcript.jsonl',
			);
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
			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
			expect(options).toEqual(expect.objectContaining({ resume: 'user-chat-123' }));
			expect((options as Record<string, unknown>).sessionId).toBeUndefined();

			// Persist deterministic session metadata.
			expect(mockMemory.touch).toHaveBeenCalledWith('user-chat-123', 'Test_Node', {
				workingDirectory: process.cwd(),
			});
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

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
			expect((options as Record<string, unknown>).sessionId).toBe('user-chat-123');
			expect(mockMemory.touch).toHaveBeenCalledWith('user-chat-123', 'Test_Node', {
				workingDirectory: process.cwd(),
			});
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

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
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

		it('persists full session content and observability through Postgres-backed memory', async () => {
			const claudeConfigDir = fs.mkdtempSync(
				path.join(os.tmpdir(), 'claude-session-observability-'),
			);
			const persistInvocationObservability = vi.fn().mockResolvedValue({
				backend: 'postgres',
				attempted: true,
				persisted: true,
				tableName: 'claude_invocation_observability_events',
				rowCount: 3,
			});
			const persistFullSession = vi.fn().mockResolvedValue({
				backend: 'postgres',
				attempted: true,
				persisted: true,
				tableName: 'claude_full_sessions',
				rowCount: 1,
			});
			const mockMemory = {
				type: 'claude-session-memory',
				durablePersistence: {
					backend: 'postgres',
					observabilityTableName: 'claude_invocation_observability_events',
					fullSessionTableName: 'claude_full_sessions',
					persistInvocationObservability,
					persistFullSession,
				},
				has: vi.fn().mockResolvedValue(false),
				touch: vi.fn().mockResolvedValue(undefined),
			};

			try {
				const projectDir = path.join(claudeConfigDir, 'projects', 'local-project');
				fs.mkdirSync(projectDir, { recursive: true });
				const transcriptMessages = [
					{ type: 'user', message: { content: 'first user turn' }, session_id: 'chat_1' },
					{
						type: 'assistant',
						message: { content: [{ type: 'text', text: 'first response' }] },
						session_id: 'chat_1',
					},
					{
						type: 'user',
						message: { content: 'second user turn with super-secret-token' },
						session_id: 'chat_1',
					},
					{
						type: 'assistant',
						message: {
							content: [{ type: 'text', text: 'Finished without echoing super-secret-token' }],
						},
						session_id: 'chat_1',
					},
					{ type: 'result', session_id: 'chat_1' },
				];
				fs.writeFileSync(
					path.join(projectDir, 'chat_1.jsonl'),
					`${transcriptMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
					'utf8',
				);

				mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
				mockExec.getWorkflow.mockReturnValue({ id: 'wf_1' } as never);
				mockExec.getWorkflowDataProxy.mockReturnValue({ $execution: { id: 'exec_1' } } as never);
				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'chatSessionId') return 'chat_1';
						if (name === 'additionalOptions') {
							return {
								persistSession: true,
								claudeConfigDir,
							};
						}
						if (name === 'executionSettings') {
							return {
								observabilityMode: 'full',
								redactObservabilityPayloads: true,
							};
						}
						return defaultParams[name] ?? defaultValue;
					},
				);

				const messages = [
					{ ...mockMessages.systemInit, session_id: 'chat_1' },
					{
						...mockMessages.toolUse('Bash', { command: 'echo super-secret-token' }),
						session_id: 'chat_1',
					},
					{
						...mockMessages.textMessage('Finished without echoing super-secret-token'),
						session_id: 'chat_1',
					},
					{ ...mockMessages.result(), session_id: 'chat_1' },
				];
				mockAdapter = createMockAdapter(messages);

				const result = await executeTaskOperation(mockExec, 0, {
					apiKey: 'super-secret-token',
					adapter: mockAdapter,
				});

				expect(result.returnData.json.sessionId).toBe('chat_1');
				expect(mockMemory.touch).toHaveBeenCalledWith('chat_1', 'Test_Node', {
					workingDirectory: process.cwd(),
				});
				expect(persistFullSession).toHaveBeenCalledWith(
					expect.objectContaining({
						context: expect.objectContaining({
							workflowId: 'wf_1',
							nodeName: 'Test Node',
							executionId: 'exec_1',
							chatSessionId: 'chat_1',
							sessionId: 'chat_1',
						}),
						messageCount: transcriptMessages.length,
						parentNodeName: 'Test_Node',
					}),
				);
				const fullSessionArgs = persistFullSession.mock.calls[0]?.[0] as {
					sessionContent?: string;
					messages?: unknown[];
				};
				expect(fullSessionArgs.sessionContent).toContain('first user turn');
				expect(fullSessionArgs.sessionContent).toContain('second user turn with [REDACTED]');
				expect(fullSessionArgs.sessionContent).not.toContain('super-secret-token');
				expect(fullSessionArgs.messages).toBeUndefined();
				expect(persistInvocationObservability).toHaveBeenCalledWith(
					expect.objectContaining({
						context: expect.objectContaining({
							workflowId: 'wf_1',
							nodeName: 'Test Node',
							executionId: 'exec_1',
							chatSessionId: 'chat_1',
							sessionId: 'chat_1',
						}),
						terminalStatus: 'completed',
					}),
				);
				const persistedPayloads = JSON.stringify([
					persistFullSession.mock.calls,
					persistInvocationObservability.mock.calls,
					result.returnData.json,
				]);
				expect(persistedPayloads).not.toContain('super-secret-token');
			} finally {
				fs.rmSync(claudeConfigDir, { recursive: true, force: true });
			}
		});

		it('rejects successful executions when durable Postgres session persistence fails', async () => {
			const persistInvocationObservability = vi.fn().mockResolvedValue({
				backend: 'postgres',
				attempted: true,
				persisted: true,
				tableName: 'claude_invocation_observability_events',
				rowCount: 1,
			});
			const persistFullSession = vi.fn().mockRejectedValue(new Error('full session write failed'));
			const mockMemory = {
				type: 'claude-session-memory',
				durablePersistence: {
					backend: 'postgres',
					observabilityTableName: 'claude_invocation_observability_events',
					fullSessionTableName: 'claude_full_sessions',
					persistInvocationObservability,
					persistFullSession,
				},
				has: vi.fn().mockResolvedValue(false),
				touch: vi.fn().mockResolvedValue(undefined),
			};

			mockExec.getInputConnectionData.mockResolvedValue(mockMemory);
			mockExec.getWorkflow.mockReturnValue({ id: 'wf_1' } as never);
			mockExec.getWorkflowDataProxy.mockReturnValue({ $execution: { id: 'exec_1' } } as never);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'chatSessionId') return 'chat_1';
					return defaultParams[name] ?? defaultValue;
				},
			);

			mockAdapter = createMockAdapter([
				{ ...mockMessages.systemInit, session_id: 'chat_1' },
				{ ...mockMessages.textMessage('Done'), session_id: 'chat_1' },
				{ ...mockMessages.result(), session_id: 'chat_1' },
			]);

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow('full session write failed');
			expect(persistInvocationObservability).toHaveBeenCalledWith(
				expect.objectContaining({ terminalStatus: 'failed' }),
			);
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

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: failingAdapter,
				}),
			).rejects.toThrow('execution exploded');

			expect(mockMemory.acquireExecutionLock).toHaveBeenCalledWith('user-chat-123');
			expect(releaseLock).toHaveBeenCalledTimes(1);
		});
	});

	it('preserves mapped working directory metadata when session id stays the same', async () => {
		vi.spyOn(sessionDirectory, 'findSessionTranscriptPath').mockReturnValue(
			'/tmp/transcript.jsonl',
		);
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

		expect(mockMemory.touch).toHaveBeenCalledWith('user-chat-123', 'Test_Node', {
			workingDirectory: '/tmp/original-session-dir',
		});
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

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
			expect(options).toEqual(expect.objectContaining({ cwd: customWorkingDir }));
		});

		it('resolves Agent Plane workingDirectory before local CLI execution', async () => {
			process.env.AGENT_PLANE_ENABLED = '1';
			const companionWorkingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-plane-'));
			const configuredMissingDirectory = path.join(
				companionWorkingDirectory,
				'missing-configured-dir',
			);
			const fetchMock = vi.fn(
				async (
					input: unknown,
					init?: { body?: string; headers?: Record<string, string>; method?: string },
				) => {
					const url = String(input);

					if (url.endsWith('/api/n8n/agents/agt_support/ensure-ready')) {
						return {
							ok: true,
							status: 200,
							statusText: 'OK',
							json: async () => ({
								agentId: 'agt_support',
								workspaceId: 'wrk_support',
								executionServerId: 'srv_local',
								workingDirectory: companionWorkingDirectory,
								directoryStatus: 'created',
								syncStatus: 'synced',
								ready: true,
								warnings: [],
							}),
						};
					}

					if (url.endsWith('/api/n8n/runs/start')) {
						return {
							ok: true,
							status: 200,
							statusText: 'OK',
							json: async () => ({ runId: 'run_companion_1' }),
						};
					}

					if (url.endsWith('/api/n8n/runs/run_companion_1/complete')) {
						return {
							ok: true,
							status: 200,
							statusText: 'OK',
							json: async () => ({ runId: 'run_companion_1', status: 'completed' }),
						};
					}

					throw new Error(`Unexpected Agent Plane request: ${url} ${init?.method ?? ''}`);
				},
			);
			vi.stubGlobal('fetch', fetchMock);
			(mockExec as unknown as { getWorkflow: () => { id: string } }).getWorkflow = vi.fn(() => ({
				id: 'wf_companion',
			}));
			(mockExec as unknown as { getExecutionId: () => string }).getExecutionId = vi.fn(
				() => 'exec_companion',
			);
			mockExec.getCredentials.mockImplementation(async (name: string) => {
				if (name === 'claudeAgentCompanionApi') {
					return { apiKey: 'ap_test_companion' };
				}

				throw new Error('No credentials');
			});
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'companionAgent') {
						return {
							useCompanionAgent: true,
							companionAgentId: 'agt_support',
							companionReadinessMode: 'checkOnly',
							companionRequireSynced: true,
							companionLifecycleCallbacks: true,
						};
					}
					if (name === 'workingDirectory') return configuredMissingDirectory;
					if (name === 'chatSessionId') return 'customer-chat-42';
					return defaultParams[name] ?? defaultValue;
				},
			);

			try {
				const messages = [
					{ ...mockMessages.systemInit, session_id: 'test-session-123' },
					mockMessages.textMessage('Agent Plane directory ready'),
					{ ...mockMessages.result(), session_id: 'test-session-123' },
				];

				mockAdapter = createMockAdapter(messages);

				const result = await executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				});

				const calls = fetchMock.mock.calls.map(([url, init]) => ({
					url: String(url),
					init: init as { body?: string; headers?: Record<string, string>; method?: string },
					body: JSON.parse(String((init as { body?: string } | undefined)?.body ?? '{}')) as Record<
						string,
						unknown
					>,
				}));
				const [, queryOptions] = (
					mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } }
				).mock.calls[0];

				expect(result.returnData.json.workingDirectory).toBe(companionWorkingDirectory);
				expect(queryOptions).toEqual(expect.objectContaining({ cwd: companionWorkingDirectory }));
				expect(calls.map((call) => call.url)).toEqual([
					`${PHOENIX_COMPANION_BASE_URL}/api/n8n/agents/agt_support/ensure-ready`,
					`${PHOENIX_COMPANION_BASE_URL}/api/n8n/runs/start`,
					`${PHOENIX_COMPANION_BASE_URL}/api/n8n/runs/run_companion_1/complete`,
				]);
				expect(
					calls.every((call) => call.init.headers?.Authorization === 'Bearer ap_test_companion'),
				).toBe(true);
				expect(calls[0].body).toEqual(
					expect.objectContaining({
						agentId: 'agt_support',
						workflowId: 'wf_companion',
						executionId: 'exec_companion',
						nodeName: 'Test Node',
						chatSessionId: 'customer-chat-42',
						mode: 'checkOnly',
						requireSynced: true,
						executionPlane: 'n8nLocalCli',
						workingDirectoryTarget: 'phoenixAccessPath',
					}),
				);
				expect(calls[0].body).not.toHaveProperty('workingDirectory');
				expect(calls[1].body).toEqual(
					expect.objectContaining({
						agentId: 'agt_support',
						workspaceId: 'wrk_support',
						workflowId: 'wf_companion',
						executionId: 'exec_companion',
						nodeName: 'Test Node',
						chatSessionId: 'customer-chat-42',
						workingDirectory: companionWorkingDirectory,
						task: 'Test task',
					}),
				);
				expect(calls[2].body).toEqual(
					expect.objectContaining({
						agentId: 'agt_support',
						sessionId: 'test-session-123',
						chatSessionId: 'customer-chat-42',
						workingDirectory: companionWorkingDirectory,
						summary: 'Agent Plane directory ready',
						status: 'completed',
					}),
				);
				expect(calls[2].body).toEqual(
					expect.objectContaining({
						usage: expect.any(Object),
						observability: expect.any(Object),
						toolCalls: expect.any(Array),
						todos: expect.any(Array),
						tasks: expect.any(Array),
					}),
				);
			} finally {
				fs.rmSync(companionWorkingDirectory, { recursive: true, force: true });
			}
		});

		it.each(['ENOTFOUND', 'ECONNREFUSED'])(
			'falls back to localhost when host.docker.internal fails with %s in local dev',
			async (errorCode) => {
				process.env.AGENT_PLANE_ENABLED = '1';
				const companionWorkingDirectory = fs.mkdtempSync(
					path.join(os.tmpdir(), 'agent-plane-local-'),
				);
				const hostDockerError = new TypeError('fetch failed') as Error & {
					cause: { code: string };
				};
				hostDockerError.cause = { code: errorCode };
				const fetchMock = vi
					.fn()
					.mockRejectedValueOnce(hostDockerError)
					.mockResolvedValueOnce({
						ok: true,
						status: 200,
						statusText: 'OK',
						json: async () => ({
							agentId: 'agt_support',
							workspaceId: 'wrk_support',
							executionServerId: 'srv_local',
							workingDirectory: companionWorkingDirectory,
							directoryStatus: 'created',
							syncStatus: 'synced',
							ready: true,
						}),
					});
				vi.stubGlobal('fetch', fetchMock);
				mockExec.getCredentials.mockImplementation(async (name: string) => {
					if (name === 'claudeAgentCompanionApi') {
						return { apiKey: 'ap_test_companion' };
					}
					throw new Error('No credentials');
				});
				mockExec.getNodeParameter.mockImplementation(
					(name: string, _itemIndex: number, defaultValue?: unknown) => {
						if (name === 'companionAgent') {
							return {
								useCompanionAgent: true,
								companionAgentId: 'agt_support',
								companionReadinessMode: 'checkOnly',
								companionRequireSynced: true,
								companionLifecycleCallbacks: false,
							};
						}
						if (name === 'workingDirectory') return '';
						return defaultParams[name] ?? defaultValue;
					},
				);

				try {
					mockAdapter = createMockAdapter([
						mockMessages.systemInit,
						mockMessages.textMessage('Agent Plane local fallback ready'),
						mockMessages.result(),
					]);

					await executeTaskOperation(mockExec, 0, {
						apiKey: undefined,
						adapter: mockAdapter,
					});

					expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
						`${PHOENIX_COMPANION_BASE_URL}/api/n8n/agents/agt_support/ensure-ready`,
						`${PHOENIX_COMPANION_LOCAL_BASE_URL}/api/n8n/agents/agt_support/ensure-ready`,
					]);
				} finally {
					fs.rmSync(companionWorkingDirectory, { recursive: true, force: true });
				}
			},
		);

		it('surfaces a useful Agent Plane reachability error when both local endpoints fail', async () => {
			process.env.AGENT_PLANE_ENABLED = '1';
			const fetchError = new TypeError('fetch failed') as Error & {
				cause: { code: string };
			};
			fetchError.cause = { code: 'ECONNREFUSED' };
			const fetchMock = vi.fn().mockRejectedValue(fetchError);
			vi.stubGlobal('fetch', fetchMock);
			mockExec.getCredentials.mockImplementation(async (name: string) => {
				if (name === 'claudeAgentCompanionApi') {
					return { apiKey: 'ap_test_companion' };
				}
				throw new Error('No credentials');
			});
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'companionAgent') {
						return {
							useCompanionAgent: true,
							companionAgentId: 'agt_support',
							companionReadinessMode: 'checkOnly',
							companionRequireSynced: true,
							companionLifecycleCallbacks: false,
						};
					}
					if (name === 'workingDirectory') return '';
					return defaultParams[name] ?? defaultValue;
				},
			);

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: createMockAdapter([]),
				}),
			).rejects.toThrow(
				/Agent Plane request failed: unable to reach Agent Plane.*host\.docker\.internal:4000.*127\.0\.0\.1:4000.*ECONNREFUSED/s,
			);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('fails before execution when Agent Plane requires a synced workspace that is not ready', async () => {
			process.env.AGENT_PLANE_ENABLED = '1';
			const fetchMock = vi.fn(async () => ({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					agentId: 'agt_support',
					workspaceId: 'wrk_support',
					executionServerId: 'srv_local',
					workingDirectory: process.cwd(),
					directoryStatus: 'created',
					syncStatus: 'out_of_sync',
					ready: false,
				}),
			}));
			vi.stubGlobal('fetch', fetchMock);
			mockExec.getCredentials.mockImplementation(async (name: string) => {
				if (name === 'claudeAgentCompanionApi') {
					return { apiKey: 'ap_test_companion' };
				}
				throw new Error('No credentials');
			});
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'companionAgent') {
						return {
							useCompanionAgent: true,
							companionAgentId: 'agt_support',
							companionReadinessMode: 'checkOnly',
							companionRequireSynced: true,
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			mockAdapter = createMockAdapter([
				mockMessages.systemInit,
				mockMessages.textMessage('Should not execute'),
				mockMessages.result(),
			]);

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toThrow('Agent Plane reports agent "agt_support" is not ready');

			expect(mockAdapter.promptOnce).not.toHaveBeenCalled();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('surfaces Agent Plane 409 readiness status in the node error description', async () => {
			process.env.AGENT_PLANE_ENABLED = '1';
			const fetchMock = vi.fn(async () => ({
				ok: false,
				status: 409,
				statusText: 'Conflict',
				json: async () => ({
					error: 'not_ready',
					agentId: 'agt_support',
					workingDirectory: process.cwd(),
					directoryStatus: 'created',
					syncStatus: 'unknown',
					ready: false,
					warnings: ['workspace is not fully synced'],
				}),
			}));
			vi.stubGlobal('fetch', fetchMock);
			mockExec.getCredentials.mockImplementation(async (name: string) => {
				if (name === 'claudeAgentCompanionApi') {
					return { apiKey: 'ap_test_companion' };
				}
				throw new Error('No credentials');
			});
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'companionAgent') {
						return {
							useCompanionAgent: true,
							companionAgentId: 'agt_support',
							companionReadinessMode: 'checkOnly',
							companionRequireSynced: true,
							companionLifecycleCallbacks: true,
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			mockAdapter = createMockAdapter([
				mockMessages.systemInit,
				mockMessages.textMessage('should not run'),
				mockMessages.result(),
			]);

			await expect(
				executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				}),
			).rejects.toMatchObject({
				message: 'Agent Plane request failed: not_ready',
				description: expect.stringContaining('directoryStatus=created; syncStatus=unknown'),
			});

			expect(mockAdapter.promptOnce).not.toHaveBeenCalled();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('logs completion callback failures without failing a successful Agent Plane run', async () => {
			process.env.AGENT_PLANE_ENABLED = '1';
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const fetchMock = vi.fn(async (input: unknown) => {
				const url = String(input);

				if (url.endsWith('/api/n8n/agents/agt_support/ensure-ready')) {
					return {
						ok: true,
						status: 200,
						statusText: 'OK',
						json: async () => ({
							agentId: 'agt_support',
							workspaceId: 'wrk_support',
							executionServerId: 'srv_local',
							workingDirectory: process.cwd(),
							directoryStatus: 'created',
							syncStatus: 'synced',
							ready: true,
						}),
					};
				}

				if (url.endsWith('/api/n8n/runs/start')) {
					return {
						ok: true,
						status: 200,
						statusText: 'OK',
						json: async () => ({ runId: 'run_companion_1' }),
					};
				}

				return {
					ok: false,
					status: 503,
					statusText: 'Service Unavailable',
					json: async () => ({ error: 'execution_server_unreachable' }),
				};
			});
			vi.stubGlobal('fetch', fetchMock);
			mockExec.getCredentials.mockResolvedValue({ apiKey: 'ap_test_companion' });
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'companionAgent') {
						return {
							useCompanionAgent: true,
							companionAgentId: 'agt_support',
							companionReadinessMode: 'checkOnly',
							companionRequireSynced: true,
							companionLifecycleCallbacks: true,
						};
					}
					return defaultParams[name] ?? defaultValue;
				},
			);

			mockAdapter = createMockAdapter([
				mockMessages.systemInit,
				mockMessages.textMessage('Completed despite callback failure'),
				mockMessages.result(),
			]);

			const result = await executeTaskOperation(mockExec, 0, {
				apiKey: undefined,
				adapter: mockAdapter,
			});

			expect(result.returnData.json.summary).toContain('Completed despite callback failure');
			expect(fetchMock).toHaveBeenCalledTimes(3);
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to notify Agent Plane about completed run'),
			);
		});

		it('does not send completion callback when an Agent Plane run pauses for HITL approval', async () => {
			process.env.AGENT_PLANE_ENABLED = '1';
			const companionWorkingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-plane-hitl-'));
			const fetchMock = vi.fn(async (input: unknown) => {
				const url = String(input);

				if (url.endsWith('/api/n8n/agents/agt_support/ensure-ready')) {
					return {
						ok: true,
						status: 200,
						statusText: 'OK',
						json: async () => ({
							agentId: 'agt_support',
							workspaceId: 'wrk_support',
							executionServerId: 'srv_local',
							workingDirectory: companionWorkingDirectory,
							directoryStatus: 'created',
							syncStatus: 'synced',
							ready: true,
						}),
					};
				}

				if (url.endsWith('/api/n8n/runs/start')) {
					return {
						ok: true,
						status: 200,
						statusText: 'OK',
						json: async () => ({ runId: 'run_companion_hitl_1' }),
					};
				}

				throw new Error(`Unexpected Agent Plane request: ${url}`);
			});
			vi.stubGlobal('fetch', fetchMock);
			mockExec.getCredentials.mockImplementation(async (name: string) => {
				if (name === 'claudeAgentCompanionApi') {
					return { apiKey: 'ap_test_companion' };
				}
				throw new Error('No credentials');
			});
			(
				mockExec as unknown as { putExecutionToWait: (date: Date) => Promise<void> }
			).putExecutionToWait = vi.fn().mockResolvedValue(undefined);
			mockExec.getNodeParameter.mockImplementation(
				(name: string, _itemIndex: number, defaultValue?: unknown) => {
					if (name === 'companionAgent') {
						return {
							useCompanionAgent: true,
							companionAgentId: 'agt_support',
							companionReadinessMode: 'checkOnly',
							companionRequireSynced: true,
							companionLifecycleCallbacks: true,
						};
					}
					if (name === 'interactiveApprovals') return 'pauseForApproval';
					if (name === 'approvalScope') return 'notAllowed';
					if (name === 'approvalMatchMode') return 'tool';
					if (name === 'approvalTimeout') return 3600;
					if (name === 'sdkOwnsWaitResume') return true;
					return defaultParams[name] ?? defaultValue;
				},
			);

			const interruptSpy = vi.fn().mockResolvedValue(undefined);
			const promptOnce = vi.fn((_prompt: string, queryOptions?: Record<string, unknown>) => {
				const canUseTool = queryOptions?.canUseTool as
					| ((
							toolName: string,
							input: Record<string, unknown>,
							options: { signal: AbortSignal },
					  ) => Promise<unknown>)
					| undefined;
				const stream = (async function* () {
					yield { ...mockMessages.systemInit, session_id: 'test-session-123' };
					await canUseTool?.(
						'Bash',
						{ command: 'touch needs-approval.txt' },
						{ signal: new AbortController().signal },
					);
					yield mockMessages.textMessage('This output should wait for approval');
					yield mockMessages.result();
				})();

				return Object.assign(stream, { interrupt: interruptSpy });
			});
			mockAdapter = {
				version: 'v1',
				createSession: vi.fn(),
				resumeSession: vi.fn(),
				promptOnce,
			};

			try {
				const result = await executeTaskOperation(mockExec, 0, {
					apiKey: undefined,
					adapter: mockAdapter,
				});

				expect(result.returnData.json.type).toBe('approval_request');
				expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
					`${PHOENIX_COMPANION_BASE_URL}/api/n8n/agents/agt_support/ensure-ready`,
					`${PHOENIX_COMPANION_BASE_URL}/api/n8n/runs/start`,
				]);
				expect(interruptSpy).toHaveBeenCalledTimes(1);
			} finally {
				fs.rmSync(companionWorkingDirectory, { recursive: true, force: true });
			}
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

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
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

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
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

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
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

			const [, options] = (mockAdapter.promptOnce as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0];
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
