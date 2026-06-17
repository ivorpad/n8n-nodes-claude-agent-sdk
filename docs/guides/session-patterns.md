# Session-Learned Patterns

Patterns learned from debugging sessions across this project. Grouped by topic, deduplicated.

---

## User Communication

- **Fragmented messages**: If user provides fragmented messages with unclear intent → pause and explicitly ask for clarification before implementing. Fragmentation often masks a core decision the user is trying to make.
- **"Too naive" critique**: If generated code quality is critiqued as "too naive" → ask "Which aspects need improvement: type safety, error handling, documentation, or feature completeness?" before rewriting.
- **Architecture questioning**: If user questions architecture decisions (e.g., "Why did you mount volumes instead of me?") → immediately clarify the chosen path vs alternatives. Don't assume agreement without explicit confirmation.
- **User frustration about infrastructure**: Pause and explain the mental model clearly. User values data integrity, protection, and governance — frame decisions around those priorities.
- **User contradicts with "hallucinating"**: Immediately accept correction as ground truth; verify with user before defending.
- **"Let's discuss this"**: Stop and wait for user to articulate their mental model before proposing solutions.
- **"WRONG!!!!"**: Pause and explicitly ask "What specifically was wrong?" before proceeding.
- **"continue" after plan draft**: Resume work on the drafted plan immediately — signals explicit approval.
- **"lets plan it out"**: Do NOT jump to implementation; wait for explicit plan approval.
- **"commit all work"**: Execute the commit before doing anything else.
- **Screenshots contradicting code research**: Immediately accept visual evidence as ground truth.
- **Duplicate UI fields in screenshots**: Ask "Are these duplicates intentional?" before assuming it's an error.

## HITL / Approval Flow

- **Resume fails with "exited with code 1"**: Do NOT use `forkSession` on resume; the session is in a valid state (denied tool_use + error tool_result are committed). The model retries naturally. Forking causes re-fork failures.
- **Stale session retry (non-HITL)**: Catch the error, remove the resume option, retry as fresh session.
- **Resume re-sends full original task**: Use a minimal continuation prompt instead ("Tool X approved. Proceed."); session already has history.
- **`resumeSessionAt` UUID "No message found"**: Don't use `resumeSessionAt` for HITL; UUID mismatch from tool_use block ID vs assistant message UUID. Use plain `resume: sessionId` with fingerprint-based approval.
- **SDK source truth (v0.2.17)**: Denied tool_use messages ARE committed to session. `interrupt: true` triggers `abortController.abort()`, not session rollback.
- **Multi-hop resume creates new session**: Log the exact file path the SDK is trying to load; the SDK's transcript lookup path may differ from where transcript hydration writes it.
- **Session ID changes between approvals**: Check whether transcript hydration is reading the SAME sessionId that was written.
- **EngineRequest `hitlNodeName: '(empty)'`**: Likely false positive detection (n8n passes empty EngineResponse on first call) or resume data arriving via `ai_tool` connection type instead of `main`.
- **Webhook accepts answers but shows "Complete $X.XXXX"**: Execution is terminating instead of returning to agent loop; verify `execute()` returns EngineRequest (not INodeExecutionData) when HITL is pending.
- **Tool approval URLs before `putExecutionToWait()`**: Move URL notification to after `putExecutionToWait()` resolves to prevent 409 race conditions.
- **"Slack HITL doesn't work like WhatsApp HITL"**: Don't declare them equal from structural identity; check platform-specific transport, runtime isolation, and SDK routing.

> **Full HITL documentation**: `docs/guides/hitl-learnings.md`

## Docker & Deployment

- **`su -c` drops env vars**: Use `su-exec` (Alpine) or `gosu` (Debian) instead — they preserve all env vars.
- **Claude SDK ENOENT on `remote-settings.json`**: Docker named volumes mount as root-owned. Entrypoint must run as root, fix ownership, create required files (`remote-settings.json` with `{}`), then drop to app user.
- **Cloud-init Docker not ready**: Add `docker info` retry loop before `docker compose up`; daemon isn't immediately ready after `systemctl start docker`.
- **Caddy SSL errors after new subdomain**: `docker compose restart caddy` is required; Caddy doesn't auto-reload.
- **n8n Working Directory "does not exist"**: Must be full absolute path inside the container.
- **Filebrowser "Wrong credentials"**: Since v2.33.0, default password is auto-generated in container logs.
- **Filebrowser "no permissions"**: Set `user: "0:0"` for volumes owned by other UIDs.
- **Tailscale sidecar + `network_mode`**: App container cannot also declare `ports:`.
- **Dockerfile SDK tag not updating**: `docker compose build` (without --no-cache) uses cached layers. Bump the tag AND upload the Dockerfile.
- **Never `--no-cache` on ≤4GB RAM**: Rebuilds ALL layers (30+ min). Regular build with changed Dockerfile line rebuilds from that layer forward (~2 min).
- **Provider volume snapshots may be incomplete**: Some VPS snapshots exclude attached block volumes. Use file-level backups (restic/rsync).
- **Bind-backed Docker named volumes**: Use `driver_opts: { type: none, o: bind, device: /mnt/path }` for Docker volume semantics on block storage.
- **Volume migration**: `docker cp`, `chown -R 1001:1001`, then recreate with bind-backed definition. Remove old Docker volume first.
- **code-server image lacks Python**: Extend with `deploy/Dockerfile.code-server`.
- **`validate-before-handoff.sh` false positives**: Grep pattern must target `.ts` files with specific names, not raw strings that appear in docker-compose env vars.

> **Deployment note**: keep provider-specific deployment inventories and runbooks outside the public repository unless they have been explicitly sanitized.

## Session Persistence

- **CLI writes to `~/.claude/projects/` on disk** — MinIO is workspace snapshots only, Postgres is backup for distributed setups.
- **Session JSONL filenames don't match chat session ID**: Check whether Session Memory node returned an old `claudeSessionId` mapping from pre-deterministic-ID era.
- **MinIO ECONNREFUSED during multi-hop**: Check whether session transcript storage depends on MinIO availability; SDK may silently create new session when transcript unavailable.
- **Resume streaming shows `shouldStream: false`**: Issue is HTTP response capture in webhook handler, not session persistence.

## Testing

- **Mock object stability**: Verify mock returns the SAME reference instance for multiple calls; `getWorkflowStaticData` stability is foundational for assertion patterns.
- **"Missing interaction data" or "empty static data"**: Check if test uses direct static data access instead of SDK helper functions (`getAllInteractions`/`getInteraction`).

## Build / TypeScript

- **esbuild template literal escaping with Python f-strings**: `${...}` in JS template strings triggers expression parsing; escape as `\${...}` only for literal `$` characters, not for Python f-string braces like `{variable}`.
- **`usableAsTool` TypeScript error**: Always use `true` (boolean) or omit entirely; `false` is not valid in n8n-workflow v1.120.8+.
- **Session discriminant type errors**: Check ALL session-like types and ensure version field literal values match across the union type definition.
- **`StoredPendingInteraction` field names**: Uses `kind` (not `type`) and `originalTaskBase64` (not `originalTask`).
