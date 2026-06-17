# Canonical Type Map

Complete mapping of project types to their canonical sources.

## Table of Contents

- [SDK Message Types](#sdk-message-types)
- [SDK Hook Types](#sdk-hook-types)
- [SDK MCP Types](#sdk-mcp-types)
- [SDK Configuration Types](#sdk-configuration-types)
- [SDK Permission Types](#sdk-permission-types)
- [SDK Tool I/O Types](#sdk-tool-io-types)
- [n8n-workflow Types](#n8n-workflow-types)
- [Project-Only Types (No Canonical Source)](#project-only-types)

---

## SDK Message Types

Source: `@anthropic-ai/claude-agent-sdk` → `sdk.d.ts`

| SDK Type | Description |
|---|---|
| `SDKMessage` | Union of 33 message types (discriminated on `type`+`subtype`) |
| `SDKAssistantMessage` | `{ type: 'assistant'; message: BetaMessage; ... }` |
| `SDKUserMessage` | `{ type: 'user'; message: MessageParam; ... }` |
| `SDKUserMessageReplay` | Same as user with `isReplay: true` |
| `SDKResultMessage` | `SDKResultSuccess \| SDKResultError` |
| `SDKResultSuccess` | Has `result`, `total_cost_usd`, `usage`, `modelUsage`, `structured_output` |
| `SDKResultError` | Has `errors`, `stop_reason` |
| `SDKSystemMessage` | `{ type: 'system'; subtype: 'init'; cwd; tools; mcp_servers; model; ... }` |
| `SDKStatusMessage` | `{ type: 'system'; subtype: 'status'; ... }` |
| `SDKPartialAssistantMessage` | `{ type: 'stream_event'; event: BetaRawMessageStreamEvent; ... }` |
| `SDKHookResponseMessage` | `{ type: 'system'; subtype: 'hook_response'; ... }` |
| `SDKHookStartedMessage` | Hook execution started |
| `SDKHookProgressMessage` | Hook execution progress |
| `SDKTaskStartedMessage` | `{ type: 'system'; subtype: 'task_started'; ... }` |
| `SDKTaskProgressMessage` | `{ type: 'system'; subtype: 'task_progress'; ... }` |
| `SDKTaskNotificationMessage` | `{ type: 'system'; subtype: 'task_notification'; ... }` |
| `SDKToolProgressMessage` | `{ type: 'tool_progress'; ... }` |
| `SDKAuthStatusMessage` | `{ type: 'auth_status'; ... }` |
| `SDKPromptSuggestionMessage` | `{ type: 'prompt_suggestion'; ... }` |
| `SDKCompactBoundaryMessage` | Context compaction boundary |
| `SDKLocalCommandOutputMessage` | Local command output |
| `SDKFilesPersistedEvent` | File persistence event |
| `SDKToolUseSummaryMessage` | Tool use summary |
| `SDKRateLimitEvent` | Rate limit info |
| `SDKElicitationCompleteMessage` | Elicitation complete |

**Status**: resolved — streaming/types.ts re-exports the canonical union via `sdk/types.ts`. The execution pipeline is typed over `NodeStreamMessage` (= `SDKMessage` | `ManagedArtifactMessage` | `ManagedSessionFilesMessage`) with the `isKnownNodeMessage` guard in `sdk/messageGuards.ts`.

---

## SDK Hook Types

Source: `@anthropic-ai/claude-agent-sdk` → `sdk.d.ts`

| SDK Type | Key Fields |
|---|---|
| `BaseHookInput` | `session_id`, `transcript_path`, `cwd`, `permission_mode?`, `agent_id?`, `agent_type?` |
| `PreToolUseHookInput` | extends `BaseHookInput` + `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUseHookInput` | extends `BaseHookInput` + `hook_event_name`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id` |
| `PostToolUseFailureHookInput` | extends `BaseHookInput` + failure context |
| `UserPromptSubmitHookInput` | extends `BaseHookInput` + `prompt` |
| `HookEvent` | `'PreToolUse' \| 'PostToolUse' \| 'PostToolUseFailure' \| 'Notification' \| 'UserPromptSubmit' \| ...` (30 events) |
| `HookCallback` | `(input, toolUseID, options) => Promise<HookJSONOutput>` |
| `HookCallbackMatcher` | `{ matcher?; hooks; timeout? }` |
| `HookJSONOutput` | `AsyncHookJSONOutput \| SyncHookJSONOutput` |
| `SyncHookJSONOutput` | `{ decision?; reason?; outputToAppendToAssistantTurn?; hookSpecificOutput?; suppressNotify? }` |
| `PreToolUseHookSpecificOutput` | `{ decision; reason?; suggestions?; ... }` |
| `PostToolUseHookSpecificOutput` | `{ outputToAppendToAssistantTurn?; ... }` |

**Status**: resolved — `permissions/types.ts` derives from SDK inputs
(`Omit<...,'tool_input'> & { tool_input: Record<string, unknown> }`),
`HookOutput = SyncHookJSONOutput`, `PermissionHooks = SdkHooks`
(= `Options['hooks']`), and HooksBuilder wraps evaluators behind canonical
`HookCallback` boundaries (toolUseID is `string | undefined`).

---

## SDK MCP Types

Source: `@anthropic-ai/claude-agent-sdk` → `sdk.d.ts`

| SDK Type | Structure |
|---|---|
| `McpServerConfig` | `McpStdioServerConfig \| McpSSEServerConfig \| McpHttpServerConfig \| McpSdkServerConfigWithInstance` |
| `McpStdioServerConfig` | `{ type?: 'stdio'; command; args?; env?; }` |
| `McpSSEServerConfig` | `{ type: 'sse'; url; headers? }` |
| `McpHttpServerConfig` | `{ type: 'http'; url; headers? }` |
| `McpSdkServerConfig` | `{ type: 'sdk'; name }` |
| `McpSdkServerConfigWithInstance` | `McpSdkServerConfig & { instance: McpServer }` |
| `McpServerStatus` | `{ name; status; serverInfo?; error?; config?; scope?; tools[] }` |
| `McpServerConfigForProcessTransport` | Union without instance |

**Status**: resolved — `types.ts` re-exports the SDK MCP types;
`McpToolPolicyEntry` aliases `McpServerToolPolicy`; UI configs pass through
`timeout`/`alwaysLoad`. Note: `system:init.mcp_servers` carries only
`{name, status}[]` (`SDKSystemMessage['mcp_servers']`), NOT the full
`McpServerStatus`.

---

## SDK Configuration Types

Source: `@anthropic-ai/claude-agent-sdk` → `sdk.d.ts`

| SDK Type | Description |
|---|---|
| `Options` | Full `query()` options — `canUseTool`, `hooks`, `mcpServers`, `model`, `permissionMode`, `sandbox`, `thinking`, `agents`, `maxTurns`, `disallowedTools`, `maxBudgetUsd`, etc. |
| `AgentDefinition` | `{ description; prompt; tools?; disallowedTools?; model?; mcpServers?; skills?; maxTurns?; ... }` |
| `ThinkingConfig` | `ThinkingAdaptive \| ThinkingEnabled \| ThinkingDisabled` |
| `ThinkingAdaptive` | `{ type: 'adaptive' }` |
| `ThinkingEnabled` | `{ type: 'enabled'; budgetTokens: number }` |
| `ThinkingDisabled` | `{ type: 'disabled' }` |
| `SandboxSettings` | Zod-inferred: `enabled?`, `autoAllowBashIfSandboxed?`, `network?`, `filesystem?`, etc. |
| `SandboxNetworkConfig` | `allowedDomains?`, `allowLocalBinding?`, `allowUnixSockets?`, etc. |
| `ModelUsage` | `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `webSearchRequests`, `costUSD`, `contextWindow`, `maxOutputTokens` |
| `PermissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk'` |
| `PermissionBehavior` | `'allow' \| 'deny' \| 'ask'` |
| `PermissionResult` | `{ behavior: 'allow'; updatedInput?; updatedPermissions? } \| { behavior: 'deny'; message; interrupt? }` |
| `JsonSchemaOutputFormat` | `{ type: 'json_schema'; schema: Record<string,unknown> }` |

**Status**: resolved — `AgentDefinition`/`ThinkingConfig` re-exported from
the SDK; `ModelUsageEntry = ModelUsage`; the query-option bag is
`NodeQueryOptions` (`Options & ManagedQueryExtras & UpstreamUntypedOptions`)
in `sdk/types.ts` — `Record<string, unknown>` queryOptions is banned.
`UpstreamUntypedOptions` documents runtime-valid keys the published Options
type lacks (currently `resumeSessionAt`).

---

## SDK Permission Types

Source: `@anthropic-ai/claude-agent-sdk` → `sdk.d.ts`

| SDK Type | Description |
|---|---|
| `CanUseTool` | `(toolName, input, options) => Promise<PermissionResult \| undefined>` |
| `PermissionResult` | Allow with optional input/permission updates, or deny with message |
| `PermissionUpdate` | `{ tool_name; type: 'allow' \| 'deny' \| 'ask'; destination; ... }` |
| `PermissionRuleValue` | `{ tool_name; allowed_directory?; }` |

---

## SDK Tool I/O Types

Source: `@anthropic-ai/claude-agent-sdk` → `sdk-tools.d.ts`

Available for type-safe tool input/output handling:

| Type | Purpose |
|---|---|
| `BashInput` / `BashOutput` | Bash tool |
| `FileReadInput` / `FileReadOutput` | Read tool |
| `FileWriteInput` / `FileWriteOutput` | Write tool |
| `FileEditInput` / `FileEditOutput` | Edit tool |
| `GlobInput` / `GlobOutput` | Glob tool |
| `GrepInput` / `GrepOutput` | Grep tool |
| `AgentInput` / `AgentOutput` | Agent tool |
| `WebFetchInput` / `WebFetchOutput` | WebFetch tool |
| `WebSearchInput` / `WebSearchOutput` | WebSearch tool |
| `TodoWriteInput` / `TodoWriteOutput` | TodoWrite tool |
| `AskUserQuestionInput` / `AskUserQuestionOutput` | AskUserQuestion tool |
| `ToolInputSchemas` | Union of all tool input types |
| `ToolOutputSchemas` | Union of all tool output types |

---

## n8n-workflow Types

Source: `n8n-workflow` — already imported correctly (no duplication)

| Type | Purpose |
|---|---|
| `IExecuteFunctions` | Main execution context |
| `INodeExecutionData` | Node output data shape |
| `INodeProperties` | Node parameter definitions |
| `INodeTypeDescription` | Node type metadata |
| `IWebhookFunctions` | Webhook handler context |
| `IWebhookResponseData` | Webhook response shape |
| `IDataObject` | Generic data object |
| `IBinaryKeyData` | Binary data keys |
| `IBinaryData` | Binary data shape |
| `EngineRequest` / `EngineResponse` | Engine communication |
| `NodeConnectionTypes` | Connection type constants |
| `ApplicationError` / `NodeOperationError` | Error classes |

---

## Project-Only Types (No Canonical Source)

These are justified — no SDK or n8n equivalent exists:

### UI/Node Parameter Types (`types.ts`)
- `SubagentUI` — n8n UI form shape
- `McpServerUI` — n8n UI form shape
- `AttributeDefinition` — structured output attribute UI
- `AdditionalOptions` — n8n "Additional Options" parameter bag
- `ThinkingMode` — UI selector string (`'default' | 'adaptive' | 'enabled' | 'disabled'`)
- `JsonSchema` — recursive JSON Schema type (SDK uses `Record<string,unknown>`)

### n8n Integration Types (`types.ts`)
- `N8nMcpToolName`, `N8nMcpSettings`, `N8nMcpOutputOverride`, `N8nMcpEvent`
- `QueryOptions` — project's query builder config (wraps SDK `Options`)
- `ExecuteTaskResult`, `GenerateCodeResult` — public result shapes
- `TodoItem`, `ToolCall` — simplified result summaries

### Session Memory (`types.ts`)
- `ISessionMemory`, `ISessionMemoryMetadata`

### Streaming Protocol (`streaming/types.ts`)
- All `*Content` types — n8n streaming chunk payloads
- `ApprovalChunkV1*` — UAC schema for HITL
- `StreamContentType`, `StreamingConfig`, `StreamMarkers`, `MarkerFormat`
- `ToolStreamFilter`, `ToolStreamCategory`, `ToolStreamFilterMode`
- `ToolInputDisplay`, `ToolResultDisplay`
- `SubagentContext`, `ToolCallContext`, `StreamItemPayload`, `SendChunkFn`

### SDK Adapter (`sdk/types.ts`)
- `SessionHandle`, `SdkAdapter`, `ClaudeAgentSdkModule`, `SessionSendInput`
- All `Upstream*` type aliases — justified centralized derivation
- `NodeQueryOptions`, `ManagedQueryExtras`, `UpstreamUntypedOptions`, `SdkHooks`
- `NodeStreamMessage`, `ManagedArtifactMessage`, `ManagedSessionFilesMessage`
- `sdk/messageGuards.ts: isKnownNodeMessage` (compile-checked allowlist)
- `managedAgent/types.ts: ManagedSdkMessage<M>`, `isManagedSdkMessage`

### Permissions Module (`permissions/types.ts`)
- `PathSandboxConfig`, `PathValidationResult`, `PathAffectedTool`
- `ContentFilterConfig`, `ContentBlockRule`, `ContentFilterResult`
- `ToolPermissionsConfig`, `ToolPermissionRule`, `ToolPermissionDecision`
- `AuditLogEntry`, `AuditLoggerConfig`
- `PermissionsConfig`, `PermissionHooks`, `PermissionHooksResult`

### Other Modules
- `SandboxConfig`, `SandboxNetworkConfig`, `SandboxIgnoreViolationsConfig` (`sandbox/types.ts`) — project config shape that maps to SDK's `SandboxSettings`
- `AgentFsConfig`, `AgentFsMountResult`, etc. (`agentfs/types.ts`)
- `ApprovalNotification`, `NotificationChannel` (`notifications/types.ts`)
- `ExecuteTaskOptions`, `ExecutionUsage`, `ProcessedMessages`, `ExecutionResult` (`executeTask/types.ts`)
- `ObservabilityMode`, `InvocationObservabilityEvent`, `InvocationObservabilitySummary`, `InvocationObservability`
