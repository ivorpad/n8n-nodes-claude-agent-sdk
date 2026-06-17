# Observability Persistence (Postgres)

This guide explains how invocation observability is persisted from `ClaudeAgentSdk` to Postgres.

## Default behavior

`executionSettings.observabilityPersistenceBackend` defaults to `auto`.

- `auto`: tries to persist invocation observability to Postgres when a Postgres credential is configured on the `ClaudeAgentSdk` node.
- `runDataOnly`: stores observability only in node run data (`task_result.observability`), no Postgres writes.
- `postgres`: always attempts Postgres persistence and uses strict/fallback behavior from `observabilityPersistenceStrict`.

## Important wiring rule

The Postgres Session Memory connection does not configure observability persistence by itself.

For observability rows to be written, configure the optional `postgres` credential on the **Claude Agent SDK node** (the same node that runs the task).

## Table and schema

Default table: `claude_invocation_observability_events`

The node validates existing schema and creates the table/indexes automatically when missing.

## Quick verification

```bash
psql postgres://postgres:postgres@127.0.0.1/postgres -c "\
select count(*) as total_rows from claude_invocation_observability_events;"
```

Recent rows:

```bash
psql postgres://postgres:postgres@127.0.0.1/postgres -c "\
select created_at, execution_id, node_name, event_type, tool_name, terminal_status\
from claude_invocation_observability_events\
order by created_at desc\
limit 25;"
```

Per execution:

```bash
psql postgres://postgres:postgres@127.0.0.1/postgres -c "\
select event_type, tool_name, status, event_ts\
from claude_invocation_observability_events\
where execution_id = '<execution_id>'\
order by event_ts asc;"
```

## If the table is still empty

1. Confirm backend is not set to `runDataOnly`.
2. Confirm the `postgres` credential is configured on the `ClaudeAgentSdk` node.
3. Check execution metadata hints (`agentObsPersistence*`) in run data:
   - `agentObsPersistenceAttempted`
   - `agentObsPersistencePersisted`
   - `agentObsPersistenceError`
   - In `auto` mode without node-level Postgres credential, `agentObsPersistenceError` now states that fallback to run-data-only was used.
4. If needed, enable `observabilityPersistenceStrict=true` to fail fast when persistence cannot be written.
