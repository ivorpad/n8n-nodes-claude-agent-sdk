/**
 * Mock factory for IExecuteFunctions
 */

import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

interface MockExecuteFunctionsParams {
	[key: string]: unknown;
}

export function createMockExecuteFunctions(
	params: MockExecuteFunctionsParams = {},
	credentials?: Record<string, unknown>,
) {
	const mockExec = mock<IExecuteFunctions>();

	// Mock getNodeParameter
	mockExec.getNodeParameter.mockImplementation(
		(name: string, _itemIndex: number, defaultValue?: unknown) => {
			return params[name] ?? defaultValue;
		},
	);

	// Mock getCredentials
	if (credentials) {
		mockExec.getCredentials.mockResolvedValue(credentials);
	} else {
		mockExec.getCredentials.mockRejectedValue(new Error('No credentials'));
	}

	// Mock getInputData
	mockExec.getInputData.mockReturnValue([{ json: {} }]);

	// Mock getNode
	mockExec.getNode.mockReturnValue({
		name: 'Test Node',
		type: 'claudeAgentSdk',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	} as INode);

	// Mock continueOnFail
	mockExec.continueOnFail.mockReturnValue(false);

	// Mock getInputConnectionData for memory
	mockExec.getInputConnectionData.mockResolvedValue(undefined);

	return mockExec;
}
