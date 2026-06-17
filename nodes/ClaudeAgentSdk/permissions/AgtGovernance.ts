/**
 * AGT Governance Helper
 *
 * Owns the translation from n8n-native AGT rule rows to
 * @microsoft/agentmesh-sdk policy objects and evaluation results.
 *
 * Isolated from canUseToolCallback.ts so the filter-AST-to-expression
 * compilation can be unit-tested independently of the permission chain.
 */

import { ApplicationError } from 'n8n-workflow';
import {
	PolicyEngine,
	ConflictResolutionStrategy,
	type PolicyAction,
} from '@microsoft/agentmesh-sdk';

import type {
	AgtConflictStrategy,
	AgtFilterValue,
	AgtGovernanceConfig,
	AgtRuleRow,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────────────────────

interface AgtEvalResult {
	decision: 'allow' | 'deny' | 'ask';
	reason: string;
	source: 'agtGovernance';
	matchedRule?: string;
	approvers?: string[];
	rateLimited?: boolean;
	evaluationMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator interface
// ─────────────────────────────────────────────────────────────────────────────

export interface AgtEvaluator {
	evaluate(toolName: string, toolInput: Record<string, unknown>): AgtEvalResult;
	readonly agentDid: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic agent DID
// ─────────────────────────────────────────────────────────────────────────────

function sanitiseDidSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '') || 'unknown';
}

export function resolveAgtAgentDid(args: {
	configuredAgentDid?: string;
	workflowId?: string;
	nodeName?: string;
	sessionId?: string;
	executionId?: string;
}): string {
	const trimmed = args.configuredAgentDid?.trim();
	if (trimmed) return trimmed;

	const workflow = sanitiseDidSegment(args.workflowId || 'unknown');
	const node = sanitiseDidSegment(args.nodeName || 'unknown');
	const session = sanitiseDidSegment(args.sessionId || args.executionId || 'unknown');

	return `did:n8n:claude-agent-sdk:${workflow}:${node}:${session}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict strategy mapping
// ─────────────────────────────────────────────────────────────────────────────

const CONFLICT_STRATEGY_MAP: Record<AgtConflictStrategy, ConflictResolutionStrategy> = {
	priorityFirstMatch: ConflictResolutionStrategy.PriorityFirstMatch,
	denyOverrides: ConflictResolutionStrategy.DenyOverrides,
	allowOverrides: ConflictResolutionStrategy.AllowOverrides,
	mostSpecificWins: ConflictResolutionStrategy.MostSpecificWins,
};

export function mapConflictStrategy(strategy: AgtConflictStrategy): ConflictResolutionStrategy {
	const mapped = CONFLICT_STRATEGY_MAP[strategy];
	if (mapped === undefined) {
		throw new ApplicationError(`Unknown AGT conflict strategy: ${strategy}`);
	}
	return mapped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter AST → AGT condition string
// ─────────────────────────────────────────────────────────────────────────────

interface FilterCondition {
	leftValue?: string;
	/**
	* n8n filter rightValue shape varies by how it was stored:
	* - UI + filter component: may wrap as { value: ... }
	* - REST API / JSON: typically a raw primitive
	*/
	rightValue?: unknown;
	operator?: { type?: string; operation?: string };
}

interface FilterAST {
	conditions?: FilterCondition[];
	combinator?: string;
}

/**
 * Normalise the left value of a filter condition to a bare field name.
 * Accepts: bare name, `input.name`, `{{$json.name}}`, `={{ $json.name }}`.
 */
function normaliseLeftValue(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();

	// ={{ $json.xxx }} → xxx
	const exprMatch = trimmed.match(/^=?\{\{\s*\$json\.([\w.]+)\s*\}\}$/);
	if (exprMatch) return exprMatch[1];

	// Dot path (e.g. input.amount, file_path) — AGT supports nested access
	// via /^(\w+(?:\.\w+)*)$/ in its expression regex.
	if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(trimmed)) return trimmed;

	return undefined;
}

function compileOneCondition(cond: FilterCondition): string | undefined {
	// Skip empty/missing left values — the rule still applies to the tool list.
	// This protects against UI saves that drop the leftValue field.
	if (!cond.leftValue || (typeof cond.leftValue === 'string' && cond.leftValue.trim() === '')) {
		return undefined;
	}
	const field = normaliseLeftValue(cond.leftValue);
	if (!field) {
		throw new ApplicationError(
			`AGT filter condition has an unsupported left-value format: ${JSON.stringify(cond.leftValue)}`,
		);
	}

	const operationType = cond.operator?.operation || cond.operator?.type || '';

	// n8n filter rightValue can be a primitive ('500') or an object ({ value: '500' }).
	// Unwrap the object form so both shapes work.
	let rightVal: unknown = cond.rightValue;
	if (rightVal && typeof rightVal === 'object' && 'value' in (rightVal as Record<string, unknown>)) {
		rightVal = (rightVal as Record<string, unknown>).value;
	}

	// AGT's expression evaluator is regex-based:
	// - String equality/inequality uses quoted values: field == 'value'
	// - Numeric comparisons use UNQUOTED numbers: field >= 50
	// Quoting a number in a comparison silently fails to match.
	const rawStr = String(rightVal ?? '');
	const isNumeric = /^\d+(?:\.\d+)?$/.test(rawStr);
	// SECURITY (V13): escape backslashes BEFORE single-quotes. A value ending in
	// a backslash (e.g. `foo\`) would otherwise escape the closing quote, letting
	// the value break out of the string literal and inject extra clauses into the
	// agentmesh expression evaluator (`field == 'foo\' or 1==1`). Doubling
	// backslashes first means a trailing `\` becomes a literal `\\` and the
	// closing quote stays intact.
	const quotedValue = `'${rawStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
	const numericValue = rawStr;

	// SECURITY (V13): comparison operators interpolate the right value UNQUOTED,
	// so anything non-numeric injects directly into the agentmesh expression
	// (`amount > 0 or 1==1` widens the rule to always-true). rightValue is
	// expression-bindable from workflow data — fail closed: only a plain
	// (optionally negative) decimal number may pass through unquoted.
	const comparisonNumber = (): string => {
		const trimmed = rawStr.trim();
		if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
			throw new ApplicationError(
				`AGT filter condition "${field} ${operationType} …" requires a numeric right value ` +
				`for comparison operators (gt, gte, lt, lte); got ${JSON.stringify(rawStr)}.`,
			);
		}
		return trimmed;
	};

	switch (operationType) {
		case 'equals':
		case 'equal':
			// Use numeric form for numbers, quoted for strings
			return isNumeric
				? `${field} == ${numericValue}`
				: `${field} == ${quotedValue}`;
		case 'notEquals':
		case 'notEqual':
			return isNumeric
				? `${field} != ${numericValue}`
				: `${field} != ${quotedValue}`;
		case 'gt':
		case 'greaterThan':
			return `${field} > ${comparisonNumber()}`;
		case 'gte':
		case 'greaterThanOrEqual':
			return `${field} >= ${comparisonNumber()}`;
		case 'lt':
		case 'lessThan':
			return `${field} < ${comparisonNumber()}`;
		case 'lte':
		case 'lessThanOrEqual':
			return `${field} <= ${comparisonNumber()}`;
		default:
			throw new ApplicationError(
				`AGT filter condition uses unsupported operator "${operationType}". ` +
				'The AGT policy engine supports: equals, notEquals, gt, gte, lt, lte. ' +
				'String methods (contains, startsWith, endsWith) are not supported.',
			);
	}
}

export function compileFilterCondition(filter: AgtFilterValue | undefined): string | undefined {
	if (!filter) return undefined;

	const ast = filter as FilterAST;
	const conditions = ast.conditions;
	if (!Array.isArray(conditions) || conditions.length === 0) return undefined;

	const compiled = conditions
		.map(compileOneCondition)
		.filter((c): c is string => c !== undefined);
	if (compiled.length === 0) return undefined;
	if (compiled.length === 1) return compiled[0];

	const joiner = ast.combinator === 'or' ? ' or ' : ' and ';
	return compiled.join(joiner);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule rows → AGT policy object
// ─────────────────────────────────────────────────────────────────────────────

interface AgtPolicyRule {
	name: string;
	condition: string;
	ruleAction: PolicyAction;
	priority: number;
	approvers?: string[];
	limit?: string;
}

interface AgtPolicyDocument {
	name: string;
	agent?: string;
	default_action: 'allow' | 'deny';
	rules: AgtPolicyRule[];
}

function buildActionClause(tools: string[]): string {
	if (tools.length === 1) {
		return `action == '${tools[0]}'`;
	}
	const list = tools.map((t) => `'${t}'`).join(', ');
	return `action in [${list}]`;
}

export function translateRulesToPolicy(args: {
	policyName: string;
	agentDid?: string;
	defaultAction: 'allow' | 'deny';
	rows: AgtRuleRow[];
}): AgtPolicyDocument {
	const rules: AgtPolicyRule[] = args.rows.map((row, index) => {
		const actionClause = buildActionClause(row.tools);
		const filterClause = compileFilterCondition(row.conditions);

		const condition = filterClause
			? `${actionClause} and ${filterClause}`
			: actionClause;

		const rule: AgtPolicyRule = {
			name: row.name || `rule-${index + 1}`,
			condition,
			ruleAction: row.decision as PolicyAction,
			priority: row.priority,
		};

		if (row.approvers && row.approvers.length > 0) {
			rule.approvers = row.approvers;
		}
		if (row.limit) {
			rule.limit = row.limit;
		}

		return rule;
	});

	const doc: AgtPolicyDocument = {
		name: args.policyName,
		default_action: args.defaultAction,
		rules,
	};

	if (args.agentDid) {
		doc.agent = args.agentDid;
	}

	return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator factory
// ─────────────────────────────────────────────────────────────────────────────

export function createAgtEvaluator(
	config: AgtGovernanceConfig,
	context: {
		workflowId?: string;
		nodeName?: string;
		sessionId?: string;
		executionId?: string;
	},
): AgtEvaluator {
	const effectiveDid = resolveAgtAgentDid({
		configuredAgentDid: config.agentDid,
		...context,
	});

	const strategy = mapConflictStrategy(config.conflictStrategy);
	const engine = new PolicyEngine([], strategy);

	const policy = translateRulesToPolicy({
		policyName: `n8n-agt-policy`,
		agentDid: effectiveDid,
		defaultAction: config.defaultAction,
		rows: config.rules,
	});

	engine.loadPolicy(policy);

	return {
		agentDid: effectiveDid,

		evaluate(toolName: string, toolInput: Record<string, unknown>): AgtEvalResult {
			const result = engine.evaluatePolicy(effectiveDid, {
				action: toolName,
				...toolInput,
			});

			// Rate limited → deny
			if (result.rateLimited) {
				return {
					decision: 'deny',
					reason: result.reason || `Rate limited`,
					source: 'agtGovernance',
					matchedRule: result.matchedRule,
					rateLimited: true,
					evaluationMs: result.evaluationMs,
				};
			}

			// require_approval → ask (HITL)
			if (result.action === 'require_approval') {
				return {
					decision: 'ask',
					reason: `AGT rule "${result.matchedRule || 'unknown'}" requires approval`,
					source: 'agtGovernance',
					matchedRule: result.matchedRule,
					approvers: result.approvers,
					evaluationMs: result.evaluationMs,
				};
			}

			// Explicit allow
			if (result.allowed) {
				return {
					decision: 'allow',
					reason: `AGT rule "${result.matchedRule || 'default'}" allowed`,
					source: 'agtGovernance',
					matchedRule: result.matchedRule,
					evaluationMs: result.evaluationMs,
				};
			}

			// Deny (explicit rule or default_action)
			return {
				decision: 'deny',
				reason: result.reason || `AGT policy denied "${toolName}"`,
				source: 'agtGovernance',
				matchedRule: result.matchedRule,
				evaluationMs: result.evaluationMs,
			};
		},
	};
}
