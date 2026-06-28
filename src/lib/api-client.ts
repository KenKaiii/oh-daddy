/**
 * Browser fetch wrapper for same-origin `/api/*` calls.
 *
 * The `src/proxy.ts` gate returns 401 when the dashboard session cookie is
 * missing or expired. This helper intercepts that and bounces the operator to
 * the login page (preserving where they were), so pages don't get stuck showing
 * raw "Unauthorized" errors.
 */
export async function apiFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const res = await fetch(input, init);
	if (res.status === 401 && typeof window !== "undefined") {
		const next = encodeURIComponent(
			window.location.pathname + window.location.search,
		);
		window.location.href = `/login?next=${next}`;
	}
	return res;
}
