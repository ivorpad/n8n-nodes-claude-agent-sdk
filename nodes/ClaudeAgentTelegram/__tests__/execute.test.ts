import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { execute } from '../node/execute';
import { getPending } from '../store/PendingTelegramHitlStore';

function createExecuteContext(
	inputJson: Record<string, unknown> | Array<Record<string, unknown>>,
	paramOverrides: Record<string, unknown> = {},
) {
	const staticData: Record<string, unknown> = {};
	const inputJsonItems = Array.isArray(inputJson) ? inputJson : [inputJson];
	const params: Record<string, unknown> = {
		chatId: '123456789',
		pendingStoreBackend: 'staticData',
		pendingStoreTableName: 'claude_hitl_pending',
		messagePrefix: 'HITL',
		messageTitle: 'Claude HITL',
		outboundMessageMode: 'asIs',
		maxOutboundCharacters: 400,
		fallbackMessage: '',
		replyHandlingMode: 'waitForReply',
		limitWaitTime: true,
		resumeAmount: 45,
		resumeUnit: 'minutes',
		...paramOverrides,
	};

	const httpRequest = vi.fn().mockResolvedValue({ ok: true });
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
		getSignedResumeUrl,
		getInstanceBaseUrl: vi.fn(() => 'https://example.ngrok-free.app'),
		setSignatureValidationRequired,
		putExecutionToWait,
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(
			() =>
				({
					name: 'Claude Agent Telegram',
					webhookId: 'telegram-hitl-node-webhook-id',
				}) as INode,
		),
		getCredentials: vi.fn(() => ({
			accessToken: 'telegram_token',
			baseUrl: 'https://api.telegram.org',
		})),
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

describe('ClaudeAgentTelegram execute', () => {
	it('silently skips task_result items so the node can sit downstream of the SDK Result output', async () => {
		const { context, httpRequest, putExecutionToWait } = createExecuteContext({
			type: 'task_result',
			task: 'noop',
			summary: 'done',
		});

		const result = await execute.call(context);
		expect(result).toEqual([[{ json: { type: 'task_result', task: 'noop', summary: 'done', version: '1.0' } }]]);
		expect(httpRequest).not.toHaveBeenCalled();
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
		const { context, httpRequest, putExecutionToWait, getSignedResumeUrl } = createExecuteContext({
			type: 'approval_request',
			requestId: 'req_telegram_approval_1',
			sessionId: 'session_telegram_1',
			message: 'Approve this action',
			toolName: 'Write',
			toolInput: { file_path: '/tmp/demo.txt' },
			approvedFingerprints: 'afps',
			fingerprint: 'tool:Write',
		});

		await execute.call(context);

		expect(httpRequest).toHaveBeenCalledTimes(1);
		const [requestOptions] = httpRequest.mock.calls[0];
		expect(requestOptions.url).toBe('https://api.telegram.org/bottelegram_token/sendMessage');
		expect(requestOptions.body.chat_id).toBe('123456789');
		const keyboard = requestOptions.body.reply_markup.inline_keyboard as Array<Array<Record<string, string>>>;
		expect(keyboard[0]?.[0]?.callback_data).toContain('hitl|approve|req_telegram_approval_1');
		expect(keyboard[0]?.[1]?.callback_data).toContain('hitl|deny|req_telegram_approval_1');
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(await getPending(context, 'req_telegram_approval_1')).toBeDefined();
	});

	it('puts execution to wait before signing or sending wait-mode approval URLs', async () => {
		const callOrder: string[] = [];
		const { context, httpRequest, putExecutionToWait, getSignedResumeUrl } = createExecuteContext({
			type: 'approval_request',
			requestId: 'req_telegram_order_1',
			sessionId: 'session_telegram_order_1',
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
			return { ok: true };
		});

		await execute.call(context);

		expect(callOrder[0]).toBe('wait');
		expect(callOrder).toContain('sign');
		expect(callOrder.at(-1)).toBe('send');
	});

	it('continues after a failed item when continueOnFail is enabled', async () => {
		const { context, httpRequest } = createExecuteContext([
			{
				version: undefined,
				type: 'approval_request',
				requestId: 'req_telegram_bad_1',
				sessionId: 'session_telegram_bad_1',
				message: 'Approve this action',
				toolName: 'Write',
			},
			{
				type: 'approval_request',
				requestId: 'req_telegram_good_1',
				sessionId: 'session_telegram_good_1',
				message: 'Approve this action',
				toolName: 'Read',
			},
		]);
		vi.mocked(context.continueOnFail).mockReturnValue(true);

		const result = await execute.call(context);

		expect(result[0]).toHaveLength(2);
		expect(result[0]?.[0]?.json.error).toMatch(/version must be 1.0/i);
		expect(result[0]?.[0]?.pairedItem).toEqual({ item: 0 });
		expect(result[0]?.[1]?.json.requestId).toBe('req_telegram_good_1');
		expect(httpRequest).toHaveBeenCalledTimes(1);
	});

	it('sends question request and waits', async () => {
		const { context, httpRequest, putExecutionToWait } = createExecuteContext({
			type: 'question_request',
			requestId: 'req_telegram_question_1',
			sessionId: 'session_telegram_2',
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

		expect(httpRequest).toHaveBeenCalledTimes(1);
		const [requestOptions] = httpRequest.mock.calls[0];
		const keyboard = requestOptions.body.reply_markup.inline_keyboard as Array<Array<Record<string, string>>>;
		expect(keyboard[0]?.[0]?.callback_data).toBe('hitl|q|req_telegram_question_1|0|0');
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(await getPending(context, 'req_telegram_question_1')).toBeDefined();
	});

	it('dispatches approval request and exits without waiting when durable mode is selected', async () => {
		const { context, httpRequest, putExecutionToWait, getSignedResumeUrl } = createExecuteContext(
			{
				type: 'approval_request',
				requestId: 'req_telegram_dispatch_1',
				sessionId: 'session_telegram_dispatch_1',
				message: 'Approve this action',
				toolName: 'Write',
			},
			{
				replyHandlingMode: 'dispatchAndExit',
			},
		);

		const result = await execute.call(context);

		const dispatchItem = result?.[0]?.[0];
		expect(dispatchItem).toBeDefined();
		expect((dispatchItem?.json as Record<string, unknown>).dispatchStatus).toBe('dispatched');
		expect((dispatchItem?.json as Record<string, unknown>).replyHandlingMode).toBe('dispatchAndExit');
		expect(httpRequest).toHaveBeenCalledTimes(1);
		expect(getSignedResumeUrl).not.toHaveBeenCalled();
		const [requestOptions] = httpRequest.mock.calls[0];
		const keyboard = requestOptions.body.reply_markup.inline_keyboard as Array<
			Array<Record<string, string>>
		>;
		expect(keyboard[0]?.[0]?.callback_data).toContain('hitl|approve|req_telegram_dispatch_1');
		expect(keyboard[0]?.[1]?.callback_data).toContain('hitl|deny|req_telegram_dispatch_1');
		expect(putExecutionToWait).not.toHaveBeenCalled();
		expect(await getPending(context, 'req_telegram_dispatch_1')).toBeDefined();
	});
});
