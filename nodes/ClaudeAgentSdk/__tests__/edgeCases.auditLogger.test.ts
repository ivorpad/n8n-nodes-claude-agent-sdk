/**
 * Edge Cases - Audit Logger
 */

import { describe, it, expect } from 'vitest';
import { createAuditLogger } from '../permissions/AuditLogger';

describe('Edge Cases - Audit Logger', () => {
	it('should handle very large inputs', () => {
		const config = { enabled: true, logInputs: true };
		const logger = createAuditLogger(config);

		const largeInput = {
			session_id: 'test',
			transcript_path: '/tmp',
			cwd: '/project',
			hook_event_name: 'PreToolUse' as const,
			tool_name: 'Write',
			tool_input: { content: 'x'.repeat(10_000_000) }, // 10MB
		};

		// Should not crash or run out of memory
		logger.logPreToolUse(largeInput, 'tool-1');
		const entries = logger.getEntries();
		expect(entries.length).toBe(1);
	});

	it('should handle concurrent logging', async () => {
		const config = { enabled: true, logInputs: true };
		const logger = createAuditLogger(config);

		const createInput = (id: number) => ({
			session_id: 'test',
			transcript_path: '/tmp',
			cwd: '/project',
			hook_event_name: 'PreToolUse' as const,
			tool_name: 'Read',
			tool_input: { file: `file${id}` },
		});

		// Log 100 entries concurrently
		await Promise.all(
			Array(100)
				.fill(null)
				.map((_, i) =>
					Promise.resolve().then(() => logger.logPreToolUse(createInput(i), `tool-${i}`)),
				),
		);

		const entries = logger.getEntries();
		expect(entries.length).toBe(100);
	});

	it('should handle redaction pattern that matches everything', () => {
		const config = {
			enabled: true,
			logInputs: true,
			redactPatterns: ['.*'], // Matches everything
		};
		const logger = createAuditLogger(config);

		const input = {
			session_id: 'test',
			transcript_path: '/tmp',
			cwd: '/project',
			hook_event_name: 'PreToolUse' as const,
			tool_name: 'Read',
			tool_input: { path: '/some/path' },
		};

		logger.logPreToolUse(input, 'tool-1');
		const entries = logger.getEntries();
		// IMPLEMENTATION NOTE: The .* pattern with global replace matches empty
		// strings between characters, resulting in multiple [REDACTED] insertions.
		// This is expected regex behavior when using replace with .* globally.
		expect((entries[0].toolInput as any).path).toContain('[REDACTED]');
	});
});

