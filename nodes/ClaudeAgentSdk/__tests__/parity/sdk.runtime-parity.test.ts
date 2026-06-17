import { describe, expect, it } from 'vitest';

describe('Claude Agent SDK runtime parity', () => {
	it('exports query() as a function', async () => {
		const sdk = await import('@anthropic-ai/claude-agent-sdk');

		expect(typeof sdk.query).toBe('function');
	});

	it('does not expose the removed unstable V2 session API (SDK 0.3.142+)', async () => {
		const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as Record<string, unknown>;

		expect(sdk.unstable_v2_createSession).toBeUndefined();
		expect(sdk.unstable_v2_resumeSession).toBeUndefined();
		expect(sdk.unstable_v2_prompt).toBeUndefined();
	});

	it('keeps MCP helper exports paired', async () => {
		const sdk = await import('@anthropic-ai/claude-agent-sdk');
		const hasTool = typeof sdk.tool === 'function';
		const hasCreateSdkMcpServer = typeof sdk.createSdkMcpServer === 'function';

		expect(hasTool).toBe(hasCreateSdkMcpServer);
	});

	it('exports PermissionDenied as a valid hook event (SDK 0.2.92+)', async () => {
		const sdk = await import('@anthropic-ai/claude-agent-sdk');
		expect(sdk.HOOK_EVENTS).toContain('PermissionDenied');
	});

	it('exports current task lifecycle hook events', async () => {
		const sdk = await import('@anthropic-ai/claude-agent-sdk');
		expect(sdk.HOOK_EVENTS).toContain('TaskCreated');
		expect(sdk.HOOK_EVENTS).toContain('TaskCompleted');
	});
});
