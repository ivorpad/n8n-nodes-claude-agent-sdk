# Durable HITL Setup for WhatsApp, Slack, and Telegram

This document is the current setup reference for channel-based Human-in-the-Loop (HITL) in this repo.

Use this when you want:
- short-lived executions,
- no long `putExecutionToWait()` holds in channel workflows,
- reliable resume via persisted session + pending approval/question records.

## 1. Target Architecture

Use a **durable** pattern:

1. Inbound message starts an execution.
2. `Claude Agent SDK` produces either:
   - final result, or
   - HITL request (`approval_request` / `question_request`).
3. Companion node sends channel message and exits (`dispatchAndExit`).
4. User response starts a new execution.
5. SDK resumes using session memory + HITL response envelope.

For messaging channels, avoid holding executions open unless you explicitly need streaming UX.

There are two durable transport variants:

1. URL callback durable flow (Text Links / CTA buttons / Telegram default URL flow):
   - user clicks signed URL,
   - channel webhook emits strict `approval_response` / `question_response`,
   - SDK resumes.
2. In-chat reply durable flow (WhatsApp `interactiveReplyButtons`):
   - user taps in-chat `Approve` / `Deny` reply button,
   - preferred: incoming payload passes through `Claude Agent WhatsApp` execute path first,
   - companion converts raw `button_reply` token into strict HITL envelope for SDK resume.
   - SDK also has an approval-only fallback for direct trigger-to-SDK paths when reply token is `hitl|approve|...` / `hitl|deny|...`.

## 2. Required Node Wiring

For channel-triggered workflows, choose wiring by delivery mode:

1. URL callback durable (no in-chat token parsing required):
   - `Trigger` -> `If` -> `Claude Agent SDK`
   - `Claude Agent SDK` Result output -> channel node (dispatches links and exits)
   - `Claude Agent SDK` Result output -> normal reply/output path
   - no companion loopback edge required

2. WhatsApp in-chat reply buttons (`interactiveReplyButtons`):
   - preferred: normalize raw WhatsApp `button_reply` via the channel node before SDK
   - recommended DAG wiring (no runtime wait, full approval+question handling):
     - `WhatsApp Trigger` -> `If` -> `Claude Agent WhatsApp (Inbound Adapter)` -> `Claude Agent SDK`
     - `Claude Agent SDK` Result output -> `Claude Agent WhatsApp (Outbound Dispatcher)` -> END
     - `Claude Agent SDK` Result output -> normal reply/output path
   - supported shortcut (approval-only fallback):
     - `WhatsApp Trigger` -> `If` -> `Claude Agent SDK`
     - SDK can infer approval resume from `interactive.button_reply.id` HITL tokens.

Core intent remains the same: each inbound channel event is one short execution (no `putExecutionToWait()` hold in durable mode).

## 3. Required SDK Settings

On `Claude Agent SDK`:

- `Enable HITL = On` (`interactiveApprovals = pauseForApproval`)
- `sdkOwnsWaitResume = false`
- `additionalOptions.persistSession = true`
- attach session memory (recommended: `Postgres Session Memory`)
- set `Task Description` from inbound message content (avoid hard-coded "always ask question" prompts in production)

Why:
- `pauseForApproval` enables strict HITL envelopes.
- `sdkOwnsWaitResume = false` prevents SDK-side waiting in companion-driven channel flows.
- persisted sessions are mandatory for reliable resume.
- hard-coded task text can force repeated loops across executions; use inbound text for new tasks and minimal continuation prompts for resumes.

## 4. Companion Settings (Both Channels)

On channel nodes (`Claude Agent WhatsApp` / `Claude Agent Slack` / `Claude Agent Telegram`):

- `How Claude Continues After This Message = Durable Pause and Exit (Recommended for WhatsApp/Telegram)`
  - code value: `dispatchAndExit`
- `Pending Store Backend = Postgres (Durable)` for production

Recommended: keep wait mode only for web-streaming patterns.

## 4.1 SDK HITL Webhook Auth and Identity

This section applies to the built-in `Claude Agent SDK` HITL webhook endpoint itself:

- direct SDK approval/question links,
- SDK question forms,
- SDK replay/reconnect requests (`format=stream`),
- any client that calls the SDK webhook URL directly.

It does **not** automatically configure companion inbound webhooks such as:

- `Claude Agent WhatsApp`,
- `Claude Agent Telegram`,
- `Claude Agent Email`,
- `Claude Agent Slack`,
- other companion URL/callback nodes.

### When to use it

Use these settings when you want the SDK webhook to require an additional auth layer beyond the signed waiting URL, or when you want to bind an explicit approver identity to accepted HITL responses.

Auth is checked before:

- replay stream attach,
- request lookup,
- approval/question decision consume.

So replay clients must satisfy the same auth requirement as browser approval/question submissions.

### Settings

On `Claude Agent SDK`, with `Enable HITL = On`:

| Setting | Purpose | Best fit |
|---|---|---|
| `Webhook Authentication = None` | Signed URL only; no extra auth | default local/dev, legacy flows |
| `Webhook Authentication = Basic Auth` | HTTP Basic challenge on the SDK webhook | direct browser links for small internal teams |
| `Webhook Authentication = Header Auth` | static secret header check | reverse proxy or service-to-service callers |
| `Webhook Authentication = JWT Auth` | Bearer JWT verification | app-backed approvals or SSO proxy flows |
| `Responder Identity = None` | no approver identity attached | simple allow/deny only |
| `Responder Identity = Basic Auth Username` | use validated Basic username | browser basic-auth prompts |
| `Responder Identity = Request Header` | read identity from trusted header | oauth2-proxy / auth gateway / app proxy |
| `Responder Identity = JWT Claim` | read identity from verified JWT claim | first-party frontend or SSO token flow |

### Browser compatibility

Not every auth mode works with plain email/chat/browser links:

| Access pattern | `None` | `Basic Auth` | `Header Auth` | `JWT Auth` |
|---|---|---|---|---|
| direct browser click on SDK approval/question URL | yes | yes | no | no |
| browser behind reverse proxy that injects auth headers | yes | yes | yes | yes |
| programmatic client / internal service | yes | yes | yes | yes |

Important:

- browsers can handle `Basic Auth` via the standard username/password prompt,
- browsers do **not** attach custom secret headers or Bearer tokens to arbitrary signed links on their own,
- `Header Auth` and `JWT Auth` therefore require either:
  - a proxy/confirmation page that authenticates the user first and forwards the request, or
  - a non-browser client.

### Identity semantics

If `Responder Identity` is anything other than `None`, the SDK treats that identity as required.

On accepted HITL responses, the SDK emits:

```json
{
  "responder": {
    "id": "alice@example.com",
    "source": "header:x-auth-request-email",
    "authMode": "headerAuth"
  }
}
```

Where:

- `id` is the resolved approver identity,
- `source` records how it was derived,
- `authMode` records which webhook auth mode authenticated the request.

Supported identity sources:

| Responder Identity | Resolution |
|---|---|
| `Basic Auth Username` | validated Basic auth username |
| `Request Header` | exact header value from `Responder Identity Header` |
| `JWT Claim` | dot-path lookup from verified JWT payload, for example `sub`, `email`, or `user.email` |

### Recommended patterns

1. Direct internal browser approvals:
   - `Webhook Authentication = Basic Auth`
   - `Responder Identity = Basic Auth Username`

2. Reverse proxy or auth gateway:
   - `Webhook Authentication = Header Auth`
   - proxy adds secret header for admission
   - `Responder Identity = Request Header`
   - proxy also injects a trusted user header like `x-auth-request-email`

3. App-backed approval UI:
   - `Webhook Authentication = JWT Auth`
   - `Responder Identity = JWT Claim`
   - claim path usually `sub` or `email`

### Security notes

- `Header Auth` only proves identity if your proxy strips user-supplied copies of the identity header and re-injects it server-side.
- `JWT Auth` only proves identity if the JWT is minted by a trusted issuer and the configured verification secret/public key matches that issuer.
- `Webhook Authentication = None` means no approver identity is available from the SDK webhook itself.
- This feature does not replace signed waiting URLs; it adds an extra gate on top of them.

For a repeatable test pass, use the companion checklist: [`docs/guides/hitl-webhook-auth-qa.md`](../guides/hitl-webhook-auth-qa.md).

## 4.2 Companion Provider Callback Authentication

Companion provider callbacks are authenticated separately from the SDK's signed HITL URLs. This protects in-chat and provider-native replies before the webhook resolves a pending HITL record or consumes a decision.

Required provider settings:

| Channel | Required setting | Provider signal checked |
|---|---|---|
| WhatsApp | WhatsApp Business Cloud API credential: `App Secret` | `X-Hub-Signature-256` HMAC over the raw Meta callback body |
| Slack | Claude Agent Slack node: `Slack Signing Secret` | `X-Slack-Signature` and `X-Slack-Request-Timestamp` |
| Telegram | Claude Agent Telegram node: `Webhook Secret Token` | `X-Telegram-Bot-Api-Secret-Token` on `callback_query` updates |

Notes:

- WhatsApp in-chat replies are rejected before sender/request fallback lookup unless the Meta signature verifies.
- Slack interaction timestamps must be within the accepted replay window.
- Telegram callback-query workflows must set the same secret token when registering the Telegram webhook.
- Keep these provider secrets server-side and rotate them if they were exposed in workflow exports, logs, or screenshots.

## 4.3 Provider Webhook URL Setup

Do not mix up the two webhook categories:

1. SDK HITL response URLs are generated per HITL request and usually contain `webhook-waiting` or signed response query parameters. These are for users or first-party clients to answer one pending request. Do not register these URLs in WhatsApp, Slack, or Telegram provider dashboards.
2. Provider callback URLs are stable n8n Production webhook URLs. These receive WhatsApp, Slack, or Telegram events and must be registered with the provider.

Use these rules for provider callback URLs:

- Use the n8n **Production URL** from the active workflow, not the Test URL from a manual editor run.
- The public URL must be HTTPS and stable. If n8n sits behind a reverse proxy or tunnel, set the n8n public webhook/base URL to that external origin before activating the workflow.
- Reactivate the workflow after changing the public URL, node ID, tunnel URL, or webhook path.
- Keep one public base URL active at a time. Old provider registrations can keep sending callbacks to inactive n8n webhooks.
- After setup, trigger one real approve/deny flow and confirm the pending record is consumed once.

Provider registration details:

| Provider | What to register | Required secret/auth setup |
|---|---|---|
| WhatsApp / Meta | Register the Meta callback URL on the inbound WhatsApp trigger/webhook that handles Meta verification and feeds `field: messages` events into `Claude Agent WhatsApp` | Set the WhatsApp credential `App Secret`; inbound Meta POSTs reaching `Claude Agent WhatsApp` must include valid `X-Hub-Signature-256` |
| Slack | Slack App -> Interactivity & Shortcuts -> Request URL = Production URL of the `Claude Agent Slack` webhook | Set `Slack Signing Secret` on the node; Slack sends `X-Slack-Signature` and `X-Slack-Request-Timestamp` |
| Telegram | Call Telegram `setWebhook` with the Production URL of the `Claude Agent Telegram` webhook | Pass `secret_token` in `setWebhook` and set the same value as `Webhook Secret Token` on the node |

WhatsApp note:
- Meta's initial `hub.challenge` verification is a provider-registration concern. The HITL reply callback path authenticates Meta POST bodies, but it is not a replacement for a Meta verification endpoint. In the recommended wiring, use the inbound WhatsApp trigger/webhook for Meta verification, then route normalized message events through `Claude Agent WhatsApp`.

Telegram registration example:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${PUBLIC_N8N_TELEGRAM_WEBHOOK_URL}" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET_TOKEN}"
```

Verify Telegram registration with:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

## 4.4 Known-Good Production Examples

Use these as concrete reference setups. Replace domains, node IDs, channel IDs, and secret values with your own production values.

### Example A: WhatsApp In-Chat Approvals

Goal: user sends a WhatsApp message, Claude asks for approval, user taps `Approve` or `Deny` in WhatsApp, and SDK resumes without opening a browser.

Example public base URL:

```text
https://n8n.example.com
```

Workflow wiring:

```text
WhatsApp Trigger / Meta Webhook
  -> Claude Agent WhatsApp (Inbound Adapter)
  -> Claude Agent SDK
  -> Claude Agent WhatsApp (Outbound Dispatcher)
```

Provider setup in Meta:

```text
Callback URL: https://n8n.example.com/webhook/<whatsapp-trigger-production-path>
Verify Token: <the token expected by your WhatsApp trigger/webhook>
Subscribed field: messages
```

n8n credential setup:

```text
WhatsApp Business Cloud API
Access Token: <Meta permanent or temporary access token>
Phone Number ID: <WhatsApp business phone number ID>
App Secret: <Meta app secret from the same Meta app as the callback>
API Version: v22.0
Base URL: https://graph.facebook.com
```

Companion node setup:

```text
Claude Agent WhatsApp
Resource: HITL (Approvals & Questions)
Delivery Mode: In-Chat Reply Buttons (Recommended)
How Claude Continues: Durable Pause and Exit
Pending Store Backend: Postgres (Durable)
Pending Store Table: claude_hitl_pending
```

SDK setup:

```text
Claude Agent SDK
Enable HITL: On
SDK owns wait/resume: Off
Persist session: On
Session memory: Postgres Session Memory
chatSessionId: stable per WhatsApp sender or conversation
```

Expected provider-auth behavior:

```text
Direct Meta POST to Claude Agent WhatsApp webhook -> includes X-Hub-Signature-256
Claude Agent WhatsApp webhook -> verifies signature with App Secret before resolving pending HITL
Unsigned direct provider replies -> 403 Forbidden and pending record remains pending
```

If Meta posts to a separate WhatsApp Trigger / Meta webhook first, that trigger/webhook is responsible for Meta verification and signature validation before it forwards normalized `field: messages` events to `Claude Agent WhatsApp`.

### Example B: Slack Block Kit Approvals

Goal: Claude sends approval buttons to Slack, user clicks a Slack button, Slack posts an interaction payload to n8n, and SDK resumes.

Example public webhook URL:

```text
https://n8n.example.com/webhook/<claude-agent-slack-production-path>
```

Workflow wiring:

```text
Trigger / Schedule / App Input
  -> Claude Agent SDK
  -> Claude Agent Slack
  -> Claude Agent SDK
```

Slack app setup:

```text
OAuth scopes: chat:write, channels:read, im:write
Interactivity & Shortcuts: On
Request URL: https://n8n.example.com/webhook/<claude-agent-slack-production-path>
Signing Secret: <Slack app signing secret>
```

Companion node setup:

```text
Claude Agent Slack
Slack credential: <bot token credential for the same Slack app>
Slack Channel ID: C0123456789
Slack Signing Secret: <Slack app signing secret>
```

SDK setup:

```text
Claude Agent SDK
Enable HITL: On
SDK owns wait/resume: Off
Persist session: On
Session memory: Postgres Session Memory
chatSessionId: stable per task, user, or Slack thread
```

Expected provider-auth behavior:

```text
Slack interaction POST -> includes X-Slack-Signature and X-Slack-Request-Timestamp
Claude Agent Slack -> verifies signature and timestamp before parsing payload
Missing, stale, or invalid signature -> 403 Forbidden and pending record remains pending
```

### Example C: Telegram Inline Callback Approvals

Goal: Claude sends inline Telegram buttons, user taps a button, Telegram sends a callback query to n8n, and SDK resumes.

Example public webhook URL:

```text
https://n8n.example.com/webhook/<claude-agent-telegram-production-path>
```

Generate one high-entropy webhook secret token and use it in both places:

```text
TELEGRAM_WEBHOOK_SECRET_TOKEN=<random 32+ byte token>
```

Register Telegram webhook:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://n8n.example.com/webhook/<claude-agent-telegram-production-path>" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET_TOKEN}" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```

Companion node setup:

```text
Claude Agent Telegram
Telegram credential: <bot token credential>
Telegram Chat ID: <chat ID>
Webhook Secret Token: <same TELEGRAM_WEBHOOK_SECRET_TOKEN>
How Claude Continues: Durable Pause and Exit
Pending Store Backend: Postgres (Durable)
Pending Store Table: claude_hitl_pending
```

SDK setup:

```text
Claude Agent SDK
Enable HITL: On
SDK owns wait/resume: Off
Persist session: On
Session memory: Postgres Session Memory
chatSessionId: stable per Telegram chat or user
```

Expected provider-auth behavior:

```text
Telegram callback_query POST -> includes X-Telegram-Bot-Api-Secret-Token
Claude Agent Telegram -> compares header to Webhook Secret Token before parsing callback data
Missing or wrong token -> 403 Forbidden and pending record remains pending
```

## 4.5 Friendly Option Names (UI) vs Code Values

Use this table when configuring nodes so non-technical operators can match UI labels to underlying code terms:

| Where | UI label (what you click) | Code value (what the node uses) | Meaning |
|---|---|---|---|
| Claude Agent SDK | Enable HITL: `On` | `pauseForApproval` | Emits HITL approval/question envelopes alongside terminal `task_result` on the single `Result` output. |
| Claude Agent SDK | SDK owns wait/resume: `Off` | `sdkOwnsWaitResume = false` | SDK does not hold n8n wait state in channel-companion flows. |
| Claude Agent SDK | Persist session: `On` | `additionalOptions.persistSession = true` | Claude session can resume across executions. |
| HITL WhatsApp/Telegram | How Claude Continues: `Durable Pause and Exit (Recommended for WhatsApp/Telegram)` | `dispatchAndExit` | Companion sends message and execution ends quickly. |
| HITL WhatsApp/Telegram | Pending Store Backend: `Postgres (Durable)` | `postgres` backend | Pending approvals/questions survive restarts. |
| HITL WhatsApp | Delivery Mode: `In-Chat Reply Buttons (Recommended)` | `interactiveReplyButtons` | User taps Approve/Deny in chat, no external URL open. |
| HITL WhatsApp | Delivery Mode: `Template Buttons` | `templateButtons` | Uses approved WhatsApp templates. |

Important clarification:
- `pauseForApproval` here means "emit a HITL request envelope", not "hold execution forever".  
- Durable behavior comes from `dispatchAndExit` + no loopback edge, so each message is a fresh short execution.
- For WhatsApp `interactiveReplyButtons`, companion inbound conversion is still recommended for full approval+question fidelity.

## 5. WhatsApp Setup

## 5.1 Channel/Meta prerequisites

1. Configure WhatsApp Cloud API credentials in n8n.
2. Set the WhatsApp credential `App Secret` from the Meta app used by that callback.
3. Point Meta callback to the inbound WhatsApp trigger/webhook that handles Meta verification.
4. Subscribe the Meta app to message events.
5. Route normalized `field: messages` events through `Claude Agent WhatsApp` before `Claude Agent SDK`.
6. Ensure workflow is active when verifying callback.
7. Re-activate workflow after webhook/base URL changes.

## 5.2 Companion node configuration

Recommended values:

- `Delivery Mode = In-Chat Reply Buttons (Recommended)`
  - code value: `interactiveReplyButtons`
- `How Claude Continues... = Durable Pause and Exit`
  - code value: `dispatchAndExit`
- `Pending Store Backend = Postgres`

Behavior:
- approval requests send in-chat `Approve` / `Deny` reply buttons,
- question requests send in-chat reply buttons/list where possible.

No browser URL click is needed in this mode.

## 5.3 Template mode note

If you choose `Template Buttons`:
- you must have approved WhatsApp templates configured in Meta,
- this is channel-template setup, not a separate companion app.

## 6. Telegram Setup

Recommended values:

- `How Claude Continues... = Durable Pause and Exit` (`dispatchAndExit`)
- `Pending Store Backend = Postgres`
- `Webhook Secret Token = <random high-entropy token>`

Current transport behavior:
- Telegram companion sends inline callback buttons for approve/deny and question options.
- Telegram callback-query updates must include `X-Telegram-Bot-Api-Secret-Token`, which means the Telegram webhook registration must use the same secret token configured on the node.

Question flows can still include a URL fallback when a form response URL is required.

## 7. Slack Setup

Recommended values:

- `Slack Signing Secret = <Slack app signing secret>`
- `Channel ID = <destination channel ID>`

Slack interaction callbacks are accepted only when the request signature and timestamp verify. Use the signing secret from the same Slack app that sends the Block Kit interaction payloads.

Slack app setup:

1. Enable Interactivity in the Slack app.
2. Set the Request URL to the n8n Production URL for the `Claude Agent Slack` webhook.
3. Install or reinstall the app after changing scopes or interaction settings.
4. Confirm the same Slack app provides both the bot token and signing secret used by the node.

## 8. Do We Need Companion Apps?

- WhatsApp: No extra companion app is required for built-in channel + template support.
- Slack: No extra companion app is required beyond the Slack app/bot used for messages and interaction callbacks.
- Telegram: No extra app is required for built-in callback-button flow.

## 9. ngrok / Local Dev Checklist

When tunneling locally:

1. Keep one canonical public base URL at a time.
2. Set n8n webhook/public base config to that URL.
3. Restart n8n after URL changes.
4. Re-activate workflows so webhook registrations refresh.
5. Re-verify Meta callback if required.

If editor and API origins differ across old/new ngrok domains, you can see telemetry/CORS noise in browser logs.

## 10. Troubleshooting Map

`(#2200) Callback verification failed (404)`
- callback URL points to wrong/inactive endpoint,
- workflow not active during verification.

`The requested webhook "... is not registered" (404)`
- workflow inactive, or
- node/webhook not registered in current runtime (restart + reactivate).

`The execution "... has finished already" (409)`
- user clicked old `webhook-waiting` link from previous wait-mode message/execution.
- resume URL was followed **before** n8n entered wait mode (for example acting only on the first NDJSON stream line); wait until the execution is waiting or use the post-wait notification. See `docs/guides/hitl-learnings.md` (Wait/Resume Ownership).
- send a fresh HITL request and use the latest channel response.

`Unauthorized` / browser login prompt on SDK approval link
- `Claude Agent SDK` has `Webhook Authentication = Basic Auth`.
- expected for direct browser links; enter the configured `httpBasicAuth` credentials.

`Forbidden` on SDK approval/question/replay request
- wrong Basic password or `x-auth-token`,
- missing or wrong `Header Auth` secret header,
- missing or invalid Bearer JWT,
- required responder header/claim could not be resolved.

`Forbidden` on companion WhatsApp/Slack/Telegram callback
- WhatsApp: missing/wrong `App Secret` or `X-Hub-Signature-256`,
- Slack: missing/wrong `Slack Signing Secret`, stale timestamp, or invalid `X-Slack-Signature`,
- Telegram: missing/wrong `Webhook Secret Token` or Telegram webhook not registered with that secret token.

`Header Auth` or `JWT Auth` works in curl/app tests but not from email/chat browser links
- direct browsers do not add custom headers or Bearer tokens to signed HITL links,
- put the SDK webhook behind a proxy/confirmation page, or switch direct-link flows to `Basic Auth`.

`Approve/Deny tap repeats the same question or approval request`
- inbound WhatsApp `button_reply` reached `Claude Agent SDK` directly (raw trigger payload), so SDK never received strict `approval_response` / `question_response`.
- route inbound trigger through `Claude Agent WhatsApp` execute path first (adapter mode), then into SDK for full handling.
- if using direct trigger -> SDK shortcut, ensure reply IDs are `hitl|approve|...` / `hitl|deny|...` and `chatSessionId` is stable.
- also ensure `chatSessionId` is stable per user/thread and task description does not force new questions every run.

## 11. Runtime Validation Checklist

Before production:

1. Confirm workflow is active.
2. Confirm companion is `dispatchAndExit`.
3. Confirm wiring matches your delivery mode:
   - URL callback durable: no companion->SDK loopback edge.
   - WhatsApp in-chat reply buttons: inbound companion adapter feeds SDK; outbound dispatcher stays terminal.
4. Confirm session memory mapping is connected.
5. Confirm provider callback auth is configured for the channel:
   - WhatsApp `App Secret`,
   - Slack `Slack Signing Secret`,
   - Telegram `Webhook Secret Token`.
6. Trigger a real approval flow and verify:
   - pending record created,
   - user decision consumed once,
   - SDK resumes same Claude session.

## 12. Related Code Paths

- `nodes/ClaudeAgentSdk/operations/executeTask/`
- `nodes/ClaudeAgentChannelShared/core/providerWebhookAuth.ts`
- `nodes/ClaudeAgentWhatsApp/node/execute.ts`
- `nodes/ClaudeAgentWhatsApp/node/webhook.ts`
- `nodes/ClaudeAgentWhatsApp/transport/whatsapp.ts`
- `nodes/ClaudeAgentSlack/node/execute.ts`
- `nodes/ClaudeAgentSlack/node/webhook.ts`
- `nodes/ClaudeAgentSlack/transport/slack.ts`
- `nodes/ClaudeAgentTelegram/node/execute.ts`
- `nodes/ClaudeAgentTelegram/node/webhook.ts`
- `nodes/ClaudeAgentTelegram/transport/telegram.ts`
