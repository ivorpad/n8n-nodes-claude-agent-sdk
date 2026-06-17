/**
 * Streaming Output Tests - interpolateMarker edge cases
 */

import { describe, it, expect } from 'vitest';
import { interpolateMarker } from '../../streaming';

describe('interpolateMarker edge cases', () => {
	it('should handle empty context', () => {
		const result = interpolateMarker('[TOOL:{name}]', {});
		expect(result).toBe('[TOOL:]');
	});

	it('should handle multiple same placeholders', () => {
		const result = interpolateMarker('{name} called {name}', { name: 'Test' });
		expect(result).toBe('Test called Test');
	});

	it('should handle all placeholder types', () => {
		const template = '{name} {id} {type} {subtype} {success}';
		const result = interpolateMarker(template, {
			name: 'Read',
			id: '123',
			type: 'tool_use',
			subtype: 'start',
			success: true,
		});
		expect(result).toBe('Read 123 tool_use start true');
	});

	it('should handle boolean false for success', () => {
		const result = interpolateMarker('{success}', { success: false });
		expect(result).toBe('false');
	});

	it('should leave unknown placeholders unchanged', () => {
		const result = interpolateMarker('{unknown}', { name: 'Test' });
		expect(result).toBe('{unknown}');
	});

	it('should handle complex marker templates', () => {
		const template = '[MSG:{"type":"{type}","subtype":"{subtype}"}]';
		const result = interpolateMarker(template, {
			type: 'system',
			subtype: 'init',
		});
		expect(result).toBe('[MSG:{"type":"system","subtype":"init"}]');
	});
});

