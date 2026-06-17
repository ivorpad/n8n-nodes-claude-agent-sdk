/**
 * Tool pattern matching utilities shared by permission layers.
 *
 * Supports:
 * - exact names (`Read`, `mcp__github__search_code`)
 * - wildcard patterns (`mcp__*`, `mcp__github__*`)
 */

/**
 * Convert a simple glob pattern to a regular expression.
 */
function globToRegex(pattern: string): RegExp {
	const regexStr = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '.*')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.')
		.replace(/\.\*\.\*/g, '.*');

	return new RegExp(`^${regexStr}$`);
}

/**
 * Check whether a tool name matches the provided pattern.
 */
function matchesToolPattern(toolName: string, pattern: string): boolean {
	if (!pattern) return false;
	if (pattern === toolName) return true;
	if (!pattern.includes('*') && !pattern.includes('?')) return false;
	return globToRegex(pattern).test(toolName);
}

/**
 * Return the first pattern that matches a tool name.
 */
export function findMatchingToolPattern(toolName: string, patterns: string[]): string | undefined {
	for (const pattern of patterns) {
		if (matchesToolPattern(toolName, pattern)) {
			return pattern;
		}
	}
	return undefined;
}
