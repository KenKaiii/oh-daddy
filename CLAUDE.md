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

## Architecture
- **Core flow:** `api/webhooks/meta` (HMAC-verifies, logs to `webhook_events`, enqueues `comment/process` with a dedup id) → `src/inngest/functions/process-comment.ts` (only Inngest function: ingest contact/conversation/message, skip own/empty comments) → `src/lib/automations/run-automation.ts` (keyword match, 24h per-contact cooldown, **claims `automation_matches` row before any Meta API call** for safe retries, then public reply + Private Replies DM).
- **Platform calls:** `src/lib/platforms/` adapters (`getAdapter`); discovery + token storage in `meta-discovery.ts`.
- **DB:** `getDb()` from `src/lib/db.ts` (lazy single pool). 8 tables + row types hand-written in `src/types/db.ts`. Unique-violation = code `23505`.

## Project-specific constraints
- **Auth:** every `/api/*` is gated by `src/proxy.ts` (Next 16's renamed middleware), fails closed (503) without `ADMIN_PASSWORD`. Exempt + self-verifying: `/api/webhooks/meta`, `/api/oauth/callback`, `/api/inngest`, `/api/auth/login`. Destructive routes also call `requireOperator` from `src/lib/api-auth.ts`. Auth logic in `src/lib/auth.ts` must stay dependency-free (only `node:crypto`) since `proxy.ts` imports it.
- **Secrets at rest:** `src/lib/crypto.ts` does AES-256-GCM envelope encryption (`enc:v1:<base64(iv|tag|ciphertext)>`) keyed by `APP_ENCRYPTION_KEY`. Access tokens (`encryptToken`) and DB settings values (`encryptSecret`) are encrypted; decrypt only at point-of-use in memory — Inngest step state stores the encrypted blob, never plaintext. `db/encrypt-existing-secrets.mjs` duplicates this format and must stay in lockstep.
- **Token sentinels** (`""`, `"pending"`, `mock-*`) are stored verbatim, not encrypted — SQL literal comparisons in `meta-discovery.ts`/`api/stats` depend on this.
- **Env-only, never in DB**: `ADMIN_PASSWORD`, `APP_ENCRYPTION_KEY`. All four Meta credentials (`meta_app_id`, `meta_app_secret`, `meta_config_id`, `meta_webhook_verify_token`) may be DB-stored (encrypted, set via the Settings UI) or env. `getSettingsKey` resolves DB-first then env. `PUT /api/settings` is operator-gated (`requireOperator`) so only the authenticated operator can write secrets.
- **`dm_link`** is host-allowlisted via `DM_LINK_ALLOWED_HOSTS` (BP-002, `src/lib/schemas/automation.ts`) — auto-sent DMs would otherwise be a phishing relay.
- **Inngest is self-hosted in prod** (not Inngest Cloud): unset `INNGEST_DEV`, set `INNGEST_BASE_URL` + matching `INNGEST_SIGNING_KEY`/`INNGEST_EVENT_KEY`.
- No test suite exists.
