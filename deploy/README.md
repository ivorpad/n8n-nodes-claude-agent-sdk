# n8n + Claude Agent SDK — VPS Deployment

Self-host this stack on a single VPS with Docker Compose, queue-mode `n8n`, external task runners, and Postgres-backed durable replay for streaming HITL reconnects.

## What This Stack Includes

- `postgres` for workflow data and durable stream replay state
- `redis` for Bull queue mode
- `n8n` main instance for UI, API, and webhook ingress
- `n8n-worker` for queued execution throughput
- `task-runners` for external JS/Python code execution
- `caddy` for public HTTPS
- `filebrowser` plus Tailscale sidecar
- optional `code-server` plus Tailscale sidecar
- `prometheus`, `cadvisor`, `node-exporter`, and `grafana`

The durable replay path stores live stream frames in Postgres tables named `claude_streams` and `claude_stream_events` by default. Clients reconnect with the same `streamKey` and request missing frames with `format=stream&streamKey=<key>&cursor=<last-seen-seq>&replay=true`.

## Prerequisites

- Docker and Docker Compose v2
- A domain pointing at the server IP
- Ports `80` and `443` open
- `ANTHROPIC_API_KEY`
- A reusable `TS_AUTHKEY` for the always-on FileBrowser sidecar
- A persistent Claude session mount at `/mnt/n8n-claude-session-data`
- GHCR access if your image refs are private

Create the persistent Claude session mount before first install:

```bash
sudo mkdir -p /mnt/n8n-claude-session-data
sudo chown 1001:1001 /mnt/n8n-claude-session-data
```

## Quick Start

Copy the `deploy/` directory to the server, then work inside it:

```bash
scp -r deploy/ user@your-server:~/n8n-stack/
ssh user@your-server
cd ~/n8n-stack
```

Prepare `.env` and verify the install without mutating the machine:

```bash
cp .env.example .env
nano .env
bash install.sh --dry-run
```

The install script generates blank secrets automatically when they are missing:

- `N8N_ENCRYPTION_KEY`
- `POSTGRES_PASSWORD`
- `RUNNERS_AUTH_TOKEN`
- `GRAFANA_PASSWORD`

It still fails fast if production-critical values are missing or placeholders:

- `DOMAIN`
- `ANTHROPIC_API_KEY`
- `TS_AUTHKEY`
- the bind mount at `/mnt/n8n-claude-session-data`

Run the actual install:

```bash
echo "<GITHUB_PAT>" | docker login ghcr.io -u <github-user> --password-stdin
bash install.sh
```

The script validates `docker compose config`, starts `postgres` and `redis` first, waits for health checks, then starts the full stack and runs smoke checks.

## Environment Variables

Required:

- `DOMAIN`
- `ANTHROPIC_API_KEY`
- `N8N_ENCRYPTION_KEY`
- `POSTGRES_PASSWORD`
- `RUNNERS_AUTH_TOKEN`
- `TS_AUTHKEY`

Important optional values:

- `POSTGRES_DB` and `POSTGRES_USER` default to `n8n`
- `N8N_IMAGE_REF`, `RUNNERS_IMAGE_REF`, `CODE_SERVER_IMAGE_REF` default to `v0.2.16`
- `N8N_CONCURRENCY_PRODUCTION_LIMIT` defaults to `5`
- `CLAUDE_AGENT_STREAMS_TABLE`, `CLAUDE_AGENT_STREAM_EVENTS_TABLE`, `CLAUDE_AGENT_STREAM_RETENTION_HOURS` override durable replay storage only when you need non-default Postgres names or retention

## Durable Replay Behavior

Streaming HITL links now carry a stable `streamKey`. The key stays constant across the initial run, HITL pause, resume, and completion. If the main process restarts or the HTTP socket disappears, reconnect with the same URL plus:

```text
format=stream&streamKey=<streamKey>&cursor=<last-seen-seq>&replay=true
```

The webhook replays persisted frames after the acknowledged cursor and then tails live output again when the stream is still active.

## Upgrade and Restore

Take backups and roll out new image refs with:

```bash
bash upgrade.sh --dry-run
bash upgrade.sh
```

`upgrade.sh` snapshots:

- `.env`
- Postgres via `pg_dump`
- `/mnt/n8n-claude-session-data`
- `/home/claude-user/.n8n`
- `/home/claude-user/projects`

Restore from those artifacts with:

```bash
bash restore.sh --help
bash restore.sh \
  --postgres-dump backups/<timestamp>/postgres.sql \
  --claude-config backups/<timestamp>/claude-config.tgz \
  --n8n-data backups/<timestamp>/n8n-data.tgz
```

## Verification

After install or upgrade:

```bash
docker compose ps
docker compose logs -f n8n
```

Expected smoke checks:

- `postgres` is healthy
- `redis-cli ping` returns `PONG`
- `wget -qO- http://localhost:5678/healthz` inside `n8n` returns `ok`

## Release References

Image publishing remains pull-first and immutable-ref-first. See [DEPLOY.md](DEPLOY.md) for the bake and release contract.
