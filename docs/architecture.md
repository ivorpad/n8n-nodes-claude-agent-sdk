# Architecture & Module Organization

## Main Node

**Entry point:** `nodes/ClaudeAgentSdk/ClaudeAgentSdk.node.ts`
- Single operation: `executeTask` — run autonomous coding tasks with full agent capabilities
- Imports UI properties from `nodeProperties/index.ts`
- Delegates to operation handler in `operations/executeTask/`

## Key Patterns

- Loads the ESM-only `@anthropic-ai/claude-agent-sdk` only through `sdk/loadSdkModule.ts`; all other modules use static imports.
- The `query()` function returns an async iterator of messages
- Credentials are optional — works with Claude CLI's logged-in session for Max/Pro subscribers
- Message handling uses canonical upstream `SDKMessage` union members instead of local shadow SDK types.
- Deterministic sessions use `chatSessionId` as the canonical Claude session ID and resume through `options.resume`.

### API Provider Support

The node supports multiple providers via `ANTHROPIC_BASE_URL`:
- **Anthropic** (default) — Official Anthropic API
- **OpenRouter** — Multi-provider routing with smart fallbacks
- **Ollama** — Local model execution (requires Ollama v0.14.0+)
- **Custom** — Any Anthropic Messages API-compatible endpoint

Provider configuration: `additionalOptions.ts` → `operations/executeTask/config.ts` → `operations/executeTask/index.ts`

## n8n Node Registration (package.json)

- Main node: `ClaudeAgentSdk`
- Memory nodes: `SimpleSessionMemory`, `RedisSessionMemory`, `PostgresSessionMemory`
- Credentials: `ClaudeApi`, `McpHeaderAuthApi`

## Module Map

### Node Properties (`nodeProperties/`)

Modular UI field definitions, combined in `index.ts`:
- `executeTask.ts` — Execute Task operation fields
- `../claudeModels.ts` — current Claude model options plus Opus reasoning/fast-mode gates
- `mcpServers.ts` — MCP server configuration
- `subagents.ts` — Subagent definitions
- `structuredOutput.ts` — Output schema configuration and structured-output failure policy
- `additionalOptions.ts` — Advanced options (API provider, model, thinking tokens, env vars)
- `authentication.ts` — Authentication method selection

### Operations (`operations/`)

- `executeTask/index.ts` — Main entry point for task execution
- `executeTask/config.ts` — Builds Claude SDK query configuration and validates structured output schemas before they reach the SDK
- `executeTask/messages.ts` — Message extraction and processing; validates SDK usage numbers and emits warnings for malformed present fields
- `executeTask/binaryInputs.ts` — Downloads n8n binary inputs into a directory contained by the resolved working directory; unsafe absolute/traversal directories, failed downloads, and unresolved `{files}` placeholders fail the item instead of silently running without files
- `executeTask/execution.ts` — Main execution loop
- `executeTask/steps/querySetupParts.ts` — SDK query options, model reasoning controls, provider guards, and resume wiring
- `executeTask/subagents.ts` — Subagent instantiation
- `executeTask/types.ts` — Operation-specific types
- `schema.ts` — JSON Schema generation plus structured-output schema/value validation helpers

### Permissions (`permissions/`)

- `PathSandbox.ts` — File system access control with path sanitization
- `ContentFilter.ts` — Pre-tool blocking rules for sensitive file/env access (including `.env`/glob/grep/bash env-dump patterns)
- `ToolPermissions.ts` — Allow/deny decisions per tool
- `AuditLogger.ts` — Action logging with redaction support
- `HooksBuilder.ts` — Integrates all permissions into pre/post-tool-use hooks
- `canUseToolCallback.ts` — HITL callback path; applies the same core permission checks as hooks, plus content filtering
- `properties.ts` — UI properties for security settings
- `types.ts` — Permission type definitions

### Streaming (`streaming/`)

- `StreamingHandler.ts` — Streaming implementation
- `properties.ts` — UI controls for streaming configuration
- `types.ts` — Marker formats, content types, filter modes
- Supports both final structured output (`structured_output`) and incremental structured output chunks (`structured_output_delta`) via the `Structured Output (Streaming)` content type, sourced from `stream_event` `input_json_delta` events (reference-compatible with `ai-sdk-provider-claude-code` behavior; no vendored code).
- Structured output retry exhaustion (`error_max_structured_output_retries`) is now handled by an explicit node policy: continue with diagnostics, throw, or fall back to unstructured summary text.
- SDK 0.3.x task and retry drift is exposed through canonical content types such as `system:api_retry`, `system:task_updated`, `system:permission_denied`, and Task tool calls (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`).

### Session Memory (`nodes/memory/`)

- `SimpleSessionMemory` — In-memory (single process)
- `RedisSessionMemory` — Distributed storage; async client errors are stored and surfaced from awaited memory methods (`has`, `getMetadata`, `touch`)
- `PostgresSessionMemory` — Persistent database

### Hook Handlers (`hooks/`)

- `webhookHooks.ts` — Builds user-configured SDK webhook/command hook callbacks. Sync responses are runtime-validated as SDK hook JSON output; non-2xx webhook responses, invalid JSON, and wrong-shape JSON follow the configured fail-open/fail-closed policy.

## ESM Compatibility

The SDK is ESM-only and the project emits CommonJS for n8n. Dynamic inline imports are forbidden. If SDK loading must cross the ESM/CommonJS boundary, use the allowlisted loader module:

`nodes/ClaudeAgentSdk/sdk/loadSdkModule.ts`

The local adapter is query-backed. The upstream `unstable_v2_createSession`, `unstable_v2_resumeSession`, and `unstable_v2_prompt` APIs were removed in `@anthropic-ai/claude-agent-sdk` 0.3.142 and must not be reintroduced. Use `query()` plus `options.resume` for resume flows.

## Current SDK and Model Surface

- Package baseline: `@anthropic-ai/claude-agent-sdk` 0.3.175, `@anthropic-ai/sdk` 0.100.1, `@modelcontextprotocol/sdk` 1.29.0, `nodemailer` 7.0.11, and `safe-regex2` 5.1.1.
- Community install compatibility: `scripts/patch-pkce-challenge.mjs` renames `pkce-challenge` `index.node.*` files during install so n8n's custom-node loader does not mistake them for node definitions.
- Content filtering uses curated built-in regexes plus `safe-regex2` rejection for user-defined regex rules; the package no longer depends on native `re2`.
- Explicit current model IDs: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`.
- Backwards-compatible model aliases remain: default, `opus`, `sonnet`, and `haiku`. Provider override environment variables such as `ANTHROPIC_DEFAULT_OPUS_MODEL` can point at `claude-opus-4-8`.
- Opus 4.7+ / 4.8 use adaptive thinking plus `effort`; fixed thinking budgets are suppressed because the current API surface rejects them.
- Fast mode sets `speed: "fast"` only for supported Opus models on the Claude API research preview and is blocked for OpenRouter/custom provider flows.
- Current task tracking uses `TaskCreate`, `TaskUpdate`, `TaskGet`, and `TaskList`; `TodoWrite` remains supported for old transcripts and older Claude Code surfaces.

The `change-case` package is overridden to v4.1.2 in package.json for CommonJS compatibility.

## n8n Node Development Notes

- Node classes implement `INodeType` interface with `description` and `execute()` method
- Use `displayOptions.show` to conditionally show parameters based on other selections
- `usableAsTool: true` makes the node available as an AI agent tool (never use `false`)
- Return format: `INodeExecutionData[][]` (array of arrays for multiple outputs)
- Use `this.getNodeParameter()` to retrieve user inputs
- Use `this.getCredentials()` to retrieve credentials
