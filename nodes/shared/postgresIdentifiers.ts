import type { QueryableClient } from './postgresTypes';

/**
 * Shared Postgres identifier + schema helpers.
 *
 * These were previously copy-pasted across the HITL interaction store,
 * observability persistence, stream store, channel pending store, and the
 * Postgres session memory node. Centralizing them (P6) removes drift — most
 * importantly the weaker `quoteQualifiedTableName` variant in the session
 * memory node that skipped `.trim()` and empty-part rejection.
 *
 * Behavior is otherwise identical to the previous canonical (safe) copies.
 */

/**
 * Quote a possibly schema-qualified table name into a safe SQL identifier.
 *
 * Trims surrounding whitespace, rejects empty parts (e.g. `"schema."` or
 * `".table"`), and double-quotes each dot-separated part with `"` escaping.
 * This is the SAFE variant: identifiers are never interpolated unquoted.
 */
export function quoteQualifiedTableName(tableName: string, label = 'Postgres'): string {
	const trimmed = tableName.trim();
	if (!trimmed) {
		throw new Error(`${label} table name is required`);
	}

	return trimmed
		.split('.')
		.map((part) => {
			const token = part.trim();
			if (!token) {
				throw new Error(`Invalid Postgres table name "${tableName}"`);
			}
			return `"${token.replace(/"/g, '""')}"`;
		})
		.join('.');
}

/**
 * Build a safe, quoted index name derived from a (possibly qualified) table
 * name plus a suffix. Non-alphanumeric/underscore characters in the base are
 * collapsed to `_` so the name is a valid SQL identifier and is unique per
 * table (avoids index-name collisions when two tables share a schema).
 */
export function buildSafeIndexName(baseName: string, suffix: string): string {
	return `"${baseName.replace(/[^a-zA-Z0-9_]/g, '_')}_${suffix}"`;
}

/**
 * Coerce a numeric-ish value (number or numeric string) to an integer,
 * falling back to `fallback` for anything non-finite. Truncates toward zero.
 */
export function asNumber(value: unknown, fallback = 0): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return Math.trunc(parsed);
		}
	}
	return fallback;
}

/**
 * Verify that an existing relation has all required columns before any DDL or
 * inserts run against it (repo invariant: never alter blindly — verify schema
 * first via `pg_attribute`). Throws listing the missing columns otherwise.
 */
export async function validateExistingSchema(
	client: QueryableClient,
	tableName: string,
	requiredColumns: readonly string[],
	label = 'Table',
): Promise<void> {
	const columnsResult = await client.query<{ attname: string }>(
		`
			SELECT a.attname
			FROM pg_attribute a
			WHERE a.attrelid = to_regclass($1)
				AND a.attnum > 0
				AND NOT a.attisdropped
		`,
		[tableName],
	);

	const columns = new Set(columnsResult.rows.map((row) => row.attname));
	const missing = requiredColumns.filter((column) => !columns.has(column));
	if (missing.length > 0) {
		throw new Error(`${label} "${tableName}" is missing required columns: ${missing.join(', ')}`);
	}
}
