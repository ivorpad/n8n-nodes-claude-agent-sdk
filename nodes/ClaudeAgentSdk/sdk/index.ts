/**
 * SDK Adapter Module
 *
 * Provides the local query-backed SDK adapter and loader boundary.
 */

export { createSdkAdapter } from './adapter';
export { loadClaudeAgentSdkModule } from './loadSdkModule';
export type { SdkAdapter, ClaudeAgentSdkModule } from './types';
