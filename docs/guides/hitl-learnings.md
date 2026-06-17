# HITL (Human-In-The-Loop) Learnings

Current state as of 2026-06-12. For full chronological history see `archive/HITL-LEARNINGS-FULL-HISTORY.md`.

---

## Hard Rules (always enforced)

### Wait/Resume Ownership
- SDK node MUST call `putExecutionToWait()`. Cannot be delegated to companion nodes (n8n only checks webhooks on `lastNodeExecuted`).
- **Resume timing:** Signed HITL / `webhook-waiting` URLs must not be **acted on** (HTTP resume) until after `putExecutionToWait()` resolves, or n8n can return **409** (“execution finished already”).
- **NDJSON streaming:** The SDK may emit an **early in-stream copy** of approval/question payloads when `canUseTool` runs so UIs can render buttons immediately. That preview is **not** the signal that the execution is waiting. The authoritative post-wait path still runs in `waitForPendingInteractions` (duplicate stream sends for the same interaction are suppressed via `notifiedImmediately`). External automations should key off execution state or the post-wait channel, not only the first stream line.

### Session Identity
- `chatSessionId` IS the Claude session ID (deterministic mode, since 2026-03-05).
- Session memory role: existence check + metadata only. No `chatSessionId -> claudeSessionId` mapping at runtime.
- Execute-task uses `has(chatSessionId)` / `touch(chatSessionId, ...)`.
- Stale memory rows are cleared when transcript files are missing under resolved Claude config dir.
- **Multi-worker:** Postgres session memory provides per-session advisory `acquireExecutionLock` for the SDK execute lifecycle. Simple (in-process) and Redis session memory do **not**; same `chatSessionId` on multiple queue workers can race.

### HITL Resume
- Use `resume` only, NO `forkSession`. Session is in valid state (denied tool_use + error tool_result are committed).
- Send minimal continuation prompt (session already has history).
- Approval resumes are state-driven, not prompt-driven. Keep the canonical task unchanged and use a neutral execution prompt for the resumed Claude call.
- Do not tell Claude to ignore prior `STOP` / rejection messages. That can be read as prompt injection and break otherwise valid approval resumes.
- For non-HITL resume failures, retry fresh (clear `resume` + `sessionId`). Do NOT retry HITL approval resumes.
- `resumeSessionAt` is best-effort optimization; fall back to plain `resume` if anchor UUID unavailable.
- Fingerprint pre-approval still needed (model generates new tool_use block IDs on retry).

### Stream Continuity
- `streamKey` is the durable streaming identity. It stays stable across the initial execution, HITL pause, HITL resume, and terminal completion.
- Live HTTP responses are best-effort only. Missing `ResponseStore` state must be recoverable through Postgres replay.
- Replay requests use the existing webhook path with `format=stream`, `streamKey`, optional `cursor`, and `replay=true`.
- Durable stream replay depends on a Postgres credential because `claude_streams` and `claude_stream_events` are the recovery source of truth.

### HITL Interaction Authority
- For SDK webhook HITL, the authoritative source of truth is now the persisted interaction record, not signed query params.
- Interactions are saved before wait/notify with stored session IDs, stream key, approved fingerprints, replay anchor, and canonicalized question definitions.
- Webhook consume is decision-aware and idempotent at the interaction-store layer (`accepted` / `duplicate` / `conflict`), including process restarts when Postgres is configured.
- SDK HITL webhooks can optionally require `Basic Auth`, `Header Auth`, or `JWT Auth` before any replay attach, request lookup, or decision consume.
- Optional responder identity can be bound from the Basic Auth username, a trusted proxy-injected header, or a verified JWT claim and is emitted on accepted HITL response envelopes as `responder`.
- Postgres-backed interaction storage is the production path. Static data remains a best-effort fallback for local/dev workflows without a Postgres credential.

### Frontend vs Channel Architecture
- Browser/webhook clients should use SDK-owned wait/resume (`sdkOwnsWaitResume=true`) and post strict `approval_response` / `question_response` envelopes back to the main webhook.
- Channel nodes (`Claude Agent Slack`, `Claude Agent Telegram`, `Claude Agent WhatsApp`, `Claude Agent Discord`, `Claude Agent Email`, `Claude Agent Gmail`, `Claude Agent Woztell`) are for responders that live outside the web client. They sit off the SDK's single `Result` output, filter for HITL request items, and loop back into the SDK webhook with `approval_response` / `question_response` envelopes.
- In `waitForReply` mode, channel nodes must persist pending state and wait for `putExecutionToWait()` to resolve before generating or sending signed resume URLs. `dispatchAndExit` remains the durable, SDK-owned pattern for messaging channels that do not keep the source execution open.
- Do not copy channel-node wiring into a browser client. For web UIs, keep the workflow shape as `Webhook -> Claude Agent SDK` plus session memory.
- The former generic `Claude Agent HITL` companion node (a 4-output router) is gone. The SDK now emits approval/question/terminal items on the same `Result` output; branching happens either in a downstream channel node or via an `If` / `Switch` node keyed on `json.type`.

### AskUserQuestion Interception
- `AskUserQuestion` must NOT be in `allowedTools` when `handleAskUserQuestion` is enabled. SDK auto-approves tools in `allowedTools` without calling `canUseTool`.
- Strip it before passing to SDK so `canUseTool` fires → creates pending interaction → denies with `interrupt: true`.
- The current Claude Code `AskUserQuestion` tool schema still requires at least two options. For true free-text questions, use the sentinel pair `__free_text__` / `__free_text_alt__` as option values and let the SDK/webhook layer render that shape as a textarea.
- The first pending HITL interaction in an execution is authoritative. Later tool attempts in the same run are denied server-side, and the execution loop stops consuming further SDK output.
- On SDK V1/query flows, the node now calls the upstream `query.interrupt()` control request once a pending HITL interaction is observed, reducing wasted tokens after pause.

### AGT + HITL Ordering
- Direct MCP tools can pause through `canUseTool` in the SDK query flow.
- AGT `PreToolUse` hooks must return a neutral result on allow. If a hook returns an explicit `permissionDecision: 'allow'`, the SDK treats the tool call as already approved and never hands it to `canUseTool`.
- Use AGT hooks for hard deny / fail-closed approval requirements, and let HITL own the actual pause/resume path for tools listed under `Approval Tool Names or IDs`.
- Approval resumes should rely on `pendingApprovalResolution`, `resume`, `resumeSessionAt`, and approved fingerprints. The model-facing prompt should stay neutral; machine state carries the approval semantics.

### SDK Option Mutual Exclusivity

| Option | Can combine with | Mutually exclusive with |
|--------|-----------------|------------------------|
| `resume` | `forkSession`, `resumeSessionAt` | `continue` |
| `sessionId` | (standalone) | `continue`, `resume` (unless `forkSession`) |
| `forkSession` | `resume` | (requires `resume`) |
| `continue` | (standalone) | `resume`, `sessionId` |

### HITL Envelope Contract (v1.0)
- `version: "1.0"`, `type: "approval_response" | "question_response"` required.
- `requestId`, `decisionId`, `decidedAt`, `channel` required.
- `approved` required for approvals. Non-empty `answers` required for questions.
- `responder` is optional and, when present, must include `id`, `source`, and `authMode`.
- Channel nodes enforce strict ingress/egress envelopes.
- Approval query parsing is strict across webhook ingress: only explicit `approved=true|false` is accepted.
- Duplicate/conflicting approval replies use decision-aware consume semantics (`duplicate`/`conflict`), including email/gmail.

---

## Current Architecture (March 2026)

### Channel Nodes
- WhatsApp, Telegram, Slack, Email, Gmail, Discord, Woztell — all use the shared channel core (`nodes/ClaudeAgentChannelShared/core/`).
- Two continuation modes: `dispatchAndExit` (durable, recommended for messaging) and `waitForReply` (web streaming).
- WhatsApp supports `interactiveReplyButtons` with native `hitl|...` reply IDs.
- Durable mode: persist pending + send message + exit. Reply handled by separate execution.
- `waitForReply` mode: persist pending, then call `putExecutionToWait()`, then sign/send the waiting URL. Sending or acting on signed resume links before n8n has entered wait state is invalid and can produce 409 responses.
- Pending store backends: `staticData` (default) or `postgres` (durable).

### SDK HITL Request Envelopes
- Include `hitl_result` / `agent_sdk_result` context payload.
- Question messages include assistant summary + pending question.
- WhatsApp sends summary as separate text before interactive payload.
- Single-question dedupe removes duplicate trailing question text.
- Multiple questions degrade to text (no interactive card).

### Resume Answer Injection
- `question_response` answers injected via SDK-native `updatedInput.answers` on first resumed `AskUserQuestion`.
- Deterministic key-based matching only (question text → header → `"header: question"` → legacy `field-N`).
- Blank/placeholder answers are invalid; fall back to standard HITL pause.
- Option-label compatibility required before auto-allow (blocks stale indexed answers).
- `AskUserQuestion` is for collecting user input, not for universally deterministic terminal control.
- If the human decision is truly binary (`approve / deny`), use approval semantics instead of `AskUserQuestion`.
- SDK canonicalizes question options with stable internal `value` IDs before persisting/dispatching them.
- Webhook forms and companion channels now emit an explicit `responseAction` alongside answer content, mirroring Claude Code's separate control/action channel for elicitation.
- Stored question definitions remain authoritative: the SDK validates or re-derives `responseAction` from the persisted interaction definition instead of trusting answer strings or client-submitted control values.
- `responseAction` is propagated through webhook/HITL envelopes from persisted interaction policy, not from signed query payloads.
- Generic terminal routing is now: emit `responseAction = "complete"` on the question response and let the SDK pass it through on `Result` without re-invoking Claude.
- This does not turn `AskUserQuestion` into a universal approval primitive. If an agent needs deterministic final acceptance across workflows, model that control as approval/denial or as app-owned UI rather than inferring terminality from free-form answer text.

### SDK Fallback Parsing
- Raw WhatsApp trigger payloads with `hitl|approve|...`, `hitl|deny|...`, `hitl|q|...` tokens parsed as strict envelopes.
- Prevents infinite loops in direct `WhatsApp Trigger -> Claude Agent SDK` flows.

### Two-Layer Persistence
1. **Session memory** — `chatSessionId` existence + metadata (Simple/Redis/Postgres nodes)
2. **Session persistence** — transcript JSONL durability in Postgres (`sessionPersistence`)

Note: Workspace persistence (S3/MinIO) was removed in v0.2.0; all persistence is now volume-based.

### Skill Tools
- In-process MCP skill-tool auto-loading (local CLI only).
- `Claude Skill Tool` node for picker-visible skill-backed tools.
- Supports runnable skills (subprocess) and frontmatter-only instruction skills.

## 2026-03-10 (Durable replayable HITL streaming)

- Added a Postgres-backed durable replay lane for streaming execution and HITL resume continuity.
- The durable stream key is now `stream:<executionId>:<itemIndex>` unless a pending HITL interaction already carried the canonical key forward.
- `ResponseStore` is now limited to active-socket attachment, idle cleanup, and bounded eviction. It no longer decides whether replay is possible.
- `execution_metadata` stream chunks now include `streamKey` so downstream clients can reconnect explicitly.
- The webhook supports replay-only reconnects before `requestId` validation when the client supplies `format=stream&streamKey=...&replay=true`.
- Deploy guidance now assumes Postgres durability for replayable streaming in addition to volume-backed Claude transcript persistence.

## 2026-03-10 (Authoritative persisted HITL interaction store)

- Added `claude_hitl_interactions` as the SDK-side authoritative interaction store when a Postgres credential is configured.
- SDK question/approval interactions are now persisted before wait/notify and upserted again once the live execution session ID is known.
- Webhook approval/question replies now resolve session metadata, stream key, approved fingerprints, replay anchor, and terminal `responseAction` from the stored interaction record.
- Signed query parameters (`sid`, `rsat`, `afps`, `q`) are now backward-compatible fallbacks rather than correctness sources.
- Static-data interaction storage remains for local/dev workflows without Postgres, but it is not restart-durable.

---

## Key Files

| File | Role |
|------|------|
| `operations/executeTask/index.ts` | Main loop, session mgmt, HITL wait/resume |
| `operations/executeTask/steps/interactiveApprovals.ts` | Approval/question setup, WhatsApp fallback parsing |
| `operations/executeTask/steps/pendingInteractions.ts` | Wait-for-pending + notification dispatch |
| `operations/executeTask/steps/querySetup.ts` | SDK query config assembly |
| `operations/executeTask/steps/runExecution.ts` | SDK process execution |
| `permissions/canUseToolCallback.ts` | Tool permission + HITL interception |
| `nodes/ClaudeAgentChannelShared/core/` | Shared companion runtime/store/types |
| `nodes/ClaudeAgentChannelShared/core/channelReplyContract.ts` | Channel-agnostic HITL resume contract |

## 2026-03-06 (Observability envelope on HITL wait outputs)

- Added bounded per-invocation observability capture in SDK execution flow.
- `task_result.observability` is now included on normal completion and on HITL wait payload context (`hitl_result` / `agent_sdk_result`) so resumed loops keep consistent trace context.
- HITL scan/wait/return milestones are recorded as observability events without changing wait/resume ownership semantics.

## 2026-03-06 (Companion pending-store now persists structured SDK invocation context)

- Companion channels now persist a compact `agentSdkResult` snapshot into pending-store payloads (`claude_hitl_pending.payload.agentSdkResult`) by default.
- Stored fields include invocation-proof signals (`toolCallCount`, sampled `toolCalls`), observability metadata (`observabilitySummary`, event counts/samples), and session/usage context.
- Large nested payloads are bounded/truncated in shared runtime before save to keep Postgres rows durable and queryable without storing full message transcripts.

## 2026-03-06 (Built-in Postgres persistence for invocation observability)

- Added optional Postgres persistence for `ClaudeAgentSdk` invocation observability events (in addition to `task_result.observability`).
- New execution settings:
  - `observabilityPersistenceBackend` (`auto` default, with `runDataOnly` and `postgres` overrides)
  - `observabilityPersistenceStrict` (`false` default)
  - `observabilityPostgresTable` (`claude_invocation_observability_events` default)
- `auto` mode attempts Postgres persistence when the node has a Postgres credential configured; otherwise it falls back to run-data-only behavior.
- Execution now attempts observability flush on all terminal paths:
  - normal completion,
  - HITL pause return path,
  - failure catch path (best-effort).
- Postgres writer uses `createPostgresConnectionHandle()`, validates existing schema before use, and creates table/indexes when missing.
- Metadata hints now include persistence outcome fields:
  - `agentObsPersistenceBackend`, `agentObsPersistenceAttempted`, `agentObsPersistencePersisted`,
  - `agentObsPersistenceRows`, `agentObsPersistenceTable`, `agentObsPersistenceError`.

## 2026-03-06 (Observability metadata hint writer binding fix)

- Fixed `setMetadata` invocation binding in `executeTask` observability metadata hints so n8n execution context is preserved.
- Eliminates noisy warning: `Failed to persist observability metadata hints: Cannot read properties of undefined (reading 'executeData')`.
- Postgres observability persistence behavior remains unchanged.

## 2026-03-06 (Deterministic session memory touch fallback when session_id is omitted)

- In `executeTask`, deterministic session metadata persistence now falls back to query session identity (`resume` or `sessionId`) when SDK messages omit `session_id`.
- Prevents repeated `memoryHas=false` loops and reduces bootstrap-collision retries for stable `chatSessionId` flows.

## 2026-03-06 (Deterministic bootstrap collision hardening)

- When deterministic bootstrap (`sessionId=chatSessionId`) collides and retry-with-`resume` also fails, SDK now applies the same non-HITL resume recovery policy: clear `resume`/`sessionId`/`resumeSessionAt` and retry fresh once.
- Resume corruption marker `Invalid \`signature\` in \`thinking\` block` is now treated as retryable-to-fresh for non-HITL flows, reducing repeated hard failures on poisoned resume transcripts.
- Observability retry events now include `retrySource` (`initial` vs `bootstrap_resume`) so production traces show which stage triggered fresh fallback.

## 2026-03-06 (Alibaba thinking safety defaults)

- Query setup now normalizes thinking options for Alibaba runs to avoid provider-side `thinking_budget` hard failures.
- When no explicit Alibaba thinking budget is configured, SDK now sends `thinking: { type: 'disabled' }` and suppresses `effort`/legacy thinking overrides.
- When an explicit budget is provided, it is clamped to Alibaba-compatible bounds (`1..38912`) before execution.
