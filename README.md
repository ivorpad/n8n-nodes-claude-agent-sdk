# n8n-nodes-claude-agent-sdk

An n8n community node that integrates the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) into n8n workflows. Execute autonomous AI coding tasks directly from n8n.

## Community Node Scope

This package targets **self-hosted n8n community-node installs**. It is not designed as an n8n-verified or n8n Cloud-compatible node: it intentionally uses host-level capabilities such as the Claude CLI, filesystem access, environment variables, child processes, webhook callbacks, and optional Postgres/Redis/S3-compatible services.

Install it only in n8n instances where you trust the node package and control the host runtime.

## Features

- **Execute Task** - Run autonomous coding tasks with full agent capabilities
- **MCP Server Support** - Connect external MCP servers and optional in-process n8n MCP tools
- **Session Memory** - Maintain conversation state across workflow executions (Redis, PostgreSQL, or in-memory)
- **Workspace Persistence** - Optional MinIO/S3-backed working-directory snapshots for resume resilience
- **Sandbox Configuration** - Isolate command execution with filesystem and network restrictions
- **Path Sandboxing** - Restrict file system access to specific directories
- **Content Filtering** - Filter sensitive content from agent output
- **Audit Logging** - Track all agent actions with detailed logs
- **Subagents** - Delegate tasks to specialized subagents

## Current SDK and Claude Models

This package tracks `@anthropic-ai/claude-agent-sdk` 0.3.175 and `@anthropic-ai/sdk` 0.100.1. The node uses the supported `query()` API with `options.resume`; the removed unstable V2 session API is intentionally not used.

The model dropdown keeps the historical aliases (`opus`, `sonnet`, `haiku`, and default) and adds explicit current IDs: `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`. Provider overrides such as `ANTHROPIC_DEFAULT_OPUS_MODEL` can point at `claude-opus-4-8`.

For Opus 4.7+ / 4.8, adaptive thinking plus `effort` is the primary reasoning path. Fixed thinking budgets are suppressed for those models because the current API surface rejects them. Fast Mode is exposed only as a Claude API research-preview toggle for supported Opus models.

Current SDK tool/message drift is handled: `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`, and `Monitor` are first-class surfaces; `TodoWrite` remains parsed for historical transcripts. Results include structured refusal metadata as `stopReason` / `stopDetails` where the SDK provides it.

## Installation

n8n community nodes are npm packages. Once this package is published, install it like any other community node from npm. We are **not publishing to npm yet**, so the local tarball flow below is the temporary pre-publish substitute.

### Standard Community Node Install (After npm Publish)

After the package is published, install it from the n8n editor:

1. Open **Settings** > **Community Nodes**
2. Choose **Install a community node**
3. Enter `n8n-nodes-claude-agent-sdk`
4. Restart n8n if your deployment does not reload community nodes automatically

For self-hosted Docker or npm-based installs, the equivalent manual install is:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-claude-agent-sdk
```

Do not run the npm-registry install until the package has actually been published.

### Pre-Publish: Build a Local Package

From this repository:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm pack
```

This creates a local tarball such as `n8n-nodes-claude-agent-sdk-0.2.22.tgz`.

### Pre-Publish: Install into Docker n8n

Copy the tarball into the running n8n container:

```bash
# Replace n8n with your container name.
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

For Docker Compose or queue mode, install the same tarball in every n8n container that loads or executes workflows: main, webhook, and worker containers.

### Bake into a Custom Docker Image

For production, prefer baking the community node into the image instead of manually installing into a running container.

After npm publish:

```dockerfile
FROM n8nio/n8n:<your-n8n-version>

USER root
RUN mkdir -p /home/node/.n8n/nodes \
	&& cd /home/node/.n8n/nodes \
	&& npm install n8n-nodes-claude-agent-sdk \
	&& chown -R node:node /home/node/.n8n
USER node
```

Before npm publish, copy in the local tarball instead:

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

Build and run that image with the same volumes, environment variables, Claude CLI setup, and optional Postgres/Redis/MinIO services your n8n deployment already uses.

### Pre-Publish: Install into npm-based n8n

If n8n is installed directly on a host with npm:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /absolute/path/to/n8n-nodes-claude-agent-sdk-0.2.22.tgz
n8n start
```

### Verify the Install

After restarting n8n, open the editor and search for `Claude Agent SDK`, `Claude Skill Tool`, or `Claude Agent Email` in the node panel. Search by node display name, not by the package name.

After npm publish, upgrade from `~/.n8n/nodes` with:

```bash
npm install n8n-nodes-claude-agent-sdk@latest
```

Before npm publish, install a newer tarball from `~/.n8n/nodes` and restart n8n:

```bash
npm install /absolute/path/to/n8n-nodes-claude-agent-sdk-NEW_VERSION.tgz
```

To remove it:

```bash
cd ~/.n8n/nodes
npm uninstall n8n-nodes-claude-agent-sdk
```

## Prerequisites

This node requires a self-hosted n8n runtime with the Claude CLI installed and accessible:

- **For API users**: Provide your Anthropic API key in the credentials
- **For Claude Max/Pro subscribers**: The node uses your logged-in CLI session (no API key needed)
- **Executable path**: Configure the Claude Code executable path in the Claude API credential. Leave the API key empty to use your Claude Code subscription.
- **Runtime access**: The n8n process must be allowed to start child processes and read/write the configured working directories.
- **Optional infrastructure**: Redis, Postgres, MinIO/S3, companion channels, and SMTP are used only when their related nodes or durability options are configured.

### Install-Time Compatibility Patch

`@modelcontextprotocol/sdk` depends on `pkce-challenge`, which ships files named `index.node.js`. n8n's custom-node loader can mistake those files for n8n node classes. During install, this package runs a small Node.js postinstall script that renames those files inside the installed `pkce-challenge` package to avoid loader collisions.

Set `N8N_CLAUDE_AGENT_SDK_SKIP_PKCE_PATCH=1` only if your n8n loader setup already excludes transitive dependency files.

## Using Alternative API Providers

The Claude Agent SDK node supports multiple API providers beyond Anthropic's official API. This allows you to use alternative routing services, local models, or custom endpoints.

### Supported Providers

Choose credential-backed providers with **Authentication** = `API Credential` and **Credential Type**; the credential chooser is rendered inline from that field, like n8n's HTTP Request node. The selector is scoped to SDK provider credentials such as `Claude Agent SDK Anthropic API` and `Claude Agent SDK OpenRouter API`, so n8n LangChain's separate `Anthropic` credential type is not shown. Choose local Ollama with **Authentication** = `Ollama (Local)`. **Additional Options** → **API Provider** remains available for custom endpoint overrides.

#### 1. Anthropic (Official) - Default

Uses the official Anthropic API at `https://api.anthropic.com`.

**Setup:**
- Provide your Anthropic API key in credentials, OR
- Use Claude Max/Pro subscription with CLI login (no API key needed)

#### 2. OpenRouter

[OpenRouter](https://openrouter.ai) provides multi-provider AI routing with smart fallbacks and unified billing.

**Benefits:**
- Smart routing across multiple Claude providers
- Automatic failover if one provider is down
- Unified billing across different models
- Access to non-Anthropic models if desired

**Setup:**
1. Get your OpenRouter API key from [openrouter.ai/keys](https://openrouter.ai/keys)
2. Set **Authentication** to `API Credential`
3. Set **Credential Type** to `Claude Agent SDK OpenRouter API`
4. Create/select SDK OpenRouter credentials and enter your API key
5. The node sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` for Claude Code, and explicitly clears `ANTHROPIC_API_KEY`
6. The **API Provider** dropdown is ignored when Credential Type is `Claude Agent SDK OpenRouter API`

**Optional (Shell Profile):**
If you prefer global configuration for Claude Code subscription, set these in your shell profile:
```bash
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
export ANTHROPIC_API_KEY="" # Must be explicitly empty for OpenRouter
```

**Model Selection:**
- Use the Sonnet/Opus/Haiku model dropdowns (shown when Credential Type = `Claude Agent SDK OpenRouter API`)
- Only tool-supporting models are listed

**Additional Features:**
You can pass OpenRouter-specific headers via Environment Variables:
```json
{
  "HTTP_REFERER": "https://your-app.com",
  "X_TITLE": "Your App Name"
}
```

#### 3. Ollama (Local)

[Ollama](https://ollama.ai) enables running AI models locally on your machine. Requires Ollama v0.14.0+ with Anthropic API compatibility.

**Benefits:**
- Run models locally without API costs
- Full data privacy (no external API calls)
- Works offline
- Good for development and testing

**Setup:**

1. Install Ollama v0.14.0 or later:
   ```bash
   # macOS/Linux
   curl -fsSL https://ollama.ai/install.sh | sh

   # Or download from https://ollama.ai/download
   ```

2. Pull a coding-focused model:
   ```bash
   ollama pull qwen2.5-coder:latest
   # or
   ollama pull deepseek-coder
   ```

3. Start Ollama server:
   ```bash
   ollama serve
   ```

4. Configure the node:
   - Set **Authentication** to `Ollama (Local)`
   - Set **Ollama Base URL** in Additional Options when the default `http://localhost:11434` is not reachable
   - Select an installed model from the **Model** dropdown

**Docker Configuration:**

If running n8n in Docker, Ollama must be accessible from the container:

- **Ollama on host machine:**
  ```
  Ollama Base URL: http://host.docker.internal:11434
  ```

- **Ollama in separate container:**
  ```yaml
  services:
    n8n:
      ...
    ollama:
      image: ollama/ollama
      ports:
        - "11434:11434"
  ```

  Then use:
  ```
  Ollama Base URL: http://ollama:11434
  ```

**Recommended Models:**
- `qwen2.5-coder:latest` - Excellent for code generation
- `deepseek-coder` - Strong coding performance
- `codellama:13b` - Good balance of speed and quality

**Note:** Local models may not match Claude's capabilities for complex agentic tasks.

#### 4. Custom Endpoint

Use any Anthropic Messages API-compatible endpoint, such as:
- Claude Code Router
- LiteLLM Proxy
- Custom API gateways
- Enterprise proxies

**Setup:**
1. Set **API Provider** to `Custom Endpoint`
2. Set **Custom API Endpoint** to your endpoint URL (e.g., `https://your-proxy.com/v1`)
3. Provide your API key in credentials
4. The node will route all requests through your custom endpoint

**Popular Custom Endpoints:**

- **[Claude Code Router](https://github.com/musistudio/claude-code-router)** - Route Claude Code requests through custom providers
- **[LiteLLM Proxy](https://docs.litellm.ai/docs/proxy/quick_start)** - Unified interface for multiple LLM providers

### Environment Variable Override

Advanced users can override the provider's base URL by adding `ANTHROPIC_BASE_URL` to **Environment Variables (JSON)** in Additional Options. This takes precedence over the provider selection. For OpenRouter, you may also provide `ANTHROPIC_AUTH_TOKEN` here and keep `ANTHROPIC_API_KEY` explicitly empty.

### Secure Environment Variable Injection

Use **Additional Options** → **Inject Secure Environment Variables** when Claude needs secrets at runtime but you do not want them stored in node parameters.

**What it does:**
- Loads secrets from the **Secure Environment Variables** credential
- Injects them into the Claude subprocess used by `executeTask`
- Redacts injected values from node outputs, stderr, and audit/stream payloads
- Lets secure credential values override matching keys from **Environment Variables (JSON)**

**Setup:**
1. Enable **Inject Secure Environment Variables**
2. Create/select **Secure Environment Variables** credentials
3. Add `Name` / `Value` pairs such as `OPENAI_API_KEY`, `GITHUB_TOKEN`, or `SLACK_BOT_TOKEN`
4. If **Environment Security Mode** is `Allowlist (strict)`, add those variable names to **Allowlisted Environment Variables**

**Use in scripts run by Claude:**

```bash
echo "$OPENAI_API_KEY"
```

```javascript
process.env.OPENAI_API_KEY
```

```python
import os
os.environ["OPENAI_API_KEY"]
```

**Limits:**
- Variable names must match `^[A-Za-z_][A-Za-z0-9_]*$`
- Dangerous process-level variables such as `NODE_OPTIONS` and `LD_PRELOAD` are blocked
- This applies to live `executeTask` runs; generated Python SDK scripts do not embed secure credential values

See [`docs/guides/secure-env-vars.md`](docs/guides/secure-env-vars.md) for full details.

### Proxy Manager for Credential Interception

When outbound traffic must pass through a TLS-terminating proxy that injects credentials:

- Enable **Sandbox** (Sandbox Configuration → Enable Sandbox)
- In **Additional Options** enable **Enable Proxy Manager**
- Set **Proxy HTTP URL** and/or **Proxy HTTPS URL**
- Set **Proxy CA Bundle Path** when the proxy uses a custom certificate
- Optional: set **Proxy No-Proxy List** for domains that must bypass interception

Proxy manager settings are injected into the Claude subprocess as:

- `HTTP_PROXY` / `http_proxy`
- `HTTPS_PROXY` / `https_proxy`
- `NO_PROXY` / `no_proxy`
- `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `GIT_SSL_CAINFO`

Use secure variables for proxy credentials (e.g., bearer tokens, basic auth secrets, API tokens). The node warns when inline credentials are detected in proxy URLs so they are not persisted in query logs.

The proxy options are only visible when **Enable Sandbox** is on, and proxy injection is blocked when sandboxing is not active.

### Troubleshooting

**Connection Refused (Ollama):**
- Ensure `ollama serve` is running
- Check firewall settings
- In Docker: use `host.docker.internal:11434` instead of `localhost:11434`

**Ollama Version Too Old:**
- Anthropic Messages API compatibility requires Ollama v0.14.0+
- Run `ollama --version` and upgrade if needed

**Authentication Failed (OpenRouter):**
- Verify your OpenRouter API key is set (SDK OpenRouter credentials or environment)
- Ensure the Anthropic API key credential is empty for OpenRouter
- Check key has sufficient credits

**404 Not Found (Custom):**
- Verify the endpoint URL is correct
- Ensure endpoint implements Anthropic Messages API format

## Persistent Session + Workspace Resume

For long-running autonomous workflows on ephemeral runners:

- `sessionPersistence` (PostgreSQL) keeps Claude transcript JSONL (conversation history) in a durable table.
- `workspacePersistence` (MinIO/S3) keeps working-directory snapshots so resume can recover files.

### Storage architecture: Deterministic sessions + transcript artifacts + workspace snapshots

The node uses three persistence layers, each for a different failure mode:

- Session Memory node (`Simple`, `Redis`, or `Postgres`) tracks deterministic session existence for `chatSessionId` and stores canonical transcript `workingDirectory` metadata.
- `sessionPersistence` stores Claude transcript JSONL artifacts in PostgreSQL keyed by `(workflow_id, chatSessionId)`.
- `workspacePersistence` stores working-directory snapshots in S3-compatible object storage.

Why the split:

1. Session memory is fast resume routing and metadata storage. It tracks whether a deterministic `chatSessionId` already exists.
2. Postgres session artifacts are not just checkpoints for memory metadata; they are the actual conversation history used for continuation after process/container loss.
3. MinIO/S3 snapshots restore the files generated between runs (`git` state, artifacts, caches, and local edits) that are not represented in transcript JSONL.

This means:

- MinIO/S3 is needed only for workspace continuity.
- Postgres sessionPersistence is needed for transcript continuity.
- A memory node is needed for deterministic session continuity between node executions.
- All three together cover full end-to-end continuity on ephemeral workers.

If you use Postgres for both deterministic session metadata and transcripts, n8n requires selecting Postgres credentials per node. You can reuse the same Postgres credential for the Session Memory node and for `sessionPersistence`, or create two separate credentials (for example “Session Metadata DB” vs “Transcript DB”).

### HITL durability guardrails

When `Enable HITL = On` (`interactiveApprovals = pauseForApproval`), runtime guardrails enforce critical requirements:

- HITL with `persistSession = false` fails fast.
- `executionBackend = remoteHttp` with AskUserQuestion handling enabled fails fast.
- Wait/resume ordering is enforced so response URLs are sent only after `putExecutionToWait()` succeeds.

There is no separate node setting named `HITL Durability Validation` in the current SDK property surface.

See [`docs/setup/durability.md`](docs/setup/durability.md) for full setup and validation checklist.
See [`docs/guides/operations.md`](docs/guides/operations.md) for sustained-load hardening (OOM, payload limits, workspace scope).

### Credential precedence and login

For workspace persistence, values are resolved in this order:
1. Explicit `workspacePersistence` fields on the node.
2. n8n `s3` credential fields (if configured).
3. Environment fallback `MINIO_ENDPOINT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`, `MINIO_PREFIX`.
4. Final defaults: host `127.0.0.1`, bucket `claude-workspaces`, prefix `sessions`, region `us-east-1`.

For local test container from above, this means the default login is:

```bash
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
```

Common invalid-login causes:

- Using console password from a different MinIO container than endpoint.
- Endpoint mismatch (`127.0.0.1` vs host IP from another VM/container).
- Typo in endpoint protocol/port (S3 expects the API port, not console port).

Runtime reminder:

- If credential resolution is unexpected, check the service is actually accepting that key by testing with a direct S3 call using the same endpoint and keys the node uses.
- If workspace hydration/flush fails, `workspacePersistenceDebug` is included in the node output under `_debug.workspacePersistence`.
For transcript persistence (`sessionPersistence`), values are resolved in this order:
1. Explicit `sessionPersistence` override fields on the node (Host/Port/Database/User/Password, and “Enable SSL” to force SSL).
2. n8n `postgres` credential fields (if configured).
3. Environment fallback `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.
4. Final defaults: host `localhost`, port `5432`.

### MinIO/S3 persistence notes

To enable workspace snapshotting:

1. Enable `workspacePersistence`.
2. Configure endpoint, credentials, bucket, and prefix.
3. Set ignore patterns for secrets and temporary directories.

If you use `orb`, run a MinIO-compatible service in your preferred environment and point the endpoint/credentials to it.

#### OrbStack `orb` bootstrap (quick local test)

From the shell that runs n8n, run:

```bash
orb -m default -- docker run -d \
  --name claude-workspace-minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -v claude-minio-data:/data \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```

Optional: keep data across container restarts:

```bash
orb -m default -- docker run -d \
  --name claude-workspace-minio \
  --restart unless-stopped \
  -p 9000:9000 \
  -p 9001:9001 \
  -v "$HOME/claude-minio-data:/data" \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```

Use these for teardown:

```bash
orb -m default -- docker stop claude-workspace-minio
orb -m default -- docker rm claude-workspace-minio
```

To verify the service from the same machine:

```bash
curl -f http://127.0.0.1:9000/minio/health/live
```

If your app runs in a different environment from the `orb` machine, replace the endpoint with that machine's reachable IP and set:

```
MINIO_ENDPOINT=<that-machine-ip>
```

Suggested environment defaults:

```bash
export MINIO_ENDPOINT=127.0.0.1
export MINIO_ROOT_USER=minioadmin
export MINIO_ROOT_PASSWORD=minioadmin
export MINIO_BUCKET=claude-workspaces
export MINIO_PREFIX=sessions
```

`workspaceId` defaults to the explicit `workspaceId`, then `chatSessionId`, then working-directory basename, then workflow id.

## Docker Deployment

Running this node in Docker requires specific configuration. Here are the key learnings:

### Dockerfile Requirements

Your n8n Docker image must have:

```dockerfile
FROM n8nio/n8n:latest

USER root

# Install bash (required for Claude CLI)
RUN apk add --no-cache git python3 make g++ bash

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Set shell for Claude CLI
ENV SHELL=/bin/bash

# ... rest of your Dockerfile
```

### Docker Compose Configuration

```yaml
services:
  n8n:
    image: n8n-custom:latest
    volumes:
      - /path/to/n8n/data:/root/.n8n:rw
      - /path/to/projects:/projects:rw           # Working directories
      - /path/to/claude-auth:/root/.claude:rw    # Claude auth (for Max/Pro users)
    environment:
      SHELL: /bin/bash
      # Set Claude CLI path via the Claude API credential in n8n
```

### Read-Only Root Filesystem + tmpfs Writable Paths

`--read-only` and `--tmpfs` are deployment-level controls (Docker/Kubernetes), not node-level toggles.

Use this pattern when you want a minimal writable surface:

```bash
docker run -d \
  --name n8n \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --tmpfs /workspace:rw,noexec,size=500m \
  -v n8n-data:/root/.n8n:rw \
  -v claude-config:/root/.claude:rw \
  -e SHELL=/bin/bash \
  n8n-custom:latest
```

```yaml
services:
  n8n:
    image: n8n-custom:latest
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=100m
      - /workspace:rw,noexec,size=500m
    volumes:
      - /path/to/n8n/data:/root/.n8n:rw
      - /path/to/claude-config:/root/.claude:rw
    environment:
      SHELL: /bin/bash
```

Required writable locations:

1. Working directory used by the node (for example `/workspace/my-project`)
2. `/tmp` for temporary files and tool/runtime scratch usage
3. Claude config/state path (`~/.claude`, or isolated `CLAUDE_CONFIG_DIR` if config isolation is enabled)

How this maps to node settings:

1. Set node **Working Directory** to a writable mounted path (for example `/workspace/my-project`).
2. If using **Path Sandboxing**, keep base/allowed paths aligned with mounted roots.
3. If using operator policy, set `N8N_CLAUDE_POLICY_ALLOWED_PATHS` to mounted roots only (for example `/workspace,/tmp`).

Persistence note:

- `--read-only` + `tmpfs` only controls runtime write scope.
- `tmpfs` data is lost when the container stops.
- For cross-run continuity, use `sessionPersistence` (transcripts) and `workspacePersistence` (workspace snapshots).

### Common Issues and Solutions

#### 1. `ENOENT` Error When Setting Working Directory

**Symptom:**
```
Failed to spawn Claude Code process: spawn /usr/local/bin/claude ENOENT
```

**Cause:** The working directory path doesn't exist *inside* the container. You're using a host path instead of the container path.

**Solution:**
- If you mount `/volume1/projects:/projects`, use `/projects/myapp` as the working directory, not `/volume1/projects/myapp`
- Verify the path exists: `docker exec -it n8n ls -la /projects/myapp`

#### 2. Claude Binary Not Found

**Symptom:** Same ENOENT error, but working directory is correct.

**Solution:** Set the executable path in the Claude API credential.

Verify installation:
```bash
docker exec -it n8n sh
which claude
/usr/local/bin/claude --version
```

#### 3. External Task Runners

If you're using n8n's external task runners (`N8N_RUNNERS_MODE: external`), note that:

- Community nodes typically run in the **main n8n container**, not the task runner
- The Claude CLI must be installed in the n8n container, not the task-runners container
- Volume mounts for working directories go on the n8n service

#### 4. MCP Server Arguments

MCP server arguments are **comma-separated**:

```
Arguments: -y,@shopify/dev-mcp@latest
```

**Tip:** If you see corrupted package names in errors (e.g., `ev-mcp` instead of `dev-mcp`), delete the field content and retype it fresh - there may be invisible characters.

#### 5. Claude Authentication in Docker

For Claude Max/Pro users, mount your auth directory:

```yaml
volumes:
  - /path/to/claude-auth:/root/.claude:rw
```

You may need to run `claude login` inside the container initially:
```bash
docker exec -it n8n /usr/local/bin/claude login
```

#### 6. "bypassPermissions" Fails with Root User

**Symptom:**
```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

**Cause:** Claude CLI has a security check that prevents `--dangerously-skip-permissions` when running as root. This affects the `bypassPermissions` permission mode.

**Solutions:**

**Option A: Use a different permission mode (Easiest)**
- Change the node's Permission Mode from `bypassPermissions` to `acceptEdits` or `default`
- No Docker changes required

**Option B: Run n8n as non-root user**
```yaml
n8n:
  user: 1000:1000
  volumes:
    - /path/to/n8n-data:/home/node/.n8n:rw
    - /path/to/claude-auth:/home/node/.claude:rw
  environment:
    HOME: /home/node
    CLAUDE_CONFIG_DIR: /home/node/.claude
```

Then fix volume permissions:
```bash
sudo chown -R 1000:1000 /path/to/n8n-data
sudo chown -R 1000:1000 /path/to/claude-auth
```

**Option C: Wrapper script (run claude as non-root while container runs as root)**

Add to Dockerfile:
```dockerfile
RUN adduser -D -u 1000 claude-user

RUN printf '#!/bin/bash\nexec su -s /bin/bash claude-user -c "/usr/local/share/npm-global/bin/claude $*"' > /usr/local/bin/claude-wrapper && \
    chmod +x /usr/local/bin/claude-wrapper
```

Then in docker-compose:
Set the executable path in the Claude API credential to `/usr/local/bin/claude-wrapper`.

**Important wrapper script notes:**
- Use `cp -r /path/.` not `cp -r /path/*` to copy hidden files (dotfiles like `.credentials.json`)
- If using `no-new-privileges:true` security option, add `chmod u+s /bin/su` in Dockerfile for su to work
- Add `chmod 755 /root` so Claude can scan the filesystem without permission errors

#### 7. Claude Fails to Scan /root Directory

**Symptom:**
```
EACCES: permission denied, scandir '/root'
```

**Cause:** Claude CLI tries to scan /root during initialization, but non-root users can't access it.

**Solution:** Add to Dockerfile:
```dockerfile
RUN chmod 755 /root
```

#### 8. Hidden Files Not Copying in Wrapper

**Symptom:** Wrapper copies credentials but Claude still can't authenticate.

**Cause:** `cp -r /root/.claude/*` does NOT copy dotfiles like `.credentials.json`

**Solution:** Use `/.` syntax:
```bash
cp -r /root/.claude/. /home/claude-user/.claude/
```

#### 9. Synology NAS File Permissions

**Symptom:** Docker can't read mounted credentials file.

**Cause:** Synology creates files with 600 permissions by default, only readable by owner.

**Solution:** Fix permissions on NAS:
```bash
sudo chmod 644 ~/.claude/.credentials.json
```

#### 10. n8n Data Directory Needs Recursive Ownership

**Symptom:** After switching to non-root user, n8n crashes with:
```
EACCES: permission denied, open '/home/claude-user/.n8n/crash.journal'
```

**Cause:** Files inside data directory were created by root and retain root ownership.

**Solution:** Use recursive flag:
```bash
sudo chown -R 1001:1001 /path/to/n8n/data/
```

#### 11. Synology ACLs Block Access Despite Correct Permissions

**Symptom:** Permissions show `drwxrwxrwx+` (note the `+`) but container can't write.

**Cause:** Synology uses ACLs that can deny access even when standard Unix permissions look correct.

**Solution:** Override with chmod 777:
```bash
sudo chmod -R 777 /volume1/docker/n8n/data/
sudo chmod -R 777 /path/to/.claude/
```

#### 12. Claude .claude Directory Not Writable

**Symptom:**
```
EACCES: permission denied, mkdir '/home/claude-user/.claude/todos'
```

**Cause:** Mounted .claude directory needs write permissions for Claude to create todos/debug subdirs.

**Solution:** Fix permissions on host:
```bash
sudo chown -R 1001:1001 /path/to/.claude/
sudo chmod -R 777 /path/to/.claude/
```

#### 13. Environment Variables Not Passed to Claude CLI

**Symptom:**
```
Error: No suitable shell found. Claude CLI requires a Posix shell environment.
```

**Cause:** When custom environment variables are passed to the SDK, they replace (not merge with) the system environment.

**Solution:** This node automatically passes essential environment variables:
- `PATH`, `HOME`, `SHELL`, `USER`, `TERM`, `LANG`, `LC_ALL`, `CLAUDE_CONFIG_DIR`

Ensure these are set in your docker-compose:
```yaml
environment:
  SHELL: /bin/bash
  HOME: /root  # or /home/node if running as non-root
  CLAUDE_CONFIG_DIR: /root/.claude  # must match mounted volume path
  # Set Claude CLI path via the Claude API credential in n8n
```

### Complete Docker Compose Example

```yaml
services:
  n8n:
    image: n8n-custom:latest
    container_name: n8n
    ports:
      - 5678:5678
    volumes:
      - ./n8n-data:/root/.n8n:rw
      - ./projects:/projects:rw
      - ./claude-auth:/root/.claude:rw
    environment:
      SHELL: /bin/bash
      # Set Claude CLI path via the Claude API credential in n8n
      N8N_HOST: localhost
      N8N_PORT: 5678
      N8N_PROTOCOL: http
    restart: unless-stopped
```

## Remote HTTP Execution (Experimental)

The node can delegate execution to a remote serverless runner via HTTP.

**Setup:**
- Set **Execution Backend** to `Remote HTTP (Serverless)`
- Configure the **Claude Agent Serverless** credential (Endpoint URL + API Key)
- Optionally set **Project ID** and **Node Run ID** in **Remote Execution**

**Notes:**
- The remote runner should mount a per-project persistent home volume for Claude session state.
- If **Working Directory** is empty, the node will default to `/projects/{projectId}/nodes/{nodeRunId}` when a project ID is provided.

## Node Configuration

### Operations

This node has a single operation:

| Operation | Description |
|-----------|-------------|
| Execute Task | Run autonomous coding tasks with full agent capabilities |

### Key Parameters

| Parameter | Description |
|-----------|-------------|
| Task Description | What you want the agent to do |
| Working Directory | Path where the agent operates (must exist in container) |
| Model | Claude model to use (default alias plus explicit current IDs such as `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`) |
| Max Turns | Maximum conversation turns before stopping |
| Allowed Tools | Which tools the agent can use |

## WhatsApp HITL Companion Node

Use `Claude Agent WhatsApp` when you want approvals and clarifying questions routed through WhatsApp while keeping SDK resume semantics and multi-hop behavior.

> Current durable setup guidance for WhatsApp + Telegram lives in [`docs/setup/hitl-channels.md`](docs/setup/hitl-channels.md).
> Use that document as the source of truth for no-loop, dispatch-and-exit channel workflows.
> The loop wiring below is legacy wait-mode guidance and should not be used for durable channel flows.
> Note: WhatsApp `In-Chat Reply Buttons` durable flow prefers companion inbound-envelope normalization; SDK now also supports approval-only fallback on raw `hitl|approve|...` / `hitl|deny|...` tokens.

### Wiring (legacy wait-mode loop)

Wire nodes in this exact loop:

1. Trigger/Webhook -> `Claude Agent SDK`
2. `Claude Agent SDK` (Result output) -> `Claude Agent WhatsApp` (the channel node filters for HITL request items and ignores `task_result`)
3. `Claude Agent WhatsApp` -> `Claude Agent SDK` (main input)
4. `Claude Agent SDK` (Result output) -> your downstream result path

Keep `Enable HITL = On` on `Claude Agent SDK` (`interactiveApprovals = pauseForApproval`).

### Delivery modes

`Claude Agent WhatsApp` supports three primary transport modes:

- `Text Links`: plain message body with signed resume URLs
- `Template Buttons`: WhatsApp approved template payload
- `Interactive CTA Buttons`: WhatsApp interactive CTA URL button messages

For `Interactive CTA Buttons`:

- approval requests: sends two CTA messages (`Approve`, `Deny`)
- question requests: sends one CTA message (`Answer`)

### Outbound message hardening controls

Large approval payloads (for example tool inputs containing big file content) can break WhatsApp interactive sends.
Use outbound controls to keep payload size safe:

- `Outbound Message Mode`
  - `As Is` (default): send generated HITL message unchanged
  - `Trim`: cut message to a max length
  - `Fallback Only`: ignore generated message and send fallback text
- `Max Outbound Characters`: used when mode is `Trim`
- `Fallback Message`: used when mode is `Fallback Only` or trimmed output becomes empty

These controls apply to primary HITL message generation in:

- `Text Links`
- `Template Buttons`
- `Interactive CTA Buttons`

Companion message settings remain independent and optional.

### Recommended settings for production WhatsApp HITL

When approval requests may include long tool payloads:

1. `Delivery Mode = Interactive CTA Buttons`
2. `Outbound Message Mode = Trim`
3. `Max Outbound Characters = 120` (start here; lower if needed)
4. `Fallback Message = Approve this action?`
5. `Send Companion Message = Off` (for deterministic transport)

### Troubleshooting

#### `(#131009) Parameter value is not valid`

This usually means WhatsApp rejected an invalid or oversized message field.

Fix order:

1. Ensure `Send Companion Message = Off` while debugging
2. Use `Outbound Message Mode = Trim`
3. Set `Max Outbound Characters` lower (for example `120`, then `80`)
4. Keep `Message Prefix` and `Message Title` short or empty

If this still occurs for `question_request` in `Interactive CTA Buttons`, URL length may be the limiter (questions are encoded in signed URL query). Use split routing:

- `approval_request` -> WhatsApp HITL node with `Interactive CTA Buttons`
- `question_request` -> WhatsApp HITL node with `Text Links`

### Important behavior notes

- WhatsApp in-chat reply buttons with `hitl|approve|...` / `hitl|deny|...` IDs can now be normalized to strict approval resume envelopes by SDK fallback in direct trigger-to-SDK flows.
- For full question-response mapping (`AskUserQuestion`), keep companion/webhook envelope normalization in the path.
- Plain chat text like `Approve` / `Deny` without HITL token metadata will not resume by itself.
- Channel nodes are transport adapters; strict HITL orchestration remains in the SDK/n8n control plane.

### Channel Reply Resume contract (v1.0)

To support multi-execution HITL resume (start with WhatsApp, then reuse for Slack/Telegram/Email), the shared contract is defined in:

- `nodes/ClaudeAgentChannelShared/core/channelReplyContract.ts`

Contract goals:

- persist a channel-agnostic pending envelope (`requestId`, `kind`, `channel`, resume context, routing metadata)
- normalize inbound provider events to a common shape
- derive deterministic `decisionKey` / `decisionId` for idempotent consume
- map question selections to strict `answers` payload for SDK resume

Question-answer mapping follows:

- key = original `question` text
- value = selected option labels joined by `, `
- free text answers can be used directly as value

Example answer map:

```ts
{
  "How should I format the output?": "Summary",
  "Which sections should I include?": "Introduction, Conclusion"
}
```

## Slack HITL Companion Node

Use `Claude Agent Slack` when you want approvals and clarifying questions routed through Slack while keeping the same strict SDK resume semantics.

### Wiring (required)

1. Trigger/Webhook -> `Claude Agent SDK`
2. `Claude Agent SDK` (Result output) -> `Claude Agent Slack`
3. `Claude Agent Slack` -> `Claude Agent SDK` (main input)
4. `Claude Agent SDK` (Result output) -> your downstream result path

Keep `Enable HITL = On` on `Claude Agent SDK` (`interactiveApprovals = pauseForApproval`).

### Slack behavior

- Approval requests: sends one Slack message with `Approve` and `Deny` URL buttons.
- Question requests: sends one Slack message with an `Answer` URL button.
- Resume links are signed and carry required HITL metadata (`requestId`, `sid`, `afps`, `fp`, `q`).
- The node emits strict `approval_response` / `question_response` envelopes on webhook callback and loops back to SDK main input.

### Outbound controls

`Claude Agent Slack` uses the same outbound text controls as WhatsApp primary HITL messaging:

- `Outbound Message Mode`: `As Is`, `Trim`, `Fallback Only`
- `Max Outbound Characters`
- `Fallback Message`

## Telegram HITL Companion Node

Use `Claude Agent Telegram` when you want approvals and clarifying questions routed through Telegram while preserving strict SDK multi-hop resume behavior.

### Wiring (required)

1. Trigger/Webhook -> `Claude Agent SDK`
2. `Claude Agent SDK` (Result output) -> `Claude Agent Telegram`
3. `Claude Agent Telegram` -> `Claude Agent SDK` (main input)
4. `Claude Agent SDK` (Result output) -> your downstream result path

Keep `Enable HITL = On` on `Claude Agent SDK` (`interactiveApprovals = pauseForApproval`).

### Telegram behavior

- Approval requests: sends one Telegram message with inline URL buttons (`Approve`, `Deny`).
- Question requests: sends one Telegram message with an inline `Answer` URL button.
- Resume links are signed and carry required HITL metadata (`requestId`, `sid`, `afps`, `fp`, `q`).
- Webhook callbacks emit strict `approval_response` / `question_response` envelopes back to SDK main input.

### Outbound controls

`Claude Agent Telegram` supports:

- `Outbound Message Mode`: `As Is`, `Trim`, `Fallback Only`
- `Max Outbound Characters`
- `Fallback Message`

### MCP Modes

This node supports two MCP modes:

| Mode | Purpose | Configuration | Backend Support |
|------|---------|---------------|-----------------|
| External MCP Servers | Connect to existing MCP servers (HTTP/SSE/stdio) | **Enable MCP Servers** + **MCP Servers** list | Local CLI + Remote HTTP |
| In-Process n8n MCP | Expose workflow-native tools from inside this node process | **N8N MCP (In-Process)** (feature-flagged) | Local CLI only |

#### External MCP Servers (existing behavior)

Use this when you already run an MCP server (for example DeepWiki, custom HTTP MCP, stdio tools):

1. Enable **Enable MCP Servers**
2. Add one or more entries in **MCP Servers**
3. Configure Type/URL/Command/Auth as needed

Tools appear as `mcp__<server_name>__<tool_name>`.

#### In-Process n8n MCP (new)

Use this when you want Claude to access n8n execution context without running a separate MCP service.

First, enable the feature flag in your n8n process environment:

```bash
CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS=true
```

Configure **N8N MCP (In-Process)**:

1. Set **Enable** = true
2. Pick a **Server Name** (default `n8n`)
3. Select tools:
   - `Get Item JSON`
   - `Get Execution Context`
   - `Log`
   - `Set Output JSON` (requires output writes enabled)
4. Optional: enable **Allow Output Writes** to allow `Set Output JSON`

By default it is off and non-mutating.

Tool details:

| Tool | What it does |
|------|--------------|
| `get_item_json` | Returns input JSON for current item |
| `get_execution_context` | Returns safe execution metadata |
| `log` | Emits log events from Claude into node output (`n8nMcpEvents`) |
| `set_output_json` | Merges/replaces final output JSON (only when output writes are enabled) |

Notes:
- In-process n8n MCP is disabled unless `CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS=true`.
- In-process n8n MCP is rejected on **Remote HTTP Execution** by design.
- If external MCP already uses the same server name, this node auto-renames the in-process server (for example `n8n_1`) and logs a warning.

#### Example: Enable In-Process n8n MCP Safely

Recommended first setup:

1. **Execution Backend**: `Local CLI`
2. **N8N MCP (In-Process)**:
   - Enable: true
   - Tools: `Get Item JSON`, `Get Execution Context`, `Log`
   - Allow Output Writes: false
3. Keep normal permissions/sandbox settings enabled

This gives Claude context visibility without allowing output mutation.

#### Example: Allow Structured Output Override

If you want Claude to set final output JSON directly:

1. Enable `Set Output JSON` in **N8N MCP (In-Process)**
2. Set **Allow Output Writes** = true
3. Claude can then call:
   - `mode: merge` to merge fields into normal result
   - `mode: replace` to replace result payload (the node still enforces `type: "task_result"`)

### Security Options

- **Path Sandboxing** - Restrict file access to specific directories
- **Content Filtering** - Block sensitive patterns (API keys, secrets, etc.)
- **Tool Permissions** - Control which tools are available
- **Audit Logging** - Log all agent actions (outputs to second node output)
- **Operator Policy Layer** - Enforce hard limits with environment variables regardless of workflow settings

### Operator Hardening (Docker/Self-Hosted)

Use operator policy env vars to enforce baseline controls globally.
These are **operator-level constraints** and are applied on top of workflow settings.

| Env var | Values | Effect |
|---------|--------|--------|
| `N8N_CLAUDE_POLICY_ALLOWED_PATHS` | Comma-separated absolute paths | Hard path allowlist for file tools. If workflow path sandbox is enabled, this is enforced as an additional restriction. If workflow path sandbox is disabled, path sandbox is enabled from this list. |
| `N8N_CLAUDE_POLICY_BLOCKED_TOOLS` | Comma-separated tool names/patterns (`*` supported) | Globally blocks matching tools before execution, including MCP tools like `mcp__github__*`. |
| `N8N_CLAUDE_POLICY_FORCE_SANDBOX` | `1|true|yes|on` | Forces SDK sandbox enabled even if workflow does not enable it. |
| `N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED` | `1|true|yes|on` | Forces `allowUnsandboxedCommands=false` even if workflow sets it. |
| `N8N_CLAUDE_POLICY_ALLOWED_ENV_VARS` | Comma-separated env var names | Restricts node allowlist mode (`Environment Security Mode = Allowlist`) by intersecting workflow allowlist and operator allowlist. |

Policy behavior:

1. Operator policy is additive and restrictive; workflow settings cannot widen it.
2. If a policy variable is unset, that specific operator constraint is not applied.
3. Path entries in `N8N_CLAUDE_POLICY_ALLOWED_PATHS` must be absolute paths.
4. Tool patterns support wildcard matching (for example: `mcp__danger__*`).

Example:

```bash
N8N_CLAUDE_POLICY_ALLOWED_PATHS=/data/projects,/tmp/claude
N8N_CLAUDE_POLICY_BLOCKED_TOOLS=Bash,mcp__danger__*
N8N_CLAUDE_POLICY_FORCE_SANDBOX=1
N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED=1
N8N_CLAUDE_POLICY_ALLOWED_ENV_VARS=NODE_ENV,LOG_LEVEL
```

See `SECURITY.md` for full hardening guidance.

## Sandbox Configuration

The Sandbox Configuration feature provides SDK-level command execution isolation. Unlike Path Sandboxing (which validates file paths in hooks), Sandbox Configuration uses the Claude Agent SDK's built-in sandbox to restrict what commands can actually do at the system level.

### When to Use Sandbox

Use Sandbox Configuration when you want to:
- Run untrusted or generated commands safely
- Prevent commands from accessing sensitive files or network resources
- Allow Claude to auto-approve bash commands because the sandbox limits their impact
- Run development servers while restricting other network access

### Sandbox Settings

Access sandbox settings via **Sandbox Configuration** > **Add Sandbox Option** > **Sandbox**.

| Setting | Description |
|---------|-------------|
| **Enable Sandbox** | Activates sandbox mode for all command execution |
| **Auto-Allow Bash When Sandboxed** | Automatically approves bash commands (safe because sandbox restricts them) |
| **Excluded Commands** | Commands that bypass the sandbox (e.g., `docker, kubectl, npm`) |
| **Allow Unsandboxed Commands** | Lets the model request to run specific commands outside the sandbox |
| **Enable Weaker Nested Sandbox** | Compatibility mode for tools that don't work with strict sandboxing |

### Network Sandbox Settings

Control network access via **Sandbox Configuration** > **Add Sandbox Option** > **Network Sandbox**.

| Setting | Description |
|---------|-------------|
| **Allow Local Binding** | Permits processes to bind to local ports (for dev servers) |
| **Allow Unix Sockets** | Comma-separated list of socket paths (e.g., `/var/run/docker.sock`) |
| **Allow All Unix Sockets** | Permits access to all Unix sockets (use with caution) |
| **HTTP Proxy Port** | Route HTTP traffic through a proxy |
| **SOCKS Proxy Port** | Route traffic through a SOCKS proxy |

### Ignore Violations Settings

Selectively ignore sandbox violations via **Sandbox Configuration** > **Add Sandbox Option** > **Ignore Violations**.

| Setting | Description |
|---------|-------------|
| **File Patterns** | Comma-separated file paths to ignore (e.g., `/tmp/*, /var/cache/*`) |
| **Network Patterns** | Comma-separated network patterns to ignore (e.g., `localhost:*, 127.0.0.1:8080`) |

### Example: Secure Build Environment

For running build commands safely:

1. Enable **Sandbox** with **Auto-Allow Bash When Sandboxed** = true
2. Set **Excluded Commands** = `docker, npm, yarn` (these need real system access)
3. Enable **Network Sandbox** > **Allow Local Binding** = true (for dev servers)

### Example: Restricted Research Agent

For an agent that should only read and analyze code:

1. Enable **Sandbox**
2. Leave **Auto-Allow Bash When Sandboxed** = false (manual approval still required)
3. Set **Excluded Commands** = empty (nothing bypasses sandbox)
4. Leave **Allow Unsandboxed Commands** = false (model cannot escape sandbox)

### Sandbox vs Path Sandboxing

| Feature | Sandbox Configuration | Path Sandboxing |
|---------|----------------------|-----------------|
| **Level** | SDK/OS level isolation | Hook-based validation |
| **Scope** | All command execution | File operation tools only |
| **When checked** | Before command runs | Before tool is invoked |
| **Network control** | Yes | No |
| **Use case** | Isolate untrusted commands | Restrict file access patterns |

**Recommendation:** Use both together for defense in depth. Sandbox Configuration provides system-level isolation while Path Sandboxing adds an additional validation layer for file operations.

## Path Sandboxing

Path Sandboxing restricts file system access to specific directories using PreToolUse hooks. Unlike the SDK's default sandbox (which only restricts writes), this feature can restrict **both read and write access** to a defined sandbox directory.

### Why Path Sandboxing?

By default, the Claude Agent SDK sandbox allows:

| Access Type | Default Behavior |
|-------------|------------------|
| Write | Restricted to CWD only |
| Read | Entire filesystem |

This is intentional—agents often need to read dependencies, system configs, etc. However, for security-sensitive workflows, you may want to restrict reads as well.

### Path Sandboxing Settings

Access via **Security Options** > **Add Security Option** > **Path Sandboxing**.

| Setting | Description |
|---------|-------------|
| **Enable** | Activates path sandboxing |
| **Sandbox Base Path** | The root directory for all file operations (typically your CWD) |
| **Affected Tools** | Which tools are restricted: Read, Write, Edit, Glob, Grep |
| **Additional Allowed Paths** | Comma-separated paths allowed outside the sandbox |

### Restricting Read Access to CWD

To restrict reads to only the working directory:

1. Enable **Path Sandboxing**
2. Set **Sandbox Base Path** to your working directory (e.g., `/projects/myapp`)
3. Keep **Affected Tools** at default: `Read, Write, Edit, Glob, Grep`
4. Optionally add **Additional Allowed Paths** for dependencies (e.g., `/usr/local/lib`)

Any read attempt outside the sandbox will be blocked with a clear error message:
```
Path "/etc/passwd" (resolved: /etc/passwd) is outside the allowed sandbox.
Allowed: /projects/myapp
```

### How It Works

Path Sandboxing uses the SDK's PreToolUse hook mechanism (Option 1 from the Claude Agent SDK documentation). For each file operation tool, it:

1. Extracts paths from tool input (`file_path`, `path`, `pattern`)
2. Resolves relative paths against CWD
3. Sanitizes paths (handles URL encoding, null bytes, traversal attempts)
4. Validates the resolved path is within the sandbox
5. Blocks the tool with a clear error if validation fails

### Example: Secure Code Analysis

For an agent that should only analyze a specific project:

1. Set **Working Directory** = `/projects/myapp`
2. Enable **Path Sandboxing**
3. Set **Sandbox Base Path** = `/projects/myapp`
4. Set **Affected Tools** = `Read, Glob, Grep` (read-only restriction)

The agent can read files within the project but cannot access `/etc/passwd`, `~/.ssh/`, or any path outside the project.

### Example: Build Environment with Dependencies

For a build agent that needs access to system libraries:

1. Set **Working Directory** = `/projects/myapp`
2. Enable **Path Sandboxing**
3. Set **Sandbox Base Path** = `/projects/myapp`
4. Set **Additional Allowed Paths** = `/usr/local/lib,/usr/include,/tmp`
5. Set **Affected Tools** = `Read, Write, Edit, Glob, Grep`

The agent can read/write within the project and read from system library paths.

## Development

```bash
# Install dependencies
pnpm install

# Start n8n with hot reload
pnpm dev

# Build for production
pnpm run build

# Run tests
pnpm test

# Lint
pnpm run lint
pnpm run lint:fix
```

## License

MIT
