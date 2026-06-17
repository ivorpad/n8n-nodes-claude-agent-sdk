# QA Plan: HITL Improvements (Deny Feedback, Modified Input, Session State)

Commits: `481f536` → `488a5bd` (6 commits on master)

## Automated Tests

```bash
npx vitest run nodes/ClaudeAgentSdk/__tests__/permissions/canUseToolCallback.hitl.test.ts
```

8 new tests in `pendingApprovalResolution` describe block:
- Denied with reviewer message (no interrupt)
- Denied with default message when reviewerMessage absent
- Approved with updatedInput
- Approved with original input (no updatedInput)
- Hard safety re-check blocks malicious updatedInput via content filter
- Consumed-once semantics (resolution used once, next tool follows normal flow)
- Fallback matching by toolName when fingerprint is stale
- Non-matching tool doesn't consume resolution

## Manual Smoke Tests

### Prerequisites

1. Workflow with Claude Agent SDK node, interactive approvals enabled (`pauseForApproval`)
2. Trigger a tool call that requires approval (e.g. Bash)
3. Note the `requestId` from the HITL request payload or stream

### 1. Backwards Compatibility — GET links

**GET approve:**
```
https://<webhook-url>?requestId=<id>&approved=true
```
Expected: HTML page "Approved", tool executes with original input.

**GET deny:**
```
https://<webhook-url>?requestId=<id>&approved=false
```
Expected: HTML page "Denied", Claude sees generic denial.

- [ ] GET approve works as before
- [ ] GET deny works as before

### 2. POST Deny with Feedback

```bash
curl -X POST "https://<webhook-url>?requestId=<id>" \
  -H "Content-Type: application/json" \
  -d '{"approved": false, "reviewerMessage": "Use ls instead of rm"}'
```

Expected:
- Response: `{ "success": true, "message": "Denied" }`
- Claude's next turn references the reviewer's feedback and adapts approach
- Stream shows `approval_response` chunk with `message` field

- [ ] Claude sees reviewer message as tool_result error (not interrupt)
- [ ] Claude adapts based on the feedback

### 3. POST Approve with Modified Input

```bash
curl -X POST "https://<webhook-url>?requestId=<id>" \
  -H "Content-Type: application/json" \
  -d '{
    "approved": true,
    "updatedInput": {"command": "ls -la /tmp"}
  }'
```

Expected:
- Tool executes with `ls -la /tmp` (not original command)
- Stream shows `approval_response` chunk with `updatedInput` field
- Task output shows the modified command was executed

- [ ] Tool runs with modified input
- [ ] Original dangerous input was NOT executed

### 4. Safety Re-check on Modified Input

Enable content filter blocking a pattern (e.g. `/etc/shadow`). Approve with updatedInput containing the blocked pattern.

```bash
curl -X POST "https://<webhook-url>?requestId=<id>" \
  -H "Content-Type: application/json" \
  -d '{
    "approved": true,
    "updatedInput": {"command": "cat /etc/shadow"}
  }'
```

Expected: Tool is **denied** despite approval — safety re-check catches it.

- [ ] Modified input blocked by content filter
- [ ] Modified input blocked by path sandbox (if configured)
- [ ] Modified input blocked by blocked tools list

### 5. Idempotency / Duplicate Detection

```bash
# First POST
curl -X POST "https://<webhook-url>?requestId=<id>" \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'
# Expected: success

# Duplicate POST (same decision)
curl -X POST "https://<webhook-url>?requestId=<id>" \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'
# Expected: "This HITL request was already answered."

# Conflicting POST (different decision)
curl -X POST "https://<webhook-url>?requestId=<id>" \
  -H "Content-Type: application/json" \
  -d '{"approved": false}'
# Expected: "This HITL request was already answered with a different response."
```

- [ ] Duplicate returns "already answered"
- [ ] Conflict returns "already answered with a different response"
- [ ] Semantically different approvals (different reviewerMessage) are NOT duplicates

### 6. Postgres Durable Store

If Postgres credential configured:

```sql
SELECT request_id, reviewer_message, updated_input
FROM hitl_interactions
WHERE request_id = '<id>';
```

- [ ] `reviewer_message` populated after POST deny with message
- [ ] `updated_input` populated after POST approve with updatedInput
- [ ] Additive migration runs cleanly (columns added if missing)

### 7. session_state_changed

Set env: `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=true`

Subscribe to `system:session_state_changed` in streaming config contentTypes.

- [ ] Stream includes `{ type: "system", subtype: "session_state_changed", state: "running" }`
- [ ] State transitions: running → idle (normal), running → requires_action (HITL)
- [ ] `sharedState.sessionState` reflects latest value

### 8. Stream / Companion UI

If using NDJSON stream:

- [ ] `approval_response` chunks include `message` field when reviewer message present
- [ ] `approval_response` chunks include `updatedInput` field when modified input present
- [ ] UAC v1 response events include same fields
- [ ] `system:session_state_changed` appears when subscribed

## Edge Cases

- POST with `updatedInput` that is a JSON string (not object) → should be parsed
- POST with `updatedInput` that is an array → should be rejected ("must be a plain JSON object")
- POST with both query `?approved=true` and body `{ "approved": false }` → should return error ("query and body disagree")
- POST with `reviewerMessage` as empty string → should be treated as absent
- Resume from denied approval with no reviewer message → default "denied by the reviewer" message
