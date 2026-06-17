# Unified n8n image (main + worker)
# Matches the self-hosted docker-compose.yml expectations (claude-user, entrypoint, etc.)
FROM node:22-alpine

# Install required packages
RUN apk add --no-cache \
    bash \
    curl \
    git \
    python3 \
    make \
    g++ \
    procps \
    sudo \
    shadow \
    tini \
    unzip \
    su-exec

# node user already exists in official image (uid 1000)
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node/.n8n

# Install n8n globally (latest)
RUN npm install -g n8n

ENV SHELL=/bin/bash
ENV N8N_USER_FOLDER=/home/claude-user/.n8n

# Set up npm global directory
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

RUN mkdir -p /usr/local/share/npm-global && \
    chmod -R 755 /usr/local/share/npm-global

# Install Claude Code CLI globally (latest)
RUN npm install -g @anthropic-ai/claude-code

# Install puppeteer-core for CDP browser automation (no bundled Chromium)
RUN npm install -g puppeteer-core

# Verify Claude installation
RUN which claude && claude --version

# Create non-root user for Claude CLI (bypasses --dangerously-skip-permissions root check)
# UID 1000 is taken by 'node' user, so use 1001
RUN adduser -D -u 1001 claude-user && \
    mkdir -p /home/claude-user/.claude && \
    mkdir -p /home/claude-user/.n8n && \
    chown -R claude-user:claude-user /home/claude-user

# Make /root readable so Claude can scan filesystem without permission errors
RUN chmod 755 /root

# Wrapper script for when n8n runs as root (user: 0:0)
RUN echo '#!/bin/bash' > /usr/local/bin/claude-wrapper && \
    echo 'mkdir -p /home/claude-user/.claude' >> /usr/local/bin/claude-wrapper && \
    echo 'cp -r /root/.claude/. /home/claude-user/.claude/ 2>/dev/null || true' >> /usr/local/bin/claude-wrapper && \
    echo 'chown -R claude-user:claude-user /home/claude-user/.claude 2>/dev/null || true' >> /usr/local/bin/claude-wrapper && \
    echo 'chmod -R 755 /home/claude-user/.claude 2>/dev/null || true' >> /usr/local/bin/claude-wrapper && \
    echo 'exec su -s /bin/bash claude-user -c "HOME=/home/claude-user CLAUDE_CONFIG_DIR=/home/claude-user/.claude /usr/local/share/npm-global/bin/claude $*"' >> /usr/local/bin/claude-wrapper && \
    chmod +x /usr/local/bin/claude-wrapper && \
    chmod u+s /bin/su

# Simple wrapper for when n8n runs as claude-user (user: 1001:1001) - RECOMMENDED
RUN echo '#!/bin/bash' > /usr/local/bin/claude-simple && \
    echo 'export HOME=/home/claude-user' >> /usr/local/bin/claude-simple && \
    echo 'export CLAUDE_CONFIG_DIR=/home/claude-user/.claude' >> /usr/local/bin/claude-simple && \
    echo 'exec /usr/local/share/npm-global/bin/claude "$@"' >> /usr/local/bin/claude-simple && \
    chmod +x /usr/local/bin/claude-simple

# Create custom nodes directory
WORKDIR /opt/n8n-custom-nodes
RUN npm init -y && \
    chown -R claude-user:claude-user /opt/n8n-custom-nodes

# Install SDK from pre-packed tarball (no GITHUB_TOKEN needed)
COPY n8n-nodes-claude-agent-sdk-*.tgz /tmp/
RUN npm install /tmp/n8n-nodes-claude-agent-sdk-*.tgz && \
    rm -f /tmp/n8n-nodes-claude-agent-sdk-*.tgz

WORKDIR /home/claude-user

# Entrypoint wrapper: fix volume ownership and init .claude directory
RUN printf '#!/bin/bash\nset -e\n\
# Fix volume ownership (Docker named volumes mount as root)\n\
chown -R claude-user:claude-user /home/claude-user/.claude 2>/dev/null || true\n\
chown -R claude-user:claude-user /home/claude-user/.n8n 2>/dev/null || true\n\
chown -R claude-user:claude-user /home/claude-user/projects 2>/dev/null || true\n\
\n\
# Init .claude structure\n\
su-exec claude-user mkdir -p /home/claude-user/.claude/debug\n\
[ -f /home/claude-user/.claude/remote-settings.json ] || su-exec claude-user sh -c '\''echo "{}" > /home/claude-user/.claude/remote-settings.json'\''\n\
\n\
# Persist .claude.json inside the volume (survives container recreate)\n\
if [ ! -f /home/claude-user/.claude/.claude.json ]; then\n\
  su-exec claude-user sh -c '\''echo "{}" > /home/claude-user/.claude/.claude.json'\''\n\
fi\n\
ln -sf /home/claude-user/.claude/.claude.json /home/claude-user/.claude.json\n\
chown -h claude-user:claude-user /home/claude-user/.claude.json\n\
\n\
# Drop to claude-user preserving all env vars (PATH, NPM_CONFIG_PREFIX, etc.)\n\
exec su-exec claude-user "$@"\n' > /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 5678
ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh", "n8n"]
