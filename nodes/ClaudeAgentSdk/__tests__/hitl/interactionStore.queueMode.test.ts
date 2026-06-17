import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
});
