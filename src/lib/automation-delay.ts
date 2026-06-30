/**
 * Smart send delays for comment automations.
 *
 * To avoid blasting hundreds of Meta API calls instantly, each matched
 * automation waits a random duration before posting its reply + DM. The wait is
 * a random integer of seconds in [DELAY_MIN_SECONDS, max], where `max` is an
 * operator setting (Settings page). "One send per interval, per account" is
 * enforced in `src/inngest/functions/process-comment.ts`: the wait runs as a
 * blocking pause inside the delivery step (which holds the per-account
 * concurrency slot, limit 1) rather than step.sleep (which would release it).
 *
 * The floor is fixed at 10s; operators only raise the ceiling (up to 55s).
 */
import { getDb } from "@/lib/db";

/** Fixed lower bound of the random delay window (seconds). */
export const DELAY_MIN_SECONDS = 10;
/** Highest ceiling an operator may configure (seconds). */
export const DELAY_MAX_CEILING = 55;
/** Default ceiling when unset (seconds) — yields a 10–25s window. */
export const DELAY_MAX_DEFAULT = 25;
/** `settings` table row that stores the configurable ceiling. */
export const DELAY_MAX_PROVIDER = "delay_max_seconds";

/** Clamp a requested ceiling into [DELAY_MIN_SECONDS, DELAY_MAX_CEILING]. */
export function clampDelayMax(value: number): number {
	if (!Number.isFinite(value)) return DELAY_MAX_DEFAULT;
	return Math.min(
		DELAY_MAX_CEILING,
		Math.max(DELAY_MIN_SECONDS, Math.round(value)),
	);
}

/**
 * Read the configured delay ceiling from the `settings` table (plain integer
 * string, not a secret). Falls back to the default on any miss or parse error.
 */
export async function getDelayMaxSeconds(): Promise<number> {
	try {
		const sql = getDb();
		const rows = await sql<{ value: string }[]>`
			SELECT value FROM settings WHERE provider = ${DELAY_MAX_PROVIDER} LIMIT 1`;
		const raw = rows[0]?.value;
		if (raw?.trim()) return clampDelayMax(Number(raw));
	} catch {
		// settings unavailable — use the default window
	}
	return DELAY_MAX_DEFAULT;
}

/**
 * Pick a random whole-second delay in [DELAY_MIN_SECONDS, max] (inclusive).
 * `max` is clamped first, so out-of-range input can't widen the window.
 */
export function pickDelaySeconds(maxSeconds: number): number {
	const max = clampDelayMax(maxSeconds);
	const span = max - DELAY_MIN_SECONDS + 1;
	return DELAY_MIN_SECONDS + Math.floor(Math.random() * span);
}
