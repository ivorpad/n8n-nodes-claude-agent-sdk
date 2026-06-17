/**
 * Webhook handler HITL question/form regression tests
 *
 * Question answering and form rendering paths:
 * - POST body.response fallback
 * - POST form fields with q param (resume/complete responseAction)
 * - POST terminal responseAction resolved from stored interaction
 * - GET field params (with/without q), terminal review option
 * - GET question form rendering (from q param and from stored interaction)
 *
 * Split out of webhook.hitl.test.ts to keep each suite under the file-size
 * guard; behaviour is unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeAgentSdk } from '../../ClaudeAgentSdk.node';

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

describe('webhook() — HITL question/form regression', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── POST body.response fallback ────────────────────────────────────

	it('POST with body.response creates question_response with response key', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_resp' },
			body: { response: 'I approve this tool' },
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.type).toBe('question_response');
		expect(payload.answers).toEqual({ response: 'I approve this tool' });
	});

	// ─── POST with form fields and q param ──────────────────────────────

	it('POST with form fields and q param parses answers against questions', async () => {
		const node = new ClaudeAgentSdk();
		const questions = [
			{
				question: 'Color?',
				header: 'Color',
				options: [{ label: 'Red', description: '' }],
				multiSelect: false,
			},
		];
		const q = Buffer.from(JSON.stringify(questions)).toString('base64');

		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_form', q },
			body: { 'field-Color': 'Red' },
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.type).toBe('question_response');
		expect(payload.answers).toBeDefined();
		expect(payload.responseAction).toBe('resume');
	});

	it('POST with terminal review option sets responseAction=complete', async () => {
		const node = new ClaudeAgentSdk();
		const questions = [
			{
				question: '¿La guía está lista?',
				header: 'Revisión',
				options: [
					{ label: 'Está bien', description: 'Cerrar', action: 'complete' },
					{ label: 'Modificar', description: 'Seguir', action: 'resume' },
				],
				multiSelect: false,
			},
		];
		const q = Buffer.from(JSON.stringify(questions)).toString('base64');

		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_terminal_post', q },
			body: { 'field-Revisión': 'Está bien' },
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.type).toBe('question_response');
		expect(payload.responseAction).toBe('complete');
	});

	it('POST resolves terminal responseAction from stored interaction without q params', async () => {
		const node = new ClaudeAgentSdk();
		const staticData = {
			__claudeAgentSdk_hitlInteractions: {
				req_terminal_store: {
					requestId: 'req_terminal_store',
					kind: 'question',
					status: 'pending',
					createdAt: Date.now(),
					timeoutMs: 60_000,
					sessionId: 'sess_store',
					streamKey: 'stream:123:0',
					approvedFingerprints: 'fps_store',
					questions: [
						{
							question: '¿La guía está lista?',
							header: 'Revisión',
							options: [
								{ label: 'Está bien', description: 'Cerrar', value: 'q0o0', action: 'complete' },
								{ label: 'Modificar', description: 'Seguir', value: 'q0o1', action: 'resume' },
							],
							multiSelect: false,
						},
					],
				},
			},
		};

		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_terminal_store' },
			body: { 'field-Revisión': JSON.stringify(['q0o0']) },
			staticData,
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.answers).toEqual({ Revisión: 'Está bien' });
		expect(payload.responseAction).toBe('complete');
		expect(payload.resumeSessionId).toBe('sess_store');
		expect(payload.approvedFingerprints).toBe('fps_store');
		expect(payload.streamKey).toBe('stream:123:0');
	});

	// ─── GET question answer via field params ───────────────────────────

	it('GET with field params and no q falls back to raw field parsing', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: {
				requestId: 'req_raw_fields',
				type: 'question',
				'field-name': 'Alice',
				'field-role': 'Engineer',
			},
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.type).toBe('question_response');
		expect(payload.answers['field-name']).toBe('Alice');
		expect(payload.answers['field-role']).toBe('Engineer');
	});

	it('GET with terminal review option sets responseAction=complete', async () => {
		const node = new ClaudeAgentSdk();
		const questions = [
			{
				question: '¿La guía está lista?',
				header: 'Revisión',
				options: [
					{ label: 'Está bien', description: 'Cerrar', action: 'complete' },
					{ label: 'Modificar', description: 'Seguir', action: 'resume' },
				],
				multiSelect: false,
			},
		];
		const q = Buffer.from(JSON.stringify(questions)).toString('base64');

		const wf = makeWebhookContext({
			method: 'GET',
			query: {
				requestId: 'req_terminal_get',
				type: 'question',
				q,
				'field-Revisión': 'Está bien',
			},
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.type).toBe('question_response');
		expect(payload.responseAction).toBe('complete');
	});

	// ─── GET question form rendering ────────────────────────────────────

	it('GET question form renders HTML with CSP header', async () => {
		const node = new ClaudeAgentSdk();
		const questions = [
			{
				question: 'Preference?',
				header: 'Pref',
				options: [{ label: 'A', description: 'Option A' }],
				multiSelect: false,
			},
		];
		const q = Buffer.from(JSON.stringify(questions)).toString('base64');

		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_form_render', type: 'question', q },
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
		expect(wf.res.send).toHaveBeenCalled();
	});

	it('GET question form renders from stored interaction without q param', async () => {
		const node = new ClaudeAgentSdk();
		const staticData = {
			__claudeAgentSdk_hitlInteractions: {
				req_form_from_store: {
					requestId: 'req_form_from_store',
					kind: 'question',
					status: 'pending',
					createdAt: Date.now(),
					timeoutMs: 60_000,
					questions: [
						{
							question: 'Preference?',
							header: 'Pref',
							options: [{ label: 'A', description: 'Option A', value: 'q0o0' }],
							multiSelect: false,
						},
					],
				},
			},
		};

		const wf = makeWebhookContext({
			method: 'GET',
			query: { requestId: 'req_form_from_store', type: 'question' },
			staticData,
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.send).toHaveBeenCalled();
		const html = wf.res.send.mock.calls[0][0] as string;
		expect(html).toContain('Preference?');
		expect(html).toContain('value="q0o0"');
	});
});
