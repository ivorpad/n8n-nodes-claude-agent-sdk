# Installation

`n8n-nodes-claude-agent-sdk` is an n8n community-node package for self-hosted
n8n. It is not designed for n8n Cloud or for n8n-verified-node constraints.

## Prerequisites

- Self-hosted n8n with community nodes enabled.
- A runtime that can start child processes and access the configured working
  directories.
- Claude Code CLI installed in the n8n runtime when using the **Local CLI**
  backend.
- Provider credentials or a logged-in Claude Code CLI session.
- Optional Redis/Postgres services if you use those memory or durability
  features.

For Docker, install the Claude CLI and required shell/tooling in the n8n image,
not only in an external task-runner container.

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

## Install A Tarball Into Docker n8n

Copy the tarball into the running n8n container:

```bash
docker cp n8n-nodes-claude-agent-sdk-0.2.22.tgz n8n:/tmp/
```

Install it in n8n's community-node directory:

```bash
docker exec -it n8n sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /tmp/n8n-nodes-claude-agent-sdk-0.2.22.tgz
exit
docker restart n8n
```

For Docker Compose and queue mode, install the same package version in every
container that loads or executes workflows: main, webhook, and worker
containers.

## Bake Into A Custom Docker Image

For production, prefer a custom n8n image over manual installation into a
running container.

```dockerfile
FROM n8nio/n8n:<your-n8n-version>

USER root
RUN mkdir -p /home/node/.n8n/nodes \
	&& cd /home/node/.n8n/nodes \
	&& npm install n8n-nodes-claude-agent-sdk \
	&& chown -R node:node /home/node/.n8n
USER node
```

To install from a locally built tarball, copy it into the image:

```dockerfile
FROM n8nio/n8n:<your-n8n-version>

USER root
COPY n8n-nodes-claude-agent-sdk-0.2.22.tgz /tmp/
RUN mkdir -p /home/node/.n8n/nodes \
	&& cd /home/node/.n8n/nodes \
	&& npm install /tmp/n8n-nodes-claude-agent-sdk-0.2.22.tgz \
	&& rm /tmp/n8n-nodes-claude-agent-sdk-0.2.22.tgz \
	&& chown -R node:node /home/node/.n8n
USER node
```

Your image must also provide the Claude CLI path, shell, working-directory
mounts, Claude config mount, and optional Redis/Postgres services needed by your
workflow.

## Docker Runtime Notes

For Local CLI execution, the n8n container commonly needs:

```dockerfile
USER root
RUN apk add --no-cache bash git python3 make g++ \
	&& npm install -g @anthropic-ai/claude-code
ENV SHELL=/bin/bash
USER node
```

Mount only the directories the workflow needs:

```yaml
services:
  n8n:
    image: n8n-custom:latest
    volumes:
      - n8n-data:/home/node/.n8n
      - ./projects:/workspace
      - ./claude-config:/home/node/.claude
    environment:
      SHELL: /bin/bash
      HOME: /home/node
      CLAUDE_CONFIG_DIR: /home/node/.claude
```

Set **Working Directory** to the container path, for example
`/workspace/my-project`, not the host path.

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
