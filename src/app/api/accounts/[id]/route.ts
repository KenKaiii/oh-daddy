import type { NextRequest } from "next/server";

import { requireOperator } from "@/lib/api-auth";
import { getDb } from "@/lib/db";

// Soft delete. Hard-deleting a platform_account would CASCADE-delete every
// conversation / message tied to it. Instead we mark `disconnected_at = now()`
// and blank the token; the /accounts listing filters disconnected rows out and
// reconnecting the same (platform, account_id) revives the row.
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const denied = requireOperator(request);
	if (denied) return denied;

	const { id } = await params;
	try {
		const sql = getDb();
		await sql`
			UPDATE platform_accounts
			SET disconnected_at = now(), access_token = ''
			WHERE id = ${id}`;
		return new Response(null, { status: 204 });
	} catch (err) {
		console.error("[Accounts DELETE] error:", err);
		return Response.json({ error: "Failed to disconnect" }, { status: 500 });
	}
}
