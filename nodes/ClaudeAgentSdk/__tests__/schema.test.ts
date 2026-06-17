/**
 * Schema Generation Tests
 *
 * Tests for JSON Schema generation utilities.
 */

import { describe, it, expect } from 'vitest';
import {
	generateSchemaFromValue,
	generateSchemaFromExample,
	generateSchemaFromAttributes,
} from '../schema';

describe('Schema Generation', () => {
	describe('generateSchemaFromValue', () => {
		describe('primitive types', () => {
			it('should generate string schema', () => {
				const schema = generateSchemaFromValue('hello');
				expect(schema).toEqual({ type: 'string' });
			});

			it('should generate integer schema for whole numbers', () => {
				const schema = generateSchemaFromValue(42);
				expect(schema).toEqual({ type: 'integer' });
			});

			it('should generate number schema for decimals', () => {
				const schema = generateSchemaFromValue(3.14);
				expect(schema).toEqual({ type: 'number' });
			});

			it('should generate boolean schema', () => {
				expect(generateSchemaFromValue(true)).toEqual({ type: 'boolean' });
				expect(generateSchemaFromValue(false)).toEqual({ type: 'boolean' });
			});

			it('should generate null schema', () => {
				const schema = generateSchemaFromValue(null);
				expect(schema).toEqual({ type: 'null' });
			});
		});

		describe('array types', () => {
			it('should generate array schema with string items', () => {
				const schema = generateSchemaFromValue(['a', 'b', 'c']);
				expect(schema).toEqual({
					type: 'array',
					items: { type: 'string' },
				});
			});

			it('should generate array schema with number items', () => {
				const schema = generateSchemaFromValue([1, 2, 3]);
				expect(schema).toEqual({
					type: 'array',
					items: { type: 'integer' },
				});
			});

			it('should generate array schema with object items', () => {
				const schema = generateSchemaFromValue([{ name: 'test' }]);
				expect(schema).toEqual({
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' },
						},
						required: ['name'],
						additionalProperties: false,
					},
				});
			});

			it('should handle empty array with default string items', () => {
				const schema = generateSchemaFromValue([]);
				expect(schema).toEqual({
					type: 'array',
					items: { type: 'string' },
				});
			});

			it('should handle nested arrays', () => {
				const schema = generateSchemaFromValue([[1, 2], [3, 4]]);
				expect(schema).toEqual({
					type: 'array',
					items: {
						type: 'array',
						items: { type: 'integer' },
					},
				});
			});
		});

		describe('object types', () => {
			it('should generate object schema with properties', () => {
				const schema = generateSchemaFromValue({
					name: 'test',
					count: 5,
					active: true,
				});

				expect(schema.type).toBe('object');
				expect(schema.properties).toEqual({
					name: { type: 'string' },
					count: { type: 'integer' },
					active: { type: 'boolean' },
				});
				expect(schema.required).toEqual(['name', 'count', 'active']);
			});

			it('should handle nested objects', () => {
				const schema = generateSchemaFromValue({
					user: {
						name: 'John',
						age: 30,
					},
				});

				expect(schema.type).toBe('object');
				expect(schema.properties?.user).toEqual({
					type: 'object',
					properties: {
						name: { type: 'string' },
						age: { type: 'integer' },
					},
					required: ['name', 'age'],
					additionalProperties: false,
				});
			});

			it('should handle empty object', () => {
				const schema = generateSchemaFromValue({});
				expect(schema).toEqual({
					type: 'object',
					properties: {},
					required: [],
					additionalProperties: false,
				});
			});

			it('should handle complex nested structure', () => {
				const schema = generateSchemaFromValue({
					items: [{ id: 1, name: 'Item' }],
					meta: {
						total: 100,
						page: 1,
					},
				});

				expect(schema.type).toBe('object');
				expect(schema.properties?.items.type).toBe('array');
				expect(schema.properties?.meta.type).toBe('object');
			});
		});

		describe('edge cases', () => {
			it('should handle undefined as string', () => {
				const schema = generateSchemaFromValue(undefined);
				expect(schema).toEqual({ type: 'string' });
			});

			it('should handle zero', () => {
				const schema = generateSchemaFromValue(0);
				expect(schema).toEqual({ type: 'integer' });
			});

			it('should handle negative numbers', () => {
				expect(generateSchemaFromValue(-5)).toEqual({ type: 'integer' });
				expect(generateSchemaFromValue(-3.14)).toEqual({ type: 'number' });
			});

			it('should handle empty string', () => {
				const schema = generateSchemaFromValue('');
				expect(schema).toEqual({ type: 'string' });
			});
		});
	});

	describe('generateSchemaFromExample', () => {
		it('should parse and generate schema from JSON string', () => {
			const schema = generateSchemaFromExample('{"name": "test", "value": 42}');

			expect(schema.type).toBe('object');
			expect(schema.properties?.name).toEqual({ type: 'string' });
			expect(schema.properties?.value).toEqual({ type: 'integer' });
		});

		it('should handle array JSON', () => {
			const schema = generateSchemaFromExample('[1, 2, 3]');

			expect(schema.type).toBe('array');
			expect(schema.items).toEqual({ type: 'integer' });
		});

		it('should handle nested JSON', () => {
			const schema = generateSchemaFromExample('{"user": {"name": "John"}}');

			expect(schema.type).toBe('object');
			expect(schema.properties?.user.type).toBe('object');
		});

		it('should throw on invalid JSON', () => {
			expect(() => generateSchemaFromExample('not valid json')).toThrow();
		});

		it('should throw on malformed JSON', () => {
			expect(() => generateSchemaFromExample('{"name": "test"')).toThrow();
		});

		it('should handle JSON with whitespace', () => {
			const schema = generateSchemaFromExample('  { "name" : "test" }  ');
			expect(schema.properties?.name).toEqual({ type: 'string' });
		});
	});

	describe('generateSchemaFromAttributes', () => {
		it('should generate schema from string attribute', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'title', type: 'string', description: 'The title' },
			]);

			expect(schema.type).toBe('object');
			expect(schema.properties?.title).toEqual({
				type: 'string',
				description: 'The title',
			});
		});

		it('should generate schema from number attribute', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'count', type: 'number', description: 'The count' },
			]);

			expect(schema.properties?.count).toEqual({
				type: 'number',
				description: 'The count',
			});
		});

		it('should generate schema from boolean attribute', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'active', type: 'boolean', description: 'Is active' },
			]);

			expect(schema.properties?.active).toEqual({
				type: 'boolean',
				description: 'Is active',
			});
		});

		it('should generate schema from stringArray attribute', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'tags', type: 'stringArray', description: 'The tags' },
			]);

			expect(schema.properties?.tags).toEqual({
				type: 'array',
				items: { type: 'string' },
				description: 'The tags',
			});
		});

		it('should generate schema from numberArray attribute', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'scores', type: 'numberArray', description: 'The scores' },
			]);

			expect(schema.properties?.scores).toEqual({
				type: 'array',
				items: { type: 'number' },
				description: 'The scores',
			});
		});

		it('should handle required attributes', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'id', type: 'string', required: true },
				{ name: 'name', type: 'string', required: true },
				{ name: 'description', type: 'string', required: false },
			]);

			expect(schema.required).toEqual(['id', 'name']);
		});

		it('should handle empty attributes', () => {
			const schema = generateSchemaFromAttributes([]);

			expect(schema.type).toBe('object');
			expect(schema.properties).toEqual({});
			expect(schema.required).toBeUndefined();
		});

		it('should handle multiple attributes', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'name', type: 'string', description: 'Name', required: true },
				{ name: 'age', type: 'number', description: 'Age' },
				{ name: 'active', type: 'boolean', description: 'Active' },
				{ name: 'tags', type: 'stringArray', description: 'Tags' },
			]);

			expect(Object.keys(schema.properties || {})).toHaveLength(4);
			expect(schema.required).toEqual(['name']);
		});

		it('should default unknown types to string', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'unknown', type: 'unknownType' as any, description: 'Unknown' },
			]);

			expect(schema.properties?.unknown).toEqual({
				type: 'string',
				description: 'Unknown',
			});
		});
	});
});
