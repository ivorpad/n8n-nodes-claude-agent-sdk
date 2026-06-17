/**
 * HITL contract — regression tests for edge cases
 *
 * Covers normalizeAnswers and buildEngineHitlResponseEnvelope
 * strict-envelope behavior.
 */

import { describe, expect, it } from 'vitest';

import {
	parseHitlResponseEnvelope,
	parseHitlRequestEnvelope,
	parseStrictHitlRequestEnvelope,
	buildEngineHitlResponseEnvelope,
	buildHitlApprovalResponseEnvelope,
	buildHitlQuestionResponseEnvelope,
	HITL_CONTRACT_VERSION,
} from '../../hitl/contract';

describe('parseHitlResponseEnvelope — edge cases', () => {
	it('rejects non-object payload', () => {
		expect(parseHitlResponseEnvelope(null).ok).toBe(false);
		expect(parseHitlResponseEnvelope('string').ok).toBe(false);
		expect(parseHitlResponseEnvelope(42).ok).toBe(false);
		expect(parseHitlResponseEnvelope([]).ok).toBe(false);
	});

	it('rejects missing version', () => {
		const result = parseHitlResponseEnvelope({
			type: 'approval_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			approved: true,
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error).toContain('version');
	});

	it('rejects wrong version', () => {
		const result = parseHitlResponseEnvelope({
			version: '2.0',
			type: 'approval_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			approved: true,
		});
		expect(result.ok).toBe(false);
	});

	it('rejects missing requestId', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'approval_response',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			approved: true,
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error).toContain('requestId');
	});

	it('rejects invalid decidedAt', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'approval_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: 'not-a-date',
			channel: 'webhook',
			approved: true,
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error).toContain('decidedAt');
	});

	it('rejects approval_response without boolean approved', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'approval_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			approved: 'yes', // should be boolean
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error).toContain('approved');
	});

	it('rejects question_response with empty answers', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			answers: {},
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error).toContain('answers');
	});

	it('normalizes number and boolean answer values to strings', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			answers: { count: 42, flag: true, name: 'test' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const answers = (result.value as any).answers;
			expect(answers.count).toBe('42');
			expect(answers.flag).toBe('true');
			expect(answers.name).toBe('test');
		}
	});

	it('normalizes null answer values to empty string', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			answers: { empty: null },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as any).answers.empty).toBe('');
		}
	});

	it('preserves array answers', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			answers: { colors: ['red', 'blue'] },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as any).answers.colors).toEqual(['red', 'blue']);
		}
	});

	it('accepts question_response with responseAction=complete', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_response',
			requestId: 'req_terminal',
			decisionId: 'dec_terminal',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			answers: { 'Revisión': 'Está bien' },
			responseAction: 'complete',
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as any).responseAction).toBe('complete');
		}
	});

	it('rejects answers with object values', () => {
		const result = parseHitlResponseEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'webhook',
			answers: { nested: { a: 1 } },
		});
		expect(result.ok).toBe(false);
	});
});

describe('parseHitlRequestEnvelope — edge cases', () => {
	it('accepts request without version (non-strict)', () => {
		const result = parseHitlRequestEnvelope({
			type: 'approval_request',
			requestId: 'req_1',
		});
		expect(result.ok).toBe(true);
	});

	it('strict mode rejects request without version', () => {
		const result = parseStrictHitlRequestEnvelope({
			type: 'approval_request',
			requestId: 'req_1',
		});
		expect(result.ok).toBe(false);
	});

	it('rejects question_request with malformed questions', () => {
		const result = parseHitlRequestEnvelope({
			type: 'question_request',
			requestId: 'req_1',
			questions: [{ notAQuestion: true }], // missing 'question' field
		});
		expect(result.ok).toBe(false);
	});

	it('accepts question_request with valid questions', () => {
		const result = parseHitlRequestEnvelope({
			type: 'question_request',
			requestId: 'req_1',
			questions: [
				{
					question: 'What color?',
					header: 'Color',
					options: [{ label: 'Red' }],
					multiSelect: false,
				},
			],
		});
		expect(result.ok).toBe(true);
	});

	it('preserves question option actions on request envelopes', () => {
		const result = parseHitlRequestEnvelope({
			type: 'question_request',
			requestId: 'req_terminal_question',
			questions: [
				{
					question: '¿Está bien?',
					header: 'Revisión',
					options: [
						{ label: 'Está bien', action: 'complete' },
						{ label: 'Modificar', action: 'resume' },
					],
					multiSelect: false,
				},
			],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as any).questions[0].options[0].action).toBe('complete');
			expect((result.value as any).questions[0].options[1].action).toBe('resume');
		}
	});

	it('preserves optional agent_sdk_result metadata on request envelopes', () => {
		const result = parseStrictHitlRequestEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_1',
			agent_sdk_result: {
				type: 'task_result',
				summary: 'Overview text',
			},
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as any).agent_sdk_result).toMatchObject({
				type: 'task_result',
				summary: 'Overview text',
			});
			expect((result.value as any).hitl_result).toMatchObject({
				type: 'task_result',
				summary: 'Overview text',
			});
		}
	});

	it('rejects legacy hitlResult alias', () => {
		const result = parseStrictHitlRequestEnvelope({
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_legacy_1',
			hitlResult: {
				type: 'task_result',
				summary: 'Legacy overview text',
			},
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error).toContain('hitlResult is not supported');
	});

	it('rejects questions with options that have no label', () => {
		const result = parseHitlRequestEnvelope({
			type: 'question_request',
			requestId: 'req_1',
			questions: [
				{
					question: 'What color?',
					options: [{ description: 'no label' }], // missing label
				},
			],
		});
		expect(result.ok).toBe(false);
	});
});

describe('buildEngineHitlResponseEnvelope', () => {
	it('passes through strict envelope when valid', () => {
		const strictPayload = {
			version: HITL_CONTRACT_VERSION,
			type: 'approval_response',
			requestId: 'req_1',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'slack',
			approved: true,
		};

		const result = buildEngineHitlResponseEnvelope({
			interactionKind: 'approval',
			requestId: 'req_1',
			rawPayload: strictPayload,
			sessionId: 'sess_1',
		});

		expect(result.type).toBe('approval_response');
		expect((result as any).approved).toBe(true);
	});

	it('throws on requestId mismatch in strict envelope', () => {
		const strictPayload = {
			version: HITL_CONTRACT_VERSION,
			type: 'approval_response',
			requestId: 'wrong_id',
			decisionId: 'dec_1',
			decidedAt: '2026-02-26T12:00:00Z',
			channel: 'slack',
			approved: true,
		};

		expect(() =>
			buildEngineHitlResponseEnvelope({
				interactionKind: 'approval',
				requestId: 'req_1',
				rawPayload: strictPayload,
				sessionId: 'sess_1',
			}),
		).toThrow(/requestId mismatch/);
	});

	it('rejects non-strict engine payloads', () => {
		expect(() =>
			buildEngineHitlResponseEnvelope({
				interactionKind: 'approval',
				requestId: 'req_1',
				rawPayload: { data: { approved: true } },
				sessionId: 'sess_1',
			}),
		).toThrow(/strict HITL v1\.0 response envelope/);
	});
});

describe('buildHitlQuestionResponseEnvelope — validation', () => {
	it('throws on empty answers', () => {
		expect(() =>
			buildHitlQuestionResponseEnvelope({
				requestId: 'req_1',
				answers: {},
				channel: 'test',
			}),
		).toThrow(/answers must be a non-empty object/);
	});
});

describe('buildHitlApprovalResponseEnvelope — defaults', () => {
	it('generates decidedAt if not provided', () => {
		const result = buildHitlApprovalResponseEnvelope({
			requestId: 'req_1',
			approved: true,
			channel: 'webhook',
		});

		expect(result.decidedAt).toBeDefined();
		expect(Date.parse(result.decidedAt)).not.toBeNaN();
	});

	it('generates decisionId if not provided', () => {
		const result = buildHitlApprovalResponseEnvelope({
			requestId: 'req_1',
			approved: true,
			channel: 'webhook',
		});

		expect(result.decisionId).toBeDefined();
		expect(result.decisionId).toContain('req_1');
	});

	it('uses provided decisionId and decidedAt', () => {
		const result = buildHitlApprovalResponseEnvelope({
			requestId: 'req_1',
			approved: false,
			channel: 'slack',
			decisionId: 'custom_dec_id',
			decidedAt: '2026-01-01T00:00:00Z',
		});

		expect(result.decisionId).toBe('custom_dec_id');
		expect(result.decidedAt).toBe('2026-01-01T00:00:00Z');
	});
});
