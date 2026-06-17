import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { sendApprovalMessage } from '../transport/gmail';
import type { ApprovalSendContext } from '../types';

function createGmailContext() {
	const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ id: 'gmail_message_id' });
	const context: Partial<IExecuteFunctions> = {
		getNode: vi.fn(() => ({ name: 'Claude Agent Gmail' } as INode)),
		helpers: {
			httpRequestWithAuthentication,
		} as IExecuteFunctions['helpers'],
	};
	return { context: context as IExecuteFunctions, httpRequestWithAuthentication };
}

function baseApprovalContext(overrides: Partial<ApprovalSendContext> = {}): ApprovalSendContext {
	return {
		toEmail: 'to@example.com',
		fromEmail: 'from@example.com',
		subjectPrefix: 'Claude HITL',
		messagePrefix: 'HITL',
		outboundMessageMode: 'asIs',
		maxOutboundCharacters: 400,
		fallbackMessage: '',
		request: {
			version: '1.0',
			type: 'approval_request',
			requestId: 'req_1',
			sessionId: 'session_1',
			message: 'Approve this action',
			toolName: 'Write',
		} as ApprovalSendContext['request'],
		approveUrl: 'https://localhost:5678/approve',
		denyUrl: 'https://localhost:5678/deny',
		...overrides,
	};
}

function decodeRaw(raw: string): string {
	const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
	return Buffer.from(base64, 'base64').toString('utf8');
}

describe('ClaudeAgentGmail buildMimeMessage header injection (V9)', () => {
	it('rejects a `to` address containing CRLF so a Bcc header cannot be injected', async () => {
		const { context, httpRequestWithAuthentication } = createGmailContext();

		await expect(
			sendApprovalMessage(
				context,
				baseApprovalContext({ toEmail: 'victim@x.com\r\nBcc: attacker@evil.com' }),
			),
		).rejects.toThrow(/header|injection|newline|CR|LF/i);

		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects a `from` address containing CRLF (From spoofing / extra headers)', async () => {
		const { context, httpRequestWithAuthentication } = createGmailContext();

		await expect(
			sendApprovalMessage(
				context,
				baseApprovalContext({ fromEmail: 'spoof@x.com\r\nReply-To: attacker@evil.com' }),
			),
		).rejects.toThrow(/header|injection|newline|CR|LF/i);

		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects a bare LF in an address even without a following header', async () => {
		const { context } = createGmailContext();

		await expect(
			sendApprovalMessage(context, baseApprovalContext({ toEmail: 'victim@x.com\nfoo' })),
		).rejects.toThrow(/header|injection|newline|CR|LF/i);
	});

	it('builds the expected MIME with no injected Bcc for valid from/to/subject', async () => {
		const { context, httpRequestWithAuthentication } = createGmailContext();

		await sendApprovalMessage(context, baseApprovalContext());

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0];
		const mime = decodeRaw(requestOptions.body.raw as string);

		expect(mime).toContain('From: from@example.com');
		expect(mime).toContain('To: to@example.com');
		expect(mime).toContain('Subject: Claude HITL: Approval Request');
		expect(mime).not.toMatch(/^Bcc:/im);
	});
});
