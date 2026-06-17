/**
 * AGT Governance Helper Tests
 *
 * Tests against the REAL @microsoft/agentmesh-sdk — no mocks.
 * Validates: DID resolution, conflict strategy mapping, filter-to-expression
 * translation, rule translation, and evaluator allow/deny/ask/rate-limit.
 */

import { describe, it, expect } from 'vitest';
import { ApplicationError } from 'n8n-workflow';
import {
	resolveAgtAgentDid,
	mapConflictStrategy,
	compileFilterCondition,
	translateRulesToPolicy,
	createAgtEvaluator,
} from '../../permissions/AgtGovernance';
import { ConflictResolutionStrategy } from '@microsoft/agentmesh-sdk';
import type { AgtGovernanceConfig } from '../../permissions/types';

// ─────────────────────────────────────────────────────────────────────────────
// resolveAgtAgentDid
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveAgtAgentDid', () => {
	it('should use configured DID when provided', () => {
		const did = resolveAgtAgentDid({
			configuredAgentDid: 'did:agentmesh:order-returns',
			workflowId: 'wf-123',
			nodeName: 'Agent',
		});
		expect(did).toBe('did:agentmesh:order-returns');
	});

	it('should trim configured DID', () => {
		const did = resolveAgtAgentDid({
			configuredAgentDid: '  did:agentmesh:test  ',
		});
		expect(did).toBe('did:agentmesh:test');
	});

	it('should derive synthetic DID when configured is blank', () => {
		const did = resolveAgtAgentDid({
			workflowId: 'wf-123',
			nodeName: 'My Agent Node',
			sessionId: 'sess-abc',
		});
		expect(did).toBe('did:n8n:claude-agent-sdk:wf-123:my-agent-node:sess-abc');
	});

	it('should fall back to executionId when sessionId is missing', () => {
		const did = resolveAgtAgentDid({
			workflowId: 'wf-1',
			nodeName: 'Node',
			executionId: 'exec-99',
		});
		expect(did).toBe('did:n8n:claude-agent-sdk:wf-1:node:exec-99');
	});

	it('should use "unknown" for missing segments', () => {
		const did = resolveAgtAgentDid({});
		expect(did).toBe('did:n8n:claude-agent-sdk:unknown:unknown:unknown');
	});

	it('should sanitise special characters in segments', () => {
		const did = resolveAgtAgentDid({
			workflowId: 'WF/123',
			nodeName: 'My Node (v2)',
			sessionId: 'sess:abc!',
		});
		expect(did).toMatch(/^did:n8n:claude-agent-sdk:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// mapConflictStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe('mapConflictStrategy', () => {
	it('should map all four strategies', () => {
		expect(mapConflictStrategy('priorityFirstMatch')).toBe(ConflictResolutionStrategy.PriorityFirstMatch);
		expect(mapConflictStrategy('denyOverrides')).toBe(ConflictResolutionStrategy.DenyOverrides);
		expect(mapConflictStrategy('allowOverrides')).toBe(ConflictResolutionStrategy.AllowOverrides);
		expect(mapConflictStrategy('mostSpecificWins')).toBe(ConflictResolutionStrategy.MostSpecificWins);
	});

	it('should throw on unknown strategy', () => {
		expect(() => mapConflictStrategy('invalid' as never)).toThrow(ApplicationError);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// compileFilterCondition
// ─────────────────────────────────────────────────────────────────────────────

describe('compileFilterCondition', () => {
	it('should return undefined for undefined filter', () => {
		expect(compileFilterCondition(undefined)).toBeUndefined();
	});

	it('should return undefined for empty conditions', () => {
		expect(compileFilterCondition({ conditions: [] })).toBeUndefined();
	});

	it('should compile equals operator', () => {
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'file_path',
				rightValue: { value: '/etc/passwd' },
				operator: { operation: 'equals' },
			}],
		});
		expect(result).toBe("file_path == '/etc/passwd'");
	});

	it('should compile notEquals operator', () => {
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'command',
				rightValue: { value: 'ls' },
				operator: { operation: 'notEquals' },
			}],
		});
		expect(result).toBe("command != 'ls'");
	});

	it('should compile gt operator with unquoted number', () => {
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '50' },
				operator: { operation: 'gt' },
			}],
		});
		expect(result).toBe('amount > 50');
	});

	it('should compile lt operator with unquoted number', () => {
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '100' },
				operator: { operation: 'lt' },
			}],
		});
		expect(result).toBe('amount < 100');
	});

	it('should compile gte and lte operators with unquoted numbers', () => {
		expect(compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '50' },
				operator: { operation: 'gte' },
			}],
		})).toBe('amount >= 50');

		expect(compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '50' },
				operator: { operation: 'lte' },
			}],
		})).toBe('amount <= 50');
	});

	it('should throw on string method operators (unsupported by AGT)', () => {
		for (const op of ['contains', 'startsWith', 'endsWith']) {
			expect(() => compileFilterCondition({
				conditions: [{
					leftValue: 'field',
					rightValue: { value: 'x' },
					operator: { operation: op },
				}],
			})).toThrow(ApplicationError);
		}
	});

	it('should join multiple conditions with "and" by default', () => {
		const result = compileFilterCondition({
			conditions: [
				{ leftValue: 'amount', rightValue: { value: '50' }, operator: { operation: 'gte' } },
				{ leftValue: 'amount', rightValue: { value: '500' }, operator: { operation: 'lt' } },
			],
		});
		expect(result).toBe('amount >= 50 and amount < 500');
	});

	it('should join with "or" when combinator is "or"', () => {
		const result = compileFilterCondition({
			combinator: 'or',
			conditions: [
				{ leftValue: 'status', rightValue: { value: 'cancelled' }, operator: { operation: 'equals' } },
				{ leftValue: 'status', rightValue: { value: 'refunded' }, operator: { operation: 'equals' } },
			],
		});
		expect(result).toBe("status == 'cancelled' or status == 'refunded'");
	});

	it('should preserve input.field left values (n8n MCP tools wrap input)', () => {
		// MCP tools bridged through n8n wrap their input under `input.<field>`,
		// so `input.amount` must be preserved verbatim, not stripped to `amount`.
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'input.amount',
				rightValue: { value: '100' },
				operator: { operation: 'gt' },
			}],
		});
		expect(result).toBe('input.amount > 100');
	});

	it('should normalise {{ $json.field }} left values', () => {
		const result = compileFilterCondition({
			conditions: [{
				leftValue: '{{ $json.command }}',
				rightValue: { value: 'test' },
				operator: { operation: 'equals' },
			}],
		});
		expect(result).toBe("command == 'test'");
	});

	it('should throw on unsupported operator', () => {
		expect(() => compileFilterCondition({
			conditions: [{
				leftValue: 'field',
				rightValue: { value: 'x' },
				operator: { operation: 'regex' },
			}],
		})).toThrow(ApplicationError);
		expect(() => compileFilterCondition({
			conditions: [{
				leftValue: 'field',
				rightValue: { value: 'x' },
				operator: { operation: 'regex' },
			}],
		})).toThrow('unsupported operator');
	});

	it('should accept dot-path left values like input.amount', () => {
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'input.amount',
				rightValue: { value: '500' },
				operator: { operation: 'gte' },
			}],
		});
		expect(result).toBe('input.amount >= 500');
	});

	it('should skip conditions with empty leftValue (instead of throwing)', () => {
		// UI-edit drop case: rule saved without a leftValue.
		// Compiler tolerates it and returns undefined so the rule still
		// applies on tool name alone.
		const result = compileFilterCondition({
			conditions: [{
				leftValue: '',
				rightValue: { value: 'x' },
				operator: { operation: 'equals' },
			}],
		});
		expect(result).toBeUndefined();
	});

	// ───────────────────────────────────────────────────────────────────────
	// V13: expression-breakout hardening (right-value quoting)
	// ───────────────────────────────────────────────────────────────────────

	it('should escape backslashes before quotes so a trailing backslash cannot break out (V13)', () => {
		// A value ending in `\` must NOT escape the closing single-quote of the
		// generated expression literal. The backslash itself must be escaped first.
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'command',
				rightValue: { value: 'rm -rf \\' },
				operator: { operation: 'equals' },
			}],
		});
		// Literal value content is `rm -rf \\` (one real backslash escaped); the
		// trailing `\\'` is escaped-backslash + closing quote, NOT an escaped quote.
		expect(result).toBe("command == 'rm -rf \\\\'");
	});

	it("should escape embedded single-quotes safely (V13)", () => {
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'name',
				rightValue: { value: "O'Brien" },
				operator: { operation: 'equals' },
			}],
		});
		expect(result).toBe("name == 'O\\'Brien'");
	});

	it("should not allow a backslash+quote payload to inject extra clauses (V13)", () => {
		// Classic breakout attempt: value tries to close the quote and append
		// `or 1==1`. With backslash-first escaping the quote stays escaped.
		const payload = "x\\' or '1'=='1";
		const result = compileFilterCondition({
			conditions: [{
				leftValue: 'field',
				rightValue: { value: payload },
				operator: { operation: 'equals' },
			}],
		});
		expect(result).toBe("field == 'x\\\\\\' or \\'1\\'==\\'1'");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// translateRulesToPolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('translateRulesToPolicy', () => {
	it('should translate a single-tool rule', () => {
		const policy = translateRulesToPolicy({
			policyName: 'test-policy',
			defaultAction: 'deny',
			rows: [{
				name: 'allow-read',
				tools: ['Read'],
				decision: 'allow',
				priority: 100,
			}],
		});

		expect(policy.name).toBe('test-policy');
		expect(policy.default_action).toBe('deny');
		expect(policy.rules).toHaveLength(1);
		expect(policy.rules[0].condition).toBe("action == 'Read'");
		expect(policy.rules[0].ruleAction).toBe('allow');
	});

	it('should translate a multi-tool rule', () => {
		const policy = translateRulesToPolicy({
			policyName: 'test',
			defaultAction: 'deny',
			rows: [{
				name: 'allow-reads',
				tools: ['Read', 'Glob', 'Grep'],
				decision: 'allow',
				priority: 100,
			}],
		});

		expect(policy.rules[0].condition).toBe("action in ['Read', 'Glob', 'Grep']");
	});

	it('should append filter conditions', () => {
		const policy = translateRulesToPolicy({
			policyName: 'test',
			defaultAction: 'deny',
			rows: [{
				name: 'small-refund',
				tools: ['process_refund'],
				decision: 'allow',
				priority: 200,
				conditions: {
					conditions: [{
						leftValue: 'amount',
						rightValue: { value: '50' },
						operator: { operation: 'lt' },
					}],
				},
			}],
		});

		expect(policy.rules[0].condition).toBe("action == 'process_refund' and amount < 50");
	});

	it('should include approvers and limit when present', () => {
		const policy = translateRulesToPolicy({
			policyName: 'test',
			defaultAction: 'deny',
			rows: [{
				name: 'supervised-write',
				tools: ['Write'],
				decision: 'require_approval',
				priority: 150,
				approvers: ['admin@co.com', 'ops@co.com'],
				limit: '10/hour',
			}],
		});

		expect(policy.rules[0].approvers).toEqual(['admin@co.com', 'ops@co.com']);
		expect(policy.rules[0].limit).toBe('10/hour');
	});

	it('should set agent when agentDid provided', () => {
		const policy = translateRulesToPolicy({
			policyName: 'test',
			agentDid: 'did:agentmesh:agent-1',
			defaultAction: 'allow',
			rows: [],
		});

		expect(policy.agent).toBe('did:agentmesh:agent-1');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgtEvaluator (real engine)
// ─────────────────────────────────────────────────────────────────────────────

describe('createAgtEvaluator', () => {
	function makeConfig(overrides: Partial<AgtGovernanceConfig> = {}): AgtGovernanceConfig {
		return {
			enabled: true,
			defaultAction: 'deny',
			conflictStrategy: 'priorityFirstMatch',
			rules: [],
			...overrides,
		};
	}

	const ctx = { workflowId: 'wf-1', nodeName: 'Node', sessionId: 'sess-1' };

	it('should allow a tool matched by an allow rule', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			rules: [{
				name: 'allow-read', tools: ['Read'], decision: 'allow', priority: 100,
			}],
		}), ctx);

		const result = evaluator.evaluate('Read', {});
		expect(result.decision).toBe('allow');
		expect(result.source).toBe('agtGovernance');
	});

	it('should deny a tool matched by a deny rule', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			rules: [{
				name: 'deny-bash', tools: ['Bash'], decision: 'deny', priority: 100,
			}],
		}), ctx);

		const result = evaluator.evaluate('Bash', {});
		expect(result.decision).toBe('deny');
	});

	it('should return ask for require_approval rule', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			rules: [{
				name: 'approve-write', tools: ['Write'], decision: 'require_approval',
				priority: 100, approvers: ['admin@co.com'],
			}],
		}), ctx);

		const result = evaluator.evaluate('Write', {});
		expect(result.decision).toBe('ask');
		expect(result.approvers).toContain('admin@co.com');
	});

	it('should deny unmatched tools when defaultAction is deny', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'deny',
			rules: [{
				name: 'allow-read', tools: ['Read'], decision: 'allow', priority: 100,
			}],
		}), ctx);

		const result = evaluator.evaluate('Bash', {});
		expect(result.decision).toBe('deny');
	});

	it('should allow unmatched tools when defaultAction is allow', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			defaultAction: 'allow',
			rules: [{
				name: 'deny-bash', tools: ['Bash'], decision: 'deny', priority: 100,
			}],
		}), ctx);

		const result = evaluator.evaluate('Read', {});
		expect(result.decision).toBe('allow');
	});

	it('should rate-limit calls when limit is set', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			rules: [{
				name: 'limited-read', tools: ['Read'], decision: 'allow',
				priority: 100, limit: '2/minute',
			}],
		}), ctx);

		expect(evaluator.evaluate('Read', {}).decision).toBe('allow');
		expect(evaluator.evaluate('Read', {}).decision).toBe('allow');
		const third = evaluator.evaluate('Read', {});
		expect(third.decision).toBe('deny');
		expect(third.rateLimited).toBe(true);
	});

	it('should expose the resolved agent DID', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			agentDid: 'did:custom:abc',
		}), ctx);

		expect(evaluator.agentDid).toBe('did:custom:abc');
	});

	it('should include evaluationMs in results', () => {
		const evaluator = createAgtEvaluator(makeConfig({
			rules: [{
				name: 'r1', tools: ['Read'], decision: 'allow', priority: 100,
			}],
		}), ctx);

		const result = evaluator.evaluate('Read', {});
		expect(result.evaluationMs).toBeDefined();
		expect(typeof result.evaluationMs).toBe('number');
	});
});
