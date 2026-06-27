import type { CommentAutomationRow } from "@/types/db";

export interface KeywordMatch {
	automation: CommentAutomationRow;
	matchedKeyword: string;
	matchType: "exact" | "fuzzy";
	fuzzyDistance: number;
}

// Comments must be at most this many tokens for a keyword to trigger.
// Keyword automations are CTA-style: the user comments JUST the keyword
// ("GUIDE", "dog") or a tiny variant ("send guide"). Three+ tokens is a
// sentence — organic engagement, not a deliberate CTA reply.
const MAX_TOKENS_FOR_CTA = 2;

/** Compute Levenshtein distance between two strings. */
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	// Ensure `a` is the shorter string for O(min(m,n)) space.
	if (a.length > b.length) {
		const tmp = a;
		a = b;
		b = tmp;
	}

	const la = a.length;
	const lb = b.length;
	const row = Array.from({ length: la + 1 }, (_, i) => i);

	for (let i = 1; i <= lb; i++) {
		let prev = i;
		for (let j = 1; j <= la; j++) {
			const cost = b[i - 1] === a[j - 1] ? 0 : 1;
			const val = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
			row[j - 1] = prev;
			prev = val;
		}
		row[la] = prev;
	}

	return row[la];
}

/** Tokenize comment text into lowercase words, stripping punctuation. */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter(Boolean);
}

/**
 * Find the best matching automation for a comment. Checks exact match first
 * (any word equals a keyword), then fuzzy (Levenshtein ≤ threshold). Returns
 * the match with the smallest distance, or null if nothing matches.
 */
export function findMatchingAutomation(
	commentText: string,
	automations: CommentAutomationRow[],
): KeywordMatch | null {
	const words = tokenize(commentText);
	// CTA-style gate: only short comments can trigger a keyword automation.
	if (words.length === 0 || words.length > MAX_TOKENS_FOR_CTA) return null;

	let bestMatch: KeywordMatch | null = null;

	for (const automation of automations) {
		if (!automation.is_active) continue;

		const keywords = automation.keywords ?? [];
		if (keywords.length === 0) continue;

		for (const keyword of keywords) {
			const kw = keyword.toLowerCase();

			// Exact match — distance 0, can't do better.
			if (words.includes(kw)) {
				return {
					automation,
					matchedKeyword: keyword,
					matchType: "exact",
					fuzzyDistance: 0,
				};
			}

			// Fuzzy match — check each word against the keyword.
			const threshold = automation.fuzzy_threshold ?? 2;
			for (const word of words) {
				if (Math.abs(word.length - kw.length) > threshold) continue;

				const dist = levenshtein(word, kw);
				if (dist <= threshold) {
					if (!bestMatch || dist < bestMatch.fuzzyDistance) {
						bestMatch = {
							automation,
							matchedKeyword: keyword,
							matchType: "fuzzy",
							fuzzyDistance: dist,
						};
					}
					if (dist === 1) break;
				}
			}
		}
	}

	return bestMatch;
}
