/**
 * Shared state between canUseTool callback and execution loop.
 * Used for tracking execution context across callbacks.
 */

import type { N8nMcpOutputOverride, N8nMcpEvent } from '../types';

export interface SharedExecutionState {
	/**
	 * UUID of the last assistant message seen in the execution loop.
	 */
	lastAssistantMessageUuid?: string;

	/**
	 * UUID of the assistant message BEFORE the one containing the current tool_use.
	 * This is the correct value for resumeSessionAt - when we fork and resume,
	 * the SDK will replay from this point, re-encountering the tool call.
	 */
	lastAssistantMessageUuidBeforeToolUse?: string;

	/**
	 * UUID of the assistant message that contains the current tool_use block.
	 * Used for debugging to distinguish between "before" and "containing" messages.
	 */
	lastAssistantMessageUuidWithToolUse?: string;

	/**
	 * The current session ID, updated from system init messages during execution.
	 * After a fork, this reflects the NEW (post-fork) session ID, which is more
	 * current than the sessionId captured in the callback closure.
	 */
	sessionId?: string;

	/**
	 * Optional output override set by the in-process n8n MCP server.
	 */
	outputOverride?: N8nMcpOutputOverride;

	/**
	 * Events emitted by in-process n8n MCP tools.
	 */
	n8nMcpEvents?: N8nMcpEvent[];

	/**
	 * Last observed session state from system:session_state_changed messages
	 * (canonical SDKSessionStateChangedMessage.state union).
	 */
	sessionState?: 'idle' | 'running' | 'requires_action';
}
