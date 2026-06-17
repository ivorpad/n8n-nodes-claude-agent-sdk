import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Canonical MCP tool result. SDK `tool()` handlers must return
 * Promise<CallToolResult>; the previous local text-only shadow could not
 * express image/audio/resource blocks or structuredContent.
 */
export type McpToolResult = CallToolResult;
