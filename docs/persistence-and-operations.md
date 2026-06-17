# Persistence And Operations

Persistence in this package has several separate layers. Do not treat one layer
as a replacement for the others.

## Session Memory

Session Memory nodes track deterministic session existence and metadata for a
stable `chatSessionId`.

| Node | Storage | Best Fit | Queue-Mode Notes |
|---|---|---|---|
| `Simple Session Memory` | Process memory | Local tests, single process demos | Not durable across restart and not shared across workers |
| `Redis Session Memory` | Redis hash keys | Shared metadata with TTL | Shared, but does not implement the per-session execution lock |
| `Postgres Session Memory` | Postgres table, default `claude_sessions` | Production and queue mode | Implements per-session advisory locking |

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

- Mount the default Claude config directory on durable storage.
- Set **Additional Options** -> **Claude Config Directory** to a mounted durable
  path.
- Enable **Isolate Claude Config Directory** for workflow/session scoped config
  state when you do not provide a custom directory.

Session Memory alone is not enough to resume a Local CLI transcript after the
underlying transcript files disappear. If the memory entry exists but no
transcript is found, the node clears the saved memory entry and starts a fresh
deterministic session.

## Workspace Persistence

The node uses the configured **Working Directory** directly. Workspace durability
comes from the filesystem or volume mounted at that path.

- Put **Working Directory** on a durable mounted volume if files must survive
  restarts.
- Keep workspace mounts narrow and explicit.
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
`task_result.observability` by default.

When Postgres persistence is enabled, observability data is flushed on normal
completion, HITL pause return, and failure paths. Execution metadata includes
persistence outcome hints so operators can distinguish persisted, fallback, and
failed writes.

Execution Settings:

- **Observability Mode**: `Summary`, `Full`, or `Off`.
- **Max Observability Events** and **Max Observability Bytes**.
- **Observability Persistence Backend**:
  - `Auto`: use Postgres when a Postgres credential is configured on the SDK
    node; otherwise run data only.
  - `Run Data Only`: never write observability rows.
  - `Postgres`: require Postgres persistence subject to strict/fallback mode.
- **Observability Persistence Strict Mode**: fail the execution if configured
  Postgres persistence fails.
- **Observability Postgres Table**: default
  `claude_invocation_observability_events`.

The Postgres Session Memory connection does not configure observability by
itself. Attach a Postgres credential to the `Claude Agent SDK` node.

## Queue Mode

For queue mode:

- Install the exact same package version in main, webhook, and worker
  containers.
- Mount the same project/workspace paths into workers that execute the node.
- Mount or configure the same Claude config directory wherever Local CLI runs.
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
2. Mount only required workspace directories.
3. Use a read-only container filesystem with explicit writable mounts when your
   deployment supports it.
4. Set `N8N_CLAUDE_POLICY_ALLOWED_PATHS` to mounted workspace roots.
5. Use `N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES` on shared instances.
6. Block or gate high-risk tools such as `Bash` unless sandboxing and approvals
   are intentionally configured.
7. Use Secure Environment Variables for runtime secrets.
8. Keep provider and webhook credentials out of workflow exports, logs, and
   screenshots.
