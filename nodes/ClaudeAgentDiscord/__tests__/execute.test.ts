import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { execute } from '../node/execute';
import { getPending } from '../store/PendingDiscordHitlStore';

function createExecuteContext(
	inputJson: Record<string, unknown>,
	paramOverrides: Record<string, unknown> = {},
) {
	const staticData: Record<string, unknown> = {};
	const params: Record<string, unknown> = {
		channelId: '123456789012345678',
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

	const requestWithAuthentication = vi.fn().mockResolvedValue({ id: 'discord_message_id' });
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
		getNode: vi.fn(() => ({ name: 'Claude Agent Discord' }) as INode),
		helpers: {
			requestWithAuthentication,
		} as IExecuteFunctions['helpers'],
	};

	return {
		context: context as IExecuteFunctions,
		requestWithAuthentication,
		putExecutionToWait,
		getSignedResumeUrl,
	};
}

describe('ClaudeAgentDiscord execute', () => {
	it('silently skips task_result items so the node can sit downstream of the SDK Result output', async () => {
		const { context, requestWithAuthentication, putExecutionToWait } = createExecuteContext({
			type: 'task_result',
			task: 'noop',
			summary: 'done',
		});

		const result = await execute.call(context);
		expect(result).toEqual([
			[{ json: { type: 'task_result', task: 'noop', summary: 'done', version: '1.0' } }],
		]);
		expect(requestWithAuthentication).not.toHaveBeenCalled();
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
		const { context, requestWithAuthentication, putExecutionToWait, getSignedResumeUrl } =
			createExecuteContext({
				type: 'approval_request',
				requestId: 'req_discord_approval_1',
				sessionId: 'session_discord_1',
				message: 'Approve this action',
				toolName: 'Write',
				toolInput: { file_path: '/tmp/demo.txt' },
				approvedFingerprints: 'afps',
				fingerprint: 'tool:Write',
			});

		await execute.call(context);

		expect(requestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, requestOptions] = requestWithAuthentication.mock.calls[0];
		expect(requestOptions.url).toBe(
			'https://discord.com/api/v10/channels/123456789012345678/messages',
		);
		const components = requestOptions.body.components as Array<Record<string, unknown>>;
		expect(components[0]?.type).toBe(1); // ACTION_ROW
		const buttons = (components[0]?.components ?? []) as Array<Record<string, unknown>>;
		expect(buttons[0]?.custom_id).toContain('hitl|approve|req_discord_approval_1');
		expect(buttons[1]?.custom_id).toContain('hitl|deny|req_discord_approval_1');
		expect(getSignedResumeUrl).toHaveBeenCalledWith({
			requestId: 'req_discord_approval_1',
			approved: 'true',
			sid: 'session_discord_1',
			afps: 'afps',
			fp: 'tool:Write',
		});
		expect(getSignedResumeUrl).toHaveBeenCalledWith({
			requestId: 'req_discord_approval_1',
			approved: 'false',
			sid: 'session_discord_1',
			afps: 'afps',
			fp: 'tool:Write',
		});
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_discord_approval_1')).toBeDefined();
	});

	it('sends question request and waits', async () => {
		const { context, requestWithAuthentication, putExecutionToWait, getSignedResumeUrl } =
			createExecuteContext({
				type: 'question_request',
				requestId: 'req_discord_question_1',
				sessionId: 'session_discord_2',
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

		expect(requestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, requestOptions] = requestWithAuthentication.mock.calls[0];
		const components = requestOptions.body.components as Array<Record<string, unknown>>;
		expect(components[0]?.type).toBe(1); // ACTION_ROW
		const buttons = (components[0]?.components ?? []) as Array<Record<string, unknown>>;
		expect(buttons[0]?.custom_id).toBe('hitl|q|req_discord_question_1|0|0');
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
			requestId: 'req_discord_question_1',
			type: 'question',
			sid: 'session_discord_2',
			q: expectedQuestions,
		});
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(getPending(context, 'req_discord_question_1')).toBeDefined();
	});
});
