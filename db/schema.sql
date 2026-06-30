-- ============================================================
-- ManyChat-clone MVP — schema (plain Postgres)
-- Apply with:  npm run db:push   (or: psql "$DATABASE_URL" -f db/schema.sql)
-- 8 tables + updated_at trigger. No RLS (single-app DB user).
-- ============================================================

-- gen_random_uuid() is built in on PG13+, but pgcrypto provides it on older.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- Shared trigger fn: bump updated_at on UPDATE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. settings — credential store (env is the fallback)
-- Values are encrypted at rest (AES-256-GCM, enc:v1: blobs) by the app. The
-- in-app Setup wizard stores Meta/Instagram credentials here; env vars remain a
-- fallback for manual/legacy installs. See src/lib/crypto.ts.
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  provider text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. platform_accounts — connected Meta accounts (FB Pages + IG)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_id text NOT NULL,
  account_name text NOT NULL,
  -- Encrypted at rest (AES-256-GCM, enc:v1: blob). Non-secret sentinels
  -- (''/'pending'/'mock-*') are stored verbatim. See src/lib/crypto.ts.
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, account_id)
);

-- ============================================================
-- 3. contacts — people who comment
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  platform_user_id text NOT NULL,
  name text,
  username text,
  avatar_url text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_platform_user
  ON contacts (platform, platform_user_id);

-- ============================================================
-- 4. conversations — a comment thread or DM thread
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_account_id uuid NOT NULL REFERENCES platform_accounts (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  interaction_type text NOT NULL CHECK (interaction_type IN ('comment', 'dm')),
  platform_thread_id text NOT NULL,
  platform_post_id text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_account_id, interaction_type, platform_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message
  ON conversations (platform_account_id, last_message_at DESC);

-- ============================================================
-- 5. messages — individual messages in a conversation
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  platform_message_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);

-- Dedup: one message per platform_message_id within a conversation
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedup
  ON messages (conversation_id, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

-- ============================================================
-- 6. comment_automations — keyword rules
-- XOR: exactly one of platform_account_id / scope is set.
-- ============================================================
CREATE TABLE IF NOT EXISTS comment_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_account_id uuid REFERENCES platform_accounts (id) ON DELETE CASCADE,
  scope text CHECK (scope IN ('meta')),
  -- Optional per-post targeting. NULL = all posts on the target account; a
  -- value = fire only when the comment's post id matches. Account-specific only.
  platform_post_id text,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  keywords text[] NOT NULL DEFAULT '{}',
  fuzzy_threshold integer NOT NULL DEFAULT 2,
  comment_replies text[] NOT NULL DEFAULT '{}',
  dm_message text NOT NULL DEFAULT '',
  match_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comment_automations_target_xor CHECK (
    (platform_account_id IS NOT NULL AND scope IS NULL)
    OR (platform_account_id IS NULL AND scope IS NOT NULL)
  )
);

-- Idempotent migrations for pre-existing DBs (CREATE TABLE above won't alter):
-- add per-post targeting, drop the removed dm_link column. MUST run before the
-- post index below, which references platform_post_id.
ALTER TABLE comment_automations ADD COLUMN IF NOT EXISTS platform_post_id text;
ALTER TABLE comment_automations DROP COLUMN IF EXISTS dm_link;

CREATE INDEX IF NOT EXISTS idx_comment_automations_account
  ON comment_automations (platform_account_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_comment_automations_scope
  ON comment_automations (scope) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_comment_automations_post
  ON comment_automations (platform_account_id, platform_post_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS set_updated_at ON comment_automations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON comment_automations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 7. automation_matches — dedup + cooldown ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES comment_automations (id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  matched_keyword text NOT NULL,
  match_type text NOT NULL DEFAULT 'exact',
  fuzzy_distance integer,
  comment_reply_sent boolean NOT NULL DEFAULT false,
  dm_sent boolean NOT NULL DEFAULT false,
  dm_platform_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The real dedup gate: one match per (automation, message).
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_matches_dedup
  ON automation_matches (automation_id, message_id);
-- Cooldown lookup: latest match per (automation, contact).
CREATE INDEX IF NOT EXISTS idx_automation_matches_cooldown
  ON automation_matches (automation_id, contact_id, created_at DESC);

-- ============================================================
-- 8. webhook_events — raw inbound log (powers dashboard stats)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created
  ON webhook_events (created_at DESC);
