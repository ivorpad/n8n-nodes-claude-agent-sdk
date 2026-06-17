# Installation

`n8n-nodes-claude-agent-sdk` is an n8n community-node package for self-hosted
n8n. It is not designed for n8n Cloud or for n8n-verified-node constraints.

## Prerequisites

- Self-hosted n8n with community nodes enabled.
- A runtime that can start child processes and access the configured working
  directories.
- Provider credentials or a logged-in Claude Code CLI session.
- Optional Redis/Postgres services if you use those memory or durability
  features.

This package declares `@anthropic-ai/claude-code` as an npm dependency. With
normal npm installs, Claude Code is installed alongside the community node and
the node auto-detects the package's `claude` binary. The credential path field
is only an override for unusual custom binaries.

## Install From npm

In the n8n editor:

1. Open **Settings** -> **Community Nodes**.
2. Choose **Install a community node**.
3. Enter `n8n-nodes-claude-agent-sdk`.
4. Restart n8n if your deployment does not reload community nodes automatically.

For npm-based self-hosted installs:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-claude-agent-sdk
```

That single install is expected to install `@anthropic-ai/claude-code` as well.
If you plan to authenticate with a Claude Code subscription, log in from the
same runtime user and install directory:

```bash
cd ~/.n8n/nodes
npx claude login
```

## Build A Local Package

Build a local tarball from this repository when you need to install or test a
specific checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm pack
```

The tarball name includes the package version, for example
`n8n-nodes-claude-agent-sdk-0.2.22.tgz`.

## Install A Local Tarball

Install the tarball in n8n's community-node directory:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /absolute/path/to/n8n-nodes-claude-agent-sdk-0.2.22.tgz
```

For queue mode, install the same package version in every runtime that loads or
executes workflows: main, webhook, and worker processes.

You can also install directly from a local checkout during development after
building `dist`:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /absolute/path/to/n8n-nodes-claude-agent-sdk
```

## Runtime Notes

For Local CLI execution, ensure `SHELL` points to a POSIX shell available to the
n8n process:

```bash
export SHELL=/bin/bash
```

Set **Working Directory** to a path the n8n runtime can access.

## Verify The Install

After restarting n8n, search the node panel for these node display names:

- `Claude Agent SDK`
- `Claude Skill Tool`
- `Simple Session Memory`
- `Redis Session Memory`
- `Postgres Session Memory`
- Channel nodes such as `Claude Agent Slack`, `Claude Agent Telegram`,
  `Claude Agent WhatsApp`, `Claude Agent Email`, and `Claude Agent Discord`

Search by node display name, not by package name.

To upgrade from npm:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-claude-agent-sdk@latest
```

To upgrade from a local tarball, install the new tarball and restart n8n:

```bash
cd ~/.n8n/nodes
npm install /absolute/path/to/n8n-nodes-claude-agent-sdk-NEW_VERSION.tgz
```

To remove:

```bash
cd ~/.n8n/nodes
npm uninstall n8n-nodes-claude-agent-sdk
```
