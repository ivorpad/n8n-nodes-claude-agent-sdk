/**
 * setupInteractiveApprovals — resume path regression tests
 *
 * Tests the critical resume data application paths:
 * - EngineResponse with metadata (native multi-hop)
 * - Webhook path with approval_response
 * - Webhook path with question_response
 * - Permission mode override
 * - Fingerprint restoration across hops
 * - Task description rewriting
 * - Missing/malformed resume data handling
 * - Strict HITL response envelope validation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineResponse } from 'n8n-workflow';

import { setupInteractiveApprovals } from '../../operations/executeTask/steps/interactiveApprovals';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

function createExec(overrides: Record<string, unknown> = {}) {
	return createMockExecuteFunctions({
		taskDescription: 'Original task description',
		chatSessionId: 'chat_1',
		workingDirectory: '',
		allowedTools: [],
		permissionMode: 'default',
		subagents: { agents: [] },
		enableMcpServers: false,
		mcpServers: { servers: [] },
		structuredOutput: false,
		additionalOptions: {},
		additionalDirectories: '',
		maxTurns: 0,
		treatAgentErrorsAsWorkflowErrors: false,
		streaming: { enabled: false },
		securityOptions: {},
		interactiveApprovals: 'pauseForApproval',
		approvalScope: 'notAllowed',
		toolsRequiringApproval: [],
		approvalMatchMode: 'tool',
		approvalTimeout: 3600,
		handleAskUserQuestion: true,
		allowPermissionModeOverride: false,
		allowedOverrideModes: [],
		...overrides,
	});
}

describe('setupInteractiveApprovals — resume paths', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── Webhook path: approval_response ────────────────────────────────

	describe('webhook path — approval_response', () => {
		it('sets resume=sessionId and marks isApprovalResume=true', async () => {
			const exec = createExec();
			const staticData: Record<string, unknown> = {};
			exec.getWorkflowStaticData.mockReturnValue(staticData);

			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sdk_session_42',
						fingerprint: 'tool:Bash',
						resumeSessionAt: 'msg_uuid_123',
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {};
			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
				chatSessionId: 'chat_1',
				resumeSessionId: undefined,
			});

			expect(result.isApprovalResume).toBe(true);
			expect(result.resumeSessionId).toBe('chat_1');
			expect(queryOptions.resume).toBe('chat_1');
			expect(queryOptions.resumeSessionAt).toBe('msg_uuid_123');
		});

		it('strips new-session-only options when webhook data converts a run into HITL resume', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});
			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sdk_session_42',
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {
				sessionId: 'chat_1',
				title: 'Initial title',
				forkSession: true,
			};
			await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
				chatSessionId: 'chat_1',
				resumeSessionId: undefined,
			});

			expect(queryOptions.resume).toBe('chat_1');
			expect(queryOptions.sessionId).toBeUndefined();
			expect(queryOptions.title).toBeUndefined();
			expect(queryOptions.forkSession).toBeUndefined();
		});

		it('preserves canonical taskDescription and emits a neutral executionPrompt on approve', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});
			const restoredTask = 'Approve the vacation request.';

			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sess_1',
						fingerprint: 'tool:Bash',
						originalTask: Buffer.from(restoredTask).toString('base64'),
					},
				},
			]);

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions: {},
				taskDescription: '{"version":"1.0","type":"approval_response"}',
			});

			expect(result.taskDescription).toBe(restoredTask);
			expect(result.executionPrompt).toBe('Continue with the task.');
			expect(result.executionPrompt).not.toContain('Bash');
			expect(result.executionPrompt).not.toContain('approved');
			expect(result.executionPrompt).not.toContain('rejected tool use');
			expect(result.executionPrompt).not.toContain('STOP');
			expect(result.pendingApprovalResolution).toEqual(
				expect.objectContaining({
					kind: 'approval',
					requestId: 'req_1',
					approved: true,
					fingerprint: 'tool:Bash',
				}),
			);
		});

		it('preserves canonical taskDescription and emits the same neutral executionPrompt on deny', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});

			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: false,
						resumeSessionId: 'sess_1',
						fingerprint: 'tool:Bash',
					},
				},
			]);

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions: {},
				taskDescription: 'Original task',
			});

			expect(result.taskDescription).toBe('Original task');
			expect(result.executionPrompt).toBe('Continue with the task.');
			expect(result.executionPrompt).not.toContain('denied');
			expect(result.executionPrompt).not.toContain('Bash');
			expect(result.pendingApprovalResolution).toEqual(
				expect.objectContaining({
					kind: 'approval',
					requestId: 'req_1',
					approved: false,
					fingerprint: 'tool:Bash',
				}),
			);
		});

		it('sets resumeSessionAt on denied approval so tool call replays through canUseTool', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});


			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: false,
						resumeSessionId: 'sess_1',
						resumeSessionAt: 'msg_uuid_should_not_apply',
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {};
			await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
			});

			expect(queryOptions.resumeSessionAt).toBe('msg_uuid_should_not_apply');
		});
	});

	// ─── Webhook path: question_response ────────────────────────────────

	describe('webhook path — question_response', () => {
		it('preserves canonical taskDescription and queues answers separately', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});
			const restoredTask = 'Check vacation request VAC-1001 and prepare approval for approver MGR-2001.';

			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'question_response',
						requestId: 'req_q1',
						decisionId: 'dec_q1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'slack',
						answers: { Format: 'JSON', Verbose: 'true' },
						resumeSessionId: 'sess_q',
						resumeSessionAt: 'msg_uuid_question_1',
						originalTask: Buffer.from(restoredTask).toString('base64'),
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {};
			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: '{"version":"1.0","type":"question_response"}',
				chatSessionId: 'chat_1',
			});

			expect(result.executionPrompt).toBeUndefined();
			expect(result.taskDescription).toBe(restoredTask);
			expect(result.isApprovalResume).toBe(true);
			expect(result.pendingQuestionResponse).toEqual({
				requestId: 'req_q1',
				answers: { Format: 'JSON', Verbose: 'true' },
			});
			expect(queryOptions.resume).toBe('chat_1');
			expect(queryOptions.resumeSessionAt).toBe('msg_uuid_question_1');
		});
	});

	// ─── Fingerprint restoration ────────────────────────────────────────

	describe('fingerprint restoration across hops', () => {
		it('restores previously approved fingerprints from base64', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});


			const previousFps = Buffer.from(JSON.stringify(['tool:Read', 'tool:Glob'])).toString('base64');

			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sess_1',
						fingerprint: 'tool:Bash',
						approvedFingerprints: previousFps,
					},
				},
			]);

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions: {},
				taskDescription: 'Original task',
			});

			// The handler should have Read, Glob, AND Bash marked as approved
			const handler = result.approvalHandler!;
			expect(handler.isApproved('tool:Read')).toBe(true);
			expect(handler.isApproved('tool:Glob')).toBe(true);
			expect(handler.isApproved('tool:Bash')).toBe(true);
		});
	});

	// ─── Permission mode override ───────────────────────────────────────

	describe('permission mode override', () => {
		it('applies permissionModeOverride when allowed', async () => {
			const exec = createExec({
				allowPermissionModeOverride: true,
				allowedOverrideModes: ['acceptEdits', 'bypassPermissions'],
			});
			exec.getWorkflowStaticData.mockReturnValue({});


			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sess_1',
						permissionModeOverride: 'acceptEdits',
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {};
			await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
			});

			expect(queryOptions.permissionMode).toBe('acceptEdits');
		});

		it('ignores permissionModeOverride when not in allowedOverrideModes', async () => {
			const exec = createExec({
				allowPermissionModeOverride: true,
				allowedOverrideModes: ['acceptEdits'], // only acceptEdits allowed
			});
			exec.getWorkflowStaticData.mockReturnValue({});


			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sess_1',
						permissionModeOverride: 'bypassPermissions', // not allowed
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {};
			await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
			});

			expect(queryOptions.permissionMode).toBeUndefined();
		});

		it('ignores permissionModeOverride when allowPermissionModeOverride=false', async () => {
			const exec = createExec({
				allowPermissionModeOverride: false,
			});
			exec.getWorkflowStaticData.mockReturnValue({});


			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sess_1',
						permissionModeOverride: 'bypassPermissions',
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {};
			await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
			});

			expect(queryOptions.permissionMode).toBeUndefined();
		});

		it('does NOT apply permissionModeOverride on deny', async () => {
			const exec = createExec({
				allowPermissionModeOverride: true,
				allowedOverrideModes: ['bypassPermissions'],
			});
			exec.getWorkflowStaticData.mockReturnValue({});


			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_1',
						decisionId: 'dec_1',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: false,
						resumeSessionId: 'sess_1',
						permissionModeOverride: 'bypassPermissions',
					},
				},
			]);

			const queryOptions: Record<string, unknown> = {};
			await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
			});

			expect(queryOptions.permissionMode).toBeUndefined();
		});
	});

	// ─── EngineResponse path ────────────────────────────────────────────

	describe('EngineResponse path (native multi-hop)', () => {
		it('extracts hitlData from ai_tool connection and applies approval', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});

			const engineResponse: EngineResponse = {
				metadata: {
					sessionId: 'engine_sess_1',
					taskDescriptionBase64: Buffer.from('Build it').toString('base64'),
					chatSessionId: 'chat_1',
					interactionKind: 'approval',
					requestId: 'req_engine_1',
					toolName: 'Bash',
					fingerprint: 'tool:Bash',
				},
				actionResponses: [
					{
						action: { id: 'action_1', nodeName: 'Slack HITL' },
						data: {
							data: {
								ai_tool: [
									[
										{
											json: {
												version: '1.0',
												type: 'approval_response',
												requestId: 'req_engine_1',
												decisionId: 'dec_engine_1',
												decidedAt: '2026-02-26T12:00:00.000Z',
												channel: 'slack',
												approved: true,
												resumeSessionId: 'engine_sess_1',
												fingerprint: 'tool:Bash',
											},
										},
									],
								],
							},
						},
					},
				],
			} as unknown as EngineResponse;

			const queryOptions: Record<string, unknown> = {};
			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: '',
				chatSessionId: 'chat_1',
				engineResponse,
			});

			expect(result.isApprovalResume).toBe(true);
			expect(result.resumeSessionId).toBe('chat_1');
			expect(queryOptions.resume).toBe('chat_1');
			expect(result.taskDescription).toBe('Build it');
			expect(result.executionPrompt).toBe('Continue with the task.');
		});

		it('throws when hitlData is missing from EngineResponse', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});

			const engineResponse: EngineResponse = {
				metadata: {
					sessionId: 'engine_sess_1',
					interactionKind: 'approval',
					requestId: 'req_engine_1',
				},
				actionResponses: [
					{
						action: { id: 'action_1' },
						data: {
							data: {
								ai_tool: [[]], // empty
							},
						},
					},
				],
			} as unknown as EngineResponse;

			await expect(
				setupInteractiveApprovals({
					execFunctions: exec,
					itemIndex: 0,
					permissionMode: 'default',
					queryOptions: {},
					taskDescription: '',
					engineResponse,
				}),
			).rejects.toThrow(/Missing HITL tool response/);
		});

		it('falls back to taskDescriptionBase64 from metadata when taskDescription is empty', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});

			const engineResponse: EngineResponse = {
				metadata: {
					sessionId: 'sess_2',
					taskDescriptionBase64: Buffer.from('Recovered task description').toString('base64'),
					chatSessionId: 'chat_1',
					interactionKind: 'approval',
					requestId: 'req_engine_2',
				},
				actionResponses: [
					{
						action: { id: 'action_2' },
						data: {
							data: {
								ai_tool: [
									[{
										json: {
											version: '1.0',
											type: 'approval_response',
											requestId: 'req_engine_2',
											decisionId: 'dec_engine_2',
											decidedAt: '2026-02-26T12:01:00.000Z',
											channel: 'slack',
											approved: true,
											resumeSessionId: 'sess_2',
										},
									}],
								],
							},
						},
					},
				],
			} as unknown as EngineResponse;

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions: {},
				taskDescription: '', // empty
				engineResponse,
			});

			// taskDescription should have been rewritten by applyHitlResponse,
			// but the base was recovered from metadata before that
			expect(result.taskDescription).toBeDefined();
			expect(result.taskDescription.length).toBeGreaterThan(0);
		});
	});

	describe('strict payload enforcement', () => {
		it('rejects raw payloads that only contain data', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});
			exec.getInputData.mockReturnValue([
				{
					json: {
						data: { approved: true },
					},
				},
			]);

			await expect(
				setupInteractiveApprovals({
					execFunctions: exec,
					itemIndex: 0,
					permissionMode: 'default',
					queryOptions: {},
					taskDescription: 'Original task',
				}),
			).rejects.toThrow(/strict HITL v1\.0 response envelope/i);
		});
	});

	// ─── Edge cases ─────────────────────────────────────────────────────

	describe('edge cases', () => {
		it('does not crash when no input data (first execution)', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});
			exec.getInputData.mockReturnValue([{ json: {} }]);

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions: {},
				taskDescription: 'First run',
			});

			expect(result.isApprovalResume).toBe(false);
			expect(result.taskDescription).toBe('First run');
		});

		it('throws when taskDescription is empty and no metadata fallback', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});
			exec.getInputData.mockReturnValue([{ json: {} }]);

			await expect(
				setupInteractiveApprovals({
					execFunctions: exec,
					itemIndex: 0,
					permissionMode: 'default',
					queryOptions: {},
					taskDescription: '',
				}),
			).rejects.toThrow(/Task Description is required/);
		});

		it('returns disabled config when interactiveApprovals=disabled', async () => {
			const exec = createExec({ interactiveApprovals: 'disabled' });
			exec.getWorkflowStaticData.mockReturnValue({});
			exec.getInputData.mockReturnValue([{ json: {} }]);

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions: {},
				taskDescription: 'A task',
			});

			expect(result.approvalConfig.enabled).toBe(false);
			expect(result.approvalHandler).toBeUndefined();
		});

		it('skips approval setup when permissionMode is not default', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});
			exec.getInputData.mockReturnValue([{ json: {} }]);

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'bypassPermissions',
				queryOptions: {},
				taskDescription: 'A task',
			});

			expect(result.approvalHandler).toBeUndefined();
		});

		it('streamingRequestId is captured from resume data', async () => {
			const exec = createExec();
			exec.getWorkflowStaticData.mockReturnValue({});


			exec.getInputData.mockReturnValue([
				{
					json: {
						version: '1.0',
						type: 'approval_response',
						requestId: 'req_stream',
						decisionId: 'dec_stream',
						decidedAt: '2026-02-26T12:00:00.000Z',
						channel: 'webhook',
						approved: true,
						resumeSessionId: 'sess_stream',
						streamingRequestId: 'stream_req_123',
						streamKey: 'stream_key_456',
					},
				},
			]);

			const result = await setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions: {},
				taskDescription: 'A task',
			});

			expect(result.pendingStreamKey).toBe('stream_key_456');
			expect(result.pendingStreamingRequestId).toBe('stream_key_456');
		});
	});
});
