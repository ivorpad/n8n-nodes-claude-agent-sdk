import { describe, it, expect } from 'vitest';
import { createManagedEventMapper } from '../../managedAgent/eventMapper';
import type { ManagedAgentRawEvent } from '../../managedAgent/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createManagedEventMapper', () => {
	const sessionId = 'sesn_test123';
	const mapper = () => createManagedEventMapper(sessionId);

	it('maps agent.message to a canonical SDKAssistantMessage', () => {
		const event: ManagedAgentRawEvent = {
			type: 'agent.message',
			id: 'evt_message_123',
			processed_at: '2026-04-16T12:00:00Z',
			content: [{ type: 'text', text: 'Hello world' }],
		};
		const result = mapper().map(event);
		expect(result).toHaveLength(1);
		const msg = result[0];
		expect(msg.type).toBe('assistant');
		if (msg.type !== 'assistant') return;
		expect(msg.message.content).toEqual([
			{ type: 'text', text: 'Hello world', citations: null },
		]);
		expect(msg.message.role).toBe('assistant');
		expect(msg.message.id).toBe('evt_message_123');
		expect(msg.parent_tool_use_id).toBeNull();
		expect(msg.uuid).toMatch(UUID_RE);
		expect(msg.session_id).toBe(sessionId);
		expect(msg._raw).toBe(event);
	});

	it('skips agent.message with empty content', () => {
		const event: ManagedAgentRawEvent = {
			type: 'agent.message',
			id: 'evt_message_124',
			processed_at: '2026-04-16T12:00:01Z',
			content: [],
		};
		expect(mapper().map(event)).toHaveLength(0);
	});

	it('drops agent.thinking (event carries no thinking text; no canonical frame to emit)', () => {
		const event: ManagedAgentRawEvent = {
			type: 'agent.thinking',
			id: 'evt_thinking_123',
			processed_at: '2026-04-16T12:00:02Z',
		};
		expect(mapper().map(event)).toHaveLength(0);
	});

	it('maps agent.tool_use to assistant message with tool_use content block', () => {
		const event: ManagedAgentRawEvent = {
			type: 'agent.tool_use',
			id: 'sevt_tool_use_123',
			processed_at: '2026-04-16T12:00:03Z',
			name: 'bash',
			input: { command: 'ls -la' },
		};
		const result = mapper().map(event);
		expect(result).toHaveLength(1);
		const msg = result[0];
		expect(msg.type).toBe('assistant');
		if (msg.type !== 'assistant') return;
		const content = msg.message.content as Array<{ type: string; id: string; name: string; input: unknown }>;
		expect(content[0].type).toBe('tool_use');
		expect(content[0].id).toBe('sevt_tool_use_123');
		expect(content[0].name).toBe('bash');
		expect(content[0].input).toEqual({ command: 'ls -la' });
	});

	it('accumulates span.model_request_end usage onto the terminal result instead of emitting frames', () => {
		const m = mapper();
		expect(
			m.map({
				type: 'span.model_request_end',
				id: 'evt_usage_123',
				processed_at: '2026-04-16T12:00:04Z',
				model_usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 10,
					cache_creation_input_tokens: 5,
					speed: 'fast',
				},
			} as ManagedAgentRawEvent),
		).toHaveLength(0);
		expect(
			m.map({
				type: 'span.model_request_end',
				id: 'evt_usage_124',
				processed_at: '2026-04-16T12:00:05Z',
				model_usage: {
					input_tokens: 20,
					output_tokens: 30,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
					speed: 'standard',
				},
			} as ManagedAgentRawEvent),
		).toHaveLength(0);

		const result = m.map({
			type: 'session.status_idle',
			id: 'evt_idle_123',
			processed_at: '2026-04-16T12:00:06Z',
			stop_reason: { type: 'end_turn' },
		} as ManagedAgentRawEvent);
		expect(result).toHaveLength(1);
		const terminal = result[0];
		expect(terminal.type).toBe('result');
		if (terminal.type !== 'result' || terminal.subtype !== 'success') return;
		expect(terminal.usage.input_tokens).toBe(120);
		expect(terminal.usage.output_tokens).toBe(80);
		expect(terminal.usage.cache_read_input_tokens).toBe(10);
		expect(terminal.usage.cache_creation_input_tokens).toBe(5);
		expect(terminal.usage.speed).toBe('fast');
		expect(terminal.num_turns).toBe(2);
	});

	it('maps session.status_idle end_turn to a canonical SDKResultSuccess', () => {
		const result = mapper().map({
			type: 'session.status_idle',
			id: 'evt_idle_123',
			processed_at: '2026-04-16T12:00:05Z',
			stop_reason: { type: 'end_turn' },
		} as ManagedAgentRawEvent);
		expect(result).toHaveLength(1);
		const msg = result[0];
		expect(msg.type).toBe('result');
		if (msg.type !== 'result' || msg.subtype !== 'success') return;
		expect(msg.is_error).toBe(false);
		expect(msg.stop_reason).toBe('end_turn');
		expect(msg.result).toBe('');
		expect(msg.permission_denials).toEqual([]);
		expect(msg.modelUsage).toEqual({});
		expect(msg.total_cost_usd).toBe(0);
		expect(msg.uuid).toMatch(UUID_RE);
		expect(msg.session_id).toBe(sessionId);
	});

	it('maps requires_action to placeholder + canonical result with TOP-LEVEL stop_reason', () => {
		const event = {
			type: 'session.status_idle',
			id: 'evt_idle_124',
			processed_at: '2026-04-16T12:00:06Z',
			stop_reason: { type: 'requires_action', event_ids: ['evt_001', 'evt_002'] },
		} as ManagedAgentRawEvent;
		const result = mapper().map(event);
		expect(result).toHaveLength(2);

		// 1. Visible assistant placeholder so the chat renders something
		const placeholder = result[0];
		expect(placeholder.type).toBe('assistant');
		if (placeholder.type === 'assistant') {
			const content = placeholder.message.content as Array<{ type: string; text: string }>;
			expect(content[0].type).toBe('text');
			expect(content[0].text.toLowerCase()).toContain('waiting');
		}

		// 2. Terminal result so downstream processor doesn't hang. The pause
		// marker is top-level stop_reason (canonical), no nested message copy;
		// event_ids stay available via _raw.
		const terminal = result[1];
		expect(terminal.type).toBe('result');
		if (terminal.type !== 'result') return;
		expect(terminal.subtype).toBe('success');
		expect(terminal.stop_reason).toBe('requires_action');
		expect('_raw' in terminal && terminal._raw).toBe(event);
	});

	it('maps agent.custom_tool_use to assistant tool_use block (e.g. ask_user_question)', () => {
		const result = mapper().map({
			type: 'agent.custom_tool_use',
			id: 'sevt_01FXUxaquBGaqjxvSVCEsSNf',
			processed_at: '2026-04-16T12:00:07Z',
			name: 'ask_user_question',
			input: { question: 'What is your favourite colour?', options: ['red', 'blue'] },
		} as ManagedAgentRawEvent);
		expect(result).toHaveLength(1);
		const msg = result[0];
		expect(msg.type).toBe('assistant');
		if (msg.type !== 'assistant') return;
		const content = msg.message.content as Array<{ type: string; id: string; name: string }>;
		expect(content[0].type).toBe('tool_use');
		expect(content[0].id).toBe('sevt_01FXUxaquBGaqjxvSVCEsSNf');
		expect(content[0].name).toBe('ask_user_question');
	});

	it('drops tool_use events that arrive without an id (cannot correlate for HITL)', () => {
		const event = {
			type: 'agent.custom_tool_use',
			processed_at: '2026-04-16T12:00:08Z',
			name: 'ask_user_question',
			input: {},
		} satisfies Partial<ManagedAgentRawEvent> as ManagedAgentRawEvent;
		expect(mapper().map(event)).toHaveLength(0);
	});

	it('maps session.error to a canonical SDKResultError with error_during_execution', () => {
		const result = mapper().map({
			type: 'session.error',
			id: 'evt_error_123',
			processed_at: '2026-04-16T12:00:09Z',
			error: { type: 'rate_limit', message: 'Too many requests' },
		} as ManagedAgentRawEvent);
		expect(result).toHaveLength(1);
		const msg = result[0];
		expect(msg.type).toBe('result');
		if (msg.type !== 'result' || msg.subtype === 'success') return;
		expect(msg.subtype).toBe('error_during_execution');
		expect(msg.is_error).toBe(true);
		expect(msg.errors).toEqual(['rate_limit: Too many requests']);
		expect(msg.stop_reason).toBeNull();
		expect(msg.uuid).toMatch(UUID_RE);
	});

	it('maps session.status_terminated to a canonical SDKResultError', () => {
		const result = mapper().map({
			type: 'session.status_terminated',
			id: 'evt_term_123',
			processed_at: '2026-04-16T12:00:10Z',
		} as ManagedAgentRawEvent);
		expect(result).toHaveLength(1);
		const msg = result[0];
		expect(msg.type).toBe('result');
		if (msg.type !== 'result' || msg.subtype === 'success') return;
		expect(msg.subtype).toBe('error_during_execution');
		expect(msg.is_error).toBe(true);
		expect(msg.stop_reason).toBe('terminated');
	});

	it('returns empty for status-only events', () => {
		const m = mapper();
		expect(
			m.map({ type: 'session.status_running', id: 'evt_running_123', processed_at: '2026-04-16T12:00:10Z' } as ManagedAgentRawEvent),
		).toHaveLength(0);
		expect(
			m.map({ type: 'span.model_request_start', id: 'evt_model_start_123', processed_at: '2026-04-16T12:00:11Z' } as ManagedAgentRawEvent),
		).toHaveLength(0);
		expect(
			m.map({ type: 'user.message', id: 'evt_user_message_123', processed_at: '2026-04-16T12:00:12Z' } as ManagedAgentRawEvent),
		).toHaveLength(0);
	});
});
