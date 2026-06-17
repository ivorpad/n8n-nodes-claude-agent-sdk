---
name: canonical-types
description: >
  Enforce canonical types from @anthropic-ai/claude-agent-sdk and n8n-workflow
  instead of creating custom shadow types. Use when writing new TypeScript code,
  reviewing types, debugging type mismatches, fixing stale/missing fields on
  project types, or refactoring type imports. Triggers on "type", "types",
  "canonical", "SDK type", "import type", "type mismatch", "missing field",
  "shadow type", "duplicate type", or when creating/editing files in
  nodes/ClaudeAgentSdk/ that define or import interfaces.
---

# Canonical Types

## Core Rule

**Never define a project type that shadows an SDK or n8n-workflow export.**
The two canonical sources of truth are:

1. `@anthropic-ai/claude-agent-sdk` — SDK messages, hooks, MCP configs, permissions, thinking, sandbox, model usage
2. `n8n-workflow` — node execution, properties, data objects, errors, connections

If a type exists in either package, import it directly. If the project needs a
subset or extension, use `Pick`, `Omit`, `Partial`, or intersection (`&`) on the
canonical type — never re-declare the fields manually.

## Import Patterns

### SDK types — use the centralized adapter

All SDK types flow through `nodes/ClaudeAgentSdk/sdk/types.ts`:

```typescript
// Good — derive from upstream namespace
import type * as UpstreamClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk';
export type UpstreamSdkModule = typeof UpstreamClaudeAgentSdk;
export type UpstreamQueryOptions = NonNullable<Parameters<UpstreamSdkModule['query']>[0]['options']>;
```

For consuming files, import from the adapter or directly from the SDK:

```typescript
// Good — import canonical type
import type { SDKMessage, PreToolUseHookInput, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

// Bad — loose re-declaration missing 30+ union members
export interface SDKMessage { type: string; [key: string]: unknown }
```

### Project canon (already established — reuse, don't reinvent)

- `NodeQueryOptions` (`sdk/types.ts`) — upstream `Options` + `ManagedQueryExtras`
  + `UpstreamUntypedOptions`. EVERY queryOptions bag uses this; never
  `Record<string, unknown>`.
- `NodeStreamMessage` (`sdk/types.ts`) — `SDKMessage` | the documented managed
  extension messages (`ManagedArtifactMessage`, `ManagedSessionFilesMessage`).
- `ManagedSdkMessage<M>` (`managedAgent/types.ts`) — canonical message + `_raw`.
- `isKnownNodeMessage` (`sdk/messageGuards.ts`) — allowlist guard
  compile-checked against `NodeStreamMessage['type']`.
- `SdkHooks` (`sdk/types.ts`) — `Options['hooks']`; hook producers return this.
- Runtime-valid keys missing from upstream d.ts go in `UpstreamUntypedOptions`
  with a comment citing the sdk.mjs evidence (current sole entry:
  `resumeSessionAt`). Beta strings the `SdkBeta` union lags get one sanctioned
  cast at the write site (`FAST_MODE_BETA`).

### n8n types — import directly

```typescript
// Good
import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
```

## When a Project-Specific Type is Justified

Create a project type only when it has **no canonical equivalent**:

- **UI shape types** (`SubagentUI`, `McpServerUI`, `AdditionalOptions`)
- **n8n integration types** (`N8nMcpToolName`, `N8nMcpSettings`, `N8nMcpEvent`)
- **Session memory** (`ISessionMemory`, `ISessionMemoryMetadata`)
- **Streaming protocol** (`StreamingConfig`, `StreamContentType`, `ApprovalChunkV1*`)
- **Observability** (`InvocationObservability*`)
- **Permissions module** (`PathSandboxConfig`, `ContentFilterConfig`, `ToolPermissionsConfig`)

## Validation Checklist

Before defining or modifying a type:

1. Does the SDK export it? Check [type-map.md](references/type-map.md)
2. Does n8n-workflow export it? Check `n8n-workflow/dist/esm/interfaces.d.ts`
3. Is the project type a strict subset? → `Pick<CanonicalType, 'field1' | 'field2'>`
4. Is it missing fields? → Update or replace with SDK import
5. Is it a superset? → `CanonicalType & { extraField: string }`

See [validation-patterns.md](references/validation-patterns.md) for fix recipes and decision tree.

## Known Drift Issues

All drift items from the 2026-06-11 audit were fixed (typed NodeQueryOptions
hub, canonical managed eventMapper, canonical CanUseTool/PermissionResult/
hooks, SandboxSettings-derived sandbox types, ModelUsage, ChunkType linkage,
complement-hide credential rules for n8n-workflow >= 2.14). Counts to know:
`SDKMessage` is a **33-member** union, `HookEvent` has **30** events
(SDK 0.3.170). See [type-map.md](references/type-map.md) for the mapping.

### Deliberate deferrals (do not "fix" casually)

- `ApplicationError` → `UserError`/`OperationalError` migration (71 calls) —
  deprecation only; planned as its own PR.
- Hook-handler UI exposes 7 of 30 HookEvents — intentional subset.
- `thinking_delta` streaming (streamEvents.ts drops thinking deltas) — feature
  work, not drift.
- `__tests__` are excluded from tsc; enabling test typecheck is a follow-up
  (tsconfig.tests.json).
- `sandbox.ignoreViolations` key vocabulary (`file`/`network`) is undocumented
  upstream — needs a runtime smoke test before trusting it.

## Debugging Type Mismatches

When a runtime value doesn't match the project type:

1. Check the SDK type — it may have new fields the project type doesn't declare
2. Use [type-map.md](references/type-map.md) to find the canonical source
3. Apply the fix pattern from [validation-patterns.md](references/validation-patterns.md)
