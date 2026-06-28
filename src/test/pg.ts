import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import postgres from "postgres";

/**
 * Spin up an isolated, throwaway Postgres database for integration tests and
 * apply the real `db/schema.sql` to it. This exercises the actual unique
 * indexes (dedup + cooldown) and CHECK constraints — the things unit tests
 * with a mocked `sql` can't prove.
 *
 * Connection target (in priority order):
 *  1. `TEST_DATABASE_URL` — point at any reachable Postgres.
 *  2. `DATABASE_URL`.
 *  3. `postgresql://postgres:postgres@localhost:5434/postgres` (the project's
 *     local dev container from `scripts`/compose).
 *
 * A fresh database named `<base>_itest` is dropped and recreated per run, so
 * tests never touch dev data.
 */
const TEST_DB_NAME = "oh_daddy_itest";

function resolveBaseUrl(): string {
	return (
		process.env.TEST_DATABASE_URL ??
		process.env.DATABASE_URL ??
		"postgresql://postgres:postgres@localhost:5434/postgres"
	);
}

function withDatabase(rawUrl: string, dbName: string): string {
	const url = new URL(rawUrl);
	url.pathname = `/${dbName}`;
	return url.toString();
}

function schemaSql(): string {
	const path = fileURLToPath(new URL("../../db/schema.sql", import.meta.url));
	return readFileSync(path, "utf8");
}

export interface TestDb {
	sql: Sql;
	/** Connection string for the throwaway database (set DATABASE_URL to this). */
	url: string;
	/** Wipe every table back to empty between tests. */
	truncate(): Promise<void>;
	/** Close the test connection pool. */
	end(): Promise<void>;
}

/**
 * Create (or reset) the throwaway DB, apply the schema, and return a live
 * connection plus helpers. Returns `null` when no Postgres is reachable so the
 * caller can `describe.skip` instead of failing a machine without a database.
 */
export async function setupTestDb(): Promise<TestDb | null> {
	const baseUrl = resolveBaseUrl();
	const adminUrl = withDatabase(baseUrl, "postgres");
	const testUrl = withDatabase(baseUrl, TEST_DB_NAME);

	const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
	try {
		await admin`SELECT 1`;
		await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
		await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
	} catch {
		await admin.end({ timeout: 1 }).catch(() => {});
		return null;
	}
	await admin.end({ timeout: 5 });

	const sql = postgres(testUrl, { max: 4, onnotice: () => {} });
	await sql.unsafe(schemaSql());

	const tables = [
		"automation_matches",
		"messages",
		"conversations",
		"comment_automations",
		"contacts",
		"platform_accounts",
		"webhook_events",
		"settings",
	];

	return {
		sql,
		url: testUrl,
		async truncate() {
			await sql.unsafe(
				`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`,
			);
		},
		async end() {
			await sql.end({ timeout: 5 });
		},
	};
}
