import { describe, expect, it } from 'vitest';

import { buildStructuredOutputConfig } from '../../operations/executeTask/config';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

describe('buildStructuredOutputConfig', () => {
	it('accepts array root schemas and normalizes nested object items', () => {
		const ctx = createMockExecuteFunctions({
			structuredOutput: true,
			schemaType: 'manual',
			outputJsonSchema: JSON.stringify({
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string' },
					},
				},
			}),
		});

		const result = buildStructuredOutputConfig(ctx, 0);
		expect(result).toEqual({
			type: 'json_schema',
			schema: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string' },
					},
					additionalProperties: false,
				},
			},
		});
	});

	it('accepts scalar root schemas', () => {
		const ctx = createMockExecuteFunctions({
			structuredOutput: true,
			schemaType: 'manual',
			outputJsonSchema: JSON.stringify({
				type: 'string',
				enum: ['approve', 'deny'],
			}),
		});

		expect(buildStructuredOutputConfig(ctx, 0)).toEqual({
			type: 'json_schema',
			schema: {
				type: 'string',
				enum: ['approve', 'deny'],
			},
		});
	});

	it('rejects invalid nested schema definitions before calling the SDK', () => {
		const ctx = createMockExecuteFunctions({
			structuredOutput: true,
			schemaType: 'manual',
			outputJsonSchema: JSON.stringify({
				type: 'object',
				properties: {
					status: { type: 'not-a-real-json-schema-type' },
				},
			}),
		});

		expect(() => buildStructuredOutputConfig(ctx, 0)).toThrow(/Invalid JSON Schema/);
	});
});
