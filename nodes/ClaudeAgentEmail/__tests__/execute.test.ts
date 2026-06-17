import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { execute } from '../node/execute';
import { getPending } from '../store/PendingEmailHitlStore';

const sendMailMock = vi.fn().mockResolvedValue(undefined);
const closeMock = vi.fn();
const createTransportMock = vi.fn(() => ({
	sendMail: sendMailMock,
	close: closeMock,
}));

vi.mock(
	'nodemailer',
	() => ({
		createTransport: createTransportMock,
	}),
	{ virtual: true },
);

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
		getNode: vi.fn(() => ({ name: 'Claude Agent Email' } as INode)),
		getCredentials: vi.fn(() => ({
			host: 'smtp.example.com',
			port: 587,
			secure: false,
			user: 'smtp-user',
			password: 'smtp-pass',
		})),
	};

	return {
		context: context as IExecuteFunctions,
		putExecutionToWait,
		getSignedResumeUrl,
	};
}

describe('ClaudeAgentEmail execute', () => {
	it('silently skips task_result items so the node can sit downstream of the SDK Result output', async () => {
		sendMailMock.mockClear();
		closeMock.mockClear();
		const { context, putExecutionToWait } = createExecuteContext({
			type: 'task_result',
			task: 'noop',
			summary: 'done',
		});

		const result = await execute.call(context);
		expect(result).toEqual([[{ json: { type: 'task_result', task: 'noop', summary: 'done', version: '1.0' } }]]);
		expect(sendMailMock).not.toHaveBeenCalled();
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
		sendMailMock.mockClear();
		const { context, putExecutionToWait, getSignedResumeUrl } = createExecuteContext({
			type: 'approval_request',
			requestId: 'req_email_approval_1',
			sessionId: 'session_email_1',
			message: 'Approve this action',
			toolName: 'Write',
			toolInput: { file_path: '/tmp/demo.txt' },
			approvedFingerprints: 'afps',
			fingerprint: 'tool:Write',
		});

		await execute.call(context);

		expect(sendMailMock).toHaveBeenCalledTimes(1);
		const [mailOptions] = sendMailMock.mock.calls[0];
		expect(mailOptions.to).toBe('to@example.com');
		expect(mailOptions.from).toBe('from@example.com');
		expect(String(mailOptions.text)).toContain('Approve:');
		expect(String(mailOptions.text)).toContain('Deny:');
		expect(getSignedResumeUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: 'req_email_approval_1',
				approved: 'true',
				sid: 'session_email_1',
				afps: 'afps',
				fp: 'tool:Write',
			}),
		);
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_email_approval_1')).toBeDefined();
	});

	it('sends question request and waits', async () => {
		sendMailMock.mockClear();
		const { context, putExecutionToWait } = createExecuteContext({
			type: 'question_request',
			requestId: 'req_email_question_1',
			sessionId: 'session_email_2',
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

		expect(sendMailMock).toHaveBeenCalledTimes(1);
		const [mailOptions] = sendMailMock.mock.calls[0];
		expect(String(mailOptions.text)).toContain('Answer:');
		expect(String(mailOptions.text)).toContain('requestId=req_email_question_1');
		expect(String(mailOptions.text)).toContain('type=question');
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_email_question_1')).toBeDefined();
	});
});
