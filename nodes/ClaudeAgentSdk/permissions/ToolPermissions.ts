/**
 * Tool Permissions
 *
 * Implements canUseTool callback logic with glob pattern matching
 * and simple condition evaluation.
 */

import type {
	ToolPermissionsConfig,
	ToolPermissionRule,
	ToolPermissionDecision,
	PreToolUseHookInput,
} from './types';

// =============================================================================
// Glob Pattern Matching
// =============================================================================

/**
 * Convert a simple glob pattern to a regex
 * Supports:
 * - * matches any characters (except __)
 * - ** matches any characters (including __)
 * - Exact matches
 */
function globToRegex(pattern: string): RegExp {
	const doubleStarPlaceholder = '__DOUBLE_STAR_PLACEHOLDER__';

	// Escape special regex characters except * and ?
	const regexStr = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		// Use placeholder for ** to avoid double replacement
		.replace(/\*\*/g, doubleStarPlaceholder)
		// * matches anything except __
		.replace(/\*/g, '[^_]*')
		// ** matches anything including __
		.split(doubleStarPlaceholder)
		.join('.*');

	return new RegExp(`^${regexStr}$`);
}

/**
 * Check if a tool name matches a glob pattern
 */
function matchesPattern(toolName: string, pattern: string): boolean {
	// Exact match shortcut
	if (pattern === toolName) {
		return true;
	}

	// If no wildcards, must be exact match
	if (!pattern.includes('*')) {
		return pattern === toolName;
	}

	const regex = globToRegex(pattern);
	return regex.test(toolName);
}

// =============================================================================
// Condition Evaluation
// =============================================================================

/**
 * Safely evaluate a simple condition against tool input
 *
 * Supported operations:
 * - input.field.includes('value')
 * - input.field.startsWith('value')
 * - input.field.endsWith('value')
 * - input.field === 'value'
 * - input.field !== 'value'
 * - !input.field.includes('value')
 */
function evaluateCondition(
	condition: string,
	toolInput: Record<string, unknown>,
): boolean {
	// Parse the condition
	const trimmed = condition.trim();

	// Handle negation
	const isNegated = trimmed.startsWith('!');
	const expr = isNegated ? trimmed.slice(1).trim() : trimmed;

	// Extract field path and operation
	// Pattern: input.field.method('value') or input.field === 'value'
	// Use non-greedy (.*?) or exclude quotes ([^'"]*) to avoid capturing the closing quote
	const methodMatch = expr.match(/^input\.(\w+)\.(\w+)\(['"]([^'"]*)['"]\)$/);
	const equalityMatch = expr.match(/^input\.(\w+)\s*(===|!==)\s*['"]([^'"]*)['"]$/);

	let result = false;

	if (methodMatch) {
		const [, field, method, value] = methodMatch;
		const fieldValue = toolInput[field];

		if (typeof fieldValue === 'string') {
			switch (method) {
				case 'includes':
					result = fieldValue.includes(value);
					break;
				case 'startsWith':
					result = fieldValue.startsWith(value);
					break;
				case 'endsWith':
					result = fieldValue.endsWith(value);
					break;
				default:
					console.warn(`Unknown method in condition: ${method}`);
					result = false;
			}
		}
	} else if (equalityMatch) {
		const [, field, operator, value] = equalityMatch;
		const fieldValue = toolInput[field];

		if (operator === '===') {
			result = fieldValue === value;
		} else if (operator === '!==') {
			result = fieldValue !== value;
		}
	} else {
		console.warn(`Could not parse condition: ${condition}`);
		result = false;
	}

	return isNegated ? !result : result;
}

// =============================================================================
// Tool Permissions Implementation
// =============================================================================

/**
 * Find the first matching rule for a tool
 */
function findMatchingRule(
	toolName: string,
	toolInput: Record<string, unknown>,
	rules: ToolPermissionRule[],
): ToolPermissionRule | undefined {
	for (const rule of rules) {
		// Check if tool name matches pattern
		if (!matchesPattern(toolName, rule.toolPattern)) {
			continue;
		}

		// If there's a condition, evaluate it
		if (rule.condition) {
			if (!evaluateCondition(rule.condition, toolInput)) {
				continue;
			}
		}

		// Rule matches
		return rule;
	}

	return undefined;
}

/**
 * Evaluate tool permissions and return the decision
 */
export function evaluateToolPermission(
	input: PreToolUseHookInput,
	config: ToolPermissionsConfig,
): { decision: ToolPermissionDecision; reason?: string; rule?: ToolPermissionRule } {
	// Find first matching rule
	const matchingRule = findMatchingRule(input.tool_name, input.tool_input, config.rules);

	if (matchingRule) {
		let finalDecision = matchingRule.decision;

		// Handle 'ask' in non-interactive context
		if (finalDecision === 'ask') {
			finalDecision = config.askFallback;
		}

		return {
			decision: finalDecision,
			reason: matchingRule.reason || `Matched rule for pattern: ${matchingRule.toolPattern}`,
			rule: matchingRule,
		};
	}

	// No matching rule, use default decision
	return {
		decision: config.defaultDecision,
		reason: `Default decision: ${config.defaultDecision}`,
	};
}

/**
 * Check if a tool is allowed (helper for simple checks)
 */
export function isToolAllowed(
	input: PreToolUseHookInput,
	config: ToolPermissionsConfig,
): boolean {
	const { decision } = evaluateToolPermission(input, config);
	return decision === 'allow';
}
