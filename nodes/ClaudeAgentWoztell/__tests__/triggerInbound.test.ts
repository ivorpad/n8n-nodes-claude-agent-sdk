import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { handleTriggerInbound } from '../node/triggerInbound';
import { savePending } from '../store/PendingWoztellHitlStore';

function createExecuteContext() {
	const staticData: Record<string, unknown> = {};
	const params: Record<string, unknown> = {
		pendingStoreBackend: 'staticData',
		pendingStoreTableName: 'claude_hitl_pending',
	};

	const context: Partial<IExecuteFunctions> = {
		getNodeParameter: vi.fn((name: string, _index: number, defaultValue?: unknown) =>
			params[name] === undefined ? defaultValue : params[name]),
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(
			() =>
				({
					name: 'Claude Agent Woztell',
					webhookId: 'woztell-hitl-node-webhook-id',
				}) as INode,
		),
	};

	return context as IExecuteFunctions;
}

describe('handleTriggerInbound', () => {
	it('builds an approval response envelope from a Woztell payload reply', async () => {
		const context = createExecuteContext();

		await savePending(
			context,
			{
				requestId: 'req_woztell_approval_1',
				kind: 'approval',
				status: 'pending',
				createdAt: Date.now(),
				timeoutMs: 60_000,
				sessionId: 'session_woztell_approval_1',
				approvedFingerprints: 'tool:Read',
				fingerprint: 'tool:Write',
				recipientId: '34696169382',
				providerMessageId: 'wamid.woztell.approval.1',
			},
			{ backend: 'staticData' },
		);

		const result = await handleTriggerInbound(
			context,
			{
				eventType: 'INBOUND',
				type: 'PAYLOAD',
				from: '34696169382',
				context: { id: 'wamid.woztell.approval.1' },
				data: {
					payload: 'hitl|approve|req_woztell_approval_1|tool:Write',
					title: 'Approve',
				},
			},
			0,
		);

		expect(result).toEqual({
			mode: 'envelope',
			envelope: expect.objectContaining({
				type: 'approval_response',
				requestId: 'req_woztell_approval_1',
				approved: true,
				resumeSessionId: 'session_woztell_approval_1',
				fingerprint: 'tool:Write',
			}),
		});
	});

	it('builds a question response envelope from a Woztell interactive reply', async () => {
		const context = createExecuteContext();

		await savePending(
			context,
			{
				requestId: 'req_woztell_question_1',
				kind: 'question',
				status: 'pending',
				createdAt: Date.now(),
				timeoutMs: 60_000,
				sessionId: 'session_woztell_question_1',
				approvedFingerprints: 'tool:Read',
				recipientId: '34696169382',
				questions: [
					{
						question: 'Format?',
						header: 'Format',
						options: [
							{ label: 'Summary', description: 'Short' },
							{ label: 'Full report', description: 'Detailed' },
						],
						multiSelect: false,
					},
				],
			},
			{ backend: 'staticData' },
		);

		const result = await handleTriggerInbound(
			context,
			{
				eventType: 'INBOUND',
				type: 'INTERACTIVE_MESSAGE_REPLY',
				from: '34696169382',
				data: {
					payload: 'hitl|q|req_woztell_question_1|0|1',
					title: 'Full report',
				},
			},
			0,
		);

		expect(result).toEqual({
			mode: 'envelope',
			envelope: expect.objectContaining({
				type: 'question_response',
				requestId: 'req_woztell_question_1',
				resumeSessionId: 'session_woztell_question_1',
				answers: {
					'Format?': 'Full report',
				},
			}),
		});
	});
});
