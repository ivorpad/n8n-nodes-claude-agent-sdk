# Persistence And Operations

Persistence in this package has several separate layers. Do not treat one layer
as a replacement for the others.

## Session Memory

Session Memory nodes track deterministic session existence and metadata for a
stable `chatSessionId`.

| Node                      | Storage                                   | Best Fit                          | Queue-Mode Notes                                              |
| ------------------------- | ----------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `Simple Session Memory`   | Process memory                            | Local tests, single process demos | Not durable across restart and not shared across workers      |
| `Redis Session Memory`    | Redis hash keys                           | Shared metadata with TTL          | Shared, but does not implement the per-session execution lock |
| `Postgres Session Memory` | Postgres table, default `claude_sessions` | Production and queue mode         | Implements per-session advisory locking                       |

For multiple queue workers that may process the same `chatSessionId`, prefer
Postgres Session Memory. Simple and Redis memory nodes do not implement
`acquireExecutionLock`; concurrent runs can still fight over one Claude session.

## Persist Session And Claude Config

**Additional Options** -> **Persist Session** is enabled by default. HITL requires
it.

For Local CLI execution, Claude session transcripts live under the active Claude
config directory, typically:

```text
${CLAUDE_CONFIG_DIR}/projects
```

Use one of these approaches:

- Keep the default Claude config directory on durable storage.
- Set **Additional Options** -> **Claude Config Directory** to a durable path.
- Enable **Isolate Claude Config Directory** for workflow/session scoped config
  state when you do not provide a custom directory.

Session Memory alone is not enough to resume a Local CLI transcript after the
underlying transcript files disappear. If the memory entry exists but no
transcript is found, the node clears the saved memory entry and starts a fresh
deterministic session.

## Workspace Persistence

The node uses the configured **Working Directory** directly. Workspace durability
comes from the filesystem at that path.

- Put **Working Directory** on durable storage if files must survive restarts.
- Keep workspace access narrow and explicit.
- Use deployment backups or external object-storage sync outside this node if
  you need workspace snapshots.

## HITL Interaction Persistence

When the `Claude Agent SDK` node has a Postgres credential configured, SDK-owned
HITL interaction records are stored in Postgres. The default table is
`claude_hitl_interactions`, configurable by the
`CLAUDE_AGENT_HITL_INTERACTIONS_TABLE` environment variable.

Without a Postgres credential, SDK HITL interactions fall back to workflow node
static data. That fallback is useful for simple deployments but is not the same
durability boundary as Postgres.

Secrets known to the node are redacted before HITL interaction payloads are
persisted.

## Streaming Replay Persistence

When streaming is enabled and the SDK node can access a Postgres credential,
stream frames are persisted for replay.

Defaults:

- stream table: `claude_streams`,
- stream events table: `claude_stream_events`,
- retention: 7 days.

Optional environment overrides:

```bash
CLAUDE_AGENT_STREAMS_TABLE=claude_streams
CLAUDE_AGENT_STREAM_EVENTS_TABLE=claude_stream_events
CLAUDE_AGENT_STREAM_RETENTION_HOURS=168
```

Replay clients call the SDK webhook with:

```text
format=stream&streamKey=<key>&cursor=<last-seq>&replay=true
```

If Postgres is not configured, live streaming may still work, but replay across
worker restart or process loss is unavailable.

## Observability

The SDK node records bounded per-invocation observability data in
`task_result.observability` by default. If **Persist Session** is enabled and
the connected session-memory node is **Postgres Session Memory**, the same
Postgres connection durably writes invocation observability rows and full
session JSONL rows. Successful and HITL-paused runs fail instead of returning if
those durable writes fail.

The memory table name drives the full-session table name. The first
`claude_sessions` in the memory table name is replaced with
`claude_full_sessions`; otherwise the table name is `claude_full_sessions`.
The same naming rule creates a Platform-style per-event table named
`claude_session_events`.

`claude_full_sessions` keeps the full JSONL transcript as an archive blob.
`claude_session_events` stores one row per JSONL/event-log entry with the raw
event as `raw_event` JSONB plus indexed fields such as `event_type`,
`event_id`, `thread_id`, `tool_name`, `processed_at`, workflow ID, execution ID,
and node name. This mirrors the Claude Platform debug timeline more closely
while keeping the original transcript content available.

Invocation events are written to `claude_invocation_observability_events`.
Execution metadata includes persistence outcome hints so operators can
distinguish persisted and failed writes.

Execution Settings:

- **Observability Mode**: `Summary`, `Full`, or `Off`.
- **Max Observability Events** and **Max Observability Bytes**.
- **Redact Observability Payloads**.

There is no separate SDK-node Postgres credential or observability persistence
backend selector. Connect **Postgres Session Memory** when durable observability
and full-session persistence are required.

## Queue Mode

For queue mode:

- Install the exact same package version in main, webhook, and worker
  processes.
- Use the same Claude config directory wherever Local CLI runs.
- Use Postgres Session Memory for same-session concurrency control.
- Keep binary data durable using n8n's binary-data mode when workflows handle
  large files.
- Keep payload size limits explicit and avoid routing large binary payloads
  through regular JSON items.

Recommended n8n runtime controls vary by deployment, but production systems
should set finite workflow concurrency, execution timeout, execution data
retention, and payload size limits.

## Safe Deployment Baseline

A safe self-hosted baseline is:

1. Run n8n as a non-root user where practical.
2. Give n8n access only to directories workflows actually need.
3. Set `N8N_CLAUDE_POLICY_ALLOWED_PATHS` to approved workspace roots.
4. Use `N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES` on shared instances.
5. Block or gate high-risk tools such as `Bash` unless sandboxing and approvals
   are intentionally configured.
6. Use Secure Environment Variables for runtime secrets.
7. Keep provider and webhook credentials out of workflow exports, logs, and
   screenshots.
