import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { ClaudeAgentSdk } from '../../ClaudeAgentSdk.node';

describe('ClaudeAgentSdk Node - Loop Detection', () => {
	it('routes task_result input to the single Result output (interactiveApprovals=pauseForApproval)', async () => {
		const exec = mock<IExecuteFunctions>();
		const items: INodeExecutionData[] = [{ json: { type: 'task_result', summary: 'ok' } }];

		exec.getInputData.mockReturnValue(items);
		exec.getNodeParameter.mockImplementation((name: string, _itemIndex: number, defaultValue?: unknown) => {
			if (name === 'interactiveApprovals') return 'pauseForApproval';
			if (name === 'securityOptions') return {};
			return defaultValue;
		});

		const node = new ClaudeAgentSdk();
		const outputs = await node.execute.call(exec);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEqual(items);
	});

	it('routes task_result input to the single Result output (interactiveApprovals=disabled)', async () => {
		const exec = mock<IExecuteFunctions>();
		const items: INodeExecutionData[] = [{ json: { type: 'task_result', summary: 'ok' } }];

		exec.getInputData.mockReturnValue(items);
		exec.getNodeParameter.mockImplementation((name: string, _itemIndex: number, defaultValue?: unknown) => {
			if (name === 'interactiveApprovals') return 'disabled';
			if (name === 'securityOptions') return {};
			return defaultValue;
		});

		const node = new ClaudeAgentSdk();
		const outputs = await node.execute.call(exec);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEqual(items);
	});

	it('routes terminal question_response input to the single Result output', async () => {
		const exec = mock<IExecuteFunctions>();
		const items: INodeExecutionData[] = [
			{ json: { type: 'question_response', responseAction: 'complete', answers: { 'Revisión': 'Está bien' } } },
		];

		exec.getInputData.mockReturnValue(items);
		exec.getNodeParameter.mockImplementation((name: string, _itemIndex: number, defaultValue?: unknown) => {
			if (name === 'interactiveApprovals') return 'pauseForApproval';
			if (name === 'securityOptions') return {};
			return defaultValue;
		});

		const node = new ClaudeAgentSdk();
		const outputs = await node.execute.call(exec);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEqual(items);
	});

	it.each([
		'python_sdk_script',
		'task_result',
		'approval_request',
		'question_request',
		'approval_response',
		'question_response',
	])('drops %s payloads in generatePythonSdk mode to prevent loopback regeneration', async (type) => {
		const exec = mock<IExecuteFunctions>();
		const items: INodeExecutionData[] = [{ json: { type } }];

		exec.getInputData.mockReturnValue(items);
		exec.getNodeParameter.mockImplementation((name: string, _itemIndex: number, defaultValue?: unknown) => {
			if (name === 'operation') return 'generatePythonSdk';
			return defaultValue;
		});

		const node = new ClaudeAgentSdk();
		const outputs = await node.execute.call(exec);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEqual([]);
	});

	it('still generates a python script in generatePythonSdk mode for normal input items', async () => {
		const exec = mock<IExecuteFunctions>();
		const items: INodeExecutionData[] = [{ json: { prompt: 'build script' } }];

		exec.getInputData.mockReturnValue(items);
		exec.getNodeParameter.mockImplementation((name: string, _itemIndex: number, defaultValue?: unknown) => {
			if (name === 'operation') return 'generatePythonSdk';
			return defaultValue;
		});

		const node = new ClaudeAgentSdk();
		const outputs = await node.execute.call(exec);
		const firstResult = outputs[0]?.[0]?.json as Record<string, unknown>;

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toHaveLength(1);
		expect(firstResult?.type).toBe('python_sdk_script');
		expect(typeof firstResult?.script).toBe('string');
	});
});
