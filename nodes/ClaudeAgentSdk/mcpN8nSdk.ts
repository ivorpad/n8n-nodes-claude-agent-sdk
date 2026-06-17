/**
 * In-process n8n MCP server builder
 *
 * Uses the SDK's createSdkMcpServer() and tool() helpers to expose
 * n8n-native capabilities as MCP tools.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';
import { z } from 'zod';

import { isN8nMcpInProcessEnabled } from './featureFlags';
import type { McpToolResult } from './mcpTypes';
import type {
	McpSdkServerConfig,
	N8nMcpEvent,
	N8nMcpOutputOverride,
	N8nMcpSettings,
} from './types';
import type { ClaudeAgentSdkModule } from './sdk/types';
import type { SharedExecutionState } from './permissions/canUseToolCallback';

interface BuildN8nSdkMcpServerArgs {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	settings: N8nMcpSettings;
	existingServerNames: string[];
	sdkModule?: ClaudeAgentSdkModule;
	sharedState: SharedExecutionState;
	workingDirectory: string;
	chatSessionId: string;
	permissionMode: string;
	allowedTools: string[];
	backendMode: 'localCli' | 'managedAgent';
}

interface BuildN8nSdkMcpServerResult {
	serverName: string;
	serverConfig: McpSdkServerConfig;
	warnings: string[];
}

function textResult(text: string, isError = false): McpToolResult {
	return {
		content: [{ type: 'text', text }],
		...(isError && { isError: true }),
	};
}

function resolveServerName(baseName: string, existingServerNames: string[]): {
	resolvedName: string;
	warning?: string;
} {
	const trimmed = baseName.trim();
	const preferred = trimmed.length > 0 ? trimmed : 'n8n';
	if (!existingServerNames.includes(preferred)) {
		return { resolvedName: preferred };
	}

	let index = 1;
	let candidate = `${preferred}_${index}`;
	while (existingServerNames.includes(candidate)) {
		index += 1;
		candidate = `${preferred}_${index}`;
	}

	return {
		resolvedName: candidate,
		warning: `n8n MCP server name "${preferred}" already exists. Using "${candidate}" instead.`,
	};
}

function appendN8nMcpEvent(sharedState: SharedExecutionState, event: N8nMcpEvent): void {
	if (!sharedState.n8nMcpEvents) {
		sharedState.n8nMcpEvents = [];
	}
	sharedState.n8nMcpEvents.push(event);
}

function setN8nMcpOutputOverride(
	sharedState: SharedExecutionState,
	override: N8nMcpOutputOverride,
): void {
	sharedState.outputOverride = override;
}

export function buildN8nSdkMcpServer(args: BuildN8nSdkMcpServerArgs): BuildN8nSdkMcpServerResult {
	const {
		execFunctions,
		itemIndex,
		settings,
		existingServerNames,
		sdkModule,
		sharedState,
		workingDirectory,
		chatSessionId,
		permissionMode,
		allowedTools,
		backendMode,
	} = args;

	if (!isN8nMcpInProcessEnabled()) {
		throw new ApplicationError(
			'n8n MCP (in-process) is disabled by feature flag. ' +
			'Set CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS=true to enable it, ' +
			'or disable n8n MCP in this node.',
		);
	}

	if (backendMode !== 'localCli') {
		throw new ApplicationError(
			'n8n MCP (in-process) is only available with Local CLI execution. ' +
			'Switch "Execution Backend" to "Local CLI", or disable n8n MCP for remote execution.',
		);
	}

	if (!sdkModule?.tool || !sdkModule?.createSdkMcpServer) {
		throw new ApplicationError(
			'Current @anthropic-ai/claude-agent-sdk version does not expose createSdkMcpServer()/tool(). ' +
			'Upgrade the SDK or disable n8n MCP.',
		);
	}

	const selectedTools = new Set((settings.tools ?? []).filter(Boolean));
	if (selectedTools.size === 0) {
		throw new ApplicationError(
			'n8n MCP is enabled but no tools were selected. Select at least one n8n MCP tool.',
		);
	}

	const warnings: string[] = [];
	const { resolvedName, warning } = resolveServerName(settings.serverName || 'n8n', existingServerNames);
	if (warning) {
		warnings.push(warning);
	}

	const includeExecutionMetadata = settings.includeExecutionMetadata ?? true;
	const allowOutputWrite = settings.allowOutputWrite ?? false;
	const toolFactory = sdkModule.tool;
	const createServer = sdkModule.createSdkMcpServer;

	const inputItems = execFunctions.getInputData();
	const itemJson = (inputItems[itemIndex]?.json ?? {}) as Record<string, unknown>;
	const node = execFunctions.getNode();
	const registeredTools: NonNullable<Parameters<typeof createServer>[0]['tools']> = [];

	if (selectedTools.has('getItemJson')) {
		registeredTools.push(
			toolFactory(
				'get_item_json',
				'Return input JSON for the current n8n item.',
				{},
				async () => textResult(JSON.stringify(itemJson, null, 2)),
				{ annotations: { readOnlyHint: true } },
			),
		);
	}

	if (selectedTools.has('getExecutionContext')) {
		registeredTools.push(
			toolFactory(
				'get_execution_context',
				'Return safe n8n execution context metadata.',
				{},
				async () => {
					const context: Record<string, unknown> = {
						itemIndex,
						chatSessionId: chatSessionId || undefined,
						workingDirectory: workingDirectory || '.',
						permissionMode,
						allowedTools,
					};
					if (includeExecutionMetadata) {
						context.node = {
							name: node.name,
							type: node.type,
							typeVersion: node.typeVersion,
						};
						context.backendMode = backendMode;
					}
					return textResult(JSON.stringify(context, null, 2));
				},
				{ annotations: { readOnlyHint: true } },
			),
		);
	}

	if (selectedTools.has('log')) {
		registeredTools.push(
			toolFactory(
				'log',
				'Write a log event to n8n execution output.',
				{
					level: z.enum(['info', 'warn', 'error']).default('info'),
					message: z.string().min(1),
				},
				async (toolInput) => {
					const level = (toolInput.level as N8nMcpEvent['level']) || 'info';
					const message = String(toolInput.message ?? '');
					const event: N8nMcpEvent = {
						level,
						message,
						timestamp: new Date().toISOString(),
					};

					appendN8nMcpEvent(sharedState, event);

					const logPrefix = '[Claude Agent SDK][n8n MCP]';
					if (level === 'warn') {
						console.warn(`${logPrefix} ${message}`);
					} else if (level === 'error') {
						console.error(`${logPrefix} ${message}`);
					} else {
						console.log(`${logPrefix} ${message}`);
					}

					return textResult(`Logged ${level} event.`);
				},
			),
		);
	}

	if (selectedTools.has('setOutputJson')) {
		if (!allowOutputWrite) {
			warnings.push(
				'Set Output JSON was selected but Allow Output Writes is disabled; skipping set_output_json tool.',
			);
		} else {
			registeredTools.push(
				toolFactory(
					'set_output_json',
					'Merge or replace the final n8n node output JSON.',
					{
						mode: z.enum(['merge', 'replace']).default('merge'),
						json: z.record(z.string(), z.unknown()),
					},
					async (toolInput) => {
						const mode = (toolInput.mode as 'merge' | 'replace') || 'merge';
						const json = (toolInput.json ?? {}) as Record<string, unknown>;
						setN8nMcpOutputOverride(sharedState, { mode, json });
						return textResult(`Stored output override (${mode}).`);
					},
				),
			);
		}
	}

	if (registeredTools.length === 0) {
		throw new ApplicationError(
			'n8n MCP is enabled, but no tools were registered. ' +
			'Select at least one tool, or enable "Allow Output Writes" when using Set Output JSON.',
		);
	}

	const serverConfig = createServer({
		name: resolvedName,
		tools: registeredTools,
	});

	if (!serverConfig || serverConfig.type !== 'sdk' || !serverConfig.instance) {
		throw new ApplicationError(
			'Failed to build n8n in-process MCP server. SDK did not return a valid sdk server instance.',
		);
	}

	return {
		serverName: resolvedName,
		serverConfig,
		warnings,
	};
}
