import { describe, expect, it, vi } from 'vitest';

import type { SdkAdapter } from '../../sdk/types';
import { runAgentExecution } from '../../operations/executeTask/steps/runExecution';
import { DEFAULT_MARKERS_JSON_META, DEFAULT_TOOL_STREAM_FILTER } from '../../streaming/types';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

function createStreamConfig() {
	return {
		enabled: true,
		contentTypes: new Set(['assistant', 'result', 'system']),
		useMarkers: false,
		markerFormat: 'jsonMeta' as const,
		markers: DEFAULT_MARKERS_JSON_META,
		toolInputDisplay: 'full' as const,
		toolResultDisplay: 'full' as const,
		truncationLimit: 1000,
		toolFilter: DEFAULT_TOOL_STREAM_FILTER,
	};
}

function createAdapterWithMessages() {
	const promptOnce = vi.fn().mockImplementation(() => {
		return (async function* () {
			yield { type: 'system', subtype: 'init', session_id: 'session_123' };
			yield {
				type: 'user',
				uuid: 'replay_user_uuid',
				isReplay: true,
				message: { role: 'user', content: [{ type: 'text', text: 'old prompt' }] },
				parent_tool_use_id: null,
				session_id: 'session_123',
			};
			yield {
				type: 'assistant',
				uuid: 'replay_uuid',
				isReplay: true,
				message: { content: [{ type: 'text', text: 'old text' }] },
			};
			yield {
				type: 'user',
				uuid: 'live_user_uuid',
				message: { role: 'user', content: [{ type: 'text', text: 'continue' }] },
				parent_tool_use_id: null,
				session_id: 'session_123',
			};
			yield {
				type: 'assistant',
				uuid: 'new_uuid',
				message: { content: [{ type: 'text', text: 'new text' }] },
			};
			yield { type: 'result', subtype: 'success' };
		})();
	});

	const adapter = {
		version: 'v1',
		createSession: vi.fn(),
		resumeSession: vi.fn(),
		promptOnce,
	} as unknown as SdkAdapter;

	return { adapter, promptOnce };
}

function getStreamedAssistantUuids(sendChunkFn: ReturnType<typeof vi.fn>): string[] {
	return sendChunkFn.mock.calls
		.filter((call) => call[0] === 'item')
		.map((call) => call[2] as Record<string, unknown>)
		.filter((payload) => payload.type === 'assistant')
		.map((payload) => payload.uuid as string);
}

describe('runAgentExecution - replay streaming suppression', () => {
	it('suppresses replay messages in resumed continuation streams', async () => {
		const exec = createMockExecuteFunctions();
		const { adapter } = createAdapterWithMessages();
		const sendChunkFn = vi.fn();

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions: {},
			shouldStream: true,
			activeSendChunkFn: sendChunkFn,
			streamConfig: createStreamConfig(),
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: true,
			suppressReplayStreamingMessages: true,
		});

		expect(getStreamedAssistantUuids(sendChunkFn)).toEqual(['new_uuid']);
		expect(result.messages.some((m) => (m as { uuid?: string }).uuid === 'replay_uuid')).toBe(false);
		expect(result.messages.some((m) => (m as { uuid?: string }).uuid === 'new_uuid')).toBe(true);
	});

	it('keeps replay messages when suppression is disabled', async () => {
		const exec = createMockExecuteFunctions();
		const { adapter } = createAdapterWithMessages();
		const sendChunkFn = vi.fn();

		await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions: {},
			shouldStream: true,
			activeSendChunkFn: sendChunkFn,
			streamConfig: createStreamConfig(),
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: true,
		});

		expect(getStreamedAssistantUuids(sendChunkFn)).toEqual(['replay_uuid', 'new_uuid']);
	});
});
