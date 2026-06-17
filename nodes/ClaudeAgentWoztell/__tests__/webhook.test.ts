import { describe, expect, it, vi } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import { webhook } from '../node/webhook';
import { getPending, savePending } from '../store/PendingWoztellHitlStore';

function createWebhookContext(args: {
	method: 'GET' | 'POST';
	query: Record<string, unknown>;
	body?: Record<string, unknown>;
	nodeParameters?: Record<string, unknown>;
	staticData: Record<string, unknown>;
}) {
	const response = {
		setHeader: vi.fn(),
		send: vi.fn(),
	};

	const context: Partial<IWebhookFunctions> = {
		getNodeParameter: vi.fn((name: string, defaultValue?: unknown) => {
			if (args.nodeParameters && name in args.nodeParameters) return args.nodeParameters[name];
			if (name === 'pendingStoreBackend') return 'staticData';
			if (name === 'pendingStoreTableName') return 'claude_hitl_pending';
			return defaultValue;
		}),
		getRequestObject: vi.fn(() => ({
			method: args.method,
			query: args.query,
			headers: {},
		})),
		getHeaderData: vi.fn(() => ({})),
		getBodyData: vi.fn(() => args.body ?? {}),
		getResponseObject: vi.fn(() => response),
		getWorkflowStaticData: vi.fn(() => args.staticData),
	};

	return { context: context as IWebhookFunctions, response };
}

describe('ClaudeAgentWoztell webhook', () => {
	it('returns strict approval envelope for approve/deny links in waitForReply mode', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_woztell_approval_1', approved: 'true' },
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_approval_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_woztell_approval_1',
			approvedFingerprints: 'abc',
			fingerprint: 'tool:Write',
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

		expect(payload.type).toBe('approval_response');
		expect(payload.requestId).toBe('req_woztell_approval_1');
		expect(payload.channel).toBe('woztell');
		expect(payload.approved).toBe(true);
	});

	it('builds approval envelope from signed query params when pending store entry is missing (waitForReply)', async () => {
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: {
				requestId: 'req_woztell_fallback_1',
				approved: 'true',
				sid: 'session_from_query',
				afps: 'afps_from_query',
				fp: 'tool:Write',
			},
			nodeParameters: { replyHandlingMode: 'waitForReply' },
			staticData,
		});

		const result = await webhook.call(context);
		const payload = result.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
		expect(payload.type).toBe('approval_response');
		expect(payload.resumeSessionId).toBe('session_from_query');
		expect(payload.channel).toBe('woztell');
	});

	it('rejects an unsigned ?approved query decision in dispatchAndExit mode (durable URL has no n8n signature)', async () => {
		// Woztell's default reply-handling mode is dispatchAndExit; the durable
		// companion URL carries no n8n signature, so an unsigned ?approved query is
		// an unauthenticated bearer token (V2, HIGH) and must be rejected.
		const staticData: Record<string, unknown> = {};
		const { context } = createWebhookContext({
			method: 'GET',
			query: { requestId: 'req_woztell_forged_1', approved: 'true', sid: 'session_forged' },
			nodeParameters: { replyHandlingMode: 'dispatchAndExit' },
			staticData,
		});

		await savePending(context, {
			requestId: 'req_woztell_forged_1',
			kind: 'approval',
			status: 'pending',
			createdAt: Date.now(),
			timeoutMs: 60_000,
			sessionId: 'session_woztell_forged_1',
			channel: 'woztell',
		}, { backend: 'staticData' });

		const result = await webhook.call(context);
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatch(/forbidden/i);

		// Decision must NOT have been consumed.
		const stillPending = await getPending(context, 'req_woztell_forged_1', { backend: 'staticData' });
		expect(stillPending?.status).toBe('pending');
	});
});
