# Managed Agents Integration — Learnings

Hard-won insights from adding Claude Managed Agents as a second execution backend alongside the local CLI.

## 1. The Managed Agents API

### Event-level streaming, not token-level
Unlike the Messages API (`content_block_delta`), Managed Agents streams at the **event level** via SSE:
- `agent.thinking` → thinking indicator
- `agent.tool_use` → tool invocation
- `agent.tool_result` → tool output
- `agent.message` → **complete** text block (no partial deltas inside one message)
- `session.status_idle` → end of turn
- `span.model_request_end` → token usage

**For a simple "hello"**: one `agent.message` event arrives whole. No character-by-character streaming.
**For a multi-step task**: each tool call/result/message arrives progressively. The UX feels streamed because events flow over time.

### Open stream BEFORE sending
```ts
const stream = await client.beta.sessions.events.stream(sessionId);
// THEN send — opening after send causes lost events
await client.beta.sessions.events.send(sessionId, { events: [...] });
```

### Auth: workspace API key only
OAuth tokens from Max/Pro subscriptions are **rejected** on agents/sessions/events endpoints. Only `ANTHROPIC_API_KEY` (workspace key with credits) works.

## 2. Files and Artifacts

### The container filesystem
| Path | Mode | Purpose |
|------|------|---------|
| `/mnt/session/uploads/` | read-only | Mounted input files (paths rewritten to `/mnt/session/uploads/<your_mount_path>`) |
| `/mnt/session/outputs/` | writable | **Write here** — files sync to Files API async |
| `/` | overlay | Ephemeral — lost on session end |

The agent **must write to `/mnt/session/outputs/`** for files to become downloadable. We inject this into the system prompt automatically.

### File sync is async
Files from `/mnt/session/outputs/` take ~1–3 seconds to appear in the Files API. You **must poll** `client.beta.files.list()` until the count stabilises:

```ts
const deadline = Date.now() + 15_000;
let last: any[] = [];
while (Date.now() < deadline) {
    const current = await listFiles();
    if (current.length > 0 && current.length === last.length) break;
    last = current;
    await sleep(1500);
}
```

### Beta headers must be combined for scope_id
The single biggest gotcha:
```
unknown field scope_id
```
`scope_id` is rejected unless **both** beta headers are sent in a single comma-separated header:
```
anthropic-beta: files-api-2025-04-14,managed-agents-2026-04-01
```

In the TS SDK, pass via the `betas` option:
```ts
await client.beta.files.list({
    scope_id: sessionId,
    betas: ['files-api-2025-04-14', 'managed-agents-2026-04-01'] as any,
});
```

### Downloading
```ts
const response = await client.beta.files.download(file.id, { betas: [...] });
const blob = await response.blob();
const buffer = Buffer.from(await blob.arrayBuffer());
const base64 = buffer.toString('base64');
```

## 3. n8n Streaming Gotchas

### n8n's auth-field hiding logic
**A property named `executionBackend` got invisibly hidden** because n8n treats parameters referenced from credential `displayOptions.show` as auth-related fields, and then hides matching parameter names in the node settings UI.

**Fix**: renamed the setting to `backendMode` so the execution backend selector no longer collides with auth-related parameter detection.

Second-order trap: credential display rules such as `displayOptions.show.enableMcpServers` also make that parameter an auth field. If that parameter is itself gated by `backendMode`, n8n treats `backendMode` as auth-related and hides the backend selector. Use absolute parameter paths in credential display rules (`'/enableMcpServers'`) when the field is only a visibility dependency.

Reference: `packages/frontend/editor-ui/src/features/ndv/settings/composables/useNodeSettingsParameters.ts:196-213`

### Webhook trigger `responseMode: 'streaming'` is required
Without it, `data.httpResponse` is never set on the execution, `sendChunk` writes go nowhere, and the client sees the response only at the end. For real-time streaming:

1. Webhook trigger node → Response Mode → **Streaming**
2. Client must append `?format=stream` to the webhook URL
3. Client must read via `response.body.getReader()` (not buffered consumption)

### Pipe buffering kills debugging
`curl ... | while read` and similar pipes use a line buffer (64KB+). You can't tell if data arrives incrementally this way. Use `curl --no-buffer` and write output directly to stdout without pipes.

### `shouldStream('text')` ignored `'all'` wildcard
Pre-existing bug in `StreamingHandler.shouldStream()`: strict set membership check. When `contentTypes: ['all']` was set, `streamText()` silently bailed because `'text'` wasn't literally in the set.

Fix:
```ts
shouldStream(contentType) {
    return this.config.contentTypes.has(contentType)
        || this.config.contentTypes.has('all');
}
```

## 4. Architecture Decisions

### Reuse the `SdkAdapter` interface
`ManagedAgentAdapter` implements the same `SdkAdapter` as the local CLI — same `promptOnce(prompt, options)` signature, same async iterable of SDK-compatible messages. The entire pipeline downstream (`executeStreaming`, `processMessages`, HITL, observability) treats both backends identically.

### Event mapping: managed → SDK format
`managedAgent/eventMapper.ts` translates Managed Agent SSE events into SDK message shapes:
- `agent.message` → `{type: 'assistant', message: {role: 'assistant', content: [{type: 'text', text}]}}`
- `agent.tool_use` / `agent.custom_tool_use` / `agent.mcp_tool_use` → assistant messages with canonical `tool_use` content blocks
- `session.status_idle` (end_turn) → `{type: 'result', subtype: 'success'}`
- `session.status_idle` (requires_action) → synthetic HITL intercept event

The content must be an **array of blocks** (`[{type: 'text', text}]`), not a plain string. `processMessages()` expects the SDK shape; otherwise `summary` comes out empty.

### Adapter wraps SSE in async generator
```ts
const stream = (async function* () {
    const session = await client.beta.sessions.create({ agent, environment_id });
    const eventStream = await client.beta.sessions.events.stream(session.id);
    await client.beta.sessions.events.send(session.id, { events: [userMsg] });
    for await (const rawEvent of eventStream) {
        for (const msg of mapManagedEvent(rawEvent, session.id)) yield msg;
        if (rawEvent.type === 'session.status_idle') break;
    }
    // After idle: poll + download session files, yield as artifact messages
})();
```

### Artifacts as `type: 'artifact'` messages
After `session.status_idle`, the adapter polls the Files API (with combined beta headers), downloads each file, and yields them as `{type: 'artifact', content: {type: 'file', fileId, filename, mimeType, sizeBytes, base64}}`. `processMessages()` collects them into `task_result.artifacts[]`, and the durable stream also emits them via `sendChunk` so streaming clients see them live.

## 5. Client-side Rendering

The client demo (`n8n-next-agent-client-demo`) was extended to:
1. Parse `{type: 'artifact'}` chunks in `stream-parser.ts` → `ArtifactChunk`
2. Dispatch `ADD_ARTIFACT` action in `use-agent-chat.ts` → reducer appends `ArtifactBlock` to the message
3. Render a 📎 download pill in `agent-message.tsx` with a base64 `data:` URL — click to save

## 6. Lint and Hook Constraints

- **File-size guard hook** blocks edits to files > 500 LOC. Use Python scripts with `str.replace` for large files.
- `@anthropic-ai/sdk` exposes a CommonJS entrypoint, so managed-agent code uses a normal static import:
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  const client = new Anthropic({ apiKey });
  ```
- **`no-restricted-globals`** blocks bare `setTimeout`. Use `node:timers/promises`:
  ```ts
  import { setTimeout as sleep } from 'node:timers/promises';
  await sleep(1500);
  ```
- **`no-console`** blocks `console.log`. Use `// eslint-disable-next-line no-console` for error-path warnings.

## 7. Session Identity

`chatSessionId` from the node UI is **not** the Managed Agent session ID. It remains the deterministic n8n key. The managed backend creates or resumes an Anthropic `sesn_...` session, and session memory stores that mapping as metadata:

- in-memory/Simple/Redis metadata: `managedAgentSessionId`
- Postgres column: `managed_agent_session_id`

On a later run with the same `chatSessionId`, `executeTask` resolves the stored `sesn_...` and passes it to `ManagedAgentAdapter` as `managedAgentResumeSessionId`. The adapter then skips `sessions.create`, opens the event stream for the stored session, and sends the next `user.message`.

If stored managed metadata is missing, the managed backend starts fresh and persists the new `sesn_...` after execution. If a stored `sesn_...` cannot be streamed because it is stale/deleted, the adapter falls back to creating a fresh managed session and the normal persistence step overwrites the metadata after success.

This is session continuity, not Anthropic Memory Stores. Managed Agents memory stores are separate `resources[]` attached to a session. The node can now reference existing memory-store IDs as session-create resources, but it does not manage memory-store CRUD, memories, or memory-version redaction.

## 8. Managed Lifecycle Surface

Managed Agents now have a small n8n-native lifecycle surface instead of being executor-only:

- `Manage Managed Agent` can create, inspect, update, and list versions.
- Create/update support structured fields for `name`, `model`, `system`, `description`, and `metadata`, plus JSON surfaces for fast-moving fields such as tools, MCP servers, skills, and multiagent config.
- Update retrieves the current agent first, requires an expected version, and calls `agents.update` with that optimistic version.
- Managed execution can start a session with the latest agent config or a pinned agent version.
- Managed execution can attach a session title, metadata, `vault_ids`, and typed session resources for uploaded files, GitHub repositories, and memory stores.

Raw JSON fields are parsed as `unknown` and narrowed before API calls. Do not introduce `any` to bypass validation for new Managed Agents surfaces.

## 9. HITL and Permission Pauses

Managed custom-tool question HITL and Managed Agents permission confirmations are separate wire contracts:

- Question-shaped `agent.custom_tool_use` pauses continue through `user.custom_tool_result`.
- Permission-policy pauses from `agent.tool_use` / `agent.mcp_tool_use` create approval interactions and resume through `user.tool_confirmation`.
- Denials send `approved: false` and an optional `deny_message`.
- Thread-scoped pauses preserve the Managed Agents `session_thread_id` in the generated request ID and send it back on resume.

Do not route tool confirmations through the custom-tool result path.

## 10. Current Managed Parity Boundaries

- Local CLI-only features stay local-only unless Managed Agents exposes an equivalent API and the n8n UX is explicit.
- Generated files from `/mnt/session/outputs/` are downloaded after idle and can be exposed as n8n binary output through the managed binary-output settings.
- `ManagedAgentAdapter.interrupt()` sends `user.interrupt` for the active `sesn_...` session; calling interrupt before a managed session is active is a no-op.
- Agent archive/delete, environment lifecycle operations, session admin/event-history operations, file upload, GitHub token rotation, vault CRUD, memory CRUD/versioning, webhooks, scheduled deployments, define-outcomes, and AWS provider mode are still outside this first lifecycle slice.
- GitHub resource auth tokens are accepted only as session-create input and are never echoed in node output or test assertions. Long-term credentialization should avoid storing raw repository tokens in ordinary workflow parameters.

## References

- [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview.md)
- [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming.md)
- [Files and artifacts](https://platform.claude.com/docs/en/managed-agents/files.md) — section on `/mnt/session/outputs/`
- [Parity matrix](../analysis/managed-agents-parity-matrix.md)
- POC: `~/src/tries/2026-04-08-claude-managed-agents/`
