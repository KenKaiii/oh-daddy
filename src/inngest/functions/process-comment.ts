import { z } from "zod";

import { inngest } from "@/inngest/client";
import { runKeywordAutomation } from "@/lib/automations/run-automation";
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
		concurrency: { limit: 5 },
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
				ownAccountId: ownAccount?.account_id ?? null,
				// Encrypted-at-rest blob (or sentinel) — decrypted at point of use in
				// step 2, never persisted to Inngest state as plaintext.
				ownAccessTokenEncrypted: ownAccount?.access_token ?? null,
			};
		});

		if (ingested.status !== "ingested") {
			return ingested;
		}

		// ──────────────────────────────────────────────────────────────
		// STEP 2: Run keyword automations.
		// ──────────────────────────────────────────────────────────────
		const automationHandled = await step.run(
			"check-keyword-automation",
			async () => {
				const result = await runKeywordAutomation({
					platform: parsed.platform,
					platformAccountId: parsed.platformAccountId,
					ownAccessToken: decryptToken(
						ingested.ownAccessTokenEncrypted,
					) as string,
					ownAccountId: ingested.ownAccountId as string,
					messageId: ingested.messageId,
					conversationId: ingested.conversationId,
					contactId: ingested.contactId,
					commentText: ingested.content,
					platformMessageId: ingested.platformMessageId,
				});
				return result.matched;
			},
		);

		return {
			status: automationHandled
				? ("automation-handled" as const)
				: ("stored" as const),
			messageId: ingested.messageId,
			conversationId: ingested.conversationId,
		};
	},
);
