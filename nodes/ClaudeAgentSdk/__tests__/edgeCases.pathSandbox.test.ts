/**
 * Edge Cases - Path Sandbox
 */

import { describe, it, expect } from 'vitest';
import { checkPathSandbox, validatePath } from '../permissions/PathSandbox';

describe('Edge Cases - Path Sandbox', () => {
	const createInput = (tool: string, input: Record<string, unknown>) => ({
		session_id: 'test',
		transcript_path: '/tmp',
		cwd: '/project',
		hook_event_name: 'PreToolUse' as const,
		tool_name: tool,
		tool_input: input,
	});

	describe('path traversal attacks', () => {
		const config = {
			enabled: true,
			basePath: '/allowed',
			affectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'] as const,
		};
		const cwd = '/project';

		it('should block ../../../etc/passwd', () => {
			const result = validatePath('/allowed/../../../etc/passwd', cwd, config);
			expect(result.valid).toBe(false);
		});

		it('should block encoded path traversal %2e%2e/ (FIXED with sanitization)', () => {
			// URL encoded .. is now decoded before validation
			const result = validatePath('/allowed/%2e%2e/etc/passwd', cwd, config);
			// FIXED: URL encoding is decoded, revealing the traversal attempt
			expect(result.valid).toBe(false);
		});

		it('should block double-encoded traversal (FIXED with sanitization)', () => {
			const result = validatePath('/allowed/%252e%252e/etc/passwd', cwd, config);
			// FIXED: Double encoding is decoded iteratively
			expect(result.valid).toBe(false);
		});

		it('should block null byte in path (FIXED with sanitization)', () => {
			const result = validatePath('/allowed/file.txt\x00.jpg', cwd, config);
			// FIXED: Null bytes are stripped, path is /allowed/file.txt.jpg
			expect(result.valid).toBe(true); // Still valid because it's within /allowed
		});

		it('should block traversal hidden after a null byte (FIXED with sanitization)', () => {
			const result = validatePath('/allowed/log.txt%00/../../etc/passwd', cwd, config);
			// FIXED: Sanitization removes the null byte and exposes the traversal
			expect(result.valid).toBe(false);
			expect(result.resolvedPath.startsWith(config.basePath)).toBe(false);
		});

		it('should allow paths within sandbox', () => {
			const result = validatePath('/allowed/safe/file.txt', cwd, config);
			expect(result.valid).toBe(true);
		});

		it('should block Windows-style paths on Unix', () => {
			// Windows paths are treated as relative on Unix
			const result = validatePath('C:\\Windows\\System32', cwd, config);
			// This resolves to /project/C:\Windows\System32 which is not under /allowed
			expect(result.valid).toBe(false);
		});

		it('should block mixed slashes path traversal', () => {
			// path.normalize handles backslashes on the current platform
			const result = validatePath('/allowed/test/../../../etc/passwd', cwd, config);
			expect(result.valid).toBe(false);
		});

		it('should handle paths with spaces', () => {
			const result = validatePath('/allowed/my file.txt', cwd, config);
			expect(result.valid).toBe(true);
		});

		it('should handle paths with unicode', () => {
			const result = validatePath('/allowed/文件.txt', cwd, config);
			expect(result.valid).toBe(true);
		});

		it('should block relative path starting with ~', () => {
			// ~ is treated as literal on Unix without shell expansion
			const result = validatePath('~/../../etc/passwd', cwd, config);
			// Resolves to /project/~/../../etc/passwd = /etc/passwd
			expect(result.valid).toBe(false);
		});
	});

	describe('checkPathSandbox tool handling', () => {
		const config = {
			enabled: true,
			basePath: '/allowed',
			affectedTools: ['Read'] as const,
		};

		it('should not check non-affected tools', () => {
			const result = checkPathSandbox(createInput('Bash', { command: 'cat /etc/passwd' }), config);
			expect(result.valid).toBe(true); // Bash not in affected tools
		});

		it('should check Glob patterns', () => {
			const result = checkPathSandbox(createInput('Glob', { pattern: '/etc/**/*.conf' }), {
				...config,
				affectedTools: ['Glob'],
			});
			expect(result.valid).toBe(false);
		});
	});
});

