#!/usr/bin/env bash
#
# Seamless Railway provisioning for oh-daddy.
#
# Does EVERYTHING that can be automated against your Railway account: creates
# the project, provisions Postgres, creates the app service, generates the
# at-rest secrets, wires DATABASE_URL, mints a public domain, deploys, and
# applies the DB schema. Re-runnable (idempotent): existing variables are left
# untouched — in particular APP_ENCRYPTION_KEY is NEVER regenerated, because
# that would orphan every already-encrypted token.
#
# Secrets are written to Railway via stdin, never via argv, so they don't leak
# into `ps`/shell history.
#
# Meta/Instagram credentials are NOT handled here. Every connect credential
# (meta_app_id/secret/config_id, meta_webhook_verify_token, instagram_app_id/
# secret) is entered through the in-app Settings page / Setup wizard after the
# first login, stored DB-first and encrypted at rest. This script only
# provisions infrastructure and the two genuinely env-only secrets
# (APP_ENCRYPTION_KEY, ADMIN_PASSWORD).
#
# Inngest is SELF-HOSTED (not Inngest Cloud): a separate Railway service runs
# the `inngest` server (Postgres + Redis backed), and the app's SDK is wired to
# it via INNGEST_BASE_URL + a shared signing/event key pair generated here.
#
# Optional env in:
#   RAILWAY_WORKSPACE         (workspace id/name; required if you have >1)
#   INNGEST_BASE_URL          (self-hosted Inngest server URL; if the Inngest
#                              service isn't provisioned yet, leave unset and
#                              wire it after — see step 5 of /setup-railway)
#   RAILWAY_PROJECT_NAME      (default: oh-daddy)
#   APP_SERVICE_NAME          (default: oh-daddy)
#   DB_SERVICE_NAME           (default: Postgres)
#
# Prereqs: railway CLI (logged in: `railway login`), openssl, node.

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-oh-daddy}"
APP_SVC="${APP_SERVICE_NAME:-oh-daddy}"
DB_SVC="${DB_SERVICE_NAME:-Postgres}"
WORKSPACE="${RAILWAY_WORKSPACE:-}"
# Self-hosted Inngest: provisioned from the "Inngest Production Template"
# (server + its own Postgres + Redis). INNGEST_SVC is the server service name
# the template creates; the app references its keys + domain.
INNGEST_TEMPLATE="${INNGEST_TEMPLATE:-inngest-production-template}"
INNGEST_SVC="${INNGEST_SERVICE_NAME:-InngestApp}"

log()  { printf '\033[1;36m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
command -v railway >/dev/null || die "railway CLI not found. Install: https://docs.railway.com/guides/cli"
command -v openssl >/dev/null || die "openssl not found."
command -v node    >/dev/null || die "node not found."
railway whoami >/dev/null 2>&1 || die "Not logged in. Run: railway login"

ok "Logged in to Railway as $(railway whoami 2>/dev/null | tail -1)"

# ── Link or create the project ───────────────────────────────────────────────
if railway status --json >/dev/null 2>&1; then
  ok "Directory already linked to a Railway project."
else
  # `railway init` needs an explicit --workspace when the account has more than
  # one (it can't prompt non-interactively). Resolve it before creating.
  if [ -z "$WORKSPACE" ]; then
    WS_COUNT="$(railway whoami --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String((JSON.parse(s).workspaces||[]).length))}catch{process.stdout.write("0")}})')"
    if [ "$WS_COUNT" != "1" ]; then
      echo "Multiple Railway workspaces found. Re-run with RAILWAY_WORKSPACE set to one of:" >&2
      railway whoami --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const w of JSON.parse(s).workspaces||[])console.error("  • "+w.name+"  ("+w.id+")")}catch{}})'
      die "Set e.g. RAILWAY_WORKSPACE=\"<name-or-id>\" and re-run."
    fi
  fi
  log "Creating Railway project '$PROJECT_NAME'…"
  if [ -n "$WORKSPACE" ]; then
    railway init --name "$PROJECT_NAME" --workspace "$WORKSPACE" >/dev/null
  else
    railway init --name "$PROJECT_NAME" >/dev/null
  fi
  ok "Project created and linked."
fi

# ── Provision Postgres (idempotent) ──────────────────────────────────────────
if railway variables --service "$DB_SVC" --json >/dev/null 2>&1; then
  ok "Postgres service '$DB_SVC' already exists."
else
  log "Provisioning Postgres…"
  railway add --database postgres >/dev/null
  ok "Postgres provisioned."
fi

# ── Create the app service (idempotent) ──────────────────────────────────────
if railway variables --service "$APP_SVC" --json >/dev/null 2>&1; then
  ok "App service '$APP_SVC' already exists."
else
  log "Creating app service '$APP_SVC'…"
  railway add --service "$APP_SVC" >/dev/null
  ok "App service created."
fi

# Snapshot existing app vars once so we only set what's missing.
EXISTING_VARS="$(railway variables --service "$APP_SVC" --kv 2>/dev/null || true)"
has_var() { printf '%s\n' "$EXISTING_VARS" | grep -q "^$1="; }

# set_secret KEY <<<value   — writes via stdin (never argv), skips deploys.
set_secret() {
  local key="$1" value="$2"
  printf '%s' "$value" | railway variable set "$key" --stdin --service "$APP_SVC" --skip-deploys >/dev/null
}
set_plain() {
  railway variable set "$1=$2" --service "$APP_SVC" --skip-deploys >/dev/null
}

# ── APP_ENCRYPTION_KEY — generate ONCE, never rotate ─────────────────────────
if has_var APP_ENCRYPTION_KEY; then
  ok "APP_ENCRYPTION_KEY already set — left untouched (rotating would orphan tokens)."
else
  log "Generating APP_ENCRYPTION_KEY (32 bytes, base64)…"
  set_secret APP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  ok "APP_ENCRYPTION_KEY set. It lives ONLY in Railway — back it up if you need DR."
fi

# ── ADMIN_PASSWORD — generate if missing, surface to the user ────────────
DASH_PW_TO_SHOW=""
if has_var ADMIN_PASSWORD; then
  ok "ADMIN_PASSWORD already set — left untouched."
else
  DASH_PW_TO_SHOW="$(openssl rand -base64 24)"
  set_secret ADMIN_PASSWORD "$DASH_PW_TO_SHOW"
  ok "ADMIN_PASSWORD generated."
fi

# Meta/Instagram connect credentials are intentionally NOT set here — they are
# entered through the in-app Settings page / Setup wizard (DB-first, encrypted),
# including the webhook verify token (generated in the wizard).

# ── Inngest (SELF-HOSTED) — provision the server, then wire the app to it ─────
# The "$INNGEST_SVC" service runs the inngest server (with its own Postgres +
# Redis), provisioned from a Railway template. The app SHARES the server's
# signing + event keys via cross-service references, so the two can never
# drift apart, and points its SDK at the server via INNGEST_BASE_URL.
if railway variables --service "$INNGEST_SVC" --json >/dev/null 2>&1; then
  ok "Self-hosted Inngest server '$INNGEST_SVC' already exists."
else
  log "Provisioning self-hosted Inngest (template: $INNGEST_TEMPLATE)…"
  railway deploy -t "$INNGEST_TEMPLATE" >/dev/null 2>&1 || \
    warn "Template deploy returned non-zero — verify '$INNGEST_SVC' in the dashboard."
  # The template provisions asynchronously; wait for the server service to
  # appear so the variable references below resolve.
  for _ in $(seq 1 30); do
    railway variables --service "$INNGEST_SVC" --json >/dev/null 2>&1 && break
    sleep 5
  done
  if railway variables --service "$INNGEST_SVC" --json >/dev/null 2>&1; then
    ok "Inngest server provisioned."
  else
    warn "Inngest server '$INNGEST_SVC' not visible yet — references will resolve"
    warn "once it finishes provisioning; re-run this script to confirm."
  fi
fi

# Share the server's keys + URL with the app (references resolve at deploy time;
# always in lockstep with the server, even if the server rotates them).
set_plain INNGEST_SIGNING_KEY "\${{${INNGEST_SVC}.INNGEST_SIGNING_KEY}}"
set_plain INNGEST_EVENT_KEY "\${{${INNGEST_SVC}.INNGEST_EVENT_KEY}}"
set_plain INNGEST_BASE_URL "https://\${{${INNGEST_SVC}.RAILWAY_PUBLIC_DOMAIN}}"
ok "App wired to self-hosted Inngest ('$INNGEST_SVC') via cross-service references."
# Self-hosted prod must NOT run the local Inngest dev server.
railway variable delete INNGEST_DEV --service "$APP_SVC" --skip-deploys >/dev/null 2>&1 || true

# ── DATABASE_URL — reference the Postgres service (auto-updates) ──────────────
if has_var DATABASE_URL; then
  ok "DATABASE_URL already set."
else
  railway variable set "DATABASE_URL=\${{${DB_SVC}.DATABASE_URL}}" \
    --service "$APP_SVC" --skip-deploys >/dev/null
  ok "DATABASE_URL wired to the ${DB_SVC} service."
fi

# ── Public domain + NEXT_PUBLIC_APP_URL ──────────────────────────────────────
log "Ensuring a public domain…"
DOMAIN_JSON="$(railway domain --service "$APP_SVC" --json 2>/dev/null || true)"
APP_DOMAIN="$(printf '%s' "$DOMAIN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const d=j.domain||j.domains?.[0]?.domain||j.domains?.[0]||(Array.isArray(j)?j[0]:"");process.stdout.write(typeof d==="string"?d:(d?.domain||""))}catch{process.stdout.write("")}})' 2>/dev/null || true)"

# `railway domain --json` returns the domain WITH its scheme (e.g.
# "https://foo.up.railway.app"). Strip any scheme, then add exactly one.
APP_DOMAIN="${APP_DOMAIN#https://}"
APP_DOMAIN="${APP_DOMAIN#http://}"
if [ -n "$APP_DOMAIN" ]; then
  APP_URL="https://${APP_DOMAIN}"
  set_plain NEXT_PUBLIC_APP_URL "$APP_URL"
  ok "Public URL: $APP_URL"
else
  warn "Could not auto-detect the domain. Generate one in the Railway dashboard,"
  warn "then set NEXT_PUBLIC_APP_URL to https://<domain> and redeploy."
  APP_URL=""
fi

# ── Deploy ───────────────────────────────────────────────────────────────────
log "Deploying (railway up)…"
railway up --service "$APP_SVC" --ci
ok "Deploy uploaded."

# ── Apply the schema ─────────────────────────────────────────────────────────
# The internal DATABASE_URL (postgres.railway.internal) is only reachable from
# inside Railway, so a local push must use the public proxy URL instead. Apply
# via local psql if present, else fall back to any running postgres Docker
# container's psql.
log "Applying db/schema.sql against the Railway Postgres…"
DB_PUBLIC_URL="$(railway variables --service "$DB_SVC" --kv 2>/dev/null | sed -n 's/^DATABASE_PUBLIC_URL=//p')"
if [ -z "$DB_PUBLIC_URL" ]; then
  warn "No DATABASE_PUBLIC_URL on '$DB_SVC' — enable a public networking proxy,"
  warn "then apply db/schema.sql manually."
elif command -v psql >/dev/null; then
  if psql "$DB_PUBLIC_URL" -f db/schema.sql >/dev/null 2>&1; then ok "Schema applied (local psql)."
  else warn "Schema push failed — apply db/schema.sql manually."; fi
else
  PG_CONTAINER="$(docker ps --filter ancestor=postgres --format '{{.Names}}' 2>/dev/null | head -1)"
  [ -z "$PG_CONTAINER" ] && PG_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i postgres | head -1)"
  if [ -n "$PG_CONTAINER" ] && docker exec -i "$PG_CONTAINER" psql "$DB_PUBLIC_URL" < db/schema.sql >/dev/null 2>&1; then
    ok "Schema applied (via Docker container '$PG_CONTAINER')."
  else
    warn "psql not available locally or via Docker — apply the schema manually:"
    warn "  psql \"<DATABASE_PUBLIC_URL>\" -f db/schema.sql"
  fi
fi

# ── Register the app with the self-hosted Inngest server ─────────────────────
# A PUT to the app's /api/inngest makes it sync its functions to the server at
# INNGEST_BASE_URL. Best-effort: needs the deploy to be live, so we retry.
if [ -n "$APP_URL" ]; then
  log "Registering functions with the self-hosted Inngest server…"
  for _ in $(seq 1 12); do
    SYNC_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$APP_URL/api/inngest" 2>/dev/null || true)"
    [ "$SYNC_CODE" = "200" ] && break
    sleep 10
  done
  if [ "${SYNC_CODE:-}" = "200" ]; then
    ok "App registered with Inngest (functions synced)."
  else
    warn "Inngest sync not confirmed (last HTTP ${SYNC_CODE:-n/a}). Once the app is"
    warn "live, run:  curl -X PUT $APP_URL/api/inngest"
  fi
fi

# ── Summary + the handful of human-only follow-ups ───────────────────────────
echo
printf '\033[1;32m━━━ oh-daddy is deployed ━━━\033[0m\n'
[ -n "$APP_URL" ] && echo "App URL:        $APP_URL"
echo
if [ -n "$DASH_PW_TO_SHOW" ]; then
  printf '\033[1;33mSAVE THIS — dashboard login password:\033[0m %s\n' "$DASH_PW_TO_SHOW"
  echo "  (it is stored in Railway as ADMIN_PASSWORD; this is your only plaintext copy)"
  echo
fi
printf '\033[1;36mNext: sign in and finish setup in the app (no env/CLI needed):\033[0m\n'
echo "  1. Open ${APP_URL:-<app-url>}/login and sign in with the password above."
echo "  2. Follow /setup — paste your Instagram (and optional Facebook) app"
echo "     credentials there; they're stored encrypted in the database."
echo "  3. The wizard generates the webhook verify token and shows the exact"
echo "     redirect + callback URLs to register in the Meta App dashboard."
echo
echo "All connect credentials live in Settings — nothing to add to Railway by hand."
