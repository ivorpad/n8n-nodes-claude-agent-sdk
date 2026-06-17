import { describe, expect, it, vi } from 'vitest';

import { StreamingHandler } from '../../streaming/StreamingHandler';
import type {
	ApprovalResponseContent,
	AskUserQuestionContent,
	PermissionRequestContent,
	StreamingConfig,
	StreamContentType,
} from '../../streaming/types';
import { DEFAULT_MARKERS_JSON_META } from '../../streaming/types';

function createJsonConfig(
	contentTypes: StreamContentType[] = ['text'],
	overrides: Partial<StreamingConfig> = {},
): StreamingConfig {
	return {
		enabled: true,
		contentTypes: new Set(contentTypes),
		useMarkers: false, // JSON mode for easier assertions
		markerFormat: 'jsonMeta',
		markers: DEFAULT_MARKERS_JSON_META,
		toolInputDisplay: 'truncated',
		toolResultDisplay: 'truncated',
		truncationLimit: 500,
		toolFilter: {
			mode: 'all',
			categories: new Set(),
			specificTools: new Set(),
		},
		...overrides,
	};
}

describe('StreamingHandler - Interactive Approval Chunks (UAC v1)', () => {
	it('streamPermissionRequest emits an n8n.approval.v1 request chunk', () => {
		const mockSendChunk = vi.fn();
		const handler = new StreamingHandler(createJsonConfig(['text']), mockSendChunk, 0);

		const payload: PermissionRequestContent = {
			type: 'permission_request',
			requestId: 'req_1',
			toolName: 'Bash',
			toolUseId: 'tooluse_1',
			toolInput: { command: 'rm -rf /' },
			sessionId: 'session_1',
			approveUrl: 'https://example.test/approve',
			denyUrl: 'https://example.test/deny',
			expiresAt: '2026-02-10T00:00:00.000Z',
		};

		handler.streamPermissionRequest(payload);

		expect(mockSendChunk).toHaveBeenCalledTimes(1);
		const chunk = mockSendChunk.mock.calls[0][2] as Record<string, unknown>;

		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('request');
		expect((chunk.request as any).id).toBe('req_1');
		expect((chunk.request as any).kind).toBe('tool_approval');
		expect((chunk.tool as any).name).toBe('Bash');
		expect((chunk.actions as any).approveUrl).toBe('https://example.test/approve');
		expect((chunk.actions as any).denyUrl).toBe('https://example.test/deny');
	});

	it('streamAskUserQuestion emits an n8n.approval.v1 user_question request chunk', () => {
		const mockSendChunk = vi.fn();
		const handler = new StreamingHandler(createJsonConfig(['text']), mockSendChunk, 0);

		const payload: AskUserQuestionContent = {
			type: 'ask_user_question',
			requestId: 'req_q1',
			toolUseId: 'tooluse_q1',
			sessionId: 'session_1',
			responseUrl: 'https://example.test/respond',
			expiresAt: '2026-02-10T00:00:00.000Z',
			questions: [
				{
					question: 'Pick one',
					header: 'Question',
					options: [{ label: 'A', description: 'Option A' }],
					multiSelect: false,
				},
			],
		};

		handler.streamAskUserQuestion(payload);

		expect(mockSendChunk).toHaveBeenCalledTimes(1);
		const chunk = mockSendChunk.mock.calls[0][2] as Record<string, unknown>;

		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('request');
		expect((chunk.request as any).kind).toBe('user_question');
		expect((chunk.actions as any).responseUrl).toBe('https://example.test/respond');
		expect(Array.isArray((chunk as any).questions)).toBe(true);
	});

	it('streamApprovalResponse emits an n8n.approval.v1 response chunk when approval_response streaming is enabled', () => {
		const mockSendChunk = vi.fn();
		const handler = new StreamingHandler(createJsonConfig(['approval_response' as StreamContentType]), mockSendChunk, 0);

		const payload: ApprovalResponseContent = {
			type: 'approval_response',
			requestId: 'req_1',
			approved: true,
			timestamp: '2026-02-10T00:00:00.000Z',
		};

		handler.streamApprovalResponse(payload);

		expect(mockSendChunk).toHaveBeenCalledTimes(1);
		const chunk = mockSendChunk.mock.calls[0][2] as Record<string, unknown>;

		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('response');
		expect((chunk.request as any).id).toBe('req_1');
		expect((chunk.request as any).sessionId).toBeNull();
		expect((chunk as any).approved).toBe(true);
	});

	it('streamApprovalExpired emits an n8n.approval.v1 expired chunk', () => {
		const mockSendChunk = vi.fn();
		const handler = new StreamingHandler(createJsonConfig(['text']), mockSendChunk, 0);

		handler.streamApprovalExpired('req_1', 'tool_approval', 'session_1');

		expect(mockSendChunk).toHaveBeenCalledTimes(1);
		const chunk = mockSendChunk.mock.calls[0][2] as Record<string, unknown>;

		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('expired');
		expect((chunk.request as any).id).toBe('req_1');
		expect((chunk.request as any).kind).toBe('tool_approval');
		expect((chunk.request as any).sessionId).toBe('session_1');
		expect(typeof (chunk as any).timestamp).toBe('string');
	});
});
