import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/api-auth";
import {
	clampDelayMax,
	DELAY_MAX_CEILING,
	DELAY_MAX_PROVIDER,
	DELAY_MIN_SECONDS,
	getDelayMaxSeconds,
} from "@/lib/automation-delay";
import { getDb } from "@/lib/db";

/**
 * Smart-delay window config. Unlike Meta credentials this is non-secret, plain
 * config — so it has its own endpoint that returns the actual value (the secret
 * /api/settings endpoint never returns values). The lower bound is fixed; only
 * the ceiling is operator-configurable.
 */
export async function GET() {
	try {
		const max = await getDelayMaxSeconds();
		return Response.json({
			data: { min: DELAY_MIN_SECONDS, max, ceiling: DELAY_MAX_CEILING },
		});
	} catch (err) {
		console.error("[Settings delay GET] error:", err);
		return Response.json(
			{ error: "Failed to load delay settings" },
			{ status: 500 },
		);
	}
}

const putSchema = z.object({
	max: z.number().int().min(DELAY_MIN_SECONDS).max(DELAY_MAX_CEILING),
});

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

	const max = clampDelayMax(parsed.data.max);
	try {
		const sql = getDb();
		await sql`
			INSERT INTO settings (provider, value, updated_at)
			VALUES (${DELAY_MAX_PROVIDER}, ${String(max)}, now())
			ON CONFLICT (provider) DO UPDATE
			SET value = EXCLUDED.value, updated_at = now()`;
		return Response.json({ data: { min: DELAY_MIN_SECONDS, max } });
	} catch (err) {
		console.error("[Settings delay PUT] error:", err);
		return Response.json(
			{ error: "Failed to save delay settings" },
			{ status: 500 },
		);
	}
}
