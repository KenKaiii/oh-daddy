/**
 * Smart send delays for comment automations.
 *
 * Goal: never blast Meta with a burst of API calls, and make automated sends
 * land on human-looking timing rather than a fixed cadence. Ingestion stays
 * real-time in `process-comment`; only the SEND side carries delay. Two
 * mechanisms combine in `src/inngest/functions/automation-send.ts` (the
 * fan-out delivery worker process-comment emits to on a match):
 *
 *  1. A GLOBAL `throttle` (no key — one shared bucket across every account)
 *     hard-caps run starts at GLOBAL_HOURLY_SEND_LIMIT per hour, combined
 *     across all connected accounts. This is the real Meta rate-limit
 *     protection: it doesn't matter how many accounts are connected, total
 *     outbound sends can never exceed the cap. Throttle ENQUEUES the backlog
 *     (it never drops sends), it just delays runs once the hourly bucket
 *     fills.
 *  2. A `step.sleep` jitter of [0, max - DELAY_MIN_SECONDS] seconds before the
 *     send, where `max` is the operator's configured ceiling read at runtime.
 *     This scatters the actual send moment so the timing looks human instead
 *     of landing exactly on the throttle grid.
 *
 * The jitter floor (DELAY_MIN_SECONDS) and ceiling are purely cosmetic
 * per-send timing, layered on top of whatever the global throttle already
 * enforces; they don't themselves cap throughput.
 */
import { getDb } from "@/lib/db";

/** Fixed lower bound of the delay window (seconds). */
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
 * Pick the random jitter (whole seconds) to `step.sleep` before a send, in
 * [0, max - DELAY_MIN_SECONDS] inclusive. Layered on top of the throttle floor
 * (DELAY_THROTTLE_PERIOD_SECONDS), this lands the actual send in roughly
 * [DELAY_MIN_SECONDS, max]. `max` is clamped first, so out-of-range input can't
 * widen the window; when max == the floor the jitter is always 0.
 */
export function pickJitterSeconds(maxSeconds: number): number {
	const max = clampDelayMax(maxSeconds);
	const span = max - DELAY_MIN_SECONDS + 1; // inclusive of 0..(max-min)
	return Math.floor(Math.random() * span);
}
