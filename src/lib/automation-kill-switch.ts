/**
 * Global emergency stop for keyword automations.
 *
 * A single operator-facing switch that overrides every individual
 * automation's `is_active` flag at once — flip it off and NO public reply or
 * DM goes out for ANY automation, on ANY connected account, no exceptions.
 * Individual automations keep their own `is_active` state untouched; this is
 * a higher-priority kill switch layered on top, not a replacement for it.
 *
 * Enforced in `runKeywordAutomation` (checked live, at send time — not just
 * when the comment first arrives) so that comments already queued/delayed
 * before the switch was flipped off still get stopped before anything is
 * posted to Meta.
 */
import { getDb } from "@/lib/db";

/** `settings` table row that stores the kill switch state ("true"/"false"). */
export const AUTOMATIONS_ENABLED_PROVIDER = "automations_enabled";

/** Default when unset: automations run normally. */
export const AUTOMATIONS_ENABLED_DEFAULT = true;

/**
 * Read the current kill switch state from the `settings` table (plain
 * boolean string, not a secret). Falls back to enabled on any miss or parse
 * error, so a settings-read failure never silently disables live automations.
 */
export async function getAutomationsEnabled(): Promise<boolean> {
	try {
		const sql = getDb();
		const rows = await sql<{ value: string }[]>`
			SELECT value FROM settings WHERE provider = ${AUTOMATIONS_ENABLED_PROVIDER} LIMIT 1`;
		const raw = rows[0]?.value;
		if (raw?.trim()) return raw === "true";
	} catch {
		// settings unavailable — default to enabled
	}
	return AUTOMATIONS_ENABLED_DEFAULT;
}
