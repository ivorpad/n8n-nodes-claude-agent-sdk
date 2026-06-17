/**
 * canUseToolCallback Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { ApprovalHandler } from '../../permissions/ApprovalHandler';
import { createCanUseToolCallback } from '../../permissions/canUseToolCallback';
import { ENV_FILE_PROTECTION_RULES } from '../../permissions/ContentFilter';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

function createApprovalHandlerMock(): ApprovalHandler {
	return {
		isToolCallApproved: vi.fn().mockReturnValue(false),
		computeFingerprint: vi.fn().mockReturnValue('fingerprint'),
		generateRequestId: vi.fn().mockReturnValue('request-id'),
		serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
	} as unknown as ApprovalHandler;
}

describe('createCanUseToolCallback', () => {
	it('should honor tool permission conditions (not just tool name matching)', async () => {
		const exec = createMockExecuteFunctions();
		const callback = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: createApprovalHandlerMock(),
			approvalConfig: {
				enabled: false,
				scope: 'notAllowed',
				specificTools: [],
				approvalMatchMode: 'tool',
				timeoutSeconds: 60,
				handleAskUserQuestion: false,
		allowPermissionModeOverride: false,
				allowedOverrideModes: [],
			},
			permissionsConfig: {
				toolPermissions: {
					enabled: true,
					defaultDecision: 'allow',
					askFallback: 'deny',
					rules: [
						{
							toolPattern: 'Read',
							decision: 'deny',
							condition: "input.file_path.startsWith('/etc')",
						},
					],
				},
			},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'session_1',
			originalTask: 'Task',
			executionId: 'exec_1',
		});

		const allowed = await callback(
			'Read',
			{ file_path: '/project/src/main.ts' },
			{ signal: new AbortController().signal },
		);
		expect(allowed.behavior).toBe('allow');
		expect(allowed.updatedInput).toEqual({ file_path: '/project/src/main.ts' });

		const denied = await callback(
			'Read',
			{ file_path: '/etc/passwd' },
			{ signal: new AbortController().signal },
		);
		expect(denied.behavior).toBe('deny');
		expect(denied.message).toContain('Matched rule for pattern: Read');
	});

	it('should deny tool calls blocked by path sandbox checks', async () => {
		const exec = createMockExecuteFunctions();
		const callback = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: createApprovalHandlerMock(),
			approvalConfig: {
				enabled: false,
				scope: 'notAllowed',
				specificTools: [],
				approvalMatchMode: 'tool',
				timeoutSeconds: 60,
				handleAskUserQuestion: false,
		allowPermissionModeOverride: false,
				allowedOverrideModes: [],
			},
			permissionsConfig: {
				pathSandbox: {
					enabled: true,
					basePath: '/project',
					affectedTools: ['Glob'],
				},
			},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'session_1',
			originalTask: 'Task',
			executionId: 'exec_1',
		});

		const result = await callback(
			'Glob',
			{ path: '/project', pattern: '../**/*.ts' },
			{ signal: new AbortController().signal },
		);

		expect(result.behavior).toBe('deny');
		expect(result.message).toContain('outside the allowed sandbox');
	});

	it('should deny tool calls that match blocked wildcard patterns', async () => {
		const exec = createMockExecuteFunctions();
		const callback = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: createApprovalHandlerMock(),
			approvalConfig: {
				enabled: false,
				scope: 'notAllowed',
				specificTools: [],
				approvalMatchMode: 'tool',
				timeoutSeconds: 60,
				handleAskUserQuestion: false,
		allowPermissionModeOverride: false,
				allowedOverrideModes: [],
			},
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: ['mcp__danger__*'],
			sessionId: 'session_1',
			originalTask: 'Task',
			executionId: 'exec_1',
		});

		const result = await callback(
			'mcp__danger__drop_table',
			{},
			{ signal: new AbortController().signal },
		);

		expect(result.behavior).toBe('deny');
		expect(result.message).toContain('mcp__danger__*');
	});

	it('should deny tool calls blocked by content filter rules', async () => {
		const exec = createMockExecuteFunctions();
		const callback = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: createApprovalHandlerMock(),
			approvalConfig: {
				enabled: false,
				scope: 'notAllowed',
				specificTools: [],
				approvalMatchMode: 'tool',
				timeoutSeconds: 60,
				handleAskUserQuestion: false,
				allowPermissionModeOverride: false,
				allowedOverrideModes: [],
			},
			permissionsConfig: {
				contentFilter: {
					enabled: true,
					rules: ENV_FILE_PROTECTION_RULES,
				},
			},
			allowedTools: ['Read', 'Bash'],
			blockedTools: [],
			sessionId: 'session_1',
			originalTask: 'Task',
			executionId: 'exec_1',
		});

		const readResult = await callback(
			'Read',
			{ file_path: '/project/.env' },
			{ signal: new AbortController().signal },
		);
		expect(readResult.behavior).toBe('deny');
		expect(readResult.message).toContain('.env');

		const bashResult = await callback(
			'Bash',
			{ command: 'printenv GEMINI_API_KEY' },
			{ signal: new AbortController().signal },
		);
		expect(bashResult.behavior).toBe('deny');
		expect(bashResult.message).toContain('env');
	});

	// AGT enforcement is wired as a PreToolUse hook, not via canUseTool.
	// See __tests__/permissions/AgtPreToolUseHook.test.ts for hook-level
	// behavioural tests, and __tests__/permissions/AgtGovernance.test.ts
	// for the underlying evaluator tests.
	describe.skip('AGT governance (moved to PreToolUse hook tests)', () => {
		const baseApprovalConfig = {
			enabled: false,
			scope: 'notAllowed' as const,
			specificTools: [],
			approvalMatchMode: 'tool' as const,
			timeoutSeconds: 60,
			handleAskUserQuestion: false,
			allowPermissionModeOverride: false,
			allowedOverrideModes: [],
		};

		it('should deny a tool matched by AGT deny rule with numeric condition', async () => {
			const exec = createMockExecuteFunctions();
			const callback = createCanUseToolCallback({
				execFunctions: exec,
				approvalConfig: baseApprovalConfig,
				permissionsConfig: {
					agtGovernance: {
						enabled: true,
						defaultAction: 'allow',
						conflictStrategy: 'priorityFirstMatch',
						rules: [{
							name: 'block-large',
							tools: ['process_refund'],
							decision: 'deny',
							priority: 200,
							conditions: {
								conditions: [{
									leftValue: 'amount',
									rightValue: { value: '500' },
									operator: { operation: 'gte' },
								}],
								combinator: 'and',
							},
						}],
					},
				},
				allowedTools: ['process_refund'],
				blockedTools: [],
				sessionId: 'session_1',
				originalTask: 'Task',
				executionId: 'exec_cond_1',
				workflowId: 'wf-1',
				nodeName: 'TestNode',
			});

			// amount=750 should be denied (>= 500)
			const denied = await callback(
				'process_refund',
				{ amount: 750, order_id: 'ORD-1' },
				{ signal: new AbortController().signal },
			);
			expect(denied.behavior).toBe('deny');

			// amount=25 should be allowed (< 500)
			const allowed = await callback(
				'process_refund',
				{ amount: 25, order_id: 'ORD-2' },
				{ signal: new AbortController().signal },
			);
			expect(allowed.behavior).toBe('allow');
		});

		it('should deny a tool when an AGT rule denies it (no HITL)', async () => {
			const exec = createMockExecuteFunctions();
			const callback = createCanUseToolCallback({
				execFunctions: exec,
				approvalConfig: baseApprovalConfig,
				permissionsConfig: {
					agtGovernance: {
						enabled: true,
						defaultAction: 'allow',
						conflictStrategy: 'priorityFirstMatch',
						rules: [{
							name: 'block-bash',
							tools: ['Bash'],
							decision: 'deny',
							priority: 100,
						}],
					},
				},
				allowedTools: ['Bash'],
				blockedTools: [],
				sessionId: 'session_1',
				originalTask: 'Task',
				executionId: 'exec_1',
				workflowId: 'wf-1',
				nodeName: 'TestNode',
			});

			const result = await callback(
				'Bash',
				{ command: 'ls' },
				{ signal: new AbortController().signal },
			);
			expect(result.behavior).toBe('deny');
		});

		it('should fail closed when AGT rule requires approval but HITL is off', async () => {
			const exec = createMockExecuteFunctions();
			const callback = createCanUseToolCallback({
				execFunctions: exec,
				// No approvalHandler — HITL is off.
				approvalConfig: baseApprovalConfig,
				permissionsConfig: {
					agtGovernance: {
						enabled: true,
						defaultAction: 'allow',
						conflictStrategy: 'priorityFirstMatch',
						rules: [{
							name: 'supervised-write',
							tools: ['Write'],
							decision: 'require_approval',
							priority: 100,
							approvers: ['ops@co.com'],
						}],
					},
				},
				allowedTools: ['Write'],
				blockedTools: [],
				sessionId: 'session_1',
				originalTask: 'Task',
				executionId: 'exec_1',
				workflowId: 'wf-1',
				nodeName: 'TestNode',
			});

			const result = await callback(
				'Write',
				{ file_path: '/project/out.txt', content: 'x' },
				{ signal: new AbortController().signal },
			);
			expect(result.behavior).toBe('deny');
			if (result.behavior === 'deny') {
				expect(result.message).toContain('HITL');
				expect(result.message).toContain('ops@co.com');
			}
		});

		it('should allow tools that AGT rules allow', async () => {
			const exec = createMockExecuteFunctions();
			const callback = createCanUseToolCallback({
				execFunctions: exec,
				approvalConfig: baseApprovalConfig,
				permissionsConfig: {
					agtGovernance: {
						enabled: true,
						defaultAction: 'deny',
						conflictStrategy: 'priorityFirstMatch',
						rules: [{
							name: 'allow-reads',
							tools: ['Read'],
							decision: 'allow',
							priority: 100,
						}],
					},
				},
				allowedTools: ['Read'],
				blockedTools: [],
				sessionId: 'session_1',
				originalTask: 'Task',
				executionId: 'exec_1',
				workflowId: 'wf-1',
				nodeName: 'TestNode',
			});

			const result = await callback(
				'Read',
				{ file_path: '/project/x.ts' },
				{ signal: new AbortController().signal },
			);
			expect(result.behavior).toBe('allow');
		});

		it('should accumulate rate-limit state across calls (proves evaluator reuse)', async () => {
			const exec = createMockExecuteFunctions();
			const callback = createCanUseToolCallback({
				execFunctions: exec,
				approvalConfig: baseApprovalConfig,
				permissionsConfig: {
					agtGovernance: {
						enabled: true,
						defaultAction: 'deny',
						conflictStrategy: 'priorityFirstMatch',
						rules: [{
							name: 'limited-read',
							tools: ['Read'],
							decision: 'allow',
							priority: 100,
							limit: '2/minute',
						}],
					},
				},
				allowedTools: ['Read'],
				blockedTools: [],
				sessionId: 'session_1',
				originalTask: 'Task',
				executionId: 'exec_1',
				workflowId: 'wf-1',
				nodeName: 'TestNode',
			});

			const opts = { signal: new AbortController().signal };
			const first = await callback('Read', { file_path: '/a' }, opts);
			const second = await callback('Read', { file_path: '/b' }, opts);
			const third = await callback('Read', { file_path: '/c' }, opts);

			expect(first.behavior).toBe('allow');
			expect(second.behavior).toBe('allow');
			// The third call hits the 2/minute cap and AGT returns deny.
			expect(third.behavior).toBe('deny');
		});

		it('should enforce AGT deny even on tools in the legacy allowed list', async () => {
			const exec = createMockExecuteFunctions();
			const callback = createCanUseToolCallback({
				execFunctions: exec,
				approvalConfig: baseApprovalConfig,
				permissionsConfig: {
					agtGovernance: {
						enabled: true,
						defaultAction: 'allow',
						conflictStrategy: 'priorityFirstMatch',
						rules: [{
							name: 'deny-bash',
							tools: ['Bash'],
							decision: 'deny',
							priority: 100,
						}],
					},
				},
				// Bash is on the legacy allow list but AGT must still win.
				allowedTools: ['Bash'],
				blockedTools: [],
				sessionId: 'session_1',
				originalTask: 'Task',
				executionId: 'exec_1',
				workflowId: 'wf-1',
				nodeName: 'TestNode',
			});

			const result = await callback(
				'Bash',
				{ command: 'echo hi' },
				{ signal: new AbortController().signal },
			);
			expect(result.behavior).toBe('deny');
		});
	});
});
