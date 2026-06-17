import { describe, expect, it } from 'vitest';

import {
	ReplayQuerySchema,
	StreamFrameSchema,
	TerminalTransitionSchema,
} from '../../streaming/streamSchemas';

describe('streamSchemas', () => {
	it('coerces replay query primitives and applies defaults', () => {
		const parsed = ReplayQuerySchema.parse({
			streamKey: 'stream_123',
			cursor: '12',
			limit: '25',
			tailLive: 'true',
		});

		expect(parsed).toEqual({
			streamKey: 'stream_123',
			cursor: 12,
			limit: 25,
			tailLive: true,
		});
	});

	it('accepts persisted frames with nullable payloads', () => {
		const parsed = StreamFrameSchema.parse({
			streamKey: 'stream_123',
			seq: 4,
			eventType: 'end',
			createdAt: '2026-03-10T12:00:00.000Z',
			payload: null,
		});

		expect(parsed.payload).toBeNull();
		expect(parsed.eventType).toBe('end');
	});

	it('rejects non-terminal stream transitions', () => {
		expect(() => TerminalTransitionSchema.parse({
			streamKey: 'stream_123',
			status: 'live',
		})).toThrow();
	});
});
