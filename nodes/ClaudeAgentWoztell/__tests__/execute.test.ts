import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { execute } from '../node/execute';
import { getPending } from '../store/PendingWoztellHitlStore';

function createExecuteContext(
	inputJson: Record<string, unknown> | Array<Record<string, unknown>>,
	paramOverrides: Record<string, unknown> = {},
) {
	const staticData: Record<string, unknown> = {};
	const inputJsonItems = Array.isArray(inputJson) ? inputJson : [inputJson];
	const params: Record<string, unknown> = {
		resource: 'hitl',
		channelId: 'woztell-channel',
		recipientPhoneNumber: '+34 696 169 382',
		deliveryMode: 'textLinks',
		pendingStoreBackend: 'staticData',
		pendingStoreTableName: 'claude_hitl_pending',
		messagePrefix: 'HITL',
		messageTitle: 'Claude HITL',
		outboundMessageMode: 'asIs',
		maxOutboundCharacters: 240,
		fallbackMessage: '',
		templateName: '',
		templateLanguageCode: 'en_US',
		replyHandlingMode: 'waitForReply',
		enableCompanionMessage: false,
		companionMessageType: 'text',
		companionPayload: {},
		companionFailureBehavior: 'continue',
		limitWaitTime: true,
		resumeAmount: 45,
		resumeUnit: 'minutes',
		...paramOverrides,
	};

	const httpRequest = vi.fn().mockResolvedValue({
		ok: 1,
		result: [{ result: { messages: [{ id: 'woztell_message_id' }] } }],
	});
	const putExecutionToWait = vi.fn().mockResolvedValue(undefined);
	const setSignatureValidationRequired = vi.fn();
	const getSignedResumeUrl = vi.fn((query?: Record<string, string>) => {
		const qs = new URLSearchParams(query ?? {}).toString();
		return `https://localhost:5678/webhook-waiting/test${qs ? `?${qs}` : ''}`;
	});

	const context: Partial<IExecuteFunctions> = {
		getInputData: vi.fn(() => inputJsonItems.map((json) => ({ json: { version: '1.0', ...json } }))),
		getNodeParameter: vi.fn((name: string, _index: number, defaultValue?: unknown) =>
			params[name] === undefined ? defaultValue : params[name]),
		continueOnFail: vi.fn(() => false),
		getCredentials: vi.fn(async () => ({
			accessToken: 'woztell_token',
		})),
		getSignedResumeUrl,
		getInstanceBaseUrl: vi.fn(() => 'https://example.ngrok-free.app'),
		setSignatureValidationRequired,
		putExecutionToWait,
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(
			() =>
				({
					name: 'Claude Agent Woztell',
					webhookId: 'woztell-hitl-node-webhook-id',
				}) as INode,
		),
		helpers: {
			httpRequest,
		} as IExecuteFunctions['helpers'],
	};

	return {
		context: context as IExecuteFunctions,
		httpRequest,
		putExecutionToWait,
		getSignedResumeUrl,
	};
}

describe('ClaudeAgentWoztell execute', () => {
	it('puts execution to wait before signing or sending wait-mode approval URLs', async () => {
		const callOrder: string[] = [];
		const { context, httpRequest, putExecutionToWait, getSignedResumeUrl } = createExecuteContext({
			type: 'approval_request',
			requestId: 'req_woztell_order_1',
			sessionId: 'session_woztell_order_1',
			message: 'Approve this action',
			toolName: 'Write',
			approvedFingerprints: 'afps',
			fingerprint: 'tool:Write',
		});
		putExecutionToWait.mockImplementation(async () => {
			callOrder.push('wait');
		});
		getSignedResumeUrl.mockImplementation((query?: Record<string, string>) => {
			callOrder.push('sign');
			const qs = new URLSearchParams(query ?? {}).toString();
			return `https://localhost:5678/webhook-waiting/test${qs ? `?${qs}` : ''}`;
		});
		httpRequest.mockImplementation(async () => {
			callOrder.push('send');
			return { ok: 1, result: [{ result: { messages: [{ id: 'woztell_message_id' }] } }] };
		});

		await execute.call(context);

		expect(callOrder[0]).toBe('wait');
		expect(callOrder).toContain('sign');
		expect(callOrder.at(-1)).toBe('send');
		expect(await getPending(context, 'req_woztell_order_1', { backend: 'staticData' })).toBeDefined();
	});

	it('continues after a failed HITL item when continueOnFail is enabled', async () => {
		const { context, httpRequest } = createExecuteContext([
			{
				version: undefined,
				type: 'approval_request',
				requestId: 'req_woztell_bad_1',
				sessionId: 'session_woztell_bad_1',
				message: 'Approve this action',
				toolName: 'Write',
			},
			{
				type: 'approval_request',
				requestId: 'req_woztell_good_1',
				sessionId: 'session_woztell_good_1',
				message: 'Approve this action',
				toolName: 'Read',
			},
		]);
		vi.mocked(context.continueOnFail).mockReturnValue(true);

		const result = await execute.call(context);

		expect(result[0]).toHaveLength(2);
		expect(result[0]?.[0]?.json.error).toMatch(/version must be 1.0/i);
		expect(result[0]?.[0]?.pairedItem).toEqual({ item: 0 });
		expect(result[0]?.[1]?.json.requestId).toBe('req_woztell_good_1');
		expect(httpRequest).toHaveBeenCalledTimes(1);
	});
});
