/**
 * Bridge connected n8n AiTool inputs into Claude SDK MCP tools.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { ApplicationError, NodeConnectionTypes } from 'n8n-workflow';
import { z } from 'zod';

import type { McpToolResult } from './mcpTypes';
import type { ClaudeAgentSdkModule } from './sdk/types';
import type { McpSdkServerConfig } from './types';

interface DynamicToolLike {
	name?: string;
	description?: string;
	invoke?: (input: unknown) => Promise<unknown> | unknown;
	call?: (input: unknown) => Promise<unknown> | unknown;
	func?: (input: unknown) => Promise<unknown> | unknown;
	tools?: unknown[];
}

interface NormalizedConnectedTool {
	name: string;
	description: string;
	run: (input: unknown) => Promise<unknown>;
}

interface ConnectedToolInput {
	input?: Record<string, unknown>;
	query?: string;
	rawJson?: string;
}

interface BuildConnectedAiToolsMcpServerArgs {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	existingServerNames: string[];
	sdkModule?: ClaudeAgentSdkModule;
	backendMode: 'localCli' | 'managedAgent';
}

interface BuildConnectedAiToolsMcpServerResult {
	serverName: string;
	serverConfig: McpSdkServerConfig;
	warnings: string[];
	toolCount: number;
	toolNames: string[];
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
	const preferred = baseName.trim() || 'n8n_tools';
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
		warning: `connected AiTool MCP server name "${preferred}" already exists. Using "${candidate}" instead.`,
	};
}

function flattenConnectedTools(input: unknown): DynamicToolLike[] {
	if (input === undefined || input === null) {
		return [];
	}
	if (Array.isArray(input)) {
		return input.flatMap((entry) => flattenConnectedTools(entry));
	}
	if (typeof input !== 'object') {
		return [];
	}
	const maybeTool = input as DynamicToolLike;
	if (Array.isArray(maybeTool.tools)) {
		return maybeTool.tools.flatMap((entry) => flattenConnectedTools(entry));
	}
	return [maybeTool];
}

function getToolRunner(tool: DynamicToolLike): ((input: unknown) => Promise<unknown>) | undefined {
	if (typeof tool.invoke === 'function') {
		return async (input) => await tool.invoke!(input);
	}
	if (typeof tool.call === 'function') {
		return async (input) => await tool.call!(input);
	}
	if (typeof tool.func === 'function') {
		return async (input) => await tool.func!(input);
	}
	return undefined;
}

function sanitizeToolName(input: string): string {
	const cleaned = input
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return cleaned || 'tool';
}

function normalizeConnectedTools(rawTools: DynamicToolLike[]): {
	tools: NormalizedConnectedTool[];
	warnings: string[];
} {
	const warnings: string[] = [];
	const seenNames = new Set<string>();
	const normalized: NormalizedConnectedTool[] = [];

	for (let i = 0; i < rawTools.length; i++) {
		const raw = rawTools[i];
		const runner = getToolRunner(raw);
		if (!runner) {
			warnings.push(`Skipping connected tool at index ${i}: no invoke/call/func method.`);
			continue;
		}

		const baseName = sanitizeToolName(raw.name || `tool_${i + 1}`);
		let candidate = `n8n_tool__${baseName}`;
		let suffix = 1;
		while (seenNames.has(candidate)) {
			suffix += 1;
			candidate = `n8n_tool__${baseName}_${suffix}`;
		}
		seenNames.add(candidate);

		normalized.push({
			name: candidate,
			description: raw.description || `Connected n8n tool "${raw.name || baseName}"`,
			run: runner,
		});
	}

	return { tools: normalized, warnings };
}

function normalizeConnectedToolPayload(
	toolInput: ConnectedToolInput,
	toolName: string,
): { payload: unknown; error?: string } {
	if (typeof toolInput.rawJson === 'string' && toolInput.rawJson.trim().length > 0) {
		try {
			return { payload: JSON.parse(toolInput.rawJson) };
		} catch (error) {
			return {
				payload: {},
				error: `Invalid rawJson payload for tool ${toolName}: ${(error as Error).message}`,
			};
		}
	}

	if (typeof toolInput.query === 'string') {
		return { payload: toolInput.query };
	}

	const payload = toolInput.input ?? {};
	if (
		payload
		&& typeof payload === 'object'
		&& !Array.isArray(payload)
		&& Object.keys(payload).length === 1
		&& typeof (payload as Record<string, unknown>).query === 'string'
	) {
		return { payload: (payload as { query: string }).query };
	}

	return { payload };
}

export async function buildConnectedAiToolsMcpServer(
	args: BuildConnectedAiToolsMcpServerArgs,
): Promise<BuildConnectedAiToolsMcpServerResult | undefined> {
	const {
		execFunctions,
		itemIndex,
		existingServerNames,
		sdkModule,
		backendMode,
	} = args;

	if (!sdkModule?.tool || !sdkModule?.createSdkMcpServer) {
		return undefined;
	}

	const connectedToolsInput = await execFunctions.getInputConnectionData(NodeConnectionTypes.AiTool, 0);

	const flatTools = flattenConnectedTools(connectedToolsInput);
	if (flatTools.length === 0) {
		return undefined;
	}

	if (backendMode !== 'localCli') {
		throw new ApplicationError(
			'Connected AiTool inputs require Local CLI execution in Claude Agent SDK. ' +
			'Switch "Execution Backend" to "Local CLI", or disconnect Tool inputs for remote execution.',
		);
	}

	const { tools, warnings } = normalizeConnectedTools(flatTools);
	if (tools.length === 0) {
		throw new ApplicationError(
			'Tool input is connected, but no callable tools were found (expected invoke/call/func methods).',
		);
	}

	const { resolvedName, warning } = resolveServerName('n8n_tools', existingServerNames);
	if (warning) warnings.push(warning);

	const sdkTools = tools.map((tool) =>
		sdkModule.tool!(
			tool.name,
			tool.description,
			{
				input: z.record(z.string(), z.unknown()).optional(),
				query: z.string().optional(),
				rawJson: z.string().optional(),
			},
			async (toolInput: ConnectedToolInput) => {
				const normalizedInput = normalizeConnectedToolPayload(toolInput, tool.name);
				if (normalizedInput.error) {
					return textResult(normalizedInput.error, true);
				}

				try {
					const output = await tool.run(normalizedInput.payload);
					return textResult(
						JSON.stringify(
							{
								ok: true,
								tool: tool.name,
								output,
								itemIndex,
							},
							null,
							2,
						),
					);
				} catch (error) {
					return textResult(
						JSON.stringify(
							{
								ok: false,
								tool: tool.name,
								error: (error as Error).message,
								itemIndex,
							},
							null,
							2,
						),
						true,
					);
				}
			},
		),
	);

	const serverConfig = sdkModule.createSdkMcpServer({
		name: resolvedName,
		tools: sdkTools,
	});

	if (!serverConfig || serverConfig.type !== 'sdk' || !serverConfig.instance) {
		throw new ApplicationError(
			'Failed to build connected AiTool MCP server. SDK did not return a valid server instance.',
		);
	}

	return {
		serverName: resolvedName,
		serverConfig,
		warnings,
		toolCount: tools.length,
		toolNames: tools.map((tool) => tool.name),
	};
}
