/**
 * Sandbox Configuration Module
 *
 * Provides SDK sandbox configuration for command execution sandboxing
 * and network restrictions.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import type {
	SandboxConfig,
	SandboxNetworkConfig,
	SandboxIgnoreViolationsConfig,
} from './types';

/**
 * Helper to parse comma-separated string into array, trimming whitespace
 * Returns undefined if empty
 */
function parseCommaSeparated(value: string | undefined): string[] | undefined {
	if (!value || value.trim() === '') {
		return undefined;
	}
	const items = value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

/**
 * Parse sandbox configuration from n8n node parameters
 *
 * Returns undefined if sandbox is not enabled, allowing the SDK to use defaults.
 * When enabled, returns the full SandboxConfig object for the SDK.
 */
export function parseSandboxConfig(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): SandboxConfig | undefined {
	const sandboxConfig = execFunctions.getNodeParameter(
		'sandboxConfig',
		itemIndex,
		{},
	) as {
		enableSandbox?: boolean;
		commandOptions?: {
			settings?: {
				sandboxAutoAllowBash?: boolean;
				sandboxExcludedCommands?: string;
				sandboxFailIfUnavailable?: boolean;
				sandboxAllowUnsandboxed?: boolean;
				sandboxWeakerNested?: boolean;
			};
		};
		networkOptions?: {
			settings?: {
				sandboxAllowLocalBinding?: boolean;
				sandboxAllowUnixSockets?: string;
				sandboxAllowAllUnixSockets?: boolean;
				sandboxAllowedDomains?: string;
				sandboxDeniedDomains?: string;
				sandboxHttpProxyPort?: number;
				sandboxSocksProxyPort?: number;
			};
		};
		violationIgnores?: {
			settings?: {
				sandboxIgnoreFilePatterns?: string;
				sandboxIgnoreNetworkPatterns?: string;
			};
		};
	};

	// Check both top-level (new) and collection (legacy) locations for backwards compatibility
	const topLevelEnabled = execFunctions.getNodeParameter('enableSandbox', itemIndex, false) as boolean;
	const legacyEnabled = (sandboxConfig as { enableSandbox?: boolean }).enableSandbox === true;
	const enabled = topLevelEnabled || legacyEnabled;

	if (!enabled) {
		return undefined;
	}

	const commandSettings = sandboxConfig.commandOptions?.settings ?? {};
	const autoAllowBashIfSandboxed = (commandSettings.sandboxAutoAllowBash ?? false) as boolean;
	const excludedCommandsStr = (commandSettings.sandboxExcludedCommands ?? '') as string;
	const allowUnsandboxedCommands = (commandSettings.sandboxAllowUnsandboxed ?? false) as boolean;
	const failIfUnavailable = (commandSettings.sandboxFailIfUnavailable ?? true) as boolean;
	const enableWeakerNestedSandbox = (commandSettings.sandboxWeakerNested ?? false) as boolean;

	const networkSettings = sandboxConfig.networkOptions?.settings ?? {};
	const allowLocalBinding = (networkSettings.sandboxAllowLocalBinding ?? false) as boolean;
	const allowUnixSocketsStr = (networkSettings.sandboxAllowUnixSockets ?? '') as string;
	const allowAllUnixSockets = (networkSettings.sandboxAllowAllUnixSockets ?? false) as boolean;
	const allowedDomainsStr = (networkSettings.sandboxAllowedDomains ?? '') as string;
	const deniedDomainsStr = (networkSettings.sandboxDeniedDomains ?? '') as string;
	const httpProxyPort = (networkSettings.sandboxHttpProxyPort ?? 0) as number;
	const socksProxyPort = (networkSettings.sandboxSocksProxyPort ?? 0) as number;

	const ignoreSettings = sandboxConfig.violationIgnores?.settings ?? {};
	const ignoreFilePatterns = (ignoreSettings.sandboxIgnoreFilePatterns ?? '') as string;
	const ignoreNetworkPatterns = (ignoreSettings.sandboxIgnoreNetworkPatterns ?? '') as string;

	const excludedCommands = parseCommaSeparated(excludedCommandsStr);
	const config: SandboxConfig = {
		enabled: true,
		autoAllowBashIfSandboxed,
		// SDK defaults failIfUnavailable to true when sandbox is enabled via
		// options; only emit the graceful-degradation opt-out explicitly.
		...(failIfUnavailable === false && { failIfUnavailable: false }),
		...(excludedCommands && { excludedCommands }),
		...(allowUnsandboxedCommands && { allowUnsandboxedCommands: true }),
		...(enableWeakerNestedSandbox && { enableWeakerNestedSandbox: true }),
	};

	const allowUnixSockets = parseCommaSeparated(allowUnixSocketsStr);
	const allowedDomains = parseCommaSeparated(allowedDomainsStr);
	const deniedDomains = parseCommaSeparated(deniedDomainsStr);
	const networkConfig: SandboxNetworkConfig = {
		...(allowLocalBinding && { allowLocalBinding: true }),
		...(allowUnixSockets && { allowUnixSockets }),
		...(allowAllUnixSockets && { allowAllUnixSockets: true }),
		...(allowedDomains && { allowedDomains }),
		...(deniedDomains && { deniedDomains }),
		...(httpProxyPort > 0 && { httpProxyPort }),
		...(socksProxyPort > 0 && { socksProxyPort }),
	};
	if (Object.keys(networkConfig).length > 0) {
		config.network = networkConfig;
	}

	const filePatterns = parseCommaSeparated(ignoreFilePatterns);
	const networkPatterns = parseCommaSeparated(ignoreNetworkPatterns);
	const ignoreViolationsConfig: SandboxIgnoreViolationsConfig = {
		...(filePatterns && { file: filePatterns }),
		...(networkPatterns && { network: networkPatterns }),
	};
	if (Object.keys(ignoreViolationsConfig).length > 0) {
		config.ignoreViolations = ignoreViolationsConfig;
	}

	return config;
}
