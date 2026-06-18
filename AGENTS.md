# AGENTS.md

Production constraints for `n8n-nodes-claude-agent-sdk`, the self-hosted n8n
community-node package that integrates the Claude Agent SDK and Claude Code into
n8n workflows.

`CLAUDE.md` states the repository purpose; this file carries the coding and
runtime conventions agents must preserve.

## Must-Follow Invariants
- Dynamic inline imports are a HARD NO.
- Use static imports by default. If a runtime boundary is unavoidable, isolate it in dedicated loader modules only (allowlist: `nodes/ClaudeAgentSdk/sdk/loadSdkModule.ts`, `nodes/ClaudeAgentEmail/transport/loadNodemailer.ts`).
- Deterministic sessions are authoritative: `chatSessionId` is the canonical Claude session ID.
- Session memory tracks deterministic session existence/metadata only (no `chatSessionId -> claudeSessionId` mapping).
- If session memory already has the deterministic session, start with `resume` only.
- Do not send `sessionId` with `resume` in normal flows. `sessionId` is for new sessions only.
- HITL approval/question resume must use `resume` and must not force `forkSession`.
- On non-HITL resume failures (`session already in use` or process `exit code 1`), clear resume/session options and retry fresh once.
- **HITL URLs and wait:** Do not call signed `webhook-waiting` / resume links until after `putExecutionToWait()` succeeds (avoids 409 “execution finished already”). When NDJSON streaming is enabled, the SDK may emit an **in-stream preview** of the same HITL payload during `canUseTool` for UI responsiveness; treat that as **non-authoritative for resume timing**—external automations must still wait until the execution is in the waiting state (or use the post-wait notification only).
- On HITL resume, send a minimal continuation prompt; never resend the full original task.
- Treat `resumeSessionAt` as best-effort optimization; if anchor UUID is missing/invalid, fall back to plain `resume`.
- Wait/resume ownership stays in SDK execute flow (`executeTask`), not in channel adapter nodes.
- In-memory AGT rate-limit state is not a production control. Treat current DID-scoped AGT limits as per-execution guardrails only; durable/shared quotas must live in persisted or shared infrastructure.
- For Postgres session memory concurrency, use per-session advisory locking for the execution lifecycle. **Simple** and **Redis** session memory nodes do not implement `acquireExecutionLock`; with **queue mode / multiple workers**, prefer Postgres session memory for the same deterministic `chatSessionId`, or accept the risk of concurrent runs fighting over one Claude session.
- For Postgres schema changes, never alter blindly; verify schema first (for example via `pg_attribute`) and use `createPostgresConnectionHandle()`.

## Project Conventions
- Keep this repository focused on package source, tests, public examples, and release metadata. Deployment stacks, private runbooks, generated outputs, caches, local agent config, packed tarballs, logs, and secrets do not belong here.
- Treat `README.md`, `CHANGELOG.md`, `MANAGED_AGENTS.md`, and `docs/` as public references. Keep `docs/` user-facing and free of private deployment details, generated artifacts, local-only paths, and secret-bearing examples.
- Use canonical types from `n8n-workflow` and `@anthropic-ai/claude-agent-sdk`; do not create shadow SDK or n8n types when upstream types are available.
- Keep node structure consistent: node descriptions, execute/webhook logic, transports, stores, credentials, and shared channel runtime stay in their existing module boundaries.
- Prefer static imports and small dedicated adapters over broad utility modules. Runtime-specific loading belongs only in the allowlisted loader modules.
- Tests use Vitest and should live near the behavior they cover, usually in `__tests__` beside the node or shared runtime being changed.
- Before release-facing changes, run the narrow relevant tests plus `pnpm run typecheck` when practical.
- Secret scanning: a gitleaks pre-commit hook (`.githooks/pre-commit`) scans staged changes, and CI (`.github/workflows/secret-scan.yml`) scans full history on every push/PR. `pnpm install` wires the hook automatically via `core.hooksPath`; if it isn't active run `git config core.hooksPath .githooks`, and install the binary with `brew install gitleaks`. Tuning lives in `.gitleaks.toml` — test fixtures hold intentional dummy secrets and are allowlisted there; never add real secrets anywhere, including tests.

## Hot Paths
- `nodes/ClaudeAgentSdk/ClaudeAgentSdk.node.ts`
- `nodes/ClaudeAgentSdk/schema.ts`
- `nodes/ClaudeAgentSdk/operations/executeTask.ts`
- `nodes/ClaudeAgentSdk/operations/executeTask/`
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/querySetup.ts`
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/runExecution.ts`
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/interactiveApprovals.ts`
- `nodes/ClaudeAgentSdk/sdk/`
- `nodes/ClaudeAgentSdk/hitl/`
- `nodes/ClaudeAgentChannelShared/core/`
- `nodes/ClaudeAgentSlack/`, `nodes/ClaudeAgentDiscord/`, `nodes/ClaudeAgentTelegram/`
- `nodes/ClaudeAgentEmail/`, `nodes/ClaudeAgentGmail/`, `nodes/ClaudeAgentWhatsApp/`, `nodes/ClaudeAgentWoztell/`
- `nodes/memory/PostgresSessionMemory/PostgresSessionMemory.node.ts`
- `nodes/memory/RedisSessionMemory/RedisSessionMemory.node.ts`
- `nodes/memory/SimpleSessionMemory/SimpleSessionMemory.node.ts`
- `credentials/`
