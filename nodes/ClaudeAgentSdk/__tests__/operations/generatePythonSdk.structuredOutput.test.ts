import { describe, expect, it } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

import { generatePythonSdkScript } from '../../operations/generatePythonSdk';

function createMockContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: ((name: string, _index: number, defaultValue?: unknown) => {
			if (name in params) return params[name];
			return defaultValue;
		}) as IExecuteFunctions['getNodeParameter'],
	} as IExecuteFunctions;
}

describe('generatePythonSdkScript structured output validation', () => {
	it('fails fast when the configured structured output schema is invalid', () => {
		const ctx = createMockContext({
			taskDescription: 'Generate a script',
			workingDirectory: '',
			model: '',
			permissionMode: 'default',
			allowedTools: [],
			disallowedTools: [],
			enableStreaming: false,
			enableMcpServers: false,
			enableSubagents: false,
			structuredOutput: true,
			schemaType: 'manual',
			outputJsonSchema: JSON.stringify({
				type: 'object',
				properties: {
					status: { type: 'not-a-real-json-schema-type' },
				},
			}),
			additionalOptions: {},
			executionSettings: {},
		});

		expect(() => generatePythonSdkScript(ctx, 0)).toThrow(/Invalid JSON Schema/);
	});
});
