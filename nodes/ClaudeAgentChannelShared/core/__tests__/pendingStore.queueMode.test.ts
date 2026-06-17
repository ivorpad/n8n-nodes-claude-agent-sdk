import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { createPendingHitlStore } from '../pendingStore';
import { isN8nQueueMode } from '../queueMode';
import type { PendingCompanionHitlRecord } from '../types';

const ORIGINAL_EXECUTIONS_MODE = process.env.EXECUTIONS_MODE;
const ORIGINAL_N8N_EXECUTIONS_MODE = process.env.N8N_EXECUTIONS_MODE;

function restoreQueueModeEnv(): void {
	if (ORIGINAL_EXECUTIONS_MODE === undefined) {
		delete process.env.EXECUTIONS_MODE;
	} else {
		process.env.EXECUTIONS_MODE = ORIGINAL_EXECUTIONS_MODE;
	}

	if (ORIGINAL_N8N_EXECUTIONS_MODE === undefined) {
		delete process.env.N8N_EXECUTIONS_MODE;
	} else {
		process.env.N8N_EXECUTIONS_MODE = ORIGINAL_N8N_EXECUTIONS_MODE;
	}
}

function createContext(): IExecuteFunctions {
	const staticData: Record<string, unknown> = {};
	return {
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(() => ({
			name: 'Companion Node',
			type: 'claudeAgentCompanion',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		} as INode)),
	} as unknown as IExecuteFunctions;
}

const pendingRecord: PendingCompanionHitlRecord = {
	requestId: 'req_queue_1',
	kind: 'approval',
	status: 'pending',
	createdAt: Date.now(),
	timeoutMs: 60_000,
};

describe('static pending HITL store queue-mode guard', () => {
	beforeEach(() => {
		delete process.env.EXECUTIONS_MODE;
		delete process.env.N8N_EXECUTIONS_MODE;
	});

	afterEach(() => {
		restoreQueueModeEnv();
	});

	it('detects n8n queue mode from supported environment variables', () => {
		expect(isN8nQueueMode({ EXECUTIONS_MODE: 'queue' })).toBe(true);
		expect(isN8nQueueMode({ N8N_EXECUTIONS_MODE: ' queue ' })).toBe(true);
		expect(isN8nQueueMode({ EXECUTIONS_MODE: 'regular' })).toBe(false);
	});

	it('rejects static-data pending stores in queue mode', () => {
		process.env.EXECUTIONS_MODE = 'queue';
		const ctx = createContext();
		const store = createPendingHitlStore<PendingCompanionHitlRecord>('__test_pending');

		expect(() => store.save(ctx, pendingRecord)).toThrow(/cannot use workflow static data/i);
		expect(ctx.getWorkflowStaticData).not.toHaveBeenCalled();
	});
});
