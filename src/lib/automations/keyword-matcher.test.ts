import { describe, expect, it } from "vitest";
import type { CommentAutomationRow } from "@/types/db";
import {
	findMatchingAutomation,
	levenshtein,
	tokenize,
} from "./keyword-matcher";

/** Build a CommentAutomationRow with sane defaults; override per test. */
function automation(
	overrides: Partial<CommentAutomationRow> = {},
): CommentAutomationRow {
	return {
		id: "a1",
		platform_account_id: "acc1",
		scope: null,
		name: "Test",
		is_active: true,
		keywords: ["guide"],
		fuzzy_threshold: 2,
		comment_replies: [],
		dm_message: "",
		platform_post_id: null,
		match_count: 0,
		metadata: {},
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("levenshtein", () => {
	it("is 0 for identical strings", () => {
		expect(levenshtein("guide", "guide")).toBe(0);
	});

	it("returns the longer length when one side is empty", () => {
		expect(levenshtein("", "abc")).toBe(3);
		expect(levenshtein("abc", "")).toBe(3);
	});

	it("counts single-character substitutions", () => {
		expect(levenshtein("dog", "dig")).toBe(1);
		expect(levenshtein("dog", "cat")).toBe(3);
	});

	it("matches known textbook distances", () => {
		expect(levenshtein("kitten", "sitting")).toBe(3);
		expect(levenshtein("flaw", "lawn")).toBe(2);
	});

	it("treats an adjacent transposition as distance 2 (plain Levenshtein)", () => {
		// "guide" -> "guied" is a swap; plain Levenshtein = 2 (not Damerau's 1).
		expect(levenshtein("guide", "guied")).toBe(2);
	});

	it("is symmetric", () => {
		expect(levenshtein("send", "sned")).toBe(levenshtein("sned", "send"));
	});
});

describe("tokenize", () => {
	it("lowercases, strips punctuation, and splits on whitespace", () => {
		expect(tokenize("GUIDE, please!")).toEqual(["guide", "please"]);
	});

	it("drops empty tokens from collapsed whitespace", () => {
		expect(tokenize("  hello   world  ")).toEqual(["hello", "world"]);
	});

	it("keeps digits and alphanumerics", () => {
		expect(tokenize("plan2 go")).toEqual(["plan2", "go"]);
	});

	it("returns an empty array for punctuation-only input", () => {
		expect(tokenize("!!! ???")).toEqual([]);
	});
});

describe("findMatchingAutomation", () => {
	it("returns null when nothing matches", () => {
		expect(findMatchingAutomation("hello there", [automation()])).toBeNull();
	});

	it("matches an exact keyword (single-word comment)", () => {
		const result = findMatchingAutomation("guide", [automation()]);
		expect(result).not.toBeNull();
		expect(result?.matchType).toBe("exact");
		expect(result?.matchedKeyword).toBe("guide");
		expect(result?.fuzzyDistance).toBe(0);
	});

	it("matches case-insensitively", () => {
		const result = findMatchingAutomation("GUIDE", [automation()]);
		expect(result?.matchType).toBe("exact");
	});

	it("matches an exact keyword inside a 2-token CTA", () => {
		const result = findMatchingAutomation("send guide", [automation()]);
		expect(result?.matchType).toBe("exact");
	});

	it("rejects comments longer than the CTA token gate (>2 tokens)", () => {
		// Even though "guide" is present, 3 tokens reads as a sentence.
		expect(
			findMatchingAutomation("please send me guide", [automation()]),
		).toBeNull();
	});

	it("returns null for empty / punctuation-only comments", () => {
		expect(findMatchingAutomation("", [automation()])).toBeNull();
		expect(findMatchingAutomation("!!!", [automation()])).toBeNull();
	});

	it("fuzzy-matches within the threshold", () => {
		const result = findMatchingAutomation("guied", [
			automation({ fuzzy_threshold: 2 }),
		]);
		expect(result?.matchType).toBe("fuzzy");
		expect(result?.fuzzyDistance).toBe(2);
	});

	it("does not fuzzy-match beyond the threshold", () => {
		const result = findMatchingAutomation("guion", [
			automation({ keywords: ["guide"], fuzzy_threshold: 1 }),
		]);
		expect(result).toBeNull();
	});

	it("honors a per-automation threshold of 0 (exact only)", () => {
		expect(
			findMatchingAutomation("guied", [automation({ fuzzy_threshold: 0 })]),
		).toBeNull();
		expect(
			findMatchingAutomation("guide", [automation({ fuzzy_threshold: 0 })]),
		).not.toBeNull();
	});

	it("skips inactive automations", () => {
		expect(
			findMatchingAutomation("guide", [automation({ is_active: false })]),
		).toBeNull();
	});

	it("skips automations with no keywords", () => {
		expect(
			findMatchingAutomation("guide", [automation({ keywords: [] })]),
		).toBeNull();
	});

	it("prefers an exact match over a fuzzy one", () => {
		const fuzzy = automation({ id: "fuzzy", keywords: ["guied"] });
		const exact = automation({ id: "exact", keywords: ["dog"] });
		const result = findMatchingAutomation("dog", [fuzzy, exact]);
		expect(result?.automation.id).toBe("exact");
		expect(result?.matchType).toBe("exact");
	});

	it("picks the smallest fuzzy distance across automations", () => {
		const far = automation({
			id: "far",
			keywords: ["doggo"],
			fuzzy_threshold: 3,
		});
		const near = automation({
			id: "near",
			keywords: ["dig"],
			fuzzy_threshold: 3,
		});
		// "dog": dig=1, doggo=2 -> near wins.
		const result = findMatchingAutomation("dog", [far, near]);
		expect(result?.automation.id).toBe("near");
		expect(result?.fuzzyDistance).toBe(1);
	});
});
