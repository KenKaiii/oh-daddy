import { describe, expect, it } from "vitest";

import {
	clampDelayMax,
	DELAY_MAX_CEILING,
	DELAY_MAX_DEFAULT,
	DELAY_MIN_SECONDS,
	pickJitterSeconds,
} from "./automation-delay";

describe("clampDelayMax", () => {
	it("keeps an in-range value", () => {
		expect(clampDelayMax(25)).toBe(25);
		expect(clampDelayMax(DELAY_MIN_SECONDS)).toBe(DELAY_MIN_SECONDS);
		expect(clampDelayMax(DELAY_MAX_CEILING)).toBe(DELAY_MAX_CEILING);
	});

	it("clamps below the fixed floor up to the floor", () => {
		expect(clampDelayMax(3)).toBe(DELAY_MIN_SECONDS);
		expect(clampDelayMax(0)).toBe(DELAY_MIN_SECONDS);
		expect(clampDelayMax(-100)).toBe(DELAY_MIN_SECONDS);
	});

	it("clamps above the ceiling down to the ceiling", () => {
		expect(clampDelayMax(999)).toBe(DELAY_MAX_CEILING);
	});

	it("rounds fractional input", () => {
		expect(clampDelayMax(24.4)).toBe(24);
		expect(clampDelayMax(24.6)).toBe(25);
	});

	it("falls back to the default on non-finite input", () => {
		expect(clampDelayMax(Number.NaN)).toBe(DELAY_MAX_DEFAULT);
		expect(clampDelayMax(Number.POSITIVE_INFINITY)).toBe(DELAY_MAX_DEFAULT);
	});
});

describe("pickJitterSeconds", () => {
	// Jitter is added on top of the throttle floor, so it ranges [0, max-floor].
	it("always returns an integer within [0, max - floor]", () => {
		for (const max of [10, 15, 25, 55]) {
			const span = max - DELAY_MIN_SECONDS;
			for (let i = 0; i < 200; i++) {
				const v = pickJitterSeconds(max);
				expect(Number.isInteger(v)).toBe(true);
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(span);
			}
		}
	});

	it("is always 0 when max equals the floor (no jitter)", () => {
		for (let i = 0; i < 20; i++) {
			expect(pickJitterSeconds(DELAY_MIN_SECONDS)).toBe(0);
		}
	});

	it("clamps an out-of-range max before picking", () => {
		const maxSpan = DELAY_MAX_CEILING - DELAY_MIN_SECONDS;
		for (let i = 0; i < 100; i++) {
			expect(pickJitterSeconds(9999)).toBeLessThanOrEqual(maxSpan);
			expect(pickJitterSeconds(1)).toBe(0);
		}
	});

	it("can reach both ends of the jitter window over many draws", () => {
		const seen = new Set<number>();
		for (let i = 0; i < 2000; i++) seen.add(pickJitterSeconds(12));
		// jitter window is {0, 1, 2}
		expect(seen.has(0)).toBe(true);
		expect(seen.has(2)).toBe(true);
	});
});
