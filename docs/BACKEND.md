# Backend: architecture, data model and API

The TUNIBEAT server (`server/`) is a single Node process (Node 22.13+, no framework) with SQLite (`node:sqlite`, WAL mode) as the database, worker threads for audio, and a WebSocket hub for real-time events. It serves the static front end, the JSON API under `/api`, public media under `/media`, and nothing else. The stores and Social share accounts, sessions, payments, the ledger, notifications, moderation and media.

## Layout

```
server/
  index.js                 process entry (signals, graceful shutdown)
  app.js                   HTTP server: security headers, CSRF, auth, routing, errors, static files, module registry
  config.js                env → config (see .env.example); production refuses to start without DOWNLOAD_SECRET
  lib/db.js                SQLite wrapper (tx, get/all/run), schema versioning (PRAGMA user_version)
  lib/http.js              HttpError family, JSON/body parsing, sendFile (ETag, Range), path safety
  lib/ratelimit.js         token buckets per action (login, login_account, auth_code, cart, download, upload, …)
  lib/text.js              plain(): strips markup/control characters from user-supplied store text
  lib/audio/               codec (WAV/AIFF/MP3), zip writer/reader, worker (ingest/master/stems/pack jobs), job pool + cache
  lib/realtime.js          WebSocket hub (per-user fan-out, rooms)
  db/schema.sql            accounts, social, media, payments, wallet, ledger, moderation
  db/schema-store.sql      store catalog, commerce, entitlements, downloads, collections
  db/migrations.js         versioned migrations (table rebuilds where CHECK constraints change)
  modules/                 one module per domain; each exports register(router, S) and optional jobs(S)
    auth.js users.js posts.js … wallet.js creator.js admin.js moderation.js media.js notifications.js
    store/catalog.js       read models, bootstrap (ETag), list/detail endpoints, FTS search, genre admin
    store/pricing.js       integer-cent pricing: licenses, tracks, releases, bundle, promo, fees, commission
    store/commerce.js      cart, quote, checkout, exclusive holds, settlement, orders, receipts, refunds
    store/library.js       entitlements, download preparation, signed links, license agreements
    store/collections.js   favourites, follows, playlists/crates, play counting
    store/seller.js        seller dashboard, catalog, beat/release upload + ingest, producer profile, reviews
  seed.js seed-store.js seed-data/   development data created through the real services
```

`S` (the service context) carries `db`, `cfg`, `now()` (overridable clock — tests use it), `limiter`, `payments`, `payouts`, `mail`, `rt`, `audio`, `log`.

## Request pipeline (`app.js`)

1. Security headers on every response (CSP with `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies).
2. Route match → 404/405.
3. **CSRF**: every non-GET/HEAD request must carry `x-tunibeat-csrf: 1` (browsers only send custom headers same-origin; CORS is not enabled). Payment webhooks are exempt and authenticated by signature instead.
4. **Session**: `tb_sid` cookie (HttpOnly, SameSite=Lax, Secure in production) → SHA-256 lookup in `sessions`. The raw token is never stored.
5. Route options: `public`, `role: "admin"`, `dev` (dev tools only), `raw` body, `webhook`.
6. JSON body parsing with size limits; handler; JSON response. Errors are `HttpError(status, code, message, extra)` → `{ error: { code, message, … } }`. Expected constraint violations become `409 conflict`; anything unexpected is logged server-side and returned as a generic `500 internal` without internals.

## Authentication and accounts

- Passwords: scrypt (N=2¹⁴, r=8, p=1), per-user salt, constant-time comparison. Rules: 10–200 characters, not in the common-password list, not containing the username or email name (identifiers of 4+ characters).
- Login protection: per-IP and per-account rate limits; after 10 consecutive failures the account locks for 15 minutes; unknown accounts get the same response and timing as wrong passwords.
- Email verification: 6-digit code, stored hashed, 30-minute expiry, 5 attempts per code, resend rate-limited. Selling requires a verified email.
- Password reset: single-use token (hashed), 30 minutes, never reveals whether an email exists; resetting revokes every session.
- Password change keeps only the current session; sessions can be listed and revoked individually.
- Mail is delivered through a mail adapter. **In this repository the only adapter is the development outbox** (`GET /api/dev/mail`, dev tools only) — no SMTP/SES provider is wired.

## Data model (store)

All money is integer cents. Key constraints:

| Table | Notes |
|---|---|
| `beats`, `packs`, `releases`, `tracks` | FK to producer/label/artist; `status` CHECK (processing, draft, published, removed, sold_exclusive); exclusive hold columns |
| `audio_assets` | one per sellable audio; `source` synth/upload; master/stems media FKs (private); analysis JSON; status processing/ready/failed |
| `licenses` | tier definitions (price, formats, terms) |
| `store_checkouts` | one payment; unique `(user_id, idempotency_key)`; totals CHECK ≥ 0 |
| `store_orders` | one per marketplace per checkout; status pending/paid/failed/cancelled/refunded |
| `order_items` | CHECK `paid = unit − discount` and `seller + fee = paid` |
| `entitlements` | what a user owns; partial unique index on active (user, kind, item, license); `revoked_at` on refund |
| `downloads` | prepared files; status preparing/ready/completed/failed; file path in the private dir |
| `earnings`, `creator_balances`, `transactions` | seller money: pending → available after the hold; every movement has ledger rows; `/api/admin/ledger/reconcile` checks balances = ledger |
| `favorites`, `store_follows`, `playlists`, `playlist_items`, `plays`, `producer_reviews`, `store_search_log`, `store_search` (FTS5) | collections, analytics and search |

Migrations: a new database is created from the schema files and stamped with the latest version. Existing databases run each newer migration inside a transaction with foreign keys off, followed by `PRAGMA foreign_key_check`. Version 2 (stores, account security, private media) was verified once against a copy of the pre-migration development database; the automated test covers fresh databases and idempotent reopen.

## Commerce flow

1. **Cart** (`PUT /api/store/cart`) stores item references only — never prices.
2. **Quote** (`POST /api/store/quote`) resolves every line on the server: availability, ownership, own items, license/format validity, stems availability for stem tiers, exclusive holds. Problems are returned per line, never silently dropped. Pricing: license base × producer multiplier; tracks $1.49 (+$0.50 lossless); releases 20% below the sum of their tracks; 20% bundle discount on 3+ beats; promo codes (percent, once per user, redemption caps); $1.49 service fee on orders with beats; commission 15% beats / 20% electronic.
3. **Checkout** (`POST /api/store/checkout`) requires an idempotency key (same key → same checkout), optional `expected_total_cents` (→ `409 price_changed`), validates buyer details, supersedes older unpaid checkouts, places a 30-minute hold on exclusive rights, and opens a payment with the provider adapter.
4. **Settlement** happens only on a verified provider event (signed webhook, or the sandbox completion endpoint which emits one). In one transaction: orders paid, entitlements granted, exclusives marked sold, seller earnings recorded as pending, ledger rows written, promo redeemed, lines removed from the cart. Replayed events are no-ops.
5. **Refunds** (`POST /api/admin/store-checkouts/:id/refund`, admin): provider refund first, then atomically: orders refunded, entitlements revoked, seller earnings reversed from the bucket they are in (refused if already withdrawn), ledger rows, moderation log. A refunded exclusive returns to the producer as a draft.
6. Unpaid checkouts expire (job) and release their holds.

## Downloads

`POST /api/store/library/:entitlement/downloads {file, format}` prepares a file in the audio worker pool (decode master → encode WAV/AIFF/MP3, or build a stems/pack/release ZIP), deduplicated and cached on disk (LRU trimmed to `AUDIO_CACHE_MAX_MB`). The response carries a link signed with HMAC-SHA256 over `download id . user id . expiry` (15 minutes). `GET …/file` requires the same signed-in account, a valid signature, an unexpired link and a still-active entitlement; supports Range. Masters, stems and prepared files live in `PRIVATE_DIR` and are never served by `/media`.

## Audio pipeline

`server/lib/audio/` decodes WAV (PCM 16/24/32, float) and AIFF/AIFC, encodes WAV/AIFF and MP3 (LAME via `@breezystack/lamejs`), and runs the same DSP module the browser uses (`js/music/dsp.js`: STFT band energies, true peaks, beat tracking, key estimation, sections). Uploaded masters are validated by header sniffing, analysed (tempo, beat grid, key, cues), and a preview clip, waveform file and analysis JSON are written. Preview files are public only once the item is published (owners can always preview). No ffmpeg: formats outside WAV/AIFF are rejected at upload.

## Uploads

Chunked and resumable: `POST /api/media/uploads` (purpose, MIME, size — checked against per-purpose allow lists and limits) → `PUT …/chunks/:i` (out of order, retries) → `POST …/complete` (size and optional SHA-256 verified, content sniffed). Purposes `master_audio` (WAV/AIFF, 700 MB), `stems_archive` (ZIP, 1.5 GB; only WAV/AIFF/TXT/PDF entries, no path tricks), `artwork` (JPEG/PNG/WebP, dimensions read from the file). Masters and stems are stored privately; abandoned upload sessions expire and their partial files are deleted by a job (every 10 minutes).

## Real-time

WebSocket `/ws` (session cookie). Store events: `store:checkout` (buyer: payment settled), `store:sale` (seller), `earnings` (balance changes). Social uses the same hub for DMs, notifications, live rooms and presence.

## API index (store, seller, auth)

Auth: `POST /api/auth/signup | login | logout | logout-others | verify-email | verify-email/resend | password/forgot | password/reset | password/change`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `GET /api/me`, `GET /api/health`.

Catalog (public): `GET /api/store/bootstrap` (ETag), `/api/store/beats`, `/api/store/tracks` (filters, sort, pagination), `/api/store/beats/:id`, `/api/store/releases/:id`, `/api/store/producers/:handle`, `/api/store/search`, `/api/store/audio/:asset/:file`.

Commerce: `GET|PUT /api/store/cart`, `POST /api/store/cart/items`, `DELETE /api/store/cart/items/:key`, `POST /api/store/quote | promo | checkout`, `GET /api/store/checkouts/:id`, `POST /api/store/checkouts/:id/cancel`, `GET /api/store/orders`, `GET /api/store/orders/:id/receipt`.

Library: `GET /api/store/library`, `POST /api/store/library/:id/downloads`, `GET /api/store/downloads/:id`, `GET /api/store/downloads/:id/file`, `GET /api/store/library/:id/license`, `POST /api/store/beats/:id/free-download`, `POST /api/store/reviews`.

Collections: `GET /api/store/me`, `PUT|DELETE /api/store/favorites/:kind/:id`, `PUT|DELETE /api/store/follows/:kind/:id`, `POST /api/store/playlists`, `PATCH|DELETE /api/store/playlists/:id`, `POST /api/store/playlists/:id/items`, `DELETE /api/store/playlists/:id/items/:item`, `POST /api/store/plays`, `DELETE /api/store/recent`.

Seller: `GET /api/seller/dashboard?marketplace=`, `GET /api/seller/catalog`, `PATCH /api/seller/producer`, `POST /api/seller/beats`, `PATCH /api/seller/beats/:id`, `POST /api/seller/releases`, `PATCH /api/seller/releases/:id`.

Admin: `GET|POST /api/store/admin/genres`, `PATCH /api/store/admin/genres/:id`, `POST /api/admin/store-checkouts/:id/refund`, `GET /api/admin/ledger/reconcile`, plus the Social admin endpoints (docs/SOCIAL.md).

## What is not production-ready (and why)

- **Database**: SQLite in one process. Fine for a single server; horizontal scaling needs PostgreSQL (not installed in this environment) and the in-memory rate limiter / job scheduling moved to Redis or the database.
- **Payments**: the sandbox adapter is fully exercised by tests. The Stripe adapter exists but has not been run against Stripe (no keys here). Payouts are sandbox only.
- **Email**: development outbox only; a real mail provider adapter is needed before launch.
- **Audio**: no ffmpeg in this environment, so only WAV/AIFF masters are accepted and MP3 is encoded in JavaScript (slower than native). Key detection is an estimate (about 24–50% exact on the synthetic catalog; tempo was exact on 38/38).
- **Catalog audio**: the seeded catalog's audio is synthesised (original, generated from metadata). Real uploads go through the real pipeline.
- **Tax**: `tax_cents` is always 0; no tax engine is integrated.
