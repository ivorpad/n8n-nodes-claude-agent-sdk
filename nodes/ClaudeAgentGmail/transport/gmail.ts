import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import type { ApprovalSendContext, OutboundMessageMode, QuestionSendContext } from '../types';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function buildBaseText(prefix: string | undefined, message: string): string {
	const parts = [prefix, message]
		.map((part) => (part ?? '').trim())
		.filter((part) => part.length > 0);
	return parts.join('\n\n');
}

function resolveOutboundMessage(args: {
	mode?: OutboundMessageMode;
	maxCharacters?: number;
	message: string;
	fallbackMessage: string;
	defaultMessage: string;
}): string {
	let resolved = args.message;
	if (args.mode === 'none') {
		resolved = '';
	} else if (args.mode === 'trim') {
		const max = Number(args.maxCharacters);
		if (Number.isFinite(max) && max > 0 && resolved.length > max) {
			resolved = resolved.slice(0, max);
		}
	}

	if (resolved.trim().length > 0) return resolved;
	if (args.fallbackMessage.trim().length > 0) return args.fallbackMessage;
	return args.defaultMessage;
}

function buildSubject(prefix: string | undefined, kind: 'approval' | 'question'): string {
	const safePrefix = (prefix ?? '').trim() || 'Claude HITL';
	return kind === 'approval' ? `${safePrefix}: Approval Request` : `${safePrefix}: Question`;
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
}

// Fail-closed guard against MIME header injection (V9). A CR or LF in a header
// value would terminate the current header line and let an attacker inject
// arbitrary headers (e.g. a silent `Bcc:` for exfiltration, or a spoofed
// `From:`). A newline is never valid inside an email address, so we reject
// rather than silently strip. Address values flow from node params
// (fromEmail/toEmail) which may be n8n expressions bound to upstream/agent data.
function assertSafeHeaderValue(field: string, value: string): void {
	if (/[\r\n]/.test(value)) {
		throw new Error(`Invalid ${field}: header values must not contain CR or LF characters`);
	}
}

function encodeHeader(value: string): string {
	if (!/[^\x20-\x7e]/.test(value)) return value;
	const base64 = Buffer.from(value, 'utf8').toString('base64');
	return `=?UTF-8?B?${base64}?=`;
}

function toBase64Url(value: string): string {
	return Buffer.from(value, 'utf8')
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function buildMimeMessage(mail: {
	from: string;
	to: string;
	subject: string;
	text: string;
	html?: string;
}): string {
	assertSafeHeaderValue('from', mail.from);
	assertSafeHeaderValue('to', mail.to);
	assertSafeHeaderValue('subject', mail.subject);
	const encodedSubject = encodeHeader(mail.subject);
	if (!mail.html) {
		return [
			`From: ${mail.from}`,
			`To: ${mail.to}`,
			`Subject: ${encodedSubject}`,
			'MIME-Version: 1.0',
			'Content-Type: text/plain; charset="UTF-8"',
			'Content-Transfer-Encoding: 8bit',
			'',
			normalizeNewlines(mail.text),
			'',
		].join('\r\n');
	}

	const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	return [
		`From: ${mail.from}`,
		`To: ${mail.to}`,
		`Subject: ${encodedSubject}`,
		'MIME-Version: 1.0',
		`Content-Type: multipart/alternative; boundary="${boundary}"`,
		'',
		`--${boundary}`,
		'Content-Type: text/plain; charset="UTF-8"',
		'Content-Transfer-Encoding: 8bit',
		'',
		normalizeNewlines(mail.text),
		'',
		`--${boundary}`,
		'Content-Type: text/html; charset="UTF-8"',
		'Content-Transfer-Encoding: 8bit',
		'',
		normalizeNewlines(mail.html),
		'',
		`--${boundary}--`,
		'',
	].join('\r\n');
}

async function sendViaGmailApi(
	ctx: IExecuteFunctions,
	mail: { from: string; to: string; subject: string; text: string; html: string },
): Promise<void> {
	try {
		const raw = toBase64Url(
			buildMimeMessage({
				from: mail.from,
				to: mail.to,
				subject: mail.subject,
				text: mail.text,
				html: mail.html,
			}),
		);
		await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'gmailOAuth2', {
			method: 'POST',
			url: 'https://www.googleapis.com/gmail/v1/users/me/messages/send',
			body: { raw },
			json: true,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		});
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), error as Error);
	}
}

function resolveApprovalPrimaryMessage(context: ApprovalSendContext): string {
	const defaultRawMessage = `Claude requests approval for ${context.request.toolName || 'tool'}.`;
	const baseMessage = context.request.message || defaultRawMessage;
	const primaryBaseMessage = buildBaseText(context.messagePrefix, baseMessage);
	const fallbackPrimaryMessage = buildBaseText(context.messagePrefix, context.fallbackMessage || '');
	const defaultPrimaryMessage = buildBaseText(context.messagePrefix, defaultRawMessage);

	return resolveOutboundMessage({
		mode: context.outboundMessageMode,
		maxCharacters: context.maxOutboundCharacters,
		message: primaryBaseMessage,
		fallbackMessage: fallbackPrimaryMessage,
		defaultMessage: defaultPrimaryMessage,
	});
}

function resolveQuestionPrimaryMessage(context: QuestionSendContext): string {
	const defaultRawMessage = 'Claude needs your input to continue.';
	const baseMessage = context.request.message || defaultRawMessage;
	const primaryBaseMessage = buildBaseText(context.messagePrefix, baseMessage);
	const fallbackPrimaryMessage = buildBaseText(context.messagePrefix, context.fallbackMessage || '');
	const defaultPrimaryMessage = buildBaseText(context.messagePrefix, defaultRawMessage);

	return resolveOutboundMessage({
		mode: context.outboundMessageMode,
		maxCharacters: context.maxOutboundCharacters,
		message: primaryBaseMessage,
		fallbackMessage: fallbackPrimaryMessage,
		defaultMessage: defaultPrimaryMessage,
	});
}

export async function sendApprovalMessage(
	ctx: IExecuteFunctions,
	context: ApprovalSendContext,
): Promise<void> {
	const primaryMessage = resolveApprovalPrimaryMessage(context);
	const text = [
		primaryMessage,
		'',
		'Approve:',
		context.approveUrl,
		'',
		'Deny:',
		context.denyUrl,
	].join('\n');
	const html = [
		`<p>${escapeHtml(primaryMessage).replace(/\n/g, '<br/>')}</p>`,
		`<p><a href="${escapeHtml(context.approveUrl)}">Approve</a></p>`,
		`<p><a href="${escapeHtml(context.denyUrl)}">Deny</a></p>`,
	].join('');

	await sendViaGmailApi(ctx, {
		from: context.fromEmail,
		to: context.toEmail,
		subject: buildSubject(context.subjectPrefix, 'approval'),
		text,
		html,
	});
}

export async function sendQuestionMessage(
	ctx: IExecuteFunctions,
	context: QuestionSendContext,
): Promise<void> {
	const primaryMessage = resolveQuestionPrimaryMessage(context);
	const text = [primaryMessage, '', 'Answer:', context.responseUrl].join('\n');
	const html = [
		`<p>${escapeHtml(primaryMessage).replace(/\n/g, '<br/>')}</p>`,
		`<p><a href="${escapeHtml(context.responseUrl)}">Answer</a></p>`,
	].join('');

	await sendViaGmailApi(ctx, {
		from: context.fromEmail,
		to: context.toEmail,
		subject: buildSubject(context.subjectPrefix, 'question'),
		text,
		html,
	});
}
