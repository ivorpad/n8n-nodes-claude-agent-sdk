import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { executeTaskOperation } from '../../operations/executeTask';
import { createMockAdapter, mockMessages } from '../helpers/mockClaudeAgentSdk';
import type { SdkAdapter } from '../../sdk/types';

describe('Structured Output Hardening', () => {
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;
	let mockAdapter: SdkAdapter;

	const defaultParams: Record<string, unknown> = {
		taskDescription: 'Extract structured data',
		chatSessionId: '',
		workingDirectory: process.cwd(),
		allowedTools: [],
		permissionMode: 'default',
		subagents: { agents: [] },
		mcpServers: { servers: [] },
		structuredOutput: true,
		schemaType: 'fromJson',
		jsonSchemaExample: '{"name":"","score":0}',
		structuredOutputFailureMode: 'continueWithError',
		additionalOptions: {},
		additionalDirectories: '',
		maxTurns: 0,
		treatAgentErrorsAsWorkflowErrors: false,
		streaming: { enabled: false },
		securityOptions: {},
	};

	beforeEach(() => {
		vi.clearAllMocks();

		mockExec = mock<IExecuteFunctions>();
		mockExec.getNode.mockReturnValue({
			name: 'Test Node',
			type: 'claudeAgentSdk',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		} as INode);
		mockExec.getNodeParameter.mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => defaultParams[name] ?? defaultValue,
		);
		mockExec.getCredentials.mockRejectedValue(new Error('No credentials'));
		mockExec.getInputData.mockReturnValue([{ json: {} }]);
		mockExec.continueOnFail.mockReturnValue(false);
		mockExec.getInputConnectionData.mockResolvedValue(undefined);

		mockAdapter = createMockAdapter([]);
	});

	it('returns explicit diagnostics by default when structured output retries are exhausted', async () => {
		mockAdapter = createMockAdapter([
			mockMessages.systemInit,
			mockMessages.textMessage('Recovered summary text'),
			mockMessages.result(undefined, 'error_max_structured_output_retries'),
		]);

		const result = await executeTaskOperation(mockExec, 0, {
			apiKey: undefined,
			adapter: mockAdapter,
		});

		expect(result.returnData.json.type).toBe('task_result');
		expect(result.returnData.json.summary).toBe('Recovered summary text');
		expect(result.returnData.json.structuredOutputError).toBe(
			'Could not produce valid structured output after max retries',
		);
		expect(result.returnData.json.structuredOutputFailureSubtype).toBe(
			'error_max_structured_output_retries',
		);
		expect(result.returnData.json.structuredOutputFailureMode).toBe('continueWithError');
		expect(result.returnData.json.requestedStructuredOutputSchema).toMatchObject({
			type: 'object',
			properties: {
				name: { type: 'string' },
				score: { type: 'integer' },
			},
		});
	});

	it('throws when configured to fail on structured output retry exhaustion', async () => {
		mockExec.getNodeParameter.mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => {
				if (name === 'structuredOutputFailureMode') return 'throwError';
				return defaultParams[name] ?? defaultValue;
			},
		);

		mockAdapter = createMockAdapter([
			mockMessages.systemInit,
			mockMessages.textMessage('Still produced text'),
			mockMessages.result(undefined, 'error_max_structured_output_retries'),
		]);

		await expect(executeTaskOperation(mockExec, 0, {
			apiKey: undefined,
			adapter: mockAdapter,
		})).rejects.toThrow(/Could not produce valid structured output after max retries/);
	});

	it('falls back to unstructured output when configured', async () => {
		mockExec.getNodeParameter.mockImplementation(
			(name: string, _itemIndex: number, defaultValue?: unknown) => {
				if (name === 'structuredOutputFailureMode') return 'fallbackToUnstructured';
				return defaultParams[name] ?? defaultValue;
			},
		);

		mockAdapter = createMockAdapter([
			mockMessages.systemInit,
			mockMessages.textMessage('Use this plain-text summary'),
			mockMessages.result(undefined, 'error_max_structured_output_retries'),
		]);

		const result = await executeTaskOperation(mockExec, 0, {
			apiKey: undefined,
			adapter: mockAdapter,
		});

		expect(result.returnData.json.type).toBe('task_result');
		expect(result.returnData.json.summary).toBe('Use this plain-text summary');
		expect(result.returnData.json.structuredOutput).toBeUndefined();
		expect(result.returnData.json.structuredOutputError).toBeUndefined();
		expect(result.returnData.json.structuredOutputFailureMode).toBe('fallbackToUnstructured');
		expect(result.returnData.json.structuredOutputFallbackReason).toBe(
			'Could not produce valid structured output after max retries',
		);
	});

	it('keeps structured output but records a validation warning if node-side validation disagrees', async () => {
		mockAdapter = createMockAdapter([
			mockMessages.systemInit,
			mockMessages.textMessage('Completed'),
			mockMessages.result({ name: 123, score: 'bad' }),
		]);

		const result = await executeTaskOperation(mockExec, 0, {
			apiKey: undefined,
			adapter: mockAdapter,
		});

		expect(result.returnData.json.structuredOutput).toEqual({ name: 123, score: 'bad' });
		expect(result.returnData.json.structuredOutputValidationError).toMatch(/should be string|should be integer/);
	});
});
