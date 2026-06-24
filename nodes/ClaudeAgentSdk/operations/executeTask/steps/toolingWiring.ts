/**
 * MCP server registration (UI-configured, in-process n8n MCP, skill tools,
 * connected AiTool inputs), blocked-tool list assembly, and permission/AGT/
 * webhook hook wiring for executeTask.
 */

import type { IExecuteFunctions, INode } from 'n8n-workflow';

import type { AgentDefinition, McpServerUI, N8nMcpSettings, AdditionalOptions } from '../../../types';
import { buildMcpServersConfig, buildBlockedToolsList } from '../../../mcp';
import { buildN8nSdkMcpServer } from '../../../mcpN8nSdk';
import { buildSkillSdkMcpServer } from '../../../skillToolsMcp';
import { buildConnectedAiToolsMcpServer } from '../../../connectedAiToolsMcp';
import {
	parsePermissionsConfig,
	buildPermissionHooks,
	mergeExecutionHookSources,
	hasAnyPermissionsEnabled,
	applyOperatorPathPolicy,
} from '../../../permissions';
import type { SharedExecutionState } from '../../../permissions/canUseToolCallback';
import type { AuditLogEntry, PermissionsConfig } from '../../../permissions/types';
import type { OperatorPolicy } from '../../../permissions/policy';
import { buildAgtPreToolUseHook } from '../../../permissions/AgtPreToolUseHook';
import { createAgtEvaluator } from '../../../permissions/AgtGovernance';
import { buildHookHandlers } from '../../../hooks/webhookHooks';
import { buildMcpHeaderEnvironment } from '../config';
import type { ExecuteTaskOptions } from '../types';
import type { NodeQueryOptions, SdkHooks } from '../../../sdk/types';
import { parseHookHandlerConfigs } from '../executeTaskHelpers';
import { debugLog, debugWarn } from '../../../diagnostics';

export async function wireToolingAndHooks(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	node: INode;
	secureEnv: Record<string, string> | undefined;
	sdkModule: ExecuteTaskOptions['sdkModule'];
	backendMode: 'localCli' | 'managedAgent';
	sharedState: SharedExecutionState;
	queryOptions: NodeQueryOptions;
	workingDirectory: string;
	chatSessionId: string;
	effectivePermissionMode: string;
	allowedTools: string[];
	agents: Record<string, AgentDefinition>;
	executionId: string | undefined;
	correlationId: string | undefined;
	interactionExecutionId: string;
	additionalOptions: AdditionalOptions;
	additionalDirectories: string[] | undefined;
	operatorPolicy: OperatorPolicy;
}): Promise<{
	allBlockedTools: string[];
	permissionsConfig: PermissionsConfig;
	hasAuditLogging: boolean;
	getAuditLogFn: (() => AuditLogEntry[]) | undefined;
}> {
	const {
		execFunctions,
		itemIndex,
		node,
		secureEnv,
		sdkModule,
		backendMode,
		sharedState,
		queryOptions,
		workingDirectory,
		chatSessionId,
		effectivePermissionMode,
		allowedTools,
		agents,
		executionId,
		correlationId,
		interactionExecutionId,
		additionalOptions,
		additionalDirectories,
		operatorPolicy,
	} = args;

	const appendAllowedTools = (toolsToAdd: string[]): void => {
		if (toolsToAdd.length === 0) {
			return;
		}
		let changed = false;
		for (const tool of toolsToAdd) {
			if (!allowedTools.includes(tool)) {
				allowedTools.push(tool);
				changed = true;
			}
		}
		if (changed) {
			queryOptions.allowedTools = allowedTools;
		}
	};

	// ─────────────────────────────────────────────────────────────────────────────
	// 7. Parse MCP servers and blocked tools
	// ─────────────────────────────────────────────────────────────────────────────

	const enableMcpServers = execFunctions.getNodeParameter('enableMcpServers', itemIndex, false) as boolean;
	let mcpServersInput: { servers?: McpServerUI[] } = {};

	if (enableMcpServers) {
		mcpServersInput = execFunctions.getNodeParameter('mcpServers', itemIndex, {}) as {
			servers?: McpServerUI[];
		};
	}

	const mcpHeaderEnvironment = buildMcpHeaderEnvironment(secureEnv);
	const mcpServers = await buildMcpServersConfig(
		execFunctions,
		mcpServersInput.servers,
		mcpHeaderEnvironment,
	);

	const n8nMcpSettings = execFunctions.getNodeParameter('n8nMcp', itemIndex, {}) as N8nMcpSettings;
	if (n8nMcpSettings.enabled) {
		const n8nMcpServer = buildN8nSdkMcpServer({
			execFunctions,
			itemIndex,
			settings: n8nMcpSettings,
			existingServerNames: Object.keys(mcpServers),
			sdkModule,
			sharedState,
			workingDirectory: (queryOptions.cwd as string) || workingDirectory || '.',
			chatSessionId,
			permissionMode: effectivePermissionMode,
			allowedTools,
			backendMode,
		});
		mcpServers[n8nMcpServer.serverName] = n8nMcpServer.serverConfig;
		for (const warning of n8nMcpServer.warnings) {
			debugWarn(`[Claude Agent SDK] ${warning}`);
		}
	}
	if (n8nMcpSettings.enableSkillTools) {
		const skillMcpServer = await buildSkillSdkMcpServer({
			settings: n8nMcpSettings,
			existingServerNames: Object.keys(mcpServers),
			sdkModule,
			backendMode,
			workingDirectory: (queryOptions.cwd as string) || workingDirectory || '.',
			chatSessionId,
			itemIndex,
			nodeName: execFunctions.getNode().name,
			executionId,
			correlationId,
		});
		if (skillMcpServer) {
			mcpServers[skillMcpServer.serverName] = skillMcpServer.serverConfig;
			for (const warning of skillMcpServer.warnings) {
				debugWarn(`[Claude Agent SDK] ${warning}`);
			}
			debugLog(
				`[Claude Agent SDK] Registered ${skillMcpServer.toolCount} auto-loaded skill tools on MCP server "${skillMcpServer.serverName}".`,
			);
		}
	}
	const connectedAiToolsMcp = await buildConnectedAiToolsMcpServer({
		execFunctions,
		itemIndex,
		existingServerNames: Object.keys(mcpServers),
		sdkModule,
		backendMode,
	});
	if (connectedAiToolsMcp) {
		mcpServers[connectedAiToolsMcp.serverName] = connectedAiToolsMcp.serverConfig;
		for (const warning of connectedAiToolsMcp.warnings) {
			debugWarn(`[Claude Agent SDK] ${warning}`);
		}
		if (allowedTools.length > 0) {
			appendAllowedTools(
				connectedAiToolsMcp.toolNames.map(
					(toolName) => `mcp__${connectedAiToolsMcp.serverName}__${toolName}`,
				),
			);
		}
		debugLog(
			`[Claude Agent SDK] Registered ${connectedAiToolsMcp.toolCount} connected AiTool input(s) on MCP server "${connectedAiToolsMcp.serverName}".`,
		);
	}
	if (Object.keys(mcpServers).length > 0) {
		queryOptions.mcpServers = mcpServers;
	}

	// Add subagents to query options
	if (Object.keys(agents).length > 0) {
		queryOptions.agents = agents;
		// Task tool is required for the main agent to delegate to subagents
		appendAllowedTools(['Task']);
	}

	// Build blocked tools list (workflow settings + operator policy)
	const allBlockedTools = Array.from(new Set([
		...buildBlockedToolsList(
			additionalOptions.blockedTools,
			mcpServersInput.servers,
		),
		...operatorPolicy.blockedToolPatterns,
	]));

	// ─────────────────────────────────────────────────────────────────────────────
	// 8. Parse permissions and build hooks + canUseTool callback
	// ─────────────────────────────────────────────────────────────────────────────

	const parsedPermissionsConfig = parsePermissionsConfig(execFunctions, itemIndex, additionalDirectories, workingDirectory);
	const permissionsConfig = applyOperatorPathPolicy(parsedPermissionsConfig, operatorPolicy);
	const userPromptContext = additionalOptions.userPromptContext?.trim() || undefined;
	let permissionHooks: SdkHooks | undefined;
	let userHooks: SdkHooks | undefined;
	let agtHooks: SdkHooks | undefined;
	let hasAuditLogging = false;
	let getAuditLogFn: (() => AuditLogEntry[]) | undefined;

	if (permissionsConfig.auditLogger?.enabled) {
		hasAuditLogging = true;
	}

	if (hasAnyPermissionsEnabled(permissionsConfig, userPromptContext) || allBlockedTools.length > 0) {
		const { hooks, getAuditLog } = buildPermissionHooks(
			permissionsConfig,
			allBlockedTools,
			userPromptContext,
		);
		permissionHooks = hooks;
		getAuditLogFn = getAuditLog;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// 8a. Prepare AGT + webhook hook handlers, then merge in enforcement order
	// ─────────────────────────────────────────────────────────────────────────────

	// AGT Governance — wire as PreToolUse hook so it fires on every tool call
	// regardless of permission mode or allowedTools list. canUseTool is bypassed
	// by the Claude Code CLI for built-in tools, so hooks are the only reliable
	// enforcement point.
	if (permissionsConfig.agtGovernance?.enabled) {
		const agtEvaluatorForHook = createAgtEvaluator(permissionsConfig.agtGovernance, {
			workflowId: execFunctions.getWorkflow?.()?.id ? String(execFunctions.getWorkflow().id) : undefined,
			nodeName: node.name,
			sessionId: chatSessionId,
			executionId: interactionExecutionId,
		});
		agtHooks = buildAgtPreToolUseHook(agtEvaluatorForHook);
	}

	const hookHandlerConfigs = parseHookHandlerConfigs(execFunctions, itemIndex);
	if (hookHandlerConfigs.length > 0) {
		userHooks = buildHookHandlers(hookHandlerConfigs);
	}

	queryOptions.hooks = mergeExecutionHookSources(
		queryOptions.hooks,
		{ permissionHooks, agtHooks, userHooks },
	);

	return { allBlockedTools, permissionsConfig, hasAuditLogging, getAuditLogFn };
}
