/**
 * AGT Governance — V13 comparison-operator injection guard
 *
 * Comparison operators (gt/gte/lt/lte) interpolate the right value UNQUOTED
 * into the agentmesh expression, so a non-numeric value is a direct injection
 * into the policy evaluator: `amount > 0 or 1==1` widens a deny/ask rule to
 * always-true. rightValue is expression-bindable from workflow data, so the
 * compiler must fail closed on anything that is not a plain number.
 *
 * (Lives in its own file: AgtGovernance.test.ts is at the 500-LOC cap.)
 */

import { describe, it, expect } from 'vitest';
import { ApplicationError } from 'n8n-workflow';
import { compileFilterCondition } from '../../permissions/AgtGovernance';

describe('compileFilterCondition — comparison-operator numeric guard (V13)', () => {
	it('should reject non-numeric right values on every comparison operator', () => {
		for (const operation of ['gt', 'gte', 'lt', 'lte']) {
			expect(() => compileFilterCondition({
				conditions: [{
					leftValue: 'amount',
					rightValue: { value: '0 or 1==1' },
					operator: { operation },
				}],
			})).toThrow(ApplicationError);
		}
	});

	it('should reject a parenthesis-breakout payload', () => {
		expect(() => compileFilterCondition({
			conditions: [{
				leftValue: 'role',
				rightValue: { value: "0) or (role == 'admin'" },
				operator: { operation: 'gte' },
			}],
		})).toThrow('requires a numeric right value');
	});

	it('should reject an empty right value on comparisons', () => {
		// `amount > ` (nothing) must not compile into a dangling expression.
		expect(() => compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '' },
				operator: { operation: 'gt' },
			}],
		})).toThrow(ApplicationError);
	});

	it('should still compile plain numbers on comparisons', () => {
		expect(compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '50' },
				operator: { operation: 'gt' },
			}],
		})).toBe('amount > 50');

		expect(compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '99.5' },
				operator: { operation: 'lt' },
			}],
		})).toBe('amount < 99.5');
	});

	it('should still compile negative and whitespace-padded numbers', () => {
		// Negative thresholds and padded numbers worked before the guard
		// (raw interpolation); they must keep working after it.
		expect(compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: '-5' },
				operator: { operation: 'gt' },
			}],
		})).toBe('amount > -5');

		expect(compileFilterCondition({
			conditions: [{
				leftValue: 'amount',
				rightValue: { value: ' 50 ' },
				operator: { operation: 'lte' },
			}],
		})).toBe('amount <= 50');
	});

	it('should leave equals/notEquals behavior unchanged (quoted for non-numeric)', () => {
		// equals with a non-numeric value quotes it — that path is already
		// covered by backslash-first escaping and must not start throwing.
		expect(compileFilterCondition({
			conditions: [{
				leftValue: 'status',
				rightValue: { value: '0 or 1==1' },
				operator: { operation: 'equals' },
			}],
		})).toBe("status == '0 or 1==1'");
	});
});
