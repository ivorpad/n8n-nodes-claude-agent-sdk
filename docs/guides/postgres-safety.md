# Postgres Safety Rules

> These are CRITICAL rules learned from production incidents. Always follow them.

## 1. Never ALTER TABLE Without Schema Validation

Never issue `ALTER TABLE` on an existing Postgres table without first querying `pg_attribute` to verify the table schema matches the expected type.

- `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` will silently mutate ANY table into a hybrid that breaks on insert
- Always: introspect → validate → then DDL

The `PostgresSessionMemory` node has the reference pattern (checks for artifact columns before proceeding).

## 2. All Pool Connections Go Through the Factory

All Postgres Pool connections MUST go through `createPostgresConnectionHandle()` in `postgresConnection.ts`.

Direct `new Pool()` construction bypasses:
- SSL mode mapping (allow/disable/require + allowUnauthorizedCerts)
- SSH tunnel support

The connection factory is the single source of truth for credential → Pool translation.

## 3. Missing Column Errors

If a runtime error mentions "column X does not exist" on a Postgres table:
1. Do NOT blindly add the column via migration
2. First ask: "Why is this column missing? Is this the right table?"
3. Query the existing schema to determine if the table was created by a different component (mapping vs artifact vs unrelated)
4. The answer determines whether to migrate, reject, or use a different table name

## 4. Optional Local Validation Hooks

If you use local pre-handoff hooks, keep their configuration outside tracked source. The useful checks are:
1. `ALTER TABLE` in persistence files without schema validation
2. Direct Pool construction outside `postgresConnection.ts`
3. Stop-time reminder when DB changes were made during the session
