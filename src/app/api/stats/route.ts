import { getDb } from "@/lib/db";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
	try {
		const sql = getDb();
		const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

		const [
			[{ count: connectedAccounts }],
			[{ count: activeAutomations }],
			[{ count: commentsAllTime }],
			[{ count: comments7d }],
			[{ count: repliesAllTime }],
			[{ count: replies7d }],
			[{ count: dmsAllTime }],
			[{ count: dms7d }],
		] = await Promise.all([
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM platform_accounts
				WHERE disconnected_at IS NULL
				  AND access_token <> '' AND access_token <> 'pending'`,
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM comment_automations WHERE is_active = true`,
			// Real comments we ingested — i.e. inbound ('user') messages on comment
			// conversations. process-comment only stores comments on posts an active
			// automation tracks, so this is "tracked comments", not raw webhook
			// traffic (which also includes DMs, reads and reactions).
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM messages m
				JOIN conversations c ON c.id = m.conversation_id
				WHERE m.role = 'user' AND c.interaction_type = 'comment'`,
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM messages m
				JOIN conversations c ON c.id = m.conversation_id
				WHERE m.role = 'user' AND c.interaction_type = 'comment'
				  AND m.created_at > ${since}`,
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM automation_matches WHERE comment_reply_sent = true`,
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM automation_matches
				WHERE comment_reply_sent = true AND created_at > ${since}`,
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM automation_matches WHERE dm_sent = true`,
			sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM automation_matches
				WHERE dm_sent = true AND created_at > ${since}`,
		]);

		return Response.json({
			data: {
				connectedAccounts,
				activeAutomations,
				comments: { allTime: commentsAllTime, last7d: comments7d },
				repliesSent: { allTime: repliesAllTime, last7d: replies7d },
				dmsSent: { allTime: dmsAllTime, last7d: dms7d },
			},
		});
	} catch (err) {
		console.error("[stats] query failed:", err);
		return Response.json(
			{
				error:
					"Failed to load stats. Is DATABASE_URL set and the schema applied?",
			},
			{ status: 500 },
		);
	}
}
