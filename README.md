# oh-daddy — keyword automations (Meta only)

A minimal ManyChat-style tool: when someone comments a **keyword** on your
Instagram or Facebook post, it posts a **public reply** and sends an
**auto-DM** (via Meta Private Replies). Instagram + Facebook only — no AI, no
other platforms.

Four pages: **Dashboard** (stats), **Automations** (keyword rules), **Accounts**
(connect Meta via OAuth), **Settings** (Meta credentials + webhook config).

## Stack

- **Next.js 16** (App Router, Turbopack)
- **Postgres** (via the `postgres` driver; single pool in `src/lib/db.ts`)
- **Inngest** (durable queue for processing comments)
- **Tailwind v4** + hand-rolled UI primitives, **Biome** lint/format
- **zod** validation

## How a comment flows

```
Meta webhook → POST /api/webhooks/meta
  → verify x-hub-signature-256 (HMAC of raw body w/ meta_app_secret)
  → filter to real comment add/edit events
  → inngest.send("comment/process")  → return 200 fast

Inngest process-comment:
  STEP ingest        → normalize, upsert contact/conversation/message (dedup)
  STEP run-automation → match keyword → dedup → 24h cooldown
                      → CLAIM automation_matches row BEFORE posting (idempotency)
                      → post rotated public reply (Graph API)
                      → send Private Reply DM (bypasses the 24h window)
                      → persist both as assistant messages
```

The dedup gate is the unique index `(automation_id, message_id)`. The claim row
is inserted **before** any external API call so webhook/Inngest retries can't
double-post. If the public reply itself throws, the claim is rolled back so the
next delivery retries.

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` → `.env.local` and fill in:

```
DATABASE_URL=postgresql://postgres@localhost:5432/oh_daddy
NEXT_PUBLIC_APP_URL=http://localhost:3000
INNGEST_DEV=1                    # local dev: use the local Inngest dev server
APP_ENCRYPTION_KEY=              # 32-byte base64 key: openssl rand -base64 32

# Meta creds: set here OR via the Settings page (DB wins, env is fallback)
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=       # any random string you choose
META_CONFIG_ID=                  # optional: Facebook Login for Business
```

### 3. Database

Point `DATABASE_URL` at any Postgres instance, then apply `db/schema.sql`
(8 tables + `update_updated_at` trigger):

```bash
npm run db:push          # runs: psql "$DATABASE_URL" -f db/schema.sql
```

Sensitive values are **encrypted at rest** (AES-256-GCM) using
`APP_ENCRYPTION_KEY`: `platform_accounts.access_token` (live Meta tokens) and
any DB-stored Settings values. A DB read (backup leak, leaked `DATABASE_URL`,
raw SQL) never yields live credentials directly. If you have pre-existing
plaintext rows from an older deploy, encrypt them in place once (idempotent;
skips sentinels/already-encrypted rows):

```bash
# Local: reads DATABASE_URL + APP_ENCRYPTION_KEY from your shell/.env.local
npm run db:encrypt-secrets

# Railway: run with the deployed service's env injected (so it targets the
# live DB with the live key). Run from a local checkout via the Railway CLI:
railway run npm run db:encrypt-secrets
```

A fresh deploy with no prior plaintext rows can skip this entirely.

Or with Docker for a throwaway local DB:

```bash
docker run -d --name oh-daddy-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=oh_daddy postgres:16-alpine
```

### 4. Run

```bash
npm run dev
```

### 5. Deploy (Railway)

**Seamless path:** run the `/setup-railway` agent command (or directly:
`META_APP_ID=… META_APP_SECRET=… bash scripts/railway-setup.sh`). It provisions
Postgres, generates the at-rest secrets, provisions a **self-hosted Inngest**
server and wires the app to it, wires `DATABASE_URL`, mints a domain, deploys,
applies the schema, and syncs Inngest functions — asking you only for the Meta
app credentials. It is idempotent and never rotates an existing
`APP_ENCRYPTION_KEY`. Prereqs: `railway login` (browser auth, one time), and
`RAILWAY_WORKSPACE` only if your account has more than one workspace.

**Manual path:** set every value from `.env.example` as a **service variable**
in the Railway dashboard (Settings -> Variables) or via `railway variable set`.
In particular:

- `APP_ENCRYPTION_KEY` -> `openssl rand -base64 32`. Set it **once, before the
  first token is written**, and never change it: rotating or losing it makes
  every previously-encrypted row undecryptable (you'd have to reconnect each
  Meta account to re-issue tokens). Railway persists variables across deploys,
  so a redeploy alone is safe. It is read lazily at runtime, so `next build`
  succeeds even if it's unset at build time.
- `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `ADMIN_PASSWORD`,
  `DATABASE_URL` -> Railway-managed; never committed.
- **Self-hosted Inngest:** remove `INNGEST_DEV`, run a self-hosted `inngest`
  server (e.g. the "Inngest Production Template"), and set `INNGEST_BASE_URL`,
  `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` to match it (the setup script wires
  these as cross-service references). Not Inngest Cloud.

Apply the schema against the Railway database once using the DB's public proxy
URL (`psql "$DATABASE_PUBLIC_URL" -f db/schema.sql`), then run the encrypt
migration above only if the DB already holds
plaintext rows from an earlier deploy.

This starts **Next.js** (`localhost:3000`) and the **Inngest dev server**
together (via `concurrently`). The Inngest dev UI is at `localhost:8288`.

To run only Next.js: `npm run dev:next`.

## Meta App configuration (manual, external)

This can't be automated — do it in the [Meta App dashboard](https://developers.facebook.com/apps):

1. **Save credentials** in **Settings** (or `.env.local`): App ID, App Secret,
   Webhook Verify Token.
2. **OAuth redirect URI:** add `<NEXT_PUBLIC_APP_URL>/oauth/callback` to your
   app's valid OAuth redirect URIs.
3. **Scopes** (granted on connect): `pages_show_list`,
   `pages_manage_engagement`, `pages_manage_metadata`,
   `pages_read_user_content`, `pages_messaging`, `business_management`,
   `instagram_basic`, `instagram_manage_comments`,
   `instagram_manage_messages`. (Or use a Facebook Login for Business
   `config_id`.)
4. **Webhooks:** set the callback URL to `<public-url>/api/webhooks/meta` and
   the verify token to your `META_WEBHOOK_VERIFY_TOKEN`. Subscribe fields:
   - Facebook Page: `feed`, `messages`
   - Instagram: `comments`, `messages`

   Page/IG webhook subscriptions are auto-created on connect (see
   `meta-discovery.ts`).

### Public URL for webhooks (dev)

Meta needs a public HTTPS URL to deliver webhooks. For local dev, tunnel
port 3000:

```bash
ngrok http 3000
```

Use the `https://…ngrok…` URL as both `NEXT_PUBLIC_APP_URL` and the webhook
callback base.

## End-to-end test

1. **Accounts** → *Connect Meta* → complete OAuth → Pages + linked IG accounts
   appear as connected.
2. **Automations** → *New automation*: add keyword(s), a public reply variant,
   and a DM message + link. Save.
3. Post a matching comment on one of your posts (or simulate a webhook with a
   valid HMAC signature).
4. Confirm: **one** public reply + **one** DM are sent. A duplicate webhook
   delivery does **not** double-post (claim-row dedup). Dashboard counts
   increment.

## Admin auth

Every `/api/*` route is gated by `src/proxy.ts` (Next.js 16's renamed
`middleware`). Set a shared secret in the environment:

```
ADMIN_PASSWORD=some-long-random-string
```

- **Browser:** visit `/login`, enter the password — you get an httpOnly session
  cookie and the dashboard works as normal.
- **Programmatic:** send `Authorization: Bearer <ADMIN_PASSWORD>`.

Both are compared in constant time (`crypto.timingSafeEqual`). If
`ADMIN_PASSWORD` is unset, protected API routes return **503** (fail closed).

**Exempt** routes (each must be internet-reachable and carries its own
verification, so session auth would break them):

- `/api/webhooks/meta` — HMAC `x-hub-signature-256` (keyed on `META_APP_SECRET`).
- `/api/oauth/callback` — one-time server-generated `oauth_state` CSRF token,
  which can only be minted by the now-gated `POST /api/oauth/authorize`.
- `/api/inngest` — Inngest's own request-signature verification; called by the
  external Inngest service.

`META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` are **env-only**: they are
never read from or writable via the DB/Settings UI, so a `PUT /api/settings`
can't overwrite the secret that signs webhooks (security finding BP-001).

## Known limitations / security follow-ups

- **Single shared-secret auth** — one operator password, no per-user accounts.
  Fine for a single-tenant deploy; add real user auth for multi-tenant.
- **Secrets at rest** — live Meta access tokens and DB-stored Settings values
  are encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`); the integrity-gating
  secrets (`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`) are env-only and
  never touch the DB. The key itself lives only in the environment — if it
  leaks, rotate it and re-issue all tokens (reconnect accounts).
- **No automation caps** — could exceed Meta's ~200 comments/hour Graph ceiling
  under load. Add sliding-window caps before scaling.
- **Comment-triggered DMs only** — inbound DM processing is out of scope.
