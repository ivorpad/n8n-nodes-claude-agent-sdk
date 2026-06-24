const DEBUG_LOG_FLAG_VALUES = new Set(['true']);

export function isClaudeAgentSdkDebugLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return DEBUG_LOG_FLAG_VALUES.has(env.N8N_DEV_RELOAD ?? '')
		|| DEBUG_LOG_FLAG_VALUES.has(env.CLAUDE_AGENT_SDK_DEBUG_LOGS ?? '');
}

export function debugLog(...args: unknown[]): void {
	if (!isClaudeAgentSdkDebugLoggingEnabled()) return;
	console.log(...args);
}

export function debugWarn(...args: unknown[]): void {
	if (!isClaudeAgentSdkDebugLoggingEnabled()) return;
	console.warn(...args);
}

export function debugError(...args: unknown[]): void {
	if (!isClaudeAgentSdkDebugLoggingEnabled()) return;
	console.error(...args);
}
