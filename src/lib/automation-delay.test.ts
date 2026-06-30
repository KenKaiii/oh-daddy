import { describe, expect, it } from "vitest";

import {
	clampDelayMax,
	DELAY_MAX_CEILING,
	DELAY_MAX_DEFAULT,
	DELAY_MIN_SECONDS,
	pickDelaySeconds,
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

describe("pickDelaySeconds", () => {
	it("always returns an integer within [floor, max]", () => {
		for (const max of [10, 15, 25, 55]) {
			for (let i = 0; i < 200; i++) {
				const v = pickDelaySeconds(max);
				expect(Number.isInteger(v)).toBe(true);
				expect(v).toBeGreaterThanOrEqual(DELAY_MIN_SECONDS);
				expect(v).toBeLessThanOrEqual(max);
			}
		}
	});

	it("returns exactly the floor when max equals the floor", () => {
		for (let i = 0; i < 20; i++) {
			expect(pickDelaySeconds(DELAY_MIN_SECONDS)).toBe(DELAY_MIN_SECONDS);
		}
	});

	it("clamps an out-of-range max before picking", () => {
		for (let i = 0; i < 100; i++) {
			expect(pickDelaySeconds(9999)).toBeLessThanOrEqual(DELAY_MAX_CEILING);
			expect(pickDelaySeconds(1)).toBe(DELAY_MIN_SECONDS);
		}
	});

	it("can reach both ends of the window over many draws", () => {
		const seen = new Set<number>();
		for (let i = 0; i < 2000; i++) seen.add(pickDelaySeconds(12));
		// window is {10, 11, 12}
		expect(seen.has(10)).toBe(true);
		expect(seen.has(12)).toBe(true);
	});
});
