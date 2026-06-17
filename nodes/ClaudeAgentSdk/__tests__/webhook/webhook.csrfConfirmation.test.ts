/**
 * Security regression (V6): CSRF-class GET auto-approval.
 *
 * Approve/deny URLs are emailed and Slacked, so link scanners, unfurlers and
 * browser prefetch issue automatic GETs against them. Before the fix, a GET
 * carrying `?approved=true` was routed straight to the consume path, silently
 * recording the decision with no human action.
 *
 * The fix: a GET must NOT mutate state. It renders a confirmation page (an HTML
 * form that POSTs the decision). Only the explicit POST consumes. The
 * confirmation page must not auto-submit — the decision is applied solely on a
 * deliberate user click.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeAgentSdk } from '../../ClaudeAgentSdk.node';
import { buildApprovalConfirmationHtml } from '../../webhook/questionForm';

vi.mock('../../streaming/ResponseStore', () => ({
	storeRequestResponse: vi.fn(),
}));

function makeWebhookContext(overrides: {
	method: string;
	query: Record<string, string>;
	body?: Record<string, unknown>;
	staticData?: Record<string, unknown>;
}) {
	const res = {
		setHeader: vi.fn(),
		send: vi.fn(),
		writableEnded: false,
		statusCode: 200,
	};

	const staticData = overrides.staticData ?? {};

	return {
		getWorkflow: () => ({ id: 'wf_test' }),
		getNode: () => ({
			id: 'node_test',
			webhookId: 'webhook_test',
			name: 'Claude Agent SDK',
			credentials: {},
		}),
		getRequestObject: () => ({
			method: overrides.method,
			query: overrides.query,
			headers: {},
		}),
		getHeaderData: () => ({}),
		getResponseObject: () => res,
		getBodyData: () => overrides.body ?? {},
		getCredentials: vi.fn(async (name: string) => {
			throw new Error(`Missing credential: ${name}`);
		}),
		getWorkflowStaticData: vi.fn(() => staticData),
		getNodeParameter: vi.fn((name: string, arg2?: unknown, arg3?: unknown) => {
			const defaultValue = arg3 !== undefined ? arg3 : arg2;
			if (name === 'interactiveApprovals') return 'pauseForApproval';
			if (name === 'securityOptions') return {};
			return defaultValue;
		}),
		res,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('buildApprovalConfirmationHtml (V6 renderer)', () => {
	it('renders a POST form (no auto-submit) for an approve decision', () => {
		const html = buildApprovalConfirmationHtml({ approved: true });

		// It must POST, never auto-mutate via GET.
		expect(html).toMatch(/method=["']POST["']/i);
		// Hidden field carries the decision so the POST consumes the right answer.
		expect(html).toContain('name="approved"');
		expect(html).toContain('value="true"');
		// A deliberate submit control must exist.
		expect(html).toMatch(/type=["']submit["']/i);
	});

	it('renders a deny confirmation distinctly from approve', () => {
		const approveHtml = buildApprovalConfirmationHtml({ approved: true });
		const denyHtml = buildApprovalConfirmationHtml({ approved: false });

		expect(denyHtml).toContain('value="false"');
		expect(denyHtml).not.toBe(approveHtml);
	});

	it('does NOT auto-submit the form on load', () => {
		const html = buildApprovalConfirmationHtml({ approved: true });

		// No script-driven submission, no onload submit, no meta-refresh — the
		// page would otherwise re-introduce the exact CSRF/prefetch problem.
		expect(html).not.toMatch(/\.submit\s*\(/);
		expect(html).not.toMatch(/onload/i);
		expect(html).not.toMatch(/http-equiv=["']refresh["']/i);
		expect(html).not.toMatch(/requestSubmit/i);
	});

	it('escapes attacker-controlled values rendered into the page', () => {
		const html = buildApprovalConfirmationHtml({
			approved: true,
			toolName: '<script>alert(1)</script>',
		});

		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
	});
});

describe('webhook() — V6 GET confirmation does not consume', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('GET approved=true returns confirmation HTML and does NOT consume the decision', async () => {
		const node = new ClaudeAgentSdk();
		const staticData: Record<string, unknown> = {};
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_csrf', approved: 'true' },
			staticData,
		});

		const result = await node.webhook.call(wf);

		// No decision recorded: no resume payload emitted, no workflow output.
		expect(result.workflowData).toBeUndefined();
		// The decision ledger must be untouched — nothing was consumed.
		expect(staticData.__claudeAgentSdk_hitlWebhookDecisions).toBeUndefined();

		// A confirmation page (POST form) was rendered instead.
		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
		const html = wf.res.send.mock.calls[0][0] as string;
		expect(html).toMatch(/method=["']POST["']/i);
		expect(html).toMatch(/type=["']submit["']/i);
		expect(html).not.toMatch(/\.submit\s*\(/);
	});

	it('GET approved=false also renders a confirmation page without consuming', async () => {
		const node = new ClaudeAgentSdk();
		const staticData: Record<string, unknown> = {};
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_csrf_deny', approved: 'false' },
			staticData,
		});

		const result = await node.webhook.call(wf);

		expect(result.workflowData).toBeUndefined();
		expect(staticData.__claudeAgentSdk_hitlWebhookDecisions).toBeUndefined();
		const html = wf.res.send.mock.calls[0][0] as string;
		expect(html).toContain('value="false"');
	});

	it('GET with malformed approved value still fails fast (no confirmation page)', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_csrf_bad', approved: 'maybe' },
		});

		const result = await node.webhook.call(wf);
		expect(result.webhookResponse).toBe('Error: Missing approved parameter');
		expect(result.workflowData).toBeUndefined();
	});

	it('POST (the explicit confirmation submit) DOES consume the decision', async () => {
		const node = new ClaudeAgentSdk();
		const staticData: Record<string, unknown> = {};
		const wf = makeWebhookContext({
			method: 'POST',
			// The confirmation form posts back to the same URL, so the decision is
			// in the query string; `approved` is also mirrored into the body.
			query: { requestId: 'req_csrf_post', approved: 'true' },
			body: { approved: 'true' },
			staticData,
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		const outputs = result.workflowData as unknown as Array<Array<{ json: Record<string, unknown> }>>;
		expect(outputs[0][0].json.type).toBe('approval_response');
		expect(outputs[0][0].json.approved).toBe(true);
		// The decision ledger now records the consumed request.
		const ledger = staticData.__claudeAgentSdk_hitlWebhookDecisions as Record<string, unknown>;
		expect(ledger).toBeDefined();
		expect(ledger.req_csrf_post).toBeDefined();
	});
});
