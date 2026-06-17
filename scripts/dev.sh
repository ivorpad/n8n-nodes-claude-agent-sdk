#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_CHECK_PORT=7483
SKILL_CHECK_SERVER="$ROOT_DIR/.claude/hooks/skill-check-server.ts"

# n8n-node dev currently shells out to n8n@latest, which is broken for custom
# node development right now. Run a pinned external n8n instead.
N8N_VERSION="${N8N_VERSION:-2.15.1}"
N8N_USER_FOLDER="${N8N_USER_FOLDER:-$HOME/.n8n-node-cli}"
SKILL_CHECK_ENABLED="${SKILL_CHECK_ENABLED:-0}"

export N8N_USER_FOLDER
export N8N_DEV_RELOAD=true
export N8N_RUNNERS_ENABLED="${N8N_RUNNERS_ENABLED:-true}"

if [[ -z "${N8N_ENCRYPTION_KEY:-}" ]]; then
	mkdir -p "$N8N_USER_FOLDER"
	N8N_ENCRYPTION_KEY_FILE="$N8N_USER_FOLDER/encryption-key"
	if [[ ! -f "$N8N_ENCRYPTION_KEY_FILE" ]]; then
		if command -v openssl >/dev/null 2>&1; then
			openssl rand -hex 32 >"$N8N_ENCRYPTION_KEY_FILE"
		else
			node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" >"$N8N_ENCRYPTION_KEY_FILE"
		fi
		chmod 0600 "$N8N_ENCRYPTION_KEY_FILE"
	fi
	export N8N_ENCRYPTION_KEY="$(<"$N8N_ENCRYPTION_KEY_FILE")"
else
	export N8N_ENCRYPTION_KEY
fi
export DB_TYPE="${DB_TYPE:-postgresdb}"
export DB_POSTGRESDB_HOST="${DB_POSTGRESDB_HOST:-localhost}"
export DB_POSTGRESDB_PORT="${DB_POSTGRESDB_PORT:-5432}"
export DB_POSTGRESDB_DATABASE="${DB_POSTGRESDB_DATABASE:-n8n_local}"
export DB_POSTGRESDB_USER="${DB_POSTGRESDB_USER:-postgres}"
export DB_POSTGRESDB_PASSWORD="${DB_POSTGRESDB_PASSWORD:-postgres}"

cleanup_pids=()
service_pids=()
NODE_DEV_LOG=""

cleanup() {
	trap - EXIT

	for pid in "${cleanup_pids[@]:-}"; do
		kill "$pid" 2>/dev/null || true
	done

	for pid in "${cleanup_pids[@]:-}"; do
		wait "$pid" 2>/dev/null || true
	done

	if [[ -n "$NODE_DEV_LOG" && -f "$NODE_DEV_LOG" ]]; then
		rm -f "$NODE_DEV_LOG"
	fi
}

on_signal() {
	cleanup
	exit 130
}

port_in_use() {
	lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

skill_check_healthy() {
	curl -fsS "http://127.0.0.1:${SKILL_CHECK_PORT}/health" >/dev/null 2>&1
}

start_skill_check() {
	if [[ "$SKILL_CHECK_ENABLED" != "1" ]]; then
		return
	fi

	if skill_check_healthy; then
		echo "[dev] Reusing skill-check server on :${SKILL_CHECK_PORT}"
		return
	fi

	if port_in_use "$SKILL_CHECK_PORT"; then
		echo "[dev] Port ${SKILL_CHECK_PORT} is already in use but /health did not respond" >&2
		echo "[dev] Stop the existing process or start a healthy skill-check server first" >&2
		exit 1
	fi

	if [[ ! -f "$SKILL_CHECK_SERVER" ]]; then
		echo "[dev] Skill-check server not found; continuing without it"
		return
	fi

	(
		cd "$ROOT_DIR"
		exec bun --watch "$SKILL_CHECK_SERVER"
	) &
	local pid=$!
	cleanup_pids+=("$pid")
	service_pids+=("$pid")
}

start_node_dev() {
	NODE_DEV_LOG="$(mktemp -t n8n-node-dev).log"

	(
		cd "$ROOT_DIR"
		exec pnpm exec n8n-node dev --external-n8n --custom-user-folder "$N8N_USER_FOLDER"
	) >"$NODE_DEV_LOG" 2>&1 &

	node_dev_pid=$!
	cleanup_pids+=("$node_dev_pid")
	service_pids+=("$node_dev_pid")

	tail -n +1 -F "$NODE_DEV_LOG" &
	node_dev_tail_pid=$!
	cleanup_pids+=("$node_dev_tail_pid")
}

wait_for_node_dev_setup() {
	while true; do
		if grep -q "Found 0 errors" "$NODE_DEV_LOG"; then
			return 0
		fi

		if ! kill -0 "$node_dev_pid" 2>/dev/null; then
			wait "$node_dev_pid"
			return $?
		fi

		sleep 1
	done
}

start_n8n() {
	(
		cd "$ROOT_DIR"
		exec npm exec --package="n8n@${N8N_VERSION}" n8n -- start
	) &

	n8n_pid=$!
	cleanup_pids+=("$n8n_pid")
	service_pids+=("$n8n_pid")
}

monitor_services() {
	while true; do
		for pid in "${service_pids[@]}"; do
			if ! kill -0 "$pid" 2>/dev/null; then
				wait "$pid"
				return $?
			fi
		done

		sleep 1
	done
}

trap cleanup EXIT
trap on_signal INT TERM

mkdir -p "$N8N_USER_FOLDER"

start_skill_check
start_node_dev

setup_status=0
wait_for_node_dev_setup || setup_status=$?
if [[ "$setup_status" -ne 0 ]]; then
	exit "$setup_status"
fi

start_n8n

status=0
monitor_services || status=$?
exit "$status"
