import type { NextRequest } from "next/server";

import { isAuthorized, SESSION_COOKIE } from "@/lib/auth";

/**
 * Defense-in-depth authorization for mutating/destructive API route handlers.
 *
 * The primary control is the `/api/*` proxy gate (`src/proxy.ts`, finding
 * BP-001). Destructive routes ALSO re-assert the operator session/bearer here,
 * so a future proxy-matcher regression cannot silently re-expose them to
 * anonymous callers (finding BP-002).
 *
 * Single-tenant model: there is exactly one operator (the shared secret) who
 * owns every platform account and automation. A valid operator session IS the
 * ownership check — the path `id` is therefore never trusted on its own to
 * authorize a delete/update.
 *
 * Returns a 401 `Response` to short-circuit the handler, or `null` when the
 * caller is the authenticated operator and the handler may proceed.
 */
export function requireOperator(request: NextRequest): Response | null {
	const authHeader = request.headers.get("authorization");
	const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
	if (!isAuthorized(authHeader, cookieValue)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	return null;
}
