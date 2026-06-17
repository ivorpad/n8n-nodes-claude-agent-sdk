/**
 * AuditLogger Unit Tests
 *
 * Tests for audit logging functionality including redaction,
 * duration tracking, and entry limits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuditLogger } from '../../permissions/AuditLogger';
import type { AuditLoggerConfig, PreToolUseHookInput } from '../../permissions/types';

describe('AuditLogger', () => {
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

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('createAuditLogger', () => {
		it('should create logger with required methods', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			expect(logger.logBlocked).toBeInstanceOf(Function);
			expect(logger.logPreToolUse).toBeInstanceOf(Function);
			expect(logger.logPostToolUse).toBeInstanceOf(Function);
			expect(logger.getEntries).toBeInstanceOf(Function);
			expect(logger.clear).toBeInstanceOf(Function);
		});
	});

	describe('logBlocked', () => {
		it('should log blocked tool attempt', () => {
			const config: AuditLoggerConfig = { enabled: true, logInputs: true };
			const logger = createAuditLogger(config);

			const input = createHookInput('Bash', { command: 'rm -rf /' });
			logger.logBlocked(input, 'tool-123', 'Dangerous command', 'danger-rule');

			const entries = logger.getEntries();
			expect(entries.length).toBe(1);
			expect(entries[0].toolName).toBe('Bash');
			expect(entries[0].toolUseId).toBe('tool-123');
			expect(entries[0].blocked).toBe(true);
			expect(entries[0].blockReason).toBe('Dangerous command');
			expect(entries[0].blockRule).toBe('danger-rule');
		});

		it('should include inputs when logInputs enabled', () => {
			const config: AuditLoggerConfig = { enabled: true, logInputs: true };
			const logger = createAuditLogger(config);

			const input = createHookInput('Read', { file_path: '/test.ts' });
			logger.logBlocked(input, 'tool-123', 'Blocked');

			const entries = logger.getEntries();
			expect(entries[0].toolInput).toEqual({ file_path: '/test.ts' });
		});

		it('should redact inputs when logInputs disabled', () => {
			const config: AuditLoggerConfig = { enabled: true, logInputs: false };
			const logger = createAuditLogger(config);

			const input = createHookInput('Read', { file_path: '/test.ts' });
			logger.logBlocked(input, 'tool-123', 'Blocked');

			const entries = logger.getEntries();
			expect(entries[0].toolInput).toEqual({ _redacted: true });
		});
	});

	describe('logPreToolUse', () => {
		it('should log allowed tool attempt', () => {
			const config: AuditLoggerConfig = { enabled: true, logInputs: true };
			const logger = createAuditLogger(config);

			const input = createHookInput('Read', { file_path: '/test.ts' });
			logger.logPreToolUse(input, 'tool-456');

			const entries = logger.getEntries();
			expect(entries.length).toBe(1);
			expect(entries[0].toolName).toBe('Read');
			expect(entries[0].toolUseId).toBe('tool-456');
			expect(entries[0].blocked).toBe(false);
			expect(entries[0].sessionId).toBe('test-session');
		});

		it('should include timestamp', () => {
			vi.setSystemTime(new Date('2025-01-15T10:30:00Z'));

			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			const input = createHookInput('Read', {});
			logger.logPreToolUse(input, 'tool-123');

			const entries = logger.getEntries();
			expect(entries[0].timestamp).toBe('2025-01-15T10:30:00.000Z');
		});

		it('should generate unique IDs for each entry', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			logger.logPreToolUse(createHookInput('Read', {}), 'tool-1');
			logger.logPreToolUse(createHookInput('Write', {}), 'tool-2');

			const entries = logger.getEntries();
			expect(entries[0].id).not.toBe(entries[1].id);
			expect(entries[0].id).toMatch(/^audit_/);
		});
	});

	describe('logPostToolUse', () => {
		it('should update entry with duration', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			vi.setSystemTime(new Date('2025-01-15T10:30:00.000Z'));
			logger.logPreToolUse(createHookInput('Read', {}), 'tool-123');

			vi.setSystemTime(new Date('2025-01-15T10:30:00.500Z'));
			logger.logPostToolUse('tool-123', 'file contents');

			const entries = logger.getEntries();
			expect(entries[0].durationMs).toBe(500);
		});

		it('should include output when logOutputs enabled', () => {
			const config: AuditLoggerConfig = { enabled: true, logOutputs: true };
			const logger = createAuditLogger(config);

			logger.logPreToolUse(createHookInput('Read', {}), 'tool-123');
			logger.logPostToolUse('tool-123', { content: 'file data' });

			const entries = logger.getEntries();
			expect(entries[0].toolOutput).toEqual({ content: 'file data' });
		});

		it('should not include output when logOutputs disabled', () => {
			const config: AuditLoggerConfig = { enabled: true, logOutputs: false };
			const logger = createAuditLogger(config);

			logger.logPreToolUse(createHookInput('Read', {}), 'tool-123');
			logger.logPostToolUse('tool-123', { content: 'file data' });

			const entries = logger.getEntries();
			expect(entries[0].toolOutput).toBeUndefined();
		});

		it('should handle missing pre-tool entry gracefully', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			// Log post without pre - should not throw
			expect(() => logger.logPostToolUse('unknown-tool', 'result')).not.toThrow();
		});
	});

	describe('redaction', () => {
		it('should redact patterns in inputs', () => {
			const config: AuditLoggerConfig = {
				enabled: true,
				logInputs: true,
				redactPatterns: ['api[_-]?key', 'password'],
			};
			const logger = createAuditLogger(config);

			const input = createHookInput('Write', {
				content: 'API_KEY=secret123 and password=hunter2',
			});
			logger.logPreToolUse(input, 'tool-123');

			const entries = logger.getEntries();
			expect(entries[0].toolInput).toEqual({
				content: '[REDACTED]=secret123 and [REDACTED]=hunter2',
			});
		});

		it('should redact patterns in outputs', () => {
			const config: AuditLoggerConfig = {
				enabled: true,
				logOutputs: true,
				redactPatterns: ['secret'],
			};
			const logger = createAuditLogger(config);

			logger.logPreToolUse(createHookInput('Read', {}), 'tool-123');
			logger.logPostToolUse('tool-123', 'This contains secret data');

			const entries = logger.getEntries();
			expect(entries[0].toolOutput).toBe('This contains [REDACTED] data');
		});

		it('should redact nested objects', () => {
			const config: AuditLoggerConfig = {
				enabled: true,
				logInputs: true,
				redactPatterns: ['secret-token-123', 'another-token'],
			};
			const logger = createAuditLogger(config);

			const input = createHookInput('API', {
				auth: {
					token: 'secret-token-123',
					nested: {
						token: 'another-token',
					},
				},
			});
			logger.logPreToolUse(input, 'tool-123');

			const entries = logger.getEntries();
			const toolInput = entries[0].toolInput as Record<string, unknown>;
			expect((toolInput.auth as any).token).toBe('[REDACTED]');
			expect((toolInput.auth as any).nested.token).toBe('[REDACTED]');
		});

		it('should redact arrays', () => {
			const config: AuditLoggerConfig = {
				enabled: true,
				logInputs: true,
				redactPatterns: ['secret'],
			};
			const logger = createAuditLogger(config);

			const input = createHookInput('API', {
				items: ['public', 'secret data', 'more secret'],
			});
			logger.logPreToolUse(input, 'tool-123');

			const entries = logger.getEntries();
			expect((entries[0].toolInput as any).items).toEqual([
				'public',
				'[REDACTED] data',
				'more [REDACTED]',
			]);
		});

		it('should handle invalid regex patterns gracefully', () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const config: AuditLoggerConfig = {
				enabled: true,
				logInputs: true,
				redactPatterns: ['[invalid(regex', 'valid'],
			};
			const logger = createAuditLogger(config);

			const input = createHookInput('Read', { content: 'valid data' });
			logger.logPreToolUse(input, 'tool-123');

			// Should still work with valid pattern
			const entries = logger.getEntries();
			expect((entries[0].toolInput as any).content).toBe('[REDACTED] data');

			consoleSpy.mockRestore();
		});

		it('should handle null and undefined values', () => {
			const config: AuditLoggerConfig = {
				enabled: true,
				logInputs: true,
				redactPatterns: ['test'],
			};
			const logger = createAuditLogger(config);

			const input = createHookInput('Read', {
				nullValue: null,
				nested: { value: undefined },
			});
			logger.logPreToolUse(input, 'tool-123');

			const entries = logger.getEntries();
			expect((entries[0].toolInput as any).nullValue).toBe(null);
		});
	});

	describe('maxEntries limit', () => {
		it('should enforce maxEntries limit', () => {
			const config: AuditLoggerConfig = { enabled: true, maxEntries: 3 };
			const logger = createAuditLogger(config);

			logger.logPreToolUse(createHookInput('Tool1', {}), 'tool-1');
			logger.logPreToolUse(createHookInput('Tool2', {}), 'tool-2');
			logger.logPreToolUse(createHookInput('Tool3', {}), 'tool-3');
			logger.logPreToolUse(createHookInput('Tool4', {}), 'tool-4');

			const entries = logger.getEntries();
			expect(entries.length).toBe(3);
			// First entry should be removed (FIFO)
			expect(entries.map((e) => e.toolName)).toEqual(['Tool2', 'Tool3', 'Tool4']);
		});

		it('should not limit when maxEntries not set', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			for (let i = 0; i < 100; i++) {
				logger.logPreToolUse(createHookInput(`Tool${i}`, {}), `tool-${i}`);
			}

			const entries = logger.getEntries();
			expect(entries.length).toBe(100);
		});
	});

	describe('clear', () => {
		it('should clear all entries', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			logger.logPreToolUse(createHookInput('Tool1', {}), 'tool-1');
			logger.logPreToolUse(createHookInput('Tool2', {}), 'tool-2');

			expect(logger.getEntries().length).toBe(2);

			logger.clear();

			expect(logger.getEntries().length).toBe(0);
		});

		it('should clear pending start times', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			vi.setSystemTime(new Date('2025-01-15T10:30:00.000Z'));
			logger.logPreToolUse(createHookInput('Tool1', {}), 'tool-1');

			logger.clear();

			vi.setSystemTime(new Date('2025-01-15T10:30:01.000Z'));
			logger.logPostToolUse('tool-1', 'result');

			// Should not find the entry to update (was cleared)
			const entries = logger.getEntries();
			expect(entries.length).toBe(0);
		});
	});

	describe('getEntries', () => {
		it('should return a copy of entries', () => {
			const config: AuditLoggerConfig = { enabled: true };
			const logger = createAuditLogger(config);

			logger.logPreToolUse(createHookInput('Tool1', {}), 'tool-1');

			const entries1 = logger.getEntries();
			const entries2 = logger.getEntries();

			// Should be different arrays
			expect(entries1).not.toBe(entries2);
			// But same content
			expect(entries1).toEqual(entries2);
		});
	});
});
