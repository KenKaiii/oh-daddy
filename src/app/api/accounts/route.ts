import type { NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import type { PlatformAccountRow } from "@/types/db";

type AccountSelect = Pick<
	PlatformAccountRow,
	| "id"
	| "platform"
	| "account_id"
	| "account_name"
	| "access_token"
	| "token_expires_at"
	| "created_at"
>;

function isConnected(token: string | null): boolean {
	return (
		!!token && token !== "pending" && token !== "" && !token.startsWith("mock-")
	);
}

export async function GET() {
	try {
		const sql = getDb();
		const rows = await sql<AccountSelect[]>`
			SELECT id, platform, account_id, account_name, access_token,
			       token_expires_at, created_at
			FROM platform_accounts
			WHERE disconnected_at IS NULL
			ORDER BY platform, account_name`;

		const safe = rows.map((a) => ({
			id: a.id,
			platform: a.platform,
			account_id: a.account_id,
			account_name: a.account_name,
			is_connected: isConnected(a.access_token),
			token_expires_at: a.token_expires_at,
			created_at: a.created_at,
		}));

		return Response.json({ data: safe });
	} catch (err) {
		console.error("[Accounts GET] error:", err);
		return Response.json(
			{ error: "Failed to fetch accounts" },
			{ status: 500 },
		);
	}
}

export async function POST(request: NextRequest) {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const { platform, account_id, account_name, access_token } = body;

	if (
		!platform ||
		typeof platform !== "string" ||
		(platform !== "facebook" && platform !== "instagram")
	) {
		return Response.json(
			{ error: "platform must be one of: facebook, instagram" },
			{ status: 400 },
		);
	}
	if (!account_id || typeof account_id !== "string") {
		return Response.json(
			{ error: "account_id is required and must be a string" },
			{ status: 400 },
		);
	}
	if (!account_name || typeof account_name !== "string") {
		return Response.json(
			{ error: "account_name is required and must be a string" },
			{ status: 400 },
		);
	}

	const tokenValue =
		typeof access_token === "string" ? access_token : "pending";

	try {
		const sql = getDb();
		// Revive a soft-deleted row if it exists (clears disconnected_at), else
		// insert a fresh placeholder. ON CONFLICT keeps conversation history.
		const [data] = await sql<AccountSelect[]>`
			INSERT INTO platform_accounts (platform, account_id, account_name, access_token)
			VALUES (${platform}, ${account_id}, ${account_name}, ${tokenValue})
			ON CONFLICT (platform, account_id) DO UPDATE
			SET account_name = EXCLUDED.account_name,
			    access_token = EXCLUDED.access_token,
			    disconnected_at = NULL
			RETURNING id, platform, account_id, account_name, access_token,
			          token_expires_at, created_at`;

		return Response.json(
			{
				data: {
					id: data.id,
					platform: data.platform,
					account_id: data.account_id,
					account_name: data.account_name,
					is_connected: isConnected(data.access_token),
					token_expires_at: data.token_expires_at,
					created_at: data.created_at,
				},
			},
			{ status: 201 },
		);
	} catch (err) {
		console.error("[Accounts POST] error:", err);
		return Response.json(
			{ error: "Failed to create account" },
			{ status: 500 },
		);
	}
}
