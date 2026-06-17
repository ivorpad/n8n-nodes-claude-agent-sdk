import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';

import { execute as executeNode } from '../../node/execute';

const executeTaskOperationMock = vi.hoisted(() => vi.fn());

vi.mock('../../operations/executeTask', () => ({
	executeTaskOperation: executeTaskOperationMock,
}));

function createContext(items: INodeExecutionData[] = [{ json: { task: 'demo' } }]): IExecuteFunctions {
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
		getInputData: vi.fn(() => items),
		getNodeParameter,
		getCredentials,
		getNode: vi.fn(() => ({ name: 'Claude Agent SDK' } as INode)),
		getExecutionId: vi.fn(() => 'exec-1'),
		continueOnFail: vi.fn(() => false),
	};

	return ctx as IExecuteFunctions;
}

describe('ClaudeAgentSdk Node - Output routing (single Result output)', () => {
	beforeEach(() => {
		executeTaskOperationMock.mockReset();
	});

	it('emits task_result on the single Result output', async () => {
		executeTaskOperationMock.mockResolvedValueOnce({
			returnData: { json: { type: 'task_result', summary: 'done' }, pairedItem: { item: 0 } },
			auditLogData: [],
			hasAuditLogging: false,
			agentError: undefined,
		});

		const ctx = createContext();
		const outputs = await executeNode.call(ctx, undefined);
		if ('actions' in outputs) throw new Error('Expected node outputs, got EngineRequest');

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toHaveLength(1);
		expect(outputs[0][0].json.type).toBe('task_result');
	});

	it('emits approval_request on the same Result output (no separate HITL branch)', async () => {
		executeTaskOperationMock.mockResolvedValueOnce({
			returnData: { json: { type: 'approval_request', requestId: 'req-1' }, pairedItem: { item: 0 } },
			auditLogData: [],
			hasAuditLogging: false,
			agentError: undefined,
		});

		const ctx = createContext();
		const outputs = await executeNode.call(ctx, undefined);
		if ('actions' in outputs) throw new Error('Expected node outputs, got EngineRequest');

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toHaveLength(1);
		expect(outputs[0][0].json.type).toBe('approval_request');
	});

	it('passes loopback items through while executing later normal items', async () => {
		const loopbackItem = { json: { type: 'task_result', summary: 'already done' } };
		const normalItem = { json: { task: 'run this one' } };
		executeTaskOperationMock.mockResolvedValueOnce({
			returnData: { json: { type: 'task_result', summary: 'new result' }, pairedItem: { item: 1 } },
			auditLogData: [],
			hasAuditLogging: false,
			agentError: undefined,
		});

		const ctx = createContext([loopbackItem, normalItem]);
		const outputs = await executeNode.call(ctx, undefined);
		if ('actions' in outputs) throw new Error('Expected node outputs, got EngineRequest');

		expect(executeTaskOperationMock).toHaveBeenCalledTimes(1);
		expect(executeTaskOperationMock.mock.calls[0]?.[1]).toBe(1);
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEqual([
			loopbackItem,
			{ json: { type: 'task_result', summary: 'new result' }, pairedItem: { item: 1 } },
		]);
	});
});
