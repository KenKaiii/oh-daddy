import { z } from "zod";

import { getDb } from "@/lib/db";
import { SETTINGS_PROVIDERS } from "@/lib/settings";

const providerEnum = z.enum(SETTINGS_PROVIDERS);

// GET — list each provider and whether it's set (DB or env). Never returns
// the secret value itself.
export async function GET() {
	let rows: { provider: string; value: string; updated_at: string }[] = [];
	try {
		const sql = getDb();
		rows = await sql<{ provider: string; value: string; updated_at: string }[]>`
			SELECT provider, value, updated_at FROM settings`;
	} catch (err) {
		console.error("[Settings GET] error:", err);
		return Response.json({ error: "Failed to load settings" }, { status: 500 });
	}

	const dbByProvider = new Map(rows.map((r) => [r.provider, r] as const));

	const result = SETTINGS_PROVIDERS.map((provider) => {
		const row = dbByProvider.get(provider);
		const envVar = provider.toUpperCase();
		const fromEnv = !!process.env[envVar]?.trim();
		const fromDb = !!row?.value?.trim();
		return {
			provider,
			is_set: fromDb || fromEnv,
			source: fromDb ? "db" : fromEnv ? "env" : null,
			updated_at: row?.updated_at ?? null,
		};
	});

	return Response.json({ data: result });
}

const putSchema = z.object({
	settings: z.array(z.object({ provider: providerEnum, value: z.string() })),
});

// PUT — upsert provider/value pairs. Empty value deletes the row (falls back
// to env).
export async function PUT(request: Request) {
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
		for (const { provider, value } of parsed.data.settings) {
			if (value.trim() === "") {
				await sql`DELETE FROM settings WHERE provider = ${provider}`;
			} else {
				await sql`
					INSERT INTO settings (provider, value, updated_at)
					VALUES (${provider}, ${value.trim()}, now())
					ON CONFLICT (provider) DO UPDATE
					SET value = EXCLUDED.value, updated_at = now()`;
			}
		}
	} catch (err) {
		console.error("[Settings PUT] error:", err);
		return Response.json({ error: "Failed to save settings" }, { status: 500 });
	}

	return Response.json({ success: true });
}
