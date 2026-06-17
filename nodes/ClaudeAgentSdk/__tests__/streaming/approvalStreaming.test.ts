/**
 * Approval streaming chunk builders — regression tests
 *
 * Tests the NDJSON chunk format for approval events to prevent
 * regressions in the streaming contract consumed by the UI.
 */

import { describe, expect, it, vi } from 'vitest';

import {
	streamPermissionRequestUacV1,
	streamAskUserQuestionUacV1,
	streamApprovalResponseUacV1,
	streamApprovalExpiredUacV1,
} from '../../streaming/handler/approvals';
import type { StreamingConfig } from '../../streaming/types';

function createStreamingConfig(overrides: Partial<StreamingConfig> = {}): StreamingConfig {
	return {
		enabled: true,
		useMarkers: false,
		markers: {
			textStart: '<<TEXT>>',
			textEnd: '<</TEXT>>',
			jsonMsgStart: '<<JSON:{type}>>',
			jsonMsgEnd: '<</JSON>>',
		},
		jsonMode: 'ndjson',
		filterMode: 'all',
		...overrides,
	} as StreamingConfig;
}

describe('streamPermissionRequestUacV1', () => {
	it('emits n8n.approval.v1 request chunk with tool_approval kind', () => {
		const emitJson = vi.fn();
		const stream = vi.fn();
		const formatMarker = vi.fn();

		streamPermissionRequestUacV1({
			config: createStreamingConfig(),
			stream,
			emitJson,
			formatMarker,
			payload: {
				requestId: 'req_1',
				toolName: 'Bash',
				toolUseId: 'tu_1',
				toolInput: { command: 'echo hello' },
				sessionId: 'sess_1',
				approveUrl: 'https://n8n.test/approve',
				denyUrl: 'https://n8n.test/deny',
				expiresAt: '2026-02-26T13:00:00Z',
			},
		});

		expect(emitJson).toHaveBeenCalledOnce();
		const chunk = emitJson.mock.calls[0][0];

		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('request');
		expect(chunk.request.id).toBe('req_1');
		expect(chunk.request.kind).toBe('tool_approval');
		expect(chunk.request.sessionId).toBe('sess_1');
		expect(chunk.request.expiresAt).toBe('2026-02-26T13:00:00Z');
		expect(chunk.tool.name).toBe('Bash');
		expect(chunk.tool.useId).toBe('tu_1');
		expect(chunk.tool.input).toEqual({ command: 'echo hello' });
		expect(chunk.actions.approveUrl).toBe('https://n8n.test/approve');
		expect(chunk.actions.denyUrl).toBe('https://n8n.test/deny');
		expect(chunk.display.title).toBe('Approve Bash?');
	});

	it('produces readable tool summaries', () => {
		const emitJson = vi.fn();

		// Bash — shows command
		streamPermissionRequestUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'r1', toolName: 'Bash', toolInput: { command: 'npm install' },
				sessionId: 's', approveUrl: '', denyUrl: '', expiresAt: '',
			},
		});
		expect(emitJson.mock.calls[0][0].display.summary).toBe('npm install');

		emitJson.mockClear();

		// Write — shows file path
		streamPermissionRequestUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'r2', toolName: 'Write', toolInput: { file_path: '/tmp/out.txt', content: 'hi' },
				sessionId: 's', approveUrl: '', denyUrl: '', expiresAt: '',
			},
		});
		expect(emitJson.mock.calls[0][0].display.summary).toBe('Write to /tmp/out.txt');

		emitJson.mockClear();

		// MCP tool — shows server.tool format
		streamPermissionRequestUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'r3', toolName: 'mcp__slack__send_message', toolInput: { text: 'hello' },
				sessionId: 's', approveUrl: '', denyUrl: '', expiresAt: '',
			},
		});
		expect(emitJson.mock.calls[0][0].display.summary).toBe('MCP: slack.send_message');
	});

	it('truncates long Bash commands at 80 chars', () => {
		const emitJson = vi.fn();
		const longCmd = 'a'.repeat(120);

		streamPermissionRequestUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'r', toolName: 'Bash', toolInput: { command: longCmd },
				sessionId: 's', approveUrl: '', denyUrl: '', expiresAt: '',
			},
		});

		const summary = emitJson.mock.calls[0][0].display.summary as string;
		expect(summary.length).toBeLessThanOrEqual(83); // 80 + '...'
		expect(summary.endsWith('...')).toBe(true);
	});

	it('uses marker format when useMarkers=true', () => {
		const stream = vi.fn();
		const emitJson = vi.fn();
		const formatMarker = vi.fn().mockReturnValue('<<JSON:approval_request>>');

		streamPermissionRequestUacV1({
			config: createStreamingConfig({ useMarkers: true }),
			stream,
			emitJson,
			formatMarker,
			payload: {
				requestId: 'r', toolName: 'Bash', toolInput: {},
				sessionId: 's', approveUrl: '', denyUrl: '', expiresAt: '',
			},
		});

		// When useMarkers=true, it calls stream() not emitJson()
		expect(stream).toHaveBeenCalledOnce();
		expect(emitJson).not.toHaveBeenCalled();
		expect(formatMarker).toHaveBeenCalled();
		const streamedContent = stream.mock.calls[0][0] as string;
		expect(streamedContent).toContain('<<JSON:approval_request>>');
		expect(streamedContent).toContain('n8n.approval.v1');
	});
});

describe('streamAskUserQuestionUacV1', () => {
	it('emits user_question request chunk', () => {
		const emitJson = vi.fn();

		streamAskUserQuestionUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'req_q',
				questions: [
					{
						question: 'What color?',
						header: 'Color',
						options: [{ label: 'Red', description: '', action: 'complete' }],
						multiSelect: false,
					},
				],
				responseUrl: 'https://n8n.test/question',
				sessionId: 'sess_1',
				expiresAt: '2026-02-26T14:00:00Z',
			},
		});

		const chunk = emitJson.mock.calls[0][0];
		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('request');
		expect(chunk.request.kind).toBe('user_question');
		expect(chunk.questions).toHaveLength(1);
		expect(chunk.questions[0].question).toBe('What color?');
		expect(chunk.questions[0].options[0].action).toBe('complete');
		expect(chunk.actions.responseUrl).toBe('https://n8n.test/question');
		expect(chunk.display.title).toBe('Color');
		expect(chunk.display.summary).toBe('What color?');
	});
});

describe('streamApprovalResponseUacV1', () => {
	it('emits response event', () => {
		const emitJson = vi.fn();

		streamApprovalResponseUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'req_1',
				approved: true,
				timestamp: '2026-02-26T12:30:00Z',
			},
		});

		const chunk = emitJson.mock.calls[0][0];
		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('response');
		expect(chunk.approved).toBe(true);
		expect(chunk.request.id).toBe('req_1');
		expect(chunk.request.sessionId).toBeNull();
	});

	it('emits response with denied status', () => {
		const emitJson = vi.fn();

		streamApprovalResponseUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'req_deny',
				approved: false,
				timestamp: '2026-02-26T12:30:00Z',
			},
		});

		expect(emitJson.mock.calls[0][0].approved).toBe(false);
	});

	it('emits response with provided sessionId when available', () => {
		const emitJson = vi.fn();

		streamApprovalResponseUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			payload: {
				requestId: 'req_with_session',
				approved: true,
				sessionId: 'session_123',
				timestamp: '2026-02-26T12:30:00Z',
			},
		});

		expect(emitJson.mock.calls[0][0].request.sessionId).toBe('session_123');
	});
});

describe('streamApprovalExpiredUacV1', () => {
	it('emits expired event with correct kind', () => {
		const emitJson = vi.fn();

		streamApprovalExpiredUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			requestId: 'req_expired',
			kind: 'tool_approval',
			sessionId: 'sess_1',
		});

		const chunk = emitJson.mock.calls[0][0];
		expect(chunk.schema).toBe('n8n.approval.v1');
		expect(chunk.event).toBe('expired');
		expect(chunk.request.id).toBe('req_expired');
		expect(chunk.request.kind).toBe('tool_approval');
		expect(chunk.request.sessionId).toBe('sess_1');
		expect(chunk.timestamp).toBeDefined();
	});

	it('supports user_question kind', () => {
		const emitJson = vi.fn();

		streamApprovalExpiredUacV1({
			config: createStreamingConfig(),
			stream: vi.fn(),
			emitJson,
			formatMarker: vi.fn(),
			requestId: 'req_q_expired',
			kind: 'user_question',
			sessionId: 'sess_q',
		});

		expect(emitJson.mock.calls[0][0].request.kind).toBe('user_question');
	});
});
