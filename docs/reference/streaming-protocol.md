# Claude Agent SDK — Streaming Protocol (Wire Format)

A complete, frontend-agnostic reference for every stream content type emitted by the **Claude Agent SDK** n8n node. Covers the HTTP transport, frame envelope, replay semantics, and exact JSON shape of each content type the node can emit.

> **Scope.** This document describes the *wire protocol* a client consumes — not n8n UI behaviour. Use it to build a browser UI, a mobile client, a CLI, or another service that subscribes to a live agent run.

---

## 1. Transport

### 1.1 Endpoint

The Claude Agent SDK node **is the end node**. There is no separate relay. Its `webhook` (GET/POST) is registered at `path: {{$nodeId}}` and handles streaming, HITL approvals, and HITL question forms from the same URL.

- Source: `nodes/ClaudeAgentSdk/node/description.ts:64`
- Handler: `nodes/ClaudeAgentSdk/node/webhook.ts:48`

```
GET  /webhook/<nodeId>?format=stream&streamKey=<key>&cursor=<seq>&limit=<n>&replay=true
GET  /webhook/<nodeId>?requestId=<id>&approved=true|false      (approval click)
POST /webhook/<nodeId>?requestId=<id>                          (approval/question form)
```

### 1.2 NDJSON framing

The server responds with **newline-delimited JSON** (`application/x-ndjson`). One frame per line, terminated by `\n`.

Response headers (`replayService.ts:18`):

```
Content-Type: application/x-ndjson
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### 1.3 Frame envelope

Every line on the wire is a **frame** with this shape (`streamTransport.ts:4`):

```json
{
  "type": "begin" | "item" | "end" | "error",
  "seq": 42,
  "streamKey": "stream_abc123",
  "createdAt": "2026-04-11T10:30:01.500Z",
  "content": <unknown>
}
```

| Field | Type | Description |
|---|---|---|
| `type` | enum | Frame kind: `begin` (stream opened), `item` (payload), `end` (stream closed), `error` |
| `seq` | int ≥ 1 | Monotonic sequence inside the stream. Use for resume-from-cursor. |
| `streamKey` | string | Stream identifier (same as the one in your request) |
| `createdAt` | ISO-8601 | Server timestamp when the frame was appended |
| `content` | any | **The payload.** Present only when `frame.payload !== null`. Omitted for `begin`/`end` frames without content. |

All the "content types" in this document describe the shape of `content` on `type: "item"` frames.

### 1.4 Query parameters

| Param | Required | Default | Meaning |
|---|---|---|---|
| `format` | yes (for streaming) | — | Must be `stream` |
| `streamKey` | yes | — | Stream identifier, or falls back to `requestId` |
| `cursor` | no | `0` | Resume from this `seq`; replays everything `> cursor` |
| `limit` | no | `500` | Max frames per replay batch (1–2000) |
| `replay` | no | — | Forces replay-only mode (set to `true`) |
| `requestId` | no | — | Correlation id for approval/question flows |

### 1.5 Replay + tail

`replayService.replayToResponse` (lines 33–100):

1. Loads stream state from Postgres. Unknown key → `404`-style response body + close.
2. Writes all frames where `seq > cursor`, bumping `cursor` as it goes.
3. If stream status is `live` or `paused_hitl`, attaches the HTTP response to the in-memory `ResponseStore` so live `sendChunk` calls deliver to it.
4. Performs a gap-fill read from Postgres to close the race between the last DB read and live attach.
5. Closes the response immediately if the stream is already `completed`, `failed`, or `expired`.

**Durability.** Every frame is persisted before (or alongside) live delivery (`durableSendChunk.ts:86`). Clients can always resume by calling the same endpoint with `cursor=<lastSeq>`.

### 1.6 Stream states

From `streamTypes.ts:1`:

```
live          — stream open, emitting frames
paused_hitl   — blocked waiting for approval / user question
completed     — finished successfully
failed        — finished with error
expired       — retention TTL elapsed
```

Clients can tail `live` and `paused_hitl`; the other three are terminal.

---

## 2. Emission modes

The node emits content in one of two modes, chosen per-execution via the **Use Text Markers** toggle (`properties.ts:42`). This document focuses on the recommended **JSON mode**.

### 2.1 JSON mode (default, recommended)

`useMarkers: false`. Each `item` frame carries a structured object as `content`. Every payload is **self-describing via its own `type` field** (e.g. `"tool_call"`, `"structured_output_delta"`, `"assistant"`).

There is one exception: **plain text deltas are emitted as raw strings**, not objects (`StreamingHandler.ts:208`). If you see `content: "Hello "` on the wire, that is a text delta.

### 2.2 Marker mode (legacy / chat-bubble friendly)

`useMarkers: true`. Every `item` frame carries a **string** which either *is* a text delta or is a structured event wrapped in text markers like `[TOOL_CALL:{...}]…[/TOOL_CALL]`. Markers come in three flavours:

- `jsonMeta` (default when markers are on): `[TOOL_CALL:{"name":"Read","id":"tool-1"}]{...input...}[/TOOL_CALL]`
- `simple`: `[TOOL_CALL:Read]...[/TOOL_CALL]`
- `custom`: caller-provided templates with `{name}`, `{id}`, `{type}`, `{subtype}`, `{success}` placeholders

Defaults: `types.ts:456` (jsonMeta) and `types.ts:476` (simple). See §5 for the full marker dictionary.

> **Rule of thumb.** Use JSON mode for structured UIs and typed consumers. Use marker mode when you are concatenating into a single chat bubble and want readable inline tags.

---

## 3. Content type catalogue

Every entry below lists:

- **UI label** — the pill name in the n8n node UI
- **Config value** — the string you pass in `streamingContentTypes`
- **Trigger** — what SDK event produces it
- **JSON mode shape** — literal `content` object on the wire
- **Marker mode shape** — the string form (when applicable)

Enum source: `types.ts:296`. Handler source: `StreamingHandler.ts` + `handler/*.ts`.

---

### 3.1 Text Only — `text`

**Trigger.** `stream_event` deltas of type `text_delta` (`streamEvents.ts:65`). Also used for managed-agent text fallbacks.

**JSON mode.** Raw string payload — **not** an object.

```json
{"type":"item","seq":7,"streamKey":"s_1","createdAt":"...","content":"Hello "}
{"type":"item","seq":8,"streamKey":"s_1","createdAt":"...","content":"world!"}
```

**Marker mode.** Same — plain string, no wrapping (`StreamingHandler.ts:206`).

> Concatenating all `content` strings from consecutive `text` frames reconstructs the assistant's visible message.

---

### 3.2 Structured Output — `structuredOutput`

**Trigger.** `result` message that contains a `structured_output` field. Fires once at the end of a run (`StreamingHandler.ts:376`).

**JSON mode.**

```json
{
  "type": "structured_output",
  "content": { "answer": 42, "confidence": 0.9 }
}
```

> `content.content` is the full structured object, not a delta.

**Marker mode.** No dedicated marker — wrapped in `jsonMsgStart`/`jsonMsgEnd` with `type=structured_output`.

---

### 3.3 Structured Output (Streaming) — `structuredOutputDelta`

**Trigger.** `stream_event` `input_json_delta` chunks when the in-flight tool is the reserved `StructuredOutput` tool (`streamEvents.ts:70`, `handler/streamEvents.ts:5`).

**JSON mode.**

```json
{
  "type": "structured_output_delta",
  "delta": "{\"answer\":4",
  "sequence": 1,
  "contentBlockIndex": 0
}
```

| Field | Meaning |
|---|---|
| `delta` | Raw partial JSON chunk from the model |
| `sequence` | Monotonic counter (starts at 1), per execution |
| `contentBlockIndex` | Which content block this delta belongs to |

Concatenating all `delta` strings for a given `contentBlockIndex` reconstructs the final JSON. Consumers can do incremental parsing (e.g. with a streaming JSON parser).

---

### 3.4 All SDK Messages — `all`

**Trigger.** Wildcard. Matches every SDK message. `shouldStream('all')` short-circuits all other filters (`messageStreaming.ts:54`).

**JSON mode.** The SDK message is emitted **verbatim** as `content`. Shape depends on the underlying message type (see §3.5–§3.14).

> Think of `all` as "give me every SDK event, I'll filter client-side".

---

### 3.5 Assistant Messages — `assistant`

**Trigger.** `message.type === 'assistant'`. Complete assistant turn (after all deltas have assembled into blocks).

**JSON mode.** SDK message emitted **verbatim**. Canonical shape:

```json
{
  "type": "assistant",
  "uuid": "msg_01AB...",
  "parent_tool_use_id": null,
  "message": {
    "id": "msg_01AB...",
    "role": "assistant",
    "model": "claude-sonnet-4-5",
    "content": [
      { "type": "text", "text": "I'll read the file." },
      { "type": "tool_use", "id": "toolu_01", "name": "Read", "input": {"file_path": "/a.ts"} }
    ],
    "stop_reason": "tool_use",
    "usage": { "input_tokens": 123, "output_tokens": 45 }
  }
}
```

---

### 3.6 User Messages — `user`

**Trigger.** `message.type === 'user'`. Emitted for the initial prompt and for tool-result round-trips back to Claude.

**JSON mode.** SDK message verbatim.

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "tool_result", "tool_use_id": "toolu_01", "content": "file contents", "is_error": false }
    ]
  }
}
```

> **HITL noise filter.** User messages whose `tool_use_result` contains an internal HITL coordination marker or the string `"User rejected tool use"` are suppressed before emission (`messageStreaming.ts:74`). This keeps client UIs clean during approval flows.

---

### 3.7 Result Messages — `result`

**Trigger.** `message.type === 'result'`. Emitted once per run with usage and final output.

**JSON mode.** Verbatim SDK message.

```json
{
  "type": "result",
  "subtype": "success",
  "total_cost_usd": 0.0124,
  "usage": { "input_tokens": 2345, "output_tokens": 678 },
  "duration_ms": 4120,
  "num_turns": 3,
  "session_id": "sess_01...",
  "structured_output": { "answer": 42 },
  "result": "Done."
}
```

---

### 3.8 System: Init — `system:init`

**Trigger.** `message.type === 'system'` AND `message.subtype === 'init'`. Matched via the `type:subtype` combo rule (`messageStreaming.ts:64`).

**JSON mode.** Verbatim.

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "sess_01...",
  "tools": ["Read","Write","Bash","..."],
  "model": "claude-sonnet-4-5",
  "permissionMode": "default",
  "cwd": "/workspace",
  "mcp_servers": [
    { "name": "github", "status": "pending" },
    { "name": "filesystem", "status": "connected" }
  ]
}
```

Use this frame to grab the `session_id` for later resumption. MCP server statuses may be `pending` before the SDK reports a later connected/error state.

---

### 3.9 System: Status — `system:status`

**Trigger.** `system` message with `subtype === 'status'` (e.g. requesting, compacting, auto-compact warning).

```json
{ "type": "system", "subtype": "status", "status": "requesting" }
```

The SDK can also emit structured retry notices. `system:api_retry` frames include the retry reason; current SDKs distinguish overloaded API retries from rate-limit retries.

```json
{ "type": "system", "subtype": "api_retry", "error": "overloaded", "retry_after_ms": 1000 }
```

---

### 3.10 System: Task Started — `system:task_started`

**Trigger.** `system` / `task_started` — subagent/background task lifecycle begin.

```json
{
  "type": "system",
  "subtype": "task_started",
  "task_id": "task_01",
  "parent_tool_use_id": "toolu_01",
  "agent_name": "CodeReviewer"
}
```

---

### 3.11 System: Task Progress — `system:task_progress`

**Trigger.** `system` / `task_progress` — periodic progress inside a task, with cumulative usage.

```json
{
  "type": "system",
  "subtype": "task_progress",
  "task_id": "task_01",
  "usage": { "input_tokens": 1200, "output_tokens": 340 }
}
```

`system:task_updated` is also available for SDK 0.3.x task-state changes:

```json
{
  "type": "system",
  "subtype": "task_updated",
  "task_id": "task_01",
  "status": "in_progress"
}
```

---

### 3.12 System: Task Notification — `system:task_notification`

**Trigger.** `system` / `task_notification` — terminal state of a task (completed/failed/stopped).

```json
{
  "type": "system",
  "subtype": "task_notification",
  "task_id": "task_01",
  "status": "completed"
}
```

`system:permission_denied` is also available for SDK permission-denial frames. Enable `system` for all system frames or the specific content type for a narrower stream.

---

### 3.13 Stream Events (Deltas) — `stream_event`

**Trigger.** `message.type === 'stream_event'`. Real-time Anthropic SSE deltas surfaced by the SDK. This is the raw feed that drives both `text` and `structuredOutputDelta` emitters.

**JSON mode.** Verbatim.

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": { "type": "text_delta", "text": "Hel" }
  },
  "parent_tool_use_id": null
}
```

Handler reacts to three `event.type`s (`handler/streamEvents.ts:37`):

- `content_block_start` — reserves tool/StructuredOutput context for the block index
- `content_block_delta` — dispatches `text_delta` → `streamText`, `input_json_delta` → tool-input accumulator (and `structured_output_delta` if the tool is StructuredOutput)
- `content_block_stop` — finalises the accumulated tool-use block and emits a `tool_call`

> **Volume warning.** Enabling `stream_event` is noisy. Prefer `text` + `structuredOutputDelta` unless you're building a debugger.

---

### 3.14 Tool Progress — `tool_progress`

**Trigger.** `message.type === 'tool_progress'` — mid-tool progress callbacks.

```json
{
  "type": "tool_progress",
  "tool_use_id": "toolu_01",
  "message": "Running npm install (45/200 packages)"
}
```

---

### 3.15 Auth Status — `auth_status`

**Trigger.** `message.type === 'auth_status'` — SDK auth state changes (e.g. OAuth refresh, managed-agent auth handshake).

```json
{ "type": "auth_status", "status": "authenticated", "method": "oauth" }
```

---

### 3.16 Prompt Suggestions — `prompt_suggestion`

**Trigger.** `message.type === 'prompt_suggestion'`. Requires the `Enable Prompt Suggestions` toggle on the node to be set; otherwise the SDK never produces these messages.

```json
{
  "type": "prompt_suggestion",
  "suggestions": [
    "What's the next step?",
    "Run the tests now"
  ]
}
```

---

### 3.17 Execution Metadata — `executionMetadata`

**Trigger.** Emitted **once, at the start** of execution before any SDK messages (`StreamingHandler.ts:343`).

**JSON mode.**

```json
{
  "type": "execution_metadata",
  "executionId": "exec_01",
  "timestamp": "2026-04-11T10:30:00.000Z",
  "correlationId": "req_abc",
  "streamKey": "stream_abc123"
}
```

> Pin this to the top of your UI so every other frame has a stable execution context.

---

### 3.18 Permission Requests — `permission_request`

**Trigger.** `canUseToolCallback` fires when a tool call needs human approval. Emitted via the **Universal Approval Chunk v1 (UAC v1)** schema (`handler/approvals.ts:42`).

**JSON mode.**

```json
{
  "schema": "n8n.approval.v1",
  "event": "request",
  "request": {
    "id": "approval_01",
    "kind": "tool_approval",
    "sessionId": "sess_01",
    "expiresAt": "2026-04-11T10:35:00.000Z"
  },
  "tool": {
    "name": "Bash",
    "useId": "toolu_01",
    "input": { "command": "rm -rf /tmp/cache" }
  },
  "actions": {
    "approveUrl": "https://…/webhook/<nodeId>?requestId=approval_01&approved=true",
    "denyUrl":    "https://…/webhook/<nodeId>?requestId=approval_01&approved=false"
  },
  "display": {
    "title": "Approve Bash?",
    "summary": "rm -rf /tmp/cache"
  }
}
```

**Tool summary rules** (`handler/approvals.ts:13`):

| Tool | Summary |
|---|---|
| `Bash` | `input.command` truncated at 80 chars |
| `Write` | `Write to {file_path}` |
| `Edit` | `Edit {file_path}` |
| `Read` | `Read {file_path}` |
| `mcp__<server>__<tool>` | `MCP: <server>.<tool>` |
| default | First input field value (≤ 60 chars) |

**Client workflow.**

1. Render `display.title` + `display.summary`. Show full `tool.input` in a reveal.
2. Decision options:
   - **Recommended browser/client path:** POST a strict `approval_response` envelope back to your public workflow webhook / loopback endpoint with the same `sessionId`, then render the resumed stream from that response.
   - **Direct node webhook / no-JS fallback:** `GET actions.approveUrl` or `GET actions.denyUrl`.
   - **Direct node webhook with feedback:** `POST /webhook/<nodeId>?requestId=<id>` with JSON body `{"approved": true|false, "reviewerMessage": "...", "updatedInput": {...}}` (`webhook.ts:244`). `updatedInput` lets the reviewer tweak the tool call before it runs.
3. After your request completes, the server emits the corresponding `approval_response` frame on the same stream.

> **Idempotency.** A given `requestId` can only be answered once. Retries with the same decision key return `duplicate`; conflicting answers return `conflict` (`webhookHelpers.ts:145`).
>
> **Preview timing.** The first in-stream `permission_request` may be an early preview emitted before `putExecutionToWait()` completes. Render it immediately, but prefer the main-webhook loopback pattern for browser clients. External automations should still key off the authoritative wait state or post-wait notification.

**Marker mode.** Wrapped in the `jsonMsgStart`/`jsonMsgEnd` markers with `type=approval_request`.

---

### 3.19 User Questions — `ask_user_question`

**Trigger.** Claude calls the `AskUserQuestion` tool. Also UAC v1 (`handler/approvals.ts:68`).

**JSON mode.**

```json
{
  "schema": "n8n.approval.v1",
  "event": "request",
  "request": {
    "id": "question_01",
    "kind": "user_question",
    "sessionId": "sess_01",
    "expiresAt": "2026-04-11T10:35:00.000Z"
  },
  "questions": [
    {
      "header": "Deploy target",
      "question": "Which environment should I deploy to?",
      "multiSelect": false,
      "options": [
        { "label": "Staging", "description": "Safe rollout", "action": "resume" },
        { "label": "Production", "description": "Live users", "action": "resume" },
        { "label": "Cancel", "description": "Abort deploy", "action": "complete" }
      ]
    }
  ],
  "actions": {
    "responseUrl": "https://…/webhook/<nodeId>?requestId=question_01&type=question"
  },
  "display": {
    "title": "Deploy target",
    "summary": "Which environment should I deploy to?"
  }
}
```

**Option fields.**

| Field | Meaning |
|---|---|
| `label` | Short button text |
| `description` | Longer help text for the option |
| `value` | Optional override for the wire value (defaults to `label`) |
| `action` | `resume` (pass the answer back to the agent and continue) or `complete` (end the task) |

**Client workflow.**

- **Recommended browser/client path:** POST a strict `question_response` envelope back to your public workflow webhook / loopback endpoint with the same `sessionId`.
- **Direct node webhook / form-post path:** POST the form back to `actions.responseUrl` with `field-0=<chosen>&field-1=…&responseAction=resume|complete`. Multi-select fields can be sent as multiple values or a comma-joined string — the server normalises both (`webhookHelpers.ts:176`).

---

### 3.20 Approval Responses — `approval_response`

**Trigger.** Server-side echo emitted on the same stream after an approval/question decision is consumed (`handler/approvals.ts:138`).

**JSON mode.**

```json
{
  "schema": "n8n.approval.v1",
  "event": "response",
  "request": {
    "id": "approval_01",
    "kind": "tool_approval",
    "sessionId": "sess_01"
  },
  "approved": true,
  "timestamp": "2026-04-11T10:31:15.000Z"
}
```

Additional optional fields on the full `ApprovalResponseContent` / `ApprovalChunkV1Response` type (`types.ts:106`, `types.ts:204`):

- `answers` — `{ field-0: "Staging", field-1: "yes" }` for `user_question` responses
- `message` — free-form reviewer comment
- `updatedInput` — reviewer-modified tool input (tool_approval only)
- `permissionModeOverride` — if the reviewer bumped the session permission mode

---

### 3.21 Expired approvals (implicit)

UAC v1 also defines an `event: "expired"` shape (`types.ts:220`, `handler/approvals.ts:162`). The server emits it when an outstanding approval/question passes its `expiresAt`:

```json
{
  "schema": "n8n.approval.v1",
  "event": "expired",
  "request": { "id": "approval_01", "kind": "tool_approval", "sessionId": "sess_01" },
  "timestamp": "2026-04-11T10:35:00.000Z"
}
```

Treat it as "the request is dead, stop showing the prompt".

---

## 4. Client implementation checklist

A minimal consumer, in pseudocode:

```
POST your task to the node (usual n8n trigger / webhook)
→ you receive a streamKey from the response or from the executionMetadata frame

OPEN GET /webhook/<nodeId>?format=stream&streamKey=<key>&cursor=0&limit=500

LOOP over NDJSON lines:
    frame = JSON.parse(line)
    switch frame.type:
        case "begin": mark stream as live
        case "end":   mark stream as complete; close reader
        case "error": surface frame.content; close reader
        case "item":
            content = frame.content
            if typeof content == "string":
                append to current assistant message
            else:
                switch content.type or content.schema:
                    "execution_metadata":   pin exec id
                    "tool_call":            render tool card
                    "tool_result":          mark card resolved
                    "structured_output":    display final JSON
                    "structured_output_delta": feed into incremental parser
                    "assistant"|"user"|"result"|"system"|"stream_event": handle as SDK event
                    "tool_progress":        update tool card progress line
                    "subagent_start"|"subagent_end": open/close subagent bubble
                    "todo_update":          re-render todo list
                    "n8n.approval.v1":      switch on content.event (request/response/expired)
                    default:                log + display as generic JSON

ON disconnect / network error:
    reconnect with cursor = frame.seq of the last processed frame
```

### Reconnection

Because Postgres stores every frame, **reconnecting from a cursor is the primary resilience mechanism**. Drop a socket, retry the same URL with `cursor=<lastSeq>`, and you will never miss or duplicate a frame (frames are deduped by `seq`). Do this for idle timeouts, WebSocket-equivalent keepalives, and page reloads.

### Authentication

The endpoint supports optional per-node auth configured via the HITL webhook auth dropdown (`webhook/auth.ts`): none, Basic, Header, or JWT. The same credentials gate `format=stream` replays and approval POSTs.

---

## 5. Marker mode reference

For chat-bubble UIs that want a single text column with inline tags, `useMarkers: true` wraps every structured payload in readable markers. Defaults:

### JSON-metadata markers (`types.ts:456`)

| Event | Start template | End template |
|---|---|---|
| Tool call | `[TOOL_CALL:{"name":"{name}","id":"{id}"}]` | `[/TOOL_CALL]` |
| Tool result | `[TOOL_RESULT:{"name":"{name}","id":"{id}","success":{success}}]` | `[/TOOL_RESULT]` |
| Subagent start | `[SUBAGENT_START:{"name":"{name}","id":"{id}"}]` | — |
| Subagent end | `[SUBAGENT_END:{"name":"{name}","id":"{id}"}]` | — |
| Subagent text block | `[SUBAGENT_MSG:{"name":"{name}"}]` | `[/SUBAGENT_MSG]` |
| Todo update | `[TODO:{"action":"update"}]` | `[/TODO]` |
| User message | `[USER_MSG]` | `[/USER_MSG]` |
| Generic JSON message | `[MSG:{"type":"{type}","subtype":"{subtype}"}]` | `[/MSG]` |

Placeholders: `{name}`, `{id}`, `{type}`, `{subtype}`, `{success}` (`StreamingHandler.ts:62`).

### Simple markers (`types.ts:476`)

Same set with bare `[TOOL_CALL:{name}]` / `[TOOL_RESULT:{name}]` etc. Use when you just want a keyword and don't care about IDs.

### Custom

Override any template via the Custom Markers collection in the node UI. Unchanged templates fall back to `DEFAULT_MARKERS_SIMPLE` values.

---

## 6. Legacy content types

These predate the SDK-message-passthrough approach. They still work and map to the helper emitters, but new clients should prefer the SDK message types above.

| Legacy value | What it emits (JSON mode) | Equivalent modern value |
|---|---|---|
| `toolCalls` | `{type: "tool_call", name, id, input?}` (`handler/toolStreaming.ts:64`) | Inspect `assistant` → `content[].tool_use` or `stream_event` |
| `toolResults` | `{type: "tool_result", name, id, success, result?}` (`handler/toolStreaming.ts:131`) | Inspect `user` → `content[].tool_result` |
| `subagentLifecycle` | `{type: "subagent_start"\|"subagent_end", name, id}` (`handler/subagentStreaming.ts:103`) | `system:task_started` / `system:task_notification` |
| `subagentMessages` | Raw text strings emitted with `parent_tool_use_id` attribution. For full nested subagent transcripts, enable Additional Options → Forward Subagent Text. | `stream_event` with `parent_tool_use_id` |
| `todos` | `{type: "todo_update", todos: [...]}` (`StreamingHandler.ts:311`) | Watch Task tool calls via `assistant`; `TodoWrite` remains for historical transcripts |
| `userMessages` | `{type: "user_message", text}` (`StreamingHandler.ts:228`) | `user` SDK message |
| `allJson` | `{type: "json_message", messageType, subtype?, message}` (`messageStreaming.ts:36`) | `all` |

All legacy types are still in the `StreamContentType` union (`types.ts:320`), so config strings remain stable.

---

## 7. Tool filtering (applies to legacy `toolCalls`/`toolResults`)

The tool filter only gates the legacy tool-call/result emitters — SDK message passthrough always includes their embedded `tool_use`/`tool_result` blocks.

Config (`types.ts:371`):

```
toolFilter: {
  mode: 'all' | 'categories' | 'specific',
  categories: Set<'file'|'bash'|'web'|'agent'|'mcp'>,
  specificTools: Set<string>
}
```

Category membership (`types.ts:360`):

```
file:  Read, Write, Edit, Glob, Grep, NotebookEdit
bash:  Bash, BashOutput, KillShell
web:   WebFetch, WebSearch
agent: Task, TaskCreate, TaskGet, TaskList, TaskOutput, TaskUpdate, TodoWrite, AskUserQuestion, Monitor, Skill, SlashCommand, EnterPlanMode, ExitPlanMode
mcp:   prefix-matched on "mcp__"
```

`specific` mode accepts exact names or the `mcp__*` wildcard.

---

## 8. Display settings (truncation & redaction)

`toolInputDisplay` / `toolResultDisplay` (`types.ts:339`):

- `full` — raw object / string
- `truncated` — stringified, cut at `truncationLimit` (default **500**) with `...` suffix
- `nameOnly` / `summary` — omit `input` / `result` field entirely

Applied inside `emitToolCall` / `emitToolResult` (`handler/toolStreaming.ts:46`, `:112`). Truncation happens **before** the frame is persisted to Postgres, so replayed frames are also truncated.

---

## 9. Failure modes a client must handle

| Situation | Frame you'll see | What to do |
|---|---|---|
| Unknown `streamKey` | empty response, connection closes | Show "stream not found"; do not retry |
| Stream already terminal | replays all historical frames, then closes | Render the full transcript; no live updates |
| Server evicts response (idle > 5 min, 200-limit LRU) | silent socket close | Reconnect with `cursor=<lastSeq>` |
| Duplicate approval click | server responds with plain text "already answered" | Drop the duplicate; UI should debounce |
| Conflicting approval decision | server responds with "already answered with a different response" | Reload the approval state from the stream |
| `updatedInput` not a plain object | `400` plain-text error | Validate client-side before POSTing |
| Postgres unavailable | `Error: Durable replay is unavailable…` | Fall back to live-only mode without replay |

---

## 10. Source map (for reviewers)

| Concern | File |
|---|---|
| Frame envelope + NDJSON writer | `nodes/ClaudeAgentSdk/streaming/streamTransport.ts` |
| Stream state / event type enums | `nodes/ClaudeAgentSdk/streaming/streamTypes.ts` |
| Zod schemas | `nodes/ClaudeAgentSdk/streaming/streamSchemas.ts` |
| Replay + tail-live | `nodes/ClaudeAgentSdk/streaming/replayService.ts` |
| Durable sendChunk + live delivery | `nodes/ClaudeAgentSdk/streaming/durableSendChunk.ts` |
| Active HTTP response registry | `nodes/ClaudeAgentSdk/streaming/ResponseStore.ts` |
| Postgres frame log | `nodes/ClaudeAgentSdk/streaming/PostgresStreamStore.ts` |
| Content type union + UAC v1 types | `nodes/ClaudeAgentSdk/streaming/types.ts` |
| UI content-type selector | `nodes/ClaudeAgentSdk/streaming/properties.ts` |
| Top-level emitter | `nodes/ClaudeAgentSdk/streaming/handler/StreamingHandler.ts` |
| SDK message passthrough + HITL filter | `nodes/ClaudeAgentSdk/streaming/handler/messageStreaming.ts` |
| stream_event handler (deltas, tool-use accumulation, structured-output detection) | `nodes/ClaudeAgentSdk/streaming/handler/streamEvents.ts` |
| Tool call / result serialisation | `nodes/ClaudeAgentSdk/streaming/handler/toolStreaming.ts` |
| Subagent lifecycle + text attribution | `nodes/ClaudeAgentSdk/streaming/handler/subagentStreaming.ts` |
| UAC v1 approval builders | `nodes/ClaudeAgentSdk/streaming/handler/approvals.ts` |
| Tool filter resolution | `nodes/ClaudeAgentSdk/streaming/handler/toolFilter.ts` |
| Webhook registration | `nodes/ClaudeAgentSdk/node/description.ts` |
| Webhook dispatcher (replay / approval / question) | `nodes/ClaudeAgentSdk/node/webhook.ts` |
| Webhook helpers (`resolveStreamKey`, `attachStreamResponse`, decision ledger) | `nodes/ClaudeAgentSdk/node/webhookHelpers.ts` |
| Question form GET/POST | `nodes/ClaudeAgentSdk/node/webhookQuestionHandlers.ts` |
| HITL webhook auth | `nodes/ClaudeAgentSdk/webhook/auth.ts` |
