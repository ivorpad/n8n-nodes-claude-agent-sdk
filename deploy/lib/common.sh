#!/usr/bin/env bash

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "$COMMON_DIR/.." && pwd)"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
ENV_EXAMPLE_FILE="$STACK_DIR/.env.example"
DEFAULT_ENV_FILE="$STACK_DIR/.env"
DEFAULT_SESSION_MOUNT="/mnt/n8n-claude-session-data"

log() {
	printf '[deploy] %s\n' "$*"
}

warn() {
	printf '[deploy] WARN: %s\n' "$*" >&2
}

die() {
	printf '[deploy] ERROR: %s\n' "$*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

read_env_value() {
	local file="$1"
	local key="$2"

	awk -F= -v key="$key" '
		$0 !~ /^[[:space:]]*#/ && $1 == key {
			sub(/^[^=]*=/, "", $0)
			value = $0
		}
		END {
			print value
		}
	' "$file"
}

env_value_or_default() {
	local key="$1"
	local fallback="$2"
	local value

	value="$(read_env_value "$ENV_FILE" "$key")"
	if [ -n "$value" ]; then
		printf '%s\n' "$value"
	else
		printf '%s\n' "$fallback"
	fi
}

set_env_value() {
	local file="$1"
	local key="$2"
	local value="$3"
	local tmp_file="${file}.tmp.$$"

	awk -v key="$key" -v value="$value" '
		BEGIN {
			replaced = 0
		}
		$0 ~ "^[[:space:]]*" key "=" {
			print key "=" value
			replaced = 1
			next
		}
		{
			print $0
		}
		END {
			if (!replaced) {
				print key "=" value
			}
		}
	' "$file" >"$tmp_file"

	mv "$tmp_file" "$file"
}

is_placeholder_value() {
	local value="$1"

	case "$value" in
		''|changeme|example|example.com|n8n.example.com|sk-ant-xxxxxxxxxxxxx|tskey-auth-xxxxxxxxxxxxx)
			return 0
			;;
	esac

	case "$value" in
		*xxxxxxxx*|*example.com*|*your-domain*)
			return 0
			;;
	esac

	return 1
}

generate_secret() {
	local format="$1"
	local length="$2"

	case "$format" in
		hex)
			openssl rand -hex "$length"
			;;
		base64)
			openssl rand -base64 "$length" | tr -d '\n'
			;;
		*)
			die "Unsupported secret format: $format"
			;;
	esac
}

compose() {
	docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

run_or_echo() {
	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: $*"
	else
		"$@"
	fi
}

prepare_env_file() {
	local requested_env_file="${1:-}"

	ENV_FILE="${requested_env_file:-$DEFAULT_ENV_FILE}"

	if [ -f "$ENV_FILE" ]; then
		return
	fi

	[ -f "$ENV_EXAMPLE_FILE" ] || die "Missing env template: $ENV_EXAMPLE_FILE"

	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		TEMP_ENV_FILE="${TMPDIR:-/tmp}/n8n-claude-sdk-env.$$"
		cp "$ENV_EXAMPLE_FILE" "$TEMP_ENV_FILE"
		chmod 0600 "$TEMP_ENV_FILE"
		ENV_FILE="$TEMP_ENV_FILE"
		log "DRY RUN: would create $DEFAULT_ENV_FILE from .env.example"
		return
	fi

	cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
	chmod 0600 "$ENV_FILE"
	log "Created $ENV_FILE from .env.example"
}

cleanup_temp_env() {
	if [ -n "${TEMP_ENV_FILE:-}" ] && [ -f "$TEMP_ENV_FILE" ]; then
		rm -f "$TEMP_ENV_FILE"
	fi
}

ensure_env_secret() {
	local key="$1"
	local format="$2"
	local length="$3"
	local description="$4"
	local current_value

	current_value="$(read_env_value "$ENV_FILE" "$key")"
	if [ -n "$current_value" ] && ! is_placeholder_value "$current_value"; then
		return
	fi

	local generated
	generated="$(generate_secret "$format" "$length")"
	set_env_value "$ENV_FILE" "$key" "$generated"
	log "Prepared $key ($description)"
}

validate_required_env() {
	local missing=0
	local key

	for key in DOMAIN ANTHROPIC_API_KEY N8N_ENCRYPTION_KEY POSTGRES_PASSWORD RUNNERS_AUTH_TOKEN TS_AUTHKEY; do
		local value
		value="$(read_env_value "$ENV_FILE" "$key")"
		if [ -z "$value" ] || is_placeholder_value "$value"; then
			warn "$key is missing or still set to a placeholder in $ENV_FILE"
			missing=1
		fi
	done

	[ "$missing" -eq 0 ] || die "Complete $ENV_FILE before continuing."
}

require_persistent_mount() {
	local mount_path="${1:-$DEFAULT_SESSION_MOUNT}"

	if [ ! -d "$mount_path" ]; then
		die "Persistent Claude session mount not found at $mount_path. Create and mount it before continuing."
	fi
}

docker_preflight() {
	require_command docker
	require_command openssl
	docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
}

validate_compose() {
	compose config >/dev/null
	log "Compose configuration is valid."
}

get_container_id() {
	compose ps -q "$1" 2>/dev/null | tr -d '\n'
}

require_running_service() {
	local service="$1"
	local container_id

	container_id="$(get_container_id "$service")"
	if [ -z "$container_id" ]; then
		die "Service \"$service\" is not running. Start the current stack before using this command."
	fi
}

wait_for_service_health() {
	local service="$1"
	local timeout_seconds="${2:-180}"

	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: would wait for $service to become healthy"
		return
	fi

	local container_id
	container_id="$(get_container_id "$service")"
	[ -n "$container_id" ] || die "Service \"$service\" is not running."

	local elapsed=0
	while [ "$elapsed" -lt "$timeout_seconds" ]; do
		local status
		status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
		case "$status" in
			healthy|running)
				log "$service is $status"
				return
				;;
			exited|dead)
				die "Service \"$service\" is not healthy (status: $status)."
				;;
		esac

		sleep 2
		elapsed=$((elapsed + 2))
	done

	die "Timed out waiting for $service to become healthy."
}

run_smoke_checks() {
	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: would run smoke checks for postgres, redis, and n8n healthz"
		return
	fi

	local postgres_db
	local postgres_user

	postgres_db="$(env_value_or_default POSTGRES_DB n8n)"
	postgres_user="$(env_value_or_default POSTGRES_USER n8n)"

	compose exec -T postgres pg_isready -q -d "$postgres_db" -U "$postgres_user"
	compose exec -T redis redis-cli ping | grep -q '^PONG$'
	compose exec -T n8n wget -qO- http://localhost:5678/healthz | grep -q 'ok'
	log "Smoke checks passed."
}

make_backup_dir() {
	local root_dir="$1"
	local timestamp
	timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
	BACKUP_DIR="$root_dir/$timestamp"

	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: would create backup directory $BACKUP_DIR"
		return
	fi

	mkdir -p "$BACKUP_DIR"
	log "Backup directory: $BACKUP_DIR"
}

backup_host_path() {
	local source_path="$1"
	local destination="$2"
	local label="$3"

	if [ ! -d "$source_path" ]; then
		warn "Skipping $label backup because $source_path does not exist."
		return
	fi

	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: would archive $label from $source_path to $destination"
		return
	fi

	tar -C "$source_path" -czf "$destination" .
	log "Saved $label backup to $destination"
}

backup_container_path() {
	local service="$1"
	local source_path="$2"
	local destination="$3"
	local label="$4"

	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: would archive $label from $service:$source_path to $destination"
		return
	fi

	require_running_service "$service"
	compose exec -T "$service" sh -lc "if [ ! -d '$source_path' ]; then exit 0; fi; tar -C '$source_path' -czf - ." >"$destination"

	if [ ! -s "$destination" ]; then
		rm -f "$destination"
		warn "Skipping $label backup because $service:$source_path is empty."
		return
	fi

	log "Saved $label backup to $destination"
}

restore_host_path() {
	local destination_path="$1"
	local archive_path="$2"
	local label="$3"

	[ -f "$archive_path" ] || die "Missing $label archive: $archive_path"

	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: would restore $label from $archive_path into $destination_path"
		return
	fi

	mkdir -p "$destination_path"
	find "$destination_path" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
	tar -xzf "$archive_path" -C "$destination_path"
	log "Restored $label from $archive_path"
}

restore_container_path() {
	local service="$1"
	local destination_path="$2"
	local archive_path="$3"
	local label="$4"

	[ -f "$archive_path" ] || die "Missing $label archive: $archive_path"

	if [ "${DRY_RUN:-0}" -eq 1 ]; then
		log "DRY RUN: would restore $label from $archive_path into $service:$destination_path"
		return
	fi

	require_running_service "$service"
	compose exec -T "$service" sh -lc "mkdir -p '$destination_path' && find '$destination_path' -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +"
	compose exec -T "$service" sh -lc "mkdir -p '$destination_path' && tar -xzf - -C '$destination_path'" <"$archive_path"
	log "Restored $label from $archive_path"
}
