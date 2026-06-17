import type { IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

import {
	buildApprovalConfirmationHtml,
	FORM_CSP,
} from '../../ClaudeAgentSdk/webhook/questionForm';

/**
 * Shared CSRF-safe approval confirmation for channel HITL webhooks.
 *
 * Approve/deny URLs are delivered out-of-band (email, chat), where link
 * scanners, unfurlers and browser prefetch issue automatic GET requests against
 * them. A GET must therefore NEVER consume the decision. This renders the
 * confirmation page returned on GET: a no-script HTML form that POSTs the
 * decision back to the same URL, so the decision is applied only when the
 * reviewer deliberately clicks the button.
 *
 * `buildApprovalConfirmationHtml` already emits a form with no auto-submit and a
 * hidden `responseAction=resume`; it is shared with the SDK node so all webhooks
 * render an identical, audited page. Channels call this from a `method === 'GET'`
 * guard placed BEFORE any consume, and only consume on the explicit POST.
 */
export function renderChannelApprovalConfirmation(
	ctx: IWebhookFunctions,
	args: { approved: boolean; toolName?: string },
): IWebhookResponseData {
	const res = ctx.getResponseObject();
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader('Content-Security-Policy', FORM_CSP);
	res.send(buildApprovalConfirmationHtml({ approved: args.approved, toolName: args.toolName }));
	return { noWebhookResponse: true };
}
