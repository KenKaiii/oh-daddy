/**
 * Pick the next reply variant in a deterministic sequence.
 *
 * `matchCount` is the automation's persisted count BEFORE the current match is
 * recorded. That makes the public replies cycle predictably: A, B, C, then
 * back to A. The sequence survives process restarts because the counter lives
 * in the database instead of memory.
 */
export function pickReply(replies: string[], matchCount: number): string {
	if (replies.length === 0) return "";
	if (replies.length === 1) return replies[0];

	const index = Math.max(0, matchCount) % replies.length;
	return replies[index];
}
