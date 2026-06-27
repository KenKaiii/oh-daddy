import type { NextRequest } from "next/server";

import { getAutomationById, listAutomations } from "@/lib/automations/queries";
import { getDb } from "@/lib/db";
import { createAutomationSchema } from "@/lib/schemas/automation";

export async function GET(request: NextRequest) {
	const accountId = request.nextUrl.searchParams.get("account_id");
	try {
		const data = await listAutomations(accountId);
		return Response.json({ data });
	} catch (err) {
		console.error("[Automations GET] error:", err);
		return Response.json(
			{ error: "Failed to load automations" },
			{ status: 500 },
		);
	}
}

export async function POST(request: NextRequest) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = createAutomationSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0].message },
			{ status: 400 },
		);
	}

	const keywords = parsed.data.keywords.map((k) => k.toLowerCase().trim());

	try {
		const sql = getDb();
		const [{ id }] = await sql<{ id: string }[]>`
			INSERT INTO comment_automations
				(platform_account_id, scope, name, keywords, fuzzy_threshold,
				 comment_replies, dm_message, dm_link, is_active)
			VALUES (
				${parsed.data.platform_account_id ?? null},
				${parsed.data.scope ?? null},
				${parsed.data.name.trim()},
				${keywords},
				${parsed.data.fuzzy_threshold},
				${parsed.data.comment_replies},
				${parsed.data.dm_message},
				${parsed.data.dm_link ?? null},
				${parsed.data.is_active}
			)
			RETURNING id`;

		const data = await getAutomationById(id);
		return Response.json({ data }, { status: 201 });
	} catch (err) {
		console.error("[Automations POST] error:", err);
		return Response.json(
			{ error: "Failed to create automation" },
			{ status: 500 },
		);
	}
}
