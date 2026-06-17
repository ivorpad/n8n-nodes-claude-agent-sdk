# Security Hardening Guide

This node supports both workflow-level controls and operator-enforced policy controls.

## Security Model

- Workflow authors control node parameters (path sandbox, tool rules, sandbox options, etc.).
- Operators can enforce non-bypassable limits via environment variables.
- Effective behavior is additive and restrictive:
  - Workflow settings can tighten policy.
  - Workflow settings cannot widen policy.

## Secret Redaction

A single redactor is built once per node invocation from the known secret values
(Anthropic/OpenRouter/Ollama/Alibaba auth tokens, every `secureEnv` value, and the
`mcpHeaderAuthApi` header value injected into MCP HTTP/SSE requests). It performs
**exact-value masking**: any occurrence of a collected secret string is replaced
with `[REDACTED]`. It does not detect secrets it was never given (e.g. tokens the
agent fetches at runtime, or values pasted into the task prompt by a tool).

The redactor is applied at every place where data leaves the node or is durably
persisted:

| Sink | Redacted? | Notes |
|---|---|---|
| Node output JSON (`task_result`, final text) | Yes | Output payload and joined text are masked. |
| Captured subprocess stderr | Yes | Masked before being surfaced. |
| Streamed events (durable stream store + live NDJSON) | Yes | Each frame payload is masked **before** it is persisted to the Postgres stream store and before fan-out. |
| Observability log (in-result events + Postgres persistence) | Yes | Payloads are masked, not merely length-truncated. |
| HITL interaction store (Postgres) | Yes | Masks the base64 task prompt, `tool_input`, `questions`, `answers`, `reviewer_message`, and `updated_input`. |
| Thrown error messages (and copied `stack`) | Yes | Assembled message + stderr + preserved stack are masked before the error is thrown. |

Redaction is best-effort defence-in-depth, not a substitute for keeping secrets out
of workflow config — see the Recommended Baseline below.

## Operator Policy Environment Variables

| Variable | Example | Effect |
|---|---|---|
| `N8N_CLAUDE_POLICY_ALLOWED_PATHS` | `/data/projects,/tmp/claude` | Hard filesystem allowlist for file tools |
| `N8N_CLAUDE_POLICY_BLOCKED_TOOLS` | `Bash,mcp__danger__*` | Global blocked tools/patterns |
| `N8N_CLAUDE_POLICY_FORCE_SANDBOX` | `1` | Forces SDK sandbox enabled |
| `N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED` | `1` | Disables unsandboxed command escalation |
| `N8N_CLAUDE_POLICY_ALLOWED_ENV_VARS` | `NODE_ENV,LOG_LEVEL` | Operator env allowlist used with node allowlist mode |
| `N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES` | `default,plan` | Allowlist of permitted permission modes. **Unset = no restriction** (any requested mode, including `bypassPermissions`, is allowed). When set, any requested mode not in the list is downgraded to `default` and `allowDangerouslySkipPermissions` is forced off. Applies to both the node's `Permission Mode` field and any HITL approval permission-mode override. |

The `Permission Mode` node field is expression-bindable, so a workflow can bind it to
untrusted/inbound chat data. Without this policy, such a workflow could select
`bypassPermissions`, which disables the SDK's native per-tool permission prompts and the
`canUseTool` gate. Set `N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES` on shared instances to
forbid escalation regardless of how a workflow drives that field. Note the HITL approval
override defaults to **no allowed override modes** (a responder cannot escalate the session
mode unless the workflow author explicitly opts in).

## Recommended Baseline

1. Enable SDK sandbox and disallow unsandboxed commands.
2. Set `N8N_CLAUDE_POLICY_ALLOWED_PATHS` to mounted workspace roots only.
3. Block high-risk tools globally (`Bash` and sensitive MCP tools/patterns) unless required.
4. Use node **Environment Security Mode = Allowlist** for production workflows.
5. Keep proxy credentials out of workflow config and node JSON. Use secure storage or external manager config for secrets injected by the proxy.
6. Enable **Isolate Claude Config Directory** in node options to avoid cross-workflow state overlap.
7. Set `N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES` (e.g. `default,plan`) to forbid `bypassPermissions`/`acceptEdits` on shared instances where workflows may bind `Permission Mode` to untrusted data.

## Path Sandbox Scope (does NOT constrain Bash)

The **Path Sandboxing** node option confines file operations to a base path, but
it only inspects the path-bearing tools **Read, Write, Edit, Glob, and Grep**. It
works by reading the path argument out of those tools' inputs (`file_path`,
`path`, `pattern`) in a PreToolUse hook.

- **Bash is not covered.** The sandbox cannot see the filesystem effects of a
  shell command, so an agent with Bash can read or write **anywhere the n8n
  process can** — e.g. `cat /etc/passwd`, `echo ... > /outside/base/file`, `cp`,
  `mv`, `python -c 'open(...)'` — fully bypassing the path sandbox. The same
  applies to any other command-executing tool.
- **Path Sandboxing is a guardrail for the file tools, not a filesystem jail.**
  To actually confine what the agent can touch on disk you must combine it with:
  1. **Blocking or gating Bash** — block `Bash` globally via
     `N8N_CLAUDE_POLICY_BLOCKED_TOOLS`, or require HITL approval for it, when the
     workspace must stay confined.
  2. **An OS-level boundary** — the SDK sandbox plus a read-only root filesystem
     and narrow writable mounts (see Docker Deployment Notes), and
     `N8N_CLAUDE_POLICY_ALLOWED_PATHS` constrained to those mounts.

`N8N_CLAUDE_POLICY_ALLOWED_PATHS` and `N8N_CLAUDE_POLICY_FORCE_SANDBOX` /
`N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED` are the operator-enforced controls; the
Path Sandbox node option is a per-workflow convenience on top of them.

## HITL Webhook Authentication

The approval/question webhook is reached by clicking a link that carries an n8n
**resume token** in the URL. That token is the baseline gate: it is signed over
the execution + node path, so it cannot be forged. However, query parameters on
that URL are **not** covered by the signature, and the resume token itself
travels in plaintext links that are emailed, posted to chat, and written to logs.

- **`Webhook Authentication = None` (default) relies solely on the resume
  token.** This is the out-of-the-box behaviour and is intentionally
  non-breaking, but anyone who obtains the approve/deny URL (a forwarded email, a
  chat unfurl, a log line) can answer the HITL request. When HITL is enabled with
  `None`, the node logs a runtime **warning** and the node editor shows a notice
  recommending a second factor.
- **Add a second factor for any non-trivial deployment.** Set **Webhook
  Authentication** to **Basic Auth** (works with browser prompts), **Header
  Auth**, or **JWT Auth**. Header/JWT modes require a client or reverse proxy
  that injects the header/Bearer token, since a plain browser link cannot attach
  custom headers.
- **A GET never approves.** Clicking an approve/deny link issues a GET, which now
  renders a confirmation page; the decision is applied only when you submit it
  (a POST). This prevents link scanners, unfurlers, and browser prefetch from
  silently approving a request. Automated clients that previously approved with a
  bare GET must issue the POST (or POST directly to the webhook with
  `approved=true|false`).
- **Forged query parameters cannot grant authority.** Security-relevant resume
  fields (fingerprint, session id, approved-fingerprint set, original task) are
  sourced from the persisted interaction record only, never from the URL query.

## Session Safety

- Use **Transcript Persistence** + **Execution Lock Mode = Wait** when multiple runs can touch the same session.
- Locking is process-local (per n8n worker instance). It serializes same-session runs in that process.
- Transcript hydration now writes atomically to reduce partial-file risk during crashes.

## Docker Deployment Notes

- Prefer a read-only root filesystem (`read_only: true` / `--read-only`) for n8n containers running this node.
- Grant write access only to explicit mounts (`tmpfs` or dedicated volumes), not the whole container filesystem.
- For ephemeral workspaces, use bounded tmpfs mounts (for example `/tmp` and `/workspace` with `size=` limits).
- Mount only required project roots into the n8n container.
- Keep a dedicated writable mount for Claude state if you use config isolation.
- Keep `N8N_CLAUDE_POLICY_ALLOWED_PATHS` constrained to those mounted writable/allowed roots.
- Avoid mounting host-level sensitive paths into the container.

See `README.md` section **Read-Only Root Filesystem + tmpfs Writable Paths** for runnable examples.
