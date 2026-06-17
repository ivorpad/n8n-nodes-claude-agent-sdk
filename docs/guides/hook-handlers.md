# Hook Handlers

Run custom logic on SDK hook events — via webhooks or local commands (Bash, Python, etc.).

## When To Use It

- **PostToolUseFailure**: see when the agent silently works around denied tools (e.g. returns placeholder images instead of failing visibly)
- **PreToolUse (sync)**: custom approval logic — block dangerous commands with a script or webhook
- **PostToolUse**: audit trail to external systems (log every tool invocation)
- **Stop**: notify Slack/email/webhook when an agent finishes
- **Notification**: forward agent notifications to external systems
- **SessionStart**: log session starts externally

## Setup

1. Open the `Claude Agent SDK` node.
2. Scroll down past Plugins near the bottom.
3. Enable `Enable Hook Handlers`.
4. Click `Add Hook Handler`.
5. Configure the handler:

| Field | Description |
|-------|-------------|
| Event | Which SDK event to listen for |
| Handler Type | `Webhook` (POST to URL) or `Command` (run local script) |
| Mode | `Sync` waits for response; `Fire-and-Forget` runs and continues |
| Webhook URL | URL to POST the event payload to (webhook type only) |
| Command | Shell command to run (command type only) |
| Tool Filter | Optional tool name pattern — only for PreToolUse/PostToolUse/PostToolUseFailure |
| Timeout (Seconds) | Max wait for sync handlers (default 30, sync mode only) |
| On Failure | `Continue (Fail-Open)` or `Block (Fail-Closed)` when handler fails (sync mode only) |

You can add multiple handlers. Each one independently receives its configured event.

## Handler Types

### Webhook

POSTs the event JSON to the configured URL.

- **Sync**: waits for a 2xx HTTP response and parses it as a valid SDK hook JSON object such as `{ "continue": true/false }`
- **Fire-and-Forget**: POSTs and continues immediately

### Command

Runs a local shell command with the event JSON piped to stdin.

- **Sync**: waits for the command to exit. Non-zero exit code = block. If stdout contains JSON, it must be a valid SDK hook JSON object.
- **Fire-and-Forget**: spawns the command and continues immediately

The command receives the full hook event as a JSON object on stdin. This is the same pattern as Claude Code's native `.claude/hooks/` scripts.

## Modes

### Fire-and-Forget

Runs the handler and continues immediately. The agent is not slowed down. Use for logging, audit trails, and notifications.

### Sync

Runs the handler and waits for a response before continuing. The response controls whether the tool proceeds.

Return `{ "continue": true }` to allow, or `{ "continue": false }` to block.

If the handler fails, times out, returns a non-2xx webhook status, returns invalid JSON, or returns the wrong JSON shape, the `On Failure` setting determines the behaviour:

- **Continue (Fail-Open)**: allow the tool to proceed (default, safer for availability)
- **Block (Fail-Closed)**: block the tool (safer for security-sensitive workflows)

## Event Payload

Both webhooks and commands receive the same JSON. For webhooks it is the POST body; for commands it is piped to stdin.

### PreToolUse Example

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "abc-123",
  "cwd": "/workspace",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /tmp/cache"
  },
  "tool_use_id": "toolu_01ABC..."
}
```

### PostToolUseFailure Example

```json
{
  "hook_event_name": "PostToolUseFailure",
  "session_id": "abc-123",
  "cwd": "/workspace",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/etc/passwd",
    "content": "..."
  },
  "error": "Path is outside the allowed sandbox",
  "tool_use_id": "toolu_01DEF..."
}
```

### Stop Example

```json
{
  "hook_event_name": "Stop",
  "session_id": "abc-123",
  "cwd": "/workspace",
  "stop_reason": "end_turn",
  "tool_use_id": null
}
```

## Sync Response Format

For sync mode, the handler must return (or print to stdout) a JSON response:

```json
{ "continue": true }
```

Or to block:

```json
{ "continue": false, "reason": "Tool blocked by policy" }
```

For **command** handlers, a non-zero exit code also blocks the tool (stdout is used as the reason if present).

Sync handler responses are runtime-validated before they are passed to the SDK. Supported top-level fields include `continue`, `suppressOutput`, `stopReason`, `decision`, `systemMessage`, `terminalSequence`, `reason`, `hookSpecificOutput`, or async hook output `{ "async": true, "asyncTimeout": 30 }`.

## Recipes

### 1. Block Dangerous Bash Commands With A Script

No webhook needed — use a local command.

Handler config:
- **Event**: PreToolUse
- **Handler Type**: Command
- **Mode**: Sync
- **Tool Filter**: `Bash`
- **Command**: `python3 /scripts/check-bash.py`
- **On Failure**: Block (Fail-Closed)

`/scripts/check-bash.py`:

```python
import sys, json, re

event = json.load(sys.stdin)
command = event.get("tool_input", {}).get("command", "")

if re.search(r"rm\s+-rf|mkfs|dd\s+if=", command):
    json.dump({"continue": False, "reason": f"Blocked: {command}"}, sys.stdout)
    sys.exit(1)

json.dump({"continue": True}, sys.stdout)
```

### 2. Log All Tool Failures To Slack (Webhook)

Create an n8n workflow with a Webhook trigger that forwards to a Slack node.

Handler config:
- **Event**: PostToolUseFailure
- **Handler Type**: Webhook
- **Mode**: Fire-and-Forget
- **Webhook URL**: your n8n webhook URL

### 3. Custom Approval Gate (Webhook)

Create an n8n workflow with a Webhook trigger that inspects `tool_input.command` and returns `{ "continue": true/false }`.

Handler config:
- **Event**: PreToolUse
- **Handler Type**: Webhook
- **Mode**: Sync
- **Tool Filter**: `Bash`
- **Timeout**: 10
- **On Failure**: Block (Fail-Closed)

Example webhook workflow logic:

```javascript
const command = $input.first().json.tool_input?.command || '';
const dangerous = /rm\s+-rf|mkfs|dd\s+if=/.test(command);

return { json: { continue: !dangerous } };
```

### 4. Log Every Tool Use To A File (Command)

Handler config:
- **Event**: PostToolUse
- **Handler Type**: Command
- **Mode**: Fire-and-Forget
- **Command**: `tee -a /var/log/agent-tools.jsonl`

Each tool use event is appended as a JSON line.

### 5. Notify When Agent Completes

Handler config:
- **Event**: Stop
- **Handler Type**: Webhook
- **Mode**: Fire-and-Forget
- **Webhook URL**: your notification webhook

## Tool Filter Patterns

The Tool Filter field accepts tool name patterns. Examples:

| Pattern | Matches |
|---------|---------|
| `Bash` | Only the Bash tool |
| `mcp__*` | All MCP server tools |
| `mcp__github__*` | All tools from the GitHub MCP server |
| *(empty)* | All tools |

Tool Filter only applies to PreToolUse, PostToolUse, and PostToolUseFailure events.

## Interaction With Permissions

Hook handlers run **after** built-in permission hooks. If a tool is already blocked by path sandbox or tool permission rules, the PreToolUse handler will not fire for that tool — but the PostToolUseFailure handler will.

This means PostToolUseFailure is the best event for visibility into what the agent was denied.

## Troubleshooting

### Handler Not Receiving Events

1. Confirm `Enable Hook Handlers` is checked.
2. For webhooks, confirm the URL is reachable from the n8n server.
3. For commands, confirm the command is on the PATH or use an absolute path.
4. Check the Tool Filter is not accidentally filtering out the tool.

### Agent Seems Slow

Sync handlers add latency to every matched tool invocation. Use fire-and-forget for logging/audit and reserve sync mode for approval gates. Keep timeouts low (5-10s) for approval handlers.

### Errors Are Swallowed

By design. Fire-and-forget mode swallows all errors silently. Sync mode falls back to the `On Failure` setting. Check your webhook endpoint or command stderr if events are not arriving.
