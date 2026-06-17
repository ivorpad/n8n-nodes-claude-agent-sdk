import { describe, it, expect, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { ClaudeAgentSdkModule } from '../sdk/types';
import { buildConnectedAiToolsMcpServer } from '../connectedAiToolsMcp';

interface SdkToolStub {
	name: string;
	description: string;
	schema: unknown;
	handler: (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

function createSdkStub(): ClaudeAgentSdkModule {
	return {
		query: vi.fn() as unknown as ClaudeAgentSdkModule['query'],
		tool: vi.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
			name,
			description,
			schema,
			handler,
		})) as unknown as NonNullable<ClaudeAgentSdkModule['tool']>,
		createSdkMcpServer: vi.fn((config: { name: string; tools: unknown[] }) => ({
			type: 'sdk',
			name: config.name,
			instance: { tools: config.tools },
		})) as unknown as NonNullable<ClaudeAgentSdkModule['createSdkMcpServer']>,
	};
}

function getSdkTool(result: Awaited<ReturnType<typeof buildConnectedAiToolsMcpServer>>): SdkToolStub {
	const tool = (
		(result?.serverConfig as { instance?: { tools?: unknown[] } }).instance?.tools?.[0] as SdkToolStub
	);
	expect(tool).toBeDefined();
	return tool;
}

describe('connectedAiToolsMcp', () => {
	it('returns undefined when no AiTool connections exist', async () => {
		const exec = mock<IExecuteFunctions>();
		exec.getInputConnectionData.mockResolvedValue(undefined);

		const result = await buildConnectedAiToolsMcpServer({
			execFunctions: exec,
			itemIndex: 0,
			existingServerNames: [],
			sdkModule: createSdkStub(),
			backendMode: 'localCli',
		});

		expect(result).toBeUndefined();
	});

	it('propagates input-connection lookup failures', async () => {
		const exec = mock<IExecuteFunctions>();
		exec.getInputConnectionData.mockRejectedValue(new Error('connection lookup failed'));

		await expect(
			buildConnectedAiToolsMcpServer({
				execFunctions: exec,
				itemIndex: 0,
				existingServerNames: [],
				sdkModule: createSdkStub(),
				backendMode: 'localCli',
			}),
		).rejects.toThrow('connection lookup failed');
	});

	it('builds MCP server from connected callable tools and exposes tool names', async () => {
		const toolInvoke = vi.fn(async (input: unknown) => ({ echoed: input }));
		const exec = mock<IExecuteFunctions>();
		exec.getInputConnectionData.mockImplementation(async (type: NodeConnectionTypes) => {
			if (type === NodeConnectionTypes.AiTool) {
				return [{ name: 'Echo Tool', description: 'Echo', invoke: toolInvoke }];
			}
			return undefined;
		});

		const result = await buildConnectedAiToolsMcpServer({
			execFunctions: exec,
			itemIndex: 0,
			existingServerNames: [],
			sdkModule: createSdkStub(),
			backendMode: 'localCli',
		});

		expect(result).toBeDefined();
		expect(result?.toolCount).toBe(1);
		expect(result?.toolNames).toEqual(['n8n_tool__echo_tool']);
		expect(result?.serverName).toBe('n8n_tools');
	});

	it('normalizes query payloads for connected tools', async () => {
		const toolInvoke = vi.fn(async (input: unknown) => ({ echoed: input }));
		const exec = mock<IExecuteFunctions>();
		exec.getInputConnectionData.mockImplementation(async (type: NodeConnectionTypes) => {
			if (type === NodeConnectionTypes.AiTool) {
				return [{ name: 'Code Tool', invoke: toolInvoke }];
			}
			return undefined;
		});

		const result = await buildConnectedAiToolsMcpServer({
			execFunctions: exec,
			itemIndex: 0,
			existingServerNames: [],
			sdkModule: createSdkStub(),
			backendMode: 'localCli',
		});
		const tool = getSdkTool(result);

		await tool.handler({ input: { query: 'from-input-query' } });
		await tool.handler({ query: 'from-query-field', input: { value: 1 } });
		await tool.handler({ rawJson: '{"from":"raw-json"}', query: 'ignored' });
		await tool.handler({ input: { nested: true } });

		expect(toolInvoke).toHaveBeenNthCalledWith(1, 'from-input-query');
		expect(toolInvoke).toHaveBeenNthCalledWith(2, 'from-query-field');
		expect(toolInvoke).toHaveBeenNthCalledWith(3, { from: 'raw-json' });
		expect(toolInvoke).toHaveBeenNthCalledWith(4, { nested: true });
	});

	it('returns a tool error when rawJson is invalid', async () => {
		const exec = mock<IExecuteFunctions>();
		const toolInvoke = vi.fn(async (input: unknown) => ({ echoed: input }));
		exec.getInputConnectionData.mockImplementation(async (type: NodeConnectionTypes) => {
			if (type === NodeConnectionTypes.AiTool) {
				return [{ name: 'Code Tool', invoke: toolInvoke }];
			}
			return undefined;
		});

		const result = await buildConnectedAiToolsMcpServer({
			execFunctions: exec,
			itemIndex: 0,
			existingServerNames: [],
			sdkModule: createSdkStub(),
			backendMode: 'localCli',
		});
		const tool = getSdkTool(result);

		const response = await tool.handler({ rawJson: '{not-valid-json' });
		expect(response.isError).toBe(true);
		expect(response.content[0].text).toContain('Invalid rawJson payload');
		expect(toolInvoke).not.toHaveBeenCalled();
	});

	it('throws on remote backend when AiTool is connected', async () => {
		const exec = mock<IExecuteFunctions>();
		exec.getInputConnectionData.mockImplementation(async (type: NodeConnectionTypes) => {
			if (type === NodeConnectionTypes.AiTool) {
				return [{ name: 'Echo Tool', invoke: async () => ({ ok: true }) }];
			}
			return undefined;
		});

		await expect(
			buildConnectedAiToolsMcpServer({
				execFunctions: exec,
				itemIndex: 0,
				existingServerNames: [],
				sdkModule: createSdkStub(),
				backendMode: 'managedAgent',
			}),
		).rejects.toThrow('require Local CLI execution');
	});
});
