/**
 * Resolve the public base URL of this deployment from the incoming request.
 *
 * The OAuth redirect_uri must be byte-identical between the authorize step and
 * the token-exchange step, and it must match what the operator whitelisted in
 * the Meta App. Deriving it from the request host means it "just works" on any
 * domain (Railway, a custom domain, localhost, a tunnel) with no build-time
 * env var to keep in sync — the Settings page shows the same origin the browser
 * is on, so copy-paste into Meta always matches.
 *
 * Behind Railway's proxy the original host/scheme arrive in X-Forwarded-*; we
 * prefer those, then fall back to Host, then to NEXT_PUBLIC_APP_URL, then to
 * localhost for local dev. Meta independently enforces the redirect-URI
 * allowlist, so a spoofed Host header cannot redirect the flow off-domain.
 */
export function getRequestBaseUrl(request: Request): string {
	const headers = request.headers;

	const forwardedHost = headers.get("x-forwarded-host");
	const host = forwardedHost ?? headers.get("host");

	if (host) {
		const forwardedProto = headers.get("x-forwarded-proto");
		// Take the first proto if a comma-separated chain is present.
		const proto =
			forwardedProto?.split(",")[0]?.trim() ||
			(host.startsWith("localhost") || host.startsWith("127.0.0.1")
				? "http"
				: "https");
		return `${proto}://${host}`;
	}

	return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Build the OAuth redirect URI for this deployment from the request. */
export function getRedirectUri(request: Request): string {
	return `${getRequestBaseUrl(request)}/oauth/callback`;
}
