import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagedAgentAdapter } from '../../managedAgent/adapter';
import type { ManagedAgentRawEvent } from '../../managedAgent/types';
import type { NodeQueryOptions } from '../../sdk/types';

const anthropicMocks = vi.hoisted(() => ({
	create: vi.fn(),
	stream: vi.fn(),
	send: vi.fn(),
	filesList: vi.fn(),
	filesDownload: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: vi.fn(function AnthropicMock() {
		return {
			beta: {
				sessions: {
					create: anthropicMocks.create,
					events: {
						stream: anthropicMocks.stream,
						send: anthropicMocks.send,
					},
				},
				files: {
					list: anthropicMocks.filesList,
					download: anthropicMocks.filesDownload,
				},
			},
		};
	}),
}));

function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}

function makeRunningThenIdleEvents(): AsyncIterable<ManagedAgentRawEvent> {
	return makeAsyncIterable([
		{
			type: 'agent.message',
			id: 'evt_message_123',
			processed_at: '2026-06-12T10:00:00Z',
			content: [{ type: 'text', text: 'Working' }],
		} as ManagedAgentRawEvent,
		{
			type: 'session.status_idle',
			id: 'evt_idle_123',
			processed_at: '2026-06-12T10:00:01Z',
			stop_reason: { type: 'end_turn' },
		} as ManagedAgentRawEvent,
	]);
}

describe('ManagedAgentAdapter', () => {
	beforeEach(() => {
		anthropicMocks.create.mockReset();
		anthropicMocks.stream.mockReset();
		anthropicMocks.send.mockReset();
		anthropicMocks.filesList.mockReset();
		anthropicMocks.filesDownload.mockReset();

		anthropicMocks.create.mockResolvedValue({ id: 'sesn_new' });
		anthropicMocks.stream.mockResolvedValue(makeRunningThenIdleEvents());
		anthropicMocks.send.mockResolvedValue({});
		anthropicMocks.filesList.mockResolvedValue(makeAsyncIterable([]));
	});

	it('does not send an interrupt before a managed session is active', async () => {
		const adapter = new ManagedAgentAdapter({
			apiKey: 'test-api-key',
			agentId: 'agent_test',
			environmentId: 'env_test',
		});

		const query = adapter.promptOnce('hello', {} as NodeQueryOptions);
		await query.interrupt?.();

		expect(anthropicMocks.create).not.toHaveBeenCalled();
		expect(anthropicMocks.send).not.toHaveBeenCalled();
	});

	it('sends user.interrupt to the active managed session', async () => {
		const adapter = new ManagedAgentAdapter({
			apiKey: 'test-api-key',
			agentId: 'agent_test',
			environmentId: 'env_test',
		});

		const query = adapter.promptOnce('hello', {} as NodeQueryOptions);
		const iterator = query[Symbol.asyncIterator]();
		const first = await iterator.next();
		expect(first.value?.type).toBe('assistant');

		await query.interrupt?.();

		expect(anthropicMocks.send).toHaveBeenCalledWith('sesn_new', {
			events: [{ type: 'user.interrupt' }],
		});
		await iterator.return?.();
	});

	it('sends user.interrupt to an existing session during custom tool resume', async () => {
		const adapter = new ManagedAgentAdapter({
			apiKey: 'test-api-key',
		});
		const query = adapter.promptOnce('ignored', {
			managedResumeWithToolResult: {
				sessionId: 'sesn_paused',
				customToolUseId: 'sevt_question',
				content: 'blue',
			},
		} as NodeQueryOptions);

		const iterator = query[Symbol.asyncIterator]();
		const first = await iterator.next();
		expect(first.value?.type).toBe('assistant');

		await query.interrupt?.();

		expect(anthropicMocks.send).toHaveBeenCalledWith('sesn_paused', {
			events: [{ type: 'user.interrupt' }],
		});
		await iterator.return?.();
	});

	it('creates sessions with pinned version, vault IDs, metadata, title, and resources', async () => {
		const adapter = new ManagedAgentAdapter({
			apiKey: 'test-api-key',
			agentId: 'agent_test',
			agentVersion: 3,
			environmentId: 'env_test',
			sessionTitle: 'Release review',
			sessionMetadata: { workflow: 'release' },
			vaultIds: ['vlt_one'],
			resources: [
				{
					type: 'file',
					file_id: 'file_123',
					mount_path: '/mnt/session/uploads/spec.md',
				},
				{
					type: 'memory_store',
					memory_store_id: 'memstore_123',
					access: 'read_only',
				},
			],
		});

		const query = adapter.promptOnce('hello', {} as NodeQueryOptions);
		const iterator = query[Symbol.asyncIterator]();
		await iterator.next();

		expect(anthropicMocks.create).toHaveBeenCalledWith({
			agent: {
				type: 'agent',
				id: 'agent_test',
				version: 3,
			},
			environment_id: 'env_test',
			title: 'Release review',
			metadata: { workflow: 'release' },
			vault_ids: ['vlt_one'],
			resources: [
				{
					type: 'file',
					file_id: 'file_123',
					mount_path: '/mnt/session/uploads/spec.md',
				},
				{
					type: 'memory_store',
					memory_store_id: 'memstore_123',
					access: 'read_only',
				},
			],
		});
		await iterator.return?.();
	});

	it('sends user.tool_confirmation for managed permission approval resumes', async () => {
		const adapter = new ManagedAgentAdapter({
			apiKey: 'test-api-key',
		});
		const query = adapter.promptOnce('ignored', {
			managedResumeWithToolConfirmation: {
				sessionId: 'sesn_paused',
				toolUseId: 'sevt_tool',
				approved: true,
				sessionThreadId: 'sthr_child',
			},
		} as NodeQueryOptions);

		const iterator = query[Symbol.asyncIterator]();
		const first = await iterator.next();
		expect(first.value?.type).toBe('assistant');

		expect(anthropicMocks.create).not.toHaveBeenCalled();
		expect(anthropicMocks.send).toHaveBeenCalledWith('sesn_paused', {
			events: [
				{
					type: 'user.tool_confirmation',
					tool_use_id: 'sevt_tool',
					result: 'allow',
					session_thread_id: 'sthr_child',
				},
			],
		});
		await iterator.return?.();
	});

	it('sends deny_message for managed permission denial resumes', async () => {
		const adapter = new ManagedAgentAdapter({
			apiKey: 'test-api-key',
		});
		const query = adapter.promptOnce('ignored', {
			managedResumeWithToolConfirmation: {
				sessionId: 'sesn_paused',
				toolUseId: 'sevt_tool',
				approved: false,
				denyMessage: 'Do not run this command',
			},
		} as NodeQueryOptions);

		const iterator = query[Symbol.asyncIterator]();
		await iterator.next();

		expect(anthropicMocks.send).toHaveBeenCalledWith('sesn_paused', {
			events: [
				{
					type: 'user.tool_confirmation',
					tool_use_id: 'sevt_tool',
					result: 'deny',
					deny_message: 'Do not run this command',
				},
			],
		});
		await iterator.return?.();
	});
});
