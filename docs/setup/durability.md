# HITL Durability Guardrails

This document describes the current, implemented durability behavior for HITL workflows (`Enable HITL = On`, code value `interactiveApprovals = pauseForApproval`).

## Current behavior

Durability is enforced by runtime guardrails in the SDK execute flow.

- `persistSession=false` + HITL fails fast.
- `executionBackend=remoteHttp` + `handleAskUserQuestion=true` fails fast.
- Wait/resume ordering is enforced so notification URLs are sent only after `putExecutionToWait()` succeeds.
- Streaming HITL continuity is durable only when a Postgres credential is available for stream persistence and replay.
- SDK webhook HITL continuity is authoritative only when a Postgres credential is available for persisted interaction records.
- Live socket continuity is best-effort. Reconnect correctness comes from replaying persisted frames with the same `streamKey`.

There is no separate node setting named `HITL Durability Validation` in the current SDK property surface.

## Recommended production setup

1. Keep `persistSession` enabled.
2. Use deterministic `chatSessionId` and a connected Session Memory node.
3. Configure transcript/workspace persistence options according to your environment.
4. Configure Postgres for durable replayable streaming if clients use `format=stream`.
5. Configure Postgres on the SDK node so approval/question interactions are persisted in `claude_hitl_interactions`.
6. For binary final acceptance, use approval semantics instead of `AskUserQuestion`.
   If a human choice is truly `approve / deny`, model it as approval so the routing is deterministic.
7. Run a multi-hop HITL flow (`approval/question -> resume -> approval/question -> resume`) before production rollout.
8. Validate reconnect with the same `streamKey` and a nonzero replay cursor after disconnect or restart.

## Validation checklist

1. Confirm runtime rejects invalid combinations:
   - HITL + `persistSession=false`
   - `remoteHttp` + AskUserQuestion handling enabled
2. Confirm webhook wait/resume path:
   - approve/deny and question responses resume correctly
   - duplicate/conflicting replies are handled idempotently
   - binary final approvals exit through the approval path without a model re-run
3. Confirm paused executions survive worker restart in your deployment model.
4. Confirm replay reconnect path:
   - reconnect with `format=stream&streamKey=<key>&cursor=<last-seen-seq>&replay=true`
   - replay starts after the acknowledged cursor
   - live tailing resumes when the stream is still active

## Troubleshooting

- **`Interactive approvals require session persistence`**:
  Enable `persistSession` in Additional Options.
- **`Interactive Approvals with AskUserQuestion is not supported when executionBackend is "remoteHttp"`**:
  Disable AskUserQuestion handling or switch execution backend.
- **Unknown/expired HITL reply links**:
  Re-run the HITL step to regenerate fresh signed URLs.
- **Replay reconnect returns "Durable replay is unavailable"**:
  Configure a Postgres credential on the node so stream frames can be persisted and replayed.
- **Webhook HITL answer resumes with missing context after restart**:
  Configure a Postgres credential on the SDK node so `claude_hitl_interactions` can persist the interaction record across restarts.
