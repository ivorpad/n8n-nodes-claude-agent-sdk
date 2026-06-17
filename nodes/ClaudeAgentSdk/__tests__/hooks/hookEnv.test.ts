/**
 * Security regression: command-hook subprocess environment containment.
 *
 * A "command" hook runs an arbitrary shell command via spawn(cmd, {shell:true}).
 * With no explicit `env`, the child inherited the FULL n8n process environment —
 * the encryption key that decrypts every stored credential, the DB password and
 * every provider API key. buildHookCommandEnv forwards only an allowlist plus
 * opt-in CLAUDE_HOOK_* vars; secrets must never cross the boundary.
 */

import { describe, it, expect } from 'vitest';

import { buildHookCommandEnv, HOOK_ENV_PASSTHROUGH_PREFIX } from '../../hooks/hookEnv';

const SECRETS = {
	N8N_ENCRYPTION_KEY: 'super-secret-master-key',
	DB_POSTGRESDB_PASSWORD: 'pg-password',
	ANTHROPIC_API_KEY: 'sk-ant-leak',
	N8N_WEBHOOK_URL: 'https://internal.tunnel',
	AWS_SECRET_ACCESS_KEY: 'aws-leak',
};

const DANGEROUS = {
	LD_PRELOAD: '/tmp/evil.so',
	NODE_OPTIONS: '--require /tmp/evil.js',
	PYTHONPATH: '/tmp/evil',
	BASH_ENV: '/tmp/evil.sh',
	GIT_SSH_COMMAND: 'ssh -o ProxyCommand=evil',
};

describe('buildHookCommandEnv', () => {
	it('forwards allowlisted host vars a normal CLI needs', () => {
		const env = buildHookCommandEnv({ PATH: '/usr/bin', HOME: '/home/node', LANG: 'en_US.UTF-8' });
		expect(env.PATH).toBe('/usr/bin');
		expect(env.HOME).toBe('/home/node');
		expect(env.LANG).toBe('en_US.UTF-8');
	});

	it('NEVER forwards n8n secrets to the hook subprocess', () => {
		const env = buildHookCommandEnv({ PATH: '/usr/bin', ...SECRETS });
		for (const key of Object.keys(SECRETS)) {
			expect(env[key]).toBeUndefined();
		}
		// PATH still survives — the leak fix must not break legitimate hooks.
		expect(env.PATH).toBe('/usr/bin');
	});

	it('drops loader-hijack / code-injection vars even if present', () => {
		const env = buildHookCommandEnv({ PATH: '/usr/bin', ...DANGEROUS });
		for (const key of Object.keys(DANGEROUS)) {
			expect(env[key]).toBeUndefined();
		}
	});

	it('passes through operator-defined CLAUDE_HOOK_* vars (opt-in escape hatch)', () => {
		const env = buildHookCommandEnv({
			[`${HOOK_ENV_PASSTHROUGH_PREFIX}TOKEN`]: 'hook-config-value',
			CLAUDE_HOOK_REGION: 'eu',
		});
		expect(env[`${HOOK_ENV_PASSTHROUGH_PREFIX}TOKEN`]).toBe('hook-config-value');
		expect(env.CLAUDE_HOOK_REGION).toBe('eu');
	});

	it('does not invent vars that were absent from the host env', () => {
		const env = buildHookCommandEnv({ PATH: '/usr/bin' });
		expect('HOME' in env).toBe(false);
		expect(Object.keys(env)).toEqual(['PATH']);
	});
});
