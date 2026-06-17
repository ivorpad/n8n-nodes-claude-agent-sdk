import type { ClaudeAgentSdkModule } from './types';

let sdkModulePromise: Promise<ClaudeAgentSdkModule> | undefined;

/**
 * Centralized SDK loader.
 * The SDK is ESM-only, so we keep the import boundary in one place.
 */
export async function loadClaudeAgentSdkModule(): Promise<ClaudeAgentSdkModule> {
	if (!sdkModulePromise) {
		// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
		sdkModulePromise = import('@anthropic-ai/claude-agent-sdk') as Promise<ClaudeAgentSdkModule>;
	}

	try {
		return await sdkModulePromise;
	} catch (error) {
		sdkModulePromise = undefined;
		throw new Error(
			`Failed to load @anthropic-ai/claude-agent-sdk: ${String(
				(error as Error).message || error,
			)}`,
		);
	}
}
