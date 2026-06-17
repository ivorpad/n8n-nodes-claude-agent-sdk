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

});
