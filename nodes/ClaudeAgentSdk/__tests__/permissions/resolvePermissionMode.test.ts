import { describe, expect, it } from 'vitest';

import {
	clampPermissionMode,
	resolvePermissionMode,
} from '../../permissions/resolvePermissionMode';

describe('clampPermissionMode', () => {
	it('passes the mode through unchanged when no allowlist is configured', () => {
		expect(clampPermissionMode('bypassPermissions', undefined)).toBe('bypassPermissions');
		expect(clampPermissionMode('acceptEdits', undefined)).toBe('acceptEdits');
	});

	it('passes the mode through when it is in the allowlist', () => {
		expect(clampPermissionMode('plan', ['default', 'plan'])).toBe('plan');
	});

	it('downgrades to default when the mode is not in the allowlist', () => {
		expect(clampPermissionMode('bypassPermissions', ['default', 'plan'])).toBe('default');
		expect(clampPermissionMode('acceptEdits', ['default'])).toBe('default');
	});

	it('treats an empty allowlist as "only default permitted"', () => {
		// An empty array is a configured-but-restrictive allowlist (callers pass
		// `undefined` to mean "unset"); the only safe fallback is `default`.
		expect(clampPermissionMode('bypassPermissions', [])).toBe('default');
		expect(clampPermissionMode('default', [])).toBe('default');
	});
});

describe('resolvePermissionMode', () => {
	// ── Behavior the prefactor must preserve (policy UNSET) ──────────────────
	// resolution matrix: requested mode × HITL-enabled, with no operator policy.
	const PREFIX_MATRIX: Array<{
		requestedMode: string;
		hitlEnabled: boolean;
		expectedMode: string;
		expectedFlag: boolean;
	}> = [
		{ requestedMode: 'default', hitlEnabled: false, expectedMode: 'default', expectedFlag: false },
		{ requestedMode: 'plan', hitlEnabled: false, expectedMode: 'plan', expectedFlag: false },
		{
			requestedMode: 'acceptEdits',
			hitlEnabled: false,
			expectedMode: 'acceptEdits',
			expectedFlag: false,
		},
		{
			requestedMode: 'bypassPermissions',
			hitlEnabled: false,
			expectedMode: 'bypassPermissions',
			expectedFlag: true,
		},
		// HITL enabled forces every mode back to default and clears the flag.
		{ requestedMode: 'default', hitlEnabled: true, expectedMode: 'default', expectedFlag: false },
		{ requestedMode: 'plan', hitlEnabled: true, expectedMode: 'default', expectedFlag: false },
		{
			requestedMode: 'acceptEdits',
			hitlEnabled: true,
			expectedMode: 'default',
			expectedFlag: false,
		},
		{
			requestedMode: 'bypassPermissions',
			hitlEnabled: true,
			expectedMode: 'default',
			expectedFlag: false,
		},
	];

	it.each(PREFIX_MATRIX)(
		'with policy UNSET resolves requested=$requestedMode hitl=$hitlEnabled to mode=$expectedMode flag=$expectedFlag',
		({ requestedMode, hitlEnabled, expectedMode, expectedFlag }) => {
			const resolution = resolvePermissionMode({ requestedMode, hitlEnabled });
			expect(resolution).toEqual({
				mode: expectedMode,
				allowDangerouslySkipPermissions: expectedFlag,
			});
		},
	);

	it('with policy UNSET, bypassPermissions still resolves to bypass (no behavior change)', () => {
		expect(
			resolvePermissionMode({ requestedMode: 'bypassPermissions', hitlEnabled: false }),
		).toEqual({ mode: 'bypassPermissions', allowDangerouslySkipPermissions: true });
	});

	// ── New clamp behavior ───────────────────────────────────────────────────
	it('downgrades bypassPermissions to default when not in the allowlist', () => {
		const resolution = resolvePermissionMode({
			requestedMode: 'bypassPermissions',
			hitlEnabled: false,
			allowedPermissionModes: ['default', 'plan'],
		});
		expect(resolution).toEqual({ mode: 'default', allowDangerouslySkipPermissions: false });
	});

	it('keeps bypassPermissions when explicitly in the allowlist', () => {
		const resolution = resolvePermissionMode({
			requestedMode: 'bypassPermissions',
			hitlEnabled: false,
			allowedPermissionModes: ['default', 'bypassPermissions'],
		});
		expect(resolution).toEqual({
			mode: 'bypassPermissions',
			allowDangerouslySkipPermissions: true,
		});
	});

	it('keeps an allowed non-default mode', () => {
		const resolution = resolvePermissionMode({
			requestedMode: 'plan',
			hitlEnabled: false,
			allowedPermissionModes: ['default', 'plan'],
		});
		expect(resolution).toEqual({ mode: 'plan', allowDangerouslySkipPermissions: false });
	});

	it('applies the HITL downgrade on top of the clamp', () => {
		// Even when bypass is allowlisted, HITL still forces default.
		const resolution = resolvePermissionMode({
			requestedMode: 'bypassPermissions',
			hitlEnabled: true,
			allowedPermissionModes: ['default', 'bypassPermissions'],
		});
		expect(resolution).toEqual({ mode: 'default', allowDangerouslySkipPermissions: false });
	});
});
