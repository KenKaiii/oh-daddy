/**
 * Resolve a settings key from the `settings` DB table, falling back to env.
 *
 * The Settings UI saves Meta/Instagram credentials into the `settings` table as
 * encrypted `(provider, value)` rows. This function checks the DB first, then
 * falls back to the corresponding environment variable so an env-only setup also
 * works.
 *
 * Provider → env fallback mapping:
 *   meta_app_id               → META_APP_ID
 *   meta_app_secret           → META_APP_SECRET
 *   meta_config_id            → META_CONFIG_ID
 *   meta_webhook_verify_token → META_WEBHOOK_VERIFY_TOKEN
 *
 * NOTE: DB-stored values are encrypted at rest with AES-256-GCM (see
 * `@/lib/crypto`). All Meta credentials — including `meta_app_secret` and
 * `meta_webhook_verify_token` — may be set from the Settings UI. Writes to
 * `PUT /api/settings` require the operator session (the `ADMIN_PASSWORD`
 * proxy gate + `requireOperator`), so an anonymous caller can never overwrite
 * a secret and forge a signed webhook (the original BP-001 threat).
 */
import { decryptSecret, isEncrypted } from "@/lib/crypto";
import { getDb } from "@/lib/db";

export const SETTINGS_PROVIDERS = [
	"meta_app_id",
	"meta_app_secret",
	"meta_config_id",
	"meta_webhook_verify_token",
	"instagram_app_id",
	"instagram_app_secret",
] as const;

export type SettingsProvider = (typeof SETTINGS_PROVIDERS)[number];

export const ENV_FALLBACK: Record<string, string> = {
	meta_app_id: "META_APP_ID",
	meta_app_secret: "META_APP_SECRET",
	meta_config_id: "META_CONFIG_ID",
	meta_webhook_verify_token: "META_WEBHOOK_VERIFY_TOKEN",
	instagram_app_id: "INSTAGRAM_APP_ID",
	instagram_app_secret: "INSTAGRAM_APP_SECRET",
};

/**
 * Get a settings key by provider name. Checks DB first, then env fallback.
 * Returns null if not found in either.
 */
export async function getSettingsKey(provider: string): Promise<string | null> {
	try {
		const sql = getDb();
		const rows = await sql<{ value: string }[]>`
			SELECT value FROM settings WHERE provider = ${provider} LIMIT 1`;
		const stored = rows[0]?.value;
		if (stored?.trim()) {
			// Decrypt values stored at rest; tolerate legacy not-yet-migrated
			// plaintext rows (pass through unchanged).
			return isEncrypted(stored) ? decryptSecret(stored) : stored;
		}
	} catch {
		// DB lookup failed — fall through to env
	}

	const envVar = ENV_FALLBACK[provider];
	if (envVar) {
		const val = process.env[envVar];
		if (val?.trim()) return val;
	}

	return null;
}

/**
 * Get a required settings key. Throws if not found.
 */
export async function requireSettingsKey(provider: string): Promise<string> {
	const key = await getSettingsKey(provider);
	if (!key) {
		const envVar = ENV_FALLBACK[provider] ?? provider.toUpperCase();
		throw new Error(
			`${provider} is not configured. Set it in Settings or as ${envVar} in env.`,
		);
	}
	return key;
}
