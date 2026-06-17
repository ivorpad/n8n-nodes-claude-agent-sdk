/**
 * Build Environment Tests - OpenRouter model overrides
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

	describe('OpenRouter model overrides', () => {
		it('should not set ANTHROPIC_DEFAULT_*_MODEL vars when no model overrides provided', () => {
			const env = buildEnvironment(
				'openrouter-key',
				undefined,
				'openrouter',
				undefined,
				undefined,
				'auth-token',
				'https://openrouter.ai/api',
				undefined,
				undefined,
				undefined,
				undefined,
			);

			expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
			expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
			expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
		});

		it('should set only sonnet model override when only sonnet provided', () => {
			const env = buildEnvironment(
				'openrouter-key',
				undefined,
				'openrouter',
				undefined,
				undefined,
				'auth-token',
				'https://openrouter.ai/api',
				undefined,
				'anthropic/claude-sonnet-4',
				undefined,
				undefined,
			);

			expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('anthropic/claude-sonnet-4');
			expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
			expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
		});

		it('should set all three model overrides when all provided', () => {
			const env = buildEnvironment(
				'openrouter-key',
				undefined,
				'openrouter',
				undefined,
				undefined,
				'auth-token',
				'https://openrouter.ai/api',
				undefined,
				'anthropic/claude-sonnet-4',
				'anthropic/claude-opus-4',
				'anthropic/claude-haiku-3',
			);

			expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('anthropic/claude-sonnet-4');
			expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('anthropic/claude-opus-4');
			expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('anthropic/claude-haiku-3');
		});

		it('should pass through preset reference format correctly', () => {
			const env = buildEnvironment(
				'openrouter-key',
				undefined,
				'openrouter',
				undefined,
				undefined,
				'auth-token',
				'https://openrouter.ai/api',
				undefined,
				'@preset/my-setup',
				'@preset/opus-config',
				'@preset/haiku-fast',
			);

			expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('@preset/my-setup');
			expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('@preset/opus-config');
			expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('@preset/haiku-fast');
		});

		it('should trim whitespace from model names', () => {
			const env = buildEnvironment(
				'openrouter-key',
				undefined,
				'openrouter',
				undefined,
				undefined,
				'auth-token',
				'https://openrouter.ai/api',
				undefined,
				'  anthropic/claude-sonnet-4  ',
				'  anthropic/claude-opus-4  ',
				'  anthropic/claude-haiku-3  ',
			);

			expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('anthropic/claude-sonnet-4');
			expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('anthropic/claude-opus-4');
			expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('anthropic/claude-haiku-3');
		});

		it('should not set model vars for non-OpenRouter providers even if model params provided', () => {
			// Test with anthropic provider
			const envAnthropic = buildEnvironment(
				'api-key',
				undefined,
				'anthropic',
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				'anthropic/claude-sonnet-4',
				'anthropic/claude-opus-4',
				'anthropic/claude-haiku-3',
			);

			expect(envAnthropic.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
			expect(envAnthropic.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
			expect(envAnthropic.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();

			// Test with ollama provider
			const envOllama = buildEnvironment(
				undefined,
				undefined,
				'ollama',
				undefined,
				'http://localhost:11434',
				undefined,
				undefined,
				undefined,
				'anthropic/claude-sonnet-4',
				'anthropic/claude-opus-4',
				'anthropic/claude-haiku-3',
			);

			expect(envOllama.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
			expect(envOllama.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
			expect(envOllama.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();

			// Test with custom provider
			const envCustom = buildEnvironment(
				'custom-key',
				undefined,
				'custom',
				'https://custom.api.com',
				undefined,
				undefined,
				undefined,
				undefined,
				'anthropic/claude-sonnet-4',
				'anthropic/claude-opus-4',
				'anthropic/claude-haiku-3',
			);

			expect(envCustom.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
			expect(envCustom.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
			expect(envCustom.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
		});

		it('should not set model vars when whitespace-only values provided', () => {
			const env = buildEnvironment(
				'openrouter-key',
				undefined,
				'openrouter',
				undefined,
				undefined,
				'auth-token',
				'https://openrouter.ai/api',
				undefined,
				'   ',
				'   ',
				'   ',
			);

			expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
			expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
			expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
		});

		it('should not set model vars when empty strings provided', () => {
			const env = buildEnvironment(
				'openrouter-key',
				undefined,
				'openrouter',
				undefined,
				undefined,
				'auth-token',
				'https://openrouter.ai/api',
				undefined,
				'',
				'',
				'',
			);

			expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
			expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
			expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
		});
	});
});

