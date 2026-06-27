import { findMatchingAutomation } from "@/lib/automations/keyword-matcher";
import { pickReply } from "@/lib/automations/reply-rotator";
import { getDb, isUniqueViolation } from "@/lib/db";
import { getAdapter } from "@/lib/platforms";
import type { PlatformType } from "@/lib/schemas/platform";
import type { CommentAutomationRow, Json } from "@/types/db";

// Per-contact-per-automation cooldown. If the same person triggers the same
// automation within this window, they get one reply + one DM and every
// subsequent comment is silently skipped. Defends against a single user
// spam-commenting the keyword to flood outbound + abuse the lead-magnet DM.
const COOLDOWN_HOURS = 24;

export interface RunKeywordAutomationParams {
	platform: PlatformType;
	platformAccountId: string;
	ownAccessToken: string;
	ownAccountId: string;
	/** Comment that just arrived (already inserted as a `user` message). */
	messageId: string;
	conversationId: string;
	contactId: string;
	/** Raw comment text used for keyword matching. */
	commentText: string;
	/** Platform-side comment id — required to post a public reply. */
	platformMessageId: string | null;
}

export type RunKeywordAutomationResult =
	| { matched: false }
	| {
			matched: true;
			automationId: string;
			matchedKeyword: string;
			matchType: "exact" | "fuzzy";
			commentReplySent: boolean;
			dmSent: boolean;
			duplicate: boolean;
	  };

/**
 * Run the keyword-automation pipeline for a single incoming comment.
 *
 * Returns `{ matched: true }` when a keyword automation handled the comment.
 *
 * Side effects on a match:
 *  - Posts the configured rotated public comment reply (if any) and persists
 *    it as an `assistant` message on the comment conversation.
 *  - Sends the configured DM (if any) via Meta's Private Replies API and
 *    persists it as an `assistant` message on the contact's DM conversation.
 *  - Records the match in `automation_matches` and bumps the counter.
 */
export async function runKeywordAutomation(
	params: RunKeywordAutomationParams,
): Promise<RunKeywordAutomationResult> {
	const {
		platform,
		platformAccountId,
		ownAccessToken,
		ownAccountId,
		messageId,
		conversationId,
		contactId,
		commentText,
		platformMessageId,
	} = params;

	const sql = getDb();

	// 1. Load active automations — account-specific, then scope='meta'.
	const automations = await loadAutomations(platformAccountId);

	const match =
		automations.length > 0
			? findMatchingAutomation(commentText, automations)
			: null;

	if (!match) return { matched: false };

	const duplicateResult = {
		matched: true as const,
		automationId: match.automation.id,
		matchedKeyword: match.matchedKeyword,
		matchType: match.matchType,
		commentReplySent: false,
		dmSent: false,
		duplicate: true,
	};

	// 2. Dedup — same (automation, message) pair already recorded?
	const [existingMatch] = await sql<{ id: string }[]>`
		SELECT id FROM automation_matches
		WHERE automation_id = ${match.automation.id} AND message_id = ${messageId}
		LIMIT 1`;
	if (existingMatch) return duplicateResult;

	// 2b. Per-contact cooldown — same person already triggered this automation
	// within COOLDOWN_HOURS? Silently skip. Backed by
	// idx_automation_matches_cooldown.
	const cooldownCutoff = new Date(
		Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000,
	).toISOString();
	const [recentMatch] = await sql<{ id: string }[]>`
		SELECT id FROM automation_matches
		WHERE automation_id = ${match.automation.id}
		  AND contact_id = ${contactId}
		  AND created_at > ${cooldownCutoff}
		LIMIT 1`;
	if (recentMatch) return duplicateResult;

	const adapter = getAdapter(platform);

	// 3. CLAIM the match BEFORE any external API calls.
	//
	// The unique index on (automation_id, message_id) is the real dedup gate.
	// We insert the claim here — not at the end — so any subsequent delivery
	// (webhook retry, Inngest retry) sees the row and short-circuits without
	// re-posting. If we deferred this until after postCommentReply /
	// sendPrivateReply, a thrown DM error would prevent the row from ever
	// being written and the next retry would post the public reply again.
	try {
		await sql`
			INSERT INTO automation_matches
				(automation_id, message_id, contact_id, matched_keyword,
				 match_type, fuzzy_distance, comment_reply_sent, dm_sent, dm_platform_message_id)
			VALUES (
				${match.automation.id}, ${messageId}, ${contactId}, ${match.matchedKeyword},
				${match.matchType}, ${match.fuzzyDistance}, false, false, null
			)`;
	} catch (claimError) {
		// 23505 = unique violation: a parallel delivery beat us to the claim.
		if (isUniqueViolation(claimError)) return duplicateResult;
		throw claimError;
	}

	await sql`
		UPDATE comment_automations SET match_count = match_count + 1
		WHERE id = ${match.automation.id}`;

	// 4. Post comment reply. The claim row protects against re-posting AFTER a
	// successful reply. If postCommentReply itself throws, we DELETE the claim
	// and re-throw so the next delivery can retry from scratch (no risk of
	// double-posting because the post never landed).
	let commentReplySent = false;
	if (match.automation.comment_replies?.length > 0 && platformMessageId) {
		const replyText = pickReply(
			match.automation.comment_replies,
			match.automation.match_count,
		);
		let replyPlatformId: string;
		try {
			replyPlatformId = await adapter.postCommentReply({
				accessToken: ownAccessToken,
				parentCommentId: platformMessageId,
				content: replyText,
				accountId: ownAccountId,
			});
		} catch (postError) {
			await sql`
				DELETE FROM automation_matches
				WHERE automation_id = ${match.automation.id} AND message_id = ${messageId}`;
			console.error(
				`[runKeywordAutomation] postCommentReply failed for match=${match.automation.id} msg=${messageId} — claim rolled back:`,
				postError,
			);
			throw postError;
		}
		commentReplySent = true;

		await sql`
			UPDATE automation_matches SET comment_reply_sent = true
			WHERE automation_id = ${match.automation.id} AND message_id = ${messageId}`;

		// Persist the public reply as an assistant message. The reply already
		// landed on FB/IG — if the local insert fails, log instead of throwing
		// (throwing would trigger an Inngest retry that dedup blocks but loses
		// inbox visibility).
		try {
			const metadata: Json = {
				source: "keyword_automation",
				automation_id: match.automation.id,
				matched_keyword: match.matchedKeyword,
				source_comment_message_id: messageId,
			};
			await sql`
				INSERT INTO messages (conversation_id, role, content, platform_message_id, metadata)
				VALUES (${conversationId}, 'assistant', ${replyText}, ${replyPlatformId}, ${sql.json(metadata)})`;
		} catch (persistError) {
			console.error(
				`[runKeywordAutomation] comment reply posted (mid=${replyPlatformId}) but local persist failed:`,
				persistError,
			);
		}
	}

	// 5. Send DM via Private Replies (recipient.comment_id) — a public comment
	// does NOT open the 24h messaging window, so the regular Send API can't be
	// used. One private reply per comment, within 7 days.
	let dmSent = false;
	let dmPlatformMessageId: string | null = null;

	const dmContent = match.automation.dm_message?.trim();
	if (dmContent && platformMessageId) {
		const [contactRow] = await sql<{ platform_user_id: string }[]>`
			SELECT platform_user_id FROM contacts WHERE id = ${contactId}`;

		const fullDm = match.automation.dm_link
			? `${dmContent}\n\n${match.automation.dm_link}`
			: dmContent;

		dmPlatformMessageId = await adapter.sendPrivateReply({
			accessToken: ownAccessToken,
			commentId: platformMessageId,
			content: fullDm,
			accountId: ownAccountId,
		});
		dmSent = true;

		// Persist the DM as an assistant message on the DM conversation. The DM
		// already landed — log instead of throwing on a local persist failure.
		try {
			const dmThreadId = contactRow?.platform_user_id ?? contactId;
			const [dmConversation] = await sql<{ id: string }[]>`
				INSERT INTO conversations
					(contact_id, platform_account_id, interaction_type, platform_thread_id, last_message_at)
				VALUES (${contactId}, ${platformAccountId}, 'dm', ${dmThreadId}, now())
				ON CONFLICT (platform_account_id, interaction_type, platform_thread_id) DO UPDATE
				SET last_message_at = EXCLUDED.last_message_at
				RETURNING id`;

			if (dmConversation) {
				const metadata: Json = {
					source: "keyword_automation",
					automation_id: match.automation.id,
					matched_keyword: match.matchedKeyword,
					source_comment_message_id: messageId,
				};
				await sql`
					INSERT INTO messages (conversation_id, role, content, platform_message_id, metadata)
					VALUES (${dmConversation.id}, 'assistant', ${fullDm}, ${dmPlatformMessageId}, ${sql.json(metadata)})`;
			}
		} catch (persistErr) {
			console.error(
				`[runKeywordAutomation] DM sent (mid=${dmPlatformMessageId}) but local persist failed:`,
				persistErr,
			);
		}
	}

	// 6. Backfill DM state on the match row. The DM already landed; log instead
	// of throwing so we don't trigger a dedup-blocked retry.
	if (dmSent) {
		try {
			await sql`
				UPDATE automation_matches
				SET dm_sent = true, dm_platform_message_id = ${dmPlatformMessageId}
				WHERE automation_id = ${match.automation.id} AND message_id = ${messageId}`;
		} catch (backfillErr) {
			console.error(
				`[runKeywordAutomation] DM sent (mid=${dmPlatformMessageId}) but match-row backfill failed:`,
				backfillErr,
			);
		}
	}

	return {
		matched: true,
		automationId: match.automation.id,
		matchedKeyword: match.matchedKeyword,
		matchType: match.matchType,
		commentReplySent,
		dmSent,
		duplicate: false,
	};
}

/**
 * Load active automations for an incoming comment: account-specific first,
 * then the platform-wide `meta` scope (e.g. "All Meta accounts").
 */
async function loadAutomations(
	platformAccountId: string,
): Promise<CommentAutomationRow[]> {
	const sql = getDb();
	const accountSpecific = await sql<CommentAutomationRow[]>`
		SELECT * FROM comment_automations
		WHERE platform_account_id = ${platformAccountId} AND is_active = true`;
	if (accountSpecific.length > 0) return accountSpecific;

	const scopeWide = await sql<CommentAutomationRow[]>`
		SELECT * FROM comment_automations
		WHERE scope = 'meta' AND is_active = true`;
	return scopeWide;
}
