import { encryptToken } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { requireSettingsKey } from "@/lib/settings";
import type { Json } from "@/types/db";
import { graphNodeId } from "./facebook";

// ============================================================
// Types
// ============================================================

export interface DiscoveredAccount {
	platform: "facebook" | "instagram";
	account_id: string;
	account_name: string;
}

export type MetaPage = {
	id: string;
	name: string;
	access_token: string;
};

// ============================================================
// upsertPlatformAccount
// ============================================================

/**
 * Upsert a platform_account row. ON CONFLICT revives a previously
 * soft-deleted account in place (clears disconnected_at), preserving
 * conversation/message/automation history.
 */
export async function upsertPlatformAccount(account: {
	platform: "facebook" | "instagram";
	account_id: string;
	account_name: string;
	access_token: string;
	token_expires_at: string | null;
	metadata?: Record<string, Json>;
}): Promise<void> {
	const sql = getDb();
	const metadata = account.metadata ?? {};
	// Encrypt the token at rest (real tokens only; sentinels pass through).
	const storedToken = encryptToken(account.access_token);
	await sql`
		INSERT INTO platform_accounts
			(platform, account_id, account_name, access_token, token_expires_at, metadata)
		VALUES (
			${account.platform}, ${account.account_id}, ${account.account_name},
			${storedToken}, ${account.token_expires_at}, ${sql.json(metadata)}
		)
		ON CONFLICT (platform, account_id) DO UPDATE SET
			account_name = EXCLUDED.account_name,
			access_token = EXCLUDED.access_token,
			token_expires_at = EXCLUDED.token_expires_at,
			metadata = EXCLUDED.metadata,
			disconnected_at = NULL`;
}

// ============================================================
// discoverMetaAccounts
// ============================================================

/**
 * Exchange a short-lived user token for a long-lived one (~60 days), then
 * discover all Pages and linked Instagram Business accounts the token has
 * access to. Returns the discovered accounts with non-expiring Page tokens.
 */
export async function discoverMetaAccounts(
	shortLivedUserToken: string,
	triggeringAccountId: string,
	triggeringAccountDbId: string,
): Promise<DiscoveredAccount[]> {
	const [metaAppId, metaAppSecret] = await Promise.all([
		requireSettingsKey("meta_app_id"),
		requireSettingsKey("meta_app_secret"),
	]);

	// 1. Exchange short-lived user token → long-lived user token
	const llParams = new URLSearchParams({
		grant_type: "fb_exchange_token",
		client_id: metaAppId,
		client_secret: metaAppSecret,
		fb_exchange_token: shortLivedUserToken,
	});

	const llRes = await fetch(
		`https://graph.facebook.com/v25.0/oauth/access_token?${llParams.toString()}`,
	);

	if (!llRes.ok) {
		console.error("Long-lived token exchange failed:", await llRes.text());
		return [];
	}

	const llData = (await llRes.json()) as { access_token: string };
	const longLivedUserToken = llData.access_token;

	// 2. Discover all Pages the user granted access to (paginated).
	// Instagram accounts are intentionally NOT derived from linked Pages here —
	// they come exclusively from the Instagram-login flow (separate IG-User
	// token + graph.instagram.com), so this path is Pages-only.
	const allPages = await fetchAllMetaPages(longLivedUserToken);
	if (allPages.length === 0) {
		console.warn("Meta discovery returned no pages");
		return [];
	}

	const discovered = await upsertDiscoveredPages(allPages);

	// 3. Clean up the triggering placeholder if it didn't match a discovered
	// account (access_token "pending" = never connected).
	const triggeringMatchesDiscovered = discovered.some(
		(d) => d.account_id === triggeringAccountId,
	);

	if (!triggeringMatchesDiscovered) {
		const sql = getDb();
		await sql`
			DELETE FROM platform_accounts
			WHERE id = ${triggeringAccountDbId} AND access_token = 'pending'`;
	}

	return discovered;
}

// ============================================================
// Shared helpers
// ============================================================

/** Fetch all Pages from /me/accounts with pagination. */
export async function fetchAllMetaPages(token: string): Promise<MetaPage[]> {
	const allPages: MetaPage[] = [];
	const pagesQuery = new URLSearchParams({
		fields: "id,name,access_token",
		limit: "100",
		access_token: token,
	});
	// First page is built locally; subsequent `nextUrl`s are Meta-minted paging
	// cursors returned verbatim by the API.
	let nextUrl: string | undefined =
		`https://graph.facebook.com/v25.0/me/accounts?${pagesQuery.toString()}`;

	while (nextUrl) {
		const pagesRes = await fetch(nextUrl);
		if (!pagesRes.ok) {
			console.error(
				"Meta /me/accounts discovery failed:",
				await pagesRes.text(),
			);
			break;
		}

		const pagesData = (await pagesRes.json()) as {
			data?: MetaPage[];
			paging?: { next?: string };
		};

		if (pagesData.data) allPages.push(...pagesData.data);
		nextUrl = pagesData.paging?.next;
	}

	return allPages;
}

/** Upsert discovered Pages and subscribe them to comment webhooks. */
export async function upsertDiscoveredPages(
	pages: MetaPage[],
): Promise<DiscoveredAccount[]> {
	const discovered: DiscoveredAccount[] = [];

	for (const page of pages) {
		// Upsert Facebook Page row (Page tokens from long-lived user tokens are
		// non-expiring).
		await upsertPlatformAccount({
			platform: "facebook",
			account_id: page.id,
			account_name: page.name,
			access_token: page.access_token,
			token_expires_at: null,
		});

		discovered.push({
			platform: "facebook",
			account_id: page.id,
			account_name: page.name,
		});

		// Subscribe Page to webhooks (feed + messages).
		try {
			const subQuery = new URLSearchParams({
				subscribed_fields: "feed,messages",
				access_token: page.access_token,
			});
			const subRes = await fetch(
				`https://graph.facebook.com/v25.0/${graphNodeId(page.id)}/subscribed_apps?${subQuery.toString()}`,
				{ method: "POST" },
			);
			if (!subRes.ok) {
				console.error(
					`Webhook subscription failed for page ${page.id}:`,
					await subRes.text(),
				);
			}
		} catch (subError) {
			console.error(
				`Webhook subscription error for page ${page.id}:`,
				subError,
			);
		}
	}

	return discovered;
}
