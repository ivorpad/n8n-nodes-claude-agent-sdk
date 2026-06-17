/**
 * Edge Cases - Content Filter
 */

import { describe, it, expect } from 'vitest';
import { checkContentFilter } from '../permissions/ContentFilter';

describe('Edge Cases - Content Filter', () => {
	describe('regex injection', () => {
		it('should handle regex special chars in input safely', () => {
			const config = {
				enabled: true,
				rules: [],
				presets: ['dangerous-commands'] as const,
			};

			// Input with regex metacharacters
			const input = {
				session_id: 'test',
				transcript_path: '/tmp',
				cwd: '/project',
				hook_event_name: 'PreToolUse' as const,
				tool_name: 'Bash',
				tool_input: { command: 'echo ".*+?^${}()|[]"' },
			};

			// Should not throw
			expect(() => checkContentFilter(input, config)).not.toThrow();
		});

		it('should reject catastrophic backtracking patterns before evaluation', () => {
			// The pattern (a+)+$ would hang with standard RegExp on long inputs.
			// It should be rejected before RegExp evaluation.
			const config = {
				enabled: true,
				rules: [
					{
						id: 'evil-regex',
						pattern: '(a+)+$', // Would cause catastrophic backtracking with RegExp
						tools: ['Bash'] as const,
						targetField: 'command' as const,
					},
				],
			};

			// Use a VERY long input that would hang standard RegExp for minutes/hours
			const longInput = 'a'.repeat(100_000) + '!';
			const input = {
				session_id: 'test',
				transcript_path: '/tmp',
				cwd: '/project',
				hook_event_name: 'PreToolUse' as const,
				tool_name: 'Bash',
				tool_input: { command: longInput },
			};

			const start = Date.now();
			const result = checkContentFilter(input, config);
			const duration = Date.now() - start;

			expect(result.blocked).toBe(true);
			expect(result.matchedContent).toContain('Unsafe regex pattern rejected');
			expect(duration).toBeLessThan(100);
		});
	});

	describe('bypass attempts', () => {
		const config = {
			enabled: true,
			rules: [],
			presets: ['dangerous-commands'] as const,
		};

		const createBashInput = (command: string) => ({
			session_id: 'test',
			transcript_path: '/tmp',
			cwd: '/project',
			hook_event_name: 'PreToolUse' as const,
			tool_name: 'Bash',
			tool_input: { command },
		});

		it('should block rm with variable expansion (FIXED with shell-quote)', () => {
			// SECURITY: shell-quote normalizes command substitution
			const result = checkContentFilter(createBashInput('r$()m -rf /'), config);
			// shell-quote parses this as 'rm -rf /' which is blocked
			expect(result.blocked).toBe(true);
		});

		it('should block rm with escape characters (FIXED with shell-quote)', () => {
			// SECURITY: shell-quote handles escape sequences
			const result = checkContentFilter(createBashInput('r\\m -rf /'), config);
			// shell-quote parses this as 'rm -rf /' which is blocked
			expect(result.blocked).toBe(true);
		});

		it('should block rm with quotes (FIXED with shell-quote)', () => {
			// SECURITY: shell-quote strips quotes during parsing
			const result = checkContentFilter(createBashInput('"rm" "-rf" "/"'), config);
			// shell-quote parses this as 'rm -rf /' which is blocked
			expect(result.blocked).toBe(true);
		});

		it('should block rm with backticks (FIXED with shell-quote)', () => {
			// SECURITY: shell-quote handles backticks
			const result = checkContentFilter(createBashInput('`rm` -rf /'), config);
			// shell-quote parses this as 'rm -rf /' which is blocked
			expect(result.blocked).toBe(true);
		});

		it('should block rm with escaped whitespace (FIXED with shell-quote)', () => {
			const result = checkContentFilter(createBashInput('rm\\ -rf /'), config);
			expect(result.blocked).toBe(true);
		});

		it('should block rm with newline', () => {
			const result = checkContentFilter(createBashInput('echo hi\nrm -rf /'), config);
			expect(result.blocked).toBe(true);
		});

		it('should block sudo with -s', () => {
			const result = checkContentFilter(createBashInput('sudo -s'), config);
			expect(result.blocked).toBe(true);
		});

		it('should block sudo via PATH manipulation', () => {
			const result = checkContentFilter(createBashInput('PATH=/tmp:$PATH sudo id'), config);
			expect(result.blocked).toBe(true);
		});
	});
});
