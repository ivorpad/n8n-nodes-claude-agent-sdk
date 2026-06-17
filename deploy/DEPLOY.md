# Build and Deploy Contract

Release and deploy are now pull-first and immutable-ref-first.

## Images

```text
ghcr.io/<owner>/n8n-claude-sdk
ghcr.io/<owner>/n8n-claude-sdk-base
ghcr.io/<owner>/n8n-claude-sdk-runners
ghcr.io/<owner>/n8n-claude-sdk-code-server
```

`n8n` and `n8n-worker` always share the same `n8n-claude-sdk` image ref.

## Release Contract

1. Package SDK outside Docker (`pnpm pack`), then install tarball in `deploy/Dockerfile`.
2. Build with `deploy/docker-bake.hcl` so cache topology is identical in local and CI.
3. Use registry cache by default (`mode=max`, `compression=zstd`, branch + `main` import).
4. Publish immutable tags (or digests). Use `latest` only as an optional alias.
5. Deploy by `N8N_IMAGE_REF`, `RUNNERS_IMAGE_REF`, `CODE_SERVER_IMAGE_REF` in `.env`.

## Prerequisites

- Docker Buildx with a persistent `docker-container` builder
- GHCR login (`read:packages` + `write:packages`)

## One-Time Local Builder Setup

```bash
docker buildx create --name n8n-publisher --driver docker-container --use
docker buildx inspect --bootstrap
```

## Local Publish (Manual/Emergency Path)

From repo root:

```bash
set -euo pipefail

export REGISTRY=ghcr.io/<owner>
export PLATFORM=linux/arm64
export PLATFORM_KEY=arm64
export CACHE_SCOPE="$(git rev-parse --abbrev-ref HEAD | tr '/:@' '-')"
export MAIN_CACHE_SCOPE=main

export RELEASE_TAG=v0.2.16
export BASE_TAG=2026-03-06
export RUNNERS_TAG="${RELEASE_TAG}"
export CODE_SERVER_TAG="${RELEASE_TAG}"
export BASE_IMAGE_REF="${REGISTRY}/n8n-claude-sdk-base:${BASE_TAG}"

mkdir -p .docker/sdk
SDK_TARBALL="$(pnpm pack --pack-destination .docker/sdk)"
mv ".docker/sdk/${SDK_TARBALL}" ".docker/sdk/n8n-nodes-claude-agent-sdk.tgz"
```

Guided release helper (bumps package version, tags, optional push + optional workflow dispatch):

```bash
pnpm run release:publish
```

Publish base image (infrequent):

```bash
docker buildx bake --file deploy/docker-bake.hcl publish-base
```

Publish release image:

```bash
docker buildx bake --file deploy/docker-bake.hcl publish-release
```

Publish support images (no server-side build):

```bash
docker buildx bake --file deploy/docker-bake.hcl publish-support
```

Optional `latest` alias (release tags only):

```bash
docker buildx imagetools create \
  --tag ghcr.io/<owner>/n8n-claude-sdk:latest \
  ghcr.io/<owner>/n8n-claude-sdk:${RELEASE_TAG}
```

## CI Publish Path (Source of Truth)

Workflow: `.github/workflows/publish-images.yml`

- Uses `GITHUB_TOKEN` for GHCR auth
- Packs SDK tarball before release image build
- Uses the same Bake file and cache contract as local
- Cancels superseded runs with workflow `concurrency`
- `workflow_dispatch` asks version inputs (`release_tag`, optional `base_tag`, and base runtime versions) so you can explicitly publish a new n8n/SDK image version

## Deploy a Published Image

Set immutable image refs in your stack `.env`:

```bash
N8N_IMAGE_REF=ghcr.io/<owner>/n8n-claude-sdk:v0.2.22
RUNNERS_IMAGE_REF=ghcr.io/<owner>/n8n-claude-sdk-runners:v0.2.22
CODE_SERVER_IMAGE_REF=ghcr.io/<owner>/n8n-claude-sdk-code-server:v0.2.22
```

Pull and start (no `--build`):

```bash
cd /path/to/n8n-stack
docker compose pull
docker compose up -d
docker compose ps
```

## Digest Rollout

To pin by digest after publish:

```bash
docker buildx imagetools inspect ghcr.io/<owner>/n8n-claude-sdk:v0.2.22
```

Copy `sha256:...` and set `.env` as:

```bash
N8N_IMAGE_REF=ghcr.io/<owner>/n8n-claude-sdk@sha256:<digest>
```
