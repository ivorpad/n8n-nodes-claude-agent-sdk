import { afterEach, describe, expect, it, vi } from 'vitest';

describe('n8nMcp node property feature flag', () => {
	const originalFlag = process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;

	afterEach(() => {
		if (originalFlag === undefined) {
			delete process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;
		} else {
			process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = originalFlag;
		}
		vi.resetModules();
	});

	it('hides n8n MCP property when feature flag is disabled', async () => {
		delete process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;
		vi.resetModules();

		const module = await import('../nodeProperties/n8nMcp');
		expect(module.n8nMcpProperties[0]?.type).toBe('hidden');
	});

	it('shows n8n MCP property when feature flag is enabled', async () => {
		process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = 'true';
		vi.resetModules();

		const module = await import('../nodeProperties/n8nMcp');
		expect(module.n8nMcpProperties[0]?.type).toBe('collection');
	});
});
