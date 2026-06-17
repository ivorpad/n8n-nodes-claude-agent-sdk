/**
 * Secrets Redaction Unit Tests
 *
 * Tests the security-critical redaction utilities that prevent
 * credential values from leaking into outputs.
 */

import { describe, it, expect } from 'vitest';
import {
	createSecretsRedactor,
	collectSecretsForRedaction,
	type SecretsRedactor,
} from '../../operations/executeTask/secretsRedaction';

describe('Secrets Redaction', () => {
	describe('collectSecretsForRedaction', () => {
		it('should collect API key', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: 'sk-ant-api123',
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				secureEnv: undefined,
			});

			expect(secrets).toContain('sk-ant-api123');
		});

		it('should collect OpenRouter auth token', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: 'sk-or-token456',
				ollamaAuthToken: undefined,
				secureEnv: undefined,
			});

			expect(secrets).toContain('sk-or-token456');
		});

		it('should collect Ollama auth token', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: 'ollama-key789',
				secureEnv: undefined,
			});

			expect(secrets).toContain('ollama-key789');
		});

		it('should collect Alibaba auth token', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				alibabaAuthToken: 'sk-alibaba-token-abc',
				secureEnv: undefined,
			});

			expect(secrets).toContain('sk-alibaba-token-abc');
		});

		it('should collect LiteLLM auth token', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				alibabaAuthToken: undefined,
				liteLlmAuthToken: 'sk-litellm-token-def',
				secureEnv: undefined,
			});

			expect(secrets).toContain('sk-litellm-token-def');
		});

		it('should redact an Alibaba auth token value from outputs', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				alibabaAuthToken: 'sk-alibaba-token-abc',
				secureEnv: undefined,
			});
			const redactor = createSecretsRedactor(secrets);

			const result = redactor.redactString('Calling Alibaba with sk-alibaba-token-abc now');

			expect(result).toBe('Calling Alibaba with [REDACTED] now');
		});

		it('should collect MCP header-auth credential value (V4b)', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				alibabaAuthToken: undefined,
				secureEnv: undefined,
				mcpHeaderAuthValues: ['Bearer mcp-header-token-xyz'],
			});

			expect(secrets).toContain('Bearer mcp-header-token-xyz');
		});

		it('should redact an MCP header-auth value from outputs (V4b)', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				alibabaAuthToken: undefined,
				secureEnv: undefined,
				mcpHeaderAuthValues: ['mcp-header-token-xyz'],
			});
			const redactor = createSecretsRedactor(secrets);

			const result = redactor.redactString('Authorization: mcp-header-token-xyz');

			expect(result).toBe('Authorization: [REDACTED]');
		});

		it('should collect values from secureEnv', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				secureEnv: {
					DB_PASSWORD: 'db-pass-123',
					API_SECRET: 'api-secret-456',
				},
			});

			expect(secrets).toContain('db-pass-123');
			expect(secrets).toContain('api-secret-456');
		});

		it('should collect all sources combined', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: 'sk-ant-123',
				openrouterAuthToken: 'sk-or-456',
				ollamaAuthToken: 'ollama-789',
				secureEnv: {
					EXTRA_SECRET: 'extra-abc',
				},
			});

			expect(secrets).toContain('sk-ant-123');
			expect(secrets).toContain('sk-or-456');
			expect(secrets).toContain('ollama-789');
			expect(secrets).toContain('extra-abc');
		});

		it('should handle empty options', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: undefined,
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				secureEnv: undefined,
			});

			expect(secrets.filter(s => s !== undefined)).toHaveLength(0);
		});

		it('should handle empty secureEnv object', () => {
			const secrets = collectSecretsForRedaction({
				apiKey: 'key123',
				openrouterAuthToken: undefined,
				ollamaAuthToken: undefined,
				secureEnv: {},
			});

			expect(secrets).toContain('key123');
		});
	});

	describe('createSecretsRedactor', () => {
		describe('hasSecrets flag', () => {
			it('should be true when secrets provided', () => {
				const redactor = createSecretsRedactor(['secret123']);

				expect(redactor.hasSecrets).toBe(true);
			});

			it('should be false when no secrets', () => {
				const redactor = createSecretsRedactor([]);

				expect(redactor.hasSecrets).toBe(false);
			});

			it('should be false when all secrets are undefined', () => {
				const redactor = createSecretsRedactor([undefined, undefined]);

				expect(redactor.hasSecrets).toBe(false);
			});

			it('should be false when secrets are too short', () => {
				const redactor = createSecretsRedactor(['ab']); // 2 chars, minimum is 3

				expect(redactor.hasSecrets).toBe(false);
			});

			it('should be false when secrets are whitespace only', () => {
				const redactor = createSecretsRedactor(['   ']);

				expect(redactor.hasSecrets).toBe(false);
			});
		});

		describe('redactString', () => {
			it('should redact string containing secret', () => {
				const redactor = createSecretsRedactor(['my-secret-key']);

				const result = redactor.redactString('The key is my-secret-key and it works');

				expect(result).toBe('The key is [REDACTED] and it works');
			});

			it('should redact multiple occurrences', () => {
				const redactor = createSecretsRedactor(['secret']);

				const result = redactor.redactString('secret here and secret there');

				expect(result).toBe('[REDACTED] here and [REDACTED] there');
			});

			it('should handle multiple different secrets', () => {
				const redactor = createSecretsRedactor(['key1', 'key2']);

				const result = redactor.redactString('Use key1 and key2');

				expect(result).toBe('Use [REDACTED] and [REDACTED]');
			});

			it('should preserve non-secret content', () => {
				const redactor = createSecretsRedactor(['hidden']);

				const result = redactor.redactString('This is visible but hidden is not');

				expect(result).toBe('This is visible but [REDACTED] is not');
			});

			it('should handle string with no secrets', () => {
				const redactor = createSecretsRedactor(['my-api-key-123']);

				const result = redactor.redactString('This string has no sensitive data');

				expect(result).toBe('This string has no sensitive data');
			});

			it('should handle empty string', () => {
				const redactor = createSecretsRedactor(['secret']);

				const result = redactor.redactString('');

				expect(result).toBe('');
			});

			it('should escape regex special characters in secrets', () => {
				const redactor = createSecretsRedactor(['key.$*+?']);

				const result = redactor.redactString('Password: key.$*+?');

				expect(result).toBe('Password: [REDACTED]');
			});

			it('should handle secret at start of string', () => {
				const redactor = createSecretsRedactor(['start-secret']);

				const result = redactor.redactString('start-secret is at start');

				expect(result).toBe('[REDACTED] is at start');
			});

			it('should handle secret at end of string', () => {
				const redactor = createSecretsRedactor(['end-secret']);

				const result = redactor.redactString('At end is end-secret');

				expect(result).toBe('At end is [REDACTED]');
			});

			it('should handle secret as entire string', () => {
				const redactor = createSecretsRedactor(['entire-secret']);

				const result = redactor.redactString('entire-secret');

				expect(result).toBe('[REDACTED]');
			});
		});

		describe('redactUnknown', () => {
			it('should return null as-is', () => {
				const redactor = createSecretsRedactor(['secret']);

				const result = redactor.redactUnknown(null);

				expect(result).toBeNull();
			});

			it('should return undefined as-is', () => {
				const redactor = createSecretsRedactor(['secret']);

				const result = redactor.redactUnknown(undefined);

				expect(result).toBeUndefined();
			});

			it('should redact string values', () => {
				const redactor = createSecretsRedactor(['my-secret']);

				const result = redactor.redactUnknown('Value: my-secret');

				expect(result).toBe('Value: [REDACTED]');
			});

			it('should handle numbers', () => {
				const redactor = createSecretsRedactor(['secret']);

				const result = redactor.redactUnknown(42);

				expect(result).toBe(42);
			});

			it('should handle booleans', () => {
				const redactor = createSecretsRedactor(['secret']);

				expect(redactor.redactUnknown(true)).toBe(true);
				expect(redactor.redactUnknown(false)).toBe(false);
			});

			it('should redact nested object with secret', () => {
				const redactor = createSecretsRedactor(['nested-secret']);

				const result = redactor.redactUnknown({
					level1: {
						level2: 'contains nested-secret',
						other: 'safe',
					},
				});

				expect(result).toEqual({
					level1: {
						level2: 'contains [REDACTED]',
						other: 'safe',
					},
				});
			});

			it('should redact array elements', () => {
				const redactor = createSecretsRedactor(['array-item']);

				const result = redactor.redactUnknown(['safe', 'array-item', 'also-safe']);

				expect(result).toEqual(['safe', '[REDACTED]', 'also-safe']);
			});

			it('should handle nested arrays', () => {
				const redactor = createSecretsRedactor(['deep']);

				const result = redactor.redactUnknown([
					['shallow', 'deep'],
					['deep', 'safe'],
				]);

				expect(result).toEqual([
					['shallow', '[REDACTED]'],
					['[REDACTED]', 'safe'],
				]);
			});

			it('should handle array of objects', () => {
				const redactor = createSecretsRedactor(['obj-secret']);

				const result = redactor.redactUnknown([
					{ name: 'item1', value: 'obj-secret' },
					{ name: 'item2', value: 'safe' },
				]);

				expect(result).toEqual([
					{ name: 'item1', value: '[REDACTED]' },
					{ name: 'item2', value: 'safe' },
				]);
			});

			it('should handle complex nested structure', () => {
				const redactor = createSecretsRedactor(['complex-secret']);

				const input = {
					message: 'The complex-secret is here',
					data: {
						items: [
							{ id: 1, secret: 'complex-secret' },
							{ id: 2, safe: 'no secret' },
						],
						nested: {
							deep: 'another complex-secret',
						},
					},
					count: 42,
				};

				const result = redactor.redactUnknown(input);

				expect(result).toEqual({
					message: 'The [REDACTED] is here',
					data: {
						items: [
							{ id: 1, secret: '[REDACTED]' },
							{ id: 2, safe: 'no secret' },
						],
						nested: {
							deep: 'another [REDACTED]',
						},
					},
					count: 42,
				});
			});

			it('should handle empty object', () => {
				const redactor = createSecretsRedactor(['secret']);

				const result = redactor.redactUnknown({});

				expect(result).toEqual({});
			});

			it('should handle empty array', () => {
				const redactor = createSecretsRedactor(['secret']);

				const result = redactor.redactUnknown([]);

				expect(result).toEqual([]);
			});
		});

		describe('edge cases', () => {
			it('should trim whitespace from secrets', () => {
				// Secrets with whitespace should be trimmed before use
				const redactor = createSecretsRedactor(['  trimmed-secret  ']);

				const result = redactor.redactString('Found trimmed-secret here');

				expect(result).toBe('Found [REDACTED] here');
			});

			it('should ignore secrets shorter than 3 characters', () => {
				const redactor = createSecretsRedactor(['ab', 'valid-secret']);

				expect(redactor.hasSecrets).toBe(true); // Only valid-secret counts

				const result = redactor.redactString('ab and valid-secret');
				expect(result).toBe('ab and [REDACTED]');
			});

			it('should deduplicate secrets', () => {
				const redactor = createSecretsRedactor(['dup', 'dup', 'unique']);

				expect(redactor.hasSecrets).toBe(true);
			});

			it('should handle secrets with newlines', () => {
				const redactor = createSecretsRedactor(['multi\nline']);

				const result = redactor.redactString('Has multi\nline secret');

				expect(result).toBe('Has [REDACTED] secret');
			});

			it('should handle secrets with tabs', () => {
				const redactor = createSecretsRedactor(['tab\tsecret']);

				const result = redactor.redactString('Found tab\tsecret');

				expect(result).toBe('Found [REDACTED]');
			});
		});
	});
});
