# n8n Claude Agent SDK Docs

This documentation is for users installing and operating the
`n8n-nodes-claude-agent-sdk` community node in self-hosted n8n.

Start here:

- [Installation](installation.md) - install from npm, build a local tarball, and verify the nodes appear.
- [Providers And Credentials](providers-and-credentials.md) - configure Anthropic, Claude Code CLI subscription auth, OpenRouter, Alibaba Coding Plan, LiteLLM, Ollama, custom endpoints, secure environment variables, and proxy settings.
- [Execute Task](execute-task.md) - configure the main operation, generated Python SDK scripts, tools, MCP servers, streaming, structured output, and session IDs.
- [HITL](hitl.md) - configure browser/webhook approvals, AskUserQuestion, channel nodes, wait/resume ownership, webhook authentication, and provider callback authentication.
- [Persistence And Operations](persistence-and-operations.md) - choose Simple, Redis, or Postgres session memory; persist Claude config/session state; operate queue mode; and enable Postgres-backed observability, HITL, and streaming durability.
- [Troubleshooting](troubleshooting.md) - diagnose common install, provider, runtime, session, queue-mode, HITL, payload, and security issues.

For security posture and operator policy controls, start with the safe
deployment baseline in [Persistence And Operations](persistence-and-operations.md).

## Scope

This package targets self-hosted n8n community-node installs. It uses host-level
capabilities such as the Claude CLI, child processes, filesystem access,
environment variables, webhook callbacks, and optional Redis/Postgres services.
Install it only where you trust the node package and control the host runtime.

The docs intentionally stay focused on public installation, configuration,
operation, troubleshooting, and safe self-hosted deployment expectations.
