import { describe, expect, it, vi } from 'vitest';

import type { SdkAdapter } from '../../sdk/types';
import { runAgentExecution } from '../../operations/executeTask/steps/runExecution';
import { DEFAULT_MARKERS_JSON_META, DEFAULT_TOOL_STREAM_FILTER } from '../../streaming/types';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

describe('runAgentExecution - resumeSessionAt fallback', () => {
	it('retries with plain resume when resumeSessionAt UUID lookup fails', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn();

		let callCount = 0;
		promptOnce.mockImplementation(() => {
			callCount += 1;
			if (callCount === 1) {
				return (async function* () {
					throw new Error('No message found with message.uuid of: missing_uuid');
				})();
			}
			return (async function* () {
				yield { type: 'result', subtype: 'success' };
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			resume: 'session_123',
			resumeSessionAt: 'missing_uuid',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: true,
		});

		expect(promptOnce).toHaveBeenCalledTimes(2);
		expect(queryOptions.resume).toBe('session_123');
		expect(queryOptions.resumeSessionAt).toBeUndefined();
		expect(result.messages).toEqual([{ type: 'result', subtype: 'success' }]);
	});
});

describe('runAgentExecution - resume retry classification', () => {
	it('retries deterministic bootstrap as resume when sessionId is already in use', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn();
		const optionSnapshots: Array<Record<string, unknown>> = [];

		let callCount = 0;
		promptOnce.mockImplementation((_prompt: string, queryOptions?: Record<string, unknown>) => {
			optionSnapshots.push({ ...(queryOptions ?? {}) });
			callCount += 1;
			if (callCount === 1) {
				return (async function* () {
					throw new Error(
						'Claude Code process exited with code 1\n\n' +
						'Claude CLI stderr output:\n' +
						'Error: Session ID deterministic-chat-id is already in use.\n' +
						'Bad request - please check your parameters',
					);
				})();
			}
			return (async function* () {
				yield { type: 'result', subtype: 'success' };
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			sessionId: 'deterministic-chat-id',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		});

		expect(promptOnce).toHaveBeenCalledTimes(2);
		const firstOptions = optionSnapshots[0];
		const secondOptions = optionSnapshots[1];
		expect(firstOptions.sessionId).toBe('deterministic-chat-id');
		expect(firstOptions.resume).toBeUndefined();
		expect(secondOptions.resume).toBe('deterministic-chat-id');
		expect(secondOptions.sessionId).toBeUndefined();
		expect(result.messages).toEqual([{ type: 'result', subtype: 'success' }]);
	});

	it('falls back to fresh when bootstrap-collision resume fails with invalid replay signature', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn();
		const optionSnapshots: Array<Record<string, unknown>> = [];

		let callCount = 0;
		promptOnce.mockImplementation((_prompt: string, queryOptions?: Record<string, unknown>) => {
			optionSnapshots.push({ ...(queryOptions ?? {}) });
			callCount += 1;
			if (callCount === 1) {
				return (async function* () {
					throw new Error(
						'Claude Code process exited with code 1\n\n' +
						'Claude CLI stderr output:\n' +
						'Error: Session ID deterministic-chat-id is already in use.\n' +
						'Bad request - please check your parameters',
					);
				})();
			}
			if (callCount === 2) {
				return (async function* () {
					throw new Error(
						'API Error: 400 {"type":"error","error":{"type":"invalid_request_error",' +
						'"message":"messages.1.content.0: Invalid `signature` in `thinking` block"}}',
					);
				})();
			}
			return (async function* () {
				yield { type: 'result', subtype: 'success' };
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			sessionId: 'deterministic-chat-id',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		});

		expect(promptOnce).toHaveBeenCalledTimes(3);
		expect(optionSnapshots[0].sessionId).toBe('deterministic-chat-id');
		expect(optionSnapshots[0].resume).toBeUndefined();
		expect(optionSnapshots[1].resume).toBe('deterministic-chat-id');
		expect(optionSnapshots[1].sessionId).toBeUndefined();
		expect(optionSnapshots[2].resume).toBeUndefined();
		expect(optionSnapshots[2].sessionId).toBeUndefined();
		expect(queryOptions.resume).toBeUndefined();
		expect(queryOptions.sessionId).toBeUndefined();
		expect(result.messages).toEqual([{ type: 'result', subtype: 'success' }]);
	});

	it('retries fresh when resume fails with a retryable session error', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn();

		let callCount = 0;
		promptOnce.mockImplementation(() => {
			callCount += 1;
			if (callCount === 1) {
				return (async function* () {
					throw new Error(
						'Claude Code process exited with code 1\n\n' +
						'Claude CLI stderr output:\n' +
						'Error: Session ID deterministic-chat-id is already in use.\n' +
						'Bad request - please check your parameters',
					);
				})();
			}
			return (async function* () {
				yield { type: 'result', subtype: 'success' };
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			resume: 'deterministic-chat-id',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		});

		expect(promptOnce).toHaveBeenCalledTimes(2);
		// Retry starts fresh by clearing deterministic IDs.
		expect(queryOptions.sessionId).toBeUndefined();
		expect(queryOptions.resume).toBeUndefined();
		expect(result.messages).toEqual([{ type: 'result', subtype: 'success' }]);
	});

	it('clears deterministic IDs when resume fallback starts fresh', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn();

		let callCount = 0;
		promptOnce.mockImplementation(() => {
			callCount += 1;
			if (callCount <= 1) {
				return (async function* () {
					throw new Error(
						'Claude Code process exited with code 1\n\n' +
						'Claude CLI stderr output:\n' +
						'Error: Session resume failed for some-session\n' +
						'Bad request - please check your parameters',
					);
				})();
			}
			return (async function* () {
				yield { type: 'result', subtype: 'success' };
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			resume: 'some-session',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		});

		// Resume failure handler clears resume to avoid retry loops on deterministic IDs.
		expect(promptOnce).toHaveBeenCalledTimes(2);
		expect(queryOptions.resume).toBeUndefined();
		expect(result.messages).toEqual([{ type: 'result', subtype: 'success' }]);
	});

	it('retries fresh when CLI returns generic exit code 1 without stderr details', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn();

		let callCount = 0;
		promptOnce.mockImplementation(() => {
			callCount += 1;
			if (callCount === 1) {
				return (async function* () {
					throw new Error('Claude Code process exited with code 1');
				})();
			}
			return (async function* () {
				yield { type: 'result', subtype: 'success' };
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			resume: 'sess_generic_exit_1',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		});

		expect(promptOnce).toHaveBeenCalledTimes(2);
		expect(queryOptions.resume).toBeUndefined();
		expect(result.messages).toEqual([{ type: 'result', subtype: 'success' }]);
	});

	it('does not retry for non-retryable policy failures', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn().mockImplementation(() => {
			return (async function* () {
				throw new Error(
					'Claude Code process exited with code 1\n\n' +
					'Claude CLI stderr output:\n' +
					'unable to respond to this request due to Usage Policy',
				);
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			resume: 'sess_policy',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		await expect(runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		})).rejects.toThrow(/Usage Policy/);

		expect(promptOnce).toHaveBeenCalledTimes(1);
		expect(queryOptions.resume).toBe('sess_policy');
	});

	it('does not retry fresh when approval resume blocks fallback', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn().mockImplementation(() => {
			return (async function* () {
				throw new Error(
					'Claude Code process exited with code 1\n\n' +
					'Claude CLI stderr output:\n' +
					'Error: Session ID sess_hitl is already in use.\n' +
					'Bad request - please check your parameters',
				);
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			resume: 'sess_hitl',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		await expect(runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: true,
			preventFreshFallbackOnResumeFailure: true,
		})).rejects.toThrow(/already in use/);

		expect(promptOnce).toHaveBeenCalledTimes(1);
		expect(queryOptions.resume).toBe('sess_hitl');
	});

	it('retries once as fresh when resumed execution returns an empty message stream', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn();

		let callCount = 0;
		promptOnce.mockImplementation(() => {
			callCount += 1;
			if (callCount === 1) {
				return (async function* () {
					// Empty stream (no yielded messages)
				})();
			}
			return (async function* () {
				yield { type: 'result', subtype: 'success' };
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {
			resume: 'sess_empty_stream_resume',
			resumeSessionAt: 'uuid-anchor',
		};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		const result = await runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		});

		expect(promptOnce).toHaveBeenCalledTimes(2);
		expect(queryOptions.resume).toBeUndefined();
		expect(queryOptions.resumeSessionAt).toBeUndefined();
		expect(result.messages).toEqual([{ type: 'result', subtype: 'success' }]);
	});

	it('throws when execution stream stays empty after retry', async () => {
		const exec = createMockExecuteFunctions();
		const promptOnce = vi.fn().mockImplementation(() => {
			return (async function* () {
				// Empty stream (no yielded messages)
			})();
		});

		const adapter = {
			version: 'v1',
			createSession: vi.fn(),
			resumeSession: vi.fn(),
			promptOnce,
		} as unknown as SdkAdapter;

		const queryOptions: Record<string, unknown> = {};
		const streamConfig = {
			enabled: false,
			contentTypes: new Set(),
			useMarkers: false,
			markerFormat: 'jsonMeta' as const,
			markers: DEFAULT_MARKERS_JSON_META,
			toolInputDisplay: 'full' as const,
			toolResultDisplay: 'full' as const,
			truncationLimit: 1000,
			toolFilter: DEFAULT_TOOL_STREAM_FILTER,
		};

		await expect(runAgentExecution({
			execFunctions: exec,
			itemIndex: 0,
			adapter,
			taskDescription: 'Task',
			queryOptions,
			shouldStream: false,
			streamConfig,
			stderrOutput: [],
			sharedState: {},
			isApprovalResume: false,
		})).rejects.toThrow(/returned no messages/i);

		expect(promptOnce).toHaveBeenCalledTimes(2);
	});
});
