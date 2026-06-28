/**
 * Request gate for every `/api/*` route (Next.js 16 "proxy" — the renamed
 * `middleware` file convention; runs in the Node.js runtime).
 *
 * Without this, every API route was anonymous. The critical consequence was
 * that anyone could `PUT /api/settings` to overwrite `meta_app_secret`, then
 * forge a validly-signed webhook and drive the victim's connected Meta account.
 *
 * Default: require the operator's shared secret (session cookie or bearer
 * token), compared in constant time — see `src/lib/auth.ts`.
 *
 * Exemptions (each must be internet-reachable AND carries its own verification):
 *   - /api/webhooks/meta   → HMAC `x-hub-signature-256` keyed on
 *                            `meta_app_secret` (verified in the route).
 *   - /api/oauth/callback  → one-time, server-generated `oauth_state` CSRF token;
 *                            that state can only be minted by the now-gated
 *                            `POST /api/oauth/authorize`.
 *   - /api/inngest         → Inngest's own request-signature verification; must
 *                            be callable by the external Inngest service.
 *   - /api/auth/login      → how a browser obtains the session cookie itself.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAuthSecret, isAuthorized, SESSION_COOKIE } from "@/lib/auth";

const EXEMPT_PREFIXES = [
	"/api/webhooks/meta",
	"/api/oauth/callback",
	"/api/inngest",
	"/api/auth/login",
];

function isExempt(pathname: string): boolean {
	return EXEMPT_PREFIXES.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);
}

export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (isExempt(pathname)) return NextResponse.next();

	// Fail closed: if the operator hasn't configured a secret, no protected API
	// is reachable. (The exempt, independently-verified endpoints above still
	// work, so webhooks/OAuth/queue keep functioning.)
	if (!getAuthSecret()) {
		return Response.json(
			{
				error:
					"Server auth is not configured. Set ADMIN_PASSWORD in the environment.",
			},
			{ status: 503 },
		);
	}

	const authHeader = request.headers.get("authorization");
	const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;

	if (!isAuthorized(authHeader, cookieValue)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	return NextResponse.next();
}

export const config = {
	matcher: "/api/:path*",
};
