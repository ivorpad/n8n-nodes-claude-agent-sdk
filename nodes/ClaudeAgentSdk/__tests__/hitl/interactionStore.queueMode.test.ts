import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { INode } from 'n8n-workflow';

import { createHitlInteractionStoreHandle } from '../../hitl/interactionStore';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

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

describe('HITL interaction store queue-mode guard', () => {
	beforeEach(() => {
		delete process.env.EXECUTIONS_MODE;
		delete process.env.N8N_EXECUTIONS_MODE;
	});

	afterEach(() => {
		restoreQueueModeEnv();
	});

	it('rejects SDK HITL static-data fallback in queue mode', async () => {
		process.env.EXECUTIONS_MODE = 'queue';
		const exec = createMockExecuteFunctions();

		await expect(createHitlInteractionStoreHandle({ ctx: exec })).rejects.toThrow(
			/SDK HITL interaction store cannot use workflow static data/i,
		);
	});

	it('fails fast when a stale SDK-level postgres credential is present', async () => {
		const exec = createMockExecuteFunctions();
		exec.getNode.mockReturnValue({
			name: 'Claude Agent SDK',
			type: 'CUSTOM.claudeAgentSdk',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
			credentials: {
				postgres: {
					id: 'stale_postgres_credential',
					name: 'Postgres account',
				},
			},
		} as INode);
		exec.getCredentials.mockRejectedValue(
			new Error(
				'Node type "CUSTOM.claudeAgentSdk" does not have any credentials of type "postgres" defined',
			),
		);

		await expect(createHitlInteractionStoreHandle({ ctx: exec })).rejects.toThrow(
			/remove the Postgres credential from the Claude Agent SDK node/i,
		);
		expect(exec.getCredentials).not.toHaveBeenCalled();
	});
});
