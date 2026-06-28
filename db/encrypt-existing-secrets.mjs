#!/usr/bin/env node
/**
 * One-time, idempotent migration: encrypt existing plaintext secrets at rest.
 *
 *   node db/encrypt-existing-secrets.mjs
 *
 * Requires the same env as the app:
 *   DATABASE_URL        Postgres connection string
 *   APP_ENCRYPTION_KEY  32-byte key, base64 (openssl rand -base64 32)
 *
 * What it does (safe to re-run — already-encrypted / sentinel values are left
 * alone):
 *   1. platform_accounts.access_token — encrypt real Page/user tokens. Skips
 *      sentinels ("" / "pending" / "mock-*") and already-encrypted blobs.
 *   2. settings — encrypt remaining (provider, value) rows. Deletes any leftover
 *      env-only secret rows (meta_app_secret / meta_webhook_verify_token): they
 *      are ignored at read time (BP-001) yet would otherwise sit in the DB as
 *      plaintext secrets.
 *
 * NEVER logs plaintext or ciphertext — only row ids / providers / counts.
 *
 * The on-disk format MUST stay in lockstep with src/lib/crypto.ts:
 *   enc:v1:<base64( iv[12] | authTag[16] | ciphertext )>  (AES-256-GCM)
 */
import { createCipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

const TOKEN_SENTINELS = new Set(["", "pending"]);
const ENV_ONLY_PROVIDERS = new Set([
	"meta_app_secret",
	"meta_webhook_verify_token",
]);

function getKey() {
	const raw = process.env.APP_ENCRYPTION_KEY?.trim();
	if (!raw) {
		throw new Error(
			"APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
		);
	}
	const key = Buffer.from(raw, "base64");
	if (key.length !== KEY_BYTES) {
		throw new Error(
			`APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}).`,
		);
	}
	return key;
}

function isEncrypted(value) {
	return typeof value === "string" && value.startsWith(PREFIX);
}

function isTokenSentinel(value) {
	return TOKEN_SENTINELS.has(value) || value.startsWith("mock-");
}

function encryptSecret(plaintext, key) {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is not set.");
	const key = getKey();
	const sql = postgres(url, { max: 1, onnotice: () => {} });

	let tokensEncrypted = 0;
	let tokensSkipped = 0;
	let settingsEncrypted = 0;
	let settingsDeleted = 0;

	try {
		// 1. platform_accounts.access_token
		const accounts = await sql`
			SELECT id, access_token FROM platform_accounts`;
		for (const row of accounts) {
			const token = row.access_token;
			if (token == null || isEncrypted(token) || isTokenSentinel(token)) {
				tokensSkipped++;
				continue;
			}
			const encrypted = encryptSecret(token, key);
			await sql`
				UPDATE platform_accounts SET access_token = ${encrypted}
				WHERE id = ${row.id}`;
			tokensEncrypted++;
			console.log(`[tokens] encrypted access_token for account ${row.id}`);
		}

		// 2. settings
		const settings = await sql`SELECT provider, value FROM settings`;
		for (const row of settings) {
			if (ENV_ONLY_PROVIDERS.has(row.provider)) {
				await sql`DELETE FROM settings WHERE provider = ${row.provider}`;
				settingsDeleted++;
				console.log(
					`[settings] deleted env-only plaintext row: ${row.provider}`,
				);
				continue;
			}
			if (isEncrypted(row.value)) continue;
			const encrypted = encryptSecret(row.value, key);
			await sql`
				UPDATE settings SET value = ${encrypted}, updated_at = now()
				WHERE provider = ${row.provider}`;
			settingsEncrypted++;
			console.log(`[settings] encrypted value for provider: ${row.provider}`);
		}

		console.log(
			`\nDone. tokens: ${tokensEncrypted} encrypted, ${tokensSkipped} skipped (sentinel/encrypted). ` +
				`settings: ${settingsEncrypted} encrypted, ${settingsDeleted} env-only rows deleted.`,
		);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((err) => {
	console.error("Migration failed:", err.message);
	process.exitCode = 1;
});
