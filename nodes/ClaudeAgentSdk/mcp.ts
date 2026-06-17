/**
 * MCP Server configuration utilities
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { ApplicationError, jsonParse } from 'n8n-workflow';
import type { McpServerUI, McpServerConfig } from './types';

/**
 * Default dangerous commands that should be blocked for MCP stdio servers.
 * Can be overridden via N8N_CLAUDE_BLOCKED_MCP_COMMANDS env var (comma-separated).
 */
const DEFAULT_DANGEROUS_COMMANDS = [
	'rm', 'dd', 'mkfs', 'sudo', 'su', 'chmod', 'chown',
	'shutdown', 'reboot', 'init', 'systemctl', 'fdisk',
	'parted', 'wipefs', 'vgremove', 'pvremove',
];

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Get the list of blocked MCP commands from env or use defaults.
 */
function getBlockedMcpCommands(): string[] {
	// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
	const envOverride = process.env.N8N_CLAUDE_BLOCKED_MCP_COMMANDS;
	if (envOverride) {
		return envOverride.split(',').map((s) => s.trim()).filter(Boolean);
	}
	return DEFAULT_DANGEROUS_COMMANDS;
}

/**
 * Check if a command is in the blocked list.
 * Handles both bare commands ('rm') and full paths ('/bin/rm').
 */
function isCommandBlocked(command: string, blockedCommands: string[]): boolean {
	// Extract base command name (handle both 'rm' and '/bin/rm')
	const parts = command.split('/');
	const baseCmd = (parts.pop() || command).split(' ')[0];
	return blockedCommands.includes(baseCmd);
}

function resolveHeaderTemplateValue(
	value: string,
	environment?: Record<string, string | undefined>,
): string {
	return value.replace(ENV_VAR_PATTERN, (_match, variableName: string) => {
		return environment?.[variableName] ?? `\${${variableName}}`;
	});
}

function resolveHeaderTemplates(
	headers: Record<string, string>,
	environment?: Record<string, string | undefined>,
): Record<string, string> {
	const resolvedHeaders: Record<string, string> = {};

	for (const [headerName, headerValue] of Object.entries(headers)) {
		resolvedHeaders[headerName] = resolveHeaderTemplateValue(headerValue, environment);
	}

	return resolvedHeaders;
}

/**
 * Build MCP servers configuration from UI input
 */
export async function buildMcpServersConfig(
	execFunctions: IExecuteFunctions,
	servers: McpServerUI[] | undefined,
	headerEnvironment?: Record<string, string | undefined>,
): Promise<Record<string, McpServerConfig>> {
	if (!servers?.length) return {};

	const mcpServers: Record<string, McpServerConfig> = {};

	for (const server of servers) {
		if (!server.name) continue;

		// Validate required fields based on server type
		if (server.type === 'http' || server.type === 'sse') {
			if (!server.url || server.url.trim() === '') {
				throw new ApplicationError(
					`MCP Server "${server.name}" requires a URL. Please provide the server URL.`,
				);
			}
		} else if (server.type === 'stdio') {
			if (!server.command || server.command.trim() === '') {
				throw new ApplicationError(
					`MCP Server "${server.name}" requires a command. Please provide the command to run.`,
				);
			}

			// Security: Check if command is in blocked list
			const blockedCommands = getBlockedMcpCommands();
			if (isCommandBlocked(server.command, blockedCommands)) {
				throw new ApplicationError(
					`MCP Server "${server.name}" uses a blocked command: "${server.command}". ` +
					'This command is blocked for security reasons. ' +
					'To override, set the N8N_CLAUDE_BLOCKED_MCP_COMMANDS environment variable.',
				);
			}
		}

		if (server.type === 'http' || server.type === 'sse') {
			let headers: Record<string, string> | undefined;

			if (server.authentication === 'credential') {
				try {
					const creds = await execFunctions.getCredentials('mcpHeaderAuthApi');
					if (creds?.headerName && creds?.headerValue) {
						headers = { [creds.headerName as string]: creds.headerValue as string };
					}
				} catch {
					throw new ApplicationError(
						`MCP Server "${server.name}" requires authentication but no MCP Server Authentication API credential is configured`,
					);
				}
			} else if (server.authentication === 'custom' && server.headers) {
				try {
					headers = resolveHeaderTemplates(jsonParse<Record<string, string>>(server.headers), headerEnvironment);
				} catch (error) {
					throw new ApplicationError(
						`Invalid JSON in headers for MCP server "${server.name}": ${error}`,
					);
				}
			}

			const toolPolicies = (server.toolPolicies?.entries ?? [])
				.filter((entry) => entry?.name && entry.name.trim() !== '')
				.map((entry) => ({
					name: entry.name.trim(),
					permission_policy: entry.permission_policy,
				}));

			mcpServers[server.name] = {
				type: server.type,
				url: server.url as string,
				...(headers && Object.keys(headers).length > 0 && { headers }),
				...(toolPolicies.length > 0 && { tools: toolPolicies }),
				...(typeof server.timeout === 'number' && server.timeout > 0 && { timeout: server.timeout }),
				...(server.alwaysLoad === true && { alwaysLoad: true }),
			};
		} else if (server.type === 'stdio') {
			let env: Record<string, string> | undefined;
			if (server.env) {
				try {
					env = JSON.parse(server.env);
				} catch (error) {
					throw new ApplicationError(
						`Invalid JSON in environment variables for MCP server "${server.name}": ${error}`,
					);
				}
			}

			mcpServers[server.name] = {
				type: 'stdio',
				command: server.command as string,
				args: server.args ? server.args.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
				...(env && Object.keys(env).length > 0 && { env }),
				...(typeof server.timeout === 'number' && server.timeout > 0 && { timeout: server.timeout }),
				...(server.alwaysLoad === true && { alwaysLoad: true }),
			};
		}
	}

	return mcpServers;
}

/**
 * Build blocked tools list from global setting and per-MCP-server settings
 */
export function buildBlockedToolsList(
	globalBlockedTools: string | undefined,
	servers: McpServerUI[] | undefined,
): string[] {
	const allBlockedTools: string[] = [];

	// Add global blocked tools
	if (globalBlockedTools) {
		const globalBlocked = globalBlockedTools
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		allBlockedTools.push(...globalBlocked);
	}

	// Add per-MCP-server blocked tools
	for (const server of servers || []) {
		if (server.toolPermissions === 'block' && server.blockedTools) {
			const tools = server.blockedTools.split(',').map((t) => t.trim()).filter(Boolean);
			const prefix = `mcp__${server.name}__`;
			for (const tool of tools) {
				// Handle both formats: "tool_name" or "mcp__server__tool_name"
				if (tool.startsWith(prefix)) {
					allBlockedTools.push(tool);
				} else if (tool.startsWith('mcp__')) {
					// User entered full name but for different server - use as-is
					allBlockedTools.push(tool);
				} else {
					allBlockedTools.push(`${prefix}${tool}`);
				}
			}
		}
	}

	return allBlockedTools;
}
