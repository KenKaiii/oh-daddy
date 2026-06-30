import type { NextRequest } from "next/server";

import { requireOperator } from "@/lib/api-auth";
import { decryptToken } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { getAdapter } from "@/lib/platforms";
import type { PlatformAccountRow } from "@/types/db";

type AccountSelect = Pick<
	PlatformAccountRow,
	"id" | "platform" | "account_id" | "access_token" | "disconnected_at"
>;

function isConnected(token: string | null): boolean {
	return (
		!!token && token !== "pending" && token !== "" && !token.startsWith("mock-")
	);
}

/**
 * List recent posts on a connected account for the per-post automation picker.
 * Operator-gated. The account is loaded by our UUID; the Meta-side `account_id`
 * is used only internally to call the Graph API and is never returned.
 *
 * Graph errors degrade to an empty list so the automation form keeps working
 * (the operator can still leave the automation targeting "All posts").
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const denied = requireOperator(request);
	if (denied) return denied;

	const { id } = await params;
	try {
		const sql = getDb();
		const [account] = await sql<AccountSelect[]>`
			SELECT id, platform, account_id, access_token, disconnected_at
			FROM platform_accounts
			WHERE id = ${id}`;

		if (!account || account.disconnected_at !== null) {
			return Response.json({ error: "Account not found" }, { status: 404 });
		}
		if (!isConnected(account.access_token)) {
			return Response.json({ data: [] });
		}

		try {
			const token = decryptToken(account.access_token);
			const posts = await getAdapter(account.platform).listPosts(
				token,
				account.account_id,
			);
			return Response.json({ data: posts });
		} catch (err) {
			console.error("[Accounts posts GET] graph error:", err);
			return Response.json({ data: [] });
		}
	} catch (err) {
		console.error("[Accounts posts GET] error:", err);
		return Response.json({ error: "Failed to fetch posts" }, { status: 500 });
	}
}
