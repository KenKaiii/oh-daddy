import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const APP_SECRET = "test-app-secret";

// In-memory fakes for the route's three dependencies.
const harness = vi.hoisted(() => {
	const send = vi.fn(async () => ({ ids: ["evt"] }));
	// account_id -> exists? Controls the platform_accounts lookup.
	const knownAccounts = new Set<string>(["page-1"]);

	const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
		const text = strings.join(" ").replace(/\s+/g, " ").toLowerCase();
		if (text.includes("insert into webhook_events")) {
			return Promise.resolve([]);
		}
		if (text.includes("from platform_accounts")) {
			// account_id is the 2nd interpolated value in the route's query.
			const accountId = String(values[1]);
			return Promise.resolve(
				knownAccounts.has(accountId) ? [{ id: `db-${accountId}` }] : [],
			);
		}
		return Promise.resolve([]);
	}) as unknown as {
		(s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
		json: (v: unknown) => unknown;
	};
	sql.json = (v: unknown) => v;

	return { send, knownAccounts, sql };
});

vi.mock("@/inngest/client", () => ({ inngest: { send: harness.send } }));
vi.mock("@/lib/db", () => ({ getDb: () => harness.sql }));
vi.mock("@/lib/settings", () => ({
	getSettingsKey: async (key: string) =>
		key === "meta_app_secret" ? APP_SECRET : null,
}));

import { POST } from "./route";

function sign(body: string, secret = APP_SECRET): string {
	return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

interface ReqOpts {
	/** Provide a literal signature header; omit to auto-sign; null to send none. */
	signature?: string | null;
}

function makeRequest(body: string, opts: ReqOpts = {}): NextRequest {
	const headers = new Headers();
	const sig = opts.signature === undefined ? sign(body) : opts.signature;
	if (sig !== null) headers.set("x-hub-signature-256", sig);
	return new Request("http://localhost/api/webhooks/meta", {
		method: "POST",
		body,
		headers,
	}) as unknown as NextRequest;
}

function commentPayload(accountId = "page-1") {
	return JSON.stringify({
		object: "page",
		entry: [
			{
				id: accountId,
				time: 1,
				changes: [
					{
						field: "comments",
						value: { comment_id: "c-123", verb: "add", message: "guide" },
					},
				],
			},
		],
	});
}

beforeEach(() => {
	harness.send.mockClear();
	harness.knownAccounts.clear();
	harness.knownAccounts.add("page-1");
});

describe("POST /api/webhooks/meta — signature gate", () => {
	it("accepts a correctly signed payload and enqueues comment/process", async () => {
		const body = commentPayload();
		const res = await POST(makeRequest(body));

		expect(res.status).toBe(200);
		expect(harness.send).toHaveBeenCalledTimes(1);
		expect(harness.send).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "comment/process",
				id: "comment-facebook-c-123-add",
				data: expect.objectContaining({
					platform: "facebook",
					platformAccountId: "db-page-1",
				}),
			}),
		);
	});

	it("rejects a payload with a wrong signature (401, no enqueue)", async () => {
		const body = commentPayload();
		const res = await POST(
			makeRequest(body, { signature: sign(body, "wrong-secret") }),
		);

		expect(res.status).toBe(401);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("rejects a payload with no signature header (401)", async () => {
		const res = await POST(makeRequest(commentPayload(), { signature: null }));
		expect(res.status).toBe(401);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("returns 400 for a correctly signed but non-JSON body", async () => {
		const body = "not json";
		const res = await POST(makeRequest(body));
		expect(res.status).toBe(400);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("returns 400 for a signed body that fails schema validation", async () => {
		const body = JSON.stringify({ object: "page" }); // missing `entry`
		const res = await POST(makeRequest(body));
		expect(res.status).toBe(400);
	});
});

describe("POST /api/webhooks/meta — filtering", () => {
	it("ignores entries for an unknown / disconnected account", async () => {
		const res = await POST(makeRequest(commentPayload("unknown-page")));
		expect(res.status).toBe(200);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("ignores feed events that are not comment add/edit", async () => {
		const body = JSON.stringify({
			object: "page",
			entry: [
				{
					id: "page-1",
					changes: [
						{ field: "feed", value: { item: "reaction", verb: "add" } },
					],
				},
			],
		});
		const res = await POST(makeRequest(body));
		expect(res.status).toBe(200);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("enqueues a feed event that IS a comment add", async () => {
		const body = JSON.stringify({
			object: "page",
			entry: [
				{
					id: "page-1",
					changes: [
						{
							field: "feed",
							value: { item: "comment", verb: "add", comment_id: "c-9" },
						},
					],
				},
			],
		});
		const res = await POST(makeRequest(body));
		expect(res.status).toBe(200);
		expect(harness.send).toHaveBeenCalledTimes(1);
		expect(harness.send).toHaveBeenCalledWith(
			expect.objectContaining({ id: "comment-facebook-c-9-add" }),
		);
	});
});
