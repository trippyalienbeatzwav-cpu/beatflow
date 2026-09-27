-- ==========================================================================
-- TUNIBEAT stores: Beats Store (beats, packs, licenses) and Electronic Music Store (releases, tracks).
-- Money is integer cents. Every product row carries its marketplace through its table; orders are
-- split per marketplace. Presentational attributes live in `data` (JSON); anything queried, joined,
-- constrained or summed is a real column.
-- ==========================================================================

-- ---------- Taxonomy ----------
CREATE TABLE IF NOT EXISTS store_genres (
  id           TEXT PRIMARY KEY,
  marketplace  TEXT NOT NULL CHECK (marketplace IN ('beats','electronic')),
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  bpm_lo       INTEGER CHECK (bpm_lo IS NULL OR bpm_lo BETWEEN 40 AND 250),
  bpm_hi       INTEGER CHECK (bpm_hi IS NULL OR bpm_hi BETWEEN 40 AND 250),
  family       TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  visible      INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_genres_market ON store_genres(marketplace, position);

-- ---------- Sellers ----------
CREATE TABLE IF NOT EXISTS producers (               -- Beats Store sellers
  id          TEXT PRIMARY KEY,
  user_id     TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  handle      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(handle) BETWEEN 2 AND 32),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artists (                 -- Electronic Music Store artists
  id          TEXT PRIMARY KEY,
  user_id     TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  handle      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(handle) BETWEEN 2 AND 32),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS labels (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

-- ---------- Audio (masters are private; previews and analysis are public once published) ----------
CREATE TABLE IF NOT EXISTS audio_assets (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL CHECK (source IN ('upload','synth')),
  master_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,   -- private uploaded WAV/AIFF
  synth_spec      TEXT,                                           -- JSON: how the catalog synthesiser renders it
  stems_media_id  TEXT REFERENCES media(id) ON DELETE SET NULL,   -- optional uploaded stems .zip (private)
  sample_rate     INTEGER, channels INTEGER, bit_depth INTEGER,
  duration_ms     INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0),
  status          TEXT NOT NULL CHECK (status IN ('processing','ready','failed')),
  error           TEXT,
  preview_url     TEXT,                                           -- public clip (Opus or MP3)
  analysis_url    TEXT,                                           -- public JSON (BPM, grid, sections, preview window)
  waveform_url    TEXT,                                           -- public TBWF overview
  analysis        TEXT NOT NULL DEFAULT '{}',                     -- summary copy of the analysis JSON
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audio_owner ON audio_assets(owner_id, created_at);

-- ---------- Beats Store products ----------
CREATE TABLE IF NOT EXISTS licenses (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  short        TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents > 0),
  exclusive    INTEGER NOT NULL DEFAULT 0 CHECK (exclusive IN (0,1)),
  formats      TEXT NOT NULL,                       -- JSON ["MP3","WAV","STEMS"]
  position     INTEGER NOT NULL DEFAULT 0,
  data         TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS beats (
  id                  TEXT PRIMARY KEY,
  producer_id         TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
  title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  genre_id            TEXT NOT NULL REFERENCES store_genres(id),
  bpm                 INTEGER NOT NULL CHECK (bpm BETWEEN 40 AND 250),
  musical_key         TEXT NOT NULL,
  duration_sec        INTEGER NOT NULL CHECK (duration_sec BETWEEN 5 AND 1800),
  price_mult          REAL NOT NULL DEFAULT 1 CHECK (price_mult > 0 AND price_mult <= 10),
  status              TEXT NOT NULL CHECK (status IN ('draft','processing','published','sold_exclusive','removed')),
  exclusive_available INTEGER NOT NULL DEFAULT 1 CHECK (exclusive_available IN (0,1)),
  exclusive_hold_checkout TEXT,                     -- an unpaid checkout reserving exclusive rights
  exclusive_hold_until    INTEGER,
  free_download       INTEGER NOT NULL DEFAULT 0 CHECK (free_download IN (0,1)),
  audio_id            TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,
  art_media_id        TEXT REFERENCES media(id) ON DELETE SET NULL,
  play_count          INTEGER NOT NULL DEFAULT 0,
  data                TEXT NOT NULL DEFAULT '{}',   -- moods, tags, description, credits, stems, art params, imported stats
  created_at          INTEGER NOT NULL,
  published_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_beats_status ON beats(status, published_at);
CREATE INDEX IF NOT EXISTS idx_beats_producer ON beats(producer_id, status);
CREATE INDEX IF NOT EXISTS idx_beats_genre ON beats(genre_id, status);

CREATE TABLE IF NOT EXISTS packs (
  id           TEXT PRIMARY KEY,
  producer_id  TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  type         TEXT NOT NULL CHECK (type IN ('samples','loops','production','stems')),
  genre_id     TEXT REFERENCES store_genres(id),
  bpm          INTEGER CHECK (bpm IS NULL OR bpm BETWEEN 40 AND 250),
  musical_key  TEXT,
  price_cents  INTEGER NOT NULL CHECK (price_cents > 0),
  status       TEXT NOT NULL CHECK (status IN ('draft','processing','published','removed')),
  audio_id     TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,   -- demo
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_packs_producer ON packs(producer_id, status);

-- ---------- Electronic Music Store products ----------
CREATE TABLE IF NOT EXISTS releases (
  id            TEXT PRIMARY KEY,
  label_id      TEXT REFERENCES labels(id) ON DELETE SET NULL,
  owner_id      TEXT REFERENCES users(id) ON DELETE SET NULL,        -- who manages it in the seller dashboard
  type          TEXT NOT NULL CHECK (type IN ('single','ep','album','remix','compilation','dj-tool')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  cat           TEXT UNIQUE,                                          -- catalog number
  release_date  TEXT NOT NULL,                                        -- YYYY-MM-DD
  genre_id      TEXT NOT NULL REFERENCES store_genres(id),
  formats       TEXT NOT NULL,                                        -- JSON ["WAV","AIFF","MP3"]
  upc           TEXT UNIQUE,
  status        TEXT NOT NULL CHECK (status IN ('draft','processing','published','removed')),
  art_media_id  TEXT REFERENCES media(id) ON DELETE SET NULL,
  data          TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  published_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status, release_date);
CREATE INDEX IF NOT EXISTS idx_releases_label ON releases(label_id);
CREATE INDEX IF NOT EXISTS idx_releases_owner ON releases(owner_id);

CREATE TABLE IF NOT EXISTS release_artists (
  release_id  TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artist_id   TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_release_artists_artist ON release_artists(artist_id);

CREATE TABLE IF NOT EXISTS tracks (
  id            TEXT PRIMARY KEY,
  release_id    TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position >= 1),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  mix           TEXT NOT NULL DEFAULT 'Original Mix',
  genre_id      TEXT NOT NULL REFERENCES store_genres(id),
  bpm           REAL NOT NULL CHECK (bpm BETWEEN 40 AND 250),
  musical_key   TEXT NOT NULL,
  camelot       TEXT NOT NULL,
  energy        INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 10),
  duration_sec  INTEGER NOT NULL CHECK (duration_sec BETWEEN 5 AND 3600),
  isrc          TEXT UNIQUE,
  explicit      INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0,1)),
  status        TEXT NOT NULL CHECK (status IN ('draft','processing','published','removed')),
  audio_id      TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,
  play_count    INTEGER NOT NULL DEFAULT 0,
  data          TEXT NOT NULL DEFAULT '{}',        -- intro/outro, drop cue, family, imported stats
  created_at    INTEGER NOT NULL,
  UNIQUE (release_id, position)
);
CREATE INDEX IF NOT EXISTS idx_tracks_release ON tracks(release_id, position);
CREATE INDEX IF NOT EXISTS idx_tracks_filter ON tracks(status, genre_id, bpm);
CREATE INDEX IF NOT EXISTS idx_tracks_camelot ON tracks(camelot);

CREATE TABLE IF NOT EXISTS track_artists (
  track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id   TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('primary','remixer','featured')),
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, artist_id, role)
);
CREATE INDEX IF NOT EXISTS idx_track_artists_artist ON track_artists(artist_id);

-- ---------- Search (maintained by the catalog service) ----------
CREATE VIRTUAL TABLE IF NOT EXISTS store_search USING fts5(
  kind UNINDEXED, item_id UNINDEXED, marketplace UNINDEXED, title, people, tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ---------- Cart, checkout, orders ----------
CREATE TABLE IF NOT EXISTS promo_codes (
  code             TEXT PRIMARY KEY COLLATE NOCASE,
  percent_bps      INTEGER NOT NULL CHECK (percent_bps BETWEEN 1 AND 9000),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  max_redemptions  INTEGER,
  redemptions      INTEGER NOT NULL DEFAULT 0,
  once_per_user    INTEGER NOT NULL DEFAULT 1 CHECK (once_per_user IN (0,1)),
  ends_at          INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_key    TEXT NOT NULL,                       -- "beat:b1" | "pack:k1" | "track:t1" | "release:r1"
  kind        TEXT NOT NULL CHECK (kind IN ('beat','pack','track','release')),
  item_id     TEXT NOT NULL,
  license_id  TEXT REFERENCES licenses(id),
  format      TEXT CHECK (format IS NULL OR format IN ('WAV','AIFF','MP3')),
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, line_key)
);

CREATE TABLE IF NOT EXISTS store_checkouts (         -- one payment; one order per marketplace
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key  TEXT NOT NULL,
  payment_id       TEXT REFERENCES payments(id),
  status           TEXT NOT NULL CHECK (status IN ('requires_payment','paid','failed','cancelled','free')),
  promo_code       TEXT,
  email            TEXT NOT NULL,
  legal_name       TEXT NOT NULL,
  alias            TEXT,
  country          TEXT NOT NULL,
  postal_code      TEXT NOT NULL,
  subtotal_cents   INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents   INTEGER NOT NULL CHECK (discount_cents >= 0),
  fee_cents        INTEGER NOT NULL CHECK (fee_cents >= 0),
  tax_cents        INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  currency         TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_checkouts_user ON store_checkouts(user_id, created_at);

CREATE TABLE IF NOT EXISTS store_orders (
  id              TEXT PRIMARY KEY,                -- TBB-XXXX-XXX / TBE-XXXX-XXX
  checkout_id     TEXT NOT NULL REFERENCES store_checkouts(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marketplace     TEXT NOT NULL CHECK (marketplace IN ('beats','electronic')),
  status          TEXT NOT NULL CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  subtotal_cents  INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents  INTEGER NOT NULL CHECK (discount_cents >= 0),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  currency        TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  paid_at         INTEGER,
  UNIQUE (checkout_id, marketplace)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON store_orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON store_orders(status, paid_at);

CREATE TABLE IF NOT EXISTS order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('beat','pack','track','release')),
  item_id         TEXT NOT NULL,
  license_id      TEXT REFERENCES licenses(id),
  format          TEXT CHECK (format IS NULL OR format IN ('WAV','AIFF','MP3')),
  title           TEXT NOT NULL,                   -- snapshot at purchase time
  seller_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  unit_cents      INTEGER NOT NULL CHECK (unit_cents >= 0),
  discount_cents  INTEGER NOT NULL CHECK (discount_cents >= 0),
  paid_cents      INTEGER NOT NULL CHECK (paid_cents >= 0),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0),   -- platform commission on this line
  seller_cents    INTEGER NOT NULL CHECK (seller_cents >= 0),
  created_at      INTEGER NOT NULL,
  CHECK (paid_cents = unit_cents - discount_cents),
  CHECK (seller_cents + fee_cents = paid_cents)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_seller ON order_items(seller_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_item ON order_items(kind, item_id);

-- What a customer owns. One entitlement per purchased line; beats can hold several license tiers.
CREATE TABLE IF NOT EXISTS entitlements (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('beat','pack','track','release')),
  item_id        TEXT NOT NULL,
  license_id     TEXT REFERENCES licenses(id),
  format         TEXT,
  order_item_id  TEXT UNIQUE REFERENCES order_items(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  revoked_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id, kind, item_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlement_active ON entitlements(user_id, kind, item_id, COALESCE(license_id, '')) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS downloads (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_id  TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  file            TEXT NOT NULL,                   -- master | stems | pack | release
  format          TEXT NOT NULL,
  filename        TEXT NOT NULL,
  bytes           INTEGER NOT NULL DEFAULT 0,
  file_path       TEXT,                            -- prepared file in the private cache
  status          TEXT NOT NULL CHECK (status IN ('preparing','ready','completed','failed')),
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id, created_at);

-- ---------- Collections ----------
CREATE TABLE IF NOT EXISTS favorites (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('beat','pack','track','release')),
  item_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_item ON favorites(kind, item_id);

CREATE TABLE IF NOT EXISTS store_follows (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('producer','artist','label')),
  target_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_store_follows_target ON store_follows(target_kind, target_id);

CREATE TABLE IF NOT EXISTS playlists (               -- "beats" playlists and electronic DJ "crates"
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('beats','crate')),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  is_public   INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),   -- shown on the owner’s storefront
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id, kind, updated_at);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id  TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  position     INTEGER NOT NULL,
  added_at     INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, item_id)
);

CREATE TABLE IF NOT EXISTS plays (                   -- counted preview plays (deduplicated per listener)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('beat','pack','track')),
  item_id     TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  listener    TEXT NOT NULL,                       -- user id or hashed IP + UA
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plays_item ON plays(kind, item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plays_listener ON plays(listener, kind, item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id, created_at);

CREATE TABLE IF NOT EXISTS producer_reviews (        -- verified-purchase reviews only
  id             TEXT PRIMARY KEY,
  producer_id    TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_item_id  TEXT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body           TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_producer ON producer_reviews(producer_id, created_at);

CREATE TABLE IF NOT EXISTS store_search_log (          -- powers "trending searches" (normalised queries only)
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace  TEXT CHECK (marketplace IS NULL OR marketplace IN ('beats','electronic')),
  query        TEXT NOT NULL CHECK (length(query) BETWEEN 2 AND 80),
  results      INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_log_time ON store_search_log(created_at);
