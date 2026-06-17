/**
 * SDK Adapter Implementations
 *
 * The upstream unstable V2 session API was removed in
 * @anthropic-ai/claude-agent-sdk 0.3.142. The node keeps this adapter boundary
 * for managed/local execution parity, but local execution now always delegates
 * to query() and uses options.resume for deterministic session continuation.
 */

import type {
	SdkAdapter,
	SessionHandle,
	SessionSendInput,
	ClaudeAgentSdkModule,
	NodeQueryOptions,
	NodeStreamMessage,
	QueryHandle,
} from './types';

/**
 * Normalize session send input to string format
 */
function normalizeInput(input: SessionSendInput): string {
	if (typeof input === 'string') {
		return input;
	}
	return input.text;
}

/**
 * Query Adapter - Wraps the query() function
 *
 * query() carries session behavior through options such as resume. createSession
 * and resumeSession return a shim that captures the prompt for later execution.
 */
class V1Adapter implements SdkAdapter {
	readonly version = 'v1' as const;

	constructor(private sdk: ClaudeAgentSdkModule) {}

	async createSession(options: NodeQueryOptions): Promise<SessionHandle> {
		return new V1SessionHandle(this.sdk, options);
	}

	async resumeSession(id: string, options: NodeQueryOptions): Promise<SessionHandle> {
		return new V1SessionHandle(this.sdk, { ...options, resume: id });
	}

	promptOnce(prompt: string, options: NodeQueryOptions): QueryHandle {
		return this.sdk.query({ prompt, options });
	}
}

/**
 * Query Session Handle - Shim for query() compatibility
 *
 * This captures the prompt via send() and executes query() when stream() is called.
 */
class V1SessionHandle implements SessionHandle {
	id?: string = undefined;
	private prompt?: string;
	private streamStarted = false;

	constructor(
		private sdk: ClaudeAgentSdkModule,
		private options: NodeQueryOptions,
	) {}

	async send(input: SessionSendInput): Promise<void> {
		if (this.streamStarted) {
			throw new Error(
				'V1 adapter does not support multi-turn within a single session. Create a new session for each turn.',
			);
		}
		this.prompt = normalizeInput(input);
	}

	stream(): AsyncIterable<NodeStreamMessage> {
		if (!this.prompt) {
			throw new Error('No message sent. Call send() before stream().');
		}
		if (this.streamStarted) {
			throw new Error(
				'Stream already started. V1 adapter only supports single stream per session.',
			);
		}
		this.streamStarted = true;
		return this.sdk.query({
			prompt: this.prompt,
			options: this.options,
		});
	}

	async close(): Promise<void> {
		// query() has no explicit per-handle cleanup.
	}
}

/**
 * Create an SDK adapter for the specified version
 *
 * @param sdk - The dynamically imported SDK module
 * @param version - Which SDK interface to use ('v1'; 'v2' is rejected because it was removed upstream)
 * @returns An SdkAdapter instance
 */
export function createSdkAdapter(
	sdk: ClaudeAgentSdkModule,
	version: 'v1' | 'v2' = 'v1',
): SdkAdapter {
	if (version === 'v2') {
		throw new Error(
			'The unstable V2 Agent SDK session API was removed in @anthropic-ai/claude-agent-sdk 0.3.142. Use query() with options.resume instead.',
		);
	}
	return new V1Adapter(sdk);
}

/**
 * Check if the removed V2 API is available in the SDK module.
 */
export function isV2Available(_sdk: ClaudeAgentSdkModule): boolean {
	void _sdk;
	return false;
}
