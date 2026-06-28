#!/usr/bin/env node
/**
 * End-to-end smoke test for the SELF-HOSTED Inngest round-trip.
 *
 * Proves the live path that unit/integration tests can't:
 *   send "comment/process" event
 *     -> Inngest dev server
 *     -> POST /api/inngest (Next app, real serve handler)
 *     -> processComment function (real steps)
 *     -> runKeywordAutomation
 *     -> Postgres `automation_matches` row
 *
 * The seeded automation has keywords but EMPTY comment_replies and dm_message,
 * so the function completes WITHOUT calling Meta's Graph API — the match row is
 * the success signal.
 *
 * Boots its own throwaway DB, a Next dev server, and an Inngest dev server,
 * then tears everything down. No prod/dev data is touched.
 *
 * Run: npm run test:smoke   (requires Docker Postgres reachable + ports free)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const NEXT_PORT = Number(process.env.SMOKE_NEXT_PORT ?? 3111);
const INNGEST_PORT = Number(process.env.SMOKE_INNGEST_PORT ?? 8288);
const DB_NAME = "oh_daddy_smoke";
const BASE_DB_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@localhost:5434/postgres";

const children = [];
let testSql;

function log(msg) {
	console.log(`[smoke] ${msg}`);
}

function withDb(rawUrl, db) {
	const url = new URL(rawUrl);
	url.pathname = `/${db}`;
	return url.toString();
}

async function waitFor(label, fn, { timeoutMs = 60_000, intervalMs = 1000 }) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			if (await fn()) return;
		} catch {
			// keep polling
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`Timed out waiting for ${label} (${timeoutMs}ms)`);
}

async function setupDb() {
	const adminUrl = withDb(BASE_DB_URL, "postgres");
	const testUrl = withDb(BASE_DB_URL, DB_NAME);

	const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
	await admin`SELECT 1`;
	await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME}`);
	await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
	await admin.end({ timeout: 5 });

	const schema = readFileSync(
		fileURLToPath(new URL("../db/schema.sql", import.meta.url)),
		"utf8",
	);
	testSql = postgres(testUrl, { max: 2, onnotice: () => {} });
	await testSql.unsafe(schema);

	// Seed: one connected account + one keyword automation with NO outbound
	// content (keeps the function off Meta's API).
	const [account] = await testSql`
		INSERT INTO platform_accounts (platform, account_id, account_name, access_token)
		VALUES ('facebook', '123456', 'Smoke Page', 'mock-token')
		RETURNING id`;
	await testSql`
		INSERT INTO comment_automations
			(platform_account_id, name, keywords, comment_replies, dm_message)
		VALUES (${account.id}, 'Smoke', ${["guide"]}, ${[]}, '')`;

	return { testUrl, accountId: account.id };
}

function startNext(testUrl) {
	const child = spawn("npx", ["next", "dev", "-p", String(NEXT_PORT)], {
		env: {
			...process.env,
			DATABASE_URL: testUrl,
			INNGEST_DEV: "1",
			INNGEST_BASE_URL: `http://localhost:${INNGEST_PORT}`,
			NODE_ENV: "development",
		},
		stdio: "ignore",
	});
	children.push(child);
}

function startInngest() {
	const child = spawn(
		"node_modules/.bin/inngest-cli",
		[
			"dev",
			"-u",
			`http://localhost:${NEXT_PORT}/api/inngest`,
			"--port",
			String(INNGEST_PORT),
			"--no-discovery",
		],
		{ env: { ...process.env }, stdio: "ignore" },
	);
	children.push(child);
}

async function sendEvent(accountId) {
	const res = await fetch(`http://localhost:${INNGEST_PORT}/e/smoke_key`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: "comment/process",
			data: {
				platform: "facebook",
				platformAccountId: accountId,
				rawData: {
					comment_id: "123_456",
					post_id: "123",
					from: { id: "789", name: "Smoke Tester" },
					message: "guide",
					verb: "add",
				},
			},
		}),
	});
	if (!res.ok) throw new Error(`event send failed: ${res.status}`);
}

function cleanup() {
	for (const c of children) {
		try {
			c.kill("SIGTERM");
		} catch {
			// already gone
		}
	}
}

async function main() {
	log(`base db: ${BASE_DB_URL.replace(/:[^:@/]+@/, ":***@")}`);
	const { testUrl, accountId } = await setupDb();
	log(`seeded throwaway db "${DB_NAME}", account=${accountId}`);

	startInngest();
	startNext(testUrl);
	log(`booting next:${NEXT_PORT} + inngest:${INNGEST_PORT} ...`);

	await waitFor(
		"next /api/inngest",
		async () => (await fetch(`http://localhost:${NEXT_PORT}/api/inngest`)).ok,
		{ timeoutMs: 90_000 },
	);
	log("next app is serving /api/inngest");

	await waitFor(
		"inngest dev server",
		async () => (await fetch(`http://localhost:${INNGEST_PORT}/`)).ok,
		{ timeoutMs: 30_000 },
	);
	log("inngest dev server is up");

	// Give the dev server a moment to sync the app's functions.
	await new Promise((r) => setTimeout(r, 5000));

	await sendEvent(accountId);
	log("sent comment/process event — polling for automation_matches row ...");

	await waitFor(
		"automation_matches row",
		async () => {
			const rows = await testSql`SELECT id FROM automation_matches`;
			return rows.length > 0;
		},
		{ timeoutMs: 45_000, intervalMs: 1500 },
	);

	const [match] = await testSql`
		SELECT matched_keyword, match_type, comment_reply_sent, dm_sent
		FROM automation_matches LIMIT 1`;
	log(`✅ PASS — match recorded: ${JSON.stringify(match)}`);
}

main()
	.then(async () => {
		cleanup();
		await testSql?.end({ timeout: 3 }).catch(() => {});
		log("done");
		process.exit(0);
	})
	.catch(async (err) => {
		console.error(`[smoke] ❌ FAIL — ${err.message}`);
		cleanup();
		await testSql?.end({ timeout: 3 }).catch(() => {});
		process.exit(1);
	});
