import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Pool } from 'pg';

import { InvocationObservabilityCollector } from '../../operations/executeTask/observability';
import {
	parseObservabilityPersistenceConfig,
	persistInvocationObservability,
} from '../../operations/executeTask/observabilityPostgres';
import { createPostgresConnectionHandle } from '../../../shared/postgresConnection';

vi.mock('../../../shared/postgresConnection', () => ({
	createPostgresConnectionHandle: vi.fn(),
}));

function createCollector(): InvocationObservabilityCollector {
	const collector = new InvocationObservabilityCollector({
		mode: 'full',
		maxEvents: 20,
		maxBytes: 4096,
		redactPayloads: true,
		context: { nodeName: 'Test Node', itemIndex: 0, executionId: 'exec_1' },
	});
	collector.record({
		eventType: 'tool.call.detected',
		status: 'detected',
		toolName: 'Read',
		payload: {
			requestId: 'req_1',
		},
	});
	return collector;
}

function createExecFunctionsStub(): IExecuteFunctions {
	return {
		getCredentials: vi.fn().mockResolvedValue({
			host: '127.0.0.1',
			port: 5432,
			database: 'postgres',
			user: 'postgres',
			password: 'postgres',
		}),
	} as unknown as IExecuteFunctions;
}

function createPoolQueryMock() {
	return vi.fn(async (sql: string) => {
		if (sql.includes('to_regclass')) {
			return { rows: [{ regclass: null }], rowCount: 1 };
		}
		if (sql.includes('INSERT INTO')) {
			return { rows: [], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
}

describe('observabilityPostgres persistence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('parses persistence settings with safe defaults', () => {
		expect(parseObservabilityPersistenceConfig({})).toEqual({
			backend: 'auto',
			strict: false,
			tableName: 'claude_invocation_observability_events',
			credentialName: 'postgres',
		});

		expect(parseObservabilityPersistenceConfig({
			observabilityPersistenceBackend: 'postgres',
			observabilityPersistenceStrict: true,
			observabilityPostgresTable: 'custom_obs',
			observabilityPostgresCredentialName: 'my_pg',
		})).toEqual({
			backend: 'postgres',
			strict: true,
			tableName: 'custom_obs',
			credentialName: 'my_pg',
		});
	});

	it('no-ops when backend is runDataOnly', async () => {
		const result = await persistInvocationObservability({
			execFunctions: createExecFunctionsStub(),
			collector: createCollector(),
			terminalStatus: 'completed',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
			},
			config: {
				backend: 'runDataOnly',
				strict: false,
				tableName: 'ignored',
				credentialName: 'postgres',
			},
		});

		expect(result.attempted).toBe(false);
		expect(result.persisted).toBe(false);
		expect(result.rowCount).toBe(0);
		expect(createPostgresConnectionHandle).not.toHaveBeenCalled();
	});

	it('auto backend no-ops when postgres credential is not configured', async () => {
		const execFunctions = {
			getCredentials: vi.fn().mockRejectedValue(new Error('credential missing')),
		} as unknown as IExecuteFunctions;

		const result = await persistInvocationObservability({
			execFunctions,
			collector: createCollector(),
			terminalStatus: 'completed',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
			},
			config: {
				backend: 'auto',
				strict: false,
				tableName: 'ignored',
				credentialName: 'postgres',
			},
		});

		expect(result.attempted).toBe(false);
		expect(result.persisted).toBe(false);
		expect(result.rowCount).toBe(0);
		expect(result.error).toContain('not configured on Claude Agent SDK node');
		expect(createPostgresConnectionHandle).not.toHaveBeenCalled();
	});

	it('persists invocation events to postgres when backend is enabled', async () => {
		const query = createPoolQueryMock();
		const close = vi.fn();
		vi.mocked(createPostgresConnectionHandle).mockResolvedValue({
			pool: { query } as unknown as Pool,
			close,
		} as unknown as Awaited<ReturnType<typeof createPostgresConnectionHandle>>);

		const result = await persistInvocationObservability({
			execFunctions: createExecFunctionsStub(),
			collector: createCollector(),
			terminalStatus: 'completed',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
				chatSessionId: 'chat_1',
				sessionId: 'session_1',
				correlationId: 'corr_1',
			},
			config: {
				backend: 'postgres',
				strict: false,
				tableName: 'claude_invocation_observability_events',
				credentialName: 'postgres',
			},
		});

		expect(result.attempted).toBe(true);
		expect(result.persisted).toBe(true);
		expect(result.rowCount).toBeGreaterThan(0);
		expect(query).toHaveBeenCalled();
		expect(close).toHaveBeenCalled();
	});

	it('falls back without throwing when strict mode is disabled', async () => {
		vi.mocked(createPostgresConnectionHandle).mockRejectedValue(new Error('db down'));

		const result = await persistInvocationObservability({
			execFunctions: createExecFunctionsStub(),
			collector: createCollector(),
			terminalStatus: 'failed',
			context: {
				workflowId: 'wf_1',
				nodeName: 'Claude Agent SDK',
				executionId: 'exec_1',
				itemIndex: 0,
			},
			config: {
				backend: 'postgres',
				strict: false,
				tableName: 'claude_invocation_observability_events',
				credentialName: 'postgres',
			},
		});

		expect(result.attempted).toBe(true);
		expect(result.persisted).toBe(false);
		expect(result.error).toContain('db down');
	});

	it('throws when strict mode is enabled and persistence fails', async () => {
		vi.mocked(createPostgresConnectionHandle).mockRejectedValue(new Error('db down'));

		await expect(
			persistInvocationObservability({
				execFunctions: createExecFunctionsStub(),
				collector: createCollector(),
				terminalStatus: 'completed',
				context: {
					workflowId: 'wf_1',
					nodeName: 'Claude Agent SDK',
					executionId: 'exec_1',
					itemIndex: 0,
				},
				config: {
					backend: 'postgres',
					strict: true,
					tableName: 'claude_invocation_observability_events',
					credentialName: 'postgres',
				},
			}),
		).rejects.toThrow(/Failed to persist observability events to Postgres table/);
	});
});
