#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DRY_RUN=0
REQUESTED_ENV_FILE=""
BACKUP_ROOT="$STACK_DIR/backups"

usage() {
	cat <<'EOF'
Usage: bash deploy/upgrade.sh [--dry-run] [--env-file PATH] [--backup-dir PATH]

Takes a pre-upgrade backup, validates docker-compose, pulls the configured image
refs, restarts the stack, and runs smoke checks. This command assumes the stack
is already installed.
EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--dry-run)
			DRY_RUN=1
			;;
		--env-file)
			shift
			[ "$#" -gt 0 ] || die "--env-file requires a path"
			REQUESTED_ENV_FILE="$1"
			;;
		--backup-dir)
			shift
			[ "$#" -gt 0 ] || die "--backup-dir requires a path"
			BACKUP_ROOT="$1"
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

trap cleanup_temp_env EXIT

docker_preflight
prepare_env_file "$REQUESTED_ENV_FILE"
validate_required_env
require_persistent_mount "$DEFAULT_SESSION_MOUNT"
validate_compose
make_backup_dir "$BACKUP_ROOT"

if [ "$DRY_RUN" -eq 0 ]; then
	require_running_service postgres
	require_running_service redis
	require_running_service n8n
fi

if [ "$DRY_RUN" -eq 1 ]; then
	log "DRY RUN: would capture .env, pg_dump, session mount, n8n-data, and projects backups"
else
	cp "$ENV_FILE" "$BACKUP_DIR/.env"
	log "Saved env snapshot to $BACKUP_DIR/.env"
fi

if [ "$DRY_RUN" -eq 1 ]; then
	log "DRY RUN: would write Postgres dump to $BACKUP_DIR/postgres.sql"
else
	POSTGRES_DB_VALUE="$(env_value_or_default POSTGRES_DB n8n)"
	POSTGRES_USER_VALUE="$(env_value_or_default POSTGRES_USER n8n)"
	compose exec -T postgres pg_dump -U "$POSTGRES_USER_VALUE" "$POSTGRES_DB_VALUE" >"$BACKUP_DIR/postgres.sql"
	log "Saved Postgres dump to $BACKUP_DIR/postgres.sql"
fi

backup_host_path "$DEFAULT_SESSION_MOUNT" "$BACKUP_DIR/claude-config.tgz" "Claude session mount"
backup_container_path n8n /home/claude-user/.n8n "$BACKUP_DIR/n8n-data.tgz" "n8n data"
backup_container_path n8n /home/claude-user/projects "$BACKUP_DIR/projects.tgz" "projects"

if [ "$DRY_RUN" -eq 1 ]; then
	log "DRY RUN: would pull configured images and restart the stack"
	exit 0
fi

compose pull
compose up -d
wait_for_service_health postgres 180
wait_for_service_health redis 120
wait_for_service_health n8n 180
run_smoke_checks
compose ps

log "Upgrade completed. Backups are stored in $BACKUP_DIR"
