import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import {
	buildDurableCompanionWebhookUrl,
	buildResumeUrl,
	normalizeCompanionPayload,
} from '../../../ClaudeAgentChannelShared/core/executeRuntime';

function createExecuteContext(overrides?: {
	node?: Partial<INode>;
	baseUrl?: string;
}) {
	const node: INode = {
		name: 'Claude Agent Telegram',
		webhookId: 'telegram-hitl-node-webhook-id',
		type: 'n8n-nodes-base.test',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
		...overrides?.node,
	} as INode;

	const getSignedResumeUrl = vi.fn((query?: Record<string, string>) => {
		const qs = new URLSearchParams(query ?? {}).toString();
		return `https://localhost:5678/webhook-waiting/test${qs ? `?${qs}` : ''}`;
	});

	const context = {
		getNode: vi.fn(() => node),
		getInstanceBaseUrl: vi.fn(() => overrides?.baseUrl ?? 'https://example.ngrok-free.app'),
		getSignedResumeUrl,
	} as unknown as IExecuteFunctions;

	return {
		context,
		getSignedResumeUrl,
	};
}

describe('companion execute runtime helpers', () => {
	it('builds a durable companion webhook URL from the node webhook id', () => {
		const { context } = createExecuteContext();

		const url = buildDurableCompanionWebhookUrl(context, {
			requestId: 'req_123',
			approved: 'true',
		});

		expect(url).toBe(
			'https://example.ngrok-free.app/webhook/telegram-hitl-node-webhook-id?requestId=req_123&approved=true',
		);
	});

	it('uses the signed waiting URL when reply handling waits for a response', () => {
		const { context, getSignedResumeUrl } = createExecuteContext();

		const url = buildResumeUrl(context, 'waitForReply', {
			requestId: 'req_123',
			type: 'question',
		});

		expect(url).toBe('https://localhost:5678/webhook-waiting/test?requestId=req_123&type=question');
		expect(getSignedResumeUrl).toHaveBeenCalledWith({
			requestId: 'req_123',
			type: 'question',
		});
	});

	it('uses the durable webhook URL when reply handling dispatches and exits', () => {
		const { context, getSignedResumeUrl } = createExecuteContext();

		const url = buildResumeUrl(context, 'dispatchAndExit', {
			requestId: 'req_123',
			approved: 'false',
		});

		expect(url).toBe(
			'https://example.ngrok-free.app/webhook/telegram-hitl-node-webhook-id?requestId=req_123&approved=false',
		);
		expect(getSignedResumeUrl).not.toHaveBeenCalled();
	});

	it('normalizes companion payloads from objects and JSON strings', () => {
		expect(normalizeCompanionPayload({ text: 'hello' })).toEqual({ text: 'hello' });
		expect(normalizeCompanionPayload('{"text":"hello"}')).toEqual({ text: 'hello' });
		expect(normalizeCompanionPayload('["not","an","object"]')).toBeUndefined();
		expect(normalizeCompanionPayload('')).toBeUndefined();
	});
});
