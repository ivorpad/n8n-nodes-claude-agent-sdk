# Human-In-The-Loop

HITL lets a workflow pause for human approval or answers when Claude attempts a
tool call or uses `AskUserQuestion`.

## Core SDK Settings

On `Claude Agent SDK`:

- **Enable HITL** = `On`.
- Keep **Persist Session** enabled.
- Use a stable **Chat Session ID**.
- Connect a Session Memory node for durable multi-execution resume.
- Choose **Approval Scope**:
  - all tools not explicitly allowed,
  - file operations only,
  - Bash commands only,
  - specific tools.
- Prefer **Approval Match Mode** = `Tool Only` unless exact-input approvals are
  required.

When HITL is enabled, the runtime forces local CLI permission mode back to
`Default`; approval responders cannot escalate permission mode unless the
workflow explicitly allows override modes.

Do not put `AskUserQuestion` in **Allowed Tools** when **Handle AskUserQuestion**
is enabled. Allowed tools bypass the pause path.

## Wait/Resume Ownership

Use **Pause Execution in SDK** to choose who owns n8n wait/resume:

| Flow | Pause Execution in SDK |
|---|---|
| Browser or direct webhook approval/question flow | `On` |
| Dedicated channel nodes such as Slack, Telegram, WhatsApp, Email, Gmail, Discord, Woztell | `Off` |

The SDK may emit an in-stream preview of a HITL request for responsive UIs. Treat
that preview as non-authoritative for external automations. Signed waiting URLs
and channel notifications must not be acted on until after n8n has entered wait
state, or the response can race a finished execution.

## Browser/Webhook HITL

Use this shape for a web app, mobile app, or client that talks directly to a
workflow ending in `Claude Agent SDK`:

```text
Webhook Trigger -> Claude Agent SDK
Session Memory -> Claude Agent SDK
```

Settings:

- **Enable HITL** = `On`.
- **Pause Execution in SDK** = `On`.
- **Handle AskUserQuestion** = `On` when you want questions to pause.
- Configure **Webhook Authentication** for anything beyond local testing.

The client starts a run by posting to the public workflow webhook. When it sees
an approval or question payload, it posts a strict HITL envelope back through the
workflow/webhook path with the same session identity.

Approval response shape:

```json
{
  "version": "1.0",
  "type": "approval_response",
  "requestId": "approval_123",
  "decisionId": "approval_123:unique-client-decision",
  "decidedAt": "2026-06-17T12:00:00.000Z",
  "channel": "webhook",
  "approved": true,
  "resumeSessionId": "stable-chat-session-id"
}
```

Question response shape:

```json
{
  "version": "1.0",
  "type": "question_response",
  "requestId": "question_123",
  "decisionId": "question_123:unique-client-decision",
  "decidedAt": "2026-06-17T12:01:00.000Z",
  "channel": "webhook",
  "answers": {
    "Which format should I use?": "Markdown"
  },
  "resumeSessionId": "stable-chat-session-id"
}
```

## SDK Webhook Authentication

The SDK HITL webhook can require an additional gate beyond the signed n8n resume
URL:

| Mode | Use For |
|---|---|
| `None` | Local testing or signed-link-only flows |
| `Basic Auth` | Direct browser links for a small internal audience |
| `Header Auth` | Reverse proxy or service-to-service clients |
| `JWT Auth` | First-party app or SSO proxy flows |

Direct browser links cannot attach custom headers or Bearer tokens. Use Basic
Auth for direct browser prompts, or put Header/JWT modes behind a proxy or
approval UI that injects the required headers.

If **Responder Identity** is configured, accepted HITL responses include the
resolved responder. Header-based identity is trustworthy only when your proxy
strips user-supplied identity headers and re-injects them server-side.

A GET request never approves by itself. Browser clicks render a confirmation
page; the decision is applied only on POST.

## Channel-Node HITL

Use dedicated channel nodes when the human responder lives in Slack, Telegram,
WhatsApp, Email, Gmail, Discord, or Woztell.

Flow:

```text
Trigger -> Claude Agent SDK
Claude Agent SDK Result -> Claude Agent <Channel>
Claude Agent SDK Result -> normal result path
```

Settings on `Claude Agent SDK`:

- **Enable HITL** = `On`.
- **Pause Execution in SDK** = `Off`.
- **Persist Session** = `On`.
- Stable **Chat Session ID**.
- Session Memory connected, preferably Postgres for queue mode.

Settings on channel nodes:

- Use durable dispatch/exit mode where the node offers it.
- Use a Postgres pending store for production channel resume where available.
- Configure provider callback authentication for channels that support native
  signed callbacks.

Channel nodes filter SDK Result items by `json.type`; they handle
`approval_request` and `question_request` items and ignore terminal
`task_result` items.

## Provider Callback Authentication

Channel provider callbacks are separate from the SDK signed HITL URLs.

| Channel | Auth Signal |
|---|---|
| WhatsApp | Meta `X-Hub-Signature-256` verified with the WhatsApp app secret |
| Slack | `X-Slack-Signature` and `X-Slack-Request-Timestamp` verified with the Slack signing secret |
| Telegram | `X-Telegram-Bot-Api-Secret-Token` matching the configured webhook secret token |
| Discord | Discord interaction signature verification with the configured public key |

Register provider dashboards with the stable n8n Production webhook URL for the
channel node or trigger. Do not register per-request SDK waiting URLs in provider
dashboards.

Reactivate the workflow after changing public base URL, webhook path, tunnel, or
node ID.

## Production Checklist

Before production:

1. Use stable `chatSessionId` values.
2. Keep **Persist Session** enabled.
3. Prefer Postgres Session Memory when queue-mode workers can run the same
   `chatSessionId`.
4. Use SDK-owned wait/resume for browser/webhook clients.
5. Turn SDK wait/resume off for channel nodes.
6. Configure SDK webhook auth for direct approval links.
7. Configure provider callback authentication for channel callbacks.
8. Test approval, denial, question, duplicate response, and worker restart
   behavior.
