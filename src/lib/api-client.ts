/**
 * Browser fetch wrapper for same-origin `/api/*` calls.
 *
 * The `src/proxy.ts` gate returns 401 when the dashboard session cookie is
 * missing or expired. This helper intercepts that and bounces the operator to
 * the login page, so pages don't get stuck showing raw "Unauthorized" errors.
 * After login the operator always lands on the dashboard.
 */
export async function apiFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const res = await fetch(input, init);
	if (res.status === 401 && typeof window !== "undefined") {
		window.location.href = "/login";
	}
	return res;
}
