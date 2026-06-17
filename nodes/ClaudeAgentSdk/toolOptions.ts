import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import type { McpServerUI } from './types';
import {
	asRecord,
	readString,
	discoverServerTools,
	resolveMcpHeaders,
	type DiscoveredToolOption,
	type McpToolDiscoverer,
} from './mcpToolDiscovery';

interface ToolOptionsNodeParams {
	allowedTools?: unknown;
	disallowedTools?: unknown;
	enableMcpServers?: unknown;
	toolsRequiringApproval?: unknown;
	mcpServers?: unknown;
	securityOptions?: unknown;
}


// Mirrors the canonical tool set in @anthropic-ai/claude-agent-sdk sdk-tools.d.ts
// (ToolInputSchemas). Stored names absent from this list remain selectable via
// buildToolOptions, so removals do not break saved workflows.
export const TOOL_OPTIONS: INodePropertyOptions[] = [
	{ name: 'AskUserQuestion', value: 'AskUserQuestion', description: 'Prompt user for input' },
	{ name: 'Bash', value: 'Bash', description: 'Execute shell commands' },
	{ name: 'CronCreate', value: 'CronCreate', description: 'Create a scheduled cron task' },
	{ name: 'CronDelete', value: 'CronDelete', description: 'Delete a scheduled cron task' },
	{ name: 'CronList', value: 'CronList', description: 'List scheduled cron tasks' },
	{ name: 'Edit', value: 'Edit', description: 'Edit existing files' },
	{ name: 'EnterPlanMode', value: 'EnterPlanMode', description: 'Enter planning mode' },
	{ name: 'EnterWorktree', value: 'EnterWorktree', description: 'Create and enter an isolated git worktree' },
	{ name: 'ExitPlanMode', value: 'ExitPlanMode', description: 'Exit planning mode' },
	{ name: 'ExitWorktree', value: 'ExitWorktree', description: 'Leave the isolated git worktree' },
	{ name: 'Glob', value: 'Glob', description: 'Find files by pattern' },
	{ name: 'Grep', value: 'Grep', description: 'Search in files' },
	{ name: 'KillShell', value: 'KillShell', description: 'Kill background shell processes (legacy — superseded by TaskStop)' },
	{ name: 'ListMcpResources', value: 'ListMcpResources', description: 'List resources from connected MCP servers' },
	{ name: 'Monitor', value: 'Monitor', description: 'Monitor long-running background work' },
	{ name: 'NotebookEdit', value: 'NotebookEdit', description: 'Edit Jupyter notebooks' },
	{ name: 'PushNotification', value: 'PushNotification', description: 'Send a push notification' },
	{ name: 'Read', value: 'Read', description: 'Read files' },
	{ name: 'ReadMcpResource', value: 'ReadMcpResource', description: 'Read a resource from a connected MCP server' },
	{ name: 'RemoteTrigger', value: 'RemoteTrigger', description: 'Trigger a remote workflow/agent' },
	{ name: 'REPL', value: 'REPL', description: 'Run code in the sandboxed JavaScript REPL' },
	{ name: 'ScheduleWakeup', value: 'ScheduleWakeup', description: 'Schedule a future wake-up for the agent' },
	{ name: 'Skill', value: 'Skill', description: 'Use agent skills (deprecated in allowed tools — prefer the skills option)' },
	{ name: 'Task', value: 'Task', description: 'Delegate tasks to subagents (auto-added when subagents defined)' },
	{ name: 'TaskCreate', value: 'TaskCreate', description: 'Create a tracked SDK task' },
	{ name: 'TaskGet', value: 'TaskGet', description: 'Read a tracked SDK task' },
	{ name: 'TaskList', value: 'TaskList', description: 'List tracked SDK tasks' },
	{ name: 'TaskOutput', value: 'TaskOutput', description: 'Read output from background agents' },
	{ name: 'TaskStop', value: 'TaskStop', description: 'Stop a background task or shell' },
	{ name: 'TaskUpdate', value: 'TaskUpdate', description: 'Update a tracked SDK task' },
	{ name: 'TodoWrite', value: 'TodoWrite', description: 'Manage task/todo lists' },
	{ name: 'ToolSearch', value: 'ToolSearch', description: 'Inspect available tools and their schemas' },
	{ name: 'WebFetch', value: 'WebFetch', description: 'Fetch web content from URLs' },
	{ name: 'WebSearch', value: 'WebSearch', description: 'Search the web' },
	{ name: 'Workflow', value: 'Workflow', description: 'Run a multi-agent workflow script' },
	{ name: 'Write', value: 'Write', description: 'Write/create files' },
];

function readCurrentParameter(ctx: ILoadOptionsFunctions, name: string): unknown {
	try {
		return ctx.getCurrentNodeParameter(name);
	} catch {
		try {
			return ctx.getNodeParameter(name, undefined);
		} catch {
			return undefined;
		}
	}
}

function collectStringValues(value: unknown): string[] {
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	if (Array.isArray(value)) {
		return value
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	return [];
}

function collectAgtRuleTools(securityOptions: unknown): string[] {
	const security = asRecord(securityOptions);
	const agtGovernance = asRecord(security?.agtGovernance);
	const settings = asRecord(agtGovernance?.settings);
	const rules = asRecord(settings?.rules);
	const values = rules?.values;

	if (!Array.isArray(values)) {
		return [];
	}

	return values.flatMap((entry) => {
		const rule = asRecord(entry);
		return collectStringValues(rule?.tools);
	});
}

function collectStoredSelectableToolNames(params: ToolOptionsNodeParams): string[] {
	const names = new Set<string>();

	for (const value of collectStringValues(params.allowedTools)) {
		names.add(value);
	}

	for (const value of collectStringValues(params.disallowedTools)) {
		names.add(value);
	}

	for (const value of collectStringValues(params.toolsRequiringApproval)) {
		names.add(value);
	}

	for (const value of collectAgtRuleTools(params.securityOptions)) {
		names.add(value);
	}

	return [...names];
}

function buildStoredToolOption(toolName: string): INodePropertyOptions {
	const description = toolName.startsWith('mcp__')
		? 'Configured MCP tool name from workflow state'
		: 'Configured tool name from workflow state';

	return {
		name: `${toolName} (Configured)`,
		value: toolName,
		description,
	};
}

function buildDiscoveredToolOption(tool: DiscoveredToolOption): INodePropertyOptions {
	return {
		name: tool.value,
		value: tool.value,
		description: tool.description ?? 'Tool discovered from configured MCP server',
	};
}

function parseMcpServer(entry: unknown): McpServerUI | undefined {
	const record = asRecord(entry);
	if (!record) {
		return undefined;
	}

	const name = readString(record, 'name');
	const type = readString(record, 'type');

	if (!name || !type) {
		return undefined;
	}

	if (type === 'http' || type === 'sse') {
		const url = readString(record, 'url');
		if (!url) {
			return undefined;
		}

		return {
			name,
			type,
			url,
			authentication: readHttpAuthentication(record),
			headers: readString(record, 'headers'),
			toolPermissions: readString(record, 'toolPermissions') === 'block' ? 'block' : 'all',
			blockedTools: readString(record, 'blockedTools'),
		};
	}

	if (type === 'stdio') {
		const command = readString(record, 'command');
		if (!command) {
			return undefined;
		}

		return {
			name,
			type,
			command,
			args: readString(record, 'args'),
			env: readString(record, 'env'),
			toolPermissions: readString(record, 'toolPermissions') === 'block' ? 'block' : 'all',
			blockedTools: readString(record, 'blockedTools'),
		};
	}

	return undefined;
}

function extractMcpServers(value: unknown): McpServerUI[] {
	const collection = asRecord(value);
	const servers = collection?.servers;

	if (!Array.isArray(servers)) {
		return [];
	}

	return servers.flatMap((entry) => {
		const server = parseMcpServer(entry);
		return server ? [server] : [];
	});
}

function readHttpAuthentication(
	record: Record<string, unknown>,
): 'none' | 'credential' | 'custom' | undefined {
	const value = readString(record, 'authentication');
	if (value === 'none' || value === 'credential' || value === 'custom') {
		return value;
	}

	return undefined;
}


export async function discoverMcpTools(
	params: ToolOptionsNodeParams,
	ctx: Pick<ILoadOptionsFunctions, 'getCredentials'>,
	discoverer: McpToolDiscoverer = discoverServerTools,
): Promise<DiscoveredToolOption[]> {
	if (params.enableMcpServers !== true) {
		return [];
	}

	const discovered = new Map<string, DiscoveredToolOption>();

	await Promise.all(
		extractMcpServers(params.mcpServers).map(async (server) => {
			try {
				const headers = await resolveMcpHeaders(ctx, server);
				const tools = await discoverer(server, headers);
				for (const tool of tools) {
					if (!discovered.has(tool.value)) {
						discovered.set(tool.value, tool);
					}
				}
			} catch {
				// Discovery is best-effort in the editor; preserved configured values cover failures.
			}
		}),
	);

	return [...discovered.values()];
}

export function buildToolOptions(
	params: ToolOptionsNodeParams,
	discoveredTools: DiscoveredToolOption[] = [],
): INodePropertyOptions[] {
	const optionsByValue = new Map(TOOL_OPTIONS.map((option) => [option.value, option]));

	for (const tool of discoveredTools) {
		optionsByValue.set(tool.value, buildDiscoveredToolOption(tool));
	}

	for (const toolName of collectStoredSelectableToolNames(params)) {
		if (!optionsByValue.has(toolName)) {
			optionsByValue.set(toolName, buildStoredToolOption(toolName));
		}
	}

	return [...optionsByValue.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadToolOptions(ctx: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const params: ToolOptionsNodeParams = {
		allowedTools: readCurrentParameter(ctx, 'allowedTools'),
		disallowedTools: readCurrentParameter(ctx, 'disallowedTools'),
		enableMcpServers: readCurrentParameter(ctx, 'enableMcpServers'),
		toolsRequiringApproval: readCurrentParameter(ctx, 'toolsRequiringApproval'),
		mcpServers: readCurrentParameter(ctx, 'mcpServers'),
		securityOptions: readCurrentParameter(ctx, 'securityOptions'),
	};

	const discoveredTools = await discoverMcpTools(params, ctx);
	return buildToolOptions(params, discoveredTools);
}
