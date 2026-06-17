# Secure Environment Variables

Use the `Secure Environment Variables` credential when a `Claude Agent SDK` `executeTask` run needs secrets such as API keys, bearer tokens, or internal service credentials.

This feature keeps secret values out of node parameters. Values are encrypted at rest by n8n and decrypted only during execution.

## What It Applies To

- Applies to live `executeTask` runs.
- Injects variables into the Claude subprocess environment.
- Resolves `${VAR}` placeholders in direct HTTP/SSE MCP server headers — but only against the restricted **exposable** set described in [Merge Order And Precedence](#merge-order-and-precedence), never the full host environment.
- Scripts, commands, and tools launched by Claude can read them as normal process environment variables.
- Does not embed secrets into `Generate Python SDK Script` output. If you run the generated Python file outside n8n, export the variables separately in that runtime.

## When To Use It

Use `Secure Environment Variables` for secrets:

- `OPENAI_API_KEY`
- `GITHUB_TOKEN`
- `SLACK_BOT_TOKEN`
- internal API bearer tokens

Use `Additional Options -> Environment Variables (JSON)` for non-secret values and checked-in defaults.

## Setup

1. Open the `Claude Agent SDK` node.
2. Under `Additional Options`, enable `Inject Secure Environment Variables`.
3. Create or select the `Secure Environment Variables` credential.
4. Add one or more `Name` / `Value` entries.
5. Run the node with `executeTask`.

Example credential entries:

| Name | Value |
|------|-------|
| `OPENAI_API_KEY` | `sk-...` |
| `GITHUB_TOKEN` | `ghp_...` |
| `INTERNAL_API_URL` | `https://internal.example.com` |

## Using Variables In Scripts

Any script or command run by the agent can read the variables normally.

### Bash

```bash
echo "$OPENAI_API_KEY"
curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user
```

### JavaScript / Node.js

```javascript
console.log(process.env.OPENAI_API_KEY);
```

### Python

```python
import os

print(os.environ["OPENAI_API_KEY"])
```

## Merge Order And Precedence

For live `executeTask` runs, the Claude subprocess environment is merged in this order:

1. Essential system variables such as `PATH`, `HOME`, `SHELL`, and `CLAUDE_CONFIG_DIR`
2. Provider variables, proxy variables, and `Environment Variables (JSON)`
3. `Secure Environment Variables`

If the same variable name appears in both `Environment Variables (JSON)` and the secure credential, the secure credential wins.

### What `${VAR}` In MCP Headers Resolves Against

Resolving `${VAR}` placeholders in custom HTTP/SSE MCP server headers does **not** use the full host process environment. A workflow author could otherwise point an MCP server at an arbitrary host and exfiltrate host secrets (for example `${N8N_ENCRYPTION_KEY}` or a database password) simply by naming them in a header template.

Only the **exposable** set may resolve in a header. This is the same vetted set the Claude subprocess receives, namely:

- Provider variables (for example `ANTHROPIC_BASE_URL`) read from the host environment by name
- Proxy variables (for example `HTTPS_PROXY`, `SSL_CERT_FILE`) read from the host environment by name
- `Secure Environment Variables` injected via the credential

Put any custom secret a header needs (bearer tokens, internal API keys, tenant IDs) into the `Secure Environment Variables` credential — that is the supported way to make `${VAR}` resolve in a header. Names that are only present in the raw host environment (and are not provider or proxy variables) are intentionally not reachable from headers.

Dangerous variable names (see [Validation And Safety Rules](#validation-and-safety-rules)) are stripped from this set even if injected. If the same name appears in both the host environment and `Secure Environment Variables`, the secure credential value wins.

Any `${VAR}` whose name is **not** in the exposable set is left unsubstituted — the literal token `${VAR}` is sent in the header, and the real host value is never read. This means arbitrary host environment variables (encryption keys, database credentials, unrelated cloud secrets) can never be reached through MCP headers.

Example MCP headers JSON:

```json
{
  "Authorization": "Bearer ${INTERNAL_API_TOKEN}",
  "X-Tenant": "${TENANT_ID}"
}
```

For this to resolve, define `INTERNAL_API_TOKEN` and `TENANT_ID` in the `Secure Environment Variables` credential. If a name is not in the exposable set, its `${...}` token is sent verbatim instead.

## Allowlist Mode

If `Additional Options -> Environment Security Mode` is set to `Allowlist (strict)`, custom variable names must also be added to `Allowlisted Environment Variables`.

Example:

- `Inject Secure Environment Variables = true`
- secure credential contains `OPENAI_API_KEY`
- `Environment Security Mode = Allowlist (strict)`

Then `Allowlisted Environment Variables` must include `OPENAI_API_KEY`, or the variable will be filtered out before execution.

## Validation And Safety Rules

Variable names must match:

```text
^[A-Za-z_][A-Za-z0-9_]*$
```

Examples of invalid names:

- `my-key`
- `123TOKEN`
- `API KEY`

Dangerous process-level variables are blocked even if supplied in the secure credential or JSON env fields. Examples include:

- `LD_PRELOAD`
- `LD_LIBRARY_PATH`
- `DYLD_INSERT_LIBRARIES`
- `NODE_OPTIONS`
- `NODE_PATH`

## Redaction Behavior

Injected secret values are redacted from:

- node outputs
- captured stderr
- audit log payloads
- streaming payloads produced by the node

This redaction protects node-level outputs. It is not a separate permission layer. Anything the agent executes can still read the plaintext value from the process environment.

## Troubleshooting

### Variable Is Missing In The Script

Check the following:

1. `Inject Secure Environment Variables` is enabled.
2. The `Secure Environment Variables` credential is selected on the node.
3. The variable name is valid.
4. If `Allowlist (strict)` is enabled, the name is included in `Allowlisted Environment Variables`.
5. You are using `executeTask`, not `Generate Python SDK Script`.

### Invalid Variable Name Error

Rename the variable so it uses only letters, numbers, and underscores, and does not start with a number.

### Generated Python Script Does Not See The Secret

This is expected. The generated script does not include secure credential values. Export the variables in the shell or runtime environment where you execute the generated Python file.
