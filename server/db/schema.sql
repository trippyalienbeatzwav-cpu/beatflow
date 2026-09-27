-- TUNIBEAT Social — SQLite schema (v1)
-- Conventions: ids are time-sortable TEXT ("<prefix>_<base36 time><random>"), so ORDER BY id is
-- chronological and ids double as pagination cursors. Timestamps are INTEGER epoch ms.
-- Money is INTEGER cents; virtual credits are INTEGER credits. Rates are basis points (1/100 %).

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 24),
  email           TEXT UNIQUE COLLATE NOCASE,
  password_hash   TEXT,
  display_name    TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 50),
  bio             TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 300),
  links           TEXT NOT NULL DEFAULT '[]',            -- JSON [{label,url}]
  avatar_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  cover_media_id  TEXT REFERENCES media(id) ON DELETE SET NULL,
  is_private      INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1)),
  is_creator      INTEGER NOT NULL DEFAULT 0 CHECK (is_creator IN (0,1)),
  is_verified     INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0,1)),
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned')),
  created_at      INTEGER NOT NULL,
  email_verified_at   INTEGER,                       -- NULL until the emailed code is confirmed
  password_changed_at INTEGER,
  failed_logins       INTEGER NOT NULL DEFAULT 0,    -- consecutive failures (reset on success)
  locked_until        INTEGER                        -- temporary lockout after repeated failures
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  user_agent  TEXT                      -- shown in the account’s session list (truncated)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One-time codes and links for email verification and password reset (only hashes are stored)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash  TEXT NOT NULL UNIQUE,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages         TEXT NOT NULL DEFAULT 'everyone' CHECK (messages IN ('everyone','following','nobody')),
  comments         TEXT NOT NULL DEFAULT 'everyone' CHECK (comments IN ('everyone','followers','off')),
  mentions         TEXT NOT NULL DEFAULT 'everyone' CHECK (mentions IN ('everyone','following','nobody')),
  tags             TEXT NOT NULL DEFAULT 'everyone' CHECK (tags IN ('everyone','following','nobody')),
  story_audience   TEXT NOT NULL DEFAULT 'public' CHECK (story_audience IN ('public','followers','close_friends')),
  live_audience    TEXT NOT NULL DEFAULT 'public' CHECK (live_audience IN ('public','followers')),
  activity_status  INTEGER NOT NULL DEFAULT 1 CHECK (activity_status IN (0,1)),
  show_like_counts INTEGER NOT NULL DEFAULT 1 CHECK (show_like_counts IN (0,1)),
  allow_tips       INTEGER NOT NULL DEFAULT 1 CHECK (allow_tips IN (0,1)),
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('active','pending')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id, status, created_at);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id), CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
CREATE TABLE IF NOT EXISTS mutes (
  muter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (muter_id, muted_id), CHECK (muter_id <> muted_id)
);
CREATE TABLE IF NOT EXISTS restricts (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restricted_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, restricted_id), CHECK (user_id <> restricted_id)
);
CREATE TABLE IF NOT EXISTS close_friends (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- ---------- Media (files live in object storage / disk; the DB keeps metadata only) ----------
CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL CHECK (bytes > 0),
  width       INTEGER, height INTEGER, duration_ms INTEGER,
  storage_key TEXT NOT NULL UNIQUE,
  variants    TEXT NOT NULL DEFAULT '{}',        -- JSON {name: storage_key}
  poster_key  TEXT,                               -- still frame for video
  sha256      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing','ready','failed')),
  created_at  INTEGER NOT NULL,
  access      TEXT NOT NULL DEFAULT 'public' CHECK (access IN ('public','private'))   -- private files are never served from /media
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id, created_at);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        TEXT NOT NULL CHECK (purpose IN ('post','reel','story','avatar','cover','message','live_thumbnail','poster','variant','master_audio','artwork','stems_archive')),
  kind           TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  filename       TEXT NOT NULL,
  mime           TEXT NOT NULL,
  total_bytes    INTEGER NOT NULL CHECK (total_bytes > 0),
  chunk_size     INTEGER NOT NULL,
  received       TEXT NOT NULL DEFAULT '[]',     -- JSON array of received chunk indexes
  meta           TEXT NOT NULL DEFAULT '{}',     -- client-reported width/height/duration (re-validated)
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete','cancelled','expired','failed')),
  media_id       TEXT REFERENCES media(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON upload_sessions(owner_id, status);

-- ---------- Posts & reels ----------
CREATE TABLE IF NOT EXISTS posts (
  id             TEXT PRIMARY KEY,
  author_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('text','image','carousel','video','reel','share')),
  caption        TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 2200),
  shared_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  audio_title    TEXT,
  visibility     TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers')),
  allow_tips     INTEGER NOT NULL DEFAULT 1 CHECK (allow_tips IN (0,1)),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed','deleted')),
  like_count     INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count  INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  share_count    INTEGER NOT NULL DEFAULT 0 CHECK (share_count >= 0),
  save_count     INTEGER NOT NULL DEFAULT 0 CHECK (save_count >= 0),
  view_count     INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  idempotency_key TEXT,
  edited_at      INTEGER,
  created_at     INTEGER NOT NULL,
  UNIQUE (author_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, status, id);
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type, status, id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, id);

CREATE TABLE IF NOT EXISTS post_media (
  post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
  alt      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (post_id, position)
);

CREATE TABLE IF NOT EXISTS post_tags (          -- people tagged in a post
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_user ON post_tags(user_id);

CREATE TABLE IF NOT EXISTS hashtags (
  tag          TEXT PRIMARY KEY COLLATE NOCASE,
  post_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_post_hashtags_tag ON post_hashtags(tag, created_at);

CREATE TABLE IF NOT EXISTS mentions (
  id           TEXT PRIMARY KEY,
  source_type  TEXT NOT NULL CHECK (source_type IN ('post','comment','story','live')),
  source_id    TEXT NOT NULL,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioned_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  UNIQUE (source_type, source_id, mentioned_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status      TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','restricted','removed','deleted')),
  like_count  INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  reply_count INTEGER NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, parent_id, id);

-- One reaction per user per target; kind can change ("like" is the default reaction)
CREATE TABLE IF NOT EXISTS reactions (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','story','message')),
  target_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('like','love','fire','laugh','wow','sad','clap')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id, created_at);

CREATE TABLE IF NOT EXISTS saves (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id, created_at);

CREATE TABLE IF NOT EXISTS shares (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('repost','message','link')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_post ON shares(post_id);

CREATE TABLE IF NOT EXISTS hidden_posts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

-- ---------- Stories ----------
CREATE TABLE IF NOT EXISTS stories (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id    TEXT REFERENCES media(id) ON DELETE SET NULL,
  content     TEXT NOT NULL DEFAULT '{}',   -- JSON {text, bg, stickers:[{type,value,x,y}], mentions:[], hashtags:[]}
  link_url    TEXT,
  audio_title TEXT,
  audience    TEXT NOT NULL CHECK (audience IN ('public','followers','close_friends')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','removed','deleted')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_stories_author ON stories(author_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_expiry ON stories(status, expires_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id  TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at INTEGER NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (story_id, viewer_id)
);

-- ---------- Notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  actor_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT, target_id TEXT,
  data        TEXT NOT NULL DEFAULT '{}',
  group_key   TEXT NOT NULL,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    TEXT NOT NULL,
  in_app  INTEGER NOT NULL DEFAULT 1 CHECK (in_app IN (0,1)),
  push    INTEGER NOT NULL DEFAULT 1 CHECK (push IN (0,1)),
  PRIMARY KEY (user_id, type)
);

-- ---------- Messaging ----------
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('dm','group')),
  title           TEXT,
  dm_key          TEXT UNIQUE,              -- "<lowId>:<highId>" guarantees one DM per pair
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_id TEXT,
  last_message_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','request','declined','left')),
  last_read_id    TEXT,
  muted           INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0,1)),
  joined_at       INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id, state);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('text','image','video','voice','file','story_reply','post_share','system')),
  body            TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  media_id        TEXT REFERENCES media(id) ON DELETE SET NULL,
  reply_to_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
  ref             TEXT NOT NULL DEFAULT '{}',   -- {story_id} / {post_id}
  client_id       TEXT,                           -- sender-generated id: dedupes retries
  edited_at       INTEGER,
  deleted_at      INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE (sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

-- ---------- Live ----------
CREATE TABLE IF NOT EXISTS live_streams (
  id                 TEXT PRIMARY KEY,
  host_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description        TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  category           TEXT NOT NULL,
  thumbnail_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  audience           TEXT NOT NULL CHECK (audience IN ('public','followers')),
  status             TEXT NOT NULL CHECK (status IN ('scheduled','live','ended','cancelled')),
  transport          TEXT NOT NULL,
  scheduled_at       INTEGER,
  started_at         INTEGER,
  ended_at           INTEGER,
  peak_viewers       INTEGER NOT NULL DEFAULT 0,
  unique_viewers     INTEGER NOT NULL DEFAULT 0,
  slow_mode_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (slow_mode_seconds BETWEEN 0 AND 300),
  pinned_message_id  TEXT,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_status ON live_streams(status, started_at);
CREATE INDEX IF NOT EXISTS idx_live_host ON live_streams(host_id, status);
-- A host can have at most one stream on air
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_one_on_air ON live_streams(host_id) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS live_viewers (
  id         TEXT PRIMARY KEY,
  stream_id  TEXT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  INTEGER NOT NULL,
  left_at    INTEGER,
  watch_ms   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_live_viewers_stream ON live_viewers(stream_id, user_id);

CREATE TABLE IF NOT EXISTS live_messages (
  id         TEXT PRIMARY KEY,
  stream_id  TEXT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('chat','gift','donation','system')),
  body       TEXT NOT NULL CHECK (length(body) <= 300),
  data       TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','deleted')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_messages_stream ON live_messages(stream_id, id);

CREATE TABLE IF NOT EXISTS live_moderators (
  host_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (host_id, moderator_id)
);
CREATE TABLE IF NOT EXISTS live_sanctions (       -- timeouts ("mute") and bans issued in a host's lives
  host_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('mute','ban')),
  until      INTEGER,                      -- NULL = permanent
  issued_by  TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (host_id, user_id, kind)
);

-- ---------- Monetization ----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,          -- JSON
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_catalog (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  icon              TEXT NOT NULL,           -- icon key rendered by the client (SVG set)
  animation         TEXT NOT NULL CHECK (animation IN ('float','burst','rain','spin','pulse')),
  credit_cost       INTEGER NOT NULL CHECK (credit_cost BETWEEN 1 AND 100000),
  creator_share_bps INTEGER NOT NULL CHECK (creator_share_bps BETWEEN 0 AND 10000),
  platform_fee_bps  INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  availability      TEXT NOT NULL CHECK (availability IN ('everywhere','live_only','profile_only')),
  status            TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
  sort              INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  CHECK (creator_share_bps + platform_fee_bps = 10000)
);

CREATE TABLE IF NOT EXISTS credit_packages (
  id           TEXT PRIMARY KEY,
  credits      INTEGER NOT NULL CHECK (credits > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active','disabled')),
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credits    INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),   -- cannot go negative: double spend fails at the DB
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_balances (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pending_cents   INTEGER NOT NULL DEFAULT 0 CHECK (pending_cents >= 0),
  available_cents INTEGER NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  held_cents      INTEGER NOT NULL DEFAULT 0 CHECK (held_cents >= 0),     -- reserved by open withdrawals
  lifetime_cents  INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_cents >= 0),
  updated_at      INTEGER NOT NULL
);

-- Payment attempts with an external provider (credit purchases and donations)
CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose         TEXT NOT NULL CHECK (purpose IN ('credit_purchase','donation','store_checkout')),
  purpose_id      TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL,
  provider        TEXT NOT NULL,
  provider_ref    TEXT UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('requires_payment','succeeded','failed','cancelled','refunded')),
  test_mode       INTEGER NOT NULL CHECK (test_mode IN (0,1)),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (         -- replay protection for provider webhooks
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS credit_purchases (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id      TEXT NOT NULL REFERENCES credit_packages(id),
  credits         INTEGER NOT NULL CHECK (credits > 0),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('requires_payment','succeeded','failed','cancelled','refunded')),
  payment_id      TEXT REFERENCES payments(id),
  idempotency_key TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS gifts (
  id              TEXT PRIMARY KEY,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_id         TEXT NOT NULL REFERENCES gift_catalog(id),
  gift_name       TEXT NOT NULL,
  credit_cost     INTEGER NOT NULL CHECK (credit_cost > 0),
  gross_cents     INTEGER NOT NULL CHECK (gross_cents >= 0),
  creator_cents   INTEGER NOT NULL CHECK (creator_cents >= 0),
  platform_cents  INTEGER NOT NULL CHECK (platform_cents >= 0),
  context_type    TEXT NOT NULL CHECK (context_type IN ('live','post','profile')),
  context_id      TEXT,
  idempotency_key TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (sender_id, idempotency_key),
  CHECK (sender_id <> recipient_id),
  CHECK (creator_cents + platform_cents = gross_cents)
);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gifts_sender ON gifts(sender_id, created_at);

CREATE TABLE IF NOT EXISTS donations (
  id              TEXT PRIMARY KEY,
  donor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL,
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0),
  creator_cents   INTEGER NOT NULL CHECK (creator_cents >= 0),
  message         TEXT NOT NULL DEFAULT '' CHECK (length(message) <= 200),
  context_type    TEXT NOT NULL CHECK (context_type IN ('live','post','profile')),
  context_id      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('requires_payment','succeeded','failed','cancelled','refunded')),
  payment_id      TEXT REFERENCES payments(id),
  idempotency_key TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  refunded_at     INTEGER,
  UNIQUE (donor_id, idempotency_key),
  CHECK (donor_id <> recipient_id),
  CHECK (fee_cents + creator_cents = amount_cents)
);
CREATE INDEX IF NOT EXISTS idx_donations_recipient ON donations(recipient_id, created_at);

-- A creator's income lines. Pending during the hold period, then available for withdrawal.
CREATE TABLE IF NOT EXISTS earnings (
  id           TEXT PRIMARY KEY,
  creator_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type  TEXT NOT NULL CHECK (source_type IN ('gift','donation','sale')),
  source_id    TEXT NOT NULL,
  gross_cents  INTEGER NOT NULL CHECK (gross_cents >= 0),
  fee_cents    INTEGER NOT NULL CHECK (fee_cents >= 0),
  net_cents    INTEGER NOT NULL CHECK (net_cents >= 0),
  status       TEXT NOT NULL CHECK (status IN ('pending','available','reversed')),
  available_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_earnings_creator ON earnings(creator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_earnings_release ON earnings(status, available_at);

CREATE TABLE IF NOT EXISTS payout_methods (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  provider_ref TEXT NOT NULL,          -- provider-side account token; no bank or card numbers are stored
  label        TEXT NOT NULL,          -- display only, e.g. "Test bank •• 6789"
  status       TEXT NOT NULL CHECK (status IN ('pending_verification','verified','disabled')),
  test_mode    INTEGER NOT NULL CHECK (test_mode IN (0,1)),
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id               TEXT PRIMARY KEY,
  creator_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  currency         TEXT NOT NULL,
  payout_method_id TEXT NOT NULL REFERENCES payout_methods(id),
  status           TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed','rejected','cancelled')),
  verified_at      INTEGER,
  code_hash        TEXT,
  code_expires_at  INTEGER,
  code_attempts    INTEGER NOT NULL DEFAULT 0,
  provider_ref     TEXT,
  failure_reason   TEXT,
  reviewed_by      TEXT REFERENCES users(id),
  idempotency_key  TEXT NOT NULL,
  test_mode        INTEGER NOT NULL CHECK (test_mode IN (0,1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (creator_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_creator ON withdrawals(creator_id, created_at);
-- At most one open withdrawal per creator
CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawals_open ON withdrawals(creator_id) WHERE status IN ('pending','processing');

-- Ledger: every movement of credits or money, append-only.
CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('credit_purchase','gift_sent','gift_received','donation_sent','donation_received',
                                              'platform_fee','earning_release','withdrawal','withdrawal_reversal','refund','refund_reversal','adjustment',
                                              'purchase','sale_received','sale_reversal')),
  amount        INTEGER NOT NULL,                       -- signed; negative = debit
  unit          TEXT NOT NULL CHECK (unit IN ('credits','cents')),
  currency      TEXT,                                    -- for unit = cents
  balance       TEXT NOT NULL CHECK (balance IN ('wallet','pending','available','held','external')),
  status        TEXT NOT NULL CHECK (status IN ('pending','completed','failed','reversed','cancelled')),
  related_type  TEXT,                                    -- gift | donation | credit_purchase | withdrawal | live | post
  related_id    TEXT,
  context_type  TEXT, context_id TEXT,                   -- live session / post the money relates to
  counterparty_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  test_mode     INTEGER NOT NULL DEFAULT 1 CHECK (test_mode IN (0,1)),
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);
CREATE INDEX IF NOT EXISTS idx_tx_related ON transactions(related_type, related_id);

-- ---------- Trust & safety ----------
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','reel','story','live','message','user','comment','live_message','beat','pack','track','release')),
  target_id   TEXT NOT NULL,
  target_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('spam','harassment','hate','nudity','violence','self_harm','scam','ip','impersonation','minor_safety','other')),
  details     TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 1000),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  resolution  TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolved_at INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id           TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  reason       TEXT,
  created_at   INTEGER NOT NULL
);

-- ---------- Analytics & search ----------
CREATE TABLE IF NOT EXISTS view_events (
  id          TEXT PRIMARY KEY,
  viewer_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','reel','story','live','profile')),
  target_id   TEXT NOT NULL,
  watch_ms    INTEGER NOT NULL DEFAULT 0 CHECK (watch_ms >= 0),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_views_owner ON view_events(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_views_target ON view_events(target_type, target_id);

CREATE TABLE IF NOT EXISTS search_history (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, query)
);

CREATE TABLE IF NOT EXISTS dev_outbox (             -- development-only mail sink (verification codes)
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(username, display_name, bio, content='users', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS users_ai AFTER INSERT ON users BEGIN
  INSERT INTO users_fts(rowid, username, display_name, bio) VALUES (new.rowid, new.username, new.display_name, new.bio);
END;
CREATE TRIGGER IF NOT EXISTS users_ad AFTER DELETE ON users BEGIN
  INSERT INTO users_fts(users_fts, rowid, username, display_name, bio) VALUES ('delete', old.rowid, old.username, old.display_name, old.bio);
END;
CREATE TRIGGER IF NOT EXISTS users_au AFTER UPDATE OF username, display_name, bio ON users BEGIN
  INSERT INTO users_fts(users_fts, rowid, username, display_name, bio) VALUES ('delete', old.rowid, old.username, old.display_name, old.bio);
  INSERT INTO users_fts(rowid, username, display_name, bio) VALUES (new.rowid, new.username, new.display_name, new.bio);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(caption, content='posts', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, caption) VALUES (new.rowid, new.caption);
END;
CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, caption) VALUES ('delete', old.rowid, old.caption);
END;
CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE OF caption ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, caption) VALUES ('delete', old.rowid, old.caption);
  INSERT INTO posts_fts(rowid, caption) VALUES (new.rowid, new.caption);
END;
