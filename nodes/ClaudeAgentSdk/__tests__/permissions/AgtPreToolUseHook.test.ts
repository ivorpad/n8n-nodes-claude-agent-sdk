/**
 * AGT PreToolUse Hook Tests
 *
 * Verifies the hook wraps an AgtEvaluator and emits SDK-shaped
 * PreToolUse responses for allow / deny / ask decisions.
 */

import { describe, it, expect } from 'vitest';
import { buildAgtPreToolUseHook } from '../../permissions/AgtPreToolUseHook';
import { createAgtEvaluator } from '../../permissions/AgtGovernance';
import type { AgtGovernanceConfig } from '../../permissions/types';

function makeConfig(overrides: Partial<AgtGovernanceConfig> = {}): AgtGovernanceConfig {
	return {
		enabled: true,
		defaultAction: 'allow',
		conflictStrategy: 'priorityFirstMatch',
		rules: [],
		...overrides,
	};
}

const ctx = { workflowId: 'wf-1', nodeName: 'TestNode', sessionId: 'sess-1' };

async function callHook(
	hookRecord: ReturnType<typeof buildAgtPreToolUseHook>,
	toolName: string,
	toolInput: Record<string, unknown>,
) {
	const matchers = hookRecord.PreToolUse;
	if (!matchers || matchers.length === 0) throw new Error('no PreToolUse matcher');
	const fn = matchers[0].hooks[0];
	return await fn(
		{
			session_id: 'sess',
			transcript_path: '',
			cwd: '.',
			hook_event_name: 'PreToolUse',
			tool_name: toolName,
			tool_input: toolInput,
			tool_use_id: 'tu_1',
		} as never,
		'tu_1',
		{ signal: new AbortController().signal } as never,
	);
}

describe('buildAgtPreToolUseHook', () => {
it('returns a neutral hook result when AGT allows', async () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'allow',
		}), ctx);
		const hook = buildAgtPreToolUseHook(evaluator);
		const result = await callHook(hook, 'Read', { file_path: '/x' });
		expect(result).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
			},
		});
	});

	it('returns deny when AGT denies', async () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'allow',
			rules: [{
				name: 'deny-bash',
				tools: ['Bash'],
				decision: 'deny',
				priority: 100,
			}],
		}), ctx);
		const hook = buildAgtPreToolUseHook(evaluator);
		const result = await callHook(hook, 'Bash', { command: 'ls' });
		expect(result).toMatchObject({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
			},
		});
		const reason = (result as { hookSpecificOutput: { permissionDecisionReason?: string } })
			.hookSpecificOutput.permissionDecisionReason;
		expect(reason).toContain('deny-bash');
	});

	it('denies when AGT requires approval (hook cannot pause for HITL)', async () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'allow',
			rules: [{
				name: 'approve-write',
				tools: ['Write'],
				decision: 'require_approval',
				priority: 100,
				approvers: ['ops@co.com'],
			}],
		}), ctx);
		const hook = buildAgtPreToolUseHook(evaluator);
		const result = await callHook(hook, 'Write', { file_path: '/x', content: 'y' });
		expect(result).toMatchObject({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
			},
		});
		const reason = (result as { hookSpecificOutput: { permissionDecisionReason?: string } })
			.hookSpecificOutput.permissionDecisionReason;
		expect(reason).toContain('Manual approval');
		expect(reason).toContain('ops@co.com');
	});

	it('blocks numeric conditions (refund amount >= 500)', async () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'allow',
			rules: [{
				name: 'block-large-refunds',
				tools: ['process_refund'],
				decision: 'deny',
				priority: 300,
				conditions: {
					conditions: [{
						leftValue: 'amount',
						rightValue: { value: '500' },
						operator: { operation: 'gte' },
					}],
					combinator: 'and',
				},
			}],
		}), ctx);
		const hook = buildAgtPreToolUseHook(evaluator);

		// 750 → deny
		const denied = await callHook(hook, 'process_refund', { amount: 750, order_id: 'X' });
		expect(denied).toMatchObject({
			hookSpecificOutput: { permissionDecision: 'deny' },
		});

		// 25 → allow
		const allowed = await callHook(hook, 'process_refund', { amount: 25, order_id: 'Y' });
		expect(allowed).toEqual({
			hookSpecificOutput: { hookEventName: 'PreToolUse' },
		});
	});

	it('handles nested input.amount path (n8n MCP-bridged tools)', async () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'allow',
			rules: [{
				name: 'block-large-refunds',
				tools: ['mcp__n8n_tools__n8n_tool__process_refund'],
				decision: 'deny',
				priority: 300,
				conditions: {
					conditions: [{
						leftValue: 'input.amount',
						rightValue: { value: '500' },
						operator: { operation: 'gte' },
					}],
					combinator: 'and',
				},
			}],
		}), ctx);
		const hook = buildAgtPreToolUseHook(evaluator);

		const denied = await callHook(
			hook,
			'mcp__n8n_tools__n8n_tool__process_refund',
			{ input: { amount: 750, order_id: 'X' } },
		);
		expect(denied).toMatchObject({
			hookSpecificOutput: { permissionDecision: 'deny' },
		});
	});

	it('rate limits subsequent calls (proves evaluator state is shared across hook invocations)', async () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'deny',
			rules: [{
				name: 'limited-read',
				tools: ['Read'],
				decision: 'allow',
				priority: 100,
				limit: '2/minute',
			}],
		}), ctx);
		const hook = buildAgtPreToolUseHook(evaluator);

		const r1 = await callHook(hook, 'Read', { file_path: '/a' });
		const r2 = await callHook(hook, 'Read', { file_path: '/b' });
		const r3 = await callHook(hook, 'Read', { file_path: '/c' });

		expect(r1).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
		expect(r2).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
		expect(r3).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
	});
});
