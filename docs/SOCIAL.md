# TUNIBEAT Social: architecture and production checklist

TUNIBEAT Social (`#/social/*`) is a separate product area with its own shell. The two stores and the social network share one Node server and one account system. This document describes what is built, how money moves, and what must be configured before real users or real money.

## Runtime

| Piece | Implementation |
|---|---|
| Server | Node 22.13+ (`node:http`, no framework). `server/app.js` wires modules; `server/index.js` starts it |
| Database | SQLite via `node:sqlite` (WAL). Schema: `server/db/schema.sql` (CHECK constraints, unique idempotency keys, partial unique indexes, FTS5 search with triggers) |
| Transactions | `db.tx()` uses `BEGIN IMMEDIATE` with savepoints for nesting, so every money movement is atomic |
| Real time | One WebSocket endpoint (`/ws`, package `ws`). `server/lib/realtime.js` is a channel hub; modules register subscribe guards and handlers |
| Sessions | Random tokens in an HttpOnly cookie; only a SHA-256 hash is stored. Mutating requests need the `x-tunibeat-csrf: 1` header |
| Abuse limits | Token-bucket rate limits per user and IP (`server/lib/ratelimit.js`) |
| Security headers | Strict CSP (no inline scripts), `nosniff`, sandboxed CSP on user media, `Cross-Origin-Resource-Policy` |

### Modules (`server/modules/`)

`auth` (sign-up, sign-in, sessions, email verification, demo sign-in in development only) · `users` (profiles, follow requests, blocks, mutes, close friends, privacy) · `media` (chunked resumable uploads, magic-byte sniffing, image dimensions, size limits) · `posts` (posts, reels, comments, reactions, saves, shares, mentions, tags) · `feed` (ranked "For You" with snapshot cursors, following, latest, reels) · `stories` (24 h stories, audiences, views, replies) · `search` (FTS5 users, posts and hashtags) · `messages` (DMs, message requests, read receipts, typing) · `notifications` · `live` (live sessions, chat, moderation, gifts, WebRTC signalling) · `wallet` (credits, gifts, donations, ledger) · `creator` (earnings, withdrawals) · `moderation` (reports, actions, appeals) · `admin` (review queues, monetisation settings, ledger reconciliation).

## Money

Credits and money are kept separate.

- **Credits** are bought with a real payment (a sandbox payment in development) and are spent only on **gifts**.
- **Donations/tips** are direct payments to a creator. Each tip is a new payment through the provider, never credits.
- **Creator earnings** start as *pending*. They become *available* after `earnings_hold_seconds` (7 days by default), which covers the refund and chargeback window. Only available earnings can be withdrawn.
- **Withdrawals**: an email confirmation code is required; amounts above `review_threshold_cents` go to manual review first. The payout adapter settles the withdrawal, and failed payouts are reversed in the ledger.
- **Ledger**: every balance change writes a `transactions` row inside the same database transaction as the balance update. `GET /api/admin/ledger/reconcile` recomputes every balance from the ledger and reports mismatches. The money tests (`tests/api/money.test.js`) run it after each scenario.
- **Idempotency**: every payment, gift, donation and withdrawal needs an `idempotency_key`. A replayed request returns the original result; it never charges or credits twice. Webhooks are HMAC-signed and replay-protected by event id.
- **Anti-fraud**: minimum account age before gifting, per-minute and daily credit limits, no self-gifting, blocked users can't gift or tip, and rate limits on every payment route.

Defaults live in `DEFAULT_SETTINGS` (`server/modules/wallet.js`). Admins can override them at `#/social/admin`.

### Payment and payout providers (`server/adapters/`)

| Adapter | Development | Production |
|---|---|---|
| `payments.js` | `sandbox`: an in-app test checkout (approve or decline) that sends a signed webhook through the real webhook path. No card data is collected and nothing is charged | `stripe`: Stripe Checkout over the REST API. **Written against Stripe's documented API but not exercised here**, because no credentials were available. Needs `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, plus an end-to-end test in Stripe test mode |
| `payouts.js` | `sandbox`: settles withdrawals asynchronously | Needs a real payouts provider (for example Stripe Connect Express), including KYC and tax forms |
| `mail.js` | Dev outbox, readable under Settings → Developer outbox | Needs SMTP, SES or Postmark. Until one is configured, sending fails closed |
| `transcoder.js` | Uses ffmpeg if it is on `PATH` (720p H.264 MP4 with faststart); otherwise serves the validated original | A managed pipeline (Mux, AWS MediaConvert) for HLS ladders and thumbnails |

In production (`NODE_ENV=production`), payments and payouts default to `none`, so nothing works until a real provider is configured. Demo sign-in and the sandbox are disabled.

## Live streaming

The live transport is a **WebRTC mesh**: the host's browser sends media directly to each viewer, and the server only relays signalling over the WebSocket. It is real and low-latency, but the host's upload bandwidth caps the audience (`LIVE_MESH_MAX_VIEWERS`, 20 by default). If the host disconnects, the stream shows "reconnecting" for `LIVE_RECONNECT_GRACE_MS` before it ends.

For production:

- Use an SFU: LiveKit or mediasoup, or a managed service such as Cloudflare Stream, Mux Live or IVS.
- Configure TURN servers through `ICE_SERVERS`. Without TURN, viewers behind symmetric NAT can't connect.
- Chat, gifts, moderation and viewer counts already run on the server, so they don't change when the transport does.

## Environment

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Secure cookies, no dev tools, payments and payouts off until configured |
| `PORT`, `HOST`, `PUBLIC_URL` | Listener and public URL (used for payment return URLs) |
| `DATA_DIR` | Database and uploaded media (default `server/data`) |
| `WEB_ROOT` | Front-end root: `.` in development, `dist` after `npm run build` |
| `MEDIA_BASE_URL` | Serve media from a CDN |
| `PAYMENTS_PROVIDER` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `SANDBOX_WEBHOOK_SECRET` | Payments |
| `PAYOUTS_PROVIDER` | Payouts |
| `LIVE_TRANSPORT` · `LIVE_MESH_MAX_VIEWERS` · `LIVE_RECONNECT_GRACE_MS` · `ICE_SERVERS` | Live |
| `STORY_LIFETIME_MS` · `DEV_TOOLS` · `COOKIE_SECURE` | Misc |

## Still required for production

- **Real payment and payout providers**: live credentials, an end-to-end test in the provider's test mode, and legal review of the credits and gifts terms.
- **Email provider**: for verification codes and withdrawal confirmations.
- **Live SFU and TURN**: for audiences beyond a handful of viewers.
- **Media**: object storage and a CDN for uploads, plus a transcoding pipeline (HLS).
- **Web Push** notifications: the in-app and WebSocket notifications work, but push to closed tabs does not exist yet.
- **Database scale**: SQLite with WAL works on one server. Move to Postgres before running more than one server process.
- **Moderation at scale**: automated image and video scanning (CSAM hash matching is a legal requirement in many jurisdictions) and a trust-and-safety runbook.
- **Backups**: backups of the database and the media store.
