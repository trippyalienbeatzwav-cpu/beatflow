// Composition root: builds the HTTP server, database, real-time hub and feature modules.
// createApp() is used by server/index.js and by the API and E2E tests, which each get an isolated database.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "./config.js";
import { openDb } from "./lib/db.js";
import { Router, HttpError, sendJson, sendFile, safeJoin, readJson } from "./lib/http.js";
import { createLimiter } from "./lib/ratelimit.js";
import { createRealtime } from "./lib/realtime.js";
import { createPaymentProvider } from "./adapters/payments.js";
import { createPayoutProvider } from "./adapters/payouts.js";
import { createMailer } from "./adapters/mail.js";
import { createTranscoder } from "./adapters/transcoder.js";

import * as auth from "./modules/auth.js";
import * as users from "./modules/users.js";
import * as media from "./modules/media.js";
import * as notifications from "./modules/notifications.js";
import * as posts from "./modules/posts.js";
import * as feed from "./modules/feed.js";
import * as stories from "./modules/stories.js";
import * as search from "./modules/search.js";
import * as messages from "./modules/messages.js";
import * as live from "./modules/live.js";
import * as wallet from "./modules/wallet.js";
import * as creator from "./modules/creator.js";
import * as moderation from "./modules/moderation.js";
import * as admin from "./modules/admin.js";
import * as storeCatalog from "./modules/store/catalog.js";
import * as storeCommerce from "./modules/store/commerce.js";
import * as storeLibrary from "./modules/store/library.js";
import * as storeCollections from "./modules/store/collections.js";
import * as storeSeller from "./modules/store/seller.js";
import { createAudioJobs } from "./lib/audio/jobs.js";
import { seedIfEmpty } from "./seed.js";

/** @type {any[]} Feature modules: each may export register, init, jobs and stop. */
const MODULES = [auth, users, media, notifications, posts, feed, stories, search, messages, live, wallet, creator, moderation, admin, storeCatalog, storeCommerce, storeLibrary, storeCollections, storeSeller];

export async function createApp(opts = {}) {
  const cfg = loadConfig(opts.config ?? {});
  const dbFile = opts.dbFile ?? path.join(cfg.dataDir, "social.db");
  const db = openDb(dbFile);
  const log = opts.quiet ? () => {} : (...a) => console.log("[tunibeat]", ...a);
  const limiter = createLimiter();
  if (opts.disableRateLimits) limiter.setEnabled(false);

  const S = {
    cfg, db, log, limiter,
    now: () => Date.now(),
    mediaDir: path.join(cfg.dataDir, "media"),
    privateDir: cfg.privateDir,
    audio: createAudioJobs({ cacheDir: path.join(cfg.privateDir, "cache"), cacheMaxBytes: cfg.audioCacheMaxMb * 1024 * 1024, ...(cfg.audioWorkers ? { workers: cfg.audioWorkers } : {}), log: (...a) => log(...a) }),
    mediaUrl: (key) => (key ? `${cfg.mediaBaseUrl}/media/${key}` : null),
    payments: createPaymentProvider(cfg),
    payouts: createPayoutProvider(cfg),
    mail: null, transcoder: createTranscoder(),
    rt: null,
  };
  fs.mkdirSync(S.mediaDir, { recursive: true });
  S.mail = createMailer(S);
  S.rt = createRealtime({ authenticate: (req) => auth.authenticate(S, req), log });

  const router = new Router();
  for (const m of MODULES) m.register?.(router, S);
  for (const m of MODULES) m.init?.(S);

  if (opts.seed !== false) await seedIfEmpty(S, { log });

  const server = http.createServer((req, res) => handle(req, res).catch((err) => fail(res, err)));

  function fail(res, err) {
    if (res.headersSent) { res.destroy(); return; }
    if (err instanceof HttpError) return sendJson(res, err.status, { error: { code: err.code, message: err.message, ...(err.extra ?? {}) } });
    // SQLite constraint violations are client errors only when they are expected (unique keys, checks)
    if (err?.code === "ERR_SQLITE_ERROR" && /constraint/i.test(err.message)) {
      log("constraint", err.message);
      return sendJson(res, 409, { error: { code: "conflict", message: "That change conflicts with the current state. Refresh and try again." } });
    }
    log("unhandled", err);
    sendJson(res, 500, { error: { code: "internal", message: "Something went wrong on our side." } });
  }

  const SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
  };
  const CSP = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:" + (cfg.mediaBaseUrl ? " " + cfg.mediaBaseUrl : ""),
    "media-src 'self' blob:" + (cfg.mediaBaseUrl ? " " + cfg.mediaBaseUrl : ""), "connect-src 'self' ws: wss:", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
  ].join("; ");

  async function handle(req, res) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, "http://local");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      const hit = router.match(req.method, pathname);
      if (!hit) throw new HttpError(404, "not_found", "Unknown API endpoint.");
      if (hit.methodNotAllowed) throw new HttpError(405, "method_not_allowed", "Method not allowed.");
      const { route, params } = hit;
      const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress, S };
      // CSRF: state-changing requests must carry a custom header, which browsers only allow same-origin (no CORS is enabled).
      // Provider webhooks are authenticated by signature instead.
      if (req.method !== "GET" && req.method !== "HEAD" && !route.opts.webhook && req.headers["x-tunibeat-csrf"] !== "1") {
        throw new HttpError(403, "csrf", "Missing CSRF header.");
      }
      const a = auth.authenticate(S, req);
      ctx.user = a?.user ?? null; ctx.session = a?.session ?? null;
      if (!route.opts.public && !ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
      if (route.opts.role && !(ctx.user && (ctx.user.role === "admin" || ctx.user.role === route.opts.role))) throw new HttpError(403, "forbidden", "Staff only.");
      if (route.opts.dev && !cfg.devTools) throw new HttpError(404, "not_found", "Unknown API endpoint.");
      if (!route.opts.raw && req.method !== "GET" && req.method !== "DELETE") ctx.body = await readJson(req, route.opts.bodyLimit);
      else ctx.body = {};
      if (!route.opts.raw) ctx.body = ctx.body ?? {};
      const out = await route.handler(ctx);
      if (res.writableEnded || res.headersSent) return;
      sendJson(res, out?.__status ?? 200, out?.__status ? out.body : out ?? { ok: true });
      return;
    }

    if (pathname.startsWith("/media/")) {
      const key = pathname.slice("/media/".length);
      if (!/^[a-z0-9_]+\/[a-zA-Z0-9_.-]+$/.test(key)) throw new HttpError(404, "not_found", "Not found");
      const row = media.lookupKey(S, key);
      if (!row || row.access === "private") throw new HttpError(404, "not_found", "Not found");
      const file = path.join(S.mediaDir, key);
      const disposition = row.kind === "file" ? { "Content-Disposition": "attachment" } : {};
      const ok = sendFile(req, res, file, {
        type: row.mime, cache: "public, max-age=31536000, immutable",
        extraHeaders: { "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox", "Cross-Origin-Resource-Policy": "same-origin", ...disposition },
      });
      if (!ok) throw new HttpError(404, "not_found", "Not found");
      return;
    }

    // Static SPA files. Only the public front-end folders are served, never server/ or node_modules/.
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method_not_allowed", "Method not allowed.");
    const rel = pathname === "/" ? "/index.html" : pathname;
    if (!/^\/(index\.html|favicon\.ico|css\/[\w./-]+|js\/[\w./-]+|assets\/[\w./-]+)$/.test(rel)) throw new HttpError(404, "not_found", "Not found");
    const file = safeJoin(cfg.webRoot, rel);
    if (!file) throw new HttpError(404, "not_found", "Not found");
    const isHtml = rel.endsWith(".html");
    // Content-hashed bundles never change; everything else revalidates
    const cache = /.[0-9a-f]{10}.(js|css)$/.test(rel) ? "public, max-age=31536000, immutable" : "no-cache";
    const ok = sendFile(req, res, file, { cache, extraHeaders: isHtml ? { "Content-Security-Policy": CSP } : {} });
    if (!ok) throw new HttpError(404, "not_found", "Not found");
  }

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://local").pathname !== "/ws") { socket.destroy(); return; }
    S.rt.handleUpgrade(req, socket, head);
  });

  const timers = [];
  S.every = (ms, fn) => { const t = setInterval(() => { try { fn(); } catch (e) { log("job error", e); } }, ms); t.unref(); timers.push(t); };
  for (const m of MODULES) m.jobs?.(S);

  return {
    S, db, server, router,
    listen(port = cfg.port, host = cfg.host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      S.closed = true;
      timers.forEach(clearInterval);
      for (const m of MODULES) m.stop?.(S);
      S.rt.close();
      await new Promise((r) => server.close(() => r()));
      await S.audio.close();
      db.close();
    },
  };
}

export { readJson };
