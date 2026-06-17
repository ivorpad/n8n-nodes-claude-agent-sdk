/**
 * SDK Adapter Types
 *
 * The local node executes the upstream Agent SDK through query(). The retired
 * unstable V2 session API was removed upstream in @anthropic-ai/claude-agent-sdk
 * 0.3.142, so all session semantics are carried through query options such as
 * resume.
 */

import type * as UpstreamClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk';

type UpstreamQueryOptionsImport = UpstreamClaudeAgentSdk.Options;

// SDK 0.2.92+ terminal/permission types — centralised here to isolate upstream drift
export type {
	SDKMessage,
	SDKAssistantMessage,
	SDKUserMessage,
	SDKResultMessage,
	SDKResultSuccess,
	SDKResultError,
	SDKSystemMessage,
	SDKPermissionDenial,
	TerminalReason,
	SDKDeferredToolUse,
	PermissionDecisionClassification,
	EffortLevel,
	Options as UpstreamQueryOptions,
	ThinkingConfig,
	CanUseTool,
	PermissionResult,
	PermissionUpdate,
	PermissionMode,
	PermissionBehavior,
	HookEvent,
	HookCallback,
	HookCallbackMatcher,
	HookInput,
	HookJSONOutput,
	SyncHookJSONOutput,
	SettingSource,
	SdkBeta,
	Settings,
	SandboxSettings,
	ModelUsage,
	NonNullableUsage,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Project-only query-option keys consumed by the managed-agent adapter
 * (managedAgent/adapter.ts) before options reach the upstream SDK. Never
 * forwarded to the local CLI backend; only set when backendMode === 'managedAgent'.
 */
export interface ManagedQueryExtras {
	managedAgentResumeSessionId?: string;
	managedResumeWithToolResult?: {
		sessionId: string;
		customToolUseId: string;
		content: string;
		sessionThreadId?: string;
	};
	managedResumeWithToolConfirmation?: {
		sessionId: string;
		toolUseId: string;
		approved: boolean;
		denyMessage?: string;
		sessionThreadId?: string;
	};
}

/**
 * The node's query-option bag: canonical upstream Options plus the managed
 * backend extras. Assignable to upstream Options wherever extras are absent.
 * (resumeSessionAt graduated into upstream Options in SDK 0.3.175 — runtime-
 * valid keys missing from the published types would be reintroduced here.)
 */
export type NodeQueryOptions = UpstreamQueryOptionsImport & ManagedQueryExtras;

/** Canonical hooks record shape from upstream Options. */
export type SdkHooks = NonNullable<UpstreamQueryOptionsImport['hooks']>;

/**
 * Project extension message: a managed-agent generated file downloaded and
 * inlined as base64 (producer: managedAgent/adapter.ts).
 */
export interface ManagedArtifactMessage {
	type: 'artifact';
	session_id: string;
	content: {
		type: 'file';
		fileId: string;
		filename: string;
		mimeType: string;
		sizeBytes: number;
		base64: string;
	};
}

/**
 * Project extension message: metadata-only listing of all files in the
 * managed session (producer: managedAgent/adapter.ts).
 */
export interface ManagedSessionFilesMessage {
	type: 'session_files';
	session_id: string;
	content: {
		files: Array<{
			fileId: string;
			filename: string;
			mimeType: string;
			sizeBytes: number;
			createdAt: string;
		}>;
	};
}

/**
 * Every message the node's execution pipeline can observe: the canonical
 * SDKMessage union plus the documented managed-backend extension messages.
 */
export type NodeStreamMessage =
	| UpstreamClaudeAgentSdk.SDKMessage
	| ManagedArtifactMessage
	| ManagedSessionFilesMessage;

/**
 * Upstream SDK source-of-truth aliases.
 *
 * Keeping these aliases centralized makes contract drift obvious at compile time
 * when upstream exports or signatures change.
 */
export type UpstreamSdkModule = typeof UpstreamClaudeAgentSdk;
type UpstreamQuery = UpstreamSdkModule['query'];
export type UpstreamTool = UpstreamSdkModule['tool'];
export type UpstreamCreateSdkMcpServer = UpstreamSdkModule['createSdkMcpServer'];

/**
 * Input type for the query-backed session shim.
 * Supports both simple string and structured message formats.
 */
export type SessionSendInput = string | { type: 'text'; text: string };

/**
 * Session handle returned by createSession/resumeSession.
 * This is a query-backed compatibility shim, not an upstream SDK session.
 */
export interface SessionHandle {
	/**
	 * Session ID, when a backing implementation can expose one.
	 */
	id?: string;

	/**
	 * Send a message to the query-backed shim.
	 */
	send(input: SessionSendInput): Promise<void>;

	/**
	 * Get the response stream
	 * Returns an async iterable of SDK messages
	 */
	stream(): AsyncIterable<NodeStreamMessage>;

	/**
	 * Close the session and release resources
	 * Optional - may not be available in all implementations
	 */
	close?(): Promise<void>;
}

/**
 * One-shot query handle returned by adapter.promptOnce().
 * Some backends expose active execution controls such as interrupt().
 */
export interface QueryHandle extends AsyncIterable<NodeStreamMessage> {
	interrupt?(): Promise<void>;
	close?(): void | Promise<void>;
}

/**
 * SDK Adapter interface.
 * Provides a stable local API over the upstream query() surface.
 */
export interface SdkAdapter {
	/**
	 * The SDK interface version this adapter implements
	 */
	readonly version: 'v1' | 'managed';

	/**
	 * Create a new query-backed session shim.
	 */
	createSession(options: NodeQueryOptions): Promise<SessionHandle>;

	/**
	 * Resume an existing session by ID using options.resume in query().
	 */
	resumeSession(id: string, options: NodeQueryOptions): Promise<SessionHandle>;

	/**
	 * One-shot prompt execution through query().
	 */
	promptOnce(prompt: string, options: NodeQueryOptions): QueryHandle;
}

/**
 * Type for the dynamically imported SDK module. tool/createSdkMcpServer are
 * unconditional exports for the pinned ^0.3.170 SDK.
 */
export interface ClaudeAgentSdkModule {
	query: UpstreamQuery;
	tool: UpstreamTool;
	createSdkMcpServer: UpstreamCreateSdkMcpServer;
}
