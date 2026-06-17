/**
 * Build Environment Tests - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildEnvironment } from '../../operations/executeTask/config';

describe('buildEnvironment', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset process.env to a clean state
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv;
	});

	describe('Edge cases', () => {
		it('should handle missing process.env values gracefully', () => {
			delete process.env.PATH;
			delete process.env.HOME;
			delete process.env.SHELL;
			delete process.env.USER;
			delete process.env.TERM;
			delete process.env.ANTHROPIC_API_KEY;

			const env = buildEnvironment(undefined, undefined);

			// Should provide defaults for critical variables
			expect(env.SHELL).toBe('/bin/bash');
			expect(env.HOME).toBe('/root');
			expect(env.TERM).toBe('xterm-256color');
			// No API key set since none provided
			expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		});

		it('should not leak auth token to API key for anthropic provider', () => {
			process.env.ANTHROPIC_AUTH_TOKEN = 'should-not-appear';

			const env = buildEnvironment('test-key', undefined, 'anthropic');

			expect(env.ANTHROPIC_API_KEY).toBe('test-key');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
		});

		it('should handle very long environment variable values', () => {
			const longValue = 'x'.repeat(10000);
			const additionalEnv = JSON.stringify({
				LONG_VAR: longValue,
			});

			const env = buildEnvironment('test-key', additionalEnv);

			expect(env.LONG_VAR).toBe(longValue);
			expect((env.LONG_VAR as string).length).toBe(10000);
		});

		it('should handle special characters in environment values', () => {
			const additionalEnv = JSON.stringify({
				SPECIAL: '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~',
				UNICODE: '你好世界🌍',
				NEWLINE: 'line1\nline2',
			});

			const env = buildEnvironment('test-key', additionalEnv);

			expect(env.SPECIAL).toBe('!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~');
			expect(env.UNICODE).toBe('你好世界🌍');
			expect(env.NEWLINE).toBe('line1\nline2');
		});

		it('should preserve numeric values from additional env as strings', () => {
			const additionalEnv = JSON.stringify({
				PORT: 8080,
				FLOAT: 3.14,
				NEGATIVE: -42,
			});

			const env = buildEnvironment('test-key', additionalEnv);

			// Canonical subprocess env is { [name]: string | undefined } — numbers
			// are stringified exactly as child_process would at spawn time.
			expect(env.PORT).toBe('8080');
			expect(env.FLOAT).toBe('3.14');
			expect(env.NEGATIVE).toBe('-42');
		});

		it('should handle boolean values from additional env', () => {
			const additionalEnv = JSON.stringify({
				ENABLED: true,
				DISABLED: false,
			});

			const env = buildEnvironment('test-key', additionalEnv);

			expect(env.ENABLED).toBe('true');
			expect(env.DISABLED).toBe('false');
		});
	});
});
