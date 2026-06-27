import { getDb } from "@/lib/db";
import { buildOAuthUrl } from "@/lib/oauth/urls";
import type { PlatformType } from "@/lib/schemas/platform";
import type { Json } from "@/types/db";

// State expires after 10 minutes.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
	let body: { platform?: PlatformType; accountId?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const { platform, accountId } = body;

	if (!platform || !accountId) {
		return Response.json(
			{ error: "Missing required fields: platform and accountId" },
			{ status: 400 },
		);
	}

	if (platform !== "facebook" && platform !== "instagram") {
		return Response.json(
			{ error: "Invalid platform. Must be one of: facebook, instagram" },
			{ status: 400 },
		);
	}

	const sql = getDb();

	const [account] = await sql<
		{ id: string; platform: string; metadata: Record<string, Json> }[]
	>`
		SELECT id, platform, metadata FROM platform_accounts WHERE id = ${accountId}`;

	if (!account) {
		return Response.json({ error: "Account not found" }, { status: 404 });
	}

	if (account.platform !== platform) {
		return Response.json(
			{ error: "Platform mismatch between account and request" },
			{ status: 400 },
		);
	}

	const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
	const redirectUri = `${baseUrl}/oauth/callback`;

	let authUrlResult: Awaited<ReturnType<typeof buildOAuthUrl>>;
	try {
		authUrlResult = await buildOAuthUrl(platform, redirectUri);
	} catch (err) {
		return Response.json(
			{
				error: err instanceof Error ? err.message : "Failed to build OAuth URL",
			},
			{ status: 400 },
		);
	}

	// Store state + PKCE verifier in account metadata for CSRF/PKCE validation.
	const now = Date.now();
	const metadata: Record<string, Json> = {
		...(account.metadata ?? {}),
		oauth_state: authUrlResult.state,
		oauth_account_id: accountId,
		oauth_platform: platform,
		oauth_code_verifier: authUrlResult.codeVerifier,
		oauth_state_created_at: now,
		oauth_state_expires_at: now + OAUTH_STATE_TTL_MS,
	};

	try {
		await sql`
			UPDATE platform_accounts SET metadata = ${sql.json(metadata)} WHERE id = ${accountId}`;
	} catch (err) {
		console.error("Failed to store OAuth state:", err);
		return Response.json(
			{ error: "Failed to initialize OAuth flow" },
			{ status: 500 },
		);
	}

	return Response.json({
		authorizationUrl: authUrlResult.url,
		state: authUrlResult.state,
		accountId,
	});
}
