import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import type { ApprovalSendContext, OutboundMessageMode, QuestionSendContext } from '../types';
import { loadNodemailer } from './loadNodemailer';

interface SmtpCredentials {
	host: string;
	port: number;
	secure: boolean;
	disableStartTls?: boolean;
	hostName?: string;
	user?: string;
	password?: string;
}

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

function configureTransport(credentials: SmtpCredentials): Record<string, unknown> {
	const connectionOptions: Record<string, unknown> = {
		host: credentials.host,
		port: credentials.port,
		secure: credentials.secure,
	};

	if (credentials.secure === false) {
		connectionOptions.ignoreTLS = credentials.disableStartTls;
	}

	if (typeof credentials.hostName === 'string' && credentials.hostName) {
		connectionOptions.name = credentials.hostName;
	}

	if (credentials.user || credentials.password) {
		connectionOptions.auth = {
			user: credentials.user,
			pass: credentials.password,
		};
	}

	return connectionOptions;
}

async function sendEmail(args: {
	ctx: IExecuteFunctions;
	toEmail: string;
	fromEmail: string;
	subject: string;
	textBody: string;
	htmlBody: string;
}): Promise<void> {
	const credentials = await args.ctx.getCredentials<SmtpCredentials>('smtp');
	const nodemailer = await loadNodemailer(args.ctx);
	const transporter = nodemailer.createTransport(configureTransport(credentials));
	try {
		await transporter.sendMail({
			from: args.fromEmail,
			to: args.toEmail,
			subject: args.subject,
			text: args.textBody,
			html: args.htmlBody,
		});
	} catch (error) {
		throw new NodeOperationError(
			args.ctx.getNode(),
			error instanceof Error ? error : new Error(String(error)),
		);
	} finally {
		if (typeof transporter.close === 'function') {
			transporter.close();
		}
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
	const textBody = [
		primaryMessage,
		'',
		'Approve:',
		context.approveUrl,
		'',
		'Deny:',
		context.denyUrl,
	].join('\n');

	const htmlBody = [
		`<p>${escapeHtml(primaryMessage).replace(/\n/g, '<br/>')}</p>`,
		'<p><a href="' + escapeHtml(context.approveUrl) + '">Approve</a></p>',
		'<p><a href="' + escapeHtml(context.denyUrl) + '">Deny</a></p>',
	].join('');

	await sendEmail({
		ctx,
		toEmail: context.toEmail,
		fromEmail: context.fromEmail,
		subject: buildSubject(context.subjectPrefix, 'approval'),
		textBody,
		htmlBody,
	});
}

export async function sendQuestionMessage(
	ctx: IExecuteFunctions,
	context: QuestionSendContext,
): Promise<void> {
	const primaryMessage = resolveQuestionPrimaryMessage(context);
	const textBody = [primaryMessage, '', 'Answer:', context.responseUrl].join('\n');

	const htmlBody = [
		`<p>${escapeHtml(primaryMessage).replace(/\n/g, '<br/>')}</p>`,
		'<p><a href="' + escapeHtml(context.responseUrl) + '">Answer</a></p>',
	].join('');

	await sendEmail({
		ctx,
		toEmail: context.toEmail,
		fromEmail: context.fromEmail,
		subject: buildSubject(context.subjectPrefix, 'question'),
		textBody,
		htmlBody,
	});
}
