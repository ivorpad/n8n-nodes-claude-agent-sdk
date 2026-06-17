/**
 * PathSandbox Unit Tests
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { validatePath, checkPathSandbox } from '../../permissions/PathSandbox';
import type { PathSandboxConfig, PreToolUseHookInput } from '../../permissions/types';

describe('PathSandbox', () => {
	const defaultConfig: PathSandboxConfig = {
		enabled: true,
		basePath: '/project',
		affectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
	};

	const createHookInput = (
		toolName: string,
		toolInput: Record<string, unknown>,
		cwd: string = '/project',
	): PreToolUseHookInput => ({
		session_id: 'test-session',
		transcript_path: '/tmp/transcript',
		cwd,
		hook_event_name: 'PreToolUse',
		tool_name: toolName,
		tool_input: toolInput,
	});

	describe('validatePath', () => {
		it('should return valid for paths inside sandbox', () => {
			const result = validatePath('/project/src/file.ts', '/project', defaultConfig);

			expect(result.valid).toBe(true);
			expect(result.originalPath).toBe('/project/src/file.ts');
		});

		it('should return valid for exact sandbox path', () => {
			const result = validatePath('/project', '/project', defaultConfig);

			expect(result.valid).toBe(true);
		});

		it('should return invalid for paths outside sandbox', () => {
			const result = validatePath('/etc/passwd', '/project', defaultConfig);

			expect(result.valid).toBe(false);
			expect(result.error).toContain('outside the allowed sandbox');
		});

		it('should block path traversal attacks', () => {
			const result = validatePath('/project/../etc/passwd', '/project', defaultConfig);

			expect(result.valid).toBe(false);
			expect(result.error).toContain('outside the allowed sandbox');
		});

		it('should resolve relative paths against cwd', () => {
			const result = validatePath('src/file.ts', '/project', defaultConfig);

			expect(result.valid).toBe(true);
			expect(result.resolvedPath).toBe('/project/src/file.ts');
		});

		it('should allow paths in allowedPaths', () => {
			const configWithAllowed: PathSandboxConfig = {
				...defaultConfig,
				allowedPaths: ['/tmp/allowed'],
			};

			const result = validatePath('/tmp/allowed/file.txt', '/project', configWithAllowed);

			expect(result.valid).toBe(true);
		});

		it('should block paths not in allowedPaths or basePath', () => {
			const configWithAllowed: PathSandboxConfig = {
				...defaultConfig,
				allowedPaths: ['/tmp/allowed'],
			};

			const result = validatePath('/tmp/notallowed/file.txt', '/project', configWithAllowed);

			expect(result.valid).toBe(false);
		});

		it('should enforce operatorAllowedPaths as an additional restriction', () => {
			const operatorRestrictedConfig: PathSandboxConfig = {
				...defaultConfig,
				operatorAllowedPaths: ['/project/safe'],
			};

			const denied = validatePath('/project/other/file.txt', '/project', operatorRestrictedConfig);
			expect(denied.valid).toBe(false);
			expect(denied.error).toContain('outside operator-enforced allowed paths');

			const allowed = validatePath('/project/safe/file.txt', '/project', operatorRestrictedConfig);
			expect(allowed.valid).toBe(true);
		});

		it('should block new files under symlink parents that escape the sandbox', () => {
			const root = mkdtempSync(join(tmpdir(), 'path-sandbox-'));
			const allowed = join(root, 'allowed');
			const outside = join(root, 'outside');
			mkdirSync(allowed, { recursive: true });
			mkdirSync(outside, { recursive: true });
			symlinkSync(outside, join(allowed, 'link'));

			try {
				const result = validatePath('link/new.txt', allowed, {
					enabled: true,
					basePath: allowed,
					affectedTools: ['Write'],
				});

				expect(result.valid).toBe(false);
				writeFileSync(join(allowed, 'link', 'new.txt'), 'escaped');
				expect(existsSync(join(outside, 'new.txt'))).toBe(true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	describe('checkPathSandbox', () => {
		it('should validate Read tool file_path', () => {
			const input = createHookInput('Read', { file_path: '/etc/passwd' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(false);
			expect(result.error).toContain('outside the allowed sandbox');
		});

		it('should validate Write tool file_path', () => {
			const input = createHookInput('Write', { file_path: '/project/output.txt' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(true);
		});

		it('should validate Edit tool file_path', () => {
			const input = createHookInput('Edit', { file_path: '/root/.bashrc' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(false);
		});

		it('should validate Glob tool path', () => {
			const input = createHookInput('Glob', { path: '/project/src', pattern: '**/*.ts' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(true);
		});

		it('should validate Grep tool path', () => {
			const input = createHookInput('Grep', { path: '/var/log', pattern: 'error' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(false);
		});

		it('should ignore non-affected tools', () => {
			const input = createHookInput('Bash', { command: 'rm -rf /' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(true);
		});

		it('should pass when tool has no path fields', () => {
			const input = createHookInput('Read', {});
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(true);
		});

		it('should handle Glob with absolute pattern path', () => {
			const input = createHookInput('Glob', { pattern: '/etc/**/*.conf' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(false);
		});

		it('should allow Glob with relative pattern', () => {
			const input = createHookInput('Glob', { pattern: 'src/**/*.ts' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(true);
		});

		it('should block Glob with relative traversal pattern', () => {
			const input = createHookInput('Glob', { pattern: '../**/*.ts' });
			const result = checkPathSandbox(input, defaultConfig);

			expect(result.valid).toBe(false);
			expect(result.error).toContain('outside the allowed sandbox');
		});
	});
});
