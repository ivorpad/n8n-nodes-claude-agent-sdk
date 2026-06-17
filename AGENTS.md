# AGENTS.md

Minimal, production-only constraints for this n8n Claude Agent SDK repo.  
`CLAUDE.md` states the public repository purpose and points to this file for instructions.

## Must-Follow Invariants
- Dynamic inline imports are a HARD NO.
- Use static imports by default. If a runtime boundary is unavoidable, isolate it in dedicated loader modules only (allowlist: `nodes/ClaudeAgentSdk/sdk/loadSdkModule.ts`, `nodes/ClaudeAgentEmail/transport/loadNodemailer.ts`).
- Deterministic sessions are authoritative: `chatSessionId` is the canonical Claude session ID.
- Session memory tracks deterministic session existence/metadata only (no `chatSessionId -> claudeSessionId` mapping).
- If session memory already has the deterministic session, start with `resume` only.
- Do not send `sessionId` with `resume` in normal flows. `sessionId` is for new sessions only.
- HITL approval/question resume must use `resume` and must not force `forkSession`.
- On non-HITL resume failures (`session already in use` or process `exit code 1`), clear resume/session options and retry fresh once.
- **HITL URLs and wait:** Do not call signed `webhook-waiting` / resume links until after `putExecutionToWait()` succeeds (avoids 409 “execution finished already”). When NDJSON streaming is enabled, the SDK may emit an **in-stream preview** of the same HITL payload during `canUseTool` for UI responsiveness; treat that as **non-authoritative for resume timing**—companions and external automations must still wait until the execution is in the waiting state (or use the post-wait notification only).
- On HITL resume, send a minimal continuation prompt; never resend the full original task.
- Treat `resumeSessionAt` as best-effort optimization; if anchor UUID is missing/invalid, fall back to plain `resume`.
- Wait/resume ownership stays in SDK execute flow (`executeTask`), not in companion adapter nodes.
- In-memory AGT rate-limit state is not a production control. Treat current DID-scoped AGT limits as per-execution guardrails only; durable/shared quotas must live in persisted or shared infrastructure.
- For Postgres session memory concurrency, use per-session advisory locking for the execution lifecycle. **Simple** and **Redis** session memory nodes do not implement `acquireExecutionLock`; with **queue mode / multiple workers**, prefer Postgres session memory for the same deterministic `chatSessionId`, or accept the risk of concurrent runs fighting over one Claude session.
- For Postgres schema changes, never alter blindly; verify schema first (for example via `pg_attribute`) and use `createPostgresConnectionHandle()`.

## Hot Paths
- `nodes/ClaudeAgentSdk/operations/executeTask/`
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/querySetup.ts`
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/runExecution.ts`
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/interactiveApprovals.ts`
- `nodes/memory/PostgresSessionMemory/PostgresSessionMemory.node.ts`

## Knowledge Map

Everything an agent needs is in this repo. If it's not here, it doesn't exist.
Single source of truth: `docs/`.

### Bootstrap (read first in every session)
- `docs/CURRENT-STATE.md` — project overview, active workstreams, current version

### Documentation (`docs/`)
| Doc | What it covers |
|-----|---------------|
| `docs/architecture.md` | Module map, node properties, ESM compat |
| `docs/guides/agt-governance.md` | Current AGT node surface, recipes, field-path rules |
| `docs/guides/eval-via-rest-api.md` | REST eval workflow, UUID sessionId requirement |
| `docs/guides/frontend-hitl.md` | Recommended browser/webhook HITL architecture and client loop |
| `docs/setup/hitl-channels.md` | WhatsApp/Telegram HITL channel setup |
| `docs/setup/durability.md` | Runtime durability validation config |
| `docs/setup/observability-persistence.md` | Postgres observability persistence setup |
| `docs/guides/operations.md` | OOM, load, payload stability runbook |
| `docs/guides/hitl-learnings.md` | HITL rules, current architecture, key files |
| `docs/guides/managed-agents-learnings.md` | Managed Agents backend: SSE streaming, file artifacts, n8n gotchas |
| `docs/guides/hitl-webhook-auth-qa.md` | Manual + automated QA checklist for SDK HITL webhook auth/identity |
| `docs/guides/secure-env-vars.md` | Secure env injection setup, precedence, allowlist behavior, and script usage |
| `docs/guides/secret-incident-response.md` | Secret leak response: rotation, repo cleanup, history rewrite checklist |
| `docs/guides/hook-handlers.md` | Webhook-based hook handlers for approval, audit, error visibility, notifications |
| `docs/guides/session-patterns.md` | Debugging patterns from incidents |
| `docs/guides/update-workflow.md` | Safe deactivate → PUT → activate workflow mutation via REST |
| `docs/guides/postgres-safety.md` | DDL/connection safety rules |
| `docs/reference/ralph-wiggum-loops.md` | rp-cli context isolation protocol |

### Documentation Discipline
- If behavior changes, update the relevant `docs/` file in the same commit
- Keep `docs/CURRENT-STATE.md` active workstreams section current
