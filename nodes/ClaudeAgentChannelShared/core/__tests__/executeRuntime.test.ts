import { describe, expect, it } from 'vitest';

import {
	HITL_CONTRACT_VERSION,
	type HitlQuestionRequestEnvelope,
} from '../../../ClaudeAgentSdk/hitl/contract';
import { buildPendingRecordFromRequest } from '../executeRuntime';

describe('buildPendingRecordFromRequest', () => {
	it('persists compact agent sdk context for downstream observability', () => {
		const request: HitlQuestionRequestEnvelope = {
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_1',
			sessionId: 'session_1',
			message: 'What should I do next?',
			questions: [{ question: 'Next step?' }],
			agent_sdk_result: {
				summary: 'Fetched FastAPI docs',
				sessionId: 'session_1',
				chatSessionId: 'chat_1',
				isResumedSession: true,
				toolCalls: [{ tool: 'skill__read_github', input: { repo: 'fastapi/fastapi' } }],
				observability: {
					summary: {
						mode: 'summary',
						eventCount: 4,
						droppedEvents: 0,
						truncated: false,
						approxBytes: 1024,
						eventsByType: { 'tool.call.detected': 1 },
					},
					events: [
						{
							eventType: 'tool.call.detected',
							payload: { input: { repo: 'fastapi/fastapi' } },
						},
					],
				},
				usage: {
					totalCostUsd: 0.01,
					numTurns: 2,
				},
				messages: [{ type: 'assistant', text: 'ignored from stored context' }],
			},
		};

		const record = buildPendingRecordFromRequest(request, 0);
		expect(record.agentSdkResult).toBeDefined();

		const stored = record.agentSdkResult as Record<string, unknown>;
		expect(stored.summary).toBe('Fetched FastAPI docs');
		expect(stored.sessionId).toBe('session_1');
		expect(stored.chatSessionId).toBe('chat_1');
		expect(stored.isResumedSession).toBe(true);
		expect(stored.toolCallCount).toBe(1);
		expect(stored).toHaveProperty('toolCalls');
		expect(stored).toHaveProperty('observabilitySummary');
		expect(stored).toHaveProperty('usage');
		expect(stored).not.toHaveProperty('messages');
	});

	it('caps stored tool call/event samples while preserving total counts', () => {
		const toolCalls = Array.from({ length: 57 }, (_value, index) => ({
			tool: `tool_${index}`,
			input: { text: 'x'.repeat(1600), index },
		}));

		const observabilityEvents = Array.from({ length: 24 }, (_value, index) => ({
			eventType: `event_${index}`,
			payload: { details: 'y'.repeat(1700) },
		}));

		const request: HitlQuestionRequestEnvelope = {
			version: HITL_CONTRACT_VERSION,
			type: 'question_request',
			requestId: 'req_2',
			message: 'Next?',
			questions: [{ question: 'Continue?' }],
			agent_sdk_result: {
				toolCalls,
				observability: { events: observabilityEvents },
			},
		};

		const record = buildPendingRecordFromRequest(request, 0);
		const stored = record.agentSdkResult as Record<string, unknown>;
		const storedToolCalls = stored.toolCalls as Array<Record<string, unknown>>;
		const storedEvents = stored.observabilityEventsSample as Array<Record<string, unknown>>;

		expect(stored.toolCallCount).toBe(57);
		expect(stored.toolCallsTruncated).toBe(7);
		expect(storedToolCalls).toHaveLength(50);

		expect(stored.observabilityEventCount).toBe(24);
		expect(storedEvents).toHaveLength(10);

		const firstInput = storedToolCalls[0].input as Record<string, unknown>;
		const firstInputText = firstInput.text as string;
		expect(typeof firstInputText).toBe('string');
		expect(firstInputText.length).toBeLessThanOrEqual(1027);
	});
});

