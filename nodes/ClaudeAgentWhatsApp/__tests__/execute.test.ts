import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { execute } from '../node/execute';
import { getPending, savePending } from '../store/PendingWhatsAppHitlStore';

function createExecuteContext(
	inputJson: Record<string, unknown> | Array<Record<string, unknown>>,
	paramOverrides: Record<string, unknown> = {},
) {
	const staticData: Record<string, unknown> = {};
	const inputJsonItems = Array.isArray(inputJson) ? inputJson : [inputJson];

	const params: Record<string, unknown> = {
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

	const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ ok: true });
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
			baseUrl: 'https://graph.facebook.com',
			apiVersion: 'v22.0',
			phoneNumberId: '880386175156713',
		})),
		getSignedResumeUrl,
		getInstanceBaseUrl: vi.fn(() => 'https://example.ngrok-free.app'),
		setSignatureValidationRequired,
		putExecutionToWait,
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(
			() =>
				({
					name: 'Claude Agent WhatsApp',
					webhookId: '33f84c3f-e716-4fc2-92f8-d515f43c22c4',
				}) as INode,
		),
		helpers: {
			httpRequestWithAuthentication,
		} as IExecuteFunctions['helpers'],
	};

	return {
		context: context as IExecuteFunctions,
		httpRequestWithAuthentication,
		putExecutionToWait,
		setSignatureValidationRequired,
		getSignedResumeUrl,
	};
}

describe('ClaudeAgentWhatsApp execute', () => {
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

	it('passes through non-HITL WhatsApp user messages to SDK', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait } = createExecuteContext(
			{
				field: 'messages',
				messaging_product: 'whatsapp',
				messages: [
					{
						from: '34696169382',
						id: 'wamid.user.message.1',
						type: 'text',
						text: { body: 'hello there' },
					},
				],
			},
		);

		const result = await execute.call(context);
		expect(result[0]?.[0]?.json?.messages?.[0]?.text?.body).toBe('hello there');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		expect(putExecutionToWait).not.toHaveBeenCalled();
	});

	it('drops WhatsApp status callbacks', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				field: 'messages',
				messaging_product: 'whatsapp',
				statuses: [{ status: 'sent', recipient_id: '34696169382' }],
			},
		);

		const result = await execute.call(context);
		expect(result).toEqual([[]]);
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('resolves latest pending question by recipient for plain text replies without context id', async () => {
		const requestId = 'req_execute_channel_reply_question_latest_1';
		const { context } = createExecuteContext(
			{
				field: 'messages',
				messaging_product: 'whatsapp',
				messages: [
					{
						from: '34696169382',
						id: 'wamid.user.message.question.1',
						type: 'text',
						text: { body: 'example' },
					},
				],
			},
		);

		await savePending(
			context,
			{
				requestId,
				kind: 'question',
				status: 'pending',
				createdAt: Date.now(),
				timeoutMs: 60_000,
				sessionId: 'session_execute_channel_reply_question_latest_1',
				approvedFingerprints: 'tool:Read',
				recipientId: '34696169382',
				questions: [
					{
						question: 'What would you like to name the file?',
						header: 'File Name',
						options: [],
						multiSelect: false,
					},
				],
			},
			{ backend: 'staticData' },
		);

		const result = await execute.call(context);
		const payload = result[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('question_response');
		expect(payload.requestId).toBe(requestId);
		expect(payload.resumeSessionId).toBe('session_execute_channel_reply_question_latest_1');
		expect(payload.answers).toEqual({
			'What would you like to name the file?': 'example',
		});

		const pendingAfter = await getPending(context, requestId, { backend: 'staticData' });
		expect(pendingAfter?.status).toBe('consumed');
	});

	it('builds approval response from WhatsApp interactive reply and consumes pending once', async () => {
		const requestId = 'req_execute_channel_reply_approval_1';
		const contextMessageId = 'wamid.pending.approval.1';
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				field: 'messages',
				messaging_product: 'whatsapp',
				messages: [
					{
						from: '34696169382',
						context: { id: contextMessageId },
						interactive: {
							type: 'button_reply',
							button_reply: {
								id: `hitl|approve|${requestId}`,
								title: 'Approve',
							},
						},
					},
				],
			},
		);

		await savePending(
			context,
			{
				requestId,
				kind: 'approval',
				status: 'pending',
				createdAt: Date.now(),
				timeoutMs: 60_000,
				sessionId: 'session_execute_channel_reply_approval_1',
				approvedFingerprints: 'tool:Read',
				fingerprint: 'tool:Write',
				recipientId: '34696169382',
				providerMessageId: contextMessageId,
			},
			{ backend: 'staticData' },
		);

		const firstResult = await execute.call(context);
		const firstPayload = firstResult[0]?.[0]?.json as Record<string, unknown>;
		expect(firstPayload.type).toBe('approval_response');
		expect(firstPayload.requestId).toBe(requestId);
		expect(firstPayload.approved).toBe(true);
		expect(firstPayload.resumeSessionId).toBe('session_execute_channel_reply_approval_1');
		expect(firstPayload.approvedFingerprints).toBe('tool:Read');
		expect(firstPayload.fingerprint).toBe('tool:Write');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();

		const pendingAfterFirst = await getPending(context, requestId, { backend: 'staticData' });
		expect(pendingAfterFirst?.status).toBe('consumed');

		const secondResult = await execute.call(context);
		expect(secondResult).toEqual([[]]);
	});

	it('does not fall back to latest recipient pending when inbound includes unknown requestId', async () => {
		const knownRequestId = 'req_execute_channel_reply_known_approval_1';
		const { context } = createExecuteContext(
			{
				field: 'messages',
				messaging_product: 'whatsapp',
				messages: [
					{
						from: '34696169382',
						interactive: {
							type: 'button_reply',
							button_reply: {
								id: 'hitl|approve|req_execute_channel_reply_unknown_approval_1',
								title: 'Approve',
							},
						},
					},
				],
			},
		);

		await savePending(
			context,
			{
				requestId: knownRequestId,
				kind: 'approval',
				status: 'pending',
				createdAt: Date.now(),
				timeoutMs: 60_000,
				sessionId: 'session_execute_channel_reply_known_approval_1',
				approvedFingerprints: 'tool:Read',
				fingerprint: 'tool:Write',
				recipientId: '34696169382',
			},
			{ backend: 'staticData' },
		);

		const result = await execute.call(context);
		expect(result).toEqual([[]]);

		const pendingAfter = await getPending(context, knownRequestId, { backend: 'staticData' });
		expect(pendingAfter?.status).toBe('pending');
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

	it('fails fast when HITL request sessionId is missing', async () => {
		const { context } = createExecuteContext({
			type: 'approval_request',
			requestId: 'req_missing_session_1',
			sessionId: '',
			message: 'Approve this action',
			toolName: 'Write',
		});

		await expect(execute.call(context)).rejects.toThrow(/missing sessionId/i);
	});

	it('sends approval request and waits', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait, getSignedResumeUrl } = createExecuteContext({
			type: 'approval_request',
			requestId: 'req_approval_execute_1',
			sessionId: 'session_1',
			message: 'Approve this action',
			toolName: 'Write',
			toolInput: { file_path: '/tmp/demo.txt' },
			approvedFingerprints: 'afps',
			fingerprint: 'tool:Write',
		});

		await execute.call(context);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0];
		expect(requestOptions.body.type).toBe('text');
		expect(requestOptions.body.text.body).toContain('Approve:');
		expect(requestOptions.body.text.body).toContain('Deny:');
		expect(getSignedResumeUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: 'req_approval_execute_1',
				approved: 'true',
				sid: 'session_1',
				afps: 'afps',
				fp: 'tool:Write',
			}),
		);
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(await getPending(context, 'req_approval_execute_1', { backend: 'staticData' })).toBeDefined();
	});

	it('puts execution to wait before signing or sending wait-mode approval URLs', async () => {
		const callOrder: string[] = [];
		const { context, httpRequestWithAuthentication, putExecutionToWait, getSignedResumeUrl } = createExecuteContext({
			type: 'approval_request',
			requestId: 'req_whatsapp_order_1',
			sessionId: 'session_whatsapp_order_1',
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

	it('continues after a failed HITL item when continueOnFail is enabled', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext([
			{
				version: undefined,
				type: 'approval_request',
				requestId: 'req_whatsapp_bad_1',
				sessionId: 'session_whatsapp_bad_1',
				message: 'Approve this action',
				toolName: 'Write',
			},
			{
				type: 'approval_request',
				requestId: 'req_whatsapp_good_1',
				sessionId: 'session_whatsapp_good_1',
				message: 'Approve this action',
				toolName: 'Read',
			},
		]);
		vi.mocked(context.continueOnFail).mockReturnValue(true);

		const result = await execute.call(context);

		expect(result[0]).toHaveLength(2);
		expect(result[0]?.[0]?.json.error).toMatch(/version must be 1.0/i);
		expect(result[0]?.[0]?.pairedItem).toEqual({ item: 0 });
		expect(result[0]?.[1]?.json.requestId).toBe('req_whatsapp_good_1');
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('dispatches approval request and exits without waiting when durable mode is selected', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait, getSignedResumeUrl } = createExecuteContext(
			{
				type: 'approval_request',
				requestId: 'req_approval_dispatch_1',
				sessionId: 'session_dispatch_1',
				message: 'Approve this action',
				toolName: 'Write',
				toolInput: { file_path: '/tmp/demo.txt' },
				approvedFingerprints: 'afps',
				fingerprint: 'tool:Write',
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
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(getSignedResumeUrl).not.toHaveBeenCalled();
		const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0];
		const bodyText = requestOptions.body.text.body as string;
		expect(bodyText).toContain(
			'https://example.ngrok-free.app/webhook/33f84c3f-e716-4fc2-92f8-d515f43c22c4',
		);
		expect(bodyText).not.toContain('/webhook-waiting/');
		expect(putExecutionToWait).not.toHaveBeenCalled();
		expect(await getPending(context, 'req_approval_dispatch_1', { backend: 'staticData' })).toBeDefined();
	});

	it('sends question request and waits', async () => {
		const { context, httpRequestWithAuthentication, putExecutionToWait } = createExecuteContext({
			type: 'question_request',
			requestId: 'req_question_execute_1',
			sessionId: 'session_2',
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
		expect(requestOptions.body.type).toBe('text');
		expect(requestOptions.body.text.body).toContain('Respond:');
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
		expect(await getPending(context, 'req_question_execute_1', { backend: 'staticData' })).toBeDefined();
	});

	it('splits oversized text question messages into WhatsApp-safe chunks', async () => {
		const oversizedMessage = 'A'.repeat(9000);
		const { context, httpRequestWithAuthentication, putExecutionToWait } = createExecuteContext({
			type: 'question_request',
			requestId: 'req_question_execute_split_1',
			sessionId: 'session_split_1',
			message: oversizedMessage,
		}, {
			messagePrefix: '',
			messageTitle: '',
		});

		await execute.call(context);

		expect(httpRequestWithAuthentication.mock.calls.length).toBeGreaterThan(1);
		for (const call of httpRequestWithAuthentication.mock.calls) {
			const body = call?.[1]?.body as Record<string, unknown>;
			expect(body.type).toBe('text');
			const chunk = (body.text as { body?: string })?.body || '';
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}

		const lastBody = httpRequestWithAuthentication.mock.calls.at(-1)?.[1]?.body as Record<string, unknown>;
		expect((lastBody.text as { body?: string })?.body).toContain('Respond:');
		expect(putExecutionToWait).toHaveBeenCalledTimes(1);
	});

	it('sends companion text before approval resume message when enabled', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'approval_request',
				requestId: 'req_approval_companion_1',
				sessionId: 'session_companion_1',
				message: 'Approve this action',
				toolName: 'Write',
			},
			{
				enableCompanionMessage: true,
				companionMessageType: 'text',
				companionPayload: {
					text: {
						preview_url: true,
						body: 'Companion message',
					},
				},
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		const firstBody = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		const secondBody = httpRequestWithAuthentication.mock.calls[1]?.[1]?.body as Record<string, unknown>;
		expect(firstBody.type).toBe('text');
		expect((firstBody.text as { body?: string }).body).toContain('Companion message');
		expect(secondBody.type).toBe('text');
		expect((secondBody.text as { body?: string }).body).toContain('Approve:');
	});

	it('sends question as interactive CTA button when delivery mode is interactiveCtaButtons', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_cta_1',
				sessionId: 'session_cta_1',
				message: 'What should we do next?',
			},
			{
				deliveryMode: 'interactiveCtaButtons',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const body = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('interactive');
		const interactive = body.interactive as Record<string, unknown>;
		expect(interactive.type).toBe('cta_url');
		const params = (interactive.action as { parameters?: { url?: string } }).parameters;
		expect(params?.url).toContain('requestId=req_question_cta_1');
	});

	it('sends approval as two interactive CTA buttons when delivery mode is interactiveCtaButtons', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'approval_request',
				requestId: 'req_approval_cta_1',
				sessionId: 'session_cta_2',
				message: 'Approve deployment?',
				toolName: 'Bash',
			},
			{
				deliveryMode: 'interactiveCtaButtons',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		const firstBody = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		const secondBody = httpRequestWithAuthentication.mock.calls[1]?.[1]?.body as Record<string, unknown>;
		expect(firstBody.type).toBe('interactive');
		expect(secondBody.type).toBe('interactive');
		const firstUrl = (((firstBody.interactive as Record<string, unknown>).action as Record<string, unknown>)
			.parameters as Record<string, unknown>).url as string;
		const secondUrl = (((secondBody.interactive as Record<string, unknown>).action as Record<string, unknown>)
			.parameters as Record<string, unknown>).url as string;
		expect(firstUrl).toContain('approved=true');
		expect(secondUrl).toContain('approved=false');
	});

	it('sends approval as in-chat reply buttons when delivery mode is interactiveReplyButtons', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'approval_request',
				requestId: 'req_approval_reply_btn_1',
				sessionId: 'session_reply_btn_approval_1',
				message: 'Approve deployment?',
				toolName: 'Bash',
			},
			{
				deliveryMode: 'interactiveReplyButtons',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const body = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('interactive');
		const interactive = body.interactive as Record<string, unknown>;
		expect(interactive.type).toBe('button');
		const buttons = ((interactive.action as Record<string, unknown>).buttons as Array<Record<string, unknown>>);
		const approveId = (((buttons[0]?.reply as Record<string, unknown>)?.id) as string) || '';
		const denyId = (((buttons[1]?.reply as Record<string, unknown>)?.id) as string) || '';
		expect(approveId).toBe('hitl|approve|req_approval_reply_btn_1');
		expect(denyId).toBe('hitl|deny|req_approval_reply_btn_1');
		expect(JSON.stringify(body)).not.toContain('https://');
	});

	it('sends question as in-chat reply buttons when delivery mode is interactiveReplyButtons', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_reply_btn_1',
				sessionId: 'session_reply_btn_question_1',
				message: 'Choose format',
				questions: [
					{
						question: 'Format?',
						header: 'Format',
						options: [
							{ label: 'Summary', description: 'Short output' },
							{ label: 'Detailed', description: 'Full output' },
						],
						multiSelect: false,
					},
				],
			},
			{
				deliveryMode: 'interactiveReplyButtons',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const body = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('interactive');
		const interactive = body.interactive as Record<string, unknown>;
		expect(interactive.type).toBe('button');
		const buttons = ((interactive.action as Record<string, unknown>).buttons as Array<Record<string, unknown>>);
		const firstId = (((buttons[0]?.reply as Record<string, unknown>)?.id) as string) || '';
		const secondId = (((buttons[1]?.reply as Record<string, unknown>)?.id) as string) || '';
		expect(firstId).toBe('hitl|q|req_question_reply_btn_1|0|0');
		expect(secondId).toBe('hitl|q|req_question_reply_btn_1|0|1');
		expect(JSON.stringify(body)).not.toContain('https://');
	});

	it('sends summary as text before interactive question buttons', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_reply_btn_summary_1',
				sessionId: 'session_reply_btn_summary_1',
				message: 'Overview: uv is a fast Python package manager.\n\nWhat should we explore next?',
				agent_sdk_result: {
					type: 'task_result',
					summary: 'Overview: uv is a fast Python package manager.',
				},
				questions: [
					{
						question: 'What should we explore next?',
						header: 'Next',
						options: [
							{ label: 'Install steps', description: 'Show install and setup' },
							{ label: 'Project config', description: 'Show pyproject patterns' },
						],
						multiSelect: false,
					},
				],
			},
			{
				deliveryMode: 'interactiveReplyButtons',
				messagePrefix: '',
				messageTitle: '',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		const summaryBody = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(summaryBody.type).toBe('text');
		expect((summaryBody.text as { body?: string }).body).toContain(
			'Overview: uv is a fast Python package manager.',
		);
		expect((summaryBody.text as { body?: string }).body).not.toContain('What should we explore next?');

		const body = httpRequestWithAuthentication.mock.calls[1]?.[1]?.body as Record<string, unknown>;
		const interactive = body.interactive as Record<string, unknown>;
		const interactiveBody = interactive.body as { text?: string };
		expect(interactiveBody.text).not.toContain('Overview: uv is a fast Python package manager.');
		expect(interactiveBody.text).toBe('What should we explore next?');
	});

	it('strips duplicated single-question prompt when only summary carries narrative text', async () => {
		const repeatedPrompt = "What is the specific GitHub repository you want to explore? (e.g., 'microsoft/vscode' or 'https://github.com/astral-sh/uv')";
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_reply_btn_summary_only_1',
				sessionId: 'session_reply_btn_summary_only_1',
				agent_sdk_result: {
					type: 'task_result',
					summary: [
						"I'd love to help explore a GitHub repo! It seems your answer didn't include a specific repository name. Let me ask one more time:",
						repeatedPrompt,
					].join('\n\n'),
				},
				questions: [
					{
						question: repeatedPrompt,
						header: 'Repository',
						options: [
							{ label: 'astral-sh/uv', description: 'Explore uv' },
							{ label: 'microsoft/vscode', description: 'Explore VS Code' },
						],
						multiSelect: false,
					},
				],
			},
			{
				deliveryMode: 'interactiveReplyButtons',
				messagePrefix: '',
				messageTitle: '',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);

		const summaryBody = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(summaryBody.type).toBe('text');
		const summaryText = (summaryBody.text as { body?: string }).body || '';
		expect(summaryText).toContain("I'd love to help explore a GitHub repo!");
		expect(summaryText).toContain('Let me ask one more time:');
		expect(summaryText).not.toContain(repeatedPrompt);

		const body = httpRequestWithAuthentication.mock.calls[1]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('interactive');
		const interactive = body.interactive as Record<string, unknown>;
		const interactiveBody = interactive.body as { text?: string };
		expect(interactiveBody.text).toBe(repeatedPrompt);
	});

	it('includes all question prompts in summary text before multi-question response-form handoff', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_reply_btn_multi_prompt_1',
				sessionId: 'session_reply_btn_multi_prompt_1',
				message: [
					"Here's the full recap.",
					'What would you like to do next with this information?',
					'Would you like me to generate a checklist too?',
				].join('\n\n'),
				agent_sdk_result: {
					type: 'task_result',
					summary: "Here's the full recap.",
				},
				questions: [
					{
						question: 'What would you like to do next with this information?',
						header: 'Next',
						options: [
							{ label: 'Deep dive Python verifier', description: 'Inspect python verifier' },
							{ label: 'Deep dive TypeScript verifier', description: 'Inspect TS verifier' },
						],
						multiSelect: false,
					},
					{
						question: 'Would you like me to generate a checklist too?',
						header: 'Checklist',
						options: [
							{ label: 'Yes', description: 'Add checklist' },
							{ label: 'No', description: 'Skip checklist' },
						],
						multiSelect: false,
					},
				],
			},
			{
				deliveryMode: 'interactiveReplyButtons',
				messagePrefix: '',
				messageTitle: '',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);

		const summaryBody = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(summaryBody.type).toBe('text');
		const summaryText = (summaryBody.text as { body?: string }).body || '';
		expect(summaryText).toContain("Here's the full recap.");
		expect(summaryText).toContain('What would you like to do next with this information?');
		expect(summaryText).toContain('Would you like me to generate a checklist too?');

		const body = httpRequestWithAuthentication.mock.calls[1]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('text');
		const actionText = (body.text as { body?: string }).body || '';
		expect(actionText).toContain('Multiple inputs are required to continue.');
		expect(actionText).toContain('1. What would you like to do next with this information?');
		expect(actionText).toContain('2. Would you like me to generate a checklist too?');
		expect(actionText).toContain('Respond: https://localhost:5678/webhook-waiting/test');
	});

	it('falls back to response-form text when multiple questions are present in interactive reply mode', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_reply_btn_multi_question_1',
				sessionId: 'session_reply_btn_multi_question_1',
				message: [
					'Summary: uv docs fetched successfully.',
					'What should we do next?',
					'Do you also want a checklist?',
				].join('\n\n'),
				agent_sdk_result: {
					type: 'task_result',
					summary: 'Summary: uv docs fetched successfully.',
				},
				questions: [
					{
						question: 'What should we do next?',
						header: 'Next Step',
						options: [
							{ label: 'Search docs', description: 'Search a topic in docs' },
							{ label: 'Read source', description: 'Inspect source code' },
						],
						multiSelect: false,
					},
					{
						question: 'Do you also want a checklist?',
						header: 'Checklist',
						options: [
							{ label: 'Yes', description: 'Include checklist' },
							{ label: 'No', description: 'Skip checklist' },
						],
						multiSelect: false,
					},
				],
			},
			{
				deliveryMode: 'interactiveReplyButtons',
				messagePrefix: '',
				messageTitle: '',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);

		const summaryBody = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(summaryBody.type).toBe('text');
		expect((summaryBody.text as { body?: string }).body).toContain('Summary: uv docs fetched successfully.');

		const actionBody = httpRequestWithAuthentication.mock.calls[1]?.[1]?.body as Record<string, unknown>;
		expect(actionBody.type).toBe('text');
		const actionText = (actionBody.text as { body?: string }).body || '';
		expect(actionText).toContain('Multiple inputs are required to continue.');
		expect(actionText).toContain('1. What should we do next?');
		expect(actionText).toContain('2. Do you also want a checklist?');
		expect(actionText).toContain('Respond: https://localhost:5678/webhook-waiting/test');
		expect(JSON.stringify(actionBody)).not.toContain('"type":"interactive"');
	});

	it('trims approval message when outbound mode is trim', async () => {
		const longMessage = 'A'.repeat(400);
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'approval_request',
				requestId: 'req_approval_trim_1',
				sessionId: 'session_trim_1',
				message: longMessage,
				toolName: 'Write',
			},
			{
				messagePrefix: '',
				messageTitle: '',
				outboundMessageMode: 'trim',
				maxOutboundCharacters: 50,
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const body = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('text');
		expect((body.text as { body?: string }).body).toContain(`${'A'.repeat(50)}\n\nApprove:`);
		expect((body.text as { body?: string }).body).not.toContain(`${'A'.repeat(51)}`);
	});

	it('uses fallback message when outbound mode is none', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'approval_request',
				requestId: 'req_approval_none_1',
				sessionId: 'session_none_1',
				message: 'This should not be sent',
				toolName: 'Write',
			},
			{
				messagePrefix: '',
				messageTitle: '',
				outboundMessageMode: 'none',
				fallbackMessage: 'Approve this action?',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const body = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('text');
		expect((body.text as { body?: string }).body).toContain('Approve this action?\n\nApprove:');
		expect((body.text as { body?: string }).body).not.toContain('This should not be sent');
	});

	it('falls back to default question text when outbound mode is none and fallback is empty', async () => {
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_none_default_1',
				sessionId: 'session_none_default_1',
				message: 'This should not be sent',
			},
			{
				messagePrefix: '',
				messageTitle: '',
				outboundMessageMode: 'none',
				fallbackMessage: '',
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const body = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('text');
		expect((body.text as { body?: string }).body).toContain(
			'Claude needs your input to continue.\n\nRespond:',
		);
		expect((body.text as { body?: string }).body).not.toContain('This should not be sent');
	});

	it('trims question message for interactive CTA mode', async () => {
		const longMessage = 'What should we do next? '.repeat(30);
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{
				type: 'question_request',
				requestId: 'req_question_trim_cta_1',
				sessionId: 'session_trim_cta_1',
				message: longMessage,
			},
			{
				deliveryMode: 'interactiveCtaButtons',
				messagePrefix: '',
				messageTitle: '',
				outboundMessageMode: 'trim',
				maxOutboundCharacters: 40,
			},
		);

		await execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const body = httpRequestWithAuthentication.mock.calls[0]?.[1]?.body as Record<string, unknown>;
		expect(body.type).toBe('interactive');
		const interactive = body.interactive as { body?: { text?: string } };
		expect(interactive.body?.text).toContain(`${longMessage.slice(0, 40)}\n\nTap the button`);
	});
});
