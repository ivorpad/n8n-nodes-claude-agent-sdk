# Current State — n8n Claude Agent SDK

Last updated: 2026-06-17. Read this first in any new session.

## What This Is

An n8n community node package (`n8n-nodes-claude-agent-sdk`) that wraps the Anthropic Claude Agent SDK for autonomous task execution with HITL (human-in-the-loop) approval flows, deterministic session identity, Postgres-backed durability surfaces, and multi-channel companion adapters.

## Active Workstreams

Current active workstream: SDK 0.3.175 / Claude model-surface refresh, durable replayable streaming, authoritative HITL interaction persistence, audit hardening, and the current AGT/frontend HITL operating model.

What changed in this workstream:

- streaming now persists replayable frames in Postgres before live socket fan-out
- `streamKey` is stable across initial execution, HITL pause, HITL resume, and completion
- webhook streaming supports replay-first reconnect with `format=stream&streamKey=<key>&cursor=<seq>&replay=true`
- `ResponseStore` is now a bounded active-socket registry, not the correctness source
- SDK HITL requests are now persisted as first-class interaction records before wait/notify
- webhook replies resolve `resume` vs `complete` from persisted interaction state, not signed query payloads or hardcoded answer strings
- browser/webhook frontends now use the main workflow webhook as the authoritative approval/question response loop; dedicated channel nodes (`Claude Agent Slack`, `Claude Agent Telegram`, …) handle external-responder channels
- the generic `Claude Agent HITL` companion node is gone and the SDK node's separate `HITL` output is gone; everything now flows through a single `Result` output (plus optional `Audit Log`), with channel nodes filtering items by `type` downstream
- AskUserQuestion options are canonicalized with internal option values so webhook forms can post stable ids while the model still receives human-readable labels
- question-answer channels now carry explicit `responseAction` in transport, while persisted interaction policy remains authoritative server-side
- SDK HITL webhooks now support optional `Basic Auth`, `Header Auth`, or `JWT Auth`, plus optional responder identity extraction from Basic usernames, trusted headers, or verified JWT claims
- secure env injection now also resolves `${VAR}` placeholders in direct HTTP/SSE MCP headers, with secure credential values taking precedence over container env
- once a HITL approval/question is pending, later tool attempts in the same run are suppressed server-side and the active SDK query is interrupted when supported
- approval resumes keep the canonical task unchanged and use a neutral execution prompt; they do not ask Claude to ignore earlier `STOP` / rejection text
- AGT allow hooks now stay neutral so direct MCP tools can still pause through `canUseTool`
- AGT, HITL, `Allowed Tools`, and `Disallowed Tools` selectors can dynamically discover configured direct HTTP MCP tools
- the SDK node now surfaces HITL as a dedicated top-level control and the HITL settings section is driven directly from that toggle (HITL items now emit on the shared `Result` output)
- local CLI preset controls now support cherry-picked Claude Code prompt sections, so operators can keep tool/session guidance without forcing the full Claude Code system-prompt preset
- deploy helpers now include `deploy/install.sh`, `deploy/upgrade.sh`, and `deploy/restore.sh`
- structured output schemas are now validated before execution/script generation, and retry exhaustion is controlled by an explicit node failure policy instead of a silent payload-only convention
- HITL NDJSON: after an immediate in-stream approval/question emit, `notifiedImmediately` prevents a duplicate send in `waitForPendingInteractions` (same `requestId`)
- non-HITL resume fresh fallback: observability payload includes `resumeFreshHeuristic` (`invalid_replay_signature` | `session_markers` | `generic_exit_code_1`); generic code-1 path logs an extra warning
- docs/AGENTS: NDJSON preview vs post-wait resume timing (409); Postgres vs Simple/Redis session memory execution locking for multi-worker
- error-handling cleanup: Claude Skill Tool and connected AiTool execution now propagate unexpected runtime failures instead of converting them into synthetic success payloads; secure-env loading only runs when the credential is actually configured
- SDK refresh: `@anthropic-ai/claude-agent-sdk` is aligned to 0.3.175 and `@anthropic-ai/sdk` to 0.100.1. The removed unstable V2 session API is not used; local execution stays on `query()` with `options.resume`.
- current Claude model surface: explicit IDs include `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`, while `opus` / `sonnet` / `haiku` / default aliases remain backwards compatible and provider-overridable.
- Opus 4.7+ / 4.8 reasoning: adaptive thinking plus `effort` is the primary path; fixed thinking budgets are suppressed with warnings, and Claude API fast mode is exposed as a clearly gated research preview for supported Opus models.
- SDK drift handling: Task tools (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) and `Monitor` are first-class tool/streaming surfaces, while `TodoWrite` remains parsed for historical transcripts.
- message drift handling: outputs preserve structured `stopReason` / `stopDetails` for refusals, distinguish `api_retry` overloaded vs rate-limit cases, carry pending MCP server statuses from SDK init frames, and use canonical upstream SDK message types instead of local shadows.
- audit hardening: companion `waitForReply` channels now call `putExecutionToWait()` before signing/sending resume URLs, multi-item companion loops honor `continueOnFail`, binary inputs reject unsafe directories and unresolved file placeholders, Redis memory stores async client errors for awaited methods, hook handler outputs are runtime-validated, and malformed SDK usage numbers emit output warnings instead of silent zero defaults.
- package manager: `pnpm-lock.yaml` is authoritative; CI runs `pnpm install --frozen-lockfile`, full typecheck, lint, build, full tests, and parity checks.
- generated Python SDK scripts mirror adaptive Opus thinking where supported; fast mode remains a documented gap until matching Python SDK support is verified.
- credential selector UX follows n8n's HTTP Request-style split: `authentication` chooses `API Credential` vs local Ollama `none`, `nodeCredentialType` is a `credentialsSelect` field defaulting to `claudeApi`, and provider credentials are rendered inline from the selected credential type instead of being declared in the node's top-level `credentials` array. The selector is scoped with `extends:claudeAgentSdkProviderApi`, so it lists SDK-owned provider credentials (`Claude Agent SDK Anthropic API`, `Claude Agent SDK OpenRouter API`, `Alibaba Coding Plan API`) instead of unrelated LangChain credentials such as official `Anthropic`. Runtime still accepts legacy saved `anthropicApi` / `openRouterApi` selections. Local Ollama is configured as node options rather than as a credential selector entry.
- repo-local agent runtime/config files under `.codex/`, `.claude/`, and `.agents/` are ignored by default; `docs/guides/secret-incident-response.md` defines the required rotation, cleanup, and history-rewrite checklist for leaked credentials.
- Managed Agents parity audit is captured in `docs/analysis/managed-agents-parity-matrix.md`; managed session reuse docs now match the implemented `chatSessionId` → `managed_agent_session_id` metadata mapping, active managed sessions can be interrupted with `user.interrupt`, and the node now has a first managed lifecycle slice: create/inspect/update/list agent versions, run latest or pinned versions, attach session-create vault/resource references, and resume permission pauses through distinct `user.tool_confirmation` events.

## Architecture at a Glance

```
Claude Agent SDK node (executeTask)
├── Session memory (Simple/Redis/Postgres) — deterministic session existence + metadata
├── Session persistence (Postgres / volume-backed Claude transcripts) — transcript durability
├── Durable stream replay (Postgres)
│   ├── claude_streams — stream lifecycle + terminal status
│   ├── claude_stream_events — replayable frames keyed by (stream_key, seq)
│   └── ResponseStore — active live sockets only
├── HITL approval/question flow
│   ├── canUseTool → canonicalize question/options → persist interaction
│   ├── putExecutionToWait() → notify
│   ├── webhook consume is idempotent, decision-aware (`accepted` / `duplicate` / `conflict`), and can require optional auth/identity
│   └── Resume/complete: resolved from stored interaction policy, then minimal prompt + fingerprint pre-approval
└── Companion HITL adapters (shared core, external channels only)
    ├── WhatsApp (interactive buttons, durable dispatch)
    ├── Telegram (inline keyboard, durable dispatch)
    ├── Slack (Block Kit actions)
    ├── Email / Gmail / Discord
    └── Pending store: staticData or Postgres
```

## Key Context Documents

See `AGENTS.md` Knowledge Map for the full index. The fastest current orientation set is:

| Doc | What it covers |
|-----|---------------|
| `AGENTS.md` | Hard invariants, hot paths, knowledge map |
| `docs/guides/frontend-hitl.md` | Browser/webhook HITL architecture and loopback contract |
| `docs/guides/agt-governance.md` | Current AGT behaviour, direct-vs-bridged MCP field paths |
| `docs/guides/hitl-learnings.md` | HITL rules plus durable replay semantics |
| `docs/setup/durability.md` | Current HITL durability guardrails and replay checklist |
| `deploy/README.md` | Public self-hosted Docker Compose install / upgrade / restore quick path |

## Public Repository Scope

- Public HEAD should contain source, tests, public docs, sanitized examples, and build/release metadata only.
- Local artifacts, personal agent config, scraped references, private deployment inventories, packed tarballs, logs, generated PDFs, and scratchpads are ignored.
- CI is `.github/workflows/ci.yml` (pnpm install, typecheck, lint, build, full tests, parity). Image publishing metadata is generic and owner-derived.
- Release helper: `pnpm run release:publish`.

## Version

Current: v0.2.22 (see `package.json`).
