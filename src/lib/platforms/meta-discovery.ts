import { getDb } from "@/lib/db";
import { requireSettingsKey } from "@/lib/settings";
import type { Json } from "@/types/db";

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
	instagram_business_account?: {
		id: string;
		username?: string;
		name?: string;
		profile_picture_url?: string;
	};
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
	await sql`
		INSERT INTO platform_accounts
			(platform, account_id, account_name, access_token, token_expires_at, metadata)
		VALUES (
			${account.platform}, ${account.account_id}, ${account.account_name},
			${account.access_token}, ${account.token_expires_at}, ${sql.json(metadata)}
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

	// 2. Discover all Pages the user granted access to (paginated)
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
	let nextUrl: string | undefined =
		`https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}&limit=100&access_token=${token}`;

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

/** Upsert discovered Pages + linked IG accounts and subscribe to webhooks. */
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
			const subRes = await fetch(
				`https://graph.facebook.com/v25.0/${page.id}/subscribed_apps?subscribed_fields=feed,messages&access_token=${page.access_token}`,
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

		// Linked Instagram Business Account → upsert (IG API uses the Page token).
		const ig = page.instagram_business_account;
		if (ig) {
			const igName = ig.username ?? ig.name ?? ig.id;
			await upsertPlatformAccount({
				platform: "instagram",
				account_id: ig.id,
				account_name: igName,
				access_token: page.access_token,
				token_expires_at: null,
				metadata: {
					linked_facebook_page_id: page.id,
					profile_picture_url: ig.profile_picture_url ?? null,
				},
			});

			discovered.push({
				platform: "instagram",
				account_id: ig.id,
				account_name: igName,
			});
		}
	}

	return discovered;
}
