# Execute Task

The `Claude Agent SDK` node exposes these operations:

- **Execute Task**: run an agent task.
- **Generate Python SDK Script**: generate a downloadable Python script that
  mirrors the node configuration without making an LLM call.
- **Manage Managed Agent**: manage Anthropic Managed Agent resources. This guide
  focuses on the Local CLI path for self-hosted n8n usage.

## Basic Local CLI Configuration

For a first local run:

1. Choose **Authentication** and credentials. See
   [Providers And Credentials](providers-and-credentials.md).
2. Set **Operation** = **Execute Task**.
3. Set **Execution Backend** = **Local CLI**.
4. Set **Working Directory** to an absolute path inside the n8n runtime.
5. Set **Task Description** to the task Claude should perform.
6. Choose a model or leave **Model** at default.
7. Keep **Permission Mode** conservative until your sandbox, tool, and HITL
   policy are known.

The working directory must exist and be readable by the n8n process.

## Chat Session ID

`chatSessionId` is the canonical deterministic session ID for this package.
Use a stable value such as a user ID, chat ID, ticket ID, or workflow-specific
conversation ID.

When a Session Memory node is connected and **Persist Session** is enabled:

- a new run starts with `sessionId = chatSessionId`,
- later runs resume with `resume = chatSessionId`,
- normal resume flows do not send `sessionId` together with `resume`,
- session memory tracks deterministic session existence and metadata, not a
  separate `chatSessionId -> Claude session ID` mapping for Local CLI.

For Local CLI resume, the Claude transcript must still exist under the active
Claude config directory. If memory says a session exists but no transcript is
found, the node clears the saved memory entry and bootstraps a fresh
deterministic session.

## Models And Thinking

The model dropdown includes short aliases (`opus`, `sonnet`, `haiku`, default)
and explicit model IDs. Provider-specific model-tier overrides are shown for
OpenRouter and Alibaba. LiteLLM shows a model alias dropdown loaded from the
proxy and a manual alias field for unlisted or unavailable model listings.

For supported Opus/Fable models, use **Thinking Mode** = `Adaptive` and the
**Effort** field where available. Fixed thinking budgets are not valid for every
provider/model combination; the runtime suppresses or clamps incompatible
settings where implemented.

**Fast Mode** is available only for supported Opus models on the Anthropic API
research-preview path.

## Tools And Permissions

Use these fields together:

- **Allowed Tool Names or IDs**: tools that can run without approval.
- **Disallowed Tool Names or IDs**: tools that are always blocked.
- **Permission Mode**: Claude Code native permission behavior.
- **Enable HITL** and approval settings: human approval for selected tool use.
- **Security Options**: path sandboxing, content filtering, tool rules, and
  audit logging.
- **Sandbox Configuration**: SDK/OS-level command sandboxing and network
  restrictions.

Operator policy environment variables can tighten workflow settings globally.
See the safe deployment baseline in
[Persistence And Operations](persistence-and-operations.md).

Do not rely on path sandboxing alone to confine shell commands. Path sandboxing
validates file-tool paths; command execution can still access whatever the n8n
process can access unless blocked, approved through HITL, or constrained by an
OS/SDK sandbox.

## MCP Servers

The node supports external MCP servers for Local CLI execution:

1. Enable **MCP Servers**.
2. Add HTTP/SSE or stdio server entries.
3. Configure command, URL, headers, and credential options as needed.

MCP tools appear as tool names such as `mcp__server_name__tool_name`. They can be
allowed, disallowed, streamed, or routed through HITL like other tools.

For HTTP/SSE headers that need secrets, use `${VAR}` placeholders backed by
`Secure Environment Variables`; arbitrary host environment variables are not
exposed to header substitution.

## In-Process n8n MCP

The in-process n8n MCP option is off by default and local-CLI only. Enable the
feature flag in the n8n process:

```bash
CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS=true
```

Then configure **N8N MCP (In-Process)** on the node. Start with read-only tools:

- `Get Item JSON`
- `Get Execution Context`
- `Log`

Enable output writes only when you intentionally want Claude to set final output
JSON.

## Streaming

Enable **Streaming** when the upstream trigger/client can consume streaming
responses.

Recommended defaults:

- Leave **Use Text Markers** off for structured JSON frames.
- Stream only the content types your client needs.
- Truncate tool input/output payloads for UI clients.

When a Postgres credential is configured on the `Claude Agent SDK` node,
streaming frames can be persisted for durable replay. Replay uses:

```text
GET /webhook/<nodeId>?format=stream&streamKey=<key>&cursor=<seq>&replay=true
```

Without Postgres, live streaming can still work, but replay across process loss
is not durable.

## Structured Output

Use structured output settings when downstream nodes need a validated JSON shape
instead of free text. The node validates structured output schema configuration
before execution and also mirrors supported structured-output options in the
generated Python SDK script.

## Generate Python SDK Script

Use **Operation** = **Generate Python SDK Script** when you want a standalone
Python script that mirrors the node's Local CLI configuration.

The operation returns:

- `json.type = "python_sdk_script"`,
- `json.filename = "claude_agent.py"`,
- `json.script` with the generated script text,
- a binary `claude_agent.py` attachment.

Important limits:

- It does not make an LLM call.
- It does not embed `Secure Environment Variables` values.
- Some TypeScript-SDK-only options are emitted as notes rather than invalid
  Python options.
- The Python runtime must have `claude_agent_sdk` installed and must receive any
  required secrets through its own environment.

## Outputs

`Claude Agent SDK` always emits a **Result** output.

When audit logging is enabled under Security Options, it also emits an
**Audit Log** output.

HITL request and response items are emitted on the same Result output as
`task_result` items.
