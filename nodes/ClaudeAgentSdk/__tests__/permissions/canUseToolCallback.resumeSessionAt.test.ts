import { describe, expect, it, vi } from 'vitest';

import type { ApprovalHandler } from '../../permissions/ApprovalHandler';
import { createCanUseToolCallback } from '../../permissions/canUseToolCallback';
import { createRuntimePendingState } from '../../operations/executeTask/hitlRuntimeState';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

function createApprovalHandlerMock(): ApprovalHandler {
	return {
		isToolCallApproved: vi.fn().mockReturnValue(false),
		computeFingerprint: vi.fn().mockReturnValue('tool:Bash'),
		generateRequestId: vi.fn().mockReturnValue('approval_req_1'),
		serializeApprovedFingerprints: vi.fn().mockReturnValue(''),
	} as unknown as ApprovalHandler;
}

describe('createCanUseToolCallback - resumeSessionAt tracking', () => {
	it('stores lastAssistantMessageUuidBeforeToolUse as resumeSessionAt for pending approvals', async () => {
		const exec = createMockExecuteFunctions();
		const runtimePendingState = createRuntimePendingState();

		const callback = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: createApprovalHandlerMock(),
			approvalConfig: {
				enabled: true,
				scope: 'specific',
				specificTools: ['Bash'],
				approvalMatchMode: 'tool',
				timeoutSeconds: 60,
				defaultOnTimeout: 'deny',
				handleAskUserQuestion: true,
		allowPermissionModeOverride: false,
				allowedOverrideModes: [],
			},
			runtimePendingState,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'session_1',
			originalTask: 'Task',
			sharedState: {
				lastAssistantMessageUuidBeforeToolUse: 'assistant_before_uuid',
			},
		});

		const result = await callback('Bash', { command: 'ls -la' }, { signal: new AbortController().signal });

		expect(result.behavior).toBe('deny');
		const interactions = runtimePendingState.getPendingForExecution();
		expect(interactions).toHaveLength(1);
		expect(interactions[0].resumeSessionAt).toBe('assistant_before_uuid');
	});

	it('falls back to lastAssistantMessageUuid when before-tool UUID is unavailable', async () => {
		const exec = createMockExecuteFunctions();
		const runtimePendingState = createRuntimePendingState();

		const callback = createCanUseToolCallback({
			execFunctions: exec,
			approvalHandler: createApprovalHandlerMock(),
			approvalConfig: {
				enabled: true,
				scope: 'specific',
				specificTools: ['Bash'],
				approvalMatchMode: 'tool',
				timeoutSeconds: 60,
				defaultOnTimeout: 'deny',
				handleAskUserQuestion: true,
		allowPermissionModeOverride: false,
				allowedOverrideModes: [],
			},
			runtimePendingState,
			permissionsConfig: {},
			allowedTools: [],
			blockedTools: [],
			sessionId: 'session_1',
			originalTask: 'Task',
			sharedState: {
				lastAssistantMessageUuid: 'assistant_last_uuid',
			},
		});

		await callback('Bash', { command: 'pwd' }, { signal: new AbortController().signal });

		const interactions = runtimePendingState.getPendingForExecution();
		expect(interactions).toHaveLength(1);
		expect(interactions[0].resumeSessionAt).toBe('assistant_last_uuid');
	});
});
