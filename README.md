# 🤖 Oh Daddy

<p align="center">
  <img src="docs/icon.png" alt="Oh Daddy" width="200">
</p>

<p align="center">
  <strong>Comment a keyword, get a public reply and a DM. Automatically.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg?style=for-the-badge" alt="AGPL-3.0 License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

**Oh Daddy** is a minimal, self-hosted, ManyChat-style tool for Instagram and Facebook comment automations. Someone comments a keyword on your post, they get a public reply right away plus a DM straight to their inbox. No human involved.

No AI, no chatbot builder, no 40 platforms you'll never touch. Just keyword in, reply + DM out.

---

## ✨ What it does

### Keyword automations

Someone comments a keyword under your post, they get a public reply (rotated so it's not the same line every time) and a private DM via Meta's Private Replies API.

### Per-contact cooldown

Same person comments the same keyword twice in 24 hours? They only get replied to once. No spam, no annoyed followers.

### Per-post targeting

Scope an automation to one specific post, or leave it open to every post on the account.

### Four pages, nothing else

**Dashboard** (stats), **Automations** (keyword rules), **Accounts** (connect Meta via OAuth), **Settings** (credentials + webhook config).

### Built to not double-post

Every send claims its row in Postgres before it touches the Meta API. Webhook retries and Inngest retries can't send the same reply twice.

### Global send cap

All sends across every connected account share one hard cap of 195 comments/hour, just under Meta's Graph API ceiling. Doesn't matter if you've got 1 account or 5, the whole deploy can never trip Meta's rate limit. Overflow gets queued and delayed, never dropped.

### Secrets encrypted at rest

Access tokens and DB-stored settings are AES-256-GCM encrypted. A leaked backup or a raw SQL dump never hands over a live Meta token.

---

## 🆚 Oh Daddy vs ManyChat

| | **Oh Daddy** | **ManyChat** |
|---|---|---|
| Cost | ~$5/month total, your own hosting | Starts at $29/month, **per account** |
| Accounts | Add as many as you want (recommend keeping it to 4-5) | Pay-per-account, adds up fast |
| Hosting | Self-hosted, you own the server and the data | Their cloud, your data lives on their servers |
| Source | Open source (AGPL-3.0), read every line | Closed source |
| Scope | Instagram + Facebook comments, on purpose | Instagram, Facebook, WhatsApp, Telegram, SMS, AI chatbots, and more |
| Vendor lock-in | None, it's just Postgres + Next.js | Yes |

If you need the full chatbot suite, ManyChat is a solid product. If all you need is "keyword comment → reply + DM" for a handful of accounts, this is a lot cheaper and it's yours.

---

## 🚀 Getting started

### Fork it

Click **Fork** (top right of this repo) so you've got your own copy to deploy from.

### Clone it

```bash
git clone https://github.com/<your-username>/oh-daddy.git
cd oh-daddy
npm install
```

### Set up your environment

Copy `.env.example` → `.env.local` and fill in `DATABASE_URL` and `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`). Everything else, including your Meta/Instagram credentials, can be entered later through the app's `/setup` wizard.

### Database

Point `DATABASE_URL` at any Postgres instance (or spin up a throwaway one with Docker), then push the schema:

```bash
docker run -d --name oh-daddy-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=oh_daddy postgres:16-alpine

npm run db:push
```

### Run

```bash
npm run dev
```

This starts **Next.js** (`localhost:3000`) and the **Inngest dev server** together. Just Next.js: `npm run dev:next`.

That's it. Head to `/setup` to connect Meta.

---

## ☁️ Deploy (Railway)

One script does everything: provisions Postgres, generates the env-only secrets (`APP_ENCRYPTION_KEY`, `ADMIN_PASSWORD`), provisions a self-hosted Inngest server and wires the app to it, mints a domain, deploys, applies the schema, and syncs Inngest functions. It doesn't ask for Meta/Instagram credentials, you enter those later in the deployed app's `/setup` wizard, encrypted in the database.

```bash
railway login   # browser auth, one time
bash scripts/railway-setup.sh
```

If you're on Claude Code / GG Coder, `/setup-railway` runs the same script for you with preflight checks. Both do the exact same thing, the script is the real automation either way.

It's idempotent (safe to re-run) and never rotates an existing `APP_ENCRYPTION_KEY`, losing that key makes every previously-encrypted token undecryptable. Only set `RAILWAY_WORKSPACE` if your account has more than one workspace.

Self-hosted Inngest doesn't auto-discover function changes on deploy, so this repo re-syncs automatically on every deploy via `scripts/post-deploy-sync.mjs`. Manual nudge if you ever need it:

```bash
curl -X PUT https://<your-app-domain>/api/inngest
```

---

## 🔧 Meta App configuration (manual, external)

This can't be automated, do it in the [Meta App dashboard](https://developers.facebook.com/apps):

1. **Save credentials** in **Settings** (or `.env.local`): App ID, App Secret, Webhook Verify Token.
2. **OAuth redirect URI:** add `<NEXT_PUBLIC_APP_URL>/oauth/callback` to your app's valid OAuth redirect URIs.
3. **Scopes** (granted on connect): `pages_show_list`, `pages_manage_engagement`, `pages_manage_metadata`, `pages_read_user_content`, `pages_messaging`, `business_management`, `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`. (Or use a Facebook Login for Business `config_id`.)
4. **Webhooks:** set the callback URL to `<public-url>/api/webhooks/meta` and the verify token to your `META_WEBHOOK_VERIFY_TOKEN`. Subscribe fields:
   - Facebook Page: `feed`, `messages`
   - Instagram: `comments`, `messages`

For local dev, Meta needs a public HTTPS URL to deliver webhooks, tunnel port 3000 with `ngrok http 3000` and use that URL as both `NEXT_PUBLIC_APP_URL` and the webhook callback base.

---

## 🔌 How a comment flows

```
Meta webhook → POST /api/webhooks/meta
  → verify x-hub-signature-256 (Instagram secret for IG, Facebook secret for Page)
  → filter to real comment add/edit events
  → inngest.send("comment/process")  → return 200 fast

Inngest process-comment (unthrottled):
  STEP ingest      → normalize, upsert contact/conversation/message (dedup)
  STEP match-check → if keyword matches, emit "automation/send"

Inngest automation-send (delayed + globally rate-capped):
  STEP delay       → optional operator-configured wait before sending
  STEP send        → dedup + 24h cooldown
                   → CLAIM automation_matches row BEFORE posting (idempotency)
                   → post rotated public reply (Graph API)
                   → send Private Reply DM (bypasses the 24h window)
                   → persist both as assistant messages
```

All runs across every account share one throttle bucket capped at 195 sends/hour, so the combined total, not per-account, never trips Meta's Graph API ceiling.

The dedup gate is the unique index `(automation_id, message_id)`. The claim row is inserted before any external API call so webhook/Inngest retries can't double-post. If the public reply itself throws, the claim is rolled back so the next delivery retries.

---

## 🔒 Admin auth

Every `/api/*` route is gated by `src/proxy.ts` (Next.js 16's renamed `middleware`). Set a shared secret in the environment:

```
ADMIN_PASSWORD=some-long-random-string
```

Visit `/login` and enter the password for a browser session, or send `Authorization: Bearer <ADMIN_PASSWORD>` programmatically. Both are compared in constant time. If `ADMIN_PASSWORD` is unset, protected API routes return 503 (fail closed).

`/api/webhooks/meta`, `/api/oauth/callback`, and `/api/inngest` are exempt since they carry their own verification (HMAC signature, one-time CSRF token, and Inngest's own signing respectively) and need to stay internet-reachable.

---

## 👥 Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) - tutorials and demos
- [Skool community](https://skool.com/kenkai) - come hang out

---

## 📄 License

AGPL-3.0

---

<p align="center">
  <strong>Keyword in, reply + DM out. That's the whole app.</strong>
</p>
