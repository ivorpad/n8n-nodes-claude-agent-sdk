/**
 * canUseToolCallback HITL regression tests
 *
 * Tests the critical approval flow paths:
 * - AskUserQuestion handling
 * - Already-approved tool bypass
 * - Approval scope matching (notAllowed, fileOps, bash, specific)
 * - Aborted signal handling
 * - Interaction storage timing
 * - HITL message prefix
 * - SharedExecutionState sessionId resolution
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';

import {
	createCanUseToolCallback,
	HITL_MESSAGE_PREFIX,
	type CanUseToolCallback,
	type SharedExecutionState,
} from '../../permissions/canUseToolCallback';
import { ApprovalHandler } from '../../permissions/ApprovalHandler';
import type { ApprovalConfig } from '../../permissions/approvalProperties';
import { createRuntimePendingState } from '../../operations/executeTask/hitlRuntimeState';

function createExec(): ReturnType<typeof mock<IExecuteFunctions>> & { staticData: Record<string, unknown> } {
	const exec = mock<IExecuteFunctions>();
	const staticData: Record<string, unknown> = {};
	exec.getWorkflowStaticData.mockReturnValue(staticData);
	exec.getSignedResumeUrl.mockImplementation(
		(params: Record<string, string>) => `https://test.n8n/webhook?${new URLSearchParams(params)}`,
	);
	return Object.assign(exec, { staticData });
}

function defaultApprovalConfig(overrides: Partial<ApprovalConfig> = {}): ApprovalConfig {
	return {
		enabled: true,
		mode: 'pauseForApproval',
		scope: 'notAllowed',
		specificTools: [],
		approvalMatchMode: 'tool',
		timeoutSeconds: 3600,
		defaultOnTimeout: 'deny',
		handleAskUserQuestion: true,
		sdkOwnsWaitResume: true,
		allowPermissionModeOverride: false,
		allowedOverrideModes: [],
		hitlWebhookAuthentication: 'none',
		hitlWebhookResponderIdentity: 'none',
		hitlWebhookIdentityHeaderName: 'x-auth-request-email',
		hitlWebhookIdentityJwtClaim: 'sub',
		...overrides,
	};
}

function createSignal(aborted = false): AbortSignal {
	return { aborted } as AbortSignal;
}

describe('canUseToolCallback — HITL flow', () => {
	let exec: ReturnType<typeof createExec>;
	let handler: ApprovalHandler;

	beforeEach(() => {
		vi.clearAllMocks();
		exec = createExec();
		exec.evaluateExpression.mockReturnValue(
			'https://n8n.test/webhook-waiting/exec1?signature=tok123',
		);
		const fakeNode = mock<import('n8n-workflow').INode>();
		fakeNode.id = 'node_xyz';
		exec.getNode.mockReturnValue(fakeNode);
		handler = new ApprovalHandler(exec, 0);
	});

	// ─── Abort signal ───────────────────────────────────────────────────

	it('returns deny with interrupt when signal is aborted', async () => {
		const cb = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'test task',
		});

		const result = await cb('Bash', { command: 'ls' }, { signal: createSignal(true) });

		expect(result.behavior).toBe('deny');
		expect((result as { interrupt?: boolean }).interrupt).toBe(true);
		expect((result as { message?: string }).message).toBe('Operation aborted');
	});

	// ─── AskUserQuestion handling ───────────────────────────────────────

	describe('AskUserQuestion tool', () => {
		it('auto-allows resumed AskUserQuestion once with queued answers', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_1',
					answers: {
						'What color?': 'Blue',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [{ label: 'Blue', description: '' }],
						multiSelect: false,
					},
				],
			};

			const first = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(first.behavior).toBe('allow');
			expect((first as { updatedInput?: Record<string, unknown> }).updatedInput?.answers).toEqual({
				'What color?': 'Blue',
			});
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(0);

			const second = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(second.behavior).toBe('deny');
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(1);
		});

		it('auto-allows resumed AskUserQuestion when queued answers are keyed by header', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_header_1',
					answers: {
						Color: 'Blue',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [{ label: 'Blue', description: '' }],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
			expect((result as { updatedInput?: Record<string, unknown> }).updatedInput?.answers).toEqual({
				'What color?': 'Blue',
			});
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(0);
		});

		it('auto-allows free-text sentinel AskUserQuestion answers', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_free_text_1',
					answers: {
						OTP: '613056',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'Enter the 6-digit OTP sent out-of-band for this vacation approval.',
						header: 'OTP',
						options: [
							{ label: 'Free text', description: '', value: '__free_text__' },
							{ label: 'Free text alt', description: '', value: '__free_text_alt__' },
						],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
			expect((result as { updatedInput?: Record<string, unknown> }).updatedInput?.answers).toEqual({
				'Enter the 6-digit OTP sent out-of-band for this vacation approval.': '613056',
			});
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(0);
		});

		it('does not auto-allow when queued answers do not map to the current question set', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_mismatch_1',
					answers: {
						Unrelated: 'Blue',
						Another: 'Red',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [{ label: 'Blue', description: '' }],
						multiSelect: false,
					},
					{
						question: 'What shape?',
						header: 'Shape',
						options: [{ label: 'Circle', description: '' }],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(1);
		});

		it('does not auto-allow a stale single queued answer for a different single question', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_stale_single_1',
					answers: {
						Lineamientos: 'No',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: '¿En qué tipo de empresa será la entrevista?',
						header: 'Empresa',
						options: [{ label: 'Producto propio', description: '' }],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(1);
		});

		it('auto-allows indexed queued answers when they match the current option labels', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_indexed_match_1',
					answers: {
						'field-0': 'Blue',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [
							{ label: 'Blue', description: '' },
							{ label: 'Red', description: '' },
						],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
			expect((result as { updatedInput?: Record<string, unknown> }).updatedInput?.answers).toEqual({
				'What color?': 'Blue',
			});
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(0);
		});

		it('does not auto-allow indexed queued answers when they do not match current options', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_indexed_stale_1',
					answers: {
						'field-0': 'Yes, fetch uv docs (',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What should I do next?',
						header: 'Next',
						options: [
							{ label: 'Search docs', description: '' },
							{ label: 'Read source', description: '' },
						],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(1);
		});

		it('does not auto-allow resumed AskUserQuestion when queued answers are blank', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				pendingQuestionResponse: {
					requestId: 'req_q_resume_blank_1',
					answers: {
						'What color?': '   ',
					},
				},
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [{ label: 'Blue', description: '' }],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(1);
		});

		it('stores a question interaction and returns deny+interrupt', async () => {
			const savedInteractions: Array<Record<string, unknown>> = [];
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				interactionStore: {
					backend: 'staticData',
					saveInteraction: vi.fn(async (record) => {
						savedInteractions.push(record as unknown as Record<string, unknown>);
					}),
					getInteraction: vi.fn(),
					consumeApprovalDecision: vi.fn(),
					consumeQuestionDecision: vi.fn(),
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [{ label: 'Red', description: 'A warm color' }],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });

			expect(result.behavior).toBe('deny');
			expect((result as { interrupt?: boolean }).interrupt).toBe(true);
			expect((result as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);
			expect(savedInteractions).toHaveLength(1);
			expect(savedInteractions[0].kind).toBe('question');
			expect(savedInteractions[0].questions).toEqual([
				{
					question: 'What color?',
					header: 'Color',
					options: [{ label: 'Red', description: 'A warm color', value: 'q0o0' }],
					multiSelect: false,
				},
			]);
		});

		it('keeps the first pending question authoritative within a single execution', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
				executionId: 'exec_1',
			});

			const firstQuestion = {
				questions: [
					{
						question: 'First question?',
						header: 'First',
						options: [{ label: 'Yes', description: '' }],
						multiSelect: false,
					},
				],
			};
			const secondQuestion = {
				questions: [
					{
						question: 'Second question?',
						header: 'Second',
						options: [{ label: 'No', description: '' }],
						multiSelect: false,
					},
				],
			};

			const first = await cb('AskUserQuestion', firstQuestion, { signal: createSignal() });
			const pendingAfterFirst = runtimePendingState.getPendingForExecution('exec_1');
			const second = await cb('AskUserQuestion', secondQuestion, { signal: createSignal() });
			const pendingAfterSecond = runtimePendingState.getPendingForExecution('exec_1');

			expect(first.behavior).toBe('deny');
			expect(second.behavior).toBe('deny');
			expect((second as { interrupt?: boolean }).interrupt).toBe(true);
			expect((second as { message?: string }).message).toContain('Pending human response');
			expect(pendingAfterFirst).toHaveLength(1);
			expect(pendingAfterSecond).toHaveLength(1);
			expect(pendingAfterSecond[0]?.requestId).toBe(pendingAfterFirst[0]?.requestId);
			expect(pendingAfterSecond[0]?.questionsBase64).toBe(pendingAfterFirst[0]?.questionsBase64);
		});

		it('refuses to register a tool approval after a pending question already exists', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				runtimePendingState,
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
				executionId: 'exec_1',
			});

			await cb(
				'AskUserQuestion',
				{
					questions: [
						{
							question: 'Need input?',
							header: 'Input',
							options: [{ label: 'Yes', description: '' }],
							multiSelect: false,
						},
					],
				},
				{ signal: createSignal() },
			);

			const pendingAfterQuestion = runtimePendingState.getPendingForExecution('exec_1');
			const approvalAttempt = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
			const pendingAfterApprovalAttempt = runtimePendingState.getPendingForExecution('exec_1');

			expect(approvalAttempt.behavior).toBe('deny');
			expect((approvalAttempt as { interrupt?: boolean }).interrupt).toBe(true);
			expect((approvalAttempt as { message?: string }).message).toContain('Pending human response');
			expect(pendingAfterQuestion).toHaveLength(1);
			expect(pendingAfterApprovalAttempt).toHaveLength(1);
			expect(pendingAfterApprovalAttempt[0]?.requestId).toBe(pendingAfterQuestion[0]?.requestId);
		});

		it('does NOT intercept AskUserQuestion when handleAskUserQuestion=false', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: false }),
				permissionsConfig: {},
				allowedTools: ['AskUserQuestion'],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = {
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [{ label: 'Red', description: '' }],
						multiSelect: false,
					},
				],
			};

			const result = await cb('AskUserQuestion', input, { signal: createSignal() });
			// Should allow because it's in allowedTools and handleAskUserQuestion is false
			expect(result.behavior).toBe('allow');
		});

		it('skips AskUserQuestion interception when input has no valid questions', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			// Empty questions array — invalid for AskUserQuestion
			const result = await cb('AskUserQuestion', { questions: [] }, { signal: createSignal() });

			// Falls through to normal approval flow (not intercepted as AskUserQuestion)
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);
			// It should be an approval_request, not a question
		});
	});

	// ─── Already approved tool bypass ───────────────────────────────────

	it('allows tool if fingerprint was previously approved', async () => {
		handler.markApproved('tool:Bash');

		const cb = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'test task',
		});

		const result = await cb('Bash', { command: 'echo test' }, { signal: createSignal() });

		expect(result.behavior).toBe('allow');
		expect((result as { updatedInput?: unknown }).updatedInput).toEqual({ command: 'echo test' });
	});

	// ─── Approval scope: notAllowed ─────────────────────────────────────

	describe('scope: notAllowed', () => {
		it('requires approval for tools NOT in allowedTools', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ scope: 'notAllowed' }),
				permissionsConfig: {},
				allowedTools: ['Read', 'Glob'],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);
		});

		it('allows tools that ARE in allowedTools without approval', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ scope: 'notAllowed' }),
				permissionsConfig: {},
				allowedTools: ['Read'],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Read', { file_path: '/tmp/test' }, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
		});
	});

	// ─── Approval scope: fileOps ────────────────────────────────────────

	describe('scope: fileOps', () => {
		it('requires approval for Write', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ scope: 'fileOps' }),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Write', { file_path: '/tmp/a', content: 'x' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain('Write');
		});

		it('requires approval for Edit', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ scope: 'fileOps' }),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Edit', { file_path: '/tmp/a' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
		});

		it('does NOT require approval for Bash under fileOps scope', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ scope: 'fileOps' }),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
		});
	});

	// ─── Approval scope: bash ───────────────────────────────────────────

	describe('scope: bash', () => {
		it('requires approval for Bash', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ scope: 'bash' }),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'rm -rf /' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message?: string }).message).toContain('Bash');
		});

		it('does NOT require approval for Write under bash scope', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({ scope: 'bash' }),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Write', { file_path: '/tmp/a', content: 'x' }, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
		});
	});

	// ─── Approval scope: specific ───────────────────────────────────────

	describe('scope: specific', () => {
		it('requires approval only for specified tools', async () => {
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({
					scope: 'specific',
					specificTools: ['WebFetch', 'WebSearch'],
				}),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const resultFetch = await cb('WebFetch', { url: 'http://x' }, { signal: createSignal() });
			expect(resultFetch.behavior).toBe('deny');
			expect((resultFetch as { message?: string }).message).toContain(HITL_MESSAGE_PREFIX);

			const freshCb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig({
					scope: 'specific',
					specificTools: ['WebFetch', 'WebSearch'],
				}),
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const resultBash = await freshCb('Bash', { command: 'ls' }, { signal: createSignal() });
			expect(resultBash.behavior).toBe('allow');
		});
	});

	// ─── Blocked tools take precedence over approval ────────────────────

	it('denies blocked tools WITHOUT HITL prefix (hard deny, not approval)', async () => {
		const cb = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: ['Bash'],
			sessionId: 'sess_1',
			originalTask: 'test task',
		});

		const result = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
		expect(result.behavior).toBe('deny');
		// Should be a hard deny, not HITL pause
		expect((result as { message?: string }).message).toContain('blocked');
		expect((result as { interrupt?: boolean }).interrupt).toBeUndefined();
	});

	// ─── Interaction is stored ──────────────────────────────────────────

	it('stores a pending approval interaction in runtime state', async () => {
		const runtimePendingState = createRuntimePendingState();
		const cb = createCanUseToolCallback({
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			runtimePendingState,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'build a website',
			executionId: 'exec_1',
		});

		await cb('Bash', { command: 'npm install' }, { signal: createSignal() });

		const interactions = runtimePendingState.getPendingForExecution('exec_1');
		expect(interactions.length).toBeGreaterThanOrEqual(1);

		const interaction = interactions[0];
		expect(interaction).toBeDefined();
		expect(interaction.kind).toBe('approval');
		expect(interaction.toolName).toBe('Bash');
		expect(interaction.fingerprint).toBe('tool:Bash');
		expect(interaction.executionId).toBe('exec_1');
	});

	it('sets notifiedImmediately on approval after immediateNotificationChannel sends', async () => {
		const runtimePendingState = createRuntimePendingState();
		const sendApproval = vi.fn().mockResolvedValue(undefined);
		const immediateNotificationChannel = {
			name: 'test-ndjson',
			sendApproval,
			sendQuestion: vi.fn().mockResolvedValue(undefined),
		};
		const cb = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig({ scope: 'bash' }),
			runtimePendingState,
			immediateNotificationChannel,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'task',
			executionId: 'exec_immediate_approval',
		});

		await cb('Bash', { command: 'ls' }, { signal: createSignal() });

		expect(sendApproval).toHaveBeenCalledTimes(1);
		const [interaction] = runtimePendingState.getPendingForExecution('exec_immediate_approval');
		expect(interaction?.notifiedImmediately).toBe(true);
	});

	it('sets notifiedImmediately on AskUserQuestion after immediateNotificationChannel sends', async () => {
		const runtimePendingState = createRuntimePendingState();
		const sendQuestion = vi.fn().mockResolvedValue(undefined);
		const immediateNotificationChannel = {
			name: 'test-ndjson',
			sendApproval: vi.fn().mockResolvedValue(undefined),
			sendQuestion,
		};
		const cb = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
			runtimePendingState,
			immediateNotificationChannel,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'task',
			executionId: 'exec_immediate_question',
		});

		const input = {
			questions: [
				{
					question: 'Pick one?',
					header: 'Pick',
					options: [{ label: 'A', description: '' }],
					multiSelect: false,
				},
			],
		};

		await cb('AskUserQuestion', input, { signal: createSignal() });

		expect(sendQuestion).toHaveBeenCalledTimes(1);
		const [interaction] = runtimePendingState.getPendingForExecution('exec_immediate_question');
		expect(interaction?.notifiedImmediately).toBe(true);
	});

	// ─── SharedExecutionState sessionId resolution ──────────────────────

	it('uses sharedState.sessionId over closure sessionId', async () => {
		const runtimePendingState = createRuntimePendingState();
		const sharedState: SharedExecutionState = {
			sessionId: 'live_session_42',
		};

		const cb = createCanUseToolCallback({
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			runtimePendingState,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'initial_session_1',
			originalTask: 'test',
			sharedState,
		});

		await cb('Bash', { command: 'ls' }, { signal: createSignal() });

		const interactions = runtimePendingState.getPendingForExecution();
		expect(interactions.length).toBeGreaterThanOrEqual(1);
		expect(interactions[0].sessionId).toBe('live_session_42');
	});

	// ─── resumeSessionAt tracking via sharedState ───────────────────────

	it('stores resumeSessionAt from sharedState.lastAssistantMessageUuidBeforeToolUse', async () => {
		const runtimePendingState = createRuntimePendingState();
		const sharedState: SharedExecutionState = {
			lastAssistantMessageUuidBeforeToolUse: 'msg_before_tool',
			lastAssistantMessageUuid: 'msg_latest',
		};

		const cb = createCanUseToolCallback({
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			runtimePendingState,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'test',
			sharedState,
		});

		await cb('Write', { file_path: '/tmp/test', content: 'hi' }, { signal: createSignal() });

		const interactions = runtimePendingState.getPendingForExecution();
		expect(interactions.length).toBeGreaterThanOrEqual(1);
		expect(interactions[0].resumeSessionAt).toBe('msg_before_tool');
	});

	it('falls back to lastAssistantMessageUuid when beforeToolUse is unavailable', async () => {
		const runtimePendingState = createRuntimePendingState();
		const sharedState: SharedExecutionState = {
			lastAssistantMessageUuid: 'msg_fallback',
		};

		const cb = createCanUseToolCallback({
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			runtimePendingState,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'test',
			sharedState,
		});

		await cb('Bash', { command: 'ls' }, { signal: createSignal() });

		const interactions = runtimePendingState.getPendingForExecution();
		expect(interactions.length).toBeGreaterThanOrEqual(1);
		expect(interactions[0].resumeSessionAt).toBe('msg_fallback');
	});

	it('stores resumeSessionAt on AskUserQuestion interactions for replayed question responses', async () => {
		const runtimePendingState = createRuntimePendingState();
		const sharedState: SharedExecutionState = {
			lastAssistantMessageUuidBeforeToolUse: 'msg_before_question',
			lastAssistantMessageUuid: 'msg_latest',
		};

		const cb = createCanUseToolCallback({
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig({ handleAskUserQuestion: true }),
			runtimePendingState,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'test',
			sharedState,
		});

		await cb('AskUserQuestion', {
			questions: [
				{
					question: 'Enter OTP',
					header: 'OTP',
					options: [
						{ label: '__free_text__', description: 'Enter a value' },
						{ label: '__free_text_alt__', description: 'Alternative input' },
					],
					multiSelect: false,
				},
			],
		}, { signal: createSignal() });

		const interactions = runtimePendingState.getPendingForExecution();
		expect(interactions.length).toBeGreaterThanOrEqual(1);
		expect(interactions[0].kind).toBe('question');
		expect(interactions[0].resumeSessionAt).toBe('msg_before_question');
	});

	// ─── HITL message format ────────────────────────────────────────────

	it('deny message starts with [HITL] prefix for approval requests', async () => {
		const cb = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig(),
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'test',
		});

		const result = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
		expect(result.behavior).toBe('deny');
		expect((result as { message: string }).message.startsWith(HITL_MESSAGE_PREFIX)).toBe(true);
	});

	// ─── Disabled approvals allow everything ────────────────────────────

	it('allows all tools when approvals are disabled', async () => {
		const cb = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: handler,
			approvalConfig: defaultApprovalConfig({ enabled: false }),
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'sess_1',
			originalTask: 'test',
		});

		const result = await cb('Bash', { command: 'rm -rf /' }, { signal: createSignal() });
		expect(result.behavior).toBe('allow');
	});

	// ─── Queued approval resolution (deny with feedback / modified input) ──

	describe('pendingApprovalResolution', () => {
		it('returns normal deny (no interrupt) with reviewer message on denied resolution', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_deny_1',
					approved: false,
					fingerprint: handler.computeFingerprint('Bash', { command: 'rm -rf /' }),
					toolName: 'Bash',
					reviewerMessage: 'Too dangerous, use a safer command.',
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'rm -rf /' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message: string }).message).toBe('Too dangerous, use a safer command.');
			// Must NOT have interrupt — Claude should see it as a tool_result error
			expect((result as { interrupt?: boolean }).interrupt).toBeUndefined();
		});

		it('returns default deny message when reviewerMessage is absent', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_deny_2',
					approved: false,
					toolName: 'Bash',
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message: string }).message).toContain('denied by the reviewer');
			expect((result as { interrupt?: boolean }).interrupt).toBeUndefined();
		});

		it('allows tool with updatedInput on approved resolution', async () => {
			const runtimePendingState = createRuntimePendingState();
			const fp = handler.computeFingerprint('Bash', { command: 'rm -rf /' });
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_allow_1',
					approved: true,
					fingerprint: fp,
					toolName: 'Bash',
					updatedInput: { command: 'ls -la' },
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'rm -rf /' }, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
			expect((result as { updatedInput: Record<string, unknown> }).updatedInput).toEqual({ command: 'ls -la' });
		});

		it('allows tool with original input when updatedInput is absent', async () => {
			const runtimePendingState = createRuntimePendingState();
			const fp = handler.computeFingerprint('Read', { file_path: '/etc/passwd' });
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_allow_2',
					approved: true,
					fingerprint: fp,
					toolName: 'Read',
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const input = { file_path: '/etc/passwd' };
			const result = await cb('Read', input, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
			expect((result as { updatedInput: Record<string, unknown> }).updatedInput).toEqual(input);
		});

		it('re-checks hard safety on updatedInput and denies if blocked', async () => {
			const runtimePendingState = createRuntimePendingState();
			const fp = handler.computeFingerprint('Bash', { command: 'echo hi' });
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_safety_1',
					approved: true,
					fingerprint: fp,
					toolName: 'Bash',
					updatedInput: { command: 'echo malicious' },
				},
				permissionsConfig: {
					contentFilter: {
						enabled: true,
						rules: [{
							id: 'block_malicious',
							pattern: 'malicious',
							tools: ['Bash'],
							targetField: 'command',
							description: 'blocked word',
						}],
					},
				},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'echo hi' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message: string }).message).toContain('blocked');
		});

		it('is consumed once — second tool call follows normal flow', async () => {
			const runtimePendingState = createRuntimePendingState();
			const fp = handler.computeFingerprint('Bash', { command: 'ls' });
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_once_1',
					approved: true,
					fingerprint: fp,
					toolName: 'Bash',
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			// First call: consumed by resolution (marks fingerprint as approved)
			const first = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
			expect(first.behavior).toBe('allow');

			// Second call with a DIFFERENT tool: resolution was consumed, normal HITL flow
			const second = await cb('Write', { file_path: '/tmp/x', content: 'test' }, { signal: createSignal() });
			expect(second.behavior).toBe('deny');
			expect(runtimePendingState.getPendingForExecution()).toHaveLength(1);
		});

		it('matches by toolName when fingerprint differs', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_name_1',
					approved: false,
					fingerprint: 'stale_fingerprint',
					toolName: 'Bash',
					reviewerMessage: 'Not now',
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			const result = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
			expect(result.behavior).toBe('deny');
			expect((result as { message: string }).message).toBe('Not now');
			expect((result as { interrupt?: boolean }).interrupt).toBeUndefined();
		});

		it('deterministically allows a direct MCP tool replay by fingerprint', async () => {
			const runtimePendingState = createRuntimePendingState();
			const input = {
				request_id: 'DSAR-1001',
				requester_type: 'data_subject',
				identity_verification_status: 'verified',
			};
			const toolName = 'mcp__n8n_tools__n8n_tool__export_subject_bundle';
			const fp = handler.computeFingerprint(toolName, input);
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_mcp_1',
					approved: true,
					fingerprint: fp,
					toolName,
				},
				permissionsConfig: {},
				allowedTools: [],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'Export the full DSAR bundle for request DSAR-1001.',
			});

			const result = await cb(toolName, input, { signal: createSignal() });
			expect(result.behavior).toBe('allow');
			expect((result as { updatedInput: Record<string, unknown> }).updatedInput).toEqual(input);
		});

		it('does not consume resolution for a different tool', async () => {
			const runtimePendingState = createRuntimePendingState();
			const cb = createCanUseToolCallback({
				execFunctions: exec,
				approvalHandler: handler,
				approvalConfig: defaultApprovalConfig(),
				runtimePendingState,
				pendingApprovalResolution: {
					kind: 'approval',
					requestId: 'req_mismatch_1',
					approved: true,
					toolName: 'Bash',
				},
				permissionsConfig: {},
				allowedTools: ['Read'],
				blockedTools: [],
				sessionId: 'sess_1',
				originalTask: 'test task',
			});

			// Read is allowed by default, resolution should NOT be consumed
			const readResult = await cb('Read', { file_path: '/tmp/x' }, { signal: createSignal() });
			expect(readResult.behavior).toBe('allow');

			// Now Bash: resolution should still be available
			const bashResult = await cb('Bash', { command: 'ls' }, { signal: createSignal() });
			expect(bashResult.behavior).toBe('allow');
		});
	});

});
