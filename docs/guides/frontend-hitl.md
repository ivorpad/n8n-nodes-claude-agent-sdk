# Frontend HITL Implementation Guide

Use this guide when building a browser, mobile, or other client-hosted UI that talks to a workflow ending in the `Claude Agent SDK` node.

This is the recommended shape for web clients. For external channels like WhatsApp, Slack, Discord, Telegram, Email, or Gmail, use the dedicated channel nodes (`Claude Agent Slack`, `Claude Agent Telegram`, …) wired directly off the SDK's `Result` output — see [`../setup/hitl-channels.md`](../setup/hitl-channels.md).

## Recommended workflow shape

For browser/webhook clients, keep wait/resume ownership inside the SDK node:

```text
[Webhook Trigger] -> [Claude Agent SDK]
                    [Session Memory] -> [Claude Agent SDK]
```

Recommended SDK settings:

- `Enable HITL`: `On`
- `sdkOwnsWaitResume` / `Pause Execution in SDK`: `true`
- `Handle AskUserQuestion`: `true`
- `Load User Settings`: `Off` for deterministic demos or repo-controlled tool surfaces
- `Allowed Tools`: include only tools you want auto-approved

Do **not** add `AskUserQuestion` to `Allowed Tools` when `Handle AskUserQuestion` is enabled. Tools in `Allowed Tools` bypass `canUseTool`, so the question loop will not pause.

## Browser client pattern

The client should:

1. Start the run by POSTing to the public workflow webhook.
2. Consume the NDJSON stream.
3. Render `permission_request` and `ask_user_question` payloads immediately.
4. Respond by POSTing a strict HITL envelope back to the **same public webhook** with the same `sessionId`.
5. Continue rendering the resumed stream from that webhook response.

The browser path is a loopback through the main webhook, not a direct click on signed preview URLs.

## Approval responses

When the UI shows a `permission_request`, POST an `approval_response` envelope back to the main webhook.

Example body shape:

```json
{
  "query": {
    "task": "{\"version\":\"1.0\",\"type\":\"approval_response\",\"requestId\":\"approval_123\",\"decisionId\":\"approval_123:abc\",\"decidedAt\":\"2026-04-14T15:00:00.000Z\",\"channel\":\"webhook\",\"approved\":true,\"resumeSessionId\":\"734b3d2f-51fd-4ae6-873f-7f23956b88c5\"}"
  },
  "sessionId": "734b3d2f-51fd-4ae6-873f-7f23956b88c5"
}
```

Optional fields:

- `reviewerMessage`
- `updatedInput`
- `responder`

## Question responses

When the UI shows an `ask_user_question`, POST a `question_response` envelope back to the main webhook.

Example body shape:

```json
{
  "query": {
    "task": "{\"version\":\"1.0\",\"type\":\"question_response\",\"requestId\":\"question_123\",\"decisionId\":\"question_123:def\",\"decidedAt\":\"2026-04-14T15:02:00.000Z\",\"channel\":\"webhook\",\"answers\":{\"Seniority\":\"Senior\"},\"resumeSessionId\":\"734b3d2f-51fd-4ae6-873f-7f23956b88c5\"}"
  },
  "sessionId": "734b3d2f-51fd-4ae6-873f-7f23956b88c5"
}
```

For option questions, send the canonical option value stored by the UI, not a positional guess.

## Preview vs authoritative wait

The SDK may emit an in-stream HITL preview as soon as `canUseTool` fires so the UI can render controls immediately.

Treat that preview as:

- good enough to render buttons
- **not** the signal that an external automation should fire a signed `webhook-waiting` URL

For browser clients using the main-webhook loopback pattern, the authoritative key is the persisted interaction record identified by `requestId`.

## AGT interplay

When AGT is enabled alongside HITL:

- AGT hard-deny rules still run before a human approval can happen.
- AGT allow hooks must return a neutral `PreToolUse` result, not `permissionDecision: 'allow'`.
- If an AGT hook returns explicit allow, the SDK treats the tool as already approved and `canUseTool` never pauses it.

Use AGT for:

- hard deny
- fail-closed `require_approval` messaging
- rate limits

Use HITL for:

- actual pause/resume approvals on tools listed under `Approval Tool Names or IDs`

## MCP tools in frontend clients

Direct MCP tools configured in this node can participate in HITL.

Current rules:

- direct MCP tools belong in:
  - `MCP Servers`
  - `Allowed Tools` when you want them auto-approved
  - `Disallowed Tools` when you want them blocked
  - `Approval Tool Names or IDs` when you want them paused for approval
  - AGT rule `Tool Names or IDs` when you want policy checks

The AGT/HITL selectors and the `Allowed Tools` / `Disallowed Tools` selectors can dynamically discover direct HTTP MCP tools from configured servers.

## When to use channel nodes instead

Use the dedicated channel nodes only when the responder lives outside the web client:

- `Claude Agent WhatsApp`
- `Claude Agent Slack`
- `Claude Agent Discord`
- `Claude Agent Email` / `Claude Agent Gmail`
- `Claude Agent Telegram`
- `Claude Agent Woztell`

Those flows use:

- `sdkOwnsWaitResume = false`
- the channel node wired off the SDK's single `Result` output (it filters for `approval_request` / `question_request` items and silently ignores `task_result`)
- the channel node's webhook returning `approval_response` / `question_response` back into the SDK node

That is a different architecture from browser/webhook HITL.

## QA checklist

For a new frontend HITL implementation, verify:

1. First `AskUserQuestion` pauses without `AskUserQuestion` being in `Allowed Tools`.
2. A `question_response` posted to the main webhook resumes the same session and asks the next question.
3. A `permission_request` approval posted to the main webhook resumes the original waiting execution.
4. AGT hard-deny rules still block invalid tool calls before approval.
5. Duplicate approve/deny responses are idempotent.

## Related

- [`hitl-learnings.md`](./hitl-learnings.md)
- [`agt-governance.md`](./agt-governance.md)
- [`../reference/streaming-protocol.md`](../reference/streaming-protocol.md)
