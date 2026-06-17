import { describe, expect, it } from 'vitest';

import {
	buildChannelReplyDecisionId,
	buildChannelReplyDecisionKey,
	buildChannelReplyPendingEnvelope,
	buildQuestionAnswersFromSelections,
	CHANNEL_REPLY_CONTRACT_VERSION,
	parseReplyToken,
} from '../../../ClaudeAgentChannelShared/core/channelReplyContract';

describe('Channel Reply Resume contract', () => {
	it('builds question answers from selected labels and free text', () => {
		const answers = buildQuestionAnswersFromSelections([
			{
				question: 'How should I format the output?',
				selectedLabels: ['Summary'],
			},
			{
				question: 'Which sections should I include?',
				selectedLabels: ['Introduction', 'Conclusion'],
			},
			{
				question: 'Any custom note?',
				freeText: 'Use concise language',
			},
		]);

		expect(answers).toEqual({
			'How should I format the output?': 'Summary',
			'Which sections should I include?': 'Introduction, Conclusion',
			'Any custom note?': 'Use concise language',
		});
	});

	it('creates stable decision keys for identical question answers', () => {
		const first = buildChannelReplyDecisionKey({
			kind: 'question',
			decisionType: 'answers',
			answers: {
				B: 'two',
				A: 'one',
			},
		});
		const second = buildChannelReplyDecisionKey({
			kind: 'question',
			decisionType: 'answers',
			answers: {
				A: 'one',
				B: 'two',
			},
		});

		expect(first).toBe(second);
		expect(first.startsWith('question:')).toBe(true);
	});

	it('distinguishes question decision keys by responseAction when provided', () => {
		const resumeKey = buildChannelReplyDecisionKey({
			kind: 'question',
			decisionType: 'answers',
			answers: { Review: 'Looks good' },
			responseAction: 'resume',
		});
		const completeKey = buildChannelReplyDecisionKey({
			kind: 'question',
			decisionType: 'answers',
			answers: { Review: 'Looks good' },
			responseAction: 'complete',
		});

		expect(resumeKey).not.toBe(completeKey);
	});

	it('keeps question decision keys stable when answers contain string arrays', () => {
		const first = buildChannelReplyDecisionKey({
			kind: 'question',
			decisionType: 'answers',
			answers: {
				Review: ['Looks good', 'Ship it'],
				Format: 'Summary',
			},
			responseAction: 'resume',
		});
		const second = buildChannelReplyDecisionKey({
			kind: 'question',
			decisionType: 'answers',
			answers: {
				Format: 'Summary',
				Review: ['Looks good', 'Ship it'],
			},
			responseAction: 'resume',
		});

		expect(first).toBe(second);
		expect(first.startsWith('question:')).toBe(true);
	});

	it('creates approval decision keys and deterministic decision IDs', () => {
		const approvedKey = buildChannelReplyDecisionKey({
			kind: 'approval',
			decisionType: 'approve',
			approved: true,
		});
		const deniedKey = buildChannelReplyDecisionKey({
			kind: 'approval',
			decisionType: 'deny',
			approved: false,
		});

		expect(approvedKey).toBe('approval:approved');
		expect(deniedKey).toBe('approval:denied');

		const decisionId = buildChannelReplyDecisionId('req_123', approvedKey);
		expect(decisionId).toMatch(/^req_123:[a-f0-9]{24}$/);
	});

	it('parses approval and question reply tokens', () => {
		expect(parseReplyToken('hitl|approve|req_123|tool:Write')).toEqual({
			requestId: 'req_123',
			approved: true,
			fingerprint: 'tool:Write',
		});
		expect(parseReplyToken('hitl|q|req_123|0|2')).toEqual({
			requestId: 'req_123',
			questionIndex: 0,
			optionIndex: 2,
		});
		expect(parseReplyToken('invalid')).toBeUndefined();
	});

	it('builds a channel-agnostic pending envelope', () => {
		const envelope = buildChannelReplyPendingEnvelope({
			requestId: 'req_whatsapp_1',
			kind: 'approval',
			channel: 'whatsapp',
			message: 'Approve deployment?',
			resume: {
				sessionId: 'session_123',
				approvedFingerprints: 'fp_bundle',
				fingerprint: 'tool:Bash:hash',
			},
			routing: {
				recipientId: '+34696169382',
				templateName: 'claude_hitl_approval',
				templateLocale: 'en_US',
				providerMetadata: {
					phone_number_id: '880386175156713',
				},
			},
		});

		expect(envelope.version).toBe(CHANNEL_REPLY_CONTRACT_VERSION);
		expect(envelope.channel).toBe('whatsapp');
		expect(envelope.resume.sessionId).toBe('session_123');
		expect(envelope.routing.templateName).toBe('claude_hitl_approval');
		expect(envelope.routing.providerMetadata?.phone_number_id).toBe('880386175156713');
	});
});
