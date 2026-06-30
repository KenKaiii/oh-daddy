/**
 * Post-deploy Inngest re-sync.
 *
 * Self-hosted Inngest does NOT auto-discover function changes on each Railway
 * deploy (unlike Inngest Cloud). After a deploy that adds, removes, or retunes
 * a function, the engine keeps the PREVIOUS registration until the app
 * re-registers — so a new function silently never runs. This is the
 * `automation-send`-missing-in-prod bug.
 *
 * This runs from the start command (see scripts/start.sh, wired via
 * railway.json -> deploy.startCommand) on EVERY deploy, whether triggered by a
 * GitHub push or `railway up`. It waits for THIS freshly-started container to
 * begin serving, then sends `PUT /api/inngest`, which makes the Inngest SDK
 * register the current function list with the engine at INNGEST_BASE_URL.
 *
 * Best-effort by design: it never throws and always exits 0, so a transient
 * sync failure can never fail the deploy (the app still serves; a later deploy
 * or a manual `curl -X PUT .../api/inngest` re-syncs).
 *
 * Skipped entirely when INNGEST_BASE_URL is unset (e.g. a plain local
 * `npm run start` with no self-hosted engine to register against).
 */

const baseUrl = process.env.INNGEST_BASE_URL;
if (!baseUrl) {
	// No self-hosted engine configured — nothing to re-sync.
	process.exit(0);
}

const port = process.env.PORT || "3000";
const endpoint = `http://127.0.0.1:${port}/api/inngest`;
const DEADLINE = Date.now() + 180_000; // up to 3 min for the app to come up

/**
 * Any HTTP response means Next is serving. `GET /api/inngest` returns 401 in
 * self-hosted mode (no signing key on the query) — that still proves the app is
 * reachable, which is all we need before issuing the PUT.
 */
async function reachable() {
	try {
		await fetch(endpoint, { method: "GET" });
		return true;
	} catch {
		return false;
	}
}

while (Date.now() < DEADLINE) {
	if (await reachable()) {
		try {
			const res = await fetch(endpoint, { method: "PUT" });
			const body = (await res.text().catch(() => "")).slice(0, 200);
			console.log(`[inngest-sync] PUT ${endpoint} -> ${res.status} ${body}`);
		} catch (err) {
			console.error(
				`[inngest-sync] PUT failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		process.exit(0);
	}
	await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.error(
	"[inngest-sync] app did not become reachable in time; skipping re-sync",
);
process.exit(0);
