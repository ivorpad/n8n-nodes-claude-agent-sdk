import { describe, it, expect, vi } from 'vitest';

import { decodeManagedRequestId, injectManagedHitlInteraction } from '../../managedAgent/hitlBridge';
import { wireManagedResumeToolConfirmation } from '../../operations/executeTask/steps/sessionResolve';
import { createRuntimePendingState } from '../../operations/executeTask/hitlRuntimeState';

const SESSION_ID = 'sesn_test_123';
const EXEC_ID = 'exec_42';
const TOOL_USE_ID = 'sevt_01FXUxaquBGaqjxvSVCEsSNf';
const STREAM_KEY = 'stream:42:0';

function makeToolUseMsg(
	id: string,
	name: string,
	input: Record<string, unknown>,
	eventType: 'agent.custom_tool_use' | 'agent.tool_use' | 'agent.mcp_tool_use' = 'agent.custom_tool_use',
	extras: Record<string, unknown> = {},
) {
	return {
		type: 'assistant',
		message: {
			role: 'assistant',
			content: [{ type: 'tool_use', id, name, input }],
		},
		session_id: SESSION_ID,
		_raw: {
			type: eventType,
			id,
			name,
			input,
			processed_at: '2026-06-12T10:00:00Z',
			...extras,
		},
	};
}

// Canonical SDKResultSuccess carries stop_reason TOP-LEVEL (the nested
// message.stop_reason copy died with the eventMapper canonicalization).
function makeRequiresActionResult() {
	return {
		type: 'result',
		subtype: 'success',
		session_id: SESSION_ID,
		stop_reason: 'requires_action',
		_raw: {
			type: 'session.status_idle',
			id: 'evt_idle_requires_action',
			processed_at: '2026-06-12T10:00:01Z',
			stop_reason: { type: 'requires_action', event_ids: [TOOL_USE_ID] },
		},
	};
}

function makeEndTurnResult() {
	return {
		type: 'result',
		subtype: 'success',
		session_id: SESSION_ID,
		stop_reason: 'end_turn',
	};
}

describe('injectManagedHitlInteraction', () => {
	it('returns null when stream ends with end_turn (no HITL pause)', () => {
		const state = createRuntimePendingState();
		const result = injectManagedHitlInteraction({
			messages: [makeEndTurnResult()] as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
			executionId: EXEC_ID,
		});
		expect(result).toBeNull();
		expect(state.getPendingForExecution(EXEC_ID)).toHaveLength(0);
	});

	it('returns null when messages array is empty', () => {
		const state = createRuntimePendingState();
		const result = injectManagedHitlInteraction({
			messages: [] as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
		});
		expect(result).toBeNull();
	});

	it('injects a question interaction for ask_user_question and returns metadata', () => {
		const state = createRuntimePendingState();
		const messages = [
			makeToolUseMsg(TOOL_USE_ID, 'ask_user_question', {
				question: 'What is your favourite colour?',
				header: 'Quick poll',
				options: [
					{ label: 'Red', value: 'red' },
					{ label: 'Blue', value: 'blue' },
				],
				multi_select: false,
			}),
			makeRequiresActionResult(),
		];

		const result = injectManagedHitlInteraction({
			messages: messages as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
			executionId: EXEC_ID,
			streamKey: STREAM_KEY,
			taskDescription: 'test task',
			timeoutMs: 60_000,
		});

		expect(result).not.toBeNull();
		expect(result!.managedSessionId).toBe(SESSION_ID);
		expect(result!.customToolUseId).toBe(TOOL_USE_ID);

		const pending = state.getPendingForExecution(EXEC_ID);
		expect(pending).toHaveLength(1);
		expect(pending[0].kind).toBe('question');
		expect(pending[0].requestId).toBe(`managed_hitl_${TOOL_USE_ID}`);
		expect(pending[0].sessionId).toBe(SESSION_ID);
		expect(pending[0].executionId).toBe(EXEC_ID);
		expect(pending[0].streamKey).toBe(STREAM_KEY);

		// Decode questions from base64
		const questionsJson = Buffer.from(pending[0].questionsBase64!, 'base64').toString('utf-8');
		const questions = JSON.parse(questionsJson);
		expect(questions).toHaveLength(1);
		expect(questions[0].question).toBe('What is your favourite colour?');
		expect(questions[0].header).toBe('Quick poll');
		expect(questions[0].options).toHaveLength(2);
		expect(questions[0].options[0].label).toBe('Red');
	});

	it('handles string-only options (e.g. simple labels)', () => {
		const state = createRuntimePendingState();
		const messages = [
			makeToolUseMsg(TOOL_USE_ID, 'ask_user_question', {
				question: 'Pick one',
				options: ['A', 'B', 'C'],
			}),
			makeRequiresActionResult(),
		];

		const result = injectManagedHitlInteraction({
			messages: messages as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
			executionId: EXEC_ID,
		});

		expect(result).not.toBeNull();
		const pending = state.getPendingForExecution(EXEC_ID);
		const questions = JSON.parse(
			Buffer.from(pending[0].questionsBase64!, 'base64').toString('utf-8'),
		);
		expect(questions[0].options).toEqual([
			{ label: 'A', action: 'resume' },
			{ label: 'B', action: 'resume' },
			{ label: 'C', action: 'resume' },
		]);
	});

	it('returns null when requires_action but no tool_use in the stream', () => {
		const state = createRuntimePendingState();
		const messages = [
			// Only text messages, no tool_use
			{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } },
			makeRequiresActionResult(),
		];

		const result = injectManagedHitlInteraction({
			messages: messages as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
			executionId: EXEC_ID,
		});

		expect(result).toBeNull();
		expect(state.getPendingForExecution(EXEC_ID)).toHaveLength(0);
	});

	it('picks the last tool_use when multiple appear before requires_action', () => {
		const state = createRuntimePendingState();
		const messages = [
			makeToolUseMsg('sevt_first', 'bash', { command: 'ls' }),
			makeToolUseMsg('sevt_second', 'ask_user_question', { question: 'Which one?' }),
			makeRequiresActionResult(),
		];

		const result = injectManagedHitlInteraction({
			messages: messages as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
			executionId: EXEC_ID,
		});

		expect(result!.customToolUseId).toBe('sevt_second');
	});

	it('injects an approval interaction for managed tool confirmation pauses', () => {
		const state = createRuntimePendingState();
		const messages = [
			makeToolUseMsg(TOOL_USE_ID, 'bash', { command: 'rm -rf tmp' }, 'agent.tool_use'),
			makeRequiresActionResult(),
		];

		const result = injectManagedHitlInteraction({
			messages: messages as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
			executionId: EXEC_ID,
			streamKey: STREAM_KEY,
			taskDescription: 'test task',
			timeoutMs: 60_000,
		});

		expect(result).toEqual({
			kind: 'tool_confirmation',
			managedSessionId: SESSION_ID,
			toolUseId: TOOL_USE_ID,
			sessionThreadId: undefined,
		});

		const pending = state.getPendingForExecution(EXEC_ID);
		expect(pending).toHaveLength(1);
		expect(pending[0].kind).toBe('approval');
		expect(pending[0].requestId).toBe(`managed_tool_confirmation_${TOOL_USE_ID}`);
		expect(pending[0].toolName).toBe('bash');
		expect(pending[0].toolInput).toEqual({ command: 'rm -rf tmp' });
	});

	it('preserves managed subagent thread routing in confirmation request IDs', () => {
		const state = createRuntimePendingState();
		const messages = [
			makeToolUseMsg(
				TOOL_USE_ID,
				'deploy',
				{ environment: 'prod' },
				'agent.mcp_tool_use',
				{ mcp_server_name: 'ops', session_thread_id: 'sthr_child' },
			),
			makeRequiresActionResult(),
		];

		const result = injectManagedHitlInteraction({
			messages: messages as never,
			sessionId: SESSION_ID,
			runtimePendingState: state,
			executionId: EXEC_ID,
		});

		expect(result?.sessionThreadId).toBe('sthr_child');
		const pending = state.getPendingForExecution(EXEC_ID);
		expect(pending[0].requestId).toMatch(/^managed_tool_confirmation_/);
		expect(decodeManagedRequestId(
			pending[0].requestId,
			'managed_tool_confirmation_',
		)).toEqual({
			toolUseId: TOOL_USE_ID,
			sessionThreadId: 'sthr_child',
		});
		expect(pending[0].toolName).toBe('ops.deploy');
	});

	it('wires managed approval responses into user.tool_confirmation options', () => {
		const queryOptions: Record<string, unknown> = {};
		wireManagedResumeToolConfirmation({
			isManagedAgent: true,
			isApprovalResume: true,
			pendingApprovalResolution: {
				kind: 'approval',
				requestId: `managed_tool_confirmation_${TOOL_USE_ID}__thread_${Buffer.from('sthr_child').toString('base64url')}`,
				approved: false,
				reviewerMessage: 'No production changes',
			},
			managedAgentResumeSessionId: undefined,
			resumeSessionId: SESSION_ID,
			queryOptions: queryOptions as never,
			observabilityCollector: { record: vi.fn() } as never,
		});

		expect(queryOptions.managedResumeWithToolConfirmation).toEqual({
			sessionId: SESSION_ID,
			toolUseId: TOOL_USE_ID,
			approved: false,
			denyMessage: 'No production changes',
			sessionThreadId: 'sthr_child',
		});
	});
});
