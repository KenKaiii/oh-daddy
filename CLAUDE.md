@AGENTS.md

# oh-daddy

Single-operator admin tool that connects Meta (Facebook Pages + Instagram) accounts, ingests comment webhooks, and runs keyword automations that post a public reply + a private DM to the commenter.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · raw `postgres` (porsager, no ORM) · Inngest 4 (self-hosted) · Zod 4 · Tailwind v4 · Biome 2.5 · npm.

## Commands
- `npm run dev` — Next + a local Inngest dev server together (via `concurrently`). `npm run dev:next` for Next only.
- `npm run check` — Biome lint+format with `--write` (the project's fix-all). `npm run lint` is check-only.
- `npm run db:push` — apply `db/schema.sql` to `$DATABASE_URL` via `psql` (no migration tool; schema is one idempotent file).
- `npm run db:encrypt-secrets` — one-time `db/encrypt-existing-secrets.mjs`: encrypt any pre-existing plaintext rows.
- Deploy: `scripts/railway-setup.sh` (idempotent Railway provisioning) — see README §5 / `.gg/commands/setup-railway.md`.
- Start command is `scripts/start.sh` (wired via `railway.json` → `deploy.startCommand`), NOT `npm run start` directly: it backgrounds `scripts/post-deploy-sync.mjs` (re-syncs Inngest on every deploy), then `exec`s `npm run start`.

## Architecture
- **Core flow:** `api/webhooks/meta` (HMAC-verifies, logs to `webhook_events`, enqueues `comment/process` with a dedup id) → `src/inngest/functions/process-comment.ts` (real-time contact/conversation/message ingestion, skip own/empty comments, fan out matches) → `src/inngest/functions/automation-send.ts` (optional delay + throttled delivery) → `src/lib/automations/run-automation.ts` (keyword match, 24h per-contact cooldown, **claims `automation_matches` row before any Meta API call** for safe retries, then public reply + Private Replies DM).
- **Platform calls:** `src/lib/platforms/` adapters (`getAdapter`); discovery + token storage in `meta-discovery.ts`.
- **DB:** `getDb()` from `src/lib/db.ts` (lazy single pool). 8 tables + row types hand-written in `src/types/db.ts`. Unique-violation = code `23505`.

## Project-specific constraints
- **Auth:** every `/api/*` is gated by `src/proxy.ts` (Next 16's renamed middleware), fails closed (503) without `ADMIN_PASSWORD`. Exempt + self-verifying: `/api/webhooks/meta`, `/api/oauth/callback`, `/api/inngest`, `/api/auth/login`. Destructive routes also call `requireOperator` from `src/lib/api-auth.ts`. Auth logic in `src/lib/auth.ts` must stay dependency-free (only `node:crypto`) since `proxy.ts` imports it.
- **Secrets at rest:** `src/lib/crypto.ts` does AES-256-GCM envelope encryption (`enc:v1:<base64(iv|tag|ciphertext)>`) keyed by `APP_ENCRYPTION_KEY`. Access tokens (`encryptToken`) and DB settings values (`encryptSecret`) are encrypted; decrypt only at point-of-use in memory — Inngest step state stores the encrypted blob, never plaintext. `db/encrypt-existing-secrets.mjs` duplicates this format and must stay in lockstep.
- **Token sentinels** (`""`, `"pending"`, `mock-*`) are stored verbatim, not encrypted — SQL literal comparisons in `meta-discovery.ts`/`api/stats` depend on this.
- **Env-only, never in DB**: `ADMIN_PASSWORD`, `APP_ENCRYPTION_KEY`. All four Meta credentials (`meta_app_id`, `meta_app_secret`, `meta_config_id`, `meta_webhook_verify_token`) may be DB-stored (encrypted, set via the Settings UI) or env. `getSettingsKey` resolves DB-first then env. `PUT /api/settings` is operator-gated (`requireOperator`) so only the authenticated operator can write secrets.
- **Per-post targeting:** an account-specific automation may set `comment_automations.platform_post_id` (NULL = all posts on the account). `loadAutomations` filters to `platform_post_id IS NULL OR = <comment post id>`, post-specific first. The DM body is sent verbatim — any link lives inside `dm_message`.
- **Inngest is self-hosted in prod** (not Inngest Cloud): unset `INNGEST_DEV`, set `INNGEST_BASE_URL` + matching `INNGEST_SIGNING_KEY`/`INNGEST_EVENT_KEY`. Self-hosted Inngest does NOT auto-discover function changes on deploy — the engine keeps the prior registration until the app re-registers, so a newly added function (e.g. `automation-send`) silently won't run. The start command (`scripts/start.sh` → `scripts/post-deploy-sync.mjs`) auto-`PUT`s the public `NEXT_PUBLIC_APP_URL/api/inngest` on every deploy to re-sync; never register via localhost, because the separate engine will call itself. Manual nudge: `curl -X PUT https://<app>/api/inngest`. Verify on the engine: `POST <engine>/v0/gql {"query":"{ functions { name slug } }"}`.
- Tests: `npm run test` (unit, mocked DB) + `npm run test:integration` (real Postgres via Docker, `src/test/pg.ts`).

## Railway (deployment target)
This project is designed to be deployed on Railway, and Railway is the source of truth for what's actually running — use the `railway` CLI (not just reading local files) whenever asked about deploy status, logs, env vars, or prod behavior.
- CLI must be linked to this project (`railway link` if `railway status` fails) before other commands work; if the CLI itself is missing, install it (`brew install railway` or the official install script) and have the user run `railway login` (browser auth — you can't do it headlessly).
- Logs: `railway logs` (app service) — check here first for prod errors, webhook failures, Inngest sync issues.
- Env vars: `railway variables` to list/inspect; `railway variables --set KEY=VALUE` to set. There are two services (app + self-hosted Inngest) — pass `--service` when ambiguous.
- Redeploy/status: `railway up` to deploy from local, `railway status` for current deployment state.
- Provisioning is idempotent via `scripts/railway-setup.sh` — re-run it rather than clicking around the dashboard when infra needs to change (new service, missing var, etc.).
