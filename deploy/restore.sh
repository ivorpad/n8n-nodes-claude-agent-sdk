#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DRY_RUN=0
REQUESTED_ENV_FILE=""
POSTGRES_DUMP=""
CLAUDE_CONFIG_ARCHIVE=""
N8N_DATA_ARCHIVE=""
PROJECTS_ARCHIVE=""

usage() {
	cat <<'EOF'
Usage: bash deploy/restore.sh [options]

Restore the minimum production state for this stack from a Postgres dump and
tar archives captured by deploy/upgrade.sh.

Options:
  --postgres-dump PATH         Restore Postgres from a pg_dump SQL file
  --claude-config PATH         Restore /mnt/n8n-claude-session-data from a tar.gz
  --n8n-data PATH              Restore /home/claude-user/.n8n from a tar.gz
  --projects PATH              Restore /home/claude-user/projects from a tar.gz
  --env-file PATH              Use a specific deploy env file
  --dry-run                    Print the restore steps without mutating the stack
  -h, --help                   Show this help

Typical usage:
  bash deploy/restore.sh \
    --postgres-dump backups/<stamp>/postgres.sql \
    --claude-config backups/<stamp>/claude-config.tgz \
    --n8n-data backups/<stamp>/n8n-data.tgz
EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--postgres-dump)
			shift
			[ "$#" -gt 0 ] || die "--postgres-dump requires a path"
			POSTGRES_DUMP="$1"
			;;
		--claude-config)
			shift
			[ "$#" -gt 0 ] || die "--claude-config requires a path"
			CLAUDE_CONFIG_ARCHIVE="$1"
			;;
		--n8n-data)
			shift
			[ "$#" -gt 0 ] || die "--n8n-data requires a path"
			N8N_DATA_ARCHIVE="$1"
			;;
		--projects)
			shift
			[ "$#" -gt 0 ] || die "--projects requires a path"
			PROJECTS_ARCHIVE="$1"
			;;
		--env-file)
			shift
			[ "$#" -gt 0 ] || die "--env-file requires a path"
			REQUESTED_ENV_FILE="$1"
			;;
		--dry-run)
			DRY_RUN=1
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "Unknown argument: $1"
			;;
	esac
	shift
done

[ -n "$POSTGRES_DUMP$CLAUDE_CONFIG_ARCHIVE$N8N_DATA_ARCHIVE$PROJECTS_ARCHIVE" ] || {
	usage
	exit 1
}

trap cleanup_temp_env EXIT

docker_preflight
prepare_env_file "$REQUESTED_ENV_FILE"
validate_required_env
require_persistent_mount "$DEFAULT_SESSION_MOUNT"
validate_compose

if [ "$DRY_RUN" -eq 1 ]; then
	log "DRY RUN: would stop the stack, restore archives, start postgres/redis/n8n, and run smoke checks"
	exit 0
fi

compose down

if [ -n "$CLAUDE_CONFIG_ARCHIVE" ]; then
	restore_host_path "$DEFAULT_SESSION_MOUNT" "$CLAUDE_CONFIG_ARCHIVE" "Claude session mount"
fi

compose up -d postgres redis n8n
wait_for_service_health postgres 180
wait_for_service_health redis 120
wait_for_service_health n8n 180

if [ -n "$POSTGRES_DUMP" ]; then
	[ -f "$POSTGRES_DUMP" ] || die "Missing Postgres dump: $POSTGRES_DUMP"
	POSTGRES_DB_VALUE="$(env_value_or_default POSTGRES_DB n8n)"
	POSTGRES_USER_VALUE="$(env_value_or_default POSTGRES_USER n8n)"
	compose exec -T postgres psql -U "$POSTGRES_USER_VALUE" "$POSTGRES_DB_VALUE" <"$POSTGRES_DUMP"
	log "Restored Postgres from $POSTGRES_DUMP"
fi

if [ -n "$N8N_DATA_ARCHIVE" ]; then
	restore_container_path n8n /home/claude-user/.n8n "$N8N_DATA_ARCHIVE" "n8n data"
fi

if [ -n "$PROJECTS_ARCHIVE" ]; then
	restore_container_path n8n /home/claude-user/projects "$PROJECTS_ARCHIVE" "projects"
fi

compose up -d
run_smoke_checks
compose ps

log "Restore completed."
