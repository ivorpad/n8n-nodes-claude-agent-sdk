/**
 * Environment containment for user-configured command hooks.
 *
 * A "command" hook runs an arbitrary shell command (configured per node) with
 * the hook event JSON on stdin. `child_process.spawn(cmd, { shell: true })`
 * with no `env` lets that command — and anything it shells out to — inherit the
 * ENTIRE n8n host environment: the n8n encryption key (`N8N_ENCRYPTION_KEY`),
 * database password (`DB_POSTGRESDB_PASSWORD`), provider API keys
 * (`ANTHROPIC_API_KEY`), webhook tunnel URLs, etc. A single `env > /tmp/x` (or
 * an exfil one-liner) in a hook command would then leak every secret n8n holds.
 *
 * We forward only a minimal allowlist of vars a normal CLI tool needs to run,
 * explicitly drop loader/code-injection vars, and additionally pass through any
 * operator-defined `CLAUDE_HOOK_*` vars so legitimate hooks can receive
 * configuration without widening the allowlist to secrets. Mirrors the
 * containment used for spawned skill subprocesses (see skillToolsMcp.ts).
 */

/** Prefix for operator-defined vars intentionally exposed to command hooks. */
export const HOOK_ENV_PASSTHROUGH_PREFIX = 'CLAUDE_HOOK_';

const HOOK_ENV_ALLOWLIST = [
	'PATH',
	'HOME',
	'SHELL',
	'USER',
	'LOGNAME',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TERM',
	'TMPDIR',
	'TMP',
	'TEMP',
	// Windows essentials so cmd/python/node can resolve at all.
	'SYSTEMROOT',
	'PATHEXT',
	'COMSPEC',
];

/**
 * Loader-hijack / code-injection vars that must never reach the subprocess even
 * if allowlisted or `CLAUDE_HOOK_`-prefixed. Kept local to avoid importing
 * provider config wiring into the hooks module.
 */
const HOOK_DANGEROUS_ENV = new Set<string>([
	'LD_PRELOAD',
	'LD_LIBRARY_PATH',
	'DYLD_INSERT_LIBRARIES',
	'DYLD_FORCE_FLAT_NAMESPACE',
	'NODE_OPTIONS',
	'NODE_PATH',
	'BASH_ENV',
	'ENV',
	'PROMPT_COMMAND',
	'PYTHONSTARTUP',
	'PYTHONPATH',
	'PERL5OPT',
	'RUBYOPT',
	'GIT_SSH',
	'GIT_SSH_COMMAND',
]);

/**
 * Build the filtered environment for a spawned command hook. Only allowlisted,
 * non-dangerous host vars plus operator-defined `CLAUDE_HOOK_*` vars are
 * forwarded — the host's secrets are never inherited.
 */
export function buildHookCommandEnv(hostEnv: NodeJS.ProcessEnv): Record<string, string> {
	const env: Record<string, string> = {};

	for (const name of HOOK_ENV_ALLOWLIST) {
		if (HOOK_DANGEROUS_ENV.has(name)) continue;
		const value = hostEnv[name];
		if (typeof value === 'string') {
			env[name] = value;
		}
	}

	for (const [name, value] of Object.entries(hostEnv)) {
		if (!name.startsWith(HOOK_ENV_PASSTHROUGH_PREFIX)) continue;
		if (HOOK_DANGEROUS_ENV.has(name)) continue;
		if (typeof value === 'string') {
			env[name] = value;
		}
	}

	return env;
}
