import { describe, expect, it } from 'vitest';

import { mergeExecutionHookSources } from '../../permissions/HooksBuilder';

function getPreToolUseHookNames(merged: Record<string, unknown> | undefined): string[] {
	const matchers = merged?.PreToolUse;
	if (!Array.isArray(matchers)) {
		return [];
	}

	return matchers.flatMap((matcher) => {
		if (typeof matcher !== 'object' || matcher === null) {
			return [];
		}

		const hooks = Reflect.get(matcher, 'hooks');
		if (!Array.isArray(hooks) || typeof hooks[0] !== 'string') {
			return [];
		}

		return [hooks[0]];
	});
}

describe('mergeExecutionHookSources', () => {
	it('orders PreToolUse hooks as permissions, AGT, then user hooks', () => {
		const merged = mergeExecutionHookSources(undefined, {
			permissionHooks: {
				PreToolUse: [{ hooks: ['permission-hook'] }],
			},
			agtHooks: {
				PreToolUse: [{ hooks: ['agt-hook'] }],
			},
			userHooks: {
				PreToolUse: [{ hooks: ['user-hook'] }],
			},
		});

		expect(getPreToolUseHookNames(merged)).toEqual(['permission-hook', 'agt-hook', 'user-hook']);
	});

	it('preserves any existing hooks ahead of the node-managed pipeline', () => {
		const merged = mergeExecutionHookSources(
			{
				PreToolUse: [{ hooks: ['existing-hook'] }],
			},
			{
				permissionHooks: {
					PreToolUse: [{ hooks: ['permission-hook'] }],
				},
				agtHooks: {
					PreToolUse: [{ hooks: ['agt-hook'] }],
				},
			},
		);

		expect(getPreToolUseHookNames(merged)).toEqual(['existing-hook', 'permission-hook', 'agt-hook']);
	});
});
