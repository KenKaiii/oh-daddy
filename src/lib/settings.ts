/**
 * Resolve a settings key from the `settings` DB table, falling back to env.
 *
 * The Settings UI saves Meta credentials into the `settings` table as plain
 * `(provider, value)` rows. This function checks the DB first, then falls
 * back to the corresponding environment variable so an env-only setup also
 * works.
 *
 * Provider → env fallback mapping:
 *   meta_app_id               → META_APP_ID
 *   meta_app_secret           → META_APP_SECRET
 *   meta_config_id            → META_CONFIG_ID
 *   meta_webhook_verify_token → META_WEBHOOK_VERIFY_TOKEN
 *
 * NOTE: values are stored in plaintext (MVP simplification). Encrypt before
 * any production/multi-tenant deployment.
 */
import { getDb } from "@/lib/db";

export const SETTINGS_PROVIDERS = [
	"meta_app_id",
	"meta_app_secret",
	"meta_config_id",
	"meta_webhook_verify_token",
] as const;

export type SettingsProvider = (typeof SETTINGS_PROVIDERS)[number];

const ENV_FALLBACK: Record<string, string> = {
	meta_app_id: "META_APP_ID",
	meta_app_secret: "META_APP_SECRET",
	meta_config_id: "META_CONFIG_ID",
	meta_webhook_verify_token: "META_WEBHOOK_VERIFY_TOKEN",
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
		if (rows[0]?.value?.trim()) return rows[0].value;
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
