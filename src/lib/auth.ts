/**
 * Shared-secret auth for the admin dashboard + its API routes.
 *
 * Every `/api/*` route (except the externally-reachable, independently-verified
 * webhook / OAuth callback / Inngest endpoints) is gated in `src/proxy.ts`. A
 * caller proves they are the operator in one of two ways:
 *
 *   1. Browser dashboard → an httpOnly session cookie set by `POST /api/auth/login`.
 *   2. Programmatic / curl → an `Authorization: Bearer <secret>` header.
 *
 * Both are compared to the configured secret in constant time. The secret lives
 * ONLY in the environment (`ADMIN_PASSWORD`); it is never written to or read
 * from the database, so it cannot be overwritten over HTTP.
 *
 * This module is intentionally dependency-free (only `node:crypto`) so it is
 * safe to import from `proxy.ts`, which runs in the Node.js runtime.
 */
import crypto from "node:crypto";

/** Name of the httpOnly session cookie set after a successful login. */
export const SESSION_COOKIE = "oh_daddy_session";

/** How long a dashboard session stays valid (7 days). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * The operator's shared secret, sourced exclusively from the environment.
 * Returns null when unset so callers can fail closed.
 */
export function getAuthSecret(): string | null {
	const secret = process.env.ADMIN_PASSWORD;
	return secret?.trim() ? secret : null;
}

/**
 * Constant-time string comparison. Both inputs are hashed first so that
 * differing lengths neither throw nor leak via early return.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
	const ha = crypto.createHash("sha256").update(a).digest();
	const hb = crypto.createHash("sha256").update(b).digest();
	return crypto.timingSafeEqual(ha, hb);
}

/**
 * Derive the opaque session-cookie value from the secret. The raw secret is
 * never placed in the cookie — only this HMAC of it — so a leaked cookie does
 * not expose the bearer token used for programmatic API access.
 */
export function sessionTokenFor(secret: string): string {
	return crypto
		.createHmac("sha256", secret)
		.update("oh-daddy:dashboard-session:v1")
		.digest("hex");
}

/**
 * Decide whether a request is authorized, given its `Authorization` header and
 * session-cookie value. Fails closed when no secret is configured.
 */
export function isAuthorized(
	authHeader: string | null,
	cookieValue: string | undefined,
): boolean {
	const secret = getAuthSecret();
	if (!secret) return false;

	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.slice("Bearer ".length).trim();
		if (token && timingSafeEqualStr(token, secret)) return true;
	}

	if (cookieValue && timingSafeEqualStr(cookieValue, sessionTokenFor(secret))) {
		return true;
	}

	return false;
}
