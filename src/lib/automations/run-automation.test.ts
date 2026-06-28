import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentAutomationRow } from "@/types/db";

// ── Mocks ────────────────────────────────────────────────────────────────
// run-automation.ts pulls the DB pool from "@/lib/db" and the platform client
// from "@/lib/platforms". We replace both with in-memory fakes so the keyword
// pipeline can be exercised without Postgres or the Meta Graph API.

const harness = vi.hoisted(() => {
	type Row = Record<string, unknown>;
	interface Config {
		accountAutomations: CommentAutomationRow[];
		scopeAutomations: CommentAutomationRow[];
		dedupHit: boolean;
		cooldownHit: boolean;
		claimError: (Error & { code?: string }) | null;
		contactRow: Row | undefined;
		postReplyError: Error | null;
		sendDmError: Error | null;
	}

	const config: Config = {
		accountAutomations: [],
		scopeAutomations: [],
		dedupHit: false,
		cooldownHit: false,
		claimError: null,
		contactRow: { platform_user_id: "puid-1" },
		postReplyError: null,
		sendDmError: null,
	};

	// Ordered log of side effects (sql tags + adapter calls) for ordering asserts.
	const events: string[] = [];

	function reset(overrides: Partial<Config> = {}) {
		Object.assign(config, {
			accountAutomations: [],
			scopeAutomations: [],
			dedupHit: false,
			cooldownHit: false,
			claimError: null,
			contactRow: { platform_user_id: "puid-1" },
			postReplyError: null,
			sendDmError: null,
		});
		Object.assign(config, overrides);
		events.length = 0;
	}

	// Fake tagged-template `sql`. Routes by the (normalized) query text.
	const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
		const text = strings.join(" ").replace(/\s+/g, " ").trim().toLowerCase();

		const rows = (() => {
			if (text.includes("from comment_automations")) {
				if (text.includes("platform_account_id =")) {
					events.push("load:account");
					return config.accountAutomations;
				}
				events.push("load:scope");
				return config.scopeAutomations;
			}
			if (text.startsWith("select id from automation_matches")) {
				if (text.includes("created_at >")) {
					events.push("select:cooldown");
					return config.cooldownHit ? [{ id: "cd" }] : [];
				}
				events.push("select:dedup");
				return config.dedupHit ? [{ id: "dup" }] : [];
			}
			if (text.includes("insert into automation_matches")) {
				events.push("claim:insert");
				if (config.claimError) throw config.claimError;
				return [];
			}
			if (text.includes("update comment_automations set match_count")) {
				events.push("bump:count");
				return [];
			}
			if (text.includes("delete from automation_matches")) {
				events.push("claim:rollback");
				return [];
			}
			if (text.includes("update automation_matches set comment_reply_sent")) {
				events.push("mark:reply");
				return [];
			}
			if (text.includes("select platform_user_id from contacts")) {
				events.push("select:contact");
				return config.contactRow ? [config.contactRow] : [];
			}
			if (text.includes("insert into conversations")) {
				events.push("dm:conversation");
				return [{ id: "dm-conv-1" }];
			}
			if (text.includes("insert into messages")) {
				events.push("insert:message");
				return [{ id: "msg-out" }];
			}
			if (text.includes("update automation_matches set dm_sent")) {
				events.push("backfill:dm");
				return [];
			}
			events.push(`UNROUTED: ${text.slice(0, 40)}`);
			return [];
		})();

		return Promise.resolve(rows);
	}) as unknown as {
		(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
		json: (v: unknown) => unknown;
	};
	sql.json = (v: unknown) => v;

	const postCommentReply = vi.fn(async () => {
		events.push("api:postCommentReply");
		if (config.postReplyError) throw config.postReplyError;
		return "reply-mid-1";
	});
	const sendPrivateReply = vi.fn(async () => {
		events.push("api:sendPrivateReply");
		if (config.sendDmError) throw config.sendDmError;
		return "dm-mid-1";
	});

	return { config, events, reset, sql, postCommentReply, sendPrivateReply };
});

vi.mock("@/lib/db", () => ({
	getDb: () => harness.sql,
	isUniqueViolation: (err: unknown) =>
		typeof err === "object" &&
		err !== null &&
		(err as { code?: string }).code === "23505",
}));

vi.mock("@/lib/platforms", () => ({
	getAdapter: () => ({
		platform: "facebook",
		postCommentReply: harness.postCommentReply,
		sendPrivateReply: harness.sendPrivateReply,
	}),
}));

import { runKeywordAutomation } from "./run-automation";

// ── Fixtures ───────────────────────────────────────────────────────────────

function automation(
	overrides: Partial<CommentAutomationRow> = {},
): CommentAutomationRow {
	return {
		id: "auto-1",
		platform_account_id: "acc-1",
		scope: null,
		name: "Lead magnet",
		is_active: true,
		keywords: ["guide"],
		fuzzy_threshold: 2,
		comment_replies: ["Check your DMs!"],
		dm_message: "Here is the guide",
		dm_link: null,
		match_count: 0,
		metadata: {},
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function run(
	overrides: Partial<Parameters<typeof runKeywordAutomation>[0]> = {},
) {
	return runKeywordAutomation({
		platform: "facebook",
		platformAccountId: "acc-1",
		ownAccessToken: "token-xyz",
		ownAccountId: "page-1",
		messageId: "msg-in-1",
		conversationId: "conv-1",
		contactId: "contact-1",
		commentText: "guide",
		platformMessageId: "fb-comment-1",
		...overrides,
	});
}

const { config, events, reset, postCommentReply, sendPrivateReply } = harness;

beforeEach(() => {
	reset();
	postCommentReply.mockClear();
	sendPrivateReply.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("runKeywordAutomation — no match", () => {
	it("returns matched:false and touches no external API when nothing matches", async () => {
		config.accountAutomations = [automation({ keywords: ["unrelated"] })];
		const result = await run({ commentText: "hello world" });

		expect(result).toEqual({ matched: false });
		expect(postCommentReply).not.toHaveBeenCalled();
		expect(sendPrivateReply).not.toHaveBeenCalled();
		expect(events).not.toContain("claim:insert");
	});

	it("falls back to scope='meta' automations when no account-specific ones exist", async () => {
		config.accountAutomations = [];
		config.scopeAutomations = [automation({ id: "scoped" })];
		const result = await run();

		expect(result.matched).toBe(true);
		expect(events).toContain("load:scope");
	});
});

describe("runKeywordAutomation — happy path (reply + DM)", () => {
	it("claims the match BEFORE any Meta API call", async () => {
		config.accountAutomations = [automation()];
		await run();

		const claimIdx = events.indexOf("claim:insert");
		const postIdx = events.indexOf("api:postCommentReply");
		const dmIdx = events.indexOf("api:sendPrivateReply");

		expect(claimIdx).toBeGreaterThanOrEqual(0);
		expect(claimIdx).toBeLessThan(postIdx);
		expect(claimIdx).toBeLessThan(dmIdx);
	});

	it("posts the public reply and the DM, returning sent flags", async () => {
		config.accountAutomations = [automation()];
		const result = await run();

		expect(result).toMatchObject({
			matched: true,
			automationId: "auto-1",
			matchedKeyword: "guide",
			matchType: "exact",
			commentReplySent: true,
			dmSent: true,
			duplicate: false,
		});
		expect(postCommentReply).toHaveBeenCalledTimes(1);
		expect(sendPrivateReply).toHaveBeenCalledTimes(1);
	});

	it("appends dm_link to the DM body when configured", async () => {
		config.accountAutomations = [
			automation({ dm_message: "Here you go", dm_link: "https://acme.com/g" }),
		];
		await run();

		expect(sendPrivateReply).toHaveBeenCalledWith(
			expect.objectContaining({ content: "Here you go\n\nhttps://acme.com/g" }),
		);
	});
});

describe("runKeywordAutomation — dedup & cooldown", () => {
	it("short-circuits as duplicate when the (automation,message) pair exists", async () => {
		config.accountAutomations = [automation()];
		config.dedupHit = true;
		const result = await run();

		expect(result).toMatchObject({ matched: true, duplicate: true });
		expect(events).not.toContain("claim:insert");
		expect(postCommentReply).not.toHaveBeenCalled();
		expect(sendPrivateReply).not.toHaveBeenCalled();
	});

	it("short-circuits as duplicate when the contact is within the 24h cooldown", async () => {
		config.accountAutomations = [automation()];
		config.cooldownHit = true;
		const result = await run();

		expect(result).toMatchObject({ matched: true, duplicate: true });
		expect(events).not.toContain("claim:insert");
		expect(postCommentReply).not.toHaveBeenCalled();
	});

	it("treats a unique-violation on claim as a lost race (duplicate, no posting)", async () => {
		config.accountAutomations = [automation()];
		config.claimError = Object.assign(new Error("dupe"), { code: "23505" });
		const result = await run();

		expect(result).toMatchObject({ matched: true, duplicate: true });
		expect(postCommentReply).not.toHaveBeenCalled();
		expect(sendPrivateReply).not.toHaveBeenCalled();
	});

	it("rethrows a non-unique error from the claim insert", async () => {
		config.accountAutomations = [automation()];
		config.claimError = Object.assign(new Error("db down"), { code: "08006" });
		await expect(run()).rejects.toThrow("db down");
		expect(postCommentReply).not.toHaveBeenCalled();
	});
});

describe("runKeywordAutomation — failure rollback", () => {
	it("rolls back the claim and rethrows when postCommentReply fails", async () => {
		config.accountAutomations = [automation()];
		config.postReplyError = new Error("graph 500");

		await expect(run()).rejects.toThrow("graph 500");
		expect(events).toContain("claim:rollback");
		// DM must not be attempted once the public reply failed.
		expect(sendPrivateReply).not.toHaveBeenCalled();
	});
});

describe("runKeywordAutomation — partial configs", () => {
	it("sends only the DM when there are no comment replies", async () => {
		config.accountAutomations = [automation({ comment_replies: [] })];
		const result = await run();

		expect(postCommentReply).not.toHaveBeenCalled();
		expect(sendPrivateReply).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ commentReplySent: false, dmSent: true });
	});

	it("posts only the reply when there is no DM message", async () => {
		config.accountAutomations = [automation({ dm_message: "  " })];
		const result = await run();

		expect(postCommentReply).toHaveBeenCalledTimes(1);
		expect(sendPrivateReply).not.toHaveBeenCalled();
		expect(result).toMatchObject({ commentReplySent: true, dmSent: false });
	});

	it("skips posting a public reply when the platform comment id is missing", async () => {
		config.accountAutomations = [automation()];
		const result = await run({ platformMessageId: null });

		expect(postCommentReply).not.toHaveBeenCalled();
		expect(sendPrivateReply).not.toHaveBeenCalled();
		expect(result).toMatchObject({ matched: true, duplicate: false });
	});
});
