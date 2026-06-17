import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { execute } from '../node/execute';
import { getPending } from '../store/PendingGmailHitlStore';

function createExecuteContext(
	inputJson: Record<string, unknown>,
	paramOverrides: Record<string, unknown> = {},
) {
	const staticData: Record<string, unknown> = {};
	const params: Record<string, unknown> = {
		toEmail: 'to@example.com',
		fromEmail: 'from@example.com',
		subjectPrefix: 'Claude HITL',
		messagePrefix: 'HITL',
		outboundMessageMode: 'asIs',
		maxOutboundCharacters: 400,
		fallbackMessage: '',
		limitWaitTime: true,
		resumeAmount: 45,
		resumeUnit: 'minutes',
		...paramOverrides,
	};

	const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ id: 'gmail_message_id' });
	const putExecutionToWait = vi.fn().mockResolvedValue(undefined);
	const setSignatureValidationRequired = vi.fn();
	const getSignedResumeUrl = vi.fn((query?: Record<string, string>) => {
		const qs = new URLSearchParams(query ?? {}).toString();
		return `https://localhost:5678/webhook-waiting/test${qs ? `?${qs}` : ''}`;
	});

	const context: Partial<IExecuteFunctions> = {
		getInputData: vi.fn(() => [{ json: { version: '1.0', ...inputJson } }]),
		getNodeParameter: vi.fn((name: string) => params[name]),
		getSignedResumeUrl,
		setSignatureValidationRequired,
		putExecutionToWait,
		continueOnFail: vi.fn(() => false),
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(() => ({ name: 'Claude Agent Gmail' } as INode)),
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

describe('ClaudeAgentGmail execute', () => {
	it('silently skips task_result items so the node can sit downstream of the SDK Result output', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait } = createExecuteContext({
			type: 'task_result',
			task: 'noop',
			summary: 'done',
		});

		const result = await execute.call(context);
		expect(result).toEqual([[{ json: { type: 'task_result', task: 'noop', summary: 'done', version: '1.0' } }]]);
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
				requestId: 'req_gmail_approval_1',
				sessionId: 'session_gmail_1',
				message: 'Approve this action',
				toolName: 'Write',
				toolInput: { file_path: '/tmp/demo.txt' },
				approvedFingerprints: 'afps',
				fingerprint: 'tool:Write',
			});

		await execute.call(context);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0];
		expect(requestOptions.method).toBe('POST');
		expect(requestOptions.url).toBe('https://www.googleapis.com/gmail/v1/users/me/messages/send');
		expect(requestOptions.body.raw).toBeTypeOf('string');
		expect(getSignedResumeUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: 'req_gmail_approval_1',
				approved: 'true',
				sid: 'session_gmail_1',
				afps: 'afps',
				fp: 'tool:Write',
			}),
		);
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_gmail_approval_1')).toBeDefined();
	});

	it('sends question request and waits', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait } = createExecuteContext({
			type: 'question_request',
			requestId: 'req_gmail_question_1',
			sessionId: 'session_gmail_2',
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
		expect(requestOptions.method).toBe('POST');
		expect(requestOptions.body.raw).toBeTypeOf('string');
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_gmail_question_1')).toBeDefined();
	});
});
