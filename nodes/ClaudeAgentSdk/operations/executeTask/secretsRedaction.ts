/**
 * Secrets redaction utilities for executeTask operation.
 * Prevents injected credential values from leaking into node outputs,
 * stderr, audit logs, or streaming responses.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import type { McpServerUI } from '../../types';
import type { ExecuteTaskOptions } from './types';

const REDACTED = '[REDACTED]';

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueSecrets(values: Array<string | undefined | null>): string[] {
	return [...new Set(
		values
			.filter((v): v is string => typeof v === 'string')
			.map((v) => v.trim())
			.filter((v) => v.length >= 3),
	)];
}

export interface SecretsRedactor {
	redactString(input: string): string;
	redactUnknown<T>(input: T): T;
	hasSecrets: boolean;
}

export function createSecretsRedactor(secretValues: Array<string | undefined | null>): SecretsRedactor {
	const secrets = uniqueSecrets(secretValues);

	function redactString(input: string): string {
		let output = input;
		for (const secret of secrets) {
			output = output.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
		}
		return output;
	}

	function redactUnknown<T>(input: T): T {
		if (input === null || input === undefined) return input;
		if (typeof input === 'string') return redactString(input) as T;
		if (Array.isArray(input)) return input.map((item) => redactUnknown(item)) as T;
		if (typeof input === 'object') {
			const obj = input as Record<string, unknown>;
			const redacted: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(obj)) {
				redacted[key] = redactUnknown(value);
			}
			return redacted as T;
		}
		return input;
	}

	return { redactString, redactUnknown, hasSecrets: secrets.length > 0 };
}

/**
 * Shared identity redactor used as the default at every emit/persist boundary.
 *
 * The real redactor (built once per invocation from collectSecretsForRedaction)
 * is threaded into each sink at its construction/call site. Defaulting to this
 * no-op keeps the boundaries behaviour-preserving when no redactor is wired
 * (e.g. unit tests, code paths that never carry secrets).
 */
export const NOOP_SECRETS_REDACTOR: SecretsRedactor = {
	redactString: (input) => input,
	redactUnknown: (input) => input,
	hasSecrets: false,
};

/**
 * Secret values that exist outside ExecuteTaskOptions but must still be
 * redacted (resolved later than the option object, e.g. MCP header-auth
 * credential bearer tokens).
 */
interface ExtraSecretSources {
	/** Resolved mcpHeaderAuthApi header values (bearer tokens etc.). */
	mcpHeaderAuthValues?: Array<string | undefined>;
}

/**
 * Collect all secret values that should be redacted from outputs.
 */
export function collectSecretsForRedaction(options: Pick<
	ExecuteTaskOptions,
	'apiKey' | 'openrouterAuthToken' | 'ollamaAuthToken' | 'alibabaAuthToken' | 'secureEnv'
> & ExtraSecretSources): Array<string | undefined> {
	return [
		options.apiKey,
		options.openrouterAuthToken,
		options.ollamaAuthToken,
		options.alibabaAuthToken,
		...Object.values(options.secureEnv ?? {}),
		...(options.mcpHeaderAuthValues ?? []),
	];
}

function readCredentialString(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

/**
 * Resolve the MCP header-auth credential value(s) that will be injected into
 * MCP HTTP/SSE server requests. The redactor is built before MCP server config
 * is assembled, so the underlying credential is read here at build time and fed
 * into collectSecretsForRedaction.
 *
 * Only fetches the credential when MCP servers are enabled and at least one
 * HTTP/SSE server uses `credential` authentication — mirroring the conditions
 * under which buildMcpServersConfig actually injects the header value.
 */
export async function resolveMcpHeaderAuthSecrets(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): Promise<string[]> {
	let enableMcpServers = false;
	try {
		enableMcpServers = execFunctions.getNodeParameter('enableMcpServers', itemIndex, false) as boolean;
	} catch {
		return [];
	}
	if (!enableMcpServers) {
		return [];
	}

	let servers: McpServerUI[] | undefined;
	try {
		const mcpServersInput = execFunctions.getNodeParameter('mcpServers', itemIndex, {}) as {
			servers?: McpServerUI[];
		};
		servers = mcpServersInput.servers;
	} catch {
		return [];
	}

	const usesCredentialAuth = (servers ?? []).some(
		(server) =>
			(server.type === 'http' || server.type === 'sse') &&
			server.authentication === 'credential',
	);
	if (!usesCredentialAuth) {
		return [];
	}

	try {
		const credentials = await execFunctions.getCredentials('mcpHeaderAuthApi');
		const headerValue = readCredentialString(credentials, 'headerValue');
		return headerValue ? [headerValue] : [];
	} catch {
		return [];
	}
}
