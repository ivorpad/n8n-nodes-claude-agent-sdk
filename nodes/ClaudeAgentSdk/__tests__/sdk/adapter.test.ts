/**
 * SDK Adapter Unit Tests
 *
 * The upstream unstable V2 session API was removed in SDK 0.3.142. These tests
 * cover the local query() adapter and the explicit rejection path for the
 * retired V2 mode.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSdkAdapter, isV2Available } from '../../sdk/adapter';
import type { ClaudeAgentSdkModule } from '../../sdk/types';

function createAsyncIterator<T>(items: T[]): AsyncIterable<T> {
	return {
		[Symbol.asyncIterator]: async function* () {
			for (const item of items) {
				yield item;
			}
		},
	};
}

function createSdkMock(messages: unknown[] = []): ClaudeAgentSdkModule {
	return {
		query: vi.fn().mockImplementation(() => createAsyncIterator(messages)),
	};
}

describe('SDK Adapter', () => {
	describe('query adapter', () => {
		it('returns a query-backed session handle', async () => {
			const sdk = createSdkMock();
			const adapter = createSdkAdapter(sdk, 'v1');

			const handle = await adapter.createSession({ model: 'claude-sonnet-4-6' });

			expect(handle).toBeDefined();
			expect(handle.id).toBeUndefined();
		});

		it('resumes sessions by passing options.resume to query()', async () => {
			const sdk = createSdkMock([{ type: 'text', text: 'response' }]);
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.resumeSession('existing-session-id', { model: 'opus' });

			await handle.send('Continue');
			const messages = [];
			for await (const message of handle.stream()) {
				messages.push(message);
			}

			expect(sdk.query).toHaveBeenCalledWith({
				prompt: 'Continue',
				options: { model: 'opus', resume: 'existing-session-id' },
			});
			expect(messages).toHaveLength(1);
		});

		it('captures prompt via send() without executing immediately', async () => {
			const sdk = createSdkMock([{ type: 'text', text: 'response' }]);
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.createSession({});

			await handle.send('Hello Claude');

			expect(sdk.query).not.toHaveBeenCalled();
		});

		it('executes query on stream()', async () => {
			const sdk = createSdkMock([{ type: 'text', text: 'response' }]);
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.createSession({});

			await handle.send('Hello Claude');
			const messages = [];
			for await (const message of handle.stream()) {
				messages.push(message);
			}

			expect(sdk.query).toHaveBeenCalledWith({
				prompt: 'Hello Claude',
				options: {},
			});
			expect(messages).toHaveLength(1);
		});

		it('throws if stream() is called before send()', async () => {
			const sdk = createSdkMock();
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.createSession({});

			expect(() => handle.stream()).toThrow('No message sent. Call send() before stream().');
		});

		it('throws if send() is called after stream started', async () => {
			const sdk = createSdkMock([{ type: 'text', text: 'response' }]);
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.createSession({});

			await handle.send('First message');
			const streamIterator = handle.stream();
			await streamIterator[Symbol.asyncIterator]().next();

			await expect(handle.send('Second message')).rejects.toThrow(
				'V1 adapter does not support multi-turn within a single session',
			);
		});

		it('throws on multiple stream() calls', async () => {
			const sdk = createSdkMock([{ type: 'text', text: 'response' }]);
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.createSession({});

			await handle.send('Hello');
			handle.stream();

			expect(() => handle.stream()).toThrow('Stream already started');
		});

		it('accepts structured text input format', async () => {
			const sdk = createSdkMock([{ type: 'text', text: 'response' }]);
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.createSession({});

			await handle.send({ type: 'text', text: 'Structured message' });
			for await (const _message of handle.stream()) {
				// consume
			}

			expect(sdk.query).toHaveBeenCalledWith({
				prompt: 'Structured message',
				options: {},
			});
		});

		it('executes promptOnce directly through query()', async () => {
			const sdk = createSdkMock([{ type: 'text', text: 'response' }]);
			const adapter = createSdkAdapter(sdk, 'v1');

			const messages = [];
			for await (const message of adapter.promptOnce('Quick prompt', { model: 'claude-sonnet-4-6' })) {
				messages.push(message);
			}

			expect(sdk.query).toHaveBeenCalledWith({
				prompt: 'Quick prompt',
				options: { model: 'claude-sonnet-4-6' },
			});
			expect(messages).toHaveLength(1);
		});

		it('has no explicit handle cleanup to perform', async () => {
			const sdk = createSdkMock();
			const adapter = createSdkAdapter(sdk, 'v1');
			const handle = await adapter.createSession({});

			await expect(handle.close?.()).resolves.toBeUndefined();
		});

		it('reports v1 for backwards-compatible adapter identity', () => {
			const sdk = createSdkMock();
			const adapter = createSdkAdapter(sdk, 'v1');

			expect(adapter.version).toBe('v1');
		});
	});

	describe('retired V2 API', () => {
		it('rejects the removed V2 adapter mode clearly', () => {
			const sdk = createSdkMock();

			expect(() => createSdkAdapter(sdk, 'v2')).toThrow(
				'unstable V2 Agent SDK session API was removed',
			);
		});

		it('reports V2 unavailable even if stale callers probe for it', () => {
			const sdk = createSdkMock();

			expect(isV2Available(sdk)).toBe(false);
		});
	});

	describe('createSdkAdapter default version', () => {
		it('defaults to v1 when version is not specified', () => {
			const sdk = createSdkMock();
			const adapter = createSdkAdapter(sdk);

			expect(adapter.version).toBe('v1');
		});
	});
});
