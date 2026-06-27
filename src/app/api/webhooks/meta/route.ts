import crypto from "node:crypto";

import type { NextRequest } from "next/server";

import { inngest } from "@/inngest/client";
import { getDb } from "@/lib/db";
import type { PlatformType } from "@/lib/schemas/platform";
import { metaWebhookPayloadSchema } from "@/lib/schemas/webhook";
import { getSettingsKey } from "@/lib/settings";

// GET — webhook verification handshake.
export async function GET(request: NextRequest) {
	const searchParams = request.nextUrl.searchParams;
	const mode = searchParams.get("hub.mode");
	const token = searchParams.get("hub.verify_token");
	const challenge = searchParams.get("hub.challenge");

	const verifyToken = await getSettingsKey("meta_webhook_verify_token");

	if (mode === "subscribe" && verifyToken && token === verifyToken) {
		return new Response(challenge, { status: 200 });
	}
	return new Response("Forbidden", { status: 403 });
}

// POST — receive webhook events. Validate HMAC, log, filter to real comment
// add/edit events, enqueue to Inngest, return 200 fast.
export async function POST(request: NextRequest) {
	const body = await request.text();

	// 1. Verify x-hub-signature-256 (HMAC of the raw body w/ app secret).
	const signature = request.headers.get("x-hub-signature-256");
	if (!(await verifySignature(body, signature))) {
		return Response.json({ error: "Invalid signature" }, { status: 401 });
	}

	// 2. Parse payload.
	let jsonBody: unknown;
	try {
		jsonBody = JSON.parse(body);
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const parsed = metaWebhookPayloadSchema.safeParse(jsonBody);
	if (!parsed.success) {
		return Response.json({ error: "Invalid payload" }, { status: 400 });
	}

	const sql = getDb();
	const platform: PlatformType =
		parsed.data.object === "instagram" ? "instagram" : "facebook";

	// 3. Log raw event (fire-and-forget — powers dashboard "comments received").
	void sql`
		INSERT INTO webhook_events (platform, event_type, payload)
		VALUES (${platform}, 'webhook', ${sql.json(jsonBody as never)})`.catch(
		(err) => console.error("[meta-webhook] event log failed:", err),
	);

	// 4. Process each entry → enqueue real comment add/edit events to Inngest.
	const sends: Promise<unknown>[] = [];

	for (const entry of parsed.data.entry) {
		const [account] = await sql<{ id: string }[]>`
			SELECT id FROM platform_accounts
			WHERE platform = ${platform} AND account_id = ${entry.id}
			  AND disconnected_at IS NULL
			LIMIT 1`;

		if (!account) continue;
		if (!entry.changes) continue;

		for (const change of entry.changes) {
			if (change.field !== "comments" && change.field !== "feed") continue;

			const val = change.value as Record<string, unknown>;

			// Meta's `feed` topic fires for EVERY page activity (reactions, posts,
			// shares). Only forward real comment add/edit events.
			if (change.field === "feed") {
				const item = typeof val.item === "string" ? val.item : "";
				const verb = typeof val.verb === "string" ? val.verb : "";
				if (item !== "comment") continue;
				if (verb && verb !== "add" && verb !== "edited") continue;
			}

			const commentId = val.comment_id ?? val.id;
			const verb = val.verb ?? "add";

			sends.push(
				inngest.send({
					// Dedup id: collapse webhook/poll retries for the same comment.
					...(commentId
						? { id: `comment-${platform}-${String(commentId)}-${String(verb)}` }
						: {}),
					name: "comment/process",
					data: {
						platform,
						platformAccountId: account.id,
						rawData: change.value,
					},
				}),
			);
		}
	}

	if (sends.length > 0) {
		const results = await Promise.allSettled(sends);
		if (results.some((r) => r.status === "rejected")) {
			for (const r of results) {
				if (r.status === "rejected") {
					console.error("[meta-webhook] enqueue failed:", r.reason);
				}
			}
			// Non-200 so Meta redelivers; the Inngest dedup id makes retries safe.
			return Response.json({ status: "error" }, { status: 500 });
		}
	}

	return Response.json({ status: "ok" });
}

async function verifySignature(
	body: string,
	signature: string | null,
): Promise<boolean> {
	const appSecret = await getSettingsKey("meta_app_secret");
	if (!appSecret) {
		throw new Error(
			"meta_app_secret is not configured — webhook verification failed",
		);
	}

	if (!signature) return false;
	const expected = `sha256=${crypto
		.createHmac("sha256", appSecret)
		.update(body)
		.digest("hex")}`;
	try {
		return crypto.timingSafeEqual(
			Buffer.from(expected),
			Buffer.from(signature),
		);
	} catch {
		return false;
	}
}
