import { describe, expect, it, vi } from 'vitest';

import { executeTaskOperation } from '../../operations/executeTask';

import { setupInteractiveApprovals } from '../../operations/executeTask/steps/interactiveApprovals';
import { HITL_APPROVAL_RESUME_PROMPT } from '../../operations/executeTask/steps/hitlResponseApplication';
import { createMockAdapter } from '../helpers/mockClaudeAgentSdk';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

function createApprovalExec() {
	return createMockExecuteFunctions({
		interactiveApprovals: 'pauseForApproval',
		approvalScope: 'notAllowed',
		toolsRequiringApproval: [],
		approvalMatchMode: 'tool',
		approvalTimeout: 3600,
		handleAskUserQuestion: true,
		allowPermissionModeOverride: false,
		allowedOverrideModes: [],
	});
}

function createAskUserQuestionToolUseOnlyAdapter(): ReturnType<typeof createMockAdapter> {
	const baseAdapter = createMockAdapter();

	return {
		...baseAdapter,
		promptOnce: () =>
			(async function* () {
				yield { type: 'system', subtype: 'init', session_id: 'session_ask_guard_1' };
				yield {
					type: 'tool_use',
					name: 'AskUserQuestion',
					input: {
						questions: [
							{
								question: 'Proceed?',
								header: 'Proceed',
								options: [],
								multiSelect: false,
							},
						],
					},
				};
				yield { type: 'result', subtype: 'success' };
			})(),
	};
}

function createRepeatedAskUserQuestionAdapter(): {
	adapter: ReturnType<typeof createMockAdapter>;
	interruptSpy: ReturnType<typeof vi.fn>;
} {
	const baseAdapter = createMockAdapter();
	const interruptSpy = vi.fn().mockResolvedValue(undefined);

	return {
		interruptSpy,
		adapter: {
			...baseAdapter,
			promptOnce: (_prompt: string, options: Record<string, unknown>) => {
				const stream = (async function* () {
					yield { type: 'system', subtype: 'init', session_id: 'session_ask_repeat_1' };

					const canUseTool = options.canUseTool as
						| ((
								toolName: string,
								input: Record<string, unknown>,
								options: { signal: AbortSignal },
						  ) => Promise<unknown>)
						| undefined;
					const signal = new AbortController().signal;

					await canUseTool?.(
						'AskUserQuestion',
						{
							questions: [
								{
									question: 'First?',
									header: 'First',
									options: [{ label: 'Yes', description: '' }],
									multiSelect: false,
								},
							],
						},
						{ signal },
					);

					await canUseTool?.(
						'AskUserQuestion',
						{
							questions: [
								{
									question: 'Second?',
									header: 'Second',
									options: [{ label: 'No', description: '' }],
									multiSelect: false,
								},
							],
						},
						{ signal },
					);

					yield {
						type: 'assistant',
						uuid: 'assistant_after_pending',
						message: {
							content: [{ type: 'text', text: 'This should be suppressed once HITL is pending.' }],
						},
					};
					yield { type: 'result', subtype: 'success' };
				})();

				return Object.assign(stream, {
					interrupt: interruptSpy,
				});
			},
		},
	};
}

describe('setupInteractiveApprovals', () => {
	it('applies resumeSessionAt when approval resume includes resume + rsat', async () => {
		const exec = createApprovalExec();
		exec.getInputData.mockReturnValue([
			{
				json: {
					version: '1.0',
					type: 'approval_response',
					requestId: 'req_1',
					decisionId: 'dec_1',
					decidedAt: '2026-01-01T00:00:00.000Z',
					channel: 'webhook',
					approved: true,
					resumeSessionId: 'session_123',
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
		});

		expect(result.isApprovalResume).toBe(true);
		expect(result.pendingResumeSessionAt).toBe('msg_uuid_123');
		expect(queryOptions.resume).toBe('session_123');
		expect(queryOptions.resumeSessionAt).toBe('msg_uuid_123');
	});

	it('does not set resumeSessionAt when resume is missing', async () => {
		const exec = createApprovalExec();
		exec.getInputData.mockReturnValue([
			{
				json: {
					version: '1.0',
					type: 'approval_response',
					requestId: 'req_1',
					decisionId: 'dec_2',
					decidedAt: '2026-01-01T00:00:01.000Z',
					channel: 'webhook',
					approved: true,
					resumeSessionAt: 'msg_uuid_123',
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

		expect(queryOptions.resume).toBeUndefined();
		expect(queryOptions.resumeSessionAt).toBeUndefined();
	});

	it('throws when HITL response payload is missing requestId', async () => {
		const exec = createApprovalExec();
		exec.getInputData.mockReturnValue([
			{
				json: {
					version: '1.0',
					type: 'question_response',
					decisionId: 'dec_missing_request',
					decidedAt: '2026-01-01T00:00:01.000Z',
					channel: 'webhook',
					answers: { Format: 'Summary' },
				},
			},
		]);

		const queryOptions: Record<string, unknown> = {};
		await expect(
			setupInteractiveApprovals({
				execFunctions: exec,
				itemIndex: 0,
				permissionMode: 'default',
				queryOptions,
				taskDescription: 'Original task',
			}),
		).rejects.toThrow(/requestId is required/i);
	});

	it('maps raw WhatsApp button reply approve token into strict approval_response fallback', async () => {
		const exec = createApprovalExec();
		exec.getInputData.mockReturnValue([
			{
				json: {
					field: 'messages',
					messages: [
						{
							id: 'wamid.fallback_approval_1',
							from: '34690123456',
							interactive: {
								type: 'button_reply',
								button_reply: {
									id: 'hitl|approve|req_whatsapp_approval_1',
									title: 'Approve',
								},
							},
						},
					],
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
			resumeSessionId: 'session_from_memory_1',
		});

		expect(result.isApprovalResume).toBe(true);
		expect(queryOptions.resume).toBe('session_from_memory_1');
		expect(result.taskDescription).toBe('Original task');
		expect(result.executionPrompt).toBe(HITL_APPROVAL_RESUME_PROMPT);
	});

	it('maps raw WhatsApp question reply token into strict question_response fallback', async () => {
		const exec = createApprovalExec();
		exec.getInputData.mockReturnValue([
			{
				json: {
					field: 'messages',
					messages: [
						{
							id: 'wamid.fallback_question_1',
							from: '34690123456',
							interactive: {
								type: 'button_reply',
								button_reply: {
									id: 'hitl|q|req_whatsapp_question_1|0|1',
									title: 'Summary',
								},
							},
						},
					],
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
			resumeSessionId: 'session_from_memory_2',
		});

		expect(result.isApprovalResume).toBe(true);
		expect(queryOptions.resume).toBe('session_from_memory_2');
		expect(result.pendingQuestionResponse).toEqual({
			requestId: 'req_whatsapp_question_1',
			answers: { 'field-0': 'Summary' },
		});
		expect(result.taskDescription).toBe('Original task');
		// Question replies queue answers via pendingQuestionResponse and leave the
		// prompt as the task description — unlike approvals, no neutral executionPrompt
		// is set (see setupInteractiveApprovals.resume.test.ts "queues answers separately").
		expect(result.executionPrompt).toBeUndefined();
	});
});

describe('executeTaskOperation pre-flight guards', () => {
	it('returns task_result when AskUserQuestion tool_use is emitted without runtime pending interaction creation', async () => {
		const exec = createMockExecuteFunctions({
			interactiveApprovals: 'pauseForApproval',
			handleAskUserQuestion: true,
			taskDescription: 'Test task',
		});

		const result = await executeTaskOperation(exec, 0, {
			adapter: createAskUserQuestionToolUseOnlyAdapter(),
			backendMode: 'localCli',
			authMethod: 'apiCredentials',
		});

		expect(result.returnData.json.type).toBe('task_result');
	});

	it('returns a single question_request when AskUserQuestion is attempted again in the same run', async () => {
		const { adapter, interruptSpy } = createRepeatedAskUserQuestionAdapter();
		const exec = createMockExecuteFunctions({
			interactiveApprovals: 'pauseForApproval',
			handleAskUserQuestion: true,
			taskDescription: 'Test task',
		});
		exec.putExecutionToWait.mockResolvedValue(undefined as never);

		const result = await executeTaskOperation(exec, 0, {
			adapter,
			backendMode: 'localCli',
			authMethod: 'apiCredentials',
		});

		expect(result.returnData.json.type).toBe('question_request');
		expect(result.returnData.json.questions).toMatchObject([
			{
				question: 'First?',
				header: 'First',
			},
		]);
		expect(result.returnData.json.message).not.toContain('suppressed once HITL is pending');
		expect(interruptSpy).toHaveBeenCalledTimes(1);
	});
});
