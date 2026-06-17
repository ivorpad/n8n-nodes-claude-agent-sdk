# Claude Managed Agents n8n Parity Matrix and Build Prompt

Last updated: 2026-06-12.

This document supersedes the earlier executor-only interpretation of Managed
Agents in this repo. The product intent is now: n8n should not only select and
run a pre-created Managed Agent. It should help users inspect, edit, version,
and safely operate Managed Agents from n8n, because sending users back to the
Anthropic Console for every edit is too tedious and hides the agent lifecycle
from the workflow author.

The phrase "Future Privacy" from the product note is treated here as likely
"feature parity". If it means privacy/data governance instead, the highest-risk
surfaces are Files API uploads/resources, GitHub repository resources, vaults,
memory stores, raw event logs, and generated file downloads.

## Official Markdown Corpus

Fetched from `platform.claude.com` on 2026-06-12. Smoke fetch of
`https://platform.claude.com/docs/en/managed-agents/overview.md` returned HTTP
200 with `text/markdown`. The complete fetched corpus was stored locally at
`/tmp/n8n-managed-agents-docs/` during this analysis.

- https://platform.claude.com/docs/en/managed-agents/overview.md
- https://platform.claude.com/docs/en/managed-agents/quickstart.md
- https://platform.claude.com/docs/en/managed-agents/onboarding.md
- https://platform.claude.com/docs/en/managed-agents/agent-setup.md
- https://platform.claude.com/docs/en/managed-agents/tools.md
- https://platform.claude.com/docs/en/managed-agents/mcp-connector.md
- https://platform.claude.com/docs/en/managed-agents/permission-policies.md
- https://platform.claude.com/docs/en/managed-agents/skills.md
- https://platform.claude.com/docs/en/managed-agents/memory.md
- https://platform.claude.com/docs/en/managed-agents/environments.md
- https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference.md
- https://platform.claude.com/docs/en/managed-agents/cloud-containers.md
- https://platform.claude.com/docs/en/managed-agents/sessions.md
- https://platform.claude.com/docs/en/managed-agents/session-operations.md
- https://platform.claude.com/docs/en/managed-agents/events-and-streaming.md
- https://platform.claude.com/docs/en/managed-agents/webhooks.md
- https://platform.claude.com/docs/en/managed-agents/define-outcomes.md
- https://platform.claude.com/docs/en/managed-agents/vaults.md
- https://platform.claude.com/docs/en/managed-agents/github.md
- https://platform.claude.com/docs/en/managed-agents/files.md
- https://platform.claude.com/docs/en/managed-agents/multi-agent.md
- https://platform.claude.com/docs/en/managed-agents/scheduled-deployments.md
- https://platform.claude.com/docs/en/managed-agents/observability.md
- https://platform.claude.com/docs/en/managed-agents/reference.md
- https://platform.claude.com/docs/en/build-with-claude/files.md
- https://platform.claude.com/docs/en/build-with-claude/pdf-support.md
- https://platform.claude.com/docs/en/build-with-claude/vision.md
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise.md
- https://platform.claude.com/docs/en/agents-and-tools/remote-mcp-servers.md
- https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws.md

Notes:

- `cloud-sandboxes-reference.md` and `cloud-containers.md` were byte-identical.
- `observability.md` and `events-and-streaming.md` were byte-identical.
- Environment docs show create/list/retrieve/archive/delete. No environment
  update/version endpoint was found in the fetched environment page.

## Product Intent

The current n8n surface is too basic for the desired feature:

- Today: choose `backendMode=managedAgent`, select an existing agent and
  environment, run a task, stream events, support a narrow custom-tool question
  HITL path, persist the `chatSessionId -> managedAgentSessionId` mapping, and
  download generated output files.
- Desired: n8n should let a workflow author view and edit Managed Agent
  definitions, create new versions safely, compare/list versions, choose latest
  or pinned versions for sessions, configure Managed Agent-specific resources,
  and handle all blocking managed events without confusing them with local CLI
  behavior.

The core gap is not execution. The core gap is authoring and lifecycle parity.

## Current Code Extraction

Relevant implementation found in this repo:

- `nodes/ClaudeAgentSdk/nodeProperties/executeTask.ts`: exposes
  `backendMode=localCli|managedAgent` and hides many local-only properties in
  managed mode.
- `nodes/ClaudeAgentSdk/nodeProperties/managedAgent.ts`: exposes only
  `managedAgentId` and `managedEnvironmentId`. Descriptions tell users to
  create/configure resources in the Anthropic Console.
- `nodes/ClaudeAgentSdk/managedAgent/loadOptions.ts`: lists unarchived agents
  with `client.beta.agents.list({ include_archived: false })`; lists
  environments with `client.beta.environments.list()` and filters archived
  environments client-side; prepends stale warnings for stored IDs that no
  longer list.
- `nodes/ClaudeAgentSdk/node/execute.ts`: for managed mode, requires an
  Anthropic API key, `managedAgentId`, and `managedEnvironmentId`, then creates
  `new ManagedAgentAdapter({ apiKey, agentId, environmentId })`.
- `nodes/ClaudeAgentSdk/managedAgent/types.ts`: `ManagedAgentConfig` has
  `apiKey`, `agentId`, `environmentId`, `resumeSessionId`, and
  `resumeWithToolResult`. It has no agent patch payload, agent version pin,
  `vaultIds`, `resources`, memory store IDs, GitHub repositories, file uploads,
  outcome mode, webhooks, or deployment config.
- `nodes/ClaudeAgentSdk/managedAgent/adapter.ts`: creates a session with only
  `{ agent, environment_id }`, opens stream before sending `user.message`, sends
  `user.custom_tool_result` for question resume, sends `user.interrupt` for
  active managed interruption, and downloads session files after idle.
- `nodes/ClaudeAgentSdk/managedAgent/eventMapper.ts`: maps core
  `agent.message`, tool use/result, model usage, idle/error/terminated events
  to SDK-compatible messages; drops or does not surface thread/outcome/system
  events as first-class n8n outputs.
- `nodes/ClaudeAgentSdk/managedAgent/hitlBridge.ts`: bridges only a
  question-shaped `agent.custom_tool_use` ending in `requires_action` to the
  shared HITL question flow. This is not the same as permission confirmation.
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/sessionResolve.ts`: reads
  `managedAgentSessionId` from session-memory metadata for resume and wires
  managed question answers into `user.custom_tool_result`.
- `nodes/ClaudeAgentSdk/operations/executeTask/steps/sessionPersistence.ts`:
  persists the Anthropic `sesn_...` under `managedAgentSessionId` and binds
  generated file artifacts to n8n binary output.
- Simple, Redis, and Postgres memory nodes support managed metadata; only
  Postgres implements execution locks for multi-worker safety.

## Feature Map

| Area | Official doc feature | API primitive/event/resource | Current n8n status | Required parity work |
|---|---|---|---|---|
| Backend | Managed Agents execution backend | Agents, environments, sessions, event stream | Supported | Keep backend branch isolated from local CLI behavior. |
| Onboarding | API key/workspace access | Workspace key with Managed Agents access | Partial | Improve errors and docs; n8n cannot grant access. |
| Agent selection | List active agents | `client.beta.agents.list` | Supported | Keep stale ID warning. Add tests around archived/stale entries if touched. |
| Environment selection | List active environments | `client.beta.environments.list` | Supported | Keep archived filtering. |
| Agent create | Define a new agent | `client.beta.agents.create` | Missing, now required | Add managed agent authoring operation with typed fields and output `agent.id/version`. |
| Agent update | Edit an agent | `client.beta.agents.update(agent.id, { version, ...patch })` | Missing, now required | Retrieve current config/version, build patch, require optimistic `version`, output new version. |
| Agent versions | List/review versions | `client.beta.agents.versions.list(agent.id)` | Missing, now required | Add version list/inspect operation and make session run support latest vs pinned version. |
| Agent archive | Archive agent | `client.beta.agents.archive` | Missing | Add only as explicit destructive admin operation, not in normal execute path. |
| Agent fields | `name`, `model`, `system`, `tools`, `mcp_servers`, `skills`, `multiagent`, `description`, `metadata` | Agent config object | Missing editor | Build a structured editor with JSON fallback for complex fields. |
| Models/system prompt | Agent-owned model/system | Agent fields | Runtime uses selected agent | Editing must change agent version, not override local CLI model/system controls. |
| Built-in tools | Agent toolset | `agent_toolset_20260401`, tool configs | Execution events partially mapped | Expose built-in toolset config in agent editor. |
| Custom tools | Custom tool declarations | `tools: [{ type: "custom" }]`, `agent.custom_tool_use` | Partial question-only bridge | Add generic custom-tool contract or explicitly document question-only. |
| Permission policies | `allow`, `deny`, `always_ask` | Tool/MCP `permission_policy` | Missing editor/runtime approval | Add policy editor and distinct approval flow. |
| Tool confirmation | Approve/deny blocking managed tool calls | `user.tool_confirmation` | Missing | Implement separately from `user.custom_tool_result`; support allow/deny/deny_message. |
| MCP servers | Agent-scoped remote MCP | `mcp_servers`, `mcp_toolset` | Runtime can use preconfigured agents only | Add editor support for MCP server config; keep local MCP controls gated. |
| Vaults at session create | Attach MCP credentials | `sessions.create({ vault_ids })` | Missing | Add managed run option for existing vault IDs; redact logs. |
| Vault CRUD | Create/update/validate vault credentials | `vaults`, `vaults.credentials`, validation | Missing | Decide whether n8n manages vaults or only references them; credential secrets are high risk. |
| Skills | Attach agent skills | Agent `skills[]` | Missing editor | Add skill attachment fields; optionally separate skill authoring/import from agent editor. |
| Skill authoring docs | Skill structure/best practices/enterprise | Filesystem SKILL.md, scripts, resources | Not implemented | Useful if n8n should generate/upload skill bundles; otherwise out of scope. |
| Environments | Create cloud environment | `client.beta.environments.create` | Missing | Add admin operation for create; include packages/networking fields. |
| Environment lifecycle | list/retrieve/archive/delete | `environments.list/retrieve/archive/delete` | List only | Add retrieve/archive/delete admin operations; no update endpoint found. |
| Cloud containers alias | Sandbox/container reference | Environment runtime | Selection only | Document same behavior under current docs naming. |
| Sessions | Create session with latest agent | `sessions.create({ agent: agentId, environment_id })` | Supported | Keep stream-before-send behavior. |
| Pinned agent version | Start session with a specific agent version | `sessions.create({ agent: { id, version } })` | Missing | Add latest vs pinned selector; essential for safe edited rollouts. |
| Session vault auth | Attach vault IDs | `vault_ids` | Missing | Add to create payload when configured. |
| Session resources | Attach files, repos, memory stores | `resources[]` | Missing | Add typed managed resources schema. |
| Session resume | Send next message to idle session | `user.message` on existing `sesn_...` | Supported | Preserve deterministic `chatSessionId` mapping. |
| Session update | Modify session agent config while idle | `sessions.update` | Missing | Add explicit operation; do not hide inside normal execute. |
| Session inspect/list | Retrieve and list sessions | `sessions.retrieve/list` | Missing | Add admin operations for debugging and workflow branching. |
| Session archive/delete | Archive/delete sessions | `sessions.archive/delete` | Missing | Add destructive operations with clear confirmations. |
| Event stream | Open stream before send | `sessions.events.stream`, `sessions.events.send` | Supported | Preserve ordering in tests. |
| Event history | List/filter historical events | `sessions.events.list` | Missing | Add debug/observability operation with redaction and size limits. |
| User interrupt | Interrupt active session | `user.interrupt` | Supported in current dirty worktree | Keep no-op before active session and duplicate suppression. |
| System messages | Send system message events | `system.message` | Missing | Add run/session operation if needed; ensure it is not confused with agent `system` field. |
| Custom tool result | Return custom tool output | `user.custom_tool_result` | Partial | Current path answers question-shaped tool calls only; generic tools need execution routing. |
| HITL wait semantics | Wait before resume links are acted on | n8n wait/resume flow | Supported via shared flow | Keep Managed Agent preview non-authoritative for resume timing. |
| Webhooks | Anthropic Managed Agents webhooks | `client.beta.webhooks.unwrap`, Console endpoint config | Missing | Build separate trigger/resource; do not conflate with n8n HITL webhooks. |
| Files upload | Upload files to Anthropic Files API | `client.beta.files.upload` | Missing | Add binary/local input upload path for managed mode with privacy warnings. |
| File resources | Mount uploaded files | `resources: [{ type: "file" }]` | Missing input side | Add path/resource validation and session create payload tests. |
| Running session resources | Add/list/delete resources | `sessions.resources.add/list/delete` | Missing | Add resource operations; memory stores cannot be added after session create. |
| Generated files | List/download session output files | `files.list({ scope_id })`, `files.download` | Supported | Keep combined beta headers and async polling. |
| GitHub resources | Mount repositories | `resources: [{ type: "github_repository" }]` | Missing | Add secure token handling; tokens are not echoed by API. |
| GitHub resource update | Rotate auth token | `sessions.resources.update` | Missing | Add separate resource update operation; changing repos requires new session per docs. |
| Memory stores | Create/manage memory stores | `memoryStores.create/list/archive/delete/update` | Missing | Keep distinct from n8n session memory. |
| Memories | List/read/create/update/delete memories | `memoryStores.memories.*` | Missing | Add memory admin operations only if n8n owns memory editing. |
| Memory versions | Audit/redact memory versions | `memoryStores.memoryVersions.*` | Missing | Add audit/redaction operation if privacy/governance is intended. |
| Attach memory | Session resource at create time | `resources: [{ type: "memory_store" }]` | Missing | Add create-session resource support; cannot add/remove while running. |
| Define outcomes | Outcome-driven session | `user.define_outcome` | Missing | Research-preview mode; add only behind explicit operation flag. |
| Outcome events | Evaluation spans/results | `span.outcome_evaluation_*` | Missing | Extend event mapper/output when outcome mode is supported. |
| Multiagent config | Coordinator/callable agents | Agent `multiagent` config | Missing editor | Include in agent version editor, likely JSON-first. |
| Threads | List/archive/stream/list thread events | `sessions.threads.*` | Missing | Add observability/thread operations if multiagent parity is required. |
| Thread blocking actions | Tool confirmation/custom result routed to thread | `user.tool_confirmation`, `user.custom_tool_result` plus event IDs | Partial | Ensure replies preserve event IDs; test thread-scoped requires_action. |
| Scheduled deployments | Create/pause/unpause/archive/run | `deployments.*` | Missing | Probably separate admin node/operation; n8n schedules may cover a different use case. |
| Deployment runs | Inspect run history/failures | `deployment_runs` | Missing | Add only if Anthropic-hosted schedules are a product surface. |
| Observability | Usage, raw events, Console observability | `span.model_request_end`, raw events | Partial | Usage aggregated; raw event history operation missing. |
| Reference/rate limits | Event list, limits, branding | Reference doc | Partial | Add clear errors/retry boundaries; do not bake stale limit values into code. |
| AWS platform | Claude Platform on AWS | Different base URL/auth/workspace header, 6h reauth caveat | Missing | Treat as separate provider mode, not a flag on existing Anthropic key path. |
| Adjacent file docs | Generic Files/PDF/Vision inputs | Files API and message content | Missing for managed input files | Use Files API/resource mounting rather than local `_inputs` semantics. |

## Recommended n8n Surface

Add managed-resource operations instead of overloading `executeTask`:

1. `Run Managed Agent`
   - Current behavior, plus latest vs pinned version, `vault_ids`, and typed
     resources for files, GitHub repositories, and memory stores.
2. `Create Managed Agent`
   - `name`, `model`, `system`, `description`, `metadata`, tools, MCP servers,
     permission policies, skills, and multiagent config.
3. `Inspect Managed Agent`
   - Retrieve current config and active version; include raw JSON.
4. `Update Managed Agent`
   - Retrieve current version, accept structured patch, require expected
     version, call `agents.update`, output new version and diff summary.
5. `List Agent Versions`
   - Support workflow branching and pinned-session configuration.
6. `Archive Managed Agent`
   - Destructive admin operation with explicit confirmation.
7. `Manage Environment`
   - Create/list/retrieve/archive/delete. Do not promise update unless the API
     adds it.
8. `Manage Session`
   - Retrieve/list/update/archive/delete, list events, list/add/delete/update
     resources where the docs allow it.
9. `Managed Agent Webhook Trigger`
   - Separate trigger for Anthropic webhooks with signature verification.

The editor should default to structured fields for common config and keep an
advanced raw JSON override for fields that evolve quickly, especially tools,
MCP servers, skills, and multiagent config. Every raw JSON surface must be
runtime-validated as `unknown` and narrowed; do not introduce `any`.

## Implementation Constraints

- Follow `AGENTS.md`: no dynamic inline imports; static imports by default.
- Preserve local CLI behavior. Managed-only controls must be hidden in local
  mode, and local-only controls must not leak into managed mode.
- Keep `chatSessionId` as the deterministic n8n session key. Store Anthropic
  `sesn_...` only in metadata as `managedAgentSessionId`.
- Do not conflate n8n session memory with Anthropic memory stores.
- Do not send `user.tool_confirmation` through the `user.custom_tool_result`
  path. They are different wire events.
- Do not put archive/delete/update operations inside the normal task execution
  path.
- For secrets and resource tokens, never echo values in node output, errors,
  logs, or tests.
- For Postgres changes, verify schema first and use existing helpers.

## Builder Goal Prompt

Use this prompt to hand the work to an implementation agent:

```text
/goal Build Managed Agents feature parity for the n8n Claude Agent SDK node, with the first product outcome being that users can inspect, edit, version, and run Anthropic Managed Agents from n8n without going back to the Anthropic Console for normal edits.

Context:
- Repo: this repository checkout.
- Read AGENTS.md and docs/CURRENT-STATE.md first.
- Read docs/analysis/managed-agents-parity-matrix.md fully. It is the current product brief and doc-to-code map.
- Fetch or use the official markdown docs listed in that file. Do not rely on stale mirrors when API behavior is uncertain.
- User intent: the current Managed Agent surface is too basic. Today the node selects an existing agent/environment and runs it. The desired feature is an n8n-native Managed Agent editor/lifecycle surface with safe versioning.
- Treat "Future Privacy" as "feature parity" unless the user clarifies privacy/data governance. If privacy is intended, prioritize Files API uploads/resources, vaults, memory stores, GitHub resources, raw events, and generated files as data-handling surfaces.

Hard constraints:
- Follow AGENTS.md invariants. No dynamic inline imports.
- Use static imports unless an existing loader module is explicitly allowed.
- Preserve existing local CLI behavior and all deterministic session rules.
- Keep chatSessionId as the deterministic n8n key; Anthropic sesn_* IDs live only in managedAgentSessionId metadata.
- Do not conflate Anthropic memory stores with this repo's Simple/Redis/Postgres n8n session memory.
- Do not implement user.tool_confirmation by reusing user.custom_tool_result. Add a distinct approval path.
- Do not hide destructive archive/delete/session-update operations inside executeTask.
- Never echo secrets. Redact vault IDs, authorization tokens, and file/resource credentials where appropriate.

Required discovery before code:
1. Split the official docs into subagent/doc clusters and extract every Managed Agents API feature:
   - Agent authoring/versioning: agent-setup, tools, mcp-connector, permission-policies, skills, multi-agent.
   - Runtime/session: sessions, session-operations, events-and-streaming, observability, reference.
   - Resources/data: files, github, memory, vaults, build-with-claude files/pdf/vision.
   - Environment/deployment: environments, cloud containers/sandboxes, scheduled-deployments.
   - Integrations/platform: webhooks, Claude Platform on AWS, remote MCP servers, agent-skills docs.
2. For each cluster, produce:
   - API primitive names and request fields.
   - Events emitted and events the client must send.
   - Which parts are current n8n-supported, partial, missing, or intentionally separate.
   - Required tests and product risks.
3. Compare findings against the actual code, especially:
   - nodes/ClaudeAgentSdk/nodeProperties/managedAgent.ts
   - nodes/ClaudeAgentSdk/managedAgent/loadOptions.ts
   - nodes/ClaudeAgentSdk/node/execute.ts
   - nodes/ClaudeAgentSdk/managedAgent/adapter.ts
   - nodes/ClaudeAgentSdk/managedAgent/eventMapper.ts
   - nodes/ClaudeAgentSdk/managedAgent/hitlBridge.ts
   - nodes/ClaudeAgentSdk/operations/executeTask/steps/sessionResolve.ts
   - nodes/ClaudeAgentSdk/operations/executeTask/steps/sessionPersistence.ts
   - memory nodes under nodes/memory/

Implementation target:
1. Add a managed resource/lifecycle surface, not just more executeTask fields.
2. Implement at least these P0/P1 capabilities:
   - Create Managed Agent.
   - Inspect Managed Agent.
   - Update Managed Agent with optimistic version checking.
   - List Agent Versions.
   - Run session using latest or pinned agent version.
   - Add session create options for vault_ids and typed resources where safe.
   - Keep generated file output working.
   - Add distinct user.tool_confirmation support for managed permission pauses.
3. Add P2 operations if scope permits:
   - Environment create/retrieve/archive/delete.
   - Session retrieve/list/update/archive/delete.
   - Session event history/list with redaction limits.
   - File upload and file resource mounting.
   - GitHub repository resources.
   - Memory store resource attachment.
4. Treat these as separate/admin or later work unless explicitly prioritized:
   - Vault credential CRUD/rotation.
   - Memory CRUD/version/redaction.
   - Anthropic webhook trigger.
   - Define outcomes.
   - Multiagent thread event UI.
   - Scheduled deployments.
   - Claude Platform on AWS provider mode.

Acceptance criteria:
- The node no longer tells users that all agent authoring must happen in the Anthropic Console when the API supports create/update/versioning.
- A user can make a safe Managed Agent edit from n8n, receive the new agent version, list versions, and choose latest or a pinned version for execution.
- Managed Agent execution still passes existing tests for stream order, HITL wait/resume, session memory mapping, generated files, and interrupt.
- Tool confirmation pauses use user.tool_confirmation and are tested separately from custom-tool question HITL.
- Managed session create payload tests cover latest agent, pinned version, vault_ids, and resources.
- Documentation is updated in docs/CURRENT-STATE.md and relevant managed-agent guide docs.
- Typecheck/lint/relevant Vitest tests pass, or failures are documented with exact commands and reasons.

Do not stop at a proposal. Implement the highest-priority parity slice end to end, verify it, and leave a concise summary of remaining parity gaps.
```
