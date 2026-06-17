import type { ToolStreamFilter } from '../types';
import { TOOL_CATEGORIES } from '../types';

export function shouldStreamToolName(toolName: string, filter: ToolStreamFilter): boolean {
	// Mode: all - stream everything
	if (filter.mode === 'all') {
		return true;
	}

	// Mode: categories - check if tool belongs to any selected category
	if (filter.mode === 'categories') {
		for (const category of filter.categories) {
			// Special handling for MCP tools
			if (category === 'mcp' && toolName.startsWith('mcp__')) {
				return true;
			}
			// Check if tool is in this category
			if (TOOL_CATEGORIES[category]?.includes(toolName)) {
				return true;
			}
		}
		return false;
	}

	// Mode: specific - check exact tool names or wildcards
	if (filter.mode === 'specific') {
		// Direct match
		if (filter.specificTools.has(toolName)) {
			return true;
		}
		// Check for wildcard patterns (e.g., "mcp__*")
		for (const pattern of filter.specificTools) {
			if (pattern.endsWith('*')) {
				const prefix = pattern.slice(0, -1);
				if (toolName.startsWith(prefix)) {
					return true;
				}
			}
		}
		return false;
	}

	return true;
}

