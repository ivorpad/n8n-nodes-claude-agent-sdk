#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DRY_RUN=0
REQUESTED_ENV_FILE=""

usage() {
	cat <<'EOF'
Usage: bash deploy/install.sh [--dry-run] [--env-file PATH]

Creates or validates deploy/.env, generates required secrets when blank, checks
the persistent Claude session mount, validates docker-compose, and starts the
stack. In --dry-run mode the script does not mutate files or start containers.
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
ensure_env_secret N8N_ENCRYPTION_KEY hex 32 "n8n credential encryption"
ensure_env_secret POSTGRES_PASSWORD hex 16 "Postgres password"
ensure_env_secret RUNNERS_AUTH_TOKEN hex 24 "task runner shared token"
ensure_env_secret GRAFANA_PASSWORD base64 16 "Grafana admin password"
validate_required_env
require_persistent_mount "$DEFAULT_SESSION_MOUNT"
validate_compose

log "Environment preflight passed."
log "Using env file: $ENV_FILE"

if [ "$DRY_RUN" -eq 1 ]; then
	log "DRY RUN: would pull images, start postgres/redis, wait for health, then start the full stack"
	exit 0
fi

compose pull
compose up -d postgres redis
wait_for_service_health postgres 180
wait_for_service_health redis 120
compose up -d
wait_for_service_health n8n 180
run_smoke_checks
compose ps

log "Install completed."
