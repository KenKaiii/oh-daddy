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

1. Fork this repo.
2. Open it in Claude Code / GG Coder.
3. Run `/setup-railway`.

That's it. It provisions Postgres, secrets, a self-hosted Inngest server, and deploys the app for you. Meta/Instagram credentials get entered afterward in the deployed app's `/setup` wizard.

**You need:** a Railway account, and the Railway CLI installed and logged in (`railway login`).

---

## 🔒 Admin auth

On Railway, `/setup-railway` generates this for you and prints it once at the end.

Running locally, generate your own and drop it in `.env.local`:

```bash
echo "ADMIN_PASSWORD=$(openssl rand -base64 24)" >> .env.local
```

Visit `/login` and sign in with it.

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
