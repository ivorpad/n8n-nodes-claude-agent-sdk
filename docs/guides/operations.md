# Operations Stability Runbook (OOM, Load, Payload)

This runbook captures production hardening rules for sustained HITL load.

## Why OOM happens here

The dominant memory pressure in this node is concurrent Claude sessions and large payloads.

- Dev hot-reload loops (`npm run dev`) amplify heap churn and hide real production behavior.

## Hard limits you must enforce

1. **Limit runtime concurrency**
   - Do not keep unlimited production concurrency.
   - Set `N8N_CONCURRENCY_PRODUCTION_LIMIT` to a finite value.

2. **Limit payload sizes**
   - Keep `N8N_PAYLOAD_SIZE_MAX` and `N8N_FORMDATA_FILE_SIZE_MAX` explicit and conservative.
   - For WhatsApp HITL, use outbound trim/fallback controls to avoid oversized request payloads.

## Baseline production config (starting point)

Set in n8n runtime env:

```bash
EXECUTIONS_MODE=queue
N8N_CONCURRENCY_PRODUCTION_LIMIT=5
EXECUTIONS_TIMEOUT=1800

EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=72
EXECUTIONS_DATA_PRUNE_MAX_COUNT=2000
EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
EXECUTIONS_DATA_SAVE_ON_ERROR=all
EXECUTIONS_DATA_SAVE_ON_PROGRESS=false
EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=false

N8N_PAYLOAD_SIZE_MAX=16
N8N_FORMDATA_FILE_SIZE_MAX=200

# Binary data in queue mode should be durable
N8N_DEFAULT_BINARY_DATA_MODE=s3

# Heap guardrail (mitigation, not root fix)
NODE_OPTIONS=--max-old-space-size=6144

# If task runners are enabled
N8N_RUNNERS_MAX_CONCURRENCY=5
N8N_RUNNERS_MAX_OLD_SPACE_SIZE=2048
```

Notes:

- Queue mode is preferred for sustained load isolation.
- `NODE_OPTIONS` buys headroom but does not replace scope/size controls.

## Node-level workflow profile

For durable HITL:

1. `Enable HITL = On` (`interactiveApprovals = pauseForApproval`)
2. `persistSession = true`
3. keep deterministic `chatSessionId` + Session Memory connected
4. configure transcript persistence options for your deployment

## Validation checklist before load test

1. Postgres:

```bash
psql postgres://<user>:<pass>@<host>:<port>/<db> -c 'select 1 as pg_ok;'
```

2. Node config sanity:

- strict durability mode enabled for production.

3. HITL multi-hop flow:

- `question -> answer -> question -> answer -> completion`
- includes at least one approval path and one AskUserQuestion path.

## Soak test acceptance (minimum)

Run sustained test with representative task sizes and concurrent sessions.
Pass criteria:

1. No process OOM/restarts.
2. Heap plateaus (no monotonic leak trend).
3. No durability downgrade when strict mode is enabled.
4. Resume works across worker restart for paused HITL.

## Incident response for OOM

1. Stop new load.
2. Reduce `N8N_CONCURRENCY_PRODUCTION_LIMIT`.
3. Identify workflows with large payloads or high session counts.
4. Use heap-size increase only as temporary mitigation.

## n8n docs to cross-check during upgrades

- Environment variables (executions/endpoints/binary-data)
- Queue mode deployment guidance
- Memory errors troubleshooting

When upgrading n8n, re-validate all env defaults because some defaults are version-sensitive.
