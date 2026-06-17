import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { executeTaskOperation } from '../../operations/executeTask';
import { createMockAdapter } from '../helpers/mockClaudeAgentSdk';

describe('Proxy manager sandbox gate', () => {
	const originalEnv = process.env;
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		delete process.env.N8N_CLAUDE_POLICY_FORCE_SANDBOX;
		process.env.N8N_CLAUDE_POLICY_DISALLOW_UNSANDBOXED = '1';

		mockExec = mock<IExecuteFunctions>();
		mockExec.getNode.mockReturnValue({
			name: 'Test Node',
			type: 'claudeAgentSdk',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		} as INode);

		const params: Record<string, unknown> = {
			taskDescription: 'test task',
			chatSessionId: '',
			workingDirectory: process.cwd(),
			allowedTools: [],
			disallowedTools: [],
			permissionMode: 'default',
			model: '',
			structuredOutput: false,
			enableSandbox: false,
			executionSettings: {},
			additionalOptions: {
				useProxyManager: true,
				proxyHttpUrl: 'http://proxy.internal:8080',
			},
		};

		mockExec.getNodeParameter.mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => params[name] ?? defaultValue,
		);

		mockExec.getInputConnectionData.mockResolvedValue(undefined);
		mockExec.continueOnFail.mockReturnValue(false);
		mockExec.getCredentials.mockRejectedValue(new Error('No credentials'));
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('rejects proxy manager when sandbox is disabled and only disallow-unsandboxed policy is set', async () => {
		const adapter = createMockAdapter([]);

		await expect(
			executeTaskOperation(mockExec, 0, {
				adapter,
				apiKey: 'test-key',
			}),
		).rejects.toThrow(/Proxy Manager is enabled, but sandboxing is disabled/);
	});
});
