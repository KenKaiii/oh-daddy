import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/api-auth";
import {
	AUTOMATIONS_ENABLED_PROVIDER,
	getAutomationsEnabled,
} from "@/lib/automation-kill-switch";
import { getDb } from "@/lib/db";

/**
 * Global emergency stop for keyword automations. Non-secret, plain config —
 * unlike Meta credentials (`/api/settings`), this returns the actual value.
 */
export async function GET() {
	try {
		const enabled = await getAutomationsEnabled();
		return Response.json({ data: { enabled } });
	} catch (err) {
		console.error("[Settings automations-enabled GET] error:", err);
		return Response.json(
			{ error: "Failed to load automations kill switch" },
			{ status: 500 },
		);
	}
}

const putSchema = z.object({ enabled: z.boolean() });

export async function PUT(request: NextRequest) {
	const denied = requireOperator(request);
	if (denied) return denied;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = putSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0].message },
			{ status: 400 },
		);
	}

	try {
		const sql = getDb();
		await sql`
			INSERT INTO settings (provider, value, updated_at)
			VALUES (${AUTOMATIONS_ENABLED_PROVIDER}, ${String(parsed.data.enabled)}, now())
			ON CONFLICT (provider) DO UPDATE
			SET value = EXCLUDED.value, updated_at = now()`;
		return Response.json({ data: { enabled: parsed.data.enabled } });
	} catch (err) {
		console.error("[Settings automations-enabled PUT] error:", err);
		return Response.json(
			{ error: "Failed to save automations kill switch" },
			{ status: 500 },
		);
	}
}
