import { z } from "zod";

import { inngest } from "@/inngest/client";
import {
	DELAY_THROTTLE_PERIOD_SECONDS,
	getDelayMaxSeconds,
	pickJitterSeconds,
} from "@/lib/automation-delay";
import { runKeywordAutomation } from "@/lib/automations/run-automation";
import { decryptToken } from "@/lib/crypto";
import { getDb } from "@/lib/db";

/**
 * Payload emitted by `process-comment` (via `step.sendEvent`) once a comment is
 * ingested AND matches an active automation. The access token is intentionally
 * NOT carried here — it's re-fetched and decrypted at point of use so no
 * plaintext (or even encrypted) token ever lives in event state.
 */
const sendPayloadSchema = z.object({
	platform: z.enum(["facebook", "instagram"]),
	platformAccountId: z.string().uuid(),
	messageId: z.string().uuid(),
	conversationId: z.string().uuid(),
	contactId: z.string().uuid(),
	commentText: z.string(),
	platformMessageId: z.string().nullable(),
	platformPostId: z.string().nullable(),
});

/**
 * Delivery worker: posts the public reply + DM for a matched comment.
 *
 * Split out from `process-comment` so ingestion stays real-time — only the
 * SEND side carries the rate controls:
 *
 *  - `throttle` (per account): caps run STARTS to one per period, evenly
 *    spaced, enqueueing the backlog rather than dropping it. This is the hard
 *    Meta API rate cap. Different accounts are independent buckets and run in
 *    parallel.
 *  - `step.sleep` jitter: a random extra wait in [0, max-floor] read from the
 *    operator's live setting, so the actual send lands at a human-looking
 *    moment inside [floor, max] instead of exactly on the throttle grid.
 *  - global `concurrency`: bounds total in-flight sends across all accounts.
 *
 * Retry safety: `runKeywordAutomation` claims the `automation_matches` row
 * BEFORE any Meta call and enforces the 24h per-contact cooldown, so a step
 * retry (or a duplicate send event) never double-posts.
 */
export const automationSend = inngest.createFunction(
	{
		id: "automation-send",
		throttle: {
			key: "event.data.platformAccountId",
			limit: 1,
			period: `${DELAY_THROTTLE_PERIOD_SECONDS}s`,
		},
		concurrency: { limit: 5 },
		retries: 3,
		triggers: [{ event: "automation/send" }],
	},
	async ({ event, step }) => {
		const parsed = sendPayloadSchema.parse(event.data);

		// Random jitter on top of the throttle floor (see module docs). Picked in
		// a memoized step so the value replays identically across retries and the
		// conditional sleep stays deterministic.
		const jitterSeconds = await step.run("pick-jitter", async () =>
			pickJitterSeconds(await getDelayMaxSeconds()),
		);
		if (jitterSeconds > 0) {
			await step.sleep("send-jitter", `${jitterSeconds}s`);
		}

		// Deliver. Re-fetch the account here (token never travels in the event).
		const result = await step.run("deliver", async () => {
			const sql = getDb();
			const [ownAccount] = await sql<
				{ account_id: string; access_token: string }[]
			>`
				SELECT account_id, access_token
				FROM platform_accounts
				WHERE id = ${parsed.platformAccountId} AND disconnected_at IS NULL`;
			if (!ownAccount) {
				return { matched: false as const, reason: "account-missing" };
			}

			const r = await runKeywordAutomation({
				platform: parsed.platform,
				platformAccountId: parsed.platformAccountId,
				ownAccessToken: decryptToken(ownAccount.access_token),
				ownAccountId: ownAccount.account_id,
				messageId: parsed.messageId,
				conversationId: parsed.conversationId,
				contactId: parsed.contactId,
				commentText: parsed.commentText,
				platformMessageId: parsed.platformMessageId,
				platformPostId: parsed.platformPostId,
			});
			return r;
		});

		return {
			status: result.matched ? ("sent" as const) : ("no-op" as const),
			messageId: parsed.messageId,
		};
	},
);
