/**
 * Security regression: durable stream keys must be unguessable.
 *
 * A stream key is a replay capability and the replay endpoint defaults to no
 * extra auth. A key built only from a sequential executionId + small itemIndex
 * (`stream:<exec>:<idx>`) is enumerable, letting an attacker replay other
 * executions' streams. The key now carries a 128-bit random nonce.
 */

import { describe, it, expect } from 'vitest';

import { buildDurableStreamKey } from '../../streaming/streamKey';

describe('buildDurableStreamKey', () => {
	it('appends a 128-bit (32 hex char) nonce so the key is not enumerable', () => {
		const key = buildDurableStreamKey({ executionId: '1', itemIndex: 0 });
		const parts = key.split(':');
		expect(parts[0]).toBe('stream');
		expect(parts[1]).toBe('1');
		expect(parts[2]).toBe('0');
		expect(parts[3]).toMatch(/^[0-9a-f]{32}$/);
	});

	it('produces a different key on each call for the same execution/item', () => {
		const a = buildDurableStreamKey({ executionId: '7', itemIndex: 2 });
		const b = buildDurableStreamKey({ executionId: '7', itemIndex: 2 });
		expect(a).not.toBe(b);
	});

	it('reuses an explicit token verbatim so resume reconstructs the same key', () => {
		const token = 'deadbeefdeadbeefdeadbeefdeadbeef';
		const key = buildDurableStreamKey({ executionId: '9', itemIndex: 1, token });
		expect(key).toBe(`stream:9:1:${token}`);
		// Resuming with the same token is stable.
		expect(buildDurableStreamKey({ executionId: '9', itemIndex: 1, token })).toBe(key);
	});

	it('an enumerated legacy-shape key (no nonce) does not equal a freshly minted key', () => {
		const guessed = 'stream:1:0';
		const real = buildDurableStreamKey({ executionId: '1', itemIndex: 0 });
		expect(real).not.toBe(guessed);
		expect(real.startsWith('stream:1:0:')).toBe(true);
	});
});
