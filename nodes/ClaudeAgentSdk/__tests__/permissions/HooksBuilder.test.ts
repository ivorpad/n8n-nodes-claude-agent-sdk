/**
 * HooksBuilder Unit Tests
 *
 * Tests for permission hooks composition and merging.
 */

import { describe, it, expect } from 'vitest';
import {
	hasAnyPermissionsEnabled,
	buildPermissionHooks,
	mergeHooks,
} from '../../permissions/HooksBuilder';
import type { PermissionsConfig, PreToolUseHookInput, UserPromptSubmitHookInput } from '../../permissions/types';

describe('HooksBuilder', () => {
	const createHookInput = (
		toolName: string,
		toolInput: Record<string, unknown> = {},
	): PreToolUseHookInput => ({
		session_id: 'test-session',
		transcript_path: '/tmp/transcript',
		cwd: '/project',
		hook_event_name: 'PreToolUse',
		tool_name: toolName,
		tool_input: toolInput,
	});

	const createUserPromptSubmitInput = (
		prompt: string,
	): UserPromptSubmitHookInput => ({
		session_id: 'test-session',
		transcript_path: '/tmp/transcript',
		cwd: '/project',
		hook_event_name: 'UserPromptSubmit',
		prompt,
	});

	describe('hasAnyPermissionsEnabled', () => {
		it('should return false when no permissions enabled', () => {
			const config: PermissionsConfig = {};
			expect(hasAnyPermissionsEnabled(config)).toBe(false);
		});

		it('should return true when pathSandbox enabled', () => {
			const config: PermissionsConfig = {
				pathSandbox: {
					enabled: true,
					basePath: '/project',
					mode: 'restrict',
				},
			};
			expect(hasAnyPermissionsEnabled(config)).toBe(true);
		});

		it('should return true when contentFilter enabled', () => {
			const config: PermissionsConfig = {
				contentFilter: {
					enabled: true,
					rules: [],
				},
			};
			expect(hasAnyPermissionsEnabled(config)).toBe(true);
		});

		it('should return true when toolPermissions enabled', () => {
			const config: PermissionsConfig = {
				toolPermissions: {
					enabled: true,
					rules: [],
					defaultDecision: 'allow',
					askFallback: 'allow',
				},
			};
			expect(hasAnyPermissionsEnabled(config)).toBe(true);
		});

		it('should return true when auditLogger enabled', () => {
			const config: PermissionsConfig = {
				auditLogger: {
					enabled: true,
				},
			};
			expect(hasAnyPermissionsEnabled(config)).toBe(true);
		});

		it('should return true when userPromptContext is provided', () => {
			const config: PermissionsConfig = {};
			expect(hasAnyPermissionsEnabled(config, 'Always be helpful')).toBe(true);
		});

		it('should return false when userPromptContext is empty', () => {
			const config: PermissionsConfig = {};
			expect(hasAnyPermissionsEnabled(config, '')).toBe(false);
			expect(hasAnyPermissionsEnabled(config, '   ')).toBe(false);
		});

		it('should return true when multiple features enabled', () => {
			const config: PermissionsConfig = {
				pathSandbox: {
					enabled: true,
					basePath: '/project',
					mode: 'restrict',
				},
				contentFilter: {
					enabled: true,
					rules: [],
				},
			};
			expect(hasAnyPermissionsEnabled(config)).toBe(true);
		});

		it('should return false when features exist but disabled', () => {
			const config: PermissionsConfig = {
				pathSandbox: {
					enabled: false,
					basePath: '/project',
					mode: 'restrict',
				},
				contentFilter: {
					enabled: false,
					rules: [],
				},
			};
			expect(hasAnyPermissionsEnabled(config)).toBe(false);
		});
	});

	describe('buildPermissionHooks', () => {
		it('should return hooks object with PreToolUse and PostToolUse', () => {
			const config: PermissionsConfig = {};
			const result = buildPermissionHooks(config);

			expect(result.hooks.PreToolUse).toBeDefined();
			expect(result.hooks.PostToolUse).toBeDefined();
			expect(result.getAuditLog).toBeInstanceOf(Function);
		});

		it('should block tools in existingBlockedTools list', async () => {
			const config: PermissionsConfig = {};
			const result = buildPermissionHooks(config, ['BlockedTool']);

			const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
			const input = createHookInput('BlockedTool');

			const output = await preToolUseHook(input, 'tool-123');

			expect(output.continue).toBe(false);
			expect(output.decision).toBe('block');
			expect(output.reason).toContain('blocked by configuration');
		});

		it('should allow tools not in blocked list', async () => {
			const config: PermissionsConfig = {};
			const result = buildPermissionHooks(config, ['BlockedTool']);

			const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
			const input = createHookInput('AllowedTool');

			const output = await preToolUseHook(input, 'tool-123');

			expect(output.continue).toBe(true);
		});

		it('should block tools that match blocked wildcard patterns', async () => {
			const config: PermissionsConfig = {};
			const result = buildPermissionHooks(config, ['mcp__danger__*']);

			const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
			const input = createHookInput('mcp__danger__delete_repo');

			const output = await preToolUseHook(input, 'tool-123');

			expect(output.continue).toBe(false);
			expect(output.reason).toContain('mcp__danger__*');
		});

		describe('path sandbox integration', () => {
			it('should block paths outside sandbox', async () => {
				const config: PermissionsConfig = {
					pathSandbox: {
						enabled: true,
						basePath: '/allowed',
						affectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
					},
				};
				const result = buildPermissionHooks(config);

				const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
				const input = createHookInput('Read', { file_path: '/etc/passwd' });

				const output = await preToolUseHook(input, 'tool-123');

				expect(output.continue).toBe(false);
				expect(output.decision).toBe('block');
			});

			it('should allow paths inside sandbox', async () => {
				const config: PermissionsConfig = {
					pathSandbox: {
						enabled: true,
						basePath: '/project',
						affectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
					},
				};
				const result = buildPermissionHooks(config);

				const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
				const input = createHookInput('Read', { file_path: '/project/src/app.ts' });

				const output = await preToolUseHook(input, 'tool-123');

				expect(output.continue).toBe(true);
			});
		});

		describe('content filter integration', () => {
			it('should block dangerous commands', async () => {
				const config: PermissionsConfig = {
					contentFilter: {
						enabled: true,
						rules: [],
						presets: ['dangerous-commands'],
					},
				};
				const result = buildPermissionHooks(config);

				const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
				const input = createHookInput('Bash', { command: 'rm -rf /' });

				const output = await preToolUseHook(input, 'tool-123');

				expect(output.continue).toBe(false);
				expect(output.decision).toBe('block');
			});
		});

		describe('tool permissions integration', () => {
			it('should deny tools matching deny rule', async () => {
				const config: PermissionsConfig = {
					toolPermissions: {
						enabled: true,
						rules: [
							{
								toolPattern: 'Bash',
								decision: 'deny',
								reason: 'Bash is not allowed',
							},
						],
						defaultDecision: 'allow',
						askFallback: 'allow',
					},
				};
				const result = buildPermissionHooks(config);

				const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
				const input = createHookInput('Bash', { command: 'ls -la' });

				const output = await preToolUseHook(input, 'tool-123');

				expect(output.continue).toBe(false);
				expect(output.decision).toBe('block');
			});
		});

		describe('audit logging integration', () => {
			it('should log allowed tool uses', async () => {
				const config: PermissionsConfig = {
					auditLogger: {
						enabled: true,
						logInputs: true,
					},
				};
				const result = buildPermissionHooks(config);

				const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
				const input = createHookInput('Read', { file_path: '/test.ts' });

				await preToolUseHook(input, 'tool-123');

				const auditLog = result.getAuditLog();
				expect(auditLog.length).toBe(1);
				expect(auditLog[0].toolName).toBe('Read');
				expect(auditLog[0].blocked).toBe(false);
			});

			it('should log blocked tool uses', async () => {
				const config: PermissionsConfig = {
					auditLogger: {
						enabled: true,
						logInputs: true,
					},
				};
				const result = buildPermissionHooks(config, ['BlockedTool']);

				const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
				const input = createHookInput('BlockedTool');

				await preToolUseHook(input, 'tool-123');

				const auditLog = result.getAuditLog();
				expect(auditLog.length).toBe(1);
				expect(auditLog[0].toolName).toBe('BlockedTool');
				expect(auditLog[0].blocked).toBe(true);
			});

			it('should return empty audit log when logging disabled', () => {
				const config: PermissionsConfig = {};
				const result = buildPermissionHooks(config);

				const auditLog = result.getAuditLog();
				expect(auditLog).toEqual([]);
			});
		});

		describe('PostToolUse hook', () => {
			it('should always continue for PostToolUse', async () => {
				const config: PermissionsConfig = {
					auditLogger: {
						enabled: true,
						logOutputs: true,
					},
				};
				const result = buildPermissionHooks(config);

				const postToolUseHook = result.hooks.PostToolUse[0].hooks[0];
				const output = await postToolUseHook(
					{ tool_response: 'success' },
					'tool-123',
				);

				expect(output.continue).toBe(true);
			});
		});

		describe('UserPromptSubmit hook', () => {
			it('should not include UserPromptSubmit hook when no context provided', () => {
				const config: PermissionsConfig = {};
				const result = buildPermissionHooks(config);

				expect(result.hooks.UserPromptSubmit).toBeUndefined();
			});

			it('should not include UserPromptSubmit hook when context is empty', () => {
				const config: PermissionsConfig = {};
				const result = buildPermissionHooks(config, [], '');

				expect(result.hooks.UserPromptSubmit).toBeUndefined();
			});

			it('should include UserPromptSubmit hook when context is provided', () => {
				const config: PermissionsConfig = {};
				const result = buildPermissionHooks(config, [], 'Always follow coding standards');

				expect(result.hooks.UserPromptSubmit).toBeDefined();
				expect(result.hooks.UserPromptSubmit).toHaveLength(1);
			});

			it('should return additionalContext in hookSpecificOutput', async () => {
				const config: PermissionsConfig = {};
				const result = buildPermissionHooks(config, [], 'Use TypeScript for all new code');

				const userPromptSubmitHook = result.hooks.UserPromptSubmit![0].hooks[0];
				const input = createUserPromptSubmitInput('Create a function');

				const output = await userPromptSubmitHook(input, 'hook-123');

				expect(output.continue).toBe(true);
				expect(output.hookSpecificOutput).toBeDefined();
				expect(output.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
				expect(output.hookSpecificOutput?.additionalContext).toBe('Use TypeScript for all new code');
			});

			it('should trim whitespace from context', async () => {
				const config: PermissionsConfig = {};
				const result = buildPermissionHooks(config, [], '  Follow best practices  ');

				const userPromptSubmitHook = result.hooks.UserPromptSubmit![0].hooks[0];
				const input = createUserPromptSubmitInput('Create a function');

				const output = await userPromptSubmitHook(input, 'hook-123');

				expect(output.hookSpecificOutput?.additionalContext).toBe('Follow best practices');
			});
		});

	});

	describe('mergeHooks', () => {
		it('should return permission hooks when no existing hooks', () => {
			const permissionHooks = {
				PreToolUse: [{ hooks: [async () => ({ continue: true })] }],
				PostToolUse: [{ hooks: [async () => ({ continue: true })] }],
			};

			const merged = mergeHooks(undefined, permissionHooks);

			expect(merged.PreToolUse).toBe(permissionHooks.PreToolUse);
			expect(merged.PostToolUse).toBe(permissionHooks.PostToolUse);
		});

		it('should merge PreToolUse hooks (permission first)', () => {
			const existing = {
				PreToolUse: [{ hooks: ['existing-hook'] }],
			};
			const permissionHooks = {
				PreToolUse: [{ hooks: ['permission-hook'] }],
				PostToolUse: [],
			};

			const merged = mergeHooks(existing, permissionHooks);

			// Permission hooks come first
			expect((merged.PreToolUse as any[])[0].hooks).toContain('permission-hook');
			expect((merged.PreToolUse as any[])[1].hooks).toContain('existing-hook');
		});

		it('should merge PostToolUse hooks (existing first)', () => {
			const existing = {
				PostToolUse: [{ hooks: ['existing-hook'] }],
			};
			const permissionHooks = {
				PreToolUse: [],
				PostToolUse: [{ hooks: ['permission-hook'] }],
			};

			const merged = mergeHooks(existing, permissionHooks);

			// Existing hooks come first for PostToolUse
			expect((merged.PostToolUse as any[])[0].hooks).toContain('existing-hook');
			expect((merged.PostToolUse as any[])[1].hooks).toContain('permission-hook');
		});

		it('should preserve other properties from existing hooks', () => {
			const existing = {
				PreToolUse: [{ hooks: ['existing'] }],
				SomeOtherHook: [{ custom: 'data' }],
			};
			const permissionHooks = {
				PreToolUse: [{ hooks: ['permission'] }],
				PostToolUse: [],
			};

			const merged = mergeHooks(existing, permissionHooks);

			expect(merged.SomeOtherHook).toEqual([{ custom: 'data' }]);
		});

		it('should merge UserPromptSubmit hooks (permission first)', () => {
			const existing = {
				UserPromptSubmit: [{ hooks: ['existing-hook'] }],
			};
			const permissionHooks = {
				PreToolUse: [],
				PostToolUse: [],
				UserPromptSubmit: [{ hooks: ['permission-hook'] }],
			};

			const merged = mergeHooks(existing, permissionHooks);

			// Permission hooks come first
			expect((merged.UserPromptSubmit as any[])[0].hooks).toContain('permission-hook');
			expect((merged.UserPromptSubmit as any[])[1].hooks).toContain('existing-hook');
		});

		it('should add UserPromptSubmit hooks when not in existing', () => {
			const existing = {
				PreToolUse: [{ hooks: ['existing'] }],
			};
			const permissionHooks = {
				PreToolUse: [],
				PostToolUse: [],
				UserPromptSubmit: [{ hooks: ['user-prompt-hook'] }],
			};

			const merged = mergeHooks(existing, permissionHooks);

			expect(merged.UserPromptSubmit).toBeDefined();
			expect((merged.UserPromptSubmit as any[])[0].hooks).toContain('user-prompt-hook');
		});
	});
});
