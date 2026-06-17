/**
 * Webhook handler HITL regression tests (approval + core paths)
 *
 * Tests the webhook's role in the approval flow:
 * - GET denial path
 * - Security: forged query params do NOT flow into the resume payload
 * - Output routing with/without audit logging
 * - Streaming response headers and store call
 * - Approval HTML response (approve/deny)
 * - POST approval (reviewer message + updated input from stored interaction)
 * - GET approval response restored from stored interaction
 * - Missing requestId error / method not allowed
 * - DecisionId determinism, contract version in payloads
 *
 * Auth/responder-identity tests live in webhook.hitl.auth.test.ts and
 * question/form tests live in webhook.hitl.questions.test.ts (split to keep
 * each suite under the file-size guard).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeAgentSdk } from '../../ClaudeAgentSdk.node';
import { storeRequestResponse } from '../../streaming/ResponseStore';
import { HITL_CONTRACT_VERSION } from '../../hitl/contract';

vi.mock('../../streaming/ResponseStore', () => ({
	storeRequestResponse: vi.fn(),
}));

function makeWebhookContext(overrides: {
	method: string;
	query: Record<string, string>;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
	nodeParams?: Record<string, unknown>;
	staticData?: Record<string, unknown>;
	credentials?: Record<string, unknown>;
}) {
	const res = {
		setHeader: vi.fn(),
		send: vi.fn(),
		writableEnded: false,
		statusCode: 200,
	};

	const staticData = overrides.staticData ?? {};
	const headers = overrides.headers ?? {};
	const credentials = overrides.credentials ?? {};

	return {
		getWorkflow: () => ({ id: 'wf_test' }),
		getNode: () => ({
			id: 'node_test',
			webhookId: 'webhook_test',
			name: 'Claude Agent SDK',
			credentials,
		}),
		getRequestObject: () => ({
			method: overrides.method,
			query: overrides.query,
			headers,
		}),
		getHeaderData: () => headers,
		getResponseObject: () => res,
		getBodyData: () => overrides.body ?? {},
		getCredentials: vi.fn(async (name: string) => {
			if (credentials[name] === undefined) {
				throw new Error(`Missing credential: ${name}`);
			}
			return credentials[name];
		}),
		getWorkflowStaticData: vi.fn(() => staticData),
		getNodeParameter: vi.fn((name: string, arg2?: unknown, arg3?: unknown) => {
			const defaultValue = arg3 !== undefined ? arg3 : arg2;
			if (overrides.nodeParams?.[name] !== undefined) return overrides.nodeParams[name];
			if (name === 'interactiveApprovals') return 'pauseForApproval';
			if (name === 'securityOptions') return {};
			return defaultValue;
		}),
		res,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('webhook() — HITL regression', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── POST denial ────────────────────────────────────────────────────
	// V6: GET no longer consumes (it renders a confirmation page — see
	// webhook.csrfConfirmation.test.ts). The decision is consumed on the
	// explicit POST, so the consume-path regressions below drive POST.

	it('POST approved=false returns denial payload with approved=false', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_deny', approved: 'false', fp: 'tool:Bash', sid: 'sess_1' },
		});

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		const outputs = result.workflowData as any[];
		expect(outputs[0][0].json.approved).toBe(false);
		expect(outputs[0][0].json.version).toBe(HITL_CONTRACT_VERSION);
		// Security (V1): with no stored interaction record, the attacker-controllable
		// fp/sid query params must NOT flow into the resume payload. The n8n resume
		// signature does not cover query params, so these come from the record only.
		// See webhook.hitlForgedQuery.test.ts for exploit-level coverage.
		expect(outputs[0][0].json.fingerprint).toBeUndefined();
		expect(outputs[0][0].json.resumeSessionId).toBeUndefined();
	});

	it('POST with malformed approved value fails fast', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_invalid_approval', approved: 'yes' },
		});

		const result = await node.webhook.call(wf);
		expect(result.webhookResponse).toBe('Error: Missing approved parameter');
		expect(result.workflowData).toBeUndefined();
	});

	// ─── Query param trust boundary ─────────────────────────────────────

	it('does NOT forward security-relevant query params into the payload without a stored record', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: {
				requestId: 'req_params',
				approved: 'true',
				fp: 'tool:Write',
				sid: 'session_abc',
				rsat: 'msg_uuid_xyz',
				afps: 'base64fingerprints',
				task: 'dGVzdA==', // base64 of 'test'
			},
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		// Non-security fields still echo straight from the request.
		expect(payload.requestId).toBe('req_params');
		expect(payload.approved).toBe(true);
		// Security (V1): fp/sid/rsat/afps/task are consumed for authorization or
		// replay control on resume, and the n8n resume signature does not cover
		// query params — so a forged URL must not be able to inject them. With no
		// stored interaction record they are empty (the correct, safe posture).
		expect(payload.fingerprint).toBeUndefined();
		expect(payload.sessionId).toBeUndefined();
		expect(payload.resumeSessionId).toBeUndefined();
		expect(payload.resumeSessionAt).toBeUndefined();
		expect(payload.approvedFingerprints).toBeUndefined();
		expect(payload.originalTask).toBeUndefined();
	});

	// ─── Output routing with audit logging ──────────────────────────────

	it('adds empty audit log output when audit logging is enabled', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_audit', approved: 'true' },
			nodeParams: {
				securityOptions: {
					auditLogging: {
						settings: { enabled: true },
					},
				},
			},
		});

		const result = await node.webhook.call(wf);
		const outputs = result.workflowData as any[];

		// Output 0: payload, Output 1: empty audit log (HITL output was removed)
		expect(outputs).toHaveLength(2);
		expect(outputs[1]).toEqual([]);
	});

	it('emits single Result output regardless of interactiveApprovals setting', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_disabled', approved: 'true' },
			nodeParams: { interactiveApprovals: 'disabled' },
		});

		const result = await node.webhook.call(wf);
		const outputs = result.workflowData as any[];

		expect(outputs).toHaveLength(1);
		expect(outputs[0][0].json.type).toBe('approval_response');
	});

	// ─── Streaming format ───────────────────────────────────────────────

	it('sets correct headers and stores response for stream format', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_stream', approved: 'true', format: 'stream' },
		});

		const result = await node.webhook.call(wf);

		expect(wf.res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
		expect(wf.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
		expect(wf.res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
		expect(wf.res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
		expect(vi.mocked(storeRequestResponse)).toHaveBeenCalledWith('req_stream', wf.res);

		const payload = (result.workflowData as any[])[0][0].json;
		expect(payload.streamingRequestId).toBe('req_stream');
		expect(payload.streamKey).toBe('req_stream');
	});

	it('non-stream format does NOT call storeRequestResponse', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_nostream', approved: 'true' },
		});

		await node.webhook.call(wf);

		expect(vi.mocked(storeRequestResponse)).not.toHaveBeenCalled();
		expect(wf.res.send).toHaveBeenCalled();
	});

	// ─── Approval consume response ──────────────────────────────────────
	// V6: the consume path is POST and returns a JSON result. The approve/deny
	// confirmation page (the GET output) is covered in
	// webhook.csrfConfirmation.test.ts.

	it('sends an Approved JSON result for POST approved=true', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_html', approved: 'true' },
		});

		await node.webhook.call(wf);

		expect(wf.res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
		expect(wf.res.send).toHaveBeenCalledWith(
			JSON.stringify({ success: true, message: 'Approved' }),
		);
	});

	it('sends a Denied JSON result for POST approved=false', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_html_deny', approved: 'false' },
		});

		await node.webhook.call(wf);

		expect(wf.res.send).toHaveBeenCalledWith(
			JSON.stringify({ success: true, message: 'Denied' }),
		);
	});

	// ─── POST approval ──────────────────────────────────────────────────

	it('POST approval applies reviewer message and updated input from stored interaction state', async () => {
		const node = new ClaudeAgentSdk();
		const staticData = {
			__claudeAgentSdk_hitlInteractions: {
				req_post_approval: {
					requestId: 'req_post_approval',
					kind: 'approval',
					status: 'pending',
					createdAt: Date.now(),
					timeoutMs: 60_000,
					sessionId: 'sess_store',
					streamKey: 'stream:approval:1',
					originalTaskBase64: 'dGFzaw==',
					approvedFingerprints: 'fps_store',
					resumeSessionAt: 'msg_uuid_store',
					fingerprint: 'tool:Bash',
				},
			},
		};

		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_post_approval' },
			body: {
				approved: true,
				reviewerMessage: '  looks good  ',
				updatedInput: JSON.stringify({ command: 'npm test' }),
			},
			staticData,
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;
		const storedRecord = staticData.__claudeAgentSdk_hitlInteractions.req_post_approval as Record<
			string,
			unknown
		>;

		expect(result.noWebhookResponse).toBe(true);
		expect(wf.res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
		expect(wf.res.send).toHaveBeenCalledWith(
			JSON.stringify({ success: true, message: 'Approved' }),
		);
		expect(payload).toMatchObject({
			type: 'approval_response',
			requestId: 'req_post_approval',
			approved: true,
			fingerprint: 'tool:Bash',
			originalTask: 'dGFzaw==',
			sessionId: 'sess_store',
			resumeSessionId: 'sess_store',
			resumeSessionAt: 'msg_uuid_store',
			approvedFingerprints: 'fps_store',
			streamKey: 'stream:approval:1',
			reviewerMessage: 'looks good',
			updatedInput: { command: 'npm test' },
		});
		expect(storedRecord.status).toBe('answered');
		expect(storedRecord.approved).toBe(true);
		expect(storedRecord.reviewerMessage).toBe('looks good');
		expect(storedRecord.updatedInput).toEqual({ command: 'npm test' });
	});

	it('POST approval rejects conflicting approval values between query and body', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_post_disagree', approved: 'true' },
			body: { approved: false },
		});

		const result = await node.webhook.call(wf);

		expect(result.webhookResponse).toBe('Error: approved in query and body disagree');
		expect(result.workflowData).toBeUndefined();
	});

	it('POST approval response restores session metadata from stored interaction', async () => {
		const node = new ClaudeAgentSdk();
		const staticData = {
			__claudeAgentSdk_hitlInteractions: {
				req_approval_store: {
					requestId: 'req_approval_store',
					kind: 'approval',
					status: 'pending',
					createdAt: Date.now(),
					timeoutMs: 60_000,
					sessionId: 'sess_store',
					streamKey: 'stream:approval:0',
					approvedFingerprints: 'fps_store',
					resumeSessionAt: 'msg_store',
					fingerprint: 'tool:Bash',
					toolName: 'Bash',
				},
			},
		};

		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_approval_store', approved: 'true' },
			staticData,
		});

		const result = await node.webhook.call(wf);
		const payload = (result.workflowData as any[])[0][0].json;

		expect(payload.resumeSessionId).toBe('sess_store');
		expect(payload.resumeSessionAt).toBe('msg_store');
		expect(payload.approvedFingerprints).toBe('fps_store');
		expect(payload.fingerprint).toBe('tool:Bash');
		expect(payload.streamKey).toBe('stream:approval:0');
	});

	// ─── Method not allowed ─────────────────────────────────────────────

	it('returns method not allowed for unsupported methods', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'PUT',
			query: { requestId: 'req_put' },
		});

		const result = await node.webhook.call(wf);
		expect(result.webhookResponse).toMatch(/Method not allowed/i);
	});

	// ─── Missing requestId ──────────────────────────────────────────────

	it('returns error for missing requestId', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'GET',
			query: {},
		});

		const result = await node.webhook.call(wf);
		expect(result.webhookResponse).toMatch(/Missing requestId/i);
	});

	// ─── DecisionId determinism ─────────────────────────────────────────

	it('derives deterministic decisionId from requestId + decision', async () => {
		const node = new ClaudeAgentSdk();

		const wf1 = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_unique', approved: 'true' },
		});
		const wf2 = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_unique', approved: 'true' },
		});
		const wf3 = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_unique', approved: 'false' },
		});

		const result1 = await node.webhook.call(wf1);
		const result2 = await node.webhook.call(wf2);
		const result3 = await node.webhook.call(wf3);

		const id1 = (result1.workflowData as any[])[0][0].json.decisionId;
		const id2 = (result2.workflowData as any[])[0][0].json.decisionId;
		const id3 = (result3.workflowData as any[])[0][0].json.decisionId;

		expect(id1).toBe(id2);
		expect(id1).not.toBe(id3);
	});

	// ─── Pending interaction consumption is safe ────────────────────────

	it('does not throw when consuming a non-existent interaction', async () => {
		const node = new ClaudeAgentSdk();
		const wf = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_nonexistent', approved: 'true' },
		});

		// No interaction stored — consumePendingInteractionSafe should not throw
		const result = await node.webhook.call(wf);
		expect(result.noWebhookResponse).toBe(true);
	});

	// ─── Contract version ───────────────────────────────────────────────

	it('includes HITL_CONTRACT_VERSION in all payloads', async () => {
		const node = new ClaudeAgentSdk();

		// Approval (V6: consumed on POST)
		const wfApproval = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_version', approved: 'true' },
		});
		const approvalResult = await node.webhook.call(wfApproval);
		expect((approvalResult.workflowData as any[])[0][0].json.version).toBe(HITL_CONTRACT_VERSION);

		// Question
		const wfQuestion = makeWebhookContext({
			method: 'POST',
			query: { requestId: 'req_version_q' },
			body: { answers: { q1: 'a1' } },
		});
		const questionResult = await node.webhook.call(wfQuestion);
		expect((questionResult.workflowData as any[])[0][0].json.version).toBe(HITL_CONTRACT_VERSION);
	});
});
