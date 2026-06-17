# SDK HITL Webhook Auth QA Checklist

Use this checklist to validate the `Claude Agent SDK` built-in HITL webhook auth and responder identity settings.

This covers:

- direct SDK approval/question URLs,
- SDK question forms,
- SDK replay/reconnect requests (`format=stream`),
- responder identity emitted on accepted SDK HITL envelopes.

This does **not** cover:

- channel inbound webhooks (`Claude Agent WhatsApp`, `Telegram`, `Email`, `Slack`, etc.),
- channel-native reply flows that never hit the SDK webhook directly.

## Preconditions

- workflow is active,
- `Claude Agent SDK` has `Enable HITL = On`,
- `additionalOptions.persistSession = true`,
- a fresh approval or question request can be generated on demand,
- if testing replay, you can capture the relevant `streamKey`.

Important:

- generate a **fresh** HITL request for each scenario,
- do not reuse a URL after a successful approval/question submit,
- duplicate/conflict semantics are expected after the first accepted decision and can hide auth issues.

## Automated Regression Pass

Run the focused tests first:

```bash
pnpm exec vitest run \
  nodes/ClaudeAgentSdk/__tests__/webhook/webhook.hitl.test.ts \
  nodes/ClaudeAgentSdk/__tests__/permissions/approvalProperties.test.ts \
  nodes/ClaudeAgentSdk/__tests__/operations/hitlContract.test.ts
```

Expected:

- all tests pass,
- auth cases cover `Basic Auth`, `Header Auth`, `JWT Auth`,
- accepted approval/question payloads can carry `responder`.

## Core Manual Matrix

| Scenario | Webhook Authentication | Responder Identity | Client | Expected result |
|---|---|---|---|---|
| baseline | `None` | `None` | browser or curl | request succeeds, no `responder` |
| browser basic auth | `Basic Auth` | `Basic Auth Username` | browser | auth prompt appears, success with correct creds |
| header auth only | `Header Auth` | `None` | curl or proxy | `403` without secret header, success with it |
| header auth + identity | `Header Auth` | `Request Header` | curl or proxy | `403` if secret or identity header missing |
| jwt auth + identity | `JWT Auth` | `JWT Claim` | curl or app/proxy | `401/403` on missing/invalid token, success on valid token |
| replay with auth | any non-`None` mode | optional | curl/app | replay requires same auth as approval/question submit |

## 1. Baseline: Signed URL Only

Configuration:

- `Webhook Authentication = None`
- `Responder Identity = None`

Steps:

1. Generate a fresh approval request.
2. Open the signed approval URL.
3. Approve or deny.
4. Repeat with a fresh question request and submit an answer.

Expected:

- approval/question succeeds,
- output payload has no `responder`,
- replay still works if the signed request is otherwise valid.

## 2. Basic Auth Browser Flow

Configuration:

- `Webhook Authentication = Basic Auth`
- `Responder Identity = Basic Auth Username`
- attach `httpBasicAuth`

Steps:

1. Generate a fresh approval request.
2. Open the approval URL in a browser.
3. Confirm the browser shows an auth prompt.
4. Try bad credentials once.
5. Retry with valid credentials.
6. Repeat with a question URL if the workflow uses question forms.

Expected:

- missing credentials: browser prompt or `401 Unauthorized`,
- wrong credentials: `403 Forbidden`,
- correct credentials: decision succeeds,
- accepted payload contains:

```json
{
  "responder": {
    "id": "<basic username>",
    "source": "basicAuth.username",
    "authMode": "basicAuth"
  }
}
```

## 3. Header Auth Proxy or Service Flow

Configuration:

- `Webhook Authentication = Header Auth`
- attach `httpHeaderAuth`
- optional: `Responder Identity = Request Header`

Steps:

1. Generate a fresh approval request.
2. Call the URL without the secret header.
3. Call again with the secret header.
4. If testing identity binding, call once without the identity header and once with it.

Example:

```bash
curl -i '<SIGNED_URL>' \
  -H 'x-hitl-secret: shared-secret' \
  -H 'x-auth-request-email: approver@example.com'
```

Expected:

- missing/wrong secret header: `403 Forbidden`,
- secret header present, identity mode `None`: success,
- secret present, identity header missing while `Responder Identity = Request Header`: `403 Forbidden`,
- success payload uses the configured identity header value as `responder.id`.

Important:

- do not QA `Header Auth` from a plain browser click,
- browsers will not attach custom secret headers to arbitrary signed links.

## 4. JWT Auth Flow

Configuration:

- `Webhook Authentication = JWT Auth`
- attach `jwtAuth`
- `Responder Identity = JWT Claim`
- set `Responder Identity JWT Claim` to something like `sub`, `email`, or `user.email`

Steps:

1. Generate a fresh approval request.
2. Call the URL with no bearer token.
3. Call with an invalid or expired token.
4. Call with a valid token whose claim matches the configured path.

Example bearer request:

```bash
curl -i '<SIGNED_URL>' \
  -H 'Authorization: Bearer <JWT>'
```

Expected:

- no bearer token: `401 Unauthorized`,
- invalid signature or expired token: `403`,
- valid token: success,
- payload `responder.id` equals the configured JWT claim value.

## 5. Replay / Stream Reconnect

This is easy to miss and should be tested explicitly.

Steps:

1. Start a run that exposes or emits a `streamKey`.
2. Call the replay URL:

```bash
curl -i '<SDK_WEBHOOK>?format=stream&streamKey=<STREAM_KEY>&replay=true'
```

3. Repeat with the auth required for the configured mode.

Expected:

- with auth enabled, replay is blocked without valid auth,
- with valid auth, replay attaches normally,
- auth is enforced before replay attach, not after.

## 6. Question Flow

For each auth mode you support in production:

1. Generate a fresh question request.
2. Load the question form or submit answers via client/proxy.
3. Verify the answer is consumed exactly once.
4. Verify the accepted `question_response` payload includes `responder` when configured.

Expected:

- auth failure prevents form submit/answer consume,
- success payload includes both:
  - `answers`
  - `responder` when identity binding is enabled.

## 7. Output Payload Inspection

On accepted runs, inspect the SDK Result output item.

Check:

- `type` is `approval_response` or `question_response`,
- `requestId`, `decisionId`, `decidedAt`, `channel` are present,
- `responder` is absent when identity is `None`,
- `responder.id`, `responder.source`, and `responder.authMode` are correct when identity is enabled.

## 8. Troubleshooting Patterns

`Unauthorized`

- expected for missing `Basic Auth` or missing bearer token,
- for browser-based `Basic Auth`, the login prompt is the expected UX.

`Forbidden`

- wrong Basic credentials,
- wrong or missing header-auth secret,
- invalid/expired JWT,
- required responder header or JWT claim missing.

`Header Auth` or `JWT Auth` works in curl but not from browser links

- expected unless a proxy or confirmation page injects auth on the browser's behalf.

Duplicate/conflict message after a successful decision

- expected if the same request URL is reused,
- regenerate a fresh HITL request before continuing QA.

## Exit Criteria

The feature is ready when:

- automated regression tests pass,
- every auth mode you plan to use has at least one successful manual pass,
- negative cases return the expected `401` or `403`,
- replay honors the same auth gate,
- accepted payloads show the expected `responder` behavior.
