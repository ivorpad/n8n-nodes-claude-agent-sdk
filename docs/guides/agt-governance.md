# AGT Governance — User Guide

Declarative policy-as-code enforcement for the Claude Agent SDK n8n node, powered by [@microsoft/agentmesh-sdk](https://www.npmjs.com/package/@microsoft/agentmesh-sdk).

## What AGT is

AGT (Agent Governance Toolkit) is Microsoft's open-source policy engine for AI agents. In this node, AGT lets you write **declarative rules** that gate every tool call the agent makes without writing code. Rules live as structured workflow data, are evaluated in-process on every tool call, and are easy to diff and review in git.

Use it when you want non-engineers to author policy, when you need numeric or equality gating that cannot be expressed by `Allowed Tools` / `Disallowed Tools`, or when you need rate-limited tool budgets.

## When to use AGT vs the existing controls

| Need | Tool | Why |
|------|------|-----|
| Block a tool entirely | **Disallowed Tools** | Simpler, no policy engine needed |
| Allow only specific tools | **Allowed Tools** | Simpler, no policy engine needed |
| Block based on file path patterns | **Path Sandboxing** + **Block Env Files** | AGT cannot do substring or prefix checks on strings |
| Block based on regex content | **Content Filtering** | AGT cannot do regex |
| Pause for human approval | **Enable HITL** + **Approval Scope** | AGT hooks cannot pause execution |
| Custom JS logic per tool call | **Hook Handlers** (webhook/command) | Full programmability |
| **Numeric/equality gating on tool input** | **AGT** | Only AGT does this declaratively |
| **Rate limit a tool** | **AGT** | `20/hour` style limits per rule |
| **Different rules or budgets per agent identity** | **AGT** | Agent DID scoping |
| **Tamper-evident audit chain** | AGT (not yet wired in this node) | AGT supports it; we'd add it on demand |

If your need is "block Bash commands containing rm" use a **Hook Handler** or **Content Filtering**, not AGT. If your need is "deny refunds over 500" or "deny invoice posting when amount >= 10000", that is exactly what AGT is for.

## How it works

AGT runs as a **PreToolUse hook** on the SDK. Every tool call the agent makes, built-in (`Read`, `Bash`, `Write`...) or MCP, fires the hook. The hook evaluates the tool name and tool input against your rules and returns `allow` or `deny`.

```
Agent decides to call a tool
        │
        ▼
   Claude Code SDK
        │
        ▼  PreToolUse hook chain
        │
        ├─ User-defined webhook hooks
        │
        └─ AGT hook ──→ evaluate(toolName, toolInput)
                         │
                         ├─ allow → tool runs
                         └─ deny  → tool blocked, agent sees error
```

### Why a hook, not `canUseTool`

The Claude Code SDK auto-allows built-in tools that are in `Allowed Tools`, bypassing `canUseTool` under `Permission Mode = Default`. Hooks still fire on every tool call. That makes the hook path the reliable place to enforce AGT.

For unattended AGT-only runs, `Permission Mode = Don't Ask` is still the better operator choice because it avoids SDK confirmation prompts. AGT itself is enforced through the hook, not through `canUseTool`.

## Supported expression operators

AGT's expression engine is intentionally narrow. The n8n filter UI lets you pick from the full operator list, but **only these compile to working AGT expressions**:

| n8n filter operator | AGT expression | Works |
|---|---|---|
| `equals` (string) | `field == 'value'` | Yes |
| `notEquals` (string) | `field != 'value'` | Yes |
| `equals` (number) | `field == 50` | Yes |
| `notEquals` (number) | `field != 50` | Yes |
| `greaterThan` / `gt` | `field > 50` | Yes |
| `greaterThanOrEqual` / `gte` | `field >= 50` | Yes |
| `lessThan` / `lt` | `field < 50` | Yes |
| `lessThanOrEqual` / `lte` | `field <= 50` | Yes |
| `contains` (string) | n/a | No |
| `startsWith` / `endsWith` | n/a | No |
| regex / matches | n/a | No |

**For string substring or prefix matching, use Content Filtering or a Hook Handler instead.**

## Baseline n8n node settings

These are the exact node settings that pair well with AGT today.

### AGT-only, unattended automation

Use this when AGT should make the final allow/deny decision and there is no human approval queue.

- `Permission Mode`: `Don't Ask`
- `Enable HITL`: `Off`
- `Allowed Tools`: leave empty unless you need SDK auto-approval for a separate reason
- `Disallowed Tools`: use only for unconditional bans that do not need AGT conditions
- `Block Env Files`: `On`
- `Security Options > AGT Governance > Settings > Enable`: `On`
- `Security Options > AGT Governance > Settings > Default Action`: `Deny`
- `Security Options > AGT Governance > Settings > Conflict Strategy`: `Deny Overrides`
- `Security Options > AGT Governance > Settings > Agent DID`: leave blank unless you want to override the default per-session identity with a stable named identity

This gives you a strict default-deny policy baseline and avoids SDK confirmation prompts.

### AGT + HITL for enterprise approvals

Use this when AGT should be the hard policy gate and HITL should handle the actual pause/resume approval flow.

- `Enable HITL`: `On`
- `Approval Scope`: `All Tools Not Explicitly Allowed`
- `Approval Match Mode`: `Tool Only (Recommended)`
- `Approval Timeout`: set to your operational SLA
- `Default on Timeout`: `Deny`
- `Handle AskUserQuestion`: `On`
- `Allowed Tools`: include only read-only or low-risk tools
- `Disallowed Tools`: use for unconditional bans
- `Block Env Files`: `On`
- `Security Options > AGT Governance > Settings > Enable`: `On`
- `Security Options > AGT Governance > Settings > Default Action`: `Deny`
- `Security Options > AGT Governance > Settings > Conflict Strategy`: `Deny Overrides`

When HITL is enabled, the node forces `Permission Mode = Default`. AGT still runs as a PreToolUse hook and remains a hard deny layer.

### Read-only investigation agents

Use this for compliance, support investigation, internal audit, and other gather-and-summarise workflows.

- `Permission Mode`: `Don't Ask`
- `Enable HITL`: `Off`
- `Block Env Files`: `On`
- `Security Options > AGT Governance > Settings > Enable`: `On`
- `Security Options > AGT Governance > Settings > Default Action`: `Deny`
- `Security Options > AGT Governance > Settings > Conflict Strategy`: `Deny Overrides`
- Add `Allow` rules only for read-only tools and read-only MCP actions

This pattern is usually cleaner than maintaining a large `Disallowed Tools` list.

### What AGT cannot do today

- `Decision = Require Approval` in an AGT rule does **not** pause the run. In the current node it behaves as an effective deny with a clear message.
- AGT cannot conditionally route some calls for approval and auto-allow others based on input, such as "refunds under 50 auto-approve, refunds 50-499 go to HITL".
- If you need every call to a tool approved, keep that tool out of `Allowed Tools` and use `Approval Scope = All Tools Not Explicitly Allowed`.
- If you need conditional approval logic, use a **Hook Handler** or explicit workflow orchestration around HITL.

## Where AGT fits best in n8n business workflows

In this node, AGT is strongest when the decision can be expressed as **tool name + a few structured fields on tool input**.

That usually means:

- **Finance controls** — refund amount bands, invoice amount thresholds, vendor status, payment terms, bank-validation state
- **Support operations** — allow lookups, cap low-risk actions, deny high-value actions, force the rest through HITL
- **Identity and access operations** — block executive, tier-zero, privileged, or break-glass accounts before anyone can approve them
- **Privacy and compliance workflows** — allow evidence gathering, deny invalid requester types, cap or gate export tools
- **RevOps and commercial approvals** — quote discounts, non-standard terms, region or product eligibility, contract-type checks

If the control is about **path prefixes, regex, prompt content, shell fragments, or free-form text inspection**, AGT is the wrong layer here. Use **Path Sandboxing**, **Content Filtering**, or **Hook Handlers** instead.

## Enterprise workflow recipes

These examples use exact node labels and rule fields from the current n8n node surface.

### 1. Customer support refunds and credits

Use this when a support agent can read ticket and order data, auto-process very small refunds, and hard-block high-value refunds.

**Node settings**

```text
Permission Mode: Don't Ask
Enable HITL: Off
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:support-refunds
```

**AGT rules**

```text
Name: allow-support-lookups
Tools: [mcp__support__get_ticket, mcp__orders__get_order, mcp__billing__get_payment]
Decision: Allow
Priority: 100

Name: allow-small-refunds
Tools: [mcp__billing__process_refund]
Decision: Allow
Conditions: amount lessThan 50
Priority: 200
Rate Limit: 20/hour

Name: block-large-refunds
Tools: [mcp__billing__process_refund]
Decision: Deny
Conditions: amount greaterThanOrEqual 500
Priority: 300
```

**Result**

- Ticket, order, and payment lookups are allowed.
- Refunds under `50` are auto-processed, with a per-agent budget.
- Refunds `500` and above are denied outright.
- Refunds in the middle band are denied by `Default Action = Deny` unless you add another explicit allow rule.

If you want every refund reviewed by a human instead, switch to the HITL pattern below and leave `mcp__billing__process_refund` out of `Allowed Tools`.

### 2. Accounts payable invoice posting

Use this when the agent can gather invoice context automatically, but any actual posting into the ERP must go through HITL after AGT checks.

**Node settings**

```text
Enable HITL: On
Approval Scope: All Tools Not Explicitly Allowed
Approval Match Mode: Tool Only (Recommended)
Default on Timeout: Deny
Handle AskUserQuestion: On
Allowed Tools:
  - mcp__erp__get_invoice
  - mcp__erp__get_vendor
  - mcp__erp__get_purchase_order
  - mcp__erp__validate_cost_centre
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:accounts-payable
```

**AGT rules**

```text
Name: allow-ap-lookups
Tools: [mcp__erp__get_invoice, mcp__erp__get_vendor, mcp__erp__get_purchase_order, mcp__erp__validate_cost_centre]
Decision: Allow
Priority: 100

Name: allow-invoice-posting-candidates
Tools: [mcp__erp__post_invoice]
Decision: Allow
Priority: 150

Name: deny-unapproved-vendors
Tools: [mcp__erp__post_invoice]
Decision: Deny
Conditions: vendor_status notEquals approved
Priority: 300

Name: deny-large-invoices
Tools: [mcp__erp__post_invoice]
Decision: Deny
Conditions: amount greaterThanOrEqual 10000
Priority: 300
```

**Result**

- Read-only ERP lookups run unattended.
- `mcp__erp__post_invoice` is intentionally **not** in `Allowed Tools`, so valid posting attempts pause for HITL.
- AGT still hard-denies blocked vendors and very large invoices before they can be approved.

### 3. HR offboarding and access removal

Use this when the agent can gather employee context automatically, but executive or high-privilege identities must never be actioned automatically.

**Node settings**

```text
Enable HITL: On
Approval Scope: All Tools Not Explicitly Allowed
Approval Match Mode: Tool Only (Recommended)
Default on Timeout: Deny
Handle AskUserQuestion: On
Allowed Tools:
  - mcp__hr__get_employee
  - mcp__identity__list_groups
  - mcp__devices__list_assigned_devices
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:hr-offboarding
```

**AGT rules**

```text
Name: allow-hr-lookups
Tools: [mcp__hr__get_employee, mcp__identity__list_groups, mcp__devices__list_assigned_devices]
Decision: Allow
Priority: 100

Name: allow-standard-offboarding-actions
Tools: [mcp__identity__disable_account, mcp__identity__revoke_group_access, mcp__devices__wipe_device]
Decision: Allow
Priority: 150

Name: deny-executive-offboarding
Tools: [mcp__identity__disable_account, mcp__identity__revoke_group_access, mcp__devices__wipe_device]
Decision: Deny
Conditions: role equals executive
Priority: 300

Name: deny-tier-zero-accounts
Tools: [mcp__identity__disable_account, mcp__identity__revoke_group_access]
Decision: Deny
Conditions: account_tier equals tier0
Priority: 300
```

**Result**

- The agent can gather employee, group, and device context automatically.
- Mutating actions stay out of `Allowed Tools`, so they pause for HITL.
- AGT blocks executive and tier-zero accounts entirely, even if someone tries to approve them through the normal queue.

### 4. Compliance evidence collection

Use this when the agent must gather evidence from ticketing, document, and control systems, but must not mutate anything.

**Node settings**

```text
Permission Mode: Don't Ask
Enable HITL: Off
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:compliance-evidence
```

**AGT rules**

```text
Name: allow-control-lookups
Tools: [mcp__grc__get_control, mcp__tickets__get_issue, mcp__docs__get_document, mcp__storage__list_folder]
Decision: Allow
Priority: 100

Name: cap-document-exports
Tools: [mcp__docs__export_document]
Decision: Allow
Priority: 150
Rate Limit: 50/hour
```

**Result**

- The agent is default-deny and read-only by construction.
- Evidence lookups are allowed.
- Document exports are allowed but budgeted.
- Anything that looks like a write, delete, approval, or access change is denied because there is no matching allow rule.

### 5. Incident triage with controlled remediation

Use this when the agent can investigate freely, but shell actions and file edits must go through HITL and stay rate-limited.

**Node settings**

```text
Enable HITL: On
Approval Scope: Specific Tools
Approval Tool Names or IDs: [Bash, Write, Edit]
Approval Match Mode: Tool Only (Recommended)
Default on Timeout: Deny
Handle AskUserQuestion: On
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:incident-triage
```

**AGT rules**

```text
Name: allow-investigation-tools
Tools: [Read, Grep, Glob, WebFetch, WebSearch, mcp__monitoring__get_incident, mcp__monitoring__get_service_status]
Decision: Allow
Priority: 100

Name: allow-approved-file-remediation
Tools: [Write, Edit]
Decision: Allow
Priority: 150

Name: cap-shell-actions
Tools: [Bash]
Decision: Allow
Priority: 200
Rate Limit: 5/hour
```

**Result**

- Investigation is fast and unattended.
- `Bash`, `Write`, and `Edit` always pause for approval because HITL owns those tools.
- AGT adds a per-agent shell budget so a single session cannot spam remediation commands after approval.

### 6. RevOps quote discounts and non-standard commercial terms

Use this when the agent can gather CRM and pricing context automatically, but any quote change with a meaningful discount or non-standard terms must be gated.

**Node settings**

```text
Enable HITL: On
Approval Scope: All Tools Not Explicitly Allowed
Approval Match Mode: Tool Only (Recommended)
Default on Timeout: Deny
Handle AskUserQuestion: On
Allowed Tools:
  - mcp__crm__get_account
  - mcp__crm__get_opportunity
  - mcp__pricing__get_price_book
  - mcp__pricing__get_discount_policy
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:revops-quotes
```

**AGT rules**

```text
Name: allow-revops-lookups
Tools: [mcp__crm__get_account, mcp__crm__get_opportunity, mcp__pricing__get_price_book, mcp__pricing__get_discount_policy]
Decision: Allow
Priority: 100

Name: allow-quote-update-candidates
Tools: [mcp__crm__update_quote]
Decision: Allow
Priority: 150

Name: deny-large-discounts
Tools: [mcp__crm__update_quote]
Decision: Deny
Conditions: discount_percent greaterThanOrEqual 25
Priority: 300

Name: deny-non-standard-payment-terms
Tools: [mcp__crm__update_quote]
Decision: Deny
Conditions: payment_terms notEquals standard
Priority: 300
```

**Result**

- CRM and pricing lookups run unattended.
- `mcp__crm__update_quote` stays out of `Allowed Tools`, so valid quote changes pause for HITL.
- AGT hard-denies large discounts and non-standard payment terms before they can enter the normal approval queue.

### 7. Supplier master updates and vendor bank-detail changes

Use this when the agent can gather procurement and vendor context automatically, but supplier master data changes must be tightly controlled.

**Node settings**

```text
Enable HITL: On
Approval Scope: All Tools Not Explicitly Allowed
Approval Match Mode: Tool Only (Recommended)
Default on Timeout: Deny
Handle AskUserQuestion: On
Allowed Tools:
  - mcp__erp__get_vendor
  - mcp__erp__get_supplier_change_request
  - mcp__risk__run_sanctions_check
  - mcp__banking__validate_account
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:procurement-master-data
```

**AGT rules**

```text
Name: allow-supplier-lookups
Tools: [mcp__erp__get_vendor, mcp__erp__get_supplier_change_request, mcp__risk__run_sanctions_check, mcp__banking__validate_account]
Decision: Allow
Priority: 100

Name: allow-bank-change-candidates
Tools: [mcp__erp__update_vendor_bank_details]
Decision: Allow
Priority: 150

Name: deny-unapproved-vendors
Tools: [mcp__erp__update_vendor_bank_details]
Decision: Deny
Conditions: vendor_status notEquals approved
Priority: 300

Name: deny-unverified-bank-details
Tools: [mcp__erp__update_vendor_bank_details]
Decision: Deny
Conditions: bank_validation_status notEquals verified
Priority: 300
```

**Result**

- Supplier and bank-validation lookups run unattended.
- Valid bank-detail changes still pause for HITL because the mutating tool is not explicitly allowed.
- AGT blocks changes for unapproved vendors or unverified bank details, which is exactly the kind of high-value master-data guardrail AGT fits well.

### 8. Privacy requests, DSAR exports, and regulated data access

Use this when the agent can gather case context automatically, but subject-data exports must be tightly constrained and reviewed.

**Node settings**

```text
Enable HITL: On
Approval Scope: Specific Tools
Approval Match Mode: Tool Only (Recommended)
Default on Timeout: Deny
Handle AskUserQuestion: On
Allowed Tools:
  - ToolSearch
  - Read
  - Glob
  - Grep
Approval Tool Names or IDs:
  - mcp__privacy__export_subject_bundle
Block Env Files: On

Security Options > AGT Governance > Settings
  Enable: On
  Default Action: Deny
  Conflict Strategy: Deny Overrides
  Agent DID: did:agentmesh:privacy-dsar
```

**AGT rules**

```text
Name: allow-privacy-lookups
Tools: [mcp__privacy__get_request, mcp__privacy__get_identity_check, mcp__privacy__list_subject_records, mcp__docs__get_retention_policy]
Decision: Allow
Priority: 100

Name: allow-export-candidates
Tools: [mcp__privacy__export_subject_bundle]
Decision: Allow
Priority: 150

Name: deny-unverified-requesters
Tools: [mcp__privacy__export_subject_bundle]
Decision: Deny
Conditions: identity_verification_status notEquals verified
Priority: 300

Name: deny-third-party-exports
Tools: [mcp__privacy__export_subject_bundle]
Decision: Deny
Conditions: requester_type notEquals data_subject
Priority: 300
```

**Result**

- Case review and record discovery run unattended.
- AGT blocks unverified requesters and third-party exports before any human review step, which reduces noisy approvals and keeps the queue for legitimate requests.
- Configure the export tool under `Approval Tool Names or IDs` if you want a human gate for legitimate exports.

**Why this shape**

- `Allowed Tools` can include Claude Agent SDK built-ins and direct MCP tools.
- Configure your own MCP server under `MCP Servers`.
- Select MCP tools such as `mcp__privacy__export_subject_bundle` in `Allowed Tools`, `Disallowed Tools`, AGT rules, or HITL approval settings after the server is added.
- For direct MCP servers configured in this node, AGT conditions evaluate top-level tool input fields such as `identity_verification_status` and `requester_type`, not `input.identity_verification_status`.
- The AGT and HITL selectors can discover direct HTTP MCP tools from configured servers. `Allowed Tools` and `Disallowed Tools` can too.

**Current caveat**

- Direct MCP tools can use HITL in this node, but AGT allow rules must stay neutral at the hook layer. An explicit hook `permissionDecision: 'allow'` short-circuits the SDK before `canUseTool` can pause the call.
- Do not trust caller-supplied `identity_verification_status` or `requester_type` for a sensitive export tool. The safer design is for the export tool to look up the request server-side and enforce verification there.

## Tool input field paths

Different tools expose different fields. AGT evaluates against the raw `tool_input` object the SDK passes:

| Tool | Common fields |
|------|---------------|
| `Bash` | `command`, `description` |
| `Read` / `Edit` / `Write` | `file_path`, `content`, `old_string`, `new_string` |
| `WebFetch` | `url`, `prompt` |
| **MCP tools (n8n-bridged)** | Wrapped under `input.<field>` such as `input.amount`, `input.order_id` |
| **Direct MCP tools** | Top-level fields such as `amount`, `order_id` |

**Important**: when an MCP tool is connected via the n8n MCP Client Tool node, its input is wrapped as `{"input": {...}}`. Use `input.amount`, not `amount`.

When in doubt, enable debug logging in the AGT hook or inspect the `[AGT-HOOK-CALL]` log lines and copy the exact field path from there.

## Agent DID

The Agent DID identifies "who" is calling the tool. Think of it as the policy identity key for this agent instance.

AGT uses it for:

- Per-agent rule scoping
- Per-agent rate-limit counters

Leave `Agent DID` blank for the auto-derived DID:

```text
did:n8n:claude-agent-sdk:<workflow-id>:<node-name>:<session-id>
```

That default is **session-scoped**. Each distinct session gets a distinct DID, which is usually what you want for ad hoc runs and one-off investigations.

Set `Agent DID` explicitly when you want a stable, human-meaningful identity instead, for example:

```text
did:agentmesh:order-returns-bot
did:agentmesh:accounts-payable
did:agentmesh:hr-offboarding
```

### What "scoping" means in practice

Changing the `Agent DID` changes the granularity of identity that AGT sees:

- Leave it blank and AGT scopes identity to `workflow + node + session`
- Set a fixed DID and AGT scopes identity to that explicit bot or role name
- Set it with an n8n expression and AGT scopes identity to whatever tenant, region, queue, or business unit your expression resolves to

In the current node implementation, that affects:

- which agent identity is written into the AGT policy document
- which identity is passed into `evaluatePolicy(...)`
- which in-memory rate-limit bucket AGT uses inside that evaluator

### Important limitation

The current node builds the AGT evaluator in-process for each execution. That means DID-scoped rate limits are still **in-memory**, not durable shared quotas across workflow runs or restarts.

So:

- the same explicit DID is useful for **consistent identity and clearer policy ownership**
- the same explicit DID does **not** currently give you a durable shared daily budget across separate n8n runs

If you need durable cross-run tenant quotas, add an external counter or custom Hook Handler.

### Brutal take: what this implementation is

n8n is already orchestration middleware. AGT inside this node is therefore a **policy layer inside middleware**, not the authoritative enforcement boundary.

Treat the current AGT implementation as:

- good for policy authoring, operator UX, same-turn allow/deny/approval decisions, and light guardrails
- not good enough for compliance claims, tenant quotas, abuse prevention, or any control you would need to defend after a restart, retry, or worker hop

In practice:

- AGT here can **shape agent behaviour**
- it does **not** by itself provide a durable cross-run control plane
- hard limits still belong in shared infrastructure such as the MCP/backend service, Redis/Postgres-backed counters, or an API gateway

If a rule matters financially, legally, or operationally, AGT in this node should be treated as a **convenience guardrail**, not the source of truth.

### Prompt sanitisation boundary

This repo does **not** currently provide generic "strip PII before the model sees the prompt" behaviour.

Current controls are narrower:

- secret-value redaction from outputs, stderr, logs, and streaming payloads
- regex-based audit-log redaction
- regex-based content filtering on **tool inputs**

The current `UserPromptSubmit` hook can inject `additionalContext`, but it does **not** rewrite the submitted prompt. So if you need real prompt sanitisation, it must happen:

- before the request reaches the Claude Agent SDK node, or
- inside `executeTask` before `promptForExecution` is passed to the SDK

Using a local model such as Ollama is viable for that sanitisation step, but only as a **pre-model sidecar**. Running a local model as an agent-exposed tool is too late, because the original prompt has already reached the main model.

### Agent DID scoping use cases

#### 1. Default per-session isolation

Leave `Agent DID` blank when each conversation or case should be treated as its own agent identity.

Use this for:

- one-off investigations
- support cases where each session should have its own budget
- compliance evidence collection where runs should not share counters

Effect:

- each session resolves to a DID like `did:n8n:claude-agent-sdk:workflow-a:claude-agent-sdk:session-123`
- one noisy session does not consume the in-memory budget of another session

#### 2. Stable bot identity across multiple entry points

Set a fixed DID when the same logical bot is triggered from different places and you want the policy to read as one named agent.

Example:

```text
Agent DID: did:agentmesh:support-refunds
```

Use this for:

- the same refund bot triggered from email, chat, or queue-driven workflows
- clearer policy review and audit trails
- keeping a consistent business identity even if the workflow or node name changes

Effect:

- all those runs present themselves to AGT as the same named agent
- policy ownership stays readable even if workflow plumbing changes underneath

#### 3. Per-tenant scoping in a shared workflow

Set `Agent DID` with an expression when one workflow serves multiple tenants and each tenant should have isolated policy identity.

Example:

```text
Agent DID: ={{ 'did:agentmesh:tenant:' + $json.tenantId + ':accounts-payable' }}
```

Use this for:

- shared AP or support workflows serving multiple customers
- tenant-specific policy review
- tenant-by-tenant in-memory rate-limit isolation inside a running evaluator

Effect:

- `tenant-a` and `tenant-b` do not look like the same agent to AGT
- logs and policy reasoning stay attributable to the correct tenant identity

#### 4. Per-role scoping inside the same business domain

Use different DIDs for different operational roles, even if they call similar MCP tools.

Examples:

```text
Agent DID: did:agentmesh:support-readonly
Agent DID: did:agentmesh:support-refunds
Agent DID: did:agentmesh:support-escalations
```

Use this for:

- separating read-only support agents from refund-capable agents
- distinguishing triage bots from execution bots
- making policy reviews easier because each role has its own named identity

Effect:

- each role has a clear policy boundary
- it is easier to reason about which workflow owns which privileges

#### 5. Environment scoping

Set different DIDs for staging and production so they do not look like the same operational agent.

Example:

```text
Agent DID: ={{ 'did:agentmesh:' + $json.environment + ':incident-triage' }}
```

Or, if you set it manually:

```text
did:agentmesh:staging:incident-triage
did:agentmesh:prod:incident-triage
```

Use this for:

- keeping staging actions obviously separate from production actions
- avoiding confusing audit trails where test traffic looks like live traffic
- clearer policy intent when you review configs later

## Conflict strategies

When multiple rules match, the strategy decides which wins:

| Strategy | Behaviour | When to use |
|---|---|---|
| **Priority First Match** | Highest-priority matching rule wins | Rule order matters; explicit precedence |
| **Deny Overrides** | Any matching deny wins | Strictest and safest for production |
| **Allow Overrides** | Any matching allow wins | Permissive; useful for layered allow lists |
| **Most Specific Wins** | Rule with the tightest condition wins | Rare; complex policies |

For most enterprise agents, **Deny Overrides** is the safest choice. `Priority First Match` is fine when you tightly control rule order.

## Configuring AGT in the node

1. Open your **Claude Agent SDK** node.
2. Confirm the top-level settings:
   - `Permission Mode`
   - `Allowed Tools`
   - `Disallowed Tools`
   - `Enable HITL` and `Approval Scope` if you need approvals
   - `Block Env Files`
3. Open **Security Options**.
4. Add **AGT Governance**.
5. In **Settings**, configure:
   - `Enable`
   - `Default Action`
   - `Conflict Strategy`
   - `Agent DID`
6. Add one or more rows under `Rules`.
7. For each rule, fill in:
   - `Name`
   - `Tools`
   - `Decision`
   - `Conditions`
   - `Priority`
   - `Rate Limit`
   - `Approvers` if you want documentation on who would approve it

## Require Approval and HITL

`Decision = Require Approval` in AGT is **not** a full HITL bridge. The current hook contract is synchronous allow/deny only, so AGT returns a deny with a clear "manual approval is required" style message.

For real pause-and-resume approval flows:

- Turn `Enable HITL` on.
- Pick `Approval Scope`.
- Keep high-risk tools out of `Allowed Tools` if you use `All Tools Not Explicitly Allowed`.
- Use AGT to hard-deny invalid cases and to rate-limit valid ones.

That split is intentional:

- **AGT** decides whether a call is ever allowed.
- **HITL** decides whether an allowed tool should pause for a human.

## Troubleshooting

### Rule not firing

1. **Tool name mismatch**. Check the actual tool name in logs. MCP tools are wrapped names such as `mcp__server__tool`.
2. **Input field path mismatch**. Direct MCP servers configured in this node use top-level fields like `amount`. n8n MCP bridge tools use `input.amount`.
3. **Operator unsupported**. `contains`, `startsWith`, and `endsWith` do not compile.
4. **leftValue dropped by the UI**. Re-open the rule and confirm the filter still contains the field path.
5. **Rule disabled**. Confirm `Enable` is on under AGT settings.

### `AGT filter condition has an unsupported left-value format: undefined`

The rule was saved without a usable `leftValue`. Either:

- Re-add the condition in the UI, or
- Remove the condition entirely so the rule matches purely on `Tools`

### Rate limit not resetting

Rate limit state is **in-memory**. It resets when:

- The n8n process restarts, or
- The AGT evaluator is rebuilt for a new session

For durable cross-run budgets, extend the evaluator with persistent counters. That is not implemented in this node today.

### Conditional approval is not happening

That is expected. AGT cannot currently turn a matched condition into a node HITL pause. Use one of these patterns instead:

- Keep the tool out of `Allowed Tools` so every call goes through HITL, or
- Use a Hook Handler or custom workflow logic for input-aware approval routing

## Security model

- **AGT runs in-process** in the n8n task runner. It does not call an external policy service.
- **AGT decisions are deterministic**. The agent cannot talk its way past a deny.
- **AGT runs before user hook handlers**. AGT denials short-circuit webhook and command hook handlers instead of notifying them after the call was already blocked.
- **AGT does not replace** Path Sandboxing, Content Filtering, Block Env Files, Tool Permissions, or HITL. Use them together for defence in depth.
- **Default deny is the safest baseline**. Start from `Default Action = Deny` and add explicit allow rules.

## Limits and known gaps

- No string method support such as `.startsWith()`, `.includes()`, or `.endsWith()`
- No regex support
- Rate-limit state is in-memory
- `Decision = Require Approval` is an effective deny, not a real pause
- AGT audit chain is not yet wired into this node
