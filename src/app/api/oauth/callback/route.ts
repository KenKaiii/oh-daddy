import { cookies } from "next/headers";
import { z } from "zod";

import { encryptToken } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { OAUTH_STATE_COOKIE } from "@/lib/oauth/constants";
import {
	type DiscoveredAccount,
	discoverMetaAccounts,
} from "@/lib/platforms/meta-discovery";
import type { PlatformType } from "@/lib/schemas/platform";
import { getSettingsKey, requireSettingsKey } from "@/lib/settings";
import type { Json } from "@/types/db";

async function exchangeMetaToken(
	code: string,
	redirectUri: string,
	codeVerifier: string,
): Promise<{ access_token: string; expires_in?: number }> {
	const [metaAppId, metaAppSecret] = await Promise.all([
		requireSettingsKey("meta_app_id"),
		requireSettingsKey("meta_app_secret"),
	]);

	// Facebook Login for Business (config_id) doesn't use PKCE code_verifier.
	const configId = await getSettingsKey("meta_config_id");

	const params = new URLSearchParams({
		client_id: metaAppId,
		client_secret: metaAppSecret,
		redirect_uri: redirectUri,
		code,
	});
	if (codeVerifier && !configId) params.set("code_verifier", codeVerifier);

	const response = await fetch(
		`https://graph.facebook.com/v25.0/oauth/access_token?${params.toString()}`,
		{ method: "GET" },
	);

	if (!response.ok) {
		// Log the upstream diagnostic body server-side only; never embed it in
		// the thrown Error.message, which the callback reflects to the client.
		console.error(
			`Meta token exchange failed (${response.status}):`,
			await response.text(),
		);
		throw new Error("Meta token exchange failed");
	}
	return response.json();
}

const callbackSchema = z
	.object({
		code: z.string().min(1).max(4096),
		state: z.string().min(1).max(256),
	})
	.strict();

export async function POST(request: Request) {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const validated = callbackSchema.safeParse(rawBody);
	if (!validated.success) {
		return Response.json({ error: "Invalid request body" }, { status: 400 });
	}
	const { code, state } = validated.data;

	// Session binding: the callback must be completed by the same browser that
	// initiated the flow. authorize set an HttpOnly cookie carrying the state;
	// require it to match the submitted state (RFC 9700 §4.7.1). Consume the
	// cookie immediately so it cannot be reused.
	const cookieStore = await cookies();
	const boundState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
	cookieStore.delete(OAUTH_STATE_COOKIE);
	if (!boundState || boundState !== state) {
		return Response.json(
			{ error: "Invalid or missing session state — possible CSRF attack" },
			{ status: 400 },
		);
	}

	const sql = getDb();
	const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
	const redirectUri = `${baseUrl}/oauth/callback`;

	// Atomically claim the flow: a single UPDATE matches the account by
	// oauth_state AND clears that token in one statement, so the state is
	// single-use with no TOCTOU window. The match condition is on the mutated
	// row itself (p.metadata->>'oauth_state'), so under READ COMMITTED a
	// concurrent/replayed callback is re-checked after the row lock and finds
	// the token already gone — only the first request claims it. The remaining
	// one-time fields (code_verifier, expires_at) are returned for validation
	// and stripped in the final write below.
	type AccountRow = {
		id: string;
		account_id: string;
		platform: string;
		metadata: Record<string, Json>;
	};
	let claimed: AccountRow[];
	try {
		claimed = await sql<AccountRow[]>`
			UPDATE platform_accounts p
			SET metadata = p.metadata - 'oauth_state'
			WHERE p.metadata->>'oauth_state' = ${state}
			RETURNING p.id, p.account_id, p.platform, p.metadata`;
	} catch (err) {
		console.error("Account lookup failed:", err);
		return Response.json({ error: "Account lookup failed" }, { status: 500 });
	}

	const account = claimed[0];

	if (!account) {
		return Response.json(
			{ error: "Invalid state parameter — possible CSRF attack" },
			{ status: 400 },
		);
	}

	// `metadata` no longer carries oauth_state (the claim removed it) but still
	// holds the one-time code_verifier + expiry used for validation below.
	const metadata: Record<string, Json | undefined> = account.metadata ?? {};

	// Enforce the state TTL recorded at authorize time. The atomic claim already
	// consumed the state; an expired one is rejected here regardless.
	const expiresAt = metadata.oauth_state_expires_at;
	if (typeof expiresAt === "number" && Date.now() > expiresAt) {
		return Response.json(
			{ error: "State parameter has expired — please restart the flow" },
			{ status: 400 },
		);
	}

	const platform = account.platform as PlatformType;
	const storedCodeVerifier = (metadata.oauth_code_verifier as string) ?? "";

	// Exchange the code for an access token.
	let tokenData: { access_token: string; expires_in?: number };
	try {
		tokenData = await exchangeMetaToken(code, redirectUri, storedCodeVerifier);
	} catch (tokenError) {
		console.error("Token exchange error:", tokenError);
		return Response.json({ error: "Token exchange failed" }, { status: 502 });
	}

	const tokenExpiresAt = tokenData.expires_in
		? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
		: null;

	// Recompute the cleaned metadata for the final write. The atomic claim above
	// already stripped these keys in the DB; this keeps the persisted value in
	// sync when we also write access_token below.
	const {
		oauth_state: _s,
		oauth_account_id: _a,
		oauth_platform: _p,
		oauth_code_verifier: _v,
		oauth_state_created_at: _c,
		oauth_state_expires_at: _e,
		...cleanMetadata
	} = metadata;

	// Discover all Pages + IG accounts the user granted access to.
	let discoveredAccounts: DiscoveredAccount[] = [];
	try {
		discoveredAccounts = await discoverMetaAccounts(
			tokenData.access_token,
			account.account_id,
			account.id,
		);
	} catch (discoveryError) {
		console.error("Meta account discovery failed:", discoveryError);
	}

	const triggeringWasDiscovered = discoveredAccounts.some(
		(d) => d.account_id === account.account_id,
	);

	const cleanJson = sql.json(cleanMetadata as Json);
	try {
		if (!triggeringWasDiscovered) {
			// Discovery didn't cover the triggering placeholder — update it directly
			// so we at least persist the user token + clear OAuth metadata. Encrypt
			// the token at rest.
			await sql`
				UPDATE platform_accounts
				SET access_token = ${encryptToken(tokenData.access_token)},
				    token_expires_at = ${tokenExpiresAt},
				    metadata = ${cleanJson}
				WHERE id = ${account.id}`;
		} else {
			// Triggering account was discovered — just clear OAuth metadata.
			await sql`
				UPDATE platform_accounts SET metadata = ${cleanJson} WHERE id = ${account.id}`;
		}
	} catch (err) {
		console.error("Failed to finalize account after OAuth:", err);
	}

	return Response.json({
		success: true,
		platform,
		accountId: account.id,
		discoveredAccounts,
		redirectPath: "/accounts",
	});
}
