/**
 * Feature flags for gated functionality.
 *
 * Flags must be set to the exact string 'true' to enable.
 */

export function isN8nMcpInProcessEnabled(): boolean {
	return process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS === 'true';
}

export function isAgentPlaneEnabled(): boolean {
	return process.env.AGENT_PLANE_ENABLED === '1';
}
