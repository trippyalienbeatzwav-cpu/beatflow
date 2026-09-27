// Runtime configuration. Everything that differs between development and production
// comes from the environment; defaults are safe for local development only.
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const bool = (v, d) => (v == null ? d : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(overrides = {}) {
  const production = (overrides.env ?? env.NODE_ENV) === "production";
  const cfg = {
    env: production ? "production" : "development",
    port: Number(env.PORT ?? 5173),
    host: env.HOST ?? "127.0.0.1",
    publicUrl: env.PUBLIC_URL ?? null,
    // Front-end root: the repository in development, dist/ after `npm run build` (WEB_ROOT=dist)
    webRoot: path.resolve(here, "..", env.WEB_ROOT ?? "."),
    dataDir: path.resolve(env.DATA_DIR ?? path.join(here, "data")),
    seedMediaDir: path.join(here, "seed-media"),
    // Media is served from this origin in development. Point MEDIA_BASE_URL at a CDN in production.
    mediaBaseUrl: env.MEDIA_BASE_URL ?? "",
    // Development tools: demo sign-in, dev mail outbox, sandbox payment pages. Never on in production.
    devTools: production ? false : bool(env.DEV_TOOLS, true),
    cookieSecure: bool(env.COOKIE_SECURE, production),
    sessionDays: 30,
    // Signs short-lived download links. Set it in production so links survive restarts and span servers.
    downloadSecret: env.DOWNLOAD_SECRET ?? crypto.randomBytes(32).toString("hex"),
    // Private files (uploaded masters, stems) and rendered downloads; never served statically
    privateDir: env.PRIVATE_DIR ? path.resolve(env.PRIVATE_DIR) : null,   // default: <dataDir>/private
    audioCacheMaxMb: Number(env.AUDIO_CACHE_MAX_MB ?? 5120),
    audioWorkers: env.AUDIO_WORKERS ? Number(env.AUDIO_WORKERS) : undefined,
    payments: {
      provider: env.PAYMENTS_PROVIDER ?? (production ? "none" : "sandbox"),
      sandboxWebhookSecret: env.SANDBOX_WEBHOOK_SECRET ?? crypto.randomBytes(24).toString("hex"),
      stripeSecretKey: env.STRIPE_SECRET_KEY ?? null,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
    },
    payouts: { provider: env.PAYOUTS_PROVIDER ?? (production ? "none" : "sandbox") },
    live: {
      // "webrtc-mesh": the host's browser sends WebRTC media straight to each viewer. Low latency with no
      // media server, but the host's upload limits the audience. Production should use an SFU
      // (LiveKit or mediasoup) or a managed service. See docs/SOCIAL.md.
      transport: env.LIVE_TRANSPORT ?? "webrtc-mesh",
      meshMaxViewers: Number(env.LIVE_MESH_MAX_VIEWERS ?? 20),
      iceServers: env.ICE_SERVERS ? JSON.parse(env.ICE_SERVERS) : [],
      hostReconnectGraceMs: Number(env.LIVE_RECONNECT_GRACE_MS ?? 60_000),
    },
    media: {
      maxImageBytes: 15 * 1024 * 1024,
      maxVideoBytes: 200 * 1024 * 1024,
      maxAudioBytes: 20 * 1024 * 1024,
      maxFileBytes: 25 * 1024 * 1024,
      maxMasterBytes: 700 * 1024 * 1024,      // lossless masters (e.g. 10 min, 24-bit / 96 kHz stereo ≈ 350 MB)
      maxStemsBytes: 1500 * 1024 * 1024,
      chunkSize: 1024 * 1024,
      uploadTtlMs: 6 * 60 * 60 * 1000,
    },
    storyLifetimeMs: Number(env.STORY_LIFETIME_MS ?? 24 * 60 * 60 * 1000),
    // Split hosting (front end on Vercel, this server elsewhere). The Vercel middleware adds the visitor's IP and
    // this shared secret to every proxied request; only then is the forwarded IP trusted (rate limits, logs).
    proxySecret: env.PROXY_SECRET || null,
    // WebSocket endpoint when it isn't same-origin (Vercel can't proxy WebSockets). Browsers get a one-time
    // ticket from /api/realtime/ticket and connect here directly. Render provides RENDER_EXTERNAL_URL.
    realtimeUrl: env.PUBLIC_WS_URL || (env.RENDER_EXTERNAL_URL ? `${env.RENDER_EXTERNAL_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws` : null),
    mail: {
      provider: env.MAIL_PROVIDER || (env.RESEND_API_KEY ? "resend" : null),
      resendApiKey: env.RESEND_API_KEY || null,
      from: env.MAIL_FROM || null,
    },
    ...overrides,
  };
  cfg.privateDir ??= path.join(cfg.dataDir, "private");
  // A per-process random secret would break every download link on restart and across servers
  if (production && !env.DOWNLOAD_SECRET && !overrides.downloadSecret) throw new Error("DOWNLOAD_SECRET must be set in production (32+ random bytes, hex).");
  if (production && String(cfg.downloadSecret).length < 32) throw new Error("DOWNLOAD_SECRET is too short (use 32+ random bytes, hex).");
  if (cfg.proxySecret && String(cfg.proxySecret).length < 24) throw new Error("PROXY_SECRET is too short (use 24+ random characters).");
  if (cfg.mail.provider === "resend" && (!cfg.mail.resendApiKey || !cfg.mail.from)) throw new Error("Resend mail needs RESEND_API_KEY and MAIL_FROM (e.g. \"TUNIBEAT <no-reply@yourdomain.com>\").");
  return cfg;
}
