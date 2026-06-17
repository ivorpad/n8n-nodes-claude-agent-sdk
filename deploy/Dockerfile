# syntax=docker/dockerfile:1.7
# Thin release image: reuse heavy base layers, add only custom SDK package.
ARG BASE_IMAGE=ghcr.io/example-owner/n8n-claude-sdk-base:2026-03-06
FROM ${BASE_IMAGE}

ARG SDK_TARBALL_NAME=n8n-nodes-claude-agent-sdk.tgz
ARG CLAUDE_CODE_VERSION=2.1.175

# Claude Code 2.1.100+ requires bubblewrap + socat for its sandbox
RUN apk add --no-cache bubblewrap socat

# Upgrade claude-code on top of the base image without rebuilding it
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && \
    npm cache clean --force && \
    rm -rf /root/.npm && \
    claude --version

# Template engine (handlebars) + TypeScript runner (tsx) for workflow scripts
RUN npm install -g handlebars@^4.7.8 tsx@^4.19.0 && \
    npm cache clean --force && \
    rm -rf /root/.npm

WORKDIR /opt/n8n-custom-nodes

# sdk_tarball is a named Buildx context that contains the packed SDK artifact.
COPY --from=sdk_tarball /${SDK_TARBALL_NAME} /tmp/${SDK_TARBALL_NAME}
RUN npm install "/tmp/${SDK_TARBALL_NAME}" && \
    npm cache clean --force && \
    rm -rf /root/.npm "/tmp/${SDK_TARBALL_NAME}" && \
    # Rename pkce-challenge's *.node.js files so n8n's loader doesn't pick them up
    for f in node_modules/pkce-challenge/dist/index.node.*; do \
      [ -f "$f" ] && mv "$f" "${f//index.node/index.main}" || true; \
    done && \
    sed -i 's/index\.node/index.main/g' node_modules/pkce-challenge/package.json 2>/dev/null || true

WORKDIR /home/claude-user
