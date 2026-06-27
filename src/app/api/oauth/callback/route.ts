import { z } from "zod";

import { getDb } from "@/lib/db";
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
		throw new Error(`Meta token exchange failed: ${await response.text()}`);
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

	const sql = getDb();
	const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
	const redirectUri = `${baseUrl}/oauth/callback`;

	// Resolve the account by the stored oauth_state (CSRF + lookup in one step).
	type AccountRow = {
		id: string;
		account_id: string;
		platform: string;
		metadata: Record<string, Json>;
	};
	let accounts: AccountRow[];
	try {
		accounts = await sql<AccountRow[]>`
			SELECT id, account_id, platform, metadata FROM platform_accounts`;
	} catch (err) {
		console.error("Account lookup failed:", err);
		return Response.json({ error: "Account lookup failed" }, { status: 500 });
	}

	const account = accounts.find((a) => {
		const meta = a.metadata ?? {};
		return meta.oauth_state === state;
	});

	if (!account) {
		return Response.json(
			{ error: "Invalid state parameter — possible CSRF attack" },
			{ status: 400 },
		);
	}

	const metadata: Record<string, Json | undefined> = account.metadata ?? {};
	const platform = account.platform as PlatformType;
	const storedCodeVerifier = (metadata.oauth_code_verifier as string) ?? "";

	// Exchange the code for an access token.
	let tokenData: { access_token: string; expires_in?: number };
	try {
		tokenData = await exchangeMetaToken(code, redirectUri, storedCodeVerifier);
	} catch (tokenError) {
		console.error("Token exchange error:", tokenError);
		return Response.json(
			{
				error:
					tokenError instanceof Error
						? tokenError.message
						: "Token exchange failed",
			},
			{ status: 500 },
		);
	}

	const tokenExpiresAt = tokenData.expires_in
		? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
		: null;

	// Strip the one-time OAuth metadata.
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
			// so we at least persist the user token + clear OAuth metadata.
			await sql`
				UPDATE platform_accounts
				SET access_token = ${tokenData.access_token},
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
