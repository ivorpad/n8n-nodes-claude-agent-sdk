/**
 * Operator policy layer.
 *
 * These policies are configured via environment variables so n8n operators can
 * enforce hard constraints regardless of workflow-level node settings.
 */

import path from 'node:path';
import type { PermissionsConfig, PathSandboxConfig } from './types';
import type { SandboxConfig } from '../sandbox/types';

export interface OperatorPolicy {
	allowedPaths?: string[];
	blockedToolPatterns: string[];
	forceSandbox: boolean;
	disallowUnsandboxedCommands: boolean;
	allowedEnvVarNames?: string[];
	/**
	 * Allowlist of permitted permission modes. `undefined` means UNSET → no
	 * restriction (any mode the workflow requests, including bypassPermissions,
	 * is allowed). When set, any requested mode not in this list is downgraded
	 * to `default` (and the dangerous skip flag is cleared) by
	 * `resolvePermissionMode`/`clampPermissionMode`. This lets an operator
	 * hardening a shared instance forbid `bypassPermissions` regardless of how a
	 * workflow binds the expression-driven `permissionMode` field.
	 */
	allowedPermissionModes?: string[];
}

const ALL_PATH_TOOLS: PathSandboxConfig['affectedTools'] = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

function parseCsv(value: string | undefined): string[] | undefined {
	if (!value || value.trim() === '') return undefined;
	const items = value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

function parseBooleanFlag(value: string | undefined): boolean {
	if (!value) return false;
	return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizeAbsolutePaths(paths: string[] | undefined): string[] | undefined {
	if (!paths || paths.length === 0) return undefined;
	const normalized: string[] = [];
	for (const candidate of paths) {
		if (!path.isAbsolute(candidate)) {
			console.warn(
				`[Claude Agent SDK] Ignoring non-absolute operator policy path: "${candidate}". ` +
				'Use absolute paths in N8N_CLAUDE_POLICY_ALLOWED_PATHS.',
			);
			continue;
		}
		normalized.push(path.normalize(candidate));
	}
	return normalized.length > 0 ? normalized : undefined;
}

/**
 * Parse operator policy from environment variables.
 */
export function parseOperatorPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): OperatorPolicy {
	const allowedPaths = normalizeAbsolutePaths(parseCsv(env.N8N_CLAUDE_POLICY_ALLOWED_PATHS));
	const blockedToolPatterns = parseCsv(env.N8N_CLAUDE_POLICY_BLOCKED_TOOLS) ?? [];
	const allowedEnvVarNames = parseCsv(env.N8N_CLAUDE_POLICY_ALLOWED_ENV_VARS);
	const allowedPermissionModes = parseCsv(env.N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES);

	return {
		allowedPaths,
		blockedToolPatterns,
		forceSandbox: parseBooleanFlag(env.N8N_CLAUDE_POLICY_FORCE_SANDBOX),
		disallowUnsandboxedCommands: parseBooleanFlag(env.N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED),
		allowedEnvVarNames,
		allowedPermissionModes,
	};
}

/**
 * Apply operator path policy to permissions configuration.
 *
 * If workflow path sandbox is enabled, operator paths are enforced as an
 * additional constraint (set intersection at runtime).
 * If workflow path sandbox is disabled and operator paths are configured,
 * path sandboxing is enabled using operator paths.
 */
export function applyOperatorPathPolicy(
	config: PermissionsConfig,
	policy: OperatorPolicy,
): PermissionsConfig {
	if (!policy.allowedPaths?.length) {
		return config;
	}

	const nextConfig: PermissionsConfig = { ...config };

	if (nextConfig.pathSandbox?.enabled) {
		nextConfig.pathSandbox = {
			...nextConfig.pathSandbox,
			operatorAllowedPaths: policy.allowedPaths,
		};
		return nextConfig;
	}

	const [basePath, ...allowedPaths] = policy.allowedPaths;
	nextConfig.pathSandbox = {
		enabled: true,
		basePath,
		affectedTools: ALL_PATH_TOOLS,
		allowedPaths: allowedPaths.length > 0 ? allowedPaths : undefined,
	};
	return nextConfig;
}

/**
 * Apply operator sandbox policy to SDK sandbox configuration.
 */
export function applyOperatorSandboxPolicy(
	config: SandboxConfig | undefined,
	policy: OperatorPolicy,
): SandboxConfig | undefined {
	if (!config && !policy.forceSandbox) {
		return config;
	}
	if (!policy.forceSandbox && !policy.disallowUnsandboxedCommands) {
		return config;
	}

	const nextConfig: SandboxConfig = config
		? { ...config }
		: { enabled: true };

	if (policy.forceSandbox) {
		nextConfig.enabled = true;
	}
	if (policy.disallowUnsandboxedCommands) {
		nextConfig.allowUnsandboxedCommands = false;
	}

	return nextConfig;
}
