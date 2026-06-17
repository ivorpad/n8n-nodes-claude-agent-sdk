/**
 * Environment assembly for executeTask: dangerous-var filtering, allowlists,
 * provider env wiring, proxy env, and MCP header `${VAR}` resolution env.
 */

import { ApplicationError } from 'n8n-workflow';

/**
 * Default dangerous environment variable names that should be blocked.
 * These could enable code execution or security bypasses.
 * Can be overridden via N8N_CLAUDE_BLOCKED_ENV_VARS env var (comma-separated).
 */
const DEFAULT_DANGEROUS_ENV_VARS = [
	// Dynamic library injection (Linux)
	'LD_PRELOAD',
	'LD_LIBRARY_PATH',
	// Dynamic library injection (macOS)
	'DYLD_INSERT_LIBRARIES',
	'DYLD_FORCE_FLAT_NAMESPACE',
	// Node.js code execution
	'NODE_OPTIONS',
	'NODE_PATH',
	// Shell startup / command hijacking
	'BASH_ENV',
	'ENV',
	'PROMPT_COMMAND',
	// Interpreter startup / module-path hijacking
	'PYTHONSTARTUP',
	'PYTHONPATH',
	'PERL5OPT',
	'RUBYOPT',
	// Git command hijacking (arbitrary command via SSH transport)
	'GIT_SSH',
	'GIT_SSH_COMMAND',
	// Code coverage / testing frameworks (could be exploited)
	'Istanbul',
	'NYC_ROOT_ID',
	'NYC_CONFIG',
	'NYC_CWD',
	// Node.js debugging/snapshotting
	'V8_HEAP_SNAPSHOT',
	'NODE_DEBUG',
];

interface ProxyManagerConfig {
	enabled?: boolean;
	httpProxyUrl?: string;
	httpsProxyUrl?: string;
	noProxy?: string;
	caBundlePath?: string;
}

/**
 * Get the set of blocked environment variable names from env or use defaults.
 */
function getBlockedEnvVars(): Set<string> {
	const envOverride = process.env.N8N_CLAUDE_BLOCKED_ENV_VARS;
	if (envOverride) {
		return new Set(envOverride.split(',').map((s) => s.trim()).filter(Boolean));
	}
	return new Set(DEFAULT_DANGEROUS_ENV_VARS);
}

/**
 * Remove dangerous environment variables from an env object.
 * Logs a warning for each blocked variable.
 */
function filterDangerousEnvVars(env: Record<string, unknown>, blockedVars: Set<string>): void {
	for (const key of Object.keys(env)) {
		if (blockedVars.has(key)) {
			delete env[key];
			console.warn(`[Security] Blocked dangerous environment variable: ${key}`);
		}
	}
}

interface EnvironmentSecurityOptions {
	envSecurityMode?: 'blocklist' | 'allowlist';
	allowedEnvVarNames?: string[];
	policyAllowedEnvVarNames?: string[];
	claudeConfigDir?: string;
}

const ESSENTIAL_ENV_VARS = [
	'PATH',
	'HOME',
	'SHELL',
	'USER',
	'TERM',
	'LANG',
	'LC_ALL',
	'CLAUDE_CONFIG_DIR',
	'CLAUDE_AGENT_SDK_CLIENT_APP',
];

const PROVIDER_ENV_VARS = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'ANTHROPIC_BASE_URL',
	'ANTHROPIC_MODEL',
	'ANTHROPIC_DEFAULT_SONNET_MODEL',
	'ANTHROPIC_DEFAULT_OPUS_MODEL',
	'ANTHROPIC_DEFAULT_HAIKU_MODEL',
];

const PROXY_ENV_VARS = [
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'NO_PROXY',
	'http_proxy',
	'https_proxy',
	'no_proxy',
	'SSL_CERT_FILE',
	'CURL_CA_BUNDLE',
	'NODE_EXTRA_CA_CERTS',
	'REQUESTS_CA_BUNDLE',
	'GIT_SSL_CAINFO',
];

function normalizeTrimmedEnvValue(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : undefined;
}

/**
 * Compute the filtered, allowlisted "exposable" environment that both the
 * spawned Claude child process and MCP HTTP/SSE header resolution must agree on.
 *
 * Single source of truth for the final merge step: combine the assembled base
 * env with the injected secure credential env, strip dangerous variable names,
 * then apply allowlist filtering. Used by buildEnvironment (child process) and
 * buildMcpHeaderEnvironment (header `${VAR}` resolution).
 */
function buildExposableEnvironment(
	baseEnv: Record<string, unknown>,
	env: Record<string, unknown>,
	secureEnv: Record<string, string> | undefined,
	environmentSecurity: EnvironmentSecurityOptions | undefined,
	blockedEnvVars: Set<string>,
): Record<string, string | undefined> {
	// Merge order: base/system env → provider/additionalOptions.env → secure credential env
	const merged: Record<string, unknown> = { ...baseEnv, ...env };
	if (secureEnv) {
		Object.assign(merged, secureEnv);
	}
	// Idempotent for the child path (already filtered); load-bearing for the
	// header path, which assembles its base directly from process.env by name.
	filterDangerousEnvVars(merged, blockedEnvVars);
	return toProcessEnv(applyEnvAllowlist(merged, environmentSecurity));
}

/**
 * Coerce a merged env record to the canonical subprocess-env shape
 * ({ [name]: string | undefined }). JSON-provided non-string values are
 * stringified — identical to what child_process would do at spawn time.
 */
function toProcessEnv(env: Record<string, unknown>): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(env)) {
		// null/undefined mean "not set" — exporting the string 'null' would
		// leak a bogus value into the subprocess environment.
		result[key] = value == null ? undefined : typeof value === 'string' ? value : String(value);
	}
	return result;
}

/**
 * Build the environment used to resolve `${VAR}` placeholders in custom HTTP/SSE
 * MCP server headers.
 *
 * This must NOT be the raw host environment. A workflow author can point an MCP
 * server at an arbitrary host and name any `${VAR}` in a custom header; if we
 * resolved against `process.env` wholesale, host secrets such as
 * `N8N_ENCRYPTION_KEY` or `DB_POSTGRESDB_PASSWORD` would be exfiltrated. Only the
 * exposable set may resolve: provider vars, proxy vars, injected Secure
 * Environment Variables, and (in allowlist mode) explicitly allowlisted names —
 * all minus the dangerous-var blocklist. Anything else falls through to the
 * literal `${VAR}` token (the fallback in mcp.ts).
 */
export function buildMcpHeaderEnvironment(
	secureEnv?: Record<string, string>,
	environmentSecurity?: EnvironmentSecurityOptions,
): Record<string, string | undefined> {
	const blockedEnvVars = getBlockedEnvVars();

	// Pull only the provider/proxy var values from the host env, by name.
	const base: Record<string, string> = {};
	for (const name of [...PROVIDER_ENV_VARS, ...PROXY_ENV_VARS]) {
		const value = process.env[name];
		if (value !== undefined) {
			base[name] = value;
		}
	}

	// In allowlist mode, also expose explicitly allowlisted custom names so that
	// header resolution has parity with what the child process receives.
	if (environmentSecurity?.envSecurityMode === 'allowlist') {
		const explicitNames = intersectNames(
			normalizeEnvVarNames(environmentSecurity.allowedEnvVarNames),
			environmentSecurity.policyAllowedEnvVarNames,
		);
		for (const name of explicitNames) {
			const value = process.env[name];
			if (value !== undefined) {
				base[name] = value;
			}
		}
	}

	const exposable = buildExposableEnvironment(base, {}, secureEnv, environmentSecurity, blockedEnvVars);

	return exposable;
}

function buildProxyEnv(config?: ProxyManagerConfig): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	if (!config?.enabled) {
		return result;
	}

	const httpProxyUrl = normalizeTrimmedEnvValue(config.httpProxyUrl);
	if (httpProxyUrl) {
		result.HTTP_PROXY = httpProxyUrl;
		result.http_proxy = httpProxyUrl;
	}

	const httpsProxyUrl = normalizeTrimmedEnvValue(config.httpsProxyUrl);
	if (httpsProxyUrl) {
		result.HTTPS_PROXY = httpsProxyUrl;
		result.https_proxy = httpsProxyUrl;
	}

	const noProxy = normalizeTrimmedEnvValue(config.noProxy);
	if (noProxy) {
		result.NO_PROXY = noProxy;
		result.no_proxy = noProxy;
	}

	const caBundlePath = normalizeTrimmedEnvValue(config.caBundlePath);
	if (caBundlePath) {
		result.SSL_CERT_FILE = caBundlePath;
		result.CURL_CA_BUNDLE = caBundlePath;
		result.NODE_EXTRA_CA_CERTS = caBundlePath;
		result.REQUESTS_CA_BUNDLE = caBundlePath;
		result.GIT_SSL_CAINFO = caBundlePath;
	}

	return result;
}

function normalizeEnvVarNames(names: string[] | undefined): string[] {
	if (!names || names.length === 0) return [];
	return names.map((name) => name.trim()).filter(Boolean);
}

function intersectNames(values: string[], constraints: string[] | undefined): string[] {
	if (!constraints?.length) return values;
	const allowed = new Set(constraints);
	return values.filter((value) => allowed.has(value));
}

function applyEnvAllowlist(
	env: Record<string, unknown>,
	options: EnvironmentSecurityOptions | undefined,
): Record<string, unknown> {
	if (options?.envSecurityMode !== 'allowlist') {
		return env;
	}

	const userAllowlist = intersectNames(
		normalizeEnvVarNames(options.allowedEnvVarNames),
		options.policyAllowedEnvVarNames,
	);

	const allowlist = new Set<string>([
		...ESSENTIAL_ENV_VARS,
		...PROVIDER_ENV_VARS,
		...PROXY_ENV_VARS,
		...userAllowlist,
	]);

	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(env)) {
		if (allowlist.has(key)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

/**
 * Build environment variables for query execution
 */
export function buildEnvironment(
	apiKey: string | undefined,
	additionalEnv: string | undefined,
	apiProvider?: 'anthropic' | 'openrouter' | 'ollama' | 'custom' | 'alibaba',
	customApiEndpoint?: string,
	ollamaBaseUrl?: string,
	openrouterAuthToken?: string,
	openrouterBaseUrl?: string,
	ollamaAuthToken?: string,
	openrouterSonnetModel?: string,
	openrouterOpusModel?: string,
	openrouterHaikuModel?: string,
	alibabaAuthToken?: string,
	alibabaBaseUrl?: string,
	alibabaSonnetModel?: string,
	alibabaOpusModel?: string,
	alibabaHaikuModel?: string,
	secureEnv?: Record<string, string>,
	environmentSecurity?: EnvironmentSecurityOptions,
	proxyManager?: ProxyManagerConfig,
	anthropicBaseUrl?: string,
): Record<string, string | undefined> {
	let env: Record<string, unknown> = {};

	// Parse environment variables if provided
	if (additionalEnv) {
		try {
			env = JSON.parse(additionalEnv);
		} catch (error) {
			throw new ApplicationError(`Invalid JSON in Environment Variables: ${error}`);
		}
	}

	// Security: Filter dangerous environment variables from user-provided env
	const blockedEnvVars = getBlockedEnvVars();
	filterDangerousEnvVars(env, blockedEnvVars);

	// Security: Also filter dangerous vars from secure credential env
	if (secureEnv) {
		filterDangerousEnvVars(secureEnv, blockedEnvVars);
	}

	// Optional workflow-level Claude config isolation override
	if (environmentSecurity?.claudeConfigDir) {
		env.CLAUDE_CONFIG_DIR = environmentSecurity.claudeConfigDir;
	}

	Object.assign(env, buildProxyEnv(proxyManager));

	// Set ANTHROPIC_BASE_URL based on provider (only if not already set by user)
	const provider = apiProvider || 'anthropic';
	if (!env.ANTHROPIC_BASE_URL) {
		if (provider === 'openrouter') {
			const normalizedBaseUrl = (openrouterBaseUrl || 'https://openrouter.ai/api').replace(/\/$/, '');
			env.ANTHROPIC_BASE_URL = normalizedBaseUrl.endsWith('/api/v1')
				? normalizedBaseUrl.replace(/\/api\/v1$/, '/api')
				: normalizedBaseUrl;
		} else if (provider === 'ollama') {
			env.ANTHROPIC_BASE_URL = ollamaBaseUrl || 'http://localhost:11434';
		} else if (provider === 'alibaba') {
			env.ANTHROPIC_BASE_URL = alibabaBaseUrl || 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic';
		} else if (provider === 'custom') {
			if (customApiEndpoint) {
				env.ANTHROPIC_BASE_URL = customApiEndpoint;
			}
		} else if (provider === 'anthropic') {
			const normalizedBaseUrl = anthropicBaseUrl?.trim().replace(/\/$/, '');
			if (normalizedBaseUrl && normalizedBaseUrl !== 'https://api.anthropic.com') {
				env.ANTHROPIC_BASE_URL = normalizedBaseUrl;
			}
		}
		// For the default Anthropic endpoint, leave ANTHROPIC_BASE_URL unset so the SDK uses its default.
	}

	// Add API key to environment: credential > env var
	// Priority: n8n credential > ANTHROPIC_API_KEY env var
	const effectiveApiKey = apiKey || process.env.ANTHROPIC_API_KEY;
	if (provider === 'openrouter') {
		const trimmedAuthToken = openrouterAuthToken?.trim();
		const effectiveAuthToken = trimmedAuthToken || apiKey || process.env.ANTHROPIC_AUTH_TOKEN;
		if (!Object.prototype.hasOwnProperty.call(env, 'ANTHROPIC_AUTH_TOKEN') && effectiveAuthToken) {
			env.ANTHROPIC_AUTH_TOKEN = effectiveAuthToken;
		}
		// OpenRouter requires ANTHROPIC_API_KEY to be explicitly empty
		env.ANTHROPIC_API_KEY = '';

		// Set model overrides for OpenRouter
		const trimmedSonnetModel = openrouterSonnetModel?.trim();
		if (trimmedSonnetModel) {
			env.ANTHROPIC_DEFAULT_SONNET_MODEL = trimmedSonnetModel;
		}
		const trimmedOpusModel = openrouterOpusModel?.trim();
		if (trimmedOpusModel) {
			env.ANTHROPIC_DEFAULT_OPUS_MODEL = trimmedOpusModel;
		}
		const trimmedHaikuModel = openrouterHaikuModel?.trim();
		if (trimmedHaikuModel) {
			env.ANTHROPIC_DEFAULT_HAIKU_MODEL = trimmedHaikuModel;
		}
	} else if (provider === 'alibaba') {
		const trimmedAuthToken = alibabaAuthToken?.trim();
		const effectiveAuthToken = trimmedAuthToken || apiKey || process.env.ANTHROPIC_AUTH_TOKEN;
		if (!Object.prototype.hasOwnProperty.call(env, 'ANTHROPIC_AUTH_TOKEN') && effectiveAuthToken) {
			env.ANTHROPIC_AUTH_TOKEN = effectiveAuthToken;
		}
		// Alibaba requires ANTHROPIC_API_KEY to be explicitly empty
		env.ANTHROPIC_API_KEY = '';

		// Set model overrides for Alibaba Coding Plan
		const trimmedAlibabaSonnet = alibabaSonnetModel?.trim();
		if (trimmedAlibabaSonnet) {
			env.ANTHROPIC_DEFAULT_SONNET_MODEL = trimmedAlibabaSonnet;
		}
		const trimmedAlibabaOpus = alibabaOpusModel?.trim();
		if (trimmedAlibabaOpus) {
			env.ANTHROPIC_DEFAULT_OPUS_MODEL = trimmedAlibabaOpus;
		}
		const trimmedAlibabaHaiku = alibabaHaikuModel?.trim();
		if (trimmedAlibabaHaiku) {
			env.ANTHROPIC_DEFAULT_HAIKU_MODEL = trimmedAlibabaHaiku;
		}
		// Alibaba requires ANTHROPIC_MODEL to be explicitly set to a supported model.
		// Use the Sonnet tier selection as the primary model (most common default tier).
		const alibabaModel = trimmedAlibabaSonnet || trimmedAlibabaOpus || trimmedAlibabaHaiku;
		if (alibabaModel) {
			env.ANTHROPIC_MODEL = alibabaModel;
		}
	} else if (provider === 'ollama') {
		const trimmedAuthToken = ollamaAuthToken?.trim();
		const effectiveAuthToken = trimmedAuthToken || process.env.ANTHROPIC_AUTH_TOKEN || 'ollama';
		if (!Object.prototype.hasOwnProperty.call(env, 'ANTHROPIC_AUTH_TOKEN')) {
			env.ANTHROPIC_AUTH_TOKEN = effectiveAuthToken;
		}
		if (!Object.prototype.hasOwnProperty.call(env, 'ANTHROPIC_API_KEY')) {
			env.ANTHROPIC_API_KEY = effectiveAuthToken;
		}
	} else if (effectiveApiKey) {
		env.ANTHROPIC_API_KEY = effectiveApiKey;
		// Custom endpoints may expect ANTHROPIC_AUTH_TOKEN as well
		if (provider === 'custom') {
			env.ANTHROPIC_AUTH_TOKEN = effectiveApiKey;
		}
	}

	// Always include essential environment variables for CLI operation
	const systemEnv: Record<string, string> = {};

	// Essential variables for CLI operation in any environment
	// CLAUDE_CONFIG_DIR is critical for containerized envs where ~/.claude is mounted elsewhere
	const essentialVars = ['PATH', 'HOME', 'SHELL', 'USER', 'TERM', 'LANG', 'LC_ALL', 'CLAUDE_CONFIG_DIR'];
	for (const varName of essentialVars) {
		if (process.env[varName]) {
			systemEnv[varName] = process.env[varName];
		}
	}

	if (environmentSecurity?.claudeConfigDir) {
		systemEnv.CLAUDE_CONFIG_DIR = environmentSecurity.claudeConfigDir;
	}

	// Provide sensible defaults for critical variables
	systemEnv.SHELL = systemEnv.SHELL || '/bin/bash';
	systemEnv.HOME = systemEnv.HOME || '/root';
	systemEnv.TERM = systemEnv.TERM || 'xterm-256color';

	// Set SDK client app identifier for User-Agent (user env overrides)
	if (!env.CLAUDE_AGENT_SDK_CLIENT_APP) {
		systemEnv.CLAUDE_AGENT_SDK_CLIENT_APP =
			process.env.CLAUDE_AGENT_SDK_CLIENT_APP || 'n8n-claude-agent-sdk';
	}

	// Final merge + dangerous-var filter + allowlist via the shared exposable-env
	// builder, so the child process and MCP header resolution agree on one set.
	return buildExposableEnvironment(systemEnv, env, secureEnv, environmentSecurity, blockedEnvVars);
}
