import { describe, expect, it, vi } from 'vitest';

import type { ApprovalHandler } from '../../permissions';
import type { NotificationChannel } from '../../notifications/types';
import type { HitlInteractionStore } from '../../hitl/interactionStore';
import { HITL_CONTRACT_VERSION } from '../../hitl/contract';
import {
	createRuntimeApprovalInteraction,
	createRuntimePendingState,
	createRuntimeQuestionInteraction,
} from '../../operations/executeTask/hitlRuntimeState';
import { waitForPendingInteractions } from '../../operations/executeTask/steps/pendingInteractions';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

describe('waitForPendingInteractions - resumeSessionAt forwarding', () => {
	it('passes stored resumeSessionAt to createApprovalUrls', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeApprovalInteraction({
				requestId: 'req_1',
				toolName: 'Bash',
				toolInput: { command: 'ls -la' },
				timeoutMs: 1000,
				fingerprint: 'tool:Bash',
				resumeSessionAt: 'assistant_uuid_anchor',
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn().mockReturnValue({
				approveUrl: 'https://example.com/approve',
				denyUrl: 'https://example.com/deny',
			}),
			createQuestionUrl: vi.fn(),
		} as unknown as ApprovalHandler;

		const approvalNotificationChannel = {
			name: 'test',
			sendApproval: vi.fn().mockResolvedValue(undefined),
			sendQuestion: vi.fn().mockResolvedValue(undefined),
		} as NotificationChannel;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			approvalNotificationChannel,
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			runtimePendingState,
		});

		expect(result?.returnData.json).toMatchObject({
			version: HITL_CONTRACT_VERSION,
			type: 'approval_request',
			requestId: 'req_1',
			sessionId: 'session_123',
			toolName: 'Bash',
		});

		expect(approvalHandler.createApprovalUrls).toHaveBeenCalledWith(
			'req_1',
			'tool:Bash',
			Buffer.from('Task').toString('base64'),
			'session_123',
			'assistant_uuid_anchor',
			undefined,
		);
	});

	it('keeps mapped working directory when pending interaction resumes same session', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_same_session',
				timeoutMs: 1000,
				questions: [],
				resumeSessionAt: 'assistant_uuid_question',
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;

		const sessionMemory = {
			type: 'claude-session-memory' as const,
			has: vi.fn(),
			touch: vi.fn().mockResolvedValue(undefined),
		};

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'chat-1' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: 'chat-1',
			workingDirectory: '/tmp/new',
			mappedWorkingDirectory: '/tmp/original',
			resumeSessionId: 'chat-1',
			sessionMemory,
			hasAuditLogging: false,
			runtimePendingState,
		});

		expect(result?.returnData.json).toMatchObject({
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_same_session',
			sessionId: 'chat-1',
			questions: [],
		});

		expect(sessionMemory.touch).toHaveBeenCalledWith('chat-1', expect.any(String), {
			workingDirectory: '/tmp/original',
		});
	});

	it('passes stored resumeSessionAt to createQuestionUrl', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_question_anchor',
				timeoutMs: 1000,
				questions: [{ question: 'Proceed?', header: 'Proceed', options: [], multiSelect: false }],
				resumeSessionAt: 'assistant_uuid_question_anchor',
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;

		const approvalNotificationChannel = {
			name: 'test',
			sendApproval: vi.fn().mockResolvedValue(undefined),
			sendQuestion: vi.fn().mockResolvedValue(undefined),
		} as NotificationChannel;

		await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			approvalNotificationChannel,
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			runtimePendingState,
		});

		expect(approvalHandler.createQuestionUrl).toHaveBeenCalledWith(
			'req_question_anchor',
			Buffer.from('Task').toString('base64'),
			'session_123',
			expect.anything(),
			'assistant_uuid_question_anchor',
			undefined,
		);
	});

	it('persists pending approval interaction before putting execution to wait', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeApprovalInteraction({
				requestId: 'req_persist_approval',
				streamKey: 'stream_persist',
				toolName: 'Bash',
				toolInput: { command: 'npm test' },
				timeoutMs: 1000,
				fingerprint: 'tool:Bash:npm-test',
				resumeSessionAt: 'assistant_uuid_persist',
				executionId: 'exec_persist',
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue('fingerprints_base64'),
			createApprovalUrls: vi.fn().mockReturnValue({
				approveUrl: 'https://example.com/approve',
				denyUrl: 'https://example.com/deny',
			}),
			createQuestionUrl: vi.fn(),
		} as unknown as ApprovalHandler;
		const hitlInteractionStore = {
			backend: 'staticData',
			saveInteraction: vi.fn().mockResolvedValue(undefined),
			getInteraction: vi.fn(),
			consumeApprovalDecision: vi.fn(),
			consumeQuestionDecision: vi.fn(),
		} as unknown as HitlInteractionStore;

		await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_persist' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			shouldStream: false,
			taskDescription: 'Persist task',
			chatSessionId: 'chat_persist',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			executionId: 'exec_persist',
			runtimePendingState,
			hitlInteractionStore,
		});

		expect(hitlInteractionStore.saveInteraction).toHaveBeenCalledWith({
			requestId: 'req_persist_approval',
			kind: 'approval',
			status: 'pending',
			createdAt: expect.any(Number),
			timeoutMs: 1000,
			executionId: 'exec_persist',
			chatSessionId: 'chat_persist',
			sessionId: 'session_persist',
			streamKey: 'stream_persist',
			originalTaskBase64: Buffer.from('Persist task').toString('base64'),
			approvedFingerprints: 'fingerprints_base64',
			resumeSessionAt: 'assistant_uuid_persist',
			fingerprint: 'tool:Bash:npm-test',
			toolName: 'Bash',
			toolInput: { command: 'npm test' },
		});
		expect(hitlInteractionStore.saveInteraction).toHaveBeenCalledBefore(exec.putExecutionToWait);
	});

	it('persists pending question interaction before putting execution to wait', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();
		const questions = [
			{
				question: 'Deploy now?',
				header: 'Deploy',
				options: [
					{ label: 'Yes', value: 'yes' },
					{ label: 'No', value: 'no' },
				],
				multiSelect: false,
			},
		];

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_persist_question',
				streamKey: 'stream_question',
				timeoutMs: 1000,
				questions,
				resumeSessionAt: 'assistant_uuid_question_persist',
				executionId: 'exec_persist',
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue('fingerprints_base64'),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;
		const hitlInteractionStore = {
			backend: 'staticData',
			saveInteraction: vi.fn().mockResolvedValue(undefined),
			getInteraction: vi.fn(),
			consumeApprovalDecision: vi.fn(),
			consumeQuestionDecision: vi.fn(),
		} as unknown as HitlInteractionStore;

		await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_question' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			shouldStream: false,
			taskDescription: 'Question task',
			chatSessionId: 'chat_question',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			executionId: 'exec_persist',
			runtimePendingState,
			hitlInteractionStore,
		});

		expect(hitlInteractionStore.saveInteraction).toHaveBeenCalledWith({
			requestId: 'req_persist_question',
			kind: 'question',
			status: 'pending',
			createdAt: expect.any(Number),
			timeoutMs: 1000,
			executionId: 'exec_persist',
			chatSessionId: 'chat_question',
			sessionId: 'session_question',
			streamKey: 'stream_question',
			originalTaskBase64: Buffer.from('Question task').toString('base64'),
			approvedFingerprints: 'fingerprints_base64',
			resumeSessionAt: 'assistant_uuid_question_persist',
			questions,
		});
		expect(hitlInteractionStore.saveInteraction).toHaveBeenCalledBefore(exec.putExecutionToWait);
	});

	it('emits HITL request without SDK wait when sdkOwnsWaitResume is disabled', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeApprovalInteraction({
				requestId: 'req_companion_loop_1',
				toolName: 'Bash',
				toolInput: { command: 'pwd' },
				timeoutMs: 1000,
				fingerprint: 'tool:Bash',
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn(),
		} as unknown as ApprovalHandler;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1, sdkOwnsWaitResume: false },
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			runtimePendingState,
		});

		expect(result?.returnData.json).toMatchObject({
			version: HITL_CONTRACT_VERSION,
			type: 'approval_request',
			requestId: 'req_companion_loop_1',
			sessionId: 'session_123',
		});
		expect(exec.putExecutionToWait).not.toHaveBeenCalled();
		expect(approvalHandler.createApprovalUrls).not.toHaveBeenCalled();
	});

	it('only waits/notifies interactions created by the current execution', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_old_exec',
				timeoutMs: 1000,
				executionId: 'exec_old',
				questions: [{ question: 'Old?', header: 'Old', options: [], multiSelect: false }],
			}),
		);
		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_current_exec',
				timeoutMs: 1000,
				executionId: 'exec_current',
				questions: [{ question: 'Current?', header: 'Current', options: [], multiSelect: false }],
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;

		const approvalNotificationChannel = {
			name: 'test',
			sendApproval: vi.fn().mockResolvedValue(undefined),
			sendQuestion: vi.fn().mockResolvedValue(undefined),
		} as NotificationChannel;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			approvalNotificationChannel,
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			executionId: 'exec_current',
			runtimePendingState,
		});

		expect(result?.returnData.json).toMatchObject({
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_current_exec',
			sessionId: 'session_123',
		});

		expect(exec.putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(approvalNotificationChannel.sendQuestion).toHaveBeenCalledTimes(1);
		expect(approvalNotificationChannel.sendQuestion).toHaveBeenCalledWith(
			expect.objectContaining({ requestId: 'req_current_exec' }),
		);
		expect(approvalHandler.createQuestionUrl).toHaveBeenCalledWith(
			'req_current_exec',
			expect.any(String),
			'session_123',
			expect.anything(),
			undefined,
			undefined,
		);
	});

	it('skips deferred channel send when interaction was already notified immediately', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		const interaction = createRuntimeQuestionInteraction({
			requestId: 'req_already_streamed',
			timeoutMs: 1000,
			executionId: 'exec_current',
			questions: [{ question: 'Q?', header: 'Q', options: [], multiSelect: false }],
		});
		interaction.notifiedImmediately = true;
		runtimePendingState.addInteraction(interaction);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;

		const approvalNotificationChannel = {
			name: 'test',
			sendApproval: vi.fn().mockResolvedValue(undefined),
			sendQuestion: vi.fn().mockResolvedValue(undefined),
		} as NotificationChannel;

		await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			approvalNotificationChannel,
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			executionId: 'exec_current',
			runtimePendingState,
		});

		expect(exec.putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(approvalNotificationChannel.sendQuestion).not.toHaveBeenCalled();
		expect(approvalNotificationChannel.sendApproval).not.toHaveBeenCalled();
	});

	it('does not wait when only stale interactions from other executions are pending', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_other_exec',
				timeoutMs: 1000,
				executionId: 'exec_old',
				questions: [],
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn(),
		} as unknown as ApprovalHandler;

		const approvalNotificationChannel = {
			name: 'test',
			sendApproval: vi.fn().mockResolvedValue(undefined),
			sendQuestion: vi.fn().mockResolvedValue(undefined),
		} as NotificationChannel;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1 },
			approvalNotificationChannel,
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			executionId: 'exec_current',
			runtimePendingState,
		});

		expect(result).toBeNull();
		expect(exec.putExecutionToWait).not.toHaveBeenCalled();
		expect(approvalNotificationChannel.sendQuestion).not.toHaveBeenCalled();
		expect(approvalNotificationChannel.sendApproval).not.toHaveBeenCalled();
	});

	it('throws when multiple pending interactions exist in the same execution', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_multi_1',
				timeoutMs: 1000,
				executionId: 'exec_current',
				questions: [{ question: 'First?', header: 'First', options: [], multiSelect: false }],
			}),
		);
		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_multi_2',
				timeoutMs: 1000,
				executionId: 'exec_current',
				questions: [{ question: 'Second?', header: 'Second', options: [], multiSelect: false }],
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn(),
		} as unknown as ApprovalHandler;

		await expect(
			waitForPendingInteractions({
				execFunctions: exec,
				itemIndex: 0,
				messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
				approvalHandler,
				approvalConfig: {
					timeoutSeconds: 1,
					mode: 'pauseForApproval',
					handleAskUserQuestion: true,
				},
				shouldStream: false,
				taskDescription: 'Task',
				chatSessionId: '',
				workingDirectory: '/tmp',
				hasAuditLogging: false,
				executionId: 'exec_current',
				runtimePendingState,
			}),
		).rejects.toThrow(/Multiple pending HITL interactions detected/);

		expect(exec.putExecutionToWait).not.toHaveBeenCalled();
	});

	it('returns null when AskUserQuestion tool_use exists but runtime pending state is empty', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn(),
		} as unknown as ApprovalHandler;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [
				{ type: 'system', subtype: 'init', session_id: 'session_123' },
				{
					type: 'tool_use',
					name: 'AskUserQuestion',
					input: {
						questions: [
							{ question: 'Proceed?', header: 'Proceed', options: [], multiSelect: false },
						],
					},
				},
			],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1, mode: 'pauseForApproval', handleAskUserQuestion: true },
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			executionId: 'exec_current',
			runtimePendingState,
		});

		expect(result).toBeNull();
	});

	it('returns strict question_request when AskUserQuestion runtime interaction exists', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_ask_user_1',
				timeoutMs: 1000,
				executionId: 'exec_current',
				questions: [{ question: 'Proceed?', header: 'Proceed', options: [], multiSelect: false }],
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [
				{ type: 'system', subtype: 'init', session_id: 'session_123' },
				{
					type: 'tool_use',
					name: 'AskUserQuestion',
					input: {
						questions: [
							{ question: 'Proceed?', header: 'Proceed', options: [], multiSelect: false },
						],
					},
				},
			],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1, mode: 'pauseForApproval', handleAskUserQuestion: true },
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: '',
			workingDirectory: '/tmp',
			hasAuditLogging: false,
			executionId: 'exec_current',
			runtimePendingState,
		});

		expect(result?.returnData.json).toMatchObject({
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_ask_user_1',
			sessionId: 'session_123',
		});
	});

	it('includes hitl_result context and keeps assistant summary in question message', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_summary_1',
				timeoutMs: 1000,
				executionId: 'exec_current',
				questions: [
					{
						question: 'Do you want another section?',
						header: 'Next',
						options: [],
						multiSelect: false,
					},
				],
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [{ type: 'system', subtype: 'init', session_id: 'session_123' }],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1, mode: 'pauseForApproval', handleAskUserQuestion: true },
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: 'chat_123',
			workingDirectory: '/tmp',
			executionId: 'exec_current',
			hitlResult: {
				type: 'task_result',
				task: 'Task',
				summary: 'Here is the overview.',
				messages: [{ type: 'text', text: 'Here is the overview.' }],
			},
			hasAuditLogging: false,
			runtimePendingState,
		});

		expect(result?.returnData.json).toMatchObject({
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_summary_1',
			sessionId: 'session_123',
			hitl_result: {
				type: 'task_result',
				summary: 'Here is the overview.',
			},
			agent_sdk_result: {
				type: 'task_result',
				summary: 'Here is the overview.',
			},
		});
		expect(result?.returnData.json.message).toContain('Here is the overview.');
		expect(result?.returnData.json.message).toContain('Do you want another section?');
	});

	it('falls back to assistant message text when hitl_result summary is blank', async () => {
		const exec = createMockExecuteFunctions();
		exec.putExecutionToWait.mockResolvedValue(undefined);
		const runtimePendingState = createRuntimePendingState();

		runtimePendingState.addInteraction(
			createRuntimeQuestionInteraction({
				requestId: 'req_summary_fallback_1',
				timeoutMs: 1000,
				executionId: 'exec_current',
				questions: [
					{
						question: 'Continue?',
						header: 'Next',
						options: [],
						multiSelect: false,
					},
				],
			}),
		);

		const approvalHandler = {
			serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
			createApprovalUrls: vi.fn(),
			createQuestionUrl: vi.fn().mockReturnValue('https://example.com/question'),
		} as unknown as ApprovalHandler;

		const result = await waitForPendingInteractions({
			execFunctions: exec,
			itemIndex: 0,
			messages: [
				{ type: 'system', subtype: 'init', session_id: 'session_123' },
				{
					type: 'assistant',
					message: {
						content: [{ type: 'text', text: 'Derived assistant overview.' }],
					},
				},
			],
			approvalHandler,
			approvalConfig: { timeoutSeconds: 1, mode: 'pauseForApproval', handleAskUserQuestion: true },
			shouldStream: false,
			taskDescription: 'Task',
			chatSessionId: 'chat_123',
			workingDirectory: '/tmp',
			executionId: 'exec_current',
			hitlResult: {
				type: 'task_result',
				task: 'Task',
				summary: '',
				messages: [],
			},
			hasAuditLogging: false,
			runtimePendingState,
		});

		expect(result?.returnData.json.message).toContain('Derived assistant overview.');
		expect(result?.returnData.json.message).toContain('Continue?');
	});
});
