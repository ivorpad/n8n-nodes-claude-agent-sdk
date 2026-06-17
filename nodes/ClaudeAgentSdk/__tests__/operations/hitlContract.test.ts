import { describe, expect, it } from 'vitest';

import {
	assertHitlRequestEnvelope,
	assertStrictHitlRequestEnvelope,
	assertHitlResponseEnvelope,
	buildHitlApprovalResponseEnvelope,
	buildEngineHitlResponseEnvelope,
	buildHitlQuestionResponseEnvelope,
	parseHitlRequestEnvelope,
	parseStrictHitlRequestEnvelope,
	parseHitlResponseEnvelope,
} from '../../hitl/contract';

describe('HITL contract', () => {
	it('parses strict approval response envelope', () => {
		const parsed = parseHitlResponseEnvelope({
			version: '1.0',
			type: 'approval_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-01-01T00:00:00.000Z',
			channel: 'webhook',
			approved: true,
		});

		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.value.type).toBe('approval_response');
			expect(parsed.value.approved).toBe(true);
		}
	});

	it('rejects malformed response envelope', () => {
		expect(() => {
			assertHitlResponseEnvelope({
				version: '1.0',
				type: 'question_response',
				requestId: 'req_1',
				channel: 'webhook',
				answers: { a: 'b' },
			});
		}).toThrow(/decisionId is required/i);
	});

	it('parses strict approval request envelope', () => {
		const parsed = parseHitlRequestEnvelope({
			version: '1.0',
			type: 'approval_request',
			requestId: 'req_approval_1',
			sessionId: 'session_1',
			toolName: 'Write',
			fingerprint: 'tool:Write',
			toolInput: { file_path: '/tmp/demo.txt' },
		});

		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.value.type).toBe('approval_request');
			expect(parsed.value.requestId).toBe('req_approval_1');
		}
	});

	it('builds strict approval response envelope', () => {
		const envelope = buildHitlApprovalResponseEnvelope({
			requestId: 'req_approval_2',
			approved: true,
			channel: 'whatsapp',
			resumeSessionId: 'session_2',
			responder: {
				id: 'approver@example.com',
				source: 'header:x-auth-request-email',
				authMode: 'headerAuth',
			},
		});

		expect(envelope.version).toBe('1.0');
		expect(envelope.type).toBe('approval_response');
		expect(envelope.requestId).toBe('req_approval_2');
		expect(envelope.channel).toBe('whatsapp');
		expect(envelope.responder?.id).toBe('approver@example.com');
		expect(envelope.decisionId.length).toBeGreaterThan(0);
		expect(Number.isNaN(Date.parse(envelope.decidedAt))).toBe(false);
	});

	it('parses responder identity on strict response envelopes', () => {
		const parsed = parseHitlResponseEnvelope({
			version: '1.0',
			type: 'question_response',
			requestId: 'req_responder_1',
			decisionId: 'dec_responder_1',
			decidedAt: '2026-01-01T00:00:00.000Z',
			channel: 'webhook',
			answers: { decision: 'approved' },
			responder: {
				id: 'alice',
				source: 'basicAuth.username',
				authMode: 'basicAuth',
			},
		});

		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.value.responder).toEqual({
				id: 'alice',
				source: 'basicAuth.username',
				authMode: 'basicAuth',
			});
		}
	});

	it('builds strict question response envelope', () => {
		const envelope = buildHitlQuestionResponseEnvelope({
			requestId: 'req_question_2',
			answers: { Format: 'Summary' },
			channel: 'whatsapp',
			resumeSessionId: 'session_3',
		});

		expect(envelope.version).toBe('1.0');
		expect(envelope.type).toBe('question_response');
		expect(envelope.requestId).toBe('req_question_2');
		expect(envelope.answers).toEqual({ Format: 'Summary' });
		expect(envelope.decisionId.length).toBeGreaterThan(0);
		expect(Number.isNaN(Date.parse(envelope.decidedAt))).toBe(false);
	});

	it('rejects malformed request envelope', () => {
		expect(() => {
			assertHitlRequestEnvelope({
				type: 'question_request',
				sessionId: 'session_4',
			});
		}).toThrow(/requestId is required/i);
	});

	it('rejects strict request envelope when version is missing', () => {
		const parsed = parseStrictHitlRequestEnvelope({
			type: 'approval_request',
			requestId: 'req_approval_missing_version',
			toolName: 'Write',
		});

		expect(parsed.ok).toBe(false);
		if (!parsed.ok) {
			expect(parsed.error).toMatch(/version must be 1.0/i);
		}
	});

	it('rejects strict request envelope when requestId is missing', () => {
		expect(() => {
			assertStrictHitlRequestEnvelope({
				version: '1.0',
				type: 'question_request',
				sessionId: 'session_missing_request_id',
			});
		}).toThrow(/requestId is required/i);
	});

	it('rejects non-envelope data payloads', () => {
		expect(() => buildEngineHitlResponseEnvelope({
			interactionKind: 'approval',
			requestId: 'req_approval',
			rawPayload: { data: { approved: true } },
			actionId: 'action_123',
			sessionId: 'session_1',
			channel: 'whatsapp',
		})).toThrow(/strict HITL v1\.0 response envelope/i);
	});
});
