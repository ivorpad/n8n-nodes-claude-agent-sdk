import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { execute } from '../node/execute';
import { getPending } from '../store/PendingSlackHitlStore';

function createExecuteContext(
	inputJson: Record<string, unknown> | Array<Record<string, unknown>>,
	paramOverrides: Record<string, unknown> = {},
) {
	const staticData: Record<string, unknown> = {};
	const inputJsonItems = Array.isArray(inputJson) ? inputJson : [inputJson];
	const params: Record<string, unknown> = {
		channelId: 'C12345678',
		messagePrefix: 'HITL',
		messageTitle: 'Claude HITL',
		outboundMessageMode: 'asIs',
		maxOutboundCharacters: 400,
		fallbackMessage: '',
		limitWaitTime: true,
		resumeAmount: 45,
		resumeUnit: 'minutes',
		...paramOverrides,
	};

	const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ ok: true });
	const putExecutionToWait = vi.fn().mockResolvedValue(undefined);
	const setSignatureValidationRequired = vi.fn();
	const getSignedResumeUrl = vi.fn((query?: Record<string, string>) => {
		const qs = new URLSearchParams(query ?? {}).toString();
		return `https://localhost:5678/webhook-waiting/test${qs ? `?${qs}` : ''}`;
	});

	const context: Partial<IExecuteFunctions> = {
		getInputData: vi.fn(() => inputJsonItems.map((json) => ({ json: { version: '1.0', ...json } }))),
		getNodeParameter: vi.fn((name: string) => params[name]),
		continueOnFail: vi.fn(() => false),
		getSignedResumeUrl,
		setSignatureValidationRequired,
		putExecutionToWait,
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(() => ({ name: 'Claude Agent Slack' }) as INode),
		helpers: {
			httpRequestWithAuthentication,
		} as IExecuteFunctions['helpers'],
	};

	return {
		context: context as IExecuteFunctions,
		httpRequestWithAuthentication,
		putExecutionToWait,
		getSignedResumeUrl,
	};
}

describe('ClaudeAgentSlack execute', () => {
	it('silently skips task_result items so the node can sit downstream of the SDK Result output', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait } = createExecuteContext({
			type: 'task_result',
			task: 'noop',
			summary: 'done',
		});

		const result = await execute.call(context);
		expect(result).toEqual([
			[{ json: { type: 'task_result', task: 'noop', summary: 'done', version: '1.0' } }],
		]);
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		expect(putExecutionToWait).not.toHaveBeenCalled();
	});

	it('rejects HITL request when contract version is missing', async () => {
		const { context } = createExecuteContext({
			version: undefined,
			type: 'approval_request',
			requestId: 'req_missing_version_1',
			sessionId: 'session_missing_version_1',
			message: 'Approve this action',
			toolName: 'Write',
		});

		await expect(execute.call(context)).rejects.toThrow(/version must be 1.0/i);
	});

	it('sends approval request and waits', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait, getSignedResumeUrl } =
			createExecuteContext({
				type: 'approval_request',
				requestId: 'req_slack_approval_1',
				sessionId: 'session_slack_1',
				message: 'Approve this action',
				toolName: 'Write',
				toolInput: { file_path: '/tmp/demo.txt' },
				approvedFingerprints: 'afps',
				fingerprint: 'tool:Write',
			});

		await execute.call(context);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0];
		expect(requestOptions.url).toBe('https://slack.com/api/chat.postMessage');
		expect(requestOptions.body.channel).toBe('C12345678');
		const blocks = requestOptions.body.blocks as Array<Record<string, unknown>>;
		expect(blocks[1]?.type).toBe('actions');
		const elements = (blocks[1]?.elements ?? []) as Array<Record<string, unknown>>;
		expect(elements[0]?.action_id).toBe('hitl_approve');
		expect(elements[0]?.value).toContain('hitl|approve|req_slack_approval_1');
		expect(elements[1]?.action_id).toBe('hitl_deny');
		expect(elements[1]?.value).toContain('hitl|deny|req_slack_approval_1');
		expect(getSignedResumeUrl).toHaveBeenCalledWith({
			requestId: 'req_slack_approval_1',
			approved: 'true',
			sid: 'session_slack_1',
			afps: 'afps',
			fp: 'tool:Write',
		});
		expect(getSignedResumeUrl).toHaveBeenCalledWith({
			requestId: 'req_slack_approval_1',
			approved: 'false',
			sid: 'session_slack_1',
			afps: 'afps',
			fp: 'tool:Write',
		});
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_slack_approval_1')).toBeDefined();
	});

	it('puts execution to wait before signing or sending wait-mode approval URLs', async () => {
		const callOrder: string[] = [];
		const { context, httpRequestWithAuthentication, putExecutionToWait, getSignedResumeUrl } =
			createExecuteContext({
				type: 'approval_request',
				requestId: 'req_slack_order_1',
				sessionId: 'session_slack_order_1',
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
		httpRequestWithAuthentication.mockImplementation(async () => {
			callOrder.push('send');
			return { ok: true };
		});

		await execute.call(context);

		expect(callOrder[0]).toBe('wait');
		expect(callOrder).toContain('sign');
		expect(callOrder.at(-1)).toBe('send');
	});

	it('continues after a failed item when continueOnFail is enabled', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext([
			{
				version: undefined,
				type: 'approval_request',
				requestId: 'req_slack_bad_1',
				sessionId: 'session_slack_bad_1',
				message: 'Approve this action',
				toolName: 'Write',
			},
			{
				type: 'approval_request',
				requestId: 'req_slack_good_1',
				sessionId: 'session_slack_good_1',
				message: 'Approve this action',
				toolName: 'Read',
			},
		]);
		vi.mocked(context.continueOnFail).mockReturnValue(true);

		const result = await execute.call(context);

		expect(result[0]).toHaveLength(2);
		expect(result[0]?.[0]?.json.error).toMatch(/version must be 1.0/i);
		expect(result[0]?.[0]?.pairedItem).toEqual({ item: 0 });
		expect(result[0]?.[1]?.json.requestId).toBe('req_slack_good_1');
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('sends question request and waits', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait, getSignedResumeUrl } =
			createExecuteContext({
				type: 'question_request',
				requestId: 'req_slack_question_1',
				sessionId: 'session_slack_2',
				message: 'Please answer',
				questions: [
					{
						question: 'Format?',
						header: 'Format',
						options: [{ label: 'Summary', description: 'Short' }],
						multiSelect: false,
					},
				],
			});

		await execute.call(context);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0];
		const blocks = requestOptions.body.blocks as Array<Record<string, unknown>>;
		expect(blocks[1]?.type).toBe('actions');
		const elements = (blocks[1]?.elements ?? []) as Array<Record<string, unknown>>;
		expect(elements[0]?.action_id).toBe('hitl_q_0_0');
		expect(elements[0]?.value).toBe('hitl|q|req_slack_question_1|0|0');
		const expectedQuestions = Buffer.from(
			JSON.stringify([
				{
					question: 'Format?',
					header: 'Format',
					options: [{ label: 'Summary', description: 'Short' }],
					multiSelect: false,
				},
			]),
		).toString('base64');
		expect(getSignedResumeUrl).toHaveBeenCalledWith({
			requestId: 'req_slack_question_1',
			type: 'question',
			sid: 'session_slack_2',
			q: expectedQuestions,
		});
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_slack_question_1')).toBeDefined();
	});
});
