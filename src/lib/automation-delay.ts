/**
 * Smart send delays for comment automations.
 *
 * Goal: never blast Meta with a burst of API calls, and make automated sends
 * land on human-looking timing rather than a fixed cadence. Ingestion stays
 * real-time in `process-comment`; only the SEND side carries delay. Two native
 * Inngest primitives combine in `src/inngest/functions/automation-send.ts` (the
 * fan-out delivery worker process-comment emits to on a match):
 *
 *  1. A per-account `throttle` (keyed on the platform account) caps how often a
 *     run may START per account. Its period is fixed at DELAY_MIN_SECONDS, so
 *     each account sends at most ~once per that window — a hard rate cap that
 *     protects Meta. Throttle ENQUEUES the backlog (it never drops sends) and
 *     evenly spaces run starts across the period.
 *  2. A `step.sleep` jitter of [0, max - DELAY_MIN_SECONDS] seconds before the
 *     send, where `max` is the operator's configured ceiling read at runtime.
 *     This scatters the actual send moment within the operator's window so the
 *     timing looks human instead of landing exactly on the throttle grid.
 *
 * Effective per-account send timing therefore falls in roughly
 * [DELAY_MIN_SECONDS, max]: the throttle floor plus the random jitter. The
 * throttle period must be a compile-time constant (Inngest evaluates function
 * config once at definition), so only the jitter can track the live operator
 * setting; together they honor the configured [10, max] window.
 *
 * The floor is fixed at 10s; operators only raise the ceiling (up to 55s).
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
/**
 * Per-account throttle period (seconds). Fixed at the delay floor because
 * Inngest evaluates `throttle` config once at function-definition time and so
 * it can't read the per-operator ceiling. One run start per account per this
 * window is the hard Meta rate cap; jitter (below) adds the human variation.
 */
export const DELAY_THROTTLE_PERIOD_SECONDS = DELAY_MIN_SECONDS;

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
