import postgres from "postgres";

/**
 * Single Postgres connection pool (porsager `postgres`). Server-only.
 *
 * Lazily created so a missing DATABASE_URL doesn't crash at import time —
 * the error surfaces on first query instead, matching how the API routes
 * already handle a missing database.
 *
 * Usage:
 *   const sql = getDb();
 *   const rows = await sql<MyRow[]>`select * from t where id = ${id}`;
 *
 * Notes:
 *  - JS arrays map to Postgres arrays natively (keywords text[], etc.).
 *  - For jsonb columns, wrap objects with `sql.json(value)` on write.
 *  - On a unique-violation the thrown error has `.code === "23505"`.
 */
let cached: ReturnType<typeof postgres> | null = null;

export function getDb() {
	if (!cached) {
		const url = process.env.DATABASE_URL;
		if (!url) {
			throw new Error(
				"DATABASE_URL is not set. Point it at your Postgres instance (see .env.example).",
			);
		}
		cached = postgres(url, {
			max: 10,
			idle_timeout: 20,
			// Surface the Postgres SQLSTATE on errors (e.g. "23505").
			onnotice: () => {},
		});
	}
	return cached;
}

/** Narrow an unknown caught error to a Postgres unique-violation. */
export function isUniqueViolation(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		(err as { code?: string }).code === "23505"
	);
}
