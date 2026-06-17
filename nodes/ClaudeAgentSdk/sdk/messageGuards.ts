/**
 * Runtime guards for stream messages. The known-type allowlist is
 * compile-checked against NodeStreamMessage['type'], so upstream union
 * changes surface here as tsc errors instead of silent drift.
 */

import type { NodeStreamMessage } from './types';

const KNOWN_NODE_MESSAGE_TYPES = [
	'assistant',
	'user',
	'result',
	'system',
	'stream_event',
	'tool_progress',
	'auth_status',
	'tool_use_summary',
	'rate_limit_event',
	'prompt_suggestion',
	'artifact',
	'session_files',
] as const satisfies ReadonlyArray<NodeStreamMessage['type']>;

/**
 * True when the value is one of the explicitly-typed stream messages.
 * Unknown `{type: string}` frames are NOT rejected by callers — they still
 * flow to storage/streaming — this guard only gates the typed branches.
 */
export function isKnownNodeMessage(value: unknown): value is NodeStreamMessage {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		typeof (value as { type: unknown }).type === 'string' &&
		(KNOWN_NODE_MESSAGE_TYPES as readonly string[]).includes((value as { type: string }).type)
	);
}
