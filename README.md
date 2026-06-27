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

Or with Docker for a throwaway local DB:

```bash
docker run -d --name oh-daddy-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=oh_daddy postgres:16-alpine
```

### 4. Run

```bash
npm run dev
```

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

## Known limitations / security follow-ups

- **No admin auth** on API routes — single-user/local MVP. Add auth before any
  public deploy. The webhook is public but HMAC-verified.
- **Plaintext settings** — Meta secrets are stored unencrypted in the `settings`
  table. Encrypt before production.
- **No automation caps** — could exceed Meta's ~200 comments/hour Graph ceiling
  under load. Add sliding-window caps before scaling.
- **Comment-triggered DMs only** — inbound DM processing is out of scope.
