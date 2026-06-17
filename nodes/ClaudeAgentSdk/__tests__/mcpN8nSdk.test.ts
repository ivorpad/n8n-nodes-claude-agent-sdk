/**
 * In-process n8n MCP server builder tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { buildN8nSdkMcpServer } from '../mcpN8nSdk';
import type { SharedExecutionState } from '../permissions/canUseToolCallback';
import type { ClaudeAgentSdkModule } from '../sdk/types';

interface MockToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}

function createMockSdkModule() {
	const tool = vi.fn(
		(
			name: string,
			description: string,
			inputSchema: Record<string, unknown>,
			handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>,
		): MockToolDefinition => ({
			name,
			description,
			inputSchema,
			handler,
		}),
	);
	const createSdkMcpServer = vi.fn((args: { name: string; tools?: unknown[] }) => ({
		type: 'sdk' as const,
		name: args.name,
		instance: {
			tools: args.tools ?? [],
		},
	}));

	const sdkModule: ClaudeAgentSdkModule = {
		query: vi.fn() as unknown as ClaudeAgentSdkModule['query'],
		tool,
		createSdkMcpServer,
	};

	return { sdkModule, tool, createSdkMcpServer };
}

describe('n8n in-process MCP server builder', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;
	const originalFeatureFlag = process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;

	beforeEach(() => {
		process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = 'true';
		mockExec = mock<IExecuteFunctions>();
		mockExec.getInputData.mockReturnValue([
			{ json: { hello: 'world', count: 1 } },
		]);
		mockExec.getNode.mockReturnValue({
			name: 'Claude Agent SDK',
			type: 'claudeAgentSdk',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		} as INode);
	});

	afterEach(() => {
		if (originalFeatureFlag === undefined) {
			delete process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;
		} else {
			process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = originalFeatureFlag;
		}
	});

	it('builds sdk MCP server and resolves name collisions', () => {
		const { sdkModule } = createMockSdkModule();
		const sharedState: SharedExecutionState = {};

		const result = buildN8nSdkMcpServer({
			execFunctions: mockExec,
			itemIndex: 0,
			settings: {
				enabled: true,
				serverName: 'n8n',
				tools: ['getItemJson'],
			},
			existingServerNames: ['n8n'],
			sdkModule,
			sharedState,
			workingDirectory: '/tmp/workspace',
			chatSessionId: 'chat-123',
			permissionMode: 'default',
			allowedTools: ['Read'],
			backendMode: 'localCli',
		});

		expect(result.serverName).toBe('n8n_1');
		expect(result.serverConfig.type).toBe('sdk');
		expect(result.warnings[0]).toContain('already exists');
	});

	it('get_item_json tool returns current input item JSON', async () => {
		const { sdkModule } = createMockSdkModule();
		const sharedState: SharedExecutionState = {};

		const result = buildN8nSdkMcpServer({
			execFunctions: mockExec,
			itemIndex: 0,
			settings: {
				enabled: true,
				tools: ['getItemJson'],
			},
			existingServerNames: [],
			sdkModule,
			sharedState,
			workingDirectory: '/tmp/workspace',
			chatSessionId: 'chat-123',
			permissionMode: 'default',
			allowedTools: ['Read'],
			backendMode: 'localCli',
		});

		const tools = (result.serverConfig.instance as { tools: MockToolDefinition[] }).tools;
		const getItemTool = tools.find((t) => t.name === 'get_item_json');
		expect(getItemTool).toBeDefined();

		const response = await getItemTool!.handler({}, {});
		const toolResponse = response as {
			content: Array<{ type: string; text: string }>;
		};

		expect(toolResponse.content[0].type).toBe('text');
		expect(toolResponse.content[0].text).toContain('"hello": "world"');
	});

	it('set_output_json stores output override when writes are enabled', async () => {
		const { sdkModule } = createMockSdkModule();
		const sharedState: SharedExecutionState = {};

		const result = buildN8nSdkMcpServer({
			execFunctions: mockExec,
			itemIndex: 0,
			settings: {
				enabled: true,
				tools: ['setOutputJson'],
				allowOutputWrite: true,
			},
			existingServerNames: [],
			sdkModule,
			sharedState,
			workingDirectory: '/tmp/workspace',
			chatSessionId: 'chat-123',
			permissionMode: 'default',
			allowedTools: ['Read'],
			backendMode: 'localCli',
		});

		const tools = (result.serverConfig.instance as { tools: MockToolDefinition[] }).tools;
		const setOutputTool = tools.find((t) => t.name === 'set_output_json');
		expect(setOutputTool).toBeDefined();

		await setOutputTool!.handler(
			{
				mode: 'replace',
				json: { custom: true },
			},
			{},
		);

		expect(sharedState.outputOverride).toEqual({
			mode: 'replace',
			json: { custom: true },
		});
	});

	it('throws for remote backend', () => {
		const { sdkModule } = createMockSdkModule();
		const sharedState: SharedExecutionState = {};

		expect(() =>
			buildN8nSdkMcpServer({
				execFunctions: mockExec,
				itemIndex: 0,
				settings: {
					enabled: true,
					tools: ['getItemJson'],
				},
				existingServerNames: [],
				sdkModule,
				sharedState,
				workingDirectory: '/tmp/workspace',
				chatSessionId: '',
				permissionMode: 'default',
				allowedTools: [],
				backendMode: 'managedAgent',
			}),
		).toThrow('only available with Local CLI execution');
	});

	it('throws when feature flag is disabled', () => {
		process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = 'false';
		const { sdkModule } = createMockSdkModule();
		const sharedState: SharedExecutionState = {};

		expect(() =>
			buildN8nSdkMcpServer({
				execFunctions: mockExec,
				itemIndex: 0,
				settings: {
					enabled: true,
					tools: ['getItemJson'],
				},
				existingServerNames: [],
				sdkModule,
				sharedState,
				workingDirectory: '/tmp/workspace',
				chatSessionId: '',
				permissionMode: 'default',
				allowedTools: [],
				backendMode: 'localCli',
			}),
		).toThrow('disabled by feature flag');
	});
});
