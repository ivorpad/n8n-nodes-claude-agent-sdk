# HITL Learnings

This top-level file tracks the latest HITL behavior changes. Full operational history lives in `docs/guides/hitl-learnings.md`.

## 2026-04-18 (Companion node removed, SDK collapsed to single Result output, channel nodes renamed)

**Breaking change.** The generic `Claude Agent HITL` companion node (4 outputs: Approved / Denied / Answered / Complete) is deleted. The SDK's second `HITL` output is gone — `Claude Agent SDK` now emits everything (approval_request, question_request, question_response, task_result) on a single `Result` output (plus the optional `Audit Log` output when audit logging is enabled).

Channel nodes have been renamed (the "HITL" tag has been retired from their display names):

| Before | After |
|---|---|
| `Claude Agent HITL Slack` | `Claude Agent Slack` |
| `Claude Agent HITL Discord` | `Claude Agent Discord` |
| `Claude Agent HITL Telegram` | `Claude Agent Telegram` |
| `Claude Agent HITL Email` | `Claude Agent Email` |
| `Claude Agent HITL Gmail` | `Claude Agent Gmail` |
| `Claude Agent HITL WhatsApp` | `Claude Agent WhatsApp` |
| `Claude Agent HITL Woztell` | `Claude Agent Woztell` |

Channel nodes now sit directly downstream of the SDK's `Result` output. Their `execute()` filters items by `json.type` and silently skips anything that isn't an `approval_request` / `question_request`, so `task_result` items pass through without errors.

Browser/webhook HITL is unchanged: web clients POST strict `approval_response` / `question_response` envelopes to the main SDK webhook, which owns `putExecutionToWait()` via `sdkOwnsWaitResume=true`.

Migration for existing workflows: the deleted companion node and the old `claudeAgentHitl<Channel>` node types cannot be auto-migrated — rebuild affected workflows with the new channel nodes wired off `Result`.

## 2026-03-06 (Built-in Postgres persistence for invocation observability)

- `ClaudeAgentSdk` now supports optional Postgres persistence for invocation observability events.
- New execution settings:
  - `observabilityPersistenceBackend` (`auto` default, with `runDataOnly` and `postgres` overrides)
  - `observabilityPersistenceStrict` (`false` default)
  - `observabilityPostgresTable` (`claude_invocation_observability_events` default)
- `auto` mode attempts Postgres persistence when a Postgres credential is configured on the node, and otherwise keeps run-data-only persistence.
- Observability flush runs on completion, HITL pause return, and failure paths.
- Metadata now includes persistence outcome hints (`agentObsPersistence*`).

## 2026-03-06 (Observability metadata hint writer binding fix)

- Fixed metadata hint writing to keep n8n execution context binding when calling `setMetadata`.
- Removes spurious warning about missing `executeData` during metadata hint persistence.

## 2026-03-06 (Deterministic session memory touch fallback when session_id is omitted)

- Deterministic session metadata now uses a fallback session identity (`resume`/`sessionId`) when stream messages do not include `session_id`.
- Improves stability of repeated runs with fixed `chatSessionId` by reducing bootstrap collision loops.

## 2026-03-06 (Deterministic bootstrap collision hardening)

- If deterministic bootstrap collides and the follow-up `resume` attempt also fails, non-HITL flow now retries fresh once by clearing `resume`/`sessionId`/`resumeSessionAt`.
- Non-HITL resume now treats `Invalid \`signature\` in \`thinking\` block` as retryable-to-fresh to avoid repeated hard failures on corrupted replay context.

## 2026-03-06 (Alibaba thinking safety defaults)

- Alibaba executions now enforce safe thinking defaults in query setup to avoid provider `thinking_budget` failures.
- Without an explicit budget, SDK sends `thinking: { type: 'disabled' }` and does not forward `effort`/legacy thinking token overrides.
- Explicit budgets are clamped to Alibaba-supported bounds (`1..38912`) before invoking Claude Code.
