# Providers And Credentials

The `Claude Agent SDK` node has a top-level **Authentication** field. Current
local-CLI provider choices are:

- **Anthropic API**
- **OpenRouter API**
- **Alibaba Coding Plan API**
- **Ollama (Local)**

The **Additional Options** -> **API Provider** field remains available for
advanced Anthropic-compatible endpoint overrides. Credential-backed
authentication choices take precedence over that provider selector.

## Anthropic API Or Claude Code CLI Subscription

Choose **Authentication** = **Anthropic API** and create a
`Claude Agent SDK Anthropic API` credential.

Credential options:

- **API Key**: stores an Anthropic API key and sends it as `ANTHROPIC_API_KEY`.
- **Claude Code CLI (Subscription)**: stores the absolute path to the `claude`
  executable and relies on an existing `claude login` session in the n8n
  runtime.

Use the CLI-subscription option only when the n8n process can read the mounted
Claude config directory and run the configured executable.

## OpenRouter

Choose **Authentication** = **OpenRouter API** and create a
`Claude Agent SDK OpenRouter API` credential.

Runtime behavior:

- Sets `ANTHROPIC_BASE_URL` to the OpenRouter API base.
- Sets `ANTHROPIC_AUTH_TOKEN` from the OpenRouter credential.
- Clears `ANTHROPIC_API_KEY`, because OpenRouter expects auth through the auth
  token path.
- Shows Sonnet, Opus, and Haiku model-tier selectors that load tool-supporting
  models from OpenRouter.

Optional OpenRouter headers can be passed through **Additional Options** ->
**Environment Variables (JSON)**:

```json
{
  "HTTP_REFERER": "https://your-app.example",
  "X_TITLE": "Your App Name"
}
```

Use non-secret values in JSON env. Put tokens and private values in
`Secure Environment Variables`.

## Alibaba Coding Plan

Choose **Authentication** = **Alibaba Coding Plan API** and create an
`Alibaba Coding Plan API` credential.

Runtime behavior:

- Uses the credential base URL, defaulting to the Alibaba Coding Plan Anthropic
  compatible endpoint.
- Sets `ANTHROPIC_AUTH_TOKEN` from the credential.
- Clears `ANTHROPIC_API_KEY`.
- Provides Sonnet, Opus, and Haiku tier selectors for supported Alibaba models.
- Sets safe thinking defaults for Alibaba. Explicit thinking budgets are
  clamped to the supported range before invoking Claude Code.

## Ollama

Choose **Authentication** = **Ollama (Local)**. No n8n credential is required.

Configure:

- **Additional Options** -> **API Provider** = `Ollama (Local)` when needed for
  explicit provider selection.
- **Additional Options** -> **Ollama Base URL** when the default
  Ollama host/port is not reachable from the n8n runtime.
- The top-level Ollama **Model** selector, loaded from the Ollama `/api/tags`
  endpoint.

Docker networking guidance:

```text
Ollama on host machine: http://<host-reachable-name>:11434
Ollama in Compose service: http://<compose-service-name>:11434
```

Use an Ollama version and model endpoint that provide Anthropic-compatible
behavior for the Claude Code/Agent SDK path. Local models may not support every
tool-use pattern that Claude supports.

## Custom Anthropic-Compatible Endpoint

For a custom gateway, choose **Authentication** = **Anthropic API**, then set:

1. **Additional Options** -> **API Provider** = `Custom Endpoint`.
2. **Additional Options** -> **Custom API Endpoint** to your endpoint URL.
3. `Claude Agent SDK Anthropic API` credentials for the key used by that
   gateway.

The node sets `ANTHROPIC_BASE_URL` to the custom endpoint and also exposes the
API key as `ANTHROPIC_AUTH_TOKEN` for gateways that expect that name.

## Environment Variables

Use **Additional Options** -> **Environment Variables (JSON)** for non-secret
values:

```json
{
  "NODE_ENV": "production",
  "LOG_LEVEL": "info"
}
```

The environment is assembled in this order:

1. Essential runtime variables such as `PATH`, `HOME`, `SHELL`, and
   `CLAUDE_CONFIG_DIR`.
2. Provider, proxy, and JSON environment values.
3. `Secure Environment Variables` credential values.

If the same name appears in JSON env and secure env, the secure credential wins.

Dangerous process-level variables such as `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`,
`NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, and similar startup hooks are blocked.

## Secure Environment Variables

Use **Additional Options** -> **Inject Secure Environment Variables** when
Claude needs secrets at runtime but those values should not live in node
parameters.

Setup:

1. Enable **Inject Secure Environment Variables**.
2. Create/select a `Secure Environment Variables` credential.
3. Add `Name` / `Value` pairs such as `OPENAI_API_KEY`, `GITHUB_TOKEN`, or
   `SLACK_BOT_TOKEN`.
4. If **Environment Security Mode** is `Allowlist (Strict)`, add those variable
   names to **Allowlisted Environment Variables**.

Variable names must match:

```text
^[A-Za-z_][A-Za-z0-9_]*$
```

Injected values are available to commands and scripts run by Claude:

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

Generated Python SDK scripts do not embed secure credential values. Export those
variables in the environment where you run the generated script.

## MCP Header Placeholders

HTTP/SSE MCP server headers can use `${VAR}` placeholders. The node resolves
those placeholders only from the same restricted exposable environment used for
the Claude subprocess:

- provider variables,
- proxy variables,
- secure env credential values,
- explicitly allowlisted names in allowlist mode.

It does not resolve arbitrary host environment variables. If a header needs a
secret, put it in the `Secure Environment Variables` credential.

Example:

```json
{
  "Authorization": "Bearer ${INTERNAL_API_TOKEN}"
}
```

## Proxy Manager

Proxy Manager is visible when sandboxing is enabled. It is intentionally blocked
when sandboxing is not active.

Use it when Claude egress must pass through a proxy:

1. Enable **Sandbox**.
2. Enable **Additional Options** -> **Enable Proxy Manager**.
3. Set **Proxy HTTP URL** and/or **Proxy HTTPS URL**.
4. Set **Proxy CA Bundle Path** if TLS interception requires a custom CA.
5. Set **Proxy No-Proxy List** for domains that bypass the proxy.

Proxy settings inject standard variables such as `HTTP_PROXY`, `HTTPS_PROXY`,
`NO_PROXY`, `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`,
`REQUESTS_CA_BUNDLE`, and `GIT_SSL_CAINFO`.

Do not put proxy credentials inline in proxy URLs. Store proxy tokens in secure
credentials or external proxy configuration.
