/**
 * Build Environment Tests
 *
 * Tests for environment variable building with different API providers.
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

	describe('Anthropic (default provider)', () => {
		it('should build environment with API key', () => {
			const env = buildEnvironment({ apiKey: 'test-api-key' });

			expect(env.ANTHROPIC_API_KEY).toBe('test-api-key');
			expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
			expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
		});

		it('should not set ANTHROPIC_BASE_URL for default anthropic provider', () => {
			const env = buildEnvironment({ apiKey: 'test-api-key', apiProvider: 'anthropic' });

			expect(env.ANTHROPIC_API_KEY).toBe('test-api-key');
			expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
		});

		it('should set ANTHROPIC_BASE_URL for official Anthropic credential URL overrides', () => {
			const env = buildEnvironment({
				apiKey: 'test-api-key',
				apiProvider: 'anthropic',
				anthropicBaseUrl: 'https://anthropic.example.com/',
			});

			expect(env.ANTHROPIC_API_KEY).toBe('test-api-key');
			expect(env.ANTHROPIC_BASE_URL).toBe('https://anthropic.example.com');
		});

		it('should use environment variable if no API key provided', () => {
			process.env.ANTHROPIC_API_KEY = 'env-api-key';
			const env = buildEnvironment({});

			expect(env.ANTHROPIC_API_KEY).toBe('env-api-key');
		});

		it('should include essential environment variables', () => {
			process.env.PATH = '/usr/bin:/bin';
			process.env.HOME = '/home/user';
			process.env.CLAUDE_CONFIG_DIR = '/home/user/.claude';

			const env = buildEnvironment({ apiKey: 'test-key' });

			expect(env.PATH).toBe('/usr/bin:/bin');
			expect(env.HOME).toBe('/home/user');
			expect(env.CLAUDE_CONFIG_DIR).toBe('/home/user/.claude');
		});

		it('should provide default SHELL and HOME if not set', () => {
			delete process.env.SHELL;
			delete process.env.HOME;

			const env = buildEnvironment({ apiKey: 'test-key' });

			expect(env.SHELL).toBe('/bin/bash');
			expect(env.HOME).toBe('/root');
		});
	});

	describe('OpenRouter provider', () => {
		it('should set ANTHROPIC_BASE_URL for OpenRouter', () => {
			const env = buildEnvironment({ apiKey: 'openrouter-key', apiProvider: 'openrouter' });

			expect(env.ANTHROPIC_API_KEY).toBe('');
			expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('openrouter-key');
		});

		it('should normalize OpenRouter /api/v1 base URL to /api', () => {
			const env = buildEnvironment({
				apiKey: 'openrouter-key',
				apiProvider: 'openrouter',
				openrouterBaseUrl: 'https://openrouter.ai/api/v1',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
		});

		it('should set both API key and auth token for OpenRouter', () => {
			const env = buildEnvironment({ apiKey: 'sk-or-123', apiProvider: 'openrouter' });

			expect(env.ANTHROPIC_API_KEY).toBe('');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-or-123');
		});

		it('should prefer explicit OpenRouter auth token over credential', () => {
			const env = buildEnvironment({
				apiKey: 'credential-key',
				apiProvider: 'openrouter',
				openrouterAuthToken: 'openrouter-token',
			});

			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('openrouter-token');
			expect(env.ANTHROPIC_API_KEY).toBe('');
		});
	});

	describe('Ollama provider', () => {
		it('should set default Ollama base URL', () => {
			const env = buildEnvironment({ apiProvider: 'ollama' });

			expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
		});

		it('should use custom Ollama base URL', () => {
			const env = buildEnvironment({
				apiProvider: 'ollama',
				ollamaBaseUrl: 'http://192.168.1.100:11434',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('http://192.168.1.100:11434');
		});

		it('should use host.docker.internal for Docker environments', () => {
			const env = buildEnvironment({
				apiProvider: 'ollama',
				ollamaBaseUrl: 'http://host.docker.internal:11434',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('http://host.docker.internal:11434');
		});

		it('should work without API key for local Ollama', () => {
			const env = buildEnvironment({ apiProvider: 'ollama' });

			expect(env.ANTHROPIC_API_KEY).toBe('ollama');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('ollama');
			expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
		});

		it('should prefer explicit Ollama auth token', () => {
			const env = buildEnvironment({
				apiProvider: 'ollama',
				ollamaAuthToken: 'custom-ollama-token',
			});

			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('custom-ollama-token');
			expect(env.ANTHROPIC_API_KEY).toBe('custom-ollama-token');
		});
	});

	describe('Custom endpoint provider', () => {
		it('should set custom API endpoint', () => {
			const env = buildEnvironment({
				apiKey: 'custom-key',
				apiProvider: 'custom',
				customApiEndpoint: 'https://my-proxy.example.com/v1',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('https://my-proxy.example.com/v1');
			expect(env.ANTHROPIC_API_KEY).toBe('custom-key');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('custom-key');
		});

		it('should not set base URL if custom endpoint not provided', () => {
			const env = buildEnvironment({ apiKey: 'custom-key', apiProvider: 'custom' });

			expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
		});

		it('should set both API key and auth token for custom endpoints', () => {
			const env = buildEnvironment({
				apiKey: 'sk-custom-123',
				apiProvider: 'custom',
				customApiEndpoint: 'https://custom.api.com',
			});

			expect(env.ANTHROPIC_API_KEY).toBe('sk-custom-123');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-custom-123');
		});
	});

	describe('LiteLLM provider', () => {
		it('should set LiteLLM provider env vars and selected model alias', () => {
			const env = buildEnvironment({
				apiProvider: 'litellm',
				anthropicBaseUrl: 'https://api.anthropic.com',
				liteLlmAuthToken: 'litellm-key',
				liteLlmBaseUrl: 'http://proxy.local:4000/v1/',
				liteLlmModel: 'claude-alias',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('http://proxy.local:4000');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('litellm-key');
			expect(env.ANTHROPIC_API_KEY).toBe('');
			expect(env.ANTHROPIC_MODEL).toBe('claude-alias');
		});

		it('should default LiteLLM base URL and clear direct Anthropic API key fallback', () => {
			process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';
			const env = buildEnvironment({
				apiProvider: 'litellm',
				liteLlmAuthToken: 'litellm-key',
				liteLlmModel: 'manual-alias',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:4000');
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('litellm-key');
			expect(env.ANTHROPIC_API_KEY).toBe('');
			expect(env.ANTHROPIC_MODEL).toBe('manual-alias');
		});
	});

	describe('Additional environment variables', () => {
		it('should merge additional environment variables', () => {
			const additionalEnv = JSON.stringify({
				NODE_ENV: 'production',
				DEBUG: 'true',
			});

			const env = buildEnvironment({ apiKey: 'test-key', additionalEnv: additionalEnv });

			expect(env.NODE_ENV).toBe('production');
			expect(env.DEBUG).toBe('true');
			expect(env.ANTHROPIC_API_KEY).toBe('test-key');
		});

		it('should allow user env to override system env', () => {
			process.env.PATH = '/usr/bin';

			const additionalEnv = JSON.stringify({
				PATH: '/custom/bin:/usr/bin',
			});

			const env = buildEnvironment({ apiKey: 'test-key', additionalEnv: additionalEnv });

			expect(env.PATH).toBe('/custom/bin:/usr/bin');
		});

		it('should handle empty additional env', () => {
			const env = buildEnvironment({ apiKey: 'test-key', additionalEnv: '{}' });

			expect(env.ANTHROPIC_API_KEY).toBe('test-key');
		});

		it('should throw error for invalid JSON in additional env', () => {
			expect(() => {
				buildEnvironment({ apiKey: 'test-key', additionalEnv: '{invalid json}' });
			}).toThrow(/Invalid JSON in Environment Variables/);
		});
	});

	describe('Proxy manager environment variables', () => {
		it('should inject proxy variables when proxy manager is enabled', () => {
			const env = buildEnvironment({
				apiKey: 'test-key',
				apiProvider: 'anthropic',
				proxyManager: {
					enabled: true,
					httpProxyUrl: 'http://proxy.internal:8080',
					httpsProxyUrl: 'https://proxy.internal:8443',
					noProxy: 'localhost,127.0.0.1,.internal',
					caBundlePath: '/etc/pki/proxy-ca.pem',
				},
			});

			expect(env.HTTP_PROXY).toBe('http://proxy.internal:8080');
			expect(env.http_proxy).toBe('http://proxy.internal:8080');
			expect(env.HTTPS_PROXY).toBe('https://proxy.internal:8443');
			expect(env.https_proxy).toBe('https://proxy.internal:8443');
			expect(env.NO_PROXY).toBe('localhost,127.0.0.1,.internal');
			expect(env.no_proxy).toBe('localhost,127.0.0.1,.internal');
			expect(env.SSL_CERT_FILE).toBe('/etc/pki/proxy-ca.pem');
			expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/pki/proxy-ca.pem');
			expect(env.REQUESTS_CA_BUNDLE).toBe('/etc/pki/proxy-ca.pem');
			expect(env.CURL_CA_BUNDLE).toBe('/etc/pki/proxy-ca.pem');
			expect(env.GIT_SSL_CAINFO).toBe('/etc/pki/proxy-ca.pem');
		});

		it('should not override explicit user proxy values when proxy manager is disabled', () => {
			const additionalEnv = JSON.stringify({
				HTTP_PROXY: 'http://user-proxy.example.com:8080',
				HTTPS_PROXY: 'https://user-proxy.example.com:8443',
				NO_PROXY: 'localhost',
			});

			const env = buildEnvironment({
				apiKey: 'test-key',
				additionalEnv: additionalEnv,
				apiProvider: 'anthropic',
				proxyManager: {
					enabled: false,
					httpProxyUrl: 'http://corp-proxy.example.com:8080',
				},
			});

			expect(env.HTTP_PROXY).toBe('http://user-proxy.example.com:8080');
			expect(env.HTTPS_PROXY).toBe('https://user-proxy.example.com:8443');
			expect(env.NO_PROXY).toBe('localhost');
		});
	});

	describe('Environment security allowlist mode', () => {
		it('should keep only allowlisted and essential env vars when allowlist mode is enabled', () => {
			process.env.PATH = '/usr/bin';
			process.env.HOME = '/home/user';
			const additionalEnv = JSON.stringify({
				NODE_ENV: 'production',
				DEBUG: '1',
				FOO: 'bar',
			});

			const env = buildEnvironment({
				apiKey: 'test-key',
				additionalEnv: additionalEnv,
				apiProvider: 'anthropic',
				environmentSecurity: {
					envSecurityMode: 'allowlist',
					allowedEnvVarNames: ['NODE_ENV', 'DEBUG'],
				},
			});

			expect(env.ANTHROPIC_API_KEY).toBe('test-key');
			expect(env.NODE_ENV).toBe('production');
			expect(env.DEBUG).toBe('1');
			expect(env.FOO).toBeUndefined();
			expect(env.PATH).toBe('/usr/bin');
			expect(env.HOME).toBe('/home/user');
		});

		it('should keep proxy env vars in allowlist mode without user allowlist entry', () => {
			const env = buildEnvironment({
				apiKey: 'test-key',
				apiProvider: 'anthropic',
				environmentSecurity: {
					envSecurityMode: 'allowlist',
					allowedEnvVarNames: [],
				},
				proxyManager: {
					enabled: true,
					httpProxyUrl: 'http://proxy.internal:8080',
				},
			});

			expect(env.HTTP_PROXY).toBe('http://proxy.internal:8080');
			expect(env.http_proxy).toBe('http://proxy.internal:8080');
			expect(env.NO_PROXY).toBeUndefined();
			expect(env.ANTHROPIC_API_KEY).toBe('test-key');
		});

		it('should intersect user allowlist with operator policy allowlist', () => {
			const additionalEnv = JSON.stringify({
				NODE_ENV: 'production',
				DEBUG: '1',
			});

			const env = buildEnvironment({
				apiKey: 'test-key',
				additionalEnv: additionalEnv,
				apiProvider: 'anthropic',
				environmentSecurity: {
					envSecurityMode: 'allowlist',
					allowedEnvVarNames: ['NODE_ENV', 'DEBUG'],
					policyAllowedEnvVarNames: ['NODE_ENV'],
				},
			});

			expect(env.NODE_ENV).toBe('production');
			expect(env.DEBUG).toBeUndefined();
		});

		it('should enforce CLAUDE_CONFIG_DIR override when provided', () => {
			const env = buildEnvironment({
				apiKey: 'test-key',
				apiProvider: 'anthropic',
				environmentSecurity: {
					claudeConfigDir: '/work/.claude-n8n/wf-1',
				},
			});

			expect(env.CLAUDE_CONFIG_DIR).toBe('/work/.claude-n8n/wf-1');
		});
	});

	describe('Environment variable precedence', () => {
		it('should prioritize credential over environment variable', () => {
			process.env.ANTHROPIC_API_KEY = 'env-key';

			const env = buildEnvironment({ apiKey: 'credential-key' });

			expect(env.ANTHROPIC_API_KEY).toBe('credential-key');
		});

		it('should use environment variable when no credential provided', () => {
			process.env.ANTHROPIC_API_KEY = 'env-key';

			const env = buildEnvironment({});

			expect(env.ANTHROPIC_API_KEY).toBe('env-key');
		});

		it('should allow additional env to override ANTHROPIC_BASE_URL', () => {
			const additionalEnv = JSON.stringify({
				ANTHROPIC_BASE_URL: 'https://override.example.com',
			});

			const env = buildEnvironment({
				apiKey: 'test-key',
				additionalEnv: additionalEnv,
				apiProvider: 'openrouter',
			});

			// User-provided env takes precedence over provider-set env
			expect(env.ANTHROPIC_BASE_URL).toBe('https://override.example.com');
		});
	});

	describe('Provider combinations', () => {
		it('should handle all providers with API key', () => {
			const providers: Array<'anthropic' | 'openrouter' | 'ollama' | 'custom' | 'litellm'> = [
				'anthropic',
				'openrouter',
				'ollama',
				'custom',
				'litellm',
			];

			for (const provider of providers) {
				const env = buildEnvironment({ apiKey: 'test-key', apiProvider: provider });
				if (provider === 'openrouter') {
					// OpenRouter requires empty API key, uses auth token instead
					expect(env.ANTHROPIC_API_KEY).toBe('');
					expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-key');
				} else if (provider === 'ollama') {
					// Ollama uses 'ollama' as default placeholder (ignores passed API key)
					expect(env.ANTHROPIC_API_KEY).toBe('ollama');
					expect(env.ANTHROPIC_AUTH_TOKEN).toBe('ollama');
				} else if (provider === 'litellm') {
					expect(env.ANTHROPIC_API_KEY).toBe('');
					expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-key');
				} else {
					expect(env.ANTHROPIC_API_KEY).toBe('test-key');
				}
			}
		});

		it('should handle OpenRouter with additional env', () => {
			const additionalEnv = JSON.stringify({
				HTTP_REFERER: 'https://my-app.com',
				X_TITLE: 'My App',
			});

			const env = buildEnvironment({
				apiKey: 'openrouter-key',
				additionalEnv: additionalEnv,
				apiProvider: 'openrouter',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
			expect(env.HTTP_REFERER).toBe('https://my-app.com');
			expect(env.X_TITLE).toBe('My App');
		});

		it('should handle Ollama with custom model via env', () => {
			const additionalEnv = JSON.stringify({
				MODEL: 'deepseek-coder',
			});

			const env = buildEnvironment({
				additionalEnv: additionalEnv,
				apiProvider: 'ollama',
				ollamaBaseUrl: 'http://localhost:11434',
			});

			expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
			expect(env.MODEL).toBe('deepseek-coder');
		});
	});

	describe('Error handling', () => {
		it('should throw error for malformed JSON with trailing comma', () => {
			expect(() => {
				buildEnvironment({ apiKey: 'test-key', additionalEnv: '{"key": "value",}' });
			}).toThrow(/Invalid JSON in Environment Variables/);
		});

		it('should throw error for JSON array instead of object', () => {
			expect(() => {
				buildEnvironment({ apiKey: 'test-key', additionalEnv: '["not", "an", "object"]' });
			}).not.toThrow(); // Arrays are valid JSON, but may cause issues downstream
		});

		it('should throw error for unclosed JSON string', () => {
			expect(() => {
				buildEnvironment({ apiKey: 'test-key', additionalEnv: '{"key": "value' });
			}).toThrow(/Invalid JSON in Environment Variables/);
		});

		it('should throw error for JSON with single quotes', () => {
			expect(() => {
				buildEnvironment({ apiKey: 'test-key', additionalEnv: "{'key': 'value'}" });
			}).toThrow(/Invalid JSON in Environment Variables/);
		});

		it('should throw error for completely invalid input', () => {
			expect(() => {
				buildEnvironment({ apiKey: 'test-key', additionalEnv: 'not json at all' });
			}).toThrow(/Invalid JSON in Environment Variables/);
		});

		it('should handle whitespace-only auth token for OpenRouter', () => {
			const env = buildEnvironment({
				apiKey: 'credential-key',
				apiProvider: 'openrouter',
				openrouterAuthToken: '   ',
			});

			// Should fall back to credential key when auth token is whitespace-only
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('credential-key');
		});

		it('should handle whitespace-only auth token for Ollama', () => {
			const env = buildEnvironment({ apiProvider: 'ollama', ollamaAuthToken: '   ' });

			// Should fall back to default 'ollama' when auth token is whitespace-only
			expect(env.ANTHROPIC_AUTH_TOKEN).toBe('ollama');
			expect(env.ANTHROPIC_API_KEY).toBe('ollama');
		});

		it('should handle empty string API key', () => {
			const env = buildEnvironment({ apiKey: '', apiProvider: 'anthropic' });

			// Empty string is falsy, should not set ANTHROPIC_API_KEY
			expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		});

		it('should handle null-like values in additional env', () => {
			const additionalEnv = JSON.stringify({
				NULL_VALUE: null,
				UNDEFINED_VALUE: undefined,
				EMPTY_STRING: '',
			});

			const env = buildEnvironment({ apiKey: 'test-key', additionalEnv: additionalEnv });

			// null means "not set" — dropped from the subprocess env
			expect(env.NULL_VALUE).toBeUndefined();
			expect(env.UNDEFINED_VALUE).toBeUndefined();
			expect(env.EMPTY_STRING).toBe('');
		});
	});
});
