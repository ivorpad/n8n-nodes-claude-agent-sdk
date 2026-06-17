/**
 * Edge Cases - Schema
 *
 * Boundary-condition tests intended to flush out bugs.
 */

import { describe, it, expect } from 'vitest';
import {
	generateSchemaFromValue,
	generateSchemaFromExample,
	generateSchemaFromAttributes,
} from '../schema';

describe('Edge Cases - Schema', () => {
	describe('generateSchemaFromValue edge cases', () => {
		it('should handle circular reference gracefully', () => {
			const obj: Record<string, unknown> = { name: 'test' };
			obj.self = obj; // Circular reference

			// This might throw or infinite loop - let's see
			expect(() => generateSchemaFromValue(obj)).toThrow();
		});

		it('should handle Symbol values', () => {
			const obj = { sym: Symbol('test') };
			const schema = generateSchemaFromValue(obj);
			// Symbol should be handled somehow
			expect(schema.type).toBe('object');
		});

		it('should handle BigInt values', () => {
			const obj = { big: BigInt(9007199254740991) };
			const schema = generateSchemaFromValue(obj);
			expect(schema.type).toBe('object');
		});

		it('should handle Date objects', () => {
			const schema = generateSchemaFromValue(new Date());
			// Date is an object but should probably be string
			expect(schema.type).toBe('object');
		});

		it('should handle Function values', () => {
			const obj = { fn: () => {} };
			const schema = generateSchemaFromValue(obj);
			expect(schema.type).toBe('object');
		});

		it('should handle mixed array types', () => {
			// Array with mixed types - only uses first element
			const schema = generateSchemaFromValue([1, 'string', true]);
			expect(schema.type).toBe('array');
			expect(schema.items?.type).toBe('integer'); // Uses first
		});

		it('should handle very deeply nested object', () => {
			let obj: any = { value: 'deep' };
			for (let i = 0; i < 100; i++) {
				obj = { nested: obj };
			}
			// Should not stack overflow
			const schema = generateSchemaFromValue(obj);
			expect(schema.type).toBe('object');
		});

		it('should handle NaN', () => {
			const schema = generateSchemaFromValue(NaN);
			// NaN is typeof number but not integer
			expect(schema.type).toBe('number');
		});

		it('should handle Infinity', () => {
			const schema = generateSchemaFromValue(Infinity);
			expect(schema.type).toBe('number');
		});

		it('should handle -0', () => {
			const schema = generateSchemaFromValue(-0);
			expect(schema.type).toBe('integer');
		});
	});

	describe('generateSchemaFromExample edge cases', () => {
		it('should handle JSON with unicode', () => {
			const schema = generateSchemaFromExample('{"emoji": "🎉", "chinese": "中文"}');
			expect(schema.properties?.emoji.type).toBe('string');
		});

		it('should handle JSON with escape sequences', () => {
			const schema = generateSchemaFromExample('{"path": "C:\\\\Users\\\\test"}');
			expect(schema.properties?.path.type).toBe('string');
		});

		it('should handle extremely large JSON', () => {
			const largeArray = Array(10000).fill({ id: 1, name: 'test' });
			const json = JSON.stringify(largeArray);
			const schema = generateSchemaFromExample(json);
			expect(schema.type).toBe('array');
		});

		it('should handle JSON with numeric string keys', () => {
			const schema = generateSchemaFromExample('{"123": "value"}');
			expect(schema.properties?.['123'].type).toBe('string');
		});

		it('should handle empty string JSON', () => {
			expect(() => generateSchemaFromExample('')).toThrow();
		});

		it('should handle whitespace-only JSON', () => {
			expect(() => generateSchemaFromExample('   ')).toThrow();
		});
	});

	describe('generateSchemaFromAttributes edge cases', () => {
		it('should handle duplicate attribute names', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'dup', type: 'string' },
				{ name: 'dup', type: 'number' }, // Same name!
			]);
			// Last one wins
			expect(schema.properties?.dup.type).toBe('number');
		});

		it('should handle empty name', () => {
			const schema = generateSchemaFromAttributes([{ name: '', type: 'string' }]);
			expect(schema.properties?.['']).toBeDefined();
		});

		it('should handle special characters in name', () => {
			const schema = generateSchemaFromAttributes([
				{ name: 'foo.bar', type: 'string' },
				{ name: 'foo/bar', type: 'string' },
				{ name: 'foo[0]', type: 'string' },
			]);
			expect(Object.keys(schema.properties || {})).toHaveLength(3);
		});
	});
});

