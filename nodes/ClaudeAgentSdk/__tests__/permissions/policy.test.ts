import { describe, expect, it } from 'vitest';

import {
	parseOperatorPolicyFromEnv,
	applyOperatorPathPolicy,
	applyOperatorSandboxPolicy,
} from '../../permissions/policy';
import type { PermissionsConfig } from '../../permissions/types';

describe('operator policy', () => {
	it('parses operator policy environment values', () => {
		const policy = parseOperatorPolicyFromEnv({
			N8N_CLAUDE_POLICY_ALLOWED_PATHS: '/work/a, /work/b',
			N8N_CLAUDE_POLICY_BLOCKED_TOOLS: 'Bash,mcp__danger__*',
			N8N_CLAUDE_POLICY_FORCE_SANDBOX: '1',
			N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED: 'true',
			N8N_CLAUDE_POLICY_ALLOWED_ENV_VARS: 'NODE_ENV,LOG_LEVEL',
			N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES: 'default, plan',
		});

		expect(policy.allowedPaths).toEqual(['/work/a', '/work/b']);
		expect(policy.blockedToolPatterns).toEqual(['Bash', 'mcp__danger__*']);
		expect(policy.forceSandbox).toBe(true);
		expect(policy.disallowUnsandboxedCommands).toBe(true);
		expect(policy.allowedEnvVarNames).toEqual(['NODE_ENV', 'LOG_LEVEL']);
		expect(policy.allowedPermissionModes).toEqual(['default', 'plan']);
	});

	it('leaves allowedPermissionModes UNSET (undefined) when the env var is absent', () => {
		const policy = parseOperatorPolicyFromEnv({});
		expect(policy.allowedPermissionModes).toBeUndefined();
	});

	it('enables path sandbox from operator policy when workflow config has none', () => {
		const config: PermissionsConfig = {};
		const policy = parseOperatorPolicyFromEnv({
			N8N_CLAUDE_POLICY_ALLOWED_PATHS: '/work/only',
		});

		const updated = applyOperatorPathPolicy(config, policy);
		expect(updated.pathSandbox).toMatchObject({
			enabled: true,
			basePath: '/work/only',
			affectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
		});
	});

	it('adds operator allowlist to existing workflow path sandbox', () => {
		const config: PermissionsConfig = {
			pathSandbox: {
				enabled: true,
				basePath: '/work',
				affectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
			},
		};
		const policy = parseOperatorPolicyFromEnv({
			N8N_CLAUDE_POLICY_ALLOWED_PATHS: '/work/safe',
		});

		const updated = applyOperatorPathPolicy(config, policy);
		expect(updated.pathSandbox?.operatorAllowedPaths).toEqual(['/work/safe']);
	});

	it('forces sandbox and disables unsandboxed mode when configured by policy', () => {
		const policy = parseOperatorPolicyFromEnv({
			N8N_CLAUDE_POLICY_FORCE_SANDBOX: '1',
			N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED: '1',
		});

		const sandbox = applyOperatorSandboxPolicy(undefined, policy);
		expect(sandbox).toEqual({
			enabled: true,
			allowUnsandboxedCommands: false,
		});
	});
});
