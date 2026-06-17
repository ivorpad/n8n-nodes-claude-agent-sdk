/**
 * Build Environment Tests — CodeMie Proxy provider branch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildEnvironment } from '../../operations/executeTask/config';

describe('buildEnvironment — CodeMie Proxy', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('emits the proxy URL, gateway token, empty API key, and model', () => {
		const env = buildEnvironment({
			apiProvider: 'codemie',
			codeMieBaseUrl: 'http://127.0.0.1:4001',
			codeMieAuthToken: 'codemie-proxy',
			codeMieModel: 'claude-sonnet-4-5-20250929',
		});

		expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:4001');
		expect(env.ANTHROPIC_AUTH_TOKEN).toBe('codemie-proxy');
		expect(env.ANTHROPIC_API_KEY).toBe('');
		expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5-20250929');
	});

	it('falls back to the default proxy base URL when none is provided', () => {
		const env = buildEnvironment({
			apiProvider: 'codemie',
			codeMieAuthToken: 'codemie-proxy',
			codeMieModel: 'claude-sonnet-4-5-20250929',
		});

		expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:4001');
	});

	it('leaves ANTHROPIC_MODEL unset when no model is selected', () => {
		const env = buildEnvironment({
			apiProvider: 'codemie',
			codeMieBaseUrl: 'http://127.0.0.1:4001',
			codeMieAuthToken: 'codemie-proxy',
		});

		expect(env.ANTHROPIC_MODEL).toBeUndefined();
		expect(env.ANTHROPIC_API_KEY).toBe('');
	});
});
