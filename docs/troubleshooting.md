# Troubleshooting

## Install And Load Problems

### Node Does Not Appear In n8n

Check:

1. The package was installed under the n8n community-node directory used by the
   running process.
2. n8n was restarted after install.
3. In queue mode, every main/webhook/worker container has the same package
   version installed.
4. The build completed before `pnpm pack` if using a local tarball.

Search by node display name such as `Claude Agent SDK`, not by package name.

## Runtime Problems

### Claude Binary Not Found

Typical error:

```text
spawn /path/to/claude ENOENT
```

Fix:

1. Install Claude Code CLI in the n8n runtime that executes the workflow.
2. Set the executable path in the `Claude Agent SDK Anthropic API` credential if
   using CLI subscription auth.
3. Verify from inside the container or process:

```bash
which claude
claude --version
```

### Working Directory Does Not Exist

Use the path inside the n8n runtime, not the host path.

If Docker mounts `./projects:/workspace`, set **Working Directory** to
`/workspace/my-project`.

### No Suitable Shell Found

Claude CLI requires a POSIX shell. Set `SHELL` in the n8n runtime and ensure the
shell exists:

```bash
SHELL=/bin/bash
```

### `bypassPermissions` Fails As Root

Claude CLI blocks dangerously skipping permissions under root/sudo. Use a safer
permission mode, or run n8n/Claude as a non-root user. On shared instances, set
`N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES` to prevent workflow-controlled
permission escalation.

## Provider Problems

### Anthropic Auth Fails

Check:

- API key exists in the `Claude Agent SDK Anthropic API` credential, or
- CLI subscription auth points to a logged-in `claude` executable and readable
  Claude config directory.

### OpenRouter Auth Fails

Check:

- **Authentication** is `OpenRouter API`.
- The `Claude Agent SDK OpenRouter API` credential has a valid key.
- The selected OpenRouter model supports tools.
- The account has credit/quota.

The runtime intentionally clears `ANTHROPIC_API_KEY` and uses
`ANTHROPIC_AUTH_TOKEN` for OpenRouter.

### Alibaba Provider Errors

Check:

- **Authentication** is `Alibaba Coding Plan API`.
- Credential base URL and API key are correct.
- At least one Alibaba model tier is selected if your provider requires an
  explicit model.
- Thinking settings are compatible with Alibaba. The runtime disables or clamps
  known-incompatible thinking options.

### Ollama Connection Refused

Check:

1. Ollama is running.
2. The model is pulled and visible in `/api/tags`.
3. Docker networking uses a reachable host:
   - host machine: `http://<host-reachable-name>:11434`,
   - Compose service: `http://<compose-service-name>:11434`.

The loopback host inside a container is the container itself, not the host
machine.

### Custom Endpoint Returns 404

Check:

- **API Provider** is `Custom Endpoint`.
- **Custom API Endpoint** points to the provider's Anthropic-compatible base.
- The gateway implements the Anthropic Messages API shape expected by Claude
  Code/Agent SDK.

## Session And Queue-Mode Problems

### Session Does Not Resume

Check:

1. **Persist Session** is enabled.
2. `chatSessionId` is stable and non-empty.
3. A Session Memory node is connected.
4. For Local CLI, the Claude transcript still exists under
   `CLAUDE_CONFIG_DIR/projects`.
5. All queue-mode workers share the same package version, mounted workspace,
   and Claude config path.

### Concurrent Runs Fight Over One Session

Use Postgres Session Memory for same-session queue-mode workloads. Simple and
Redis memory do not implement the execution lifecycle advisory lock.

### Missing Transcript For Saved Session

If a memory entry exists but the Local CLI transcript file is gone, the node
clears the memory entry and starts fresh. Persist or mount the Claude config
directory if cross-run transcript continuity matters.

### Resume Collision Or Corrupted Replay Context

For non-HITL resumes, the node retries fresh once after common resume bootstrap
failures such as a session already in use, process `exit code 1`, or corrupted
thinking replay context. If the same workflow keeps falling back to fresh runs,
check worker concurrency, shared Claude config mounts, and whether another
execution is using the same `chatSessionId`.

## HITL Problems

### HITL Fails Because Persist Session Is Disabled

HITL requires **Persist Session**. Enable it under Additional Options.

### Approval Link Returns Finished Execution / 409

Likely causes:

- an expired or already-used waiting URL was reused,
- an automation followed a signed waiting URL before n8n entered wait state,
- a link scanner or unfurler touched a waiting URL.

Generate a fresh HITL request and wait for the authoritative post-wait
notification. In-stream HITL previews are for UI responsiveness, not for
external automation timing.

### Header Auth Or JWT Works In curl But Not Browser Links

Expected. Browsers do not attach custom headers or Bearer tokens to arbitrary
links. Use Basic Auth for direct browser links, or put the flow behind an app or
proxy that injects the required header/token.

### Channel Button Repeats The Same Question

Check:

- Channel flow has **Pause Execution in SDK** = `Off`.
- `chatSessionId` is stable per user/thread/task.
- The channel inbound adapter converts provider replies into strict
  `approval_response` or `question_response` envelopes.
- For WhatsApp in-chat replies, route raw provider payloads through the
  WhatsApp channel node before SDK when full question handling is required.

### Duplicate Or Conflict After Submit

Each HITL request should be consumed once. Reusing the same URL or decision
after a successful submit should produce duplicate/conflict behavior.

## Payload And Memory Problems

### Large Channel Messages Fail

For WhatsApp and other constrained channels:

- trim outbound HITL text,
- use fallback-only text for large tool payloads,
- route large files as binary data or durable storage references, not JSON item
  payloads.

### Worker OOM Or Restarts Under Load

Reduce concurrency, trim payloads, keep binary data out of JSON items, and use
n8n execution-data pruning. Increasing Node heap is a mitigation, not a fix for
unbounded payloads or sessions.

## Observability And Replay Problems

### Observability Table Is Empty

Check:

1. **Observability Persistence Backend** is not `Run Data Only`.
2. A Postgres credential is configured on the `Claude Agent SDK` node.
3. The table name is correct.
4. Execution metadata hints mention whether persistence was attempted,
   persisted, or fell back.

### Replay Says Durable Replay Is Unavailable

Configure a Postgres credential on the `Claude Agent SDK` node. Streaming replay
uses the SDK node credential, not the Session Memory node credential.

## Security Problems

### A Secret Appears In Output

Known credential values and secure env values are exact-value redacted at node
output, stderr, streaming, observability, HITL store, and error boundaries.

Redaction cannot protect secrets the agent fetches later or values pasted into a
prompt if the node never knew the exact value. Rotate the exposed secret and move
future use into credentials or `Secure Environment Variables`.

### Path Sandbox Did Not Stop A Shell Command

Path sandboxing applies to file tools such as Read, Write, Edit, Glob, and Grep.
It does not inspect shell effects from Bash. Block or gate Bash, use SDK/OS
sandboxing, and constrain container mounts for true filesystem isolation.
