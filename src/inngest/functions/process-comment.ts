import { z } from "zod";

import { inngest } from "@/inngest/client";
import { commentMatchesAutomation } from "@/lib/automations/run-automation";
import { decryptToken } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { getAdapter } from "@/lib/platforms";
import { fetchCommentAuthor } from "@/lib/platforms/facebook";
import { platformTypeSchema } from "@/lib/schemas/platform";
import type { Json } from "@/types/db";

const payloadSchema = z.object({
	platform: platformTypeSchema,
	platformAccountId: z.string().uuid(),
	rawData: z.record(z.string(), z.unknown()),
});

export const processComment = inngest.createFunction(
	{
		id: "process-comment",
		// NO throttle here: ingestion (contact/conversation/message upserts +
		// dashboard stats) must stay real-time. The per-account rate cap lives on
		// the downstream `automation-send` function, so only actual Meta sends are
		// paced — never ingestion. A modest concurrency cap just bounds parallel
		// DB work; it does not rate-limit per account.
		concurrency: { limit: 10 },
		retries: 3,
		triggers: [{ event: "comment/process" }],
	},
	async ({ event, step }) => {
		const parsed = payloadSchema.parse(event.data);

		// ──────────────────────────────────────────────────────────────
		// STEP 1: Normalize, upsert contact/conversation/message (dedup).
		// ──────────────────────────────────────────────────────────────
		const ingested = await step.run("ingest", async () => {
			const adapter = getAdapter(parsed.platform);
			const sql = getDb();

			const normalized = adapter.normalizeComment(parsed.rawData);
			const normalizedContact = adapter.normalizeContact(parsed.rawData);

			// Fetch platform account (own-comment check + author enrichment).
			const [ownAccount] = await sql<
				{ account_id: string; access_token: string; account_name: string }[]
			>`
				SELECT account_id, access_token, account_name
				FROM platform_accounts WHERE id = ${parsed.platformAccountId}`;

			// Decrypt the token only here, in memory, for the author-enrichment call
			// below. The encrypted blob (not the plaintext) is what we return from
			// this step, so Inngest's durable step state never holds a live token.
			// Sentinels ("" / "pending") and legacy plaintext pass through.
			const ownAccessToken = ownAccount
				? decryptToken(ownAccount.access_token)
				: null;

			// Enrich author info when the webhook omitted `from`.
			if (
				!normalizedContact.platformUserId &&
				ownAccessToken &&
				normalized.platformMessageId
			) {
				const author = await fetchCommentAuthor(
					ownAccessToken,
					normalized.platformMessageId,
				);
				if (author) {
					normalizedContact.platformUserId = author.id;
					normalizedContact.name = author.name;
					normalized.platformUserId = author.id;
					normalized.userName = author.name;
				}
			}

			// Skip comments from our own Page (prevent reply loops).
			if (
				ownAccount &&
				normalizedContact.platformUserId === ownAccount.account_id
			) {
				return { status: "skipped-own-comment" as const };
			}

			// Skip comments with no identifiable author.
			if (!normalizedContact.platformUserId) {
				return { status: "skipped-no-author" as const };
			}

			// Skip empty bodies (image-only / sticker / video replies).
			if (!normalized.content?.trim()) {
				return { status: "skipped-empty-body" as const };
			}

			// Skip comments on posts no active automation is tracking. Mirrors the
			// loadAutomations selection: a scope='meta' rule tracks everything; an
			// account rule tracks all that account's posts (platform_post_id IS NULL)
			// or one specific post. Without this we'd store — and count — comments
			// from every post on the account, not just the ones being automated.
			const [tracked] = await sql<{ one: number }[]>`
				SELECT 1 AS one FROM comment_automations
				WHERE is_active = true
				  AND (
				    scope = 'meta'
				    OR (
				      platform_account_id = ${parsed.platformAccountId}
				      AND (platform_post_id IS NULL OR platform_post_id = ${normalized.platformPostId})
				    )
				  )
				LIMIT 1`;
			if (!tracked) {
				return { status: "skipped-untracked-post" as const };
			}

			// Upsert contact. COALESCE keeps an existing name/username/avatar when
			// this delivery doesn't carry one (don't overwrite with null).
			const [contact] = await sql<{ id: string }[]>`
				INSERT INTO contacts (platform, platform_user_id, name, username, avatar_url, last_seen_at)
				VALUES (
					${parsed.platform},
					${normalizedContact.platformUserId},
					${normalizedContact.name},
					${normalizedContact.username},
					${normalizedContact.avatarUrl},
					now()
				)
				ON CONFLICT (platform, platform_user_id) DO UPDATE SET
					name = COALESCE(EXCLUDED.name, contacts.name),
					username = COALESCE(EXCLUDED.username, contacts.username),
					avatar_url = COALESCE(EXCLUDED.avatar_url, contacts.avatar_url),
					last_seen_at = EXCLUDED.last_seen_at
				RETURNING id`;

			// Resolve canonical thread root: if the parent_id matches a message we
			// already stored, adopt that conversation's thread_id so every reply
			// on the same physical thread maps to one conversation row.
			let resolvedThreadId = normalized.platformThreadId;
			if (
				resolvedThreadId &&
				resolvedThreadId !== normalized.platformMessageId
			) {
				const [parentMsg] = await sql<{ platform_thread_id: string }[]>`
					SELECT c.platform_thread_id
					FROM messages m
					JOIN conversations c ON c.id = m.conversation_id
					WHERE m.platform_message_id = ${resolvedThreadId}
					  AND c.platform_account_id = ${parsed.platformAccountId}
					  AND c.interaction_type = 'comment'
					LIMIT 1`;
				if (parentMsg?.platform_thread_id) {
					resolvedThreadId = parentMsg.platform_thread_id;
				}
			}

			// Find or create the comment conversation. NOT an upsert — upserting
			// would overwrite contact_id with the latest commenter when multiple
			// users reply in the same thread, corrupting attribution.
			let conversationId: string;
			{
				const [existingConv] = await sql<{ id: string }[]>`
					SELECT id FROM conversations
					WHERE platform_account_id = ${parsed.platformAccountId}
					  AND interaction_type = 'comment'
					  AND platform_thread_id = ${resolvedThreadId}
					LIMIT 1`;

				if (existingConv) {
					conversationId = existingConv.id;
					await sql`
						UPDATE conversations SET last_message_at = ${normalized.timestamp}
						WHERE id = ${existingConv.id}`;
				} else {
					const [newConv] = await sql<{ id: string }[]>`
						INSERT INTO conversations
							(contact_id, platform_account_id, interaction_type,
							 platform_thread_id, platform_post_id, last_message_at)
						VALUES (
							${contact.id}, ${parsed.platformAccountId}, 'comment',
							${resolvedThreadId}, ${normalized.platformPostId}, ${normalized.timestamp}
						)
						RETURNING id`;
					conversationId = newConv.id;
				}
			}

			// Dedup — check if message already exists.
			let messageId = "";
			let isNewMessage = true;
			if (normalized.platformMessageId) {
				const [existing] = await sql<{ id: string }[]>`
					SELECT id FROM messages
					WHERE conversation_id = ${conversationId}
					  AND platform_message_id = ${normalized.platformMessageId}
					LIMIT 1`;
				if (existing) {
					messageId = existing.id;
					isNewMessage = false;
				}
			}

			// Insert message (only if new).
			if (isNewMessage) {
				const metadata: Json = {
					...normalized.metadata,
					commenter_name: normalizedContact.name ?? null,
					commenter_username: normalizedContact.username ?? null,
					commenter_platform_user_id: normalizedContact.platformUserId ?? null,
				};
				const [message] = await sql<{ id: string }[]>`
					INSERT INTO messages
						(conversation_id, role, content, platform_message_id, metadata)
					VALUES (
						${conversationId}, 'user', ${normalized.content},
						${normalized.platformMessageId}, ${sql.json(metadata)}
					)
					RETURNING id`;
				messageId = message.id;
			}

			return {
				status: "ingested" as const,
				messageId,
				contactId: contact.id,
				conversationId,
				content: normalized.content,
				platformMessageId: normalized.platformMessageId ?? null,
				platformPostId: normalized.platformPostId ?? null,
			};
		});

		if (ingested.status !== "ingested") {
			return ingested;
		}

		// ──────────────────────────────────────────────────────────────
		// STEP 2: Match check + fan-out (no throttle, no delay here).
		//
		// Read-only check decides whether this comment should trigger a send.
		// Ingestion above already happened in real time; only on a MATCH do we
		// hand off to the throttled `automation-send` function via a durable
		// event. step.sendEvent is memoized in the run, so a replay/retry of
		// process-comment won't emit duplicate sends — and even if it did, the
		// claim-before-send in the delivery worker dedups by (automation,
		// message).
		// ──────────────────────────────────────────────────────────────
		const matched = await step.run("match-check", () =>
			commentMatchesAutomation({
				platformAccountId: parsed.platformAccountId,
				platformPostId: ingested.platformPostId,
				commentText: ingested.content,
			}),
		);

		if (matched) {
			await step.sendEvent("emit-automation-send", {
				name: "automation/send",
				data: {
					platform: parsed.platform,
					platformAccountId: parsed.platformAccountId,
					messageId: ingested.messageId,
					conversationId: ingested.conversationId,
					contactId: ingested.contactId,
					commentText: ingested.content,
					platformMessageId: ingested.platformMessageId,
					platformPostId: ingested.platformPostId,
				},
			});
		}

		return {
			status: matched ? ("send-enqueued" as const) : ("stored" as const),
			messageId: ingested.messageId,
			conversationId: ingested.conversationId,
		};
	},
);
