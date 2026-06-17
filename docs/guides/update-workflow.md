# Updating Workflows via n8n REST API

Update workflows containing custom/community node types (`CUSTOM.*`) via the public REST API.

## The Problem

The public `PUT /api/v1/workflows/{id}` endpoint passes `publishIfActive: true` internally. When the workflow is **active**, this triggers node-type validation which fails for `CUSTOM.*` nodes with:

```
"Unrecognized node type: CUSTOM.claudeAgentSdk"
```

The node IS loaded at runtime — the validation just runs before the custom loader is consulted during re-activation.

## Solution: Deactivate → Update → Re-activate

Three-step approach using the public API:

```bash
export $(grep N8N_REST_API_KEY .env | xargs)
WF_ID="your-workflow-id"

# 1. Deactivate (skips node validation)
curl -s -X POST "http://localhost:5678/api/v1/workflows/$WF_ID/deactivate" \
  -H "X-N8N-API-KEY: $N8N_REST_API_KEY"

# 2. Update (succeeds because workflow is inactive)
curl -s -X PUT "http://localhost:5678/api/v1/workflows/$WF_ID" \
  -H "X-N8N-API-KEY: $N8N_REST_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflow-payload.json

# 3. Re-activate
curl -s -X POST "http://localhost:5678/api/v1/workflows/$WF_ID/activate" \
  -H "X-N8N-API-KEY: $N8N_REST_API_KEY"
```

## Payload Format

The PUT body accepts these top-level keys:

```json
{
  "name": "Workflow Name",
  "nodes": [...],
  "connections": {...},
  "settings": { "executionOrder": "v1" }
}
```

**Excluded fields** (will cause errors):
- `active` — read-only, use activate/deactivate endpoints
- `id`, `createdAt`, `updatedAt`, `versionId` — managed by n8n
- `sharedWithProjects`, `homeProject`, `usedCredentials` — managed by n8n
- `staticData` — stripped to avoid validation errors
- Extra `settings` keys like `availableInMCP`, `binaryMode` — cause "must NOT have additional properties"

## Node Type Formats

| Loading method | `node.type` in JSON |
|---|---|
| `n8n-node dev` (local dev) | `CUSTOM.claudeAgentSdk` |
| npm install (community package) | `n8n-nodes-claude-agent-sdk.claudeAgentSdk` |

## Fetching Current Workflow

```bash
curl -s "http://localhost:5678/api/v1/workflows/$WF_ID" \
  -H "X-N8N-API-KEY: $N8N_REST_API_KEY" > workflow.json
```

Then strip disallowed fields before PUT:

```python
import json

with open('workflow.json') as f:
    wf = json.load(f)

clean = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
    'settings': {'executionOrder': 'v1'},
}

with open('workflow-payload.json', 'w') as f:
    json.dump(clean, f)
```

## Alternative: Internal PATCH Endpoint

The internal `PATCH /rest/workflows/{id}` endpoint does NOT trigger re-activation, but requires cookie auth (not API key). Useful if you have a browser session cookie.
