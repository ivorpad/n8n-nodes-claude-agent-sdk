import { describe, expect, it } from 'vitest';

import {
	asNumber,
	buildSafeIndexName,
	quoteQualifiedTableName,
	validateExistingSchema,
} from '../postgresIdentifiers';
import type { QueryableClient } from '../postgresTypes';

describe('quoteQualifiedTableName', () => {
	it('quotes a bare table name', () => {
		expect(quoteQualifiedTableName('claude_sessions')).toBe('"claude_sessions"');
	});

	it('quotes each part of a schema-qualified name', () => {
		expect(quoteQualifiedTableName('analytics.claude_sessions')).toBe(
			'"analytics"."claude_sessions"',
		);
	});

	it('escapes embedded double quotes', () => {
		expect(quoteQualifiedTableName('weird"name')).toBe('"weird""name"');
	});

	// Safe-variant behavior (finding 1.2): the divergent session-memory copy lacked
	// these guards, so a whitespace-padded or partially-empty name slipped through.
	it('trims surrounding whitespace before quoting', () => {
		expect(quoteQualifiedTableName('  claude_sessions  ')).toBe('"claude_sessions"');
	});

	it('rejects an empty or whitespace-only name', () => {
		expect(() => quoteQualifiedTableName('   ')).toThrow(/table name is required/);
	});

	it('rejects a name with an empty part', () => {
		expect(() => quoteQualifiedTableName('schema.')).toThrow(/Invalid Postgres table name/);
		expect(() => quoteQualifiedTableName('.table')).toThrow(/Invalid Postgres table name/);
	});

	it('uses the provided label in the empty-name error', () => {
		expect(() => quoteQualifiedTableName('', 'Stream')).toThrow('Stream table name is required');
	});
});

describe('buildSafeIndexName', () => {
	it('collapses non-identifier characters in the base name', () => {
		expect(buildSafeIndexName('analytics.claude_streams', 'status_idx')).toBe(
			'"analytics_claude_streams_status_idx"',
		);
	});

	// Finding 1.3: distinct table names must yield distinct index names so two
	// tables in one schema do not collide on a constant index identifier.
	it('derives distinct names for distinct table names', () => {
		const first = buildSafeIndexName('hitl_pending_a', 'status');
		const second = buildSafeIndexName('hitl_pending_b', 'status');
		expect(first).not.toBe(second);
	});
});

describe('asNumber', () => {
	it('truncates finite numbers', () => {
		expect(asNumber(3.9)).toBe(3);
	});

	it('parses numeric strings', () => {
		expect(asNumber('42')).toBe(42);
	});

	it('falls back for non-numeric input', () => {
		expect(asNumber('not-a-number', 7)).toBe(7);
		expect(asNumber(undefined, 1)).toBe(1);
		expect(asNumber(Number.NaN)).toBe(0);
	});
});

describe('validateExistingSchema', () => {
	function clientWithColumns(columns: readonly string[]): QueryableClient {
		return {
			query: async <TRow = unknown>() => ({
				rows: columns.map((attname) => ({ attname })) as unknown as TRow[],
				rowCount: columns.length,
			}),
		};
	}

	it('passes when all required columns are present', async () => {
		await expect(
			validateExistingSchema(clientWithColumns(['a', 'b', 'c']), 'tbl', ['a', 'b']),
		).resolves.toBeUndefined();
	});

	it('throws listing missing columns with the provided label', async () => {
		await expect(
			validateExistingSchema(clientWithColumns(['a']), 'tbl', ['a', 'b', 'c'], 'Stream table'),
		).rejects.toThrow('Stream table "tbl" is missing required columns: b, c');
	});
});
