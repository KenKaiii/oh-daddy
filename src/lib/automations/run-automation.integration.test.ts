import type { Sql } from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { setupTestDb } from "@/test/pg";

// Adapter is mocked so we never hit Meta's Graph API. Everything else —
// getDb(), the SQL, the unique indexes, the CHECK constraints — is REAL.
const adapter = vi.hoisted(() => ({
	postCommentReply: vi.fn(async () => "reply-mid-1"),
	sendPrivateReply: vi.fn(async () => "dm-mid-1"),
}));

vi.mock("@/lib/platforms", () => ({
	getAdapter: () => ({
		platform: "facebook",
		postCommentReply: adapter.postCommentReply,
		sendPrivateReply: adapter.sendPrivateReply,
	}),
}));

// Top-level await: establish DB connectivity BEFORE describe blocks register,
// so the skip decision is correct when no Postgres is reachable.
const db = await setupTestDb();
let sql: Sql = undefined as unknown as Sql;
let runKeywordAutomation: typeof import("./run-automation").runKeywordAutomation =
	undefined as never;

if (db) {
	sql = db.sql;
	// Point getDb() at the throwaway DB, then import the module under test.
	process.env.DATABASE_URL = db.url;
	({ runKeywordAutomation } = await import("./run-automation"));
}

afterAll(async () => {
	await db?.end();
});

afterEach(async () => {
	await db?.truncate();
	adapter.postCommentReply.mockClear();
	adapter.sendPrivateReply.mockClear();
});

// describe.skip when no Postgres is reachable (keeps CI green without a DB).
const suite = db ? describe : describe.skip;

if (!db) {
	console.warn(
		"[run-automation.integration] no Postgres reachable — skipping integration suite",
	);
}

interface Seed {
	accountId: string;
	automationId: string;
	contactId: string;
	conversationId: string;
	messageId: string;
	platformMessageId: string;
}

/** Insert a full account→contact→conversation→message→automation chain. */
async function seed(
	overrides: {
		keywords?: string[];
		commentReplies?: string[];
		dmMessage?: string;
		dmLink?: string | null;
		platformMessageId?: string;
		platformUserId?: string;
	} = {},
): Promise<Seed> {
	const platformMessageId = overrides.platformMessageId ?? "fb-comment-1";
	const [account] = await sql<{ id: string }[]>`
		INSERT INTO platform_accounts (platform, account_id, account_name, access_token)
		VALUES ('facebook', 'page-1', 'Test Page', 'mock-token')
		RETURNING id`;
	const [contact] = await sql<{ id: string }[]>`
		INSERT INTO contacts (platform, platform_user_id, name)
		VALUES ('facebook', ${overrides.platformUserId ?? "puid-1"}, 'Commenter')
		RETURNING id`;
	const [conversation] = await sql<{ id: string }[]>`
		INSERT INTO conversations
			(platform_account_id, contact_id, interaction_type, platform_thread_id)
		VALUES (${account.id}, ${contact.id}, 'comment', 'thread-1')
		RETURNING id`;
	const [message] = await sql<{ id: string }[]>`
		INSERT INTO messages (conversation_id, role, content, platform_message_id)
		VALUES (${conversation.id}, 'user', 'guide', ${platformMessageId})
		RETURNING id`;
	const [automation] = await sql<{ id: string }[]>`
		INSERT INTO comment_automations
			(platform_account_id, name, keywords, comment_replies, dm_message, dm_link)
		VALUES (
			${account.id}, 'Lead magnet',
			${overrides.keywords ?? ["guide"]},
			${overrides.commentReplies ?? ["Check your DMs!"]},
			${overrides.dmMessage ?? "Here is the guide"},
			${overrides.dmLink ?? null}
		)
		RETURNING id`;

	return {
		accountId: account.id,
		automationId: automation.id,
		contactId: contact.id,
		conversationId: conversation.id,
		messageId: message.id,
		platformMessageId,
	};
}

function runFor(s: Seed, messageId = s.messageId) {
	return runKeywordAutomation({
		platform: "facebook",
		platformAccountId: s.accountId,
		ownAccessToken: "mock-token",
		ownAccountId: "page-1",
		messageId,
		conversationId: s.conversationId,
		contactId: s.contactId,
		commentText: "guide",
		platformMessageId: s.platformMessageId,
	});
}

suite("runKeywordAutomation (real Postgres)", () => {
	it("writes a match row, bumps the counter, and persists both outbound messages", async () => {
		const s = await seed();
		const result = await runFor(s);

		expect(result).toMatchObject({
			matched: true,
			duplicate: false,
			commentReplySent: true,
			dmSent: true,
		});

		const matches = await sql`SELECT * FROM automation_matches`;
		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({
			comment_reply_sent: true,
			dm_sent: true,
			dm_platform_message_id: "dm-mid-1",
			match_type: "exact",
		});

		const [auto] = await sql<{ match_count: number }[]>`
			SELECT match_count FROM comment_automations WHERE id = ${s.automationId}`;
		expect(auto.match_count).toBe(1);

		// One inbound 'user' + two outbound 'assistant' (reply + DM).
		const assistant = await sql`
			SELECT content FROM messages WHERE role = 'assistant' ORDER BY content`;
		expect(assistant).toHaveLength(2);
	});

	it("short-circuits the second delivery via the real dedup unique index", async () => {
		const s = await seed();
		await runFor(s);
		adapter.postCommentReply.mockClear();
		adapter.sendPrivateReply.mockClear();

		const second = await runFor(s);

		expect(second).toMatchObject({ matched: true, duplicate: true });
		expect(adapter.postCommentReply).not.toHaveBeenCalled();
		expect(adapter.sendPrivateReply).not.toHaveBeenCalled();
		expect(await sql`SELECT id FROM automation_matches`).toHaveLength(1);
	});

	it("enforces the 24h per-contact cooldown across different messages", async () => {
		const s = await seed();
		await runFor(s);

		// A second, distinct comment from the SAME contact, same automation.
		const [msg2] = await sql<{ id: string }[]>`
			INSERT INTO messages (conversation_id, role, content, platform_message_id)
			VALUES (${s.conversationId}, 'user', 'guide', 'fb-comment-2')
			RETURNING id`;
		adapter.postCommentReply.mockClear();
		adapter.sendPrivateReply.mockClear();

		const second = await runFor(s, msg2.id);

		expect(second).toMatchObject({ matched: true, duplicate: true });
		expect(adapter.postCommentReply).not.toHaveBeenCalled();
		// Only the first comment produced a match row.
		expect(await sql`SELECT id FROM automation_matches`).toHaveLength(1);
	});

	it("survives a concurrent double-delivery — exactly one wins the claim", async () => {
		const s = await seed();

		const [a, b] = await Promise.all([runFor(s), runFor(s)]);
		const outcomes = [a, b];

		const winners = outcomes.filter((r) => r.matched && r.duplicate === false);
		const dups = outcomes.filter((r) => r.matched && r.duplicate === true);

		expect(winners).toHaveLength(1);
		expect(dups).toHaveLength(1);
		// The public reply was posted exactly once despite the race.
		expect(adapter.postCommentReply).toHaveBeenCalledTimes(1);
		expect(await sql`SELECT id FROM automation_matches`).toHaveLength(1);
	});

	it("falls back to a scope='meta' automation when no account rule exists", async () => {
		const s = await seed();
		// Remove the account-specific automation, add a platform-wide one.
		await sql`DELETE FROM comment_automations WHERE id = ${s.automationId}`;
		await sql`
			INSERT INTO comment_automations (scope, name, keywords, comment_replies)
			VALUES ('meta', 'All Meta', ${["guide"]}, ${["Hi!"]})`;

		const result = await runFor(s);
		expect(result).toMatchObject({ matched: true, duplicate: false });
	});
});

suite("schema constraints (real Postgres)", () => {
	it("rejects a comment_automation that sets BOTH account and scope (XOR check)", async () => {
		const [account] = await sql<{ id: string }[]>`
			INSERT INTO platform_accounts (platform, account_id, account_name, access_token)
			VALUES ('facebook', 'page-x', 'X', 'mock-token')
			RETURNING id`;
		await expect(
			sql`
				INSERT INTO comment_automations (platform_account_id, scope, name)
				VALUES (${account.id}, 'meta', 'bad')`,
		).rejects.toMatchObject({ code: "23514" });
	});

	it("rejects a comment_automation with NEITHER account nor scope (XOR check)", async () => {
		await expect(
			sql`INSERT INTO comment_automations (name) VALUES ('bad')`,
		).rejects.toMatchObject({ code: "23514" });
	});

	it("enforces the message dedup unique index per conversation", async () => {
		const s = await seed();
		await expect(
			sql`
				INSERT INTO messages (conversation_id, role, content, platform_message_id)
				VALUES (${s.conversationId}, 'user', 'dupe', ${s.platformMessageId})`,
		).rejects.toMatchObject({ code: "23505" });
	});
});
