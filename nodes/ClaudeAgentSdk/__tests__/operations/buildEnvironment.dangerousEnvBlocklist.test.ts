/**
 * buildEnvironment dangerous env blocklist tests
 *
 * The default blocklist must strip env var names that enable code execution or
 * interpreter hijacking (V10). These supplement the dynamic-library injection
 * names already covered. A behavioural test through buildEnvironment proves the
 * vars never reach the Claude CLI environment.
 */

import { describe, it, expect } from 'vitest';
import { buildEnvironment } from '../../operations/executeTask/config';

describe('buildEnvironment — dangerous env blocklist', () => {
	const newlyBlockedVars = [
		'BASH_ENV',
		'ENV',
		'PROMPT_COMMAND',
		'PYTHONSTARTUP',
		'PYTHONPATH',
		'PERL5OPT',
		'RUBYOPT',
		'GIT_SSH',
		'GIT_SSH_COMMAND',
	];

	it.each(newlyBlockedVars)('strips %s from user-provided additional env', (varName) => {
		const additionalEnv = JSON.stringify({ [varName]: '/tmp/evil', SAFE_VAR: 'ok' });

		const env = buildEnvironment({ apiKey: 'test-key', additionalEnv: additionalEnv });

		expect(env[varName]).toBeUndefined();
		expect(env.SAFE_VAR).toBe('ok');
	});

	it('strips dangerous vars from secure credential env too', () => {
		const secureEnv = { GIT_SSH_COMMAND: 'ssh -o ProxyCommand=evil', SAFE_SECRET: 'keep' };
		const env = buildEnvironment({ apiKey: 'test-key', apiProvider: 'anthropic', secureEnv });

		expect(env.GIT_SSH_COMMAND).toBeUndefined();
		expect(env.SAFE_SECRET).toBe('keep');
		expect(secureEnv).toEqual({
			GIT_SSH_COMMAND: 'ssh -o ProxyCommand=evil',
			SAFE_SECRET: 'keep',
		});
	});
});
