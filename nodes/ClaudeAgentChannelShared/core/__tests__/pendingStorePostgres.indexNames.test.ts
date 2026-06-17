import { describe, expect, it } from 'vitest';

import { buildPendingIndexStatements } from '../pendingStorePostgres';

/**
 * V13, finding 1.3: the pending store previously created its two indexes with
 * CONSTANT names (`idx_hitl_pending_status`, `idx_hitl_pending_provider_msg`).
 * Two workflows using different pending-store tables in one schema would then
 * collide — the second `CREATE INDEX IF NOT EXISTS` silently no-op'd, leaving
 * that table unindexed. Index names must now be derived per-table.
 */
describe('buildPendingIndexStatements', () => {
	function indexNames(statements: string[]): string[] {
		return statements.map((statement) => {
			const match = statement.match(/CREATE INDEX IF NOT EXISTS ("[^"]+")/);
			if (!match) throw new Error(`No index name found in: ${statement}`);
			return match[1];
		});
	}

	it('emits two per-table index statements targeting the quoted table', () => {
		const statements = buildPendingIndexStatements('"hitl_pending_alpha"', 'hitl_pending_alpha');
		expect(statements).toHaveLength(2);
		expect(statements.every((s) => s.includes('ON "hitl_pending_alpha"'))).toBe(true);
	});

	it('derives distinct index names for distinct table names', () => {
		const namesA = indexNames(buildPendingIndexStatements('"hitl_pending_alpha"', 'hitl_pending_alpha'));
		const namesB = indexNames(buildPendingIndexStatements('"hitl_pending_beta"', 'hitl_pending_beta'));

		// Base table name is embedded in each index name.
		expect(namesA.every((name) => name.includes('hitl_pending_alpha'))).toBe(true);
		expect(namesB.every((name) => name.includes('hitl_pending_beta'))).toBe(true);

		// No index name is shared across the two tables (the collision is gone).
		const overlap = namesA.filter((name) => namesB.includes(name));
		expect(overlap).toEqual([]);
	});

	it('sanitizes schema-qualified table names into a single safe identifier', () => {
		const names = indexNames(buildPendingIndexStatements('"app"."hitl_pending"', 'app.hitl_pending'));
		// Dots are collapsed so the identifier is valid SQL.
		expect(names.every((name) => name.includes('app_hitl_pending'))).toBe(true);
	});
});
