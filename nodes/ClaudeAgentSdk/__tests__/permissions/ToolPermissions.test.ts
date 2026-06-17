/**
 * ToolPermissions Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
	evaluateToolPermission,
	isToolAllowed,
} from '../../permissions/ToolPermissions';
import type { ToolPermissionsConfig, PreToolUseHookInput } from '../../permissions/types';

describe('ToolPermissions', () => {
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

	describe('evaluateToolPermission - exact match rules', () => {
		it('should allow tool with exact match allow rule', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'Read', decision: 'allow' },
				],
			};

			const input = createHookInput('Read');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
		});

		it('should deny tool with exact match deny rule', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'Bash', decision: 'deny', reason: 'Bash is dangerous' },
				],
			};

			const input = createHookInput('Bash');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('deny');
			expect(result.reason).toContain('Bash is dangerous');
		});

		it('should use default decision when no rule matches', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'Write', decision: 'deny' },
				],
			};

			const input = createHookInput('Read');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
			expect(result.reason).toContain('Default decision');
		});
	});

	describe('evaluateToolPermission - glob pattern matching', () => {
		it('should match single wildcard pattern (mcp__*)', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'mcp__*', decision: 'allow' },
				],
			};

			const input = createHookInput('mcp__github');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
		});

		it('should NOT match nested underscores with single wildcard', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'mcp__*', decision: 'deny' },
				],
			};

			// Single * should not match across __
			const input = createHookInput('mcp__github__issues');
			const result = evaluateToolPermission(input, config);

			// This should use default since single * doesn't match __
			expect(result.decision).toBe('allow');
		});

		it('should match double wildcard pattern (mcp__**)', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'mcp__**', decision: 'allow' },
				],
			};

			const input = createHookInput('mcp__github__issues__create');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
		});

		it('should match prefix pattern (mcp__github__*)', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'mcp__github__*', decision: 'allow' },
				],
			};

			const input = createHookInput('mcp__github__issues');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
		});
	});

	describe('evaluateToolPermission - conditions', () => {
		it('should evaluate includes condition', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Bash',
						decision: 'deny',
						condition: "input.command.includes('rm')",
					},
				],
			};

			const input = createHookInput('Bash', { command: 'rm -rf /tmp/test' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('deny');
		});

		it('should allow when includes condition is false', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Bash',
						decision: 'deny',
						condition: "input.command.includes('rm')",
					},
				],
			};

			const input = createHookInput('Bash', { command: 'ls -la' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
		});

		it('should evaluate startsWith condition', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Read',
						decision: 'deny',
						condition: "input.file_path.startsWith('/etc')",
					},
				],
			};

			const input = createHookInput('Read', { file_path: '/etc/passwd' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('deny');
		});

		it('should evaluate endsWith condition', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Write',
						decision: 'deny',
						condition: "input.file_path.endsWith('.env')",
					},
				],
			};

			const input = createHookInput('Write', { file_path: '/project/.env' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('deny');
		});

		it('should evaluate === equality condition', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Bash',
						decision: 'allow',
						condition: "input.command === 'npm test'",
					},
				],
			};

			const input = createHookInput('Bash', { command: 'npm test' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
		});

		it('should evaluate !== inequality condition', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Bash',
						decision: 'deny',
						condition: "input.command !== 'npm test'",
					},
				],
			};

			const input = createHookInput('Bash', { command: 'npm run build' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('deny');
		});

		it('should evaluate negated condition (!includes)', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Bash',
						decision: 'allow',
						condition: "!input.command.includes('sudo')",
					},
				],
			};

			const input = createHookInput('Bash', { command: 'ls -la' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
		});

		it('should deny when negated condition is false', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{
						toolPattern: 'Bash',
						decision: 'allow',
						condition: "!input.command.includes('sudo')",
					},
				],
			};

			const input = createHookInput('Bash', { command: 'sudo rm -rf /' });
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('deny');
		});
	});

	describe('evaluateToolPermission - askFallback', () => {
		it('should use askFallback when decision is ask', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'allow',
				rules: [
					{ toolPattern: 'Bash', decision: 'ask' },
				],
			};

			const input = createHookInput('Bash');
			const result = evaluateToolPermission(input, config);

			// 'ask' falls back to askFallback
			expect(result.decision).toBe('allow');
		});

		it('should fallback to deny when askFallback is deny', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'Write', decision: 'ask' },
				],
			};

			const input = createHookInput('Write');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('deny');
		});
	});

	describe('evaluateToolPermission - rule priority', () => {
		it('should use first matching rule', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [
					{ toolPattern: 'Bash', decision: 'allow', reason: 'First rule' },
					{ toolPattern: 'Bash', decision: 'deny', reason: 'Second rule' },
				],
			};

			const input = createHookInput('Bash');
			const result = evaluateToolPermission(input, config);

			expect(result.decision).toBe('allow');
			expect(result.reason).toContain('First rule');
		});
	});

	describe('isToolAllowed helper', () => {
		it('should return true for allowed tools', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'allow',
				askFallback: 'deny',
				rules: [],
			};

			const input = createHookInput('Read');
			expect(isToolAllowed(input, config)).toBe(true);
		});

		it('should return false for denied tools', () => {
			const config: ToolPermissionsConfig = {
				enabled: true,
				defaultDecision: 'deny',
				askFallback: 'deny',
				rules: [],
			};

			const input = createHookInput('Read');
			expect(isToolAllowed(input, config)).toBe(false);
		});
	});
});
