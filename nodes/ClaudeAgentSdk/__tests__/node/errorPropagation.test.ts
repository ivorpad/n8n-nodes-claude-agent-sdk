import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { execute as executeNode } from '../../node/execute';

const executeTaskOperationMock = vi.hoisted(() => vi.fn());

vi.mock('../../operations/executeTask', () => ({
	executeTaskOperation: executeTaskOperationMock,
}));

function createContext(): IExecuteFunctions {
	const getNodeParameter = vi.fn((name: string, _itemIndex: number, defaultValue?: unknown) => {
		if (name === 'interactiveApprovals') return 'pauseForApproval';
		if (name === 'authentication') return 'apiCredentials';
		if (name === 'backendMode') return 'localCli';
		if (name === 'securityOptions') return {};
		return defaultValue;
	});

	const getCredentials = vi.fn(async (name: string) => {
		if (name === 'claudeApi') {
			return {
				apiKey: 'sk-test',
			};
		}
		throw new Error('No credentials');
	});

	const ctx: Partial<IExecuteFunctions> = {
		getInputData: vi.fn(() => [{ json: { task: 'demo' } }]),
		getNodeParameter,
		getCredentials,
		getNode: vi.fn(() => ({ name: 'Claude Agent SDK' } as INode)),
		getExecutionId: vi.fn(() => 'exec-1'),
		continueOnFail: vi.fn(() => false),
	};

	return ctx as IExecuteFunctions;
}

describe('ClaudeAgentSdk Node - Error propagation', () => {
	it('preserves NodeOperationError thrown by executeTaskOperation', async () => {
		const ctx = createContext();
		const originalError = new NodeOperationError(ctx.getNode(), 'strict durability failed', {
			itemIndex: 0,
			description: 'Postgres connection failed',
		});

		executeTaskOperationMock.mockRejectedValueOnce(originalError);

		await expect(executeNode.call(ctx, undefined)).rejects.toBe(originalError);
	});

	it('adds actionable guidance when a configured credential type is not registered', async () => {
		const ctx = createContext();

		(ctx.getNodeParameter as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => {
				if (name === 'interactiveApprovals') return 'pauseForApproval';
				if (name === 'authentication') return 'alibaba';
				if (name === 'backendMode') return 'localCli';
				if (name === 'securityOptions') return {};
				return defaultValue;
			},
		);

		(ctx.getNode as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			name: 'Claude Agent SDK',
			credentials: {
				alibabaCodingPlanApi: {
					id: 'cred-1',
					name: 'Alibaba credential',
				},
			},
		} as INode);

		(ctx.getCredentials as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
			if (name === 'alibabaCodingPlanApi') {
				throw new Error('Unrecognized credential type: alibabaCodingPlanApi');
			}
			throw new Error('No credentials');
		});

		await expect(executeNode.call(ctx, undefined)).rejects.toThrow(
			'This credential type is not registered in the running n8n process yet',
		);
	});

	it('rejects unsupported credential types selected by the SDK provider selector', async () => {
		const ctx = createContext();
		executeTaskOperationMock.mockClear();

		(ctx.getNodeParameter as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => {
				if (name === 'authentication') return 'predefinedCredentialType';
				if (name === 'nodeCredentialType') return 'slackApi';
				if (name === 'backendMode') return 'localCli';
				if (name === 'securityOptions') return {};
				return defaultValue;
			},
		);

		await expect(executeNode.call(ctx, undefined)).rejects.toThrow(
			'Credential Type "slackApi" is not supported by Claude Agent SDK',
		);
		expect(executeTaskOperationMock).not.toHaveBeenCalled();
	});

	it('loads official Anthropic credentials saved by the legacy credential-type selector', async () => {
		const ctx = createContext();
		executeTaskOperationMock.mockResolvedValueOnce({
			returnData: { json: { type: 'task_result', summary: 'done' }, pairedItem: { item: 0 } },
			auditLogData: [],
			hasAuditLogging: false,
			agentError: undefined,
		});

		(ctx.getNodeParameter as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => {
				if (name === 'authentication') return 'predefinedCredentialType';
				if (name === 'nodeCredentialType') return 'anthropicApi';
				if (name === 'backendMode') return 'localCli';
				if (name === 'securityOptions') return {};
				return defaultValue;
			},
		);
		(ctx.getNode as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			name: 'Claude Agent SDK',
			credentials: {
				anthropicApi: {
					id: 'cred-1',
					name: 'Anthropic credential',
				},
			},
		} as INode);
		(ctx.getCredentials as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
			if (name === 'anthropicApi') {
				return {
					apiKey: 'sk-ant-official',
					url: 'https://anthropic.example.com',
				};
			}
			throw new Error('No credentials');
		});

		await executeNode.call(ctx, undefined);

		expect(executeTaskOperationMock).toHaveBeenCalledWith(
			ctx,
			0,
			expect.objectContaining({
				apiKey: 'sk-ant-official',
				anthropicBaseUrl: 'https://anthropic.example.com',
				authMethod: 'apiCredentials',
			}),
		);
	});

	it('routes structured output throw-mode errors through continueOnFail on the result output', async () => {
		const ctx = createContext();
		(ctx.continueOnFail as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

		executeTaskOperationMock.mockRejectedValueOnce(
			new Error('Could not produce valid structured output after max retries. Adjust the schema.'),
		);

		const outputs = await executeNode.call(ctx, undefined);
		if ('actions' in outputs) throw new Error('Expected node outputs, got EngineRequest');

		expect(outputs).toHaveLength(1);
		expect(outputs[0][0].json.error).toContain('Could not produce valid structured output after max retries');
	});
});
