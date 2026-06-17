# Secret Incident Response

Use this checklist when a credential, token, API key, local config file, or other secret reaches git history, logs, workflow exports, screenshots, or issue/PR text.

## Immediate Response

1. Stop using the leaked value. Do not paste it into chat, logs, issues, PRs, or commit messages.
2. Rotate or revoke the credential at its source. This is the blocking fix; removing the file from `HEAD` is not enough.
3. Verify the old credential is invalidated without printing it. Use prefix/metadata checks only, for example `printenv VAR_NAME | head -c 5`.
4. Update every legitimate client to use the new value.
5. Record where the new value lives, who rotated it, and when the old value was invalidated.

For an n8n MCP access token, follow the token rotation procedure in [`docs/reference/n8n-mcp-server.md`](../reference/n8n-mcp-server.md#rotating-your-token). n8n revokes the previous token when a new one is generated.

## Repository Cleanup

1. Remove the secret from the current tree with `git rm --cached <path>` when the local file must remain on disk, or delete the file when it should not exist locally.
2. Add an ignore rule that blocks the same class of local secret/config file from being staged again.
3. Search tracked files for the credential shape or identifier before shipping the fix.
4. Decide whether history rewrite is required. History rewrite is disruptive, but it may be necessary for shared or public repositories.

History rewrite does not replace rotation. A clone, fork, cache, CI artifact, or local object database may still contain the old value after a force-push.

## History Rewrite Checklist

If the leaked value must be removed from reachable history:

1. Freeze pushes to the affected branch.
2. Rotate the credential first.
3. Rewrite history with a tool such as `git filter-repo`.
4. Force-push the cleaned refs.
5. Coordinate with collaborators so stale clones are recloned or cleaned.
6. Delete stale tags, branches, artifacts, and CI caches that still reference the old objects.
7. Ask the hosting provider to invalidate cached objects when the repo is hosted on GitHub, GitLab, or a similar service.
8. Re-run secret scanning after the rewrite.

## Local Config Files

Project-level local config belongs outside tracked source unless explicitly reviewed. This repo ignores local agent runtime/config directories such as `.codex/`, `.claude/`, and `.agents/`.

Prefer global user config such as `~/.codex/config.toml` for machine-specific Codex settings. If a repo-local config file is unavoidable, keep it untracked and verify with `git status --short` before committing.
