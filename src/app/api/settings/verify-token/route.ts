import type { NextRequest } from "next/server";

import { requireOperator } from "@/lib/api-auth";
import { getSettingsKey } from "@/lib/settings";

// GET — reveal the current webhook verify token to the authenticated operator.
//
// Unlike the generic `GET /api/settings` (which only reports is_set and NEVER
// returns secret values), this returns the decrypted value for one specific,
// low-sensitivity credential: the webhook verify token. It's a shared handshake
// string the operator must paste into Meta for BOTH the Instagram and Page
// webhook subscriptions — not the HMAC-signing app secret. Surfacing it lets the
// setup wizard re-copy the saved token across page reloads instead of forcing a
// regenerate (which would break any webhook already registered with the old
// value). Operator-gated (proxy + requireOperator); never exposes app_secret.
export async function GET(request: NextRequest) {
	const denied = requireOperator(request);
	if (denied) return denied;

	try {
		const value = await getSettingsKey("meta_webhook_verify_token");
		return Response.json({ value: value ?? null });
	} catch (err) {
		console.error("[Settings verify-token GET] error:", err);
		return Response.json(
			{ error: "Failed to load verify token" },
			{ status: 500 },
		);
	}
}
