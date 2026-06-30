import type { NextRequest } from "next/server";

import { requireOperator } from "@/lib/api-auth";
import { getAutomationById } from "@/lib/automations/queries";
import { getDb } from "@/lib/db";
import { updateAutomationSchema } from "@/lib/schemas/automation";
import type { CommentAutomationRow } from "@/types/db";

export async function PATCH(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const denied = requireOperator(request);
	if (denied) return denied;

	const { id } = await params;
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = updateAutomationSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0].message },
			{ status: 400 },
		);
	}

	const updates: Partial<CommentAutomationRow> = {};
	const d = parsed.data;
	if (d.name !== undefined) updates.name = d.name.trim();
	if (d.keywords !== undefined)
		updates.keywords = d.keywords.map((k) => k.toLowerCase().trim());
	if (d.fuzzy_threshold !== undefined)
		updates.fuzzy_threshold = d.fuzzy_threshold;
	if (d.comment_replies !== undefined)
		updates.comment_replies = d.comment_replies;
	if (d.dm_message !== undefined) updates.dm_message = d.dm_message;
	if (d.is_active !== undefined) updates.is_active = d.is_active;
	// When swapping the target the XOR constraint requires both fields set
	// together (the form sends both).
	if (d.platform_account_id !== undefined)
		updates.platform_account_id = d.platform_account_id;
	if (d.scope !== undefined) updates.scope = d.scope;
	// Per-post targeting is account-specific; a scope target forces it null.
	if (d.platform_post_id !== undefined)
		updates.platform_post_id =
			d.scope != null ? null : (d.platform_post_id ?? null);

	if (Object.keys(updates).length === 0) {
		return Response.json({ error: "No fields to update" }, { status: 400 });
	}

	try {
		const sql = getDb();
		const rows = await sql`
			UPDATE comment_automations SET ${sql(updates)} WHERE id = ${id} RETURNING id`;
		if (rows.length === 0) {
			return Response.json({ error: "Automation not found" }, { status: 404 });
		}
		const data = await getAutomationById(id);
		return Response.json({ data });
	} catch (err) {
		console.error("[Automations PATCH] error:", err);
		return Response.json(
			{ error: "Failed to update automation" },
			{ status: 500 },
		);
	}
}

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const denied = requireOperator(request);
	if (denied) return denied;

	const { id } = await params;
	try {
		const sql = getDb();
		await sql`DELETE FROM comment_automations WHERE id = ${id}`;
		return Response.json({ success: true });
	} catch (err) {
		console.error("[Automations DELETE] error:", err);
		return Response.json(
			{ error: "Failed to delete automation" },
			{ status: 500 },
		);
	}
}
