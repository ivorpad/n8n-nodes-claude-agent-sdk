import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeAgentSdk } from '../../ClaudeAgentSdk.node';
import { storeRequestResponse } from '../../streaming/ResponseStore';

vi.mock('../../streaming/ResponseStore', () => ({
	storeRequestResponse: vi.fn(),
}));

describe('ClaudeAgentSdk Node - webhook()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns an error when requestId is missing', async () => {
		const node = new ClaudeAgentSdk();

		const wf = {
			getRequestObject: () => ({ method: 'GET', query: {} }),
		} as any;

		const result = await node.webhook.call(wf);
		expect(result.webhookResponse).toMatch(/Missing requestId/i);
	});

	it('POST approval response (non-stream) returns workflowData with payload on the Result output', async () => {
		// V6: GET renders a confirmation page; the decision is consumed on POST.
		const node = new ClaudeAgentSdk();

		const res = {
			setHeader: vi.fn(),
			send: vi.fn(),
		};

		const staticData: Record<string, unknown> = {};
		const wf = {
			getBodyData: () => ({}),
			getRequestObject: () => ({
				method: 'POST',
				query: { requestId: 'req_1', approved: 'true', rsat: 'msg_uuid_1' },
			}),
			getResponseObject: () => res,
			getWorkflowStaticData: vi.fn(() => staticData),
			getNodeParameter: vi.fn((name: string, defaultValue?: unknown) => {
				if (name === 'interactiveApprovals') return 'pauseForApproval';
				if (name === 'securityOptions') return {};
				return defaultValue;
			}),
		} as any;

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(res.send).toHaveBeenCalled();

		const outputs = result.workflowData as any[];
		expect(outputs).toHaveLength(1);
		expect(outputs[0][0].json.type).toBe('approval_response');
		expect(outputs[0][0].json.requestId).toBe('req_1');
		expect(outputs[0][0].json.approved).toBe(true);
		// Security (V1): rsat drives the resume anchor on resume and the n8n
		// resume signature does not cover query params, so it must come from the
		// stored interaction record only. With no stored record it is empty.
		expect(outputs[0][0].json.resumeSessionAt).toBeUndefined();
	});

	it('POST approval response (format=stream) stores the response and sets NDJSON headers', async () => {
		// V6: GET renders a confirmation page; the decision is consumed on POST.
		const node = new ClaudeAgentSdk();

		const res = {
			setHeader: vi.fn(),
			send: vi.fn(),
			writableEnded: false,
		};

		const staticData: Record<string, unknown> = {};
		const wf = {
			getBodyData: () => ({}),
			getRequestObject: () => ({
				method: 'POST',
				query: { requestId: 'req_1', approved: 'true', format: 'stream' },
			}),
			getResponseObject: () => res,
			getWorkflowStaticData: vi.fn(() => staticData),
			getNodeParameter: vi.fn((name: string, defaultValue?: unknown) => {
				if (name === 'interactiveApprovals') return 'pauseForApproval';
				if (name === 'securityOptions') return {};
				return defaultValue;
			}),
		} as any;

		const result = await node.webhook.call(wf);

		expect(result.noWebhookResponse).toBe(true);
		expect(vi.mocked(storeRequestResponse)).toHaveBeenCalledWith('req_1', res);
		expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
	});

	it('GET question form returns a safe error on invalid questions payload', async () => {
		const node = new ClaudeAgentSdk();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const wf = {
			getRequestObject: () => ({
				method: 'GET',
				query: { requestId: 'req_1', type: 'question', q: Buffer.from('not-json').toString('base64') },
			}),
		} as any;

		const result = await node.webhook.call(wf);
		errorSpy.mockRestore();
		expect(result.webhookResponse).toMatch(/No questions found/i);
	});

	it('POST returns an error when answers are missing', async () => {
		const node = new ClaudeAgentSdk();

		const wf = {
			getRequestObject: () => ({
				method: 'POST',
				query: { requestId: 'req_1' },
			}),
			getBodyData: () => ({}),
		} as any;

		const result = await node.webhook.call(wf);
		expect(result.webhookResponse).toMatch(/Missing answers/i);
	});

	it('handles POST question response without pending-store state', async () => {
		const node = new ClaudeAgentSdk();
		const res = {
			setHeader: vi.fn(),
			send: vi.fn(),
		};

		const staticData: Record<string, unknown> = {};
		const wf = {
			getRequestObject: () => ({
				method: 'POST',
				query: { requestId: 'req_q', type: 'question' },
			}),
			getBodyData: () => ({
				answers: { Seniority: 'Senior' },
			}),
			getResponseObject: () => res,
			getWorkflowStaticData: vi.fn(() => staticData),
			getNodeParameter: vi.fn((name: string, defaultValue?: unknown) => {
				if (name === 'interactiveApprovals') return 'pauseForApproval';
				if (name === 'securityOptions') return {};
				return defaultValue;
			}),
		} as any;

		const result = await node.webhook.call(wf);
		expect(result.noWebhookResponse).toBe(true);
	});
});
