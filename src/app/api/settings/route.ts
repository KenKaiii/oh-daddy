import { z } from "zod";

import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import {
	ENV_FALLBACK,
	isEnvOnlyProvider,
	SETTINGS_PROVIDERS,
} from "@/lib/settings";

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
		const envVar = ENV_FALLBACK[provider] ?? provider.toUpperCase();
		const fromEnv = !!process.env[envVar]?.trim();
		const envOnly = isEnvOnlyProvider(provider);
		// Env-only providers ignore any DB row entirely (see getSettingsKey).
		const fromDb = !envOnly && !!row?.value?.trim();
		return {
			provider,
			is_set: fromDb || fromEnv,
			source: fromDb ? "db" : fromEnv ? "env" : null,
			env_only: envOnly,
			env_var: envVar,
			updated_at: envOnly ? null : (row?.updated_at ?? null),
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

	// Integrity-gating secrets must never be writable over HTTP — they live in
	// the environment only. Reject the whole request if any is present.
	const envOnly = parsed.data.settings.find((s) =>
		isEnvOnlyProvider(s.provider),
	);
	if (envOnly) {
		return Response.json(
			{
				error: `${envOnly.provider} is managed via the ${
					ENV_FALLBACK[envOnly.provider] ?? envOnly.provider.toUpperCase()
				} environment variable and cannot be set here.`,
			},
			{ status: 403 },
		);
	}

	try {
		const sql = getDb();
		for (const { provider, value } of parsed.data.settings) {
			if (value.trim() === "") {
				await sql`DELETE FROM settings WHERE provider = ${provider}`;
			} else {
				// Encrypt at rest so a DB read never yields the raw value.
				const encrypted = encryptSecret(value.trim());
				await sql`
					INSERT INTO settings (provider, value, updated_at)
					VALUES (${provider}, ${encrypted}, now())
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
