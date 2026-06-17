/**
 * Edge Cases - Tool Permissions
 */

import { describe, it, expect } from 'vitest';
import { evaluateToolPermission } from '../permissions/ToolPermissions';

describe('Edge Cases - Tool Permissions', () => {
	describe('glob pattern matching via evaluateToolPermission', () => {
		const createConfig = (pattern: string) => ({
			enabled: true,
			rules: [{ toolPattern: pattern, decision: 'deny' as const }],
			defaultDecision: 'allow' as const,
			askFallback: 'allow' as const,
		});

		const createInput = (toolName: string) => ({
			session_id: 'test',
			transcript_path: '/tmp',
			cwd: '/project',
			hook_event_name: 'PreToolUse' as const,
			tool_name: toolName,
			tool_input: {},
		});

		it('KNOWN LIMITATION: * does not match across __ boundaries', () => {
			// SECURITY NOTE: The glob-to-regex translation converts * to [^_]*
			// which means * won't match across __ (double underscore) in tool names.
			// Pattern 'mcp__*' only matches 'mcp__X', not 'mcp__server__tool'
			const result = evaluateToolPermission(createInput('mcp__server__tool'), createConfig('mcp__*'));
			// This does NOT match - * stops at the next __
			expect(result.decision).toBe('allow');
		});

		it('should handle ** for any depth', () => {
			const result = evaluateToolPermission(
				createInput('mcp__a__b__c__tool'),
				createConfig('mcp__**'),
			);
			expect(result.decision).toBe('deny');
		});

		it('should be case sensitive', () => {
			const result = evaluateToolPermission(createInput('READ'), createConfig('Read'));
			expect(result.decision).toBe('allow'); // Doesn't match
		});

		it('should handle special regex chars in pattern', () => {
			const result = evaluateToolPermission(
				createInput('file.test[0]'),
				createConfig('file.test[0]'),
			);
			expect(result.decision).toBe('deny');
		});
	});

	describe('condition evaluation edge cases', () => {
		const config = {
			enabled: true,
			rules: [
				{
					toolPattern: 'Bash',
					decision: 'deny' as const,
					condition: "input.command.includes('rm')",
				},
			],
			defaultDecision: 'allow' as const,
			askFallback: 'allow' as const,
		};

		it('should handle missing input field', () => {
			const result = evaluateToolPermission(
				{
					session_id: 'test',
					transcript_path: '/tmp',
					cwd: '/project',
					hook_event_name: 'PreToolUse',
					tool_name: 'Bash',
					tool_input: {}, // No command field
				},
				config,
			);
			// Condition should not match if field missing
			expect(result.decision).toBe('allow');
		});

		it('should handle null input field', () => {
			const result = evaluateToolPermission(
				{
					session_id: 'test',
					transcript_path: '/tmp',
					cwd: '/project',
					hook_event_name: 'PreToolUse',
					tool_name: 'Bash',
					tool_input: { command: null },
				},
				config,
			);
			expect(result.decision).toBe('allow');
		});

		it('should handle number input where string expected', () => {
			const result = evaluateToolPermission(
				{
					session_id: 'test',
					transcript_path: '/tmp',
					cwd: '/project',
					hook_event_name: 'PreToolUse',
					tool_name: 'Bash',
					tool_input: { command: 12345 }, // Number not string
				},
				config,
			);
			expect(result.decision).toBe('allow');
		});

		it('should handle prototype pollution attempt', () => {
			const input = {
				session_id: 'test',
				transcript_path: '/tmp',
				cwd: '/project',
				hook_event_name: 'PreToolUse' as const,
				tool_name: 'Bash',
				tool_input: {
					command: 'safe',
					__proto__: { command: 'rm -rf /' },
				},
			};
			const result = evaluateToolPermission(input, config);
			// Should use own property, not prototype
			expect(result.decision).toBe('allow');
		});
	});
});

