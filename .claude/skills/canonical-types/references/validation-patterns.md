# Validation Patterns

Fix patterns for replacing shadow types with canonical imports.

## Table of Contents

- [Pattern 1: Direct Replacement](#pattern-1-direct-replacement)
- [Pattern 2: Subset via Pick](#pattern-2-subset-via-pick)
- [Pattern 3: Weakened Fields via Partial](#pattern-3-weakened-fields-via-partial)
- [Pattern 4: Extension via Intersection](#pattern-4-extension-via-intersection)
- [Pattern 5: Type Alias](#pattern-5-type-alias)
- [Pattern 6: Centralized Re-export](#pattern-6-centralized-re-export)
- [Specific Fix Recipes](#specific-fix-recipes)
- [Grep Commands for Auditing](#grep-commands-for-auditing)

---

## Pattern 1: Direct Replacement

When the project type is structurally identical to the SDK type.

```typescript
// Before — shadow type
export interface McpStdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// After — canonical import
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
export type { McpStdioServerConfig };
```

## Pattern 2: Subset via Pick

When the project only uses some fields from a richer SDK type.

```typescript
// Before — manually re-declared subset
export interface McpServerStatus {
  name: string;
  status: string;
}

// After — derived from canonical type
import type { McpServerStatus as SDKMcpServerStatus } from '@anthropic-ai/claude-agent-sdk';
export type McpServerStatus = Pick<SDKMcpServerStatus, 'name' | 'status'>;
```

## Pattern 3: Weakened Fields via Partial

When the project makes some required SDK fields optional.

```typescript
// Before — manually weakened
export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  costUSD?: number;        // required in SDK
  contextWindow?: number;  // required in SDK
}

// After — Partial on specific fields
import type { ModelUsage } from '@anthropic-ai/claude-agent-sdk';
export type ModelUsageEntry = Omit<ModelUsage, 'costUSD' | 'contextWindow' | 'maxOutputTokens'>
  & Partial<Pick<ModelUsage, 'costUSD' | 'contextWindow' | 'maxOutputTokens'>>;
```

## Pattern 4: Extension via Intersection

When the project adds fields not in the SDK type.

```typescript
// Before — full re-declaration
export interface McpSdkServerConfig {
  type: 'sdk';
  name: string;
  instance: unknown;  // SDK uses McpServer, project needs unknown
}

// After — extend canonical
import type { McpSdkServerConfig as SDKMcpSdkServerConfig } from '@anthropic-ai/claude-agent-sdk';
export type McpSdkServerConfig = Omit<SDKMcpSdkServerConfig, 'instance'> & { instance: unknown };
```

## Pattern 5: Type Alias

When the project type is identical but has a different name.

```typescript
// Before
export type ThinkingOption =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

// After
import type { ThinkingConfig } from '@anthropic-ai/claude-agent-sdk';
export type ThinkingOption = ThinkingConfig;
```

## Pattern 6: Centralized Re-export

For types used across many files, re-export from a single location.

```typescript
// sdk/types.ts — the canonical re-export hub
import type * as UpstreamClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk';

// Re-export SDK types the project needs
export type {
  SDKMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKResultMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  PreToolUseHookInput,
  PostToolUseHookInput,
  UserPromptSubmitHookInput,
  HookCallbackMatcher,
  HookJSONOutput,
  McpServerConfig,
  McpStdioServerConfig,
  McpServerStatus,
  ThinkingConfig,
  ModelUsage,
  PermissionResult,
  PermissionMode,
  AgentDefinition,
} from '@anthropic-ai/claude-agent-sdk';
```

---

## Specific Fix Recipes

### Fix: `streaming/types.ts` SDKMessage

```typescript
// Remove:
export interface SDKMessage {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

// Replace with:
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
export type { SDKMessage };

// Downstream: use discriminated union narrowing
function handleMessage(msg: SDKMessage) {
  switch (msg.type) {
    case 'assistant': /* msg is SDKAssistantMessage */ break;
    case 'result': /* msg is SDKResultMessage */ break;
    case 'stream_event': /* msg is SDKPartialAssistantMessage */ break;
    // ...
  }
}
```

### Fix: `types.ts` AgentDefinition

```typescript
// Remove:
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku';
}

// Replace with:
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
export type { AgentDefinition };
```

### Fix: `permissions/types.ts` Hook Inputs

```typescript
// Remove all local BaseHookInput, PreToolUseHookInput, PostToolUseHookInput,
// UserPromptSubmitHookInput declarations.

// Replace with:
import type {
  BaseHookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  UserPromptSubmitHookInput,
} from '@anthropic-ai/claude-agent-sdk';

export type { BaseHookInput, PreToolUseHookInput, PostToolUseHookInput, UserPromptSubmitHookInput };
```

### Fix: `types.ts` ThinkingOption

```typescript
// Remove:
export type ThinkingOption =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

// Replace:
import type { ThinkingConfig } from '@anthropic-ai/claude-agent-sdk';
export type ThinkingOption = ThinkingConfig;
```

---

## Grep Commands for Auditing

Find shadow types in the project:

```bash
# Find all interface/type declarations in project types files
rg "^export (interface|type)" nodes/ClaudeAgentSdk/**/types.ts

# Find types that exist in both project and SDK
rg "^export declare type (SDKMessage|AgentDefinition|McpStdioServerConfig|BaseHookInput|PreToolUseHookInput|ThinkingConfig|ModelUsage|McpServerStatus)" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts

# Find imports from SDK to verify what's already using canonical types
rg "from '@anthropic-ai/claude-agent-sdk'" nodes/

# Find loose SDKMessage usage (the shadow type)
rg "SDKMessage" nodes/ClaudeAgentSdk/ --type ts

# Find all tool input type references to check if using sdk-tools types
rg "tool_input|toolInput" nodes/ClaudeAgentSdk/ --type ts
```

## Decision Tree

```
Is there an SDK/n8n type for this?
├─ YES → Do you need all fields?
│   ├─ YES → Import directly (Pattern 1)
│   ├─ SUBSET → Use Pick (Pattern 2)
│   ├─ WEAKER → Use Partial + Pick (Pattern 3)
│   └─ EXTENDED → Use Intersection (Pattern 4)
└─ NO → Create project type (document in type-map.md "Project-Only Types")
```
