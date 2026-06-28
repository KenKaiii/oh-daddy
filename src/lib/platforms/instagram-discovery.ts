import { getDb } from "@/lib/db";
import { graphNodeId } from "./facebook";
import {
	type DiscoveredAccount,
	upsertPlatformAccount,
} from "./meta-discovery";

// All Instagram-login calls go through graph.instagram.com — it accepts the
// IG-User token issued by the Instagram Business Login flow (FB Page tokens are
// rejected with code 190).
const IG_GRAPH_API_BASE = "https://graph.instagram.com/v23.0";

interface IGProfile {
	user_id?: string;
	username?: string;
}

/**
 * Discover the single Instagram account behind an Instagram-login token.
 *
 * Unlike the Facebook flow (which enumerates Pages from `/me/accounts`), the
 * Instagram-login token maps to exactly one IG professional account. We fetch
 * its profile, upsert it with the long-lived IG-User token, subscribe the app
 * to `comments` webhooks, and clean up the triggering placeholder row.
 */
export async function discoverInstagramAccount(
	longLivedToken: string,
	igUserId: string,
	triggeringAccountDbId: string,
	tokenExpiresAt: string | null,
): Promise<DiscoveredAccount[]> {
	// 1. Fetch the account profile (id + username) from graph.instagram.com.
	const profileParams = new URLSearchParams({
		fields: "user_id,username",
		access_token: longLivedToken,
	});
	const profileRes = await fetch(
		`${IG_GRAPH_API_BASE}/me?${profileParams.toString()}`,
	);
	if (!profileRes.ok) {
		console.error(
			"Instagram profile discovery failed:",
			await profileRes.text(),
		);
		return [];
	}

	const profile = (await profileRes.json()) as IGProfile;
	const accountId = profile.user_id ?? igUserId;
	const accountName = profile.username ?? accountId;

	// 2. Upsert the IG account with the long-lived IG-User token (expires ~60d).
	await upsertPlatformAccount({
		platform: "instagram",
		account_id: accountId,
		account_name: accountName,
		access_token: longLivedToken,
		token_expires_at: tokenExpiresAt,
	});

	// 3. Subscribe the app to `comments` webhooks for this IG account.
	try {
		const subParams = new URLSearchParams({
			subscribed_fields: "comments",
			access_token: longLivedToken,
		});
		const subRes = await fetch(
			`${IG_GRAPH_API_BASE}/${graphNodeId(accountId)}/subscribed_apps?${subParams.toString()}`,
			{ method: "POST" },
		);
		if (!subRes.ok) {
			console.error(
				`Instagram webhook subscription failed for ${accountId}:`,
				await subRes.text(),
			);
		}
	} catch (subError) {
		console.error(
			`Instagram webhook subscription error for ${accountId}:`,
			subError,
		);
	}

	// 4. Clean up the triggering placeholder. The IG account is upserted under its
	// real id, so the `pending-` placeholder is always a distinct, stale row
	// (access_token "pending" = never connected).
	const sql = getDb();
	await sql`
		DELETE FROM platform_accounts
		WHERE id = ${triggeringAccountDbId} AND access_token = 'pending'`;

	return [
		{
			platform: "instagram",
			account_id: accountId,
			account_name: accountName,
		},
	];
}
