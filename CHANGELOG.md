# Changelog

## Unreleased — canonical types remediation (2026-06-11)

Full type audit against `@anthropic-ai/claude-agent-sdk` 0.3.170 and
n8n-workflow 2.x. Highlights and behavior/wire changes:

### Fixed
- **n8n >= 2.14 runtime compatibility**: `setSignatureValidationRequired()`
  (removed in n8n-workflow 2.14.0) is now feature-guarded — Telegram/
  WhatsApp/Woztell companion HITL dispatch no longer throws on modern n8n.
- **Provider credential visibility on n8n >= 2.14**: the `_cnd` regex
  `'^undefined$'` trick stopped matching unset parameters; provider
  credentials now use complement-`hide` rules (work on 1.x and 2.x).
- **Managed-agent usage reporting**: token usage, num_turns and fast-speed
  detection are accumulated from `span.model_request_end` and reported on the
  terminal result — managed runs previously reported all-zero usage.
- **Fast mode**: the non-canonical `speed: 'fast'` query-option key (silently
  dropped by the SDK) was removed; fast mode rides on the
  `fast-mode-2026-02-01` beta header.
- typecheck now runs against n8n-workflow 2.25.0 (devDependency) instead of a
  stale physical 1.113.0 install.

### Changed (wire shapes)
- Managed-agent `result` messages are canonical `SDKResultSuccess`/
  `SDKResultError`: top-level `stop_reason` (the nested `message.stop_reason`
  copy is gone), canonical error subtypes (`error_during_execution` instead
  of invented `'error'`), required `usage`/`uuid`/`num_turns`/etc. populated.
- The fake managed `stream_event` frames (`subtype: 'thinking' | 'usage' |
  'requires_action'`) are no longer emitted (they violated the SDK contract
  and had no consumers); `requires_action` event_ids remain available via the
  `_raw` extension on mapped messages.
- `maxBufferSize` is no longer sent to the SDK (option was removed upstream);
  the Max Buffer Size parameter still feeds the generated Python SDK script.
- Subprocess env values are canonical `string | undefined`: JSON-provided
  numbers/booleans are stringified, `null` is dropped.

### Added
- `task_result` now surfaces `permissionDenials`, `resultIsError`,
  `resultErrors` (canonical SDK result diagnostics) and `sessionFiles`
  (managed backend file listing); agent-error detection prefers canonical
  diagnostics over text heuristics.
- Sandbox: `Fail If Unavailable` opt-out and network `Allowed Domains`/
  `Denied Domains` egress controls.
- MCP servers: per-server `Timeout (Ms)` and `Always Load` options.
- Tool dropdowns refreshed against the canonical SDK tool set (TaskStop,
  Workflow, REPL, Cron tools, worktree tools, MCP resource tools, ...);
  nonexistent `Execute`/`List` removed.
- Streaming: `system:hook_response`, `system:session_state_changed`,
  `tool_use_summary`, `rate_limit_event` content types selectable; session
  state (`idle`/`running`/`requires_action`) tracked during execution.
- Permission mode `auto` recognized (canonical PermissionMode union);
  arbitrary mode strings clamp to `default`.
