/**
 * HooksBuilder env file protection integration tests
 */

import { describe, it, expect } from 'vitest';
import { buildPermissionHooks } from '../../permissions/HooksBuilder';
import { ENV_FILE_PROTECTION_RULES } from '../../permissions/ContentFilter';
import type { PermissionsConfig, PreToolUseHookInput } from '../../permissions/types';

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

	describe('buildPermissionHooks', () => {
		describe('env file protection integration', () => {
			const envProtectionConfig: PermissionsConfig = {
				contentFilter: {
					enabled: true,
					rules: ENV_FILE_PROTECTION_RULES,
				},
			};

			describe('should block .env file access via file tools', () => {
				it('should block Read tool on .env', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Read', { file_path: '/project/.env' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
					expect(output.reason).toContain('Block access to .env files');
				});

				it('should block Read tool on .env.local', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Read', { file_path: '/project/.env.local' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});

				it('should block Write tool on .env.production', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Write', {
						file_path: '/project/.env.production',
						content: 'API_KEY=secret',
					});

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});

				it('should block Edit tool on .env.staging', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Edit', {
						file_path: '/project/.env.staging',
						old_string: 'OLD',
						new_string: 'NEW',
					});

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});

				it('should block Glob tool when glob pattern targets .env', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Glob', { path: '/project', pattern: '.en*' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});

				it('should block Grep tool when path is .env', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Grep', { path: '/project/.env', pattern: 'API_KEY' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});
			});

			describe('should block .env file access via Bash', () => {
				it('should block cat .env', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Bash', { command: 'cat .env' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});

				it('should block head .env.local', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Bash', { command: 'head -n 10 .env.local' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});

				it('should block source .env', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Bash', { command: 'source .env' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});

				it('should block grep in .env', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Bash', { command: 'grep API_KEY .env' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(false);
					expect(output.decision).toBe('block');
				});
			});

			describe('should allow non-.env file access', () => {
				it('should allow Read tool on regular files', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Read', { file_path: '/project/src/app.ts' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(true);
				});

				it('should allow Bash cat on regular files', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Bash', { command: 'cat package.json' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(true);
				});

				it('should allow grep in regular files', async () => {
					const result = buildPermissionHooks(envProtectionConfig);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Bash', { command: 'grep TODO src/*.ts' });

					const output = await preToolUseHook(input, 'tool-123');

					expect(output.continue).toBe(true);
				});
			});

			describe('should log blocked .env access in audit log', () => {
				it('should record blocked .env access in audit log', async () => {
					const config: PermissionsConfig = {
						contentFilter: {
							enabled: true,
							rules: ENV_FILE_PROTECTION_RULES,
						},
						auditLogger: {
							enabled: true,
							logInputs: true,
						},
					};
					const result = buildPermissionHooks(config);
					const preToolUseHook = result.hooks.PreToolUse[0].hooks[0];
					const input = createHookInput('Read', { file_path: '/project/.env' });

					await preToolUseHook(input, 'tool-123');

					const auditLog = result.getAuditLog();
					expect(auditLog.length).toBe(1);
					expect(auditLog[0].blocked).toBe(true);
					expect(auditLog[0].toolName).toBe('Read');
					expect(auditLog[0].blockReason).toContain('.env');
				});
			});
		});
	});
});
