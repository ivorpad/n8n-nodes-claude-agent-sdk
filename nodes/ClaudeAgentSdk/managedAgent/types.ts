/**
 * Types for the Claude Managed Agents execution backend.
 *
 * These model the Managed Agents API surface (public beta, April 2026)
 * and the local configuration needed to bridge into our node.
 */

import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events.js';
import type {
	ManagedArtifactMessage,
	ManagedQueryExtras,
	ManagedSessionFilesMessage,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from '../sdk/types';
import type { ManagedSessionResourceParam } from './configuration';

export type { ManagedArtifactMessage, ManagedSessionFilesMessage };

/** Configuration resolved from node properties for a managed agent run. */
export interface ManagedAgentConfig {
	/** Anthropic workspace API key. */
	apiKey: string;
	/**
	 * Pre-created agent ID. Required — agents are authored at the Anthropic
	 * Console (https://platform.claude.com/workspaces/default/agents), not
	 * inside this node.
	 */
	agentId?: string;
	/** Optional pinned agent version for new sessions. Omit to use latest. */
	agentVersion?: number;
	/**
	 * Pre-created environment ID. Required — environments are authored at
	 * the Anthropic Console alongside agents.
	 */
	environmentId?: string;
	/** Optional human-readable title for new Managed Agent sessions. */
	sessionTitle?: string;
	/** Optional session metadata sent at creation. */
	sessionMetadata?: Record<string, string>;
	/** Existing Anthropic vault IDs to attach at session creation. */
	vaultIds?: string[];
	/** Files, GitHub repositories, and memory stores to mount at session creation. */
	resources?: ManagedSessionResourceParam[];
	/**
	 * Existing Managed Agent session ID (sesn_...) to resume.
	 * When set, the adapter skips session creation and sends events directly
	 * to this session, preserving conversation history.
	 */
	resumeSessionId?: string;
	/**
	 * Resume a paused session by sending a custom tool result.
	 * Used when the session is at status_idle/requires_action after a
	 * custom tool invocation (e.g. ask_user_question). The adapter sends
	 * user.custom_tool_result instead of user.message.
	 */
	resumeWithToolResult?: ManagedQueryExtras['managedResumeWithToolResult'];
	/**
	 * Resume a paused session by confirming or denying a managed permission
	 * pause. The adapter sends user.tool_confirmation, never
	 * user.custom_tool_result.
	 */
	resumeWithToolConfirmation?: ManagedQueryExtras['managedResumeWithToolConfirmation'];
}

/** Raw SSE event from the Managed Agents stream. */
export type ManagedAgentRawEvent = BetaManagedAgentsStreamSessionEvents;
/**
 * A canonical SDK message produced by the managed-agent mapper, carrying the
 * source SSE event as the documented `_raw` extension. `_raw` survives JSON
 * persistence (durable stream/replay) where an adapter-level flag would not,
 * and is the managed-backend marker the execution loop streams text on.
 */
export type ManagedSdkMessage<M extends SDKMessage = SDKMessage> = M & {
	_raw: ManagedAgentRawEvent;
};

export function isManagedSdkMessage(message: object): message is ManagedSdkMessage {
	return '_raw' in message;
}

/** Everything the managed adapter's stream can yield. */
export type ManagedStreamMessage =
	| ManagedSdkMessage<SDKAssistantMessage>
	| ManagedSdkMessage<SDKUserMessage>
	| ManagedSdkMessage<SDKResultMessage>
	| ManagedArtifactMessage
	| ManagedSessionFilesMessage;
