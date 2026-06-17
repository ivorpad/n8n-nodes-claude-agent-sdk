interface PgRowQueryResult<TRow> {
	rows: TRow[];
	rowCount: number | null;
}

export interface QueryableClient {
	query: <TRow = unknown>(sql: string, params?: unknown[]) => Promise<PgRowQueryResult<TRow>>;
}
