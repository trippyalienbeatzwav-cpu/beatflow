// Accounts and sessions. Passwords are hashed with scrypt (off the event loop); sessions are random tokens
// held in an HttpOnly, SameSite=Lax cookie, with only their SHA-256 stored. Brute force is limited per IP
// and per account, with a temporary lockout after repeated failures. Email verification uses 6-digit codes
// and password reset uses single-use links; both are stored as hashes, expire, and cap attempts.
import crypto from "node:crypto";
import { promisify } from "node:util";
import { id, token, sha256 } from "../lib/ids.js";
import { bad, notFound, HttpError, parseCookies, setCookie } from "../lib/http.js";
import { selfUser, ensureUserRows } from "./users.js";

const COOKIE = "tb_sid";
const USERNAME = /^[a-z0-9_.]{3,24}$/i;
/** @type {(pw: string | Buffer, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>} */
const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const LOCK_AFTER = 10, LOCK_MS = 15 * 60_000;
const VERIFY_TTL = 30 * 60_000, RESET_TTL = 30 * 60_000, CODE_ATTEMPTS = 5;
const COMMON = new Set(["password123", "1234567890", "qwertyuiop", "password1234", "iloveyou123", "letmein1234", "tunibeat123", "passw0rd123", "0123456789", "abcdefghij"]);

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, s, k] = stored.split("$");
  const key = await scrypt(pw, Buffer.from(s, "base64"), 32, SCRYPT);
  const want = Buffer.from(k, "base64");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
function checkPassword(pw, { username = "", email = "" } = {}) {
  if (typeof pw !== "string" || pw.length < 10) throw bad("weak_password", "Use at least 10 characters.");
  if (pw.length > 200) throw bad("weak_password", "Passwords can be at most 200 characters.");
  const low = pw.toLowerCase();
  // Containing the username or email name only matters for identifiers long enough to guess from ("n@b.co" must not ban every "n")
  const ids = [username, email.split("@")[0]].map((s) => String(s).toLowerCase()).filter((s) => s.length >= 4);
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || ids.some((s) => low.includes(s))) {
    throw bad("weak_password", "That password is too easy to guess. Avoid your username and common passwords.");
  }
}

export function authenticate(S, req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw || raw.length > 100) return null;
  const now = S.now();
  const session = S.db.get("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?", sha256(raw), now);
  if (!session) return null;
  const user = S.db.get("SELECT * FROM users WHERE id = ?", session.user_id);
  if (!user || user.status !== "active") return null;
  if (now - session.last_seen > 60_000) S.db.run("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", now, session.token_hash);
  return { user, session };
}

/* ----- WebSocket tickets -----
   When the page and the API are on different origins (front end on Vercel, API elsewhere), the session cookie
   is not sent to the WebSocket host. The page asks for a ticket over the proxied API (cookie-authenticated),
   then opens wss://…/ws?ticket=…. Tickets are random, single-use, expire after 60 s and point at the session,
   so signing out or revoking the session also invalidates them. */
const TICKET_TTL_MS = 60_000;
function tickets(S) { return (S.wsTickets ??= new Map()); }
export function issueSocketTicket(S, session) {
  const t = token(), now = S.now(), map = tickets(S);
  for (const [k, v] of map) if (v.exp < now) map.delete(k);   // prune expired
  map.set(t, { tokenHash: session.token_hash, exp: now + TICKET_TTL_MS });
  return t;
}
/** Authenticate a WebSocket upgrade: a ticket if present, otherwise the session cookie (same-origin). */
export function authenticateSocket(S, req) {
  const ticket = new URL(req.url, "http://local").searchParams.get("ticket");
  if (!ticket) return authenticate(S, req);
  const map = tickets(S), t = map.get(ticket);
  map.delete(ticket);
  if (!t || t.exp < S.now()) return null;
  const session = S.db.get("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?", t.tokenHash, S.now());
  if (!session) return null;
  const user = S.db.get("SELECT * FROM users WHERE id = ?", session.user_id);
  if (!user || user.status !== "active") return null;
  return { user, session };
}

function startSession(S, req, res, userId) {
  const t = token();
  const now = S.now();
  S.db.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, user_agent) VALUES (?,?,?,?,?,?)", sha256(t), userId, now, now + S.cfg.sessionDays * 864e5, now, String(req.headers["user-agent"] ?? "").slice(0, 160));
  setCookie(res, COOKIE, t, { maxAge: S.cfg.sessionDays * 864e5, secure: S.cfg.cookieSecure });
}

/* ------------------------------------------------------------------ one-time codes */
function issueToken(S, userId, purpose) {
  const now = S.now();
  S.db.run("UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL", now, userId, purpose);   // only the newest works
  const secret = purpose === "verify_email" ? String(crypto.randomInt(0, 1_000_000)).padStart(6, "0") : token(32);
  // Codes are hashed with the user id so equal codes of different users never collide
  S.db.run("INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)",
    id("at"), userId, purpose, sha256(`${purpose}:${userId}:${secret}`), now + (purpose === "verify_email" ? VERIFY_TTL : RESET_TTL), now);
  return secret;
}
function sendVerification(S, user) {
  const code = issueToken(S, user.id, "verify_email");
  S.mail.send({ userId: user.id, subject: "Your TUNIBEAT verification code", body: `Your code is ${code}. It expires in 30 minutes. If you didn’t create an account, ignore this email.` });
}

export function register(r, S) {
  r.post("/api/auth/signup", async ({ body, req, res, ip }) => {
    S.limiter.take("signup", ip);
    const username = String(body.username ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = body.password;
    const display = String(body.display_name ?? "").trim() || username;
    if (!USERNAME.test(username)) throw bad("invalid_username", "Usernames are 3–24 letters, numbers, dots or underscores.");
    if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw bad("invalid_email", "Enter a valid email address.");
    checkPassword(password, { username, email });
    if (display.length > 50) throw bad("invalid_name", "Display names are at most 50 characters.");
    if (S.db.get("SELECT 1 FROM users WHERE username = ?", username)) throw new HttpError(409, "username_taken", "That username is taken.");
    if (S.db.get("SELECT 1 FROM users WHERE email = ?", email)) throw new HttpError(409, "email_taken", "An account with that email already exists.");
    const hash = await hashPassword(password);
    const uid = id("u");
    S.db.tx(() => {
      S.db.run("INSERT INTO users (id, username, email, password_hash, display_name, created_at, password_changed_at) VALUES (?,?,?,?,?,?,?)", uid, username, email, hash, display, S.now(), S.now());
      ensureUserRows(S, uid);
    });
    try { sendVerification(S, S.db.get("SELECT * FROM users WHERE id = ?", uid)); } catch (err) { S.log("verification mail failed", err.message); }
    startSession(S, req, res, uid);
    return { user: selfUser(S, uid) };
  }, { public: true });

  r.post("/api/auth/login", async ({ body, req, res, ip }) => {
    S.limiter.take("login", ip);
    const login = String(body.login ?? "").trim().slice(0, 254);
    S.limiter.take("login_account", login.toLowerCase());
    const u = S.db.get("SELECT * FROM users WHERE username = ? OR email = ?", login, login.toLowerCase());
    const now = S.now();
    if (u?.locked_until && u.locked_until > now) throw new HttpError(429, "account_locked", `Too many failed attempts. Try again in ${Math.ceil((u.locked_until - now) / 60_000)} minutes or reset your password.`);
    // Same work whether or not the account exists (no user enumeration by timing)
    const ok = u?.password_hash ? await verifyPassword(String(body.password ?? ""), u.password_hash) : (await hashPassword("timing-equaliser"), false);
    if (!ok) {
      if (u) {
        const fails = u.failed_logins + 1;
        S.db.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", fails, fails >= LOCK_AFTER ? now + LOCK_MS : null, u.id);
      }
      throw new HttpError(401, "invalid_credentials", "That username or password isn’t right.");
    }
    if (u.status !== "active") throw new HttpError(403, "account_" + u.status, `This account is ${u.status}.`);
    S.db.run("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", u.id);
    startSession(S, req, res, u.id);
    return { user: selfUser(S, u.id) };
  }, { public: true });

  r.post("/api/auth/logout", ({ req, res }) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (raw) S.db.run("DELETE FROM sessions WHERE token_hash = ?", sha256(raw));
    setCookie(res, COOKIE, "", { maxAge: 0, secure: S.cfg.cookieSecure });
    return { ok: true };
  }, { public: true });

  /* ----- Email verification ----- */
  r.post("/api/auth/verify-email", ({ user, body }) => {
    if (user.email_verified_at) return { user: selfUser(S, user.id) };
    S.limiter.take("auth_code", user.id);
    const code = String(body.code ?? "").replace(/\s/g, "");
    const t = S.db.get("SELECT * FROM auth_tokens WHERE user_id = ? AND purpose = 'verify_email' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", user.id);
    if (!t || t.expires_at < S.now()) throw new HttpError(410, "code_expired", "That code expired. Send a new one.");
    if (t.attempts >= CODE_ATTEMPTS) throw new HttpError(429, "too_many_attempts", "Too many attempts. Send a new code.");
    if (!/^\d{6}$/.test(code) || sha256(`verify_email:${user.id}:${code}`) !== t.token_hash) {
      S.db.run("UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = ?", t.id);
      throw bad("invalid_code", "That code isn’t right.");
    }
    S.db.tx(() => {
      S.db.run("UPDATE auth_tokens SET used_at = ? WHERE id = ?", S.now(), t.id);
      S.db.run("UPDATE users SET email_verified_at = ? WHERE id = ?", S.now(), user.id);
    });
    return { user: selfUser(S, user.id) };
  });
  r.post("/api/auth/verify-email/resend", ({ user }) => {
    if (user.email_verified_at) return { ok: true, already: true };
    S.limiter.take("auth_mail", user.id);
    sendVerification(S, user);
    return { ok: true };
  });

  /* ----- Password reset (never reveals whether an email has an account) ----- */
  r.post("/api/auth/password/forgot", ({ body, ip }) => {
    S.limiter.take("auth_mail", ip);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
    const u = email && S.db.get("SELECT * FROM users WHERE email = ? AND status = 'active'", email);
    if (u) {
      const secret = issueToken(S, u.id, "reset_password");
      try {
        S.mail.send({ userId: u.id, subject: "Reset your TUNIBEAT password", body: `Open this link within 30 minutes to choose a new password:\n${S.cfg.publicUrl ?? ""}/#/reset?token=${u.id}.${secret}\nIf you didn’t ask for this, you can ignore this email; your password hasn’t changed.` });
      } catch (err) { S.log("reset mail failed", err.message); }
    }
    return { ok: true, message: "If an account uses that email, we’ve sent a reset link." };
  }, { public: true });
  r.post("/api/auth/password/reset", async ({ body, req, res, ip }) => {
    S.limiter.take("auth_code", ip);
    const [uid, secret] = String(body.token ?? "").split(".");
    const u = uid && S.db.get("SELECT * FROM users WHERE id = ?", uid);
    const t = u && secret && S.db.get("SELECT * FROM auth_tokens WHERE user_id = ? AND purpose = 'reset_password' AND token_hash = ?", u.id, sha256(`reset_password:${u.id}:${secret}`));
    if (!t || t.used_at || t.expires_at < S.now()) throw new HttpError(410, "link_expired", "This reset link is invalid or expired. Ask for a new one.");
    checkPassword(body.password, { username: u.username, email: u.email });
    const hash = await hashPassword(body.password);
    S.db.tx(() => {
      S.db.run("UPDATE auth_tokens SET used_at = ? WHERE id = ?", S.now(), t.id);
      S.db.run("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", hash, S.now(), S.now(), u.id);
    });
    revokeSessions(S, u.id);                     // everything signed in with the old password is signed out
    startSession(S, req, res, u.id);
    return { user: selfUser(S, u.id) };
  }, { public: true });
  r.post("/api/auth/password/change", async ({ user, body, session, req, res }) => {
    S.limiter.take("login_account", user.id);
    if (user.password_hash && !(await verifyPassword(String(body.current_password ?? ""), user.password_hash))) throw new HttpError(401, "invalid_credentials", "Your current password isn’t right.");
    checkPassword(body.new_password, { username: user.username, email: user.email });
    S.db.run("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?", await hashPassword(body.new_password), S.now(), user.id);
    S.db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", user.id, session.token_hash);
    void req; void res;
    return { ok: true };
  });

  /* ----- Sessions ----- */
  r.get("/api/auth/sessions", ({ user, session }) => ({
    sessions: S.db.all("SELECT token_hash, created_at, last_seen, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC", user.id, S.now())
      .map((s) => ({ id: s.token_hash.slice(0, 16), created_at: s.created_at, last_seen: s.last_seen, user_agent: s.user_agent, current: s.token_hash === session.token_hash })),
  }));
  r.delete("/api/auth/sessions/:id", ({ user, params, session }) => {
    if (!/^[a-f0-9]{16}$/.test(params.id)) throw notFound("Session not found.");
    if (session.token_hash.startsWith(params.id)) throw bad("current_session", "Use Sign out for this device.");
    const n = S.db.run("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?", user.id, params.id).changes;
    if (!n) throw notFound("Session not found.");
    return { ok: true };
  });
  r.post("/api/auth/logout-others", ({ user, session }) => {
    const n = S.db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", user.id, session.token_hash).changes;
    return { ok: true, signed_out: n };
  });

  // ----- Development only: sign in as a seeded persona without a password -----
  r.get("/api/auth/demo-accounts", () => ({
    accounts: S.db.all(`SELECT u.id, u.username, u.display_name, u.role, u.is_creator, u.is_private, m.storage_key AS avatar_key
      FROM users u LEFT JOIN media m ON m.id = u.avatar_media_id WHERE u.email LIKE '%@demo.tunibeat.example' ORDER BY u.role DESC, u.is_creator DESC, u.username`)
      .map((a) => ({ ...a, avatar_url: S.mediaUrl(a.avatar_key), avatar_key: undefined })),
  }), { public: true, dev: true });

  r.post("/api/auth/demo", ({ body, req, res }) => {
    const u = S.db.get("SELECT * FROM users WHERE username = ? AND email LIKE '%@demo.tunibeat.example'", String(body.username ?? ""));
    if (!u) throw bad("unknown_demo_account", "No demo account with that username.");
    if (u.status !== "active") throw new HttpError(403, "account_" + u.status, `This account is ${u.status}.`);
    startSession(S, req, res, u.id);
    return { user: selfUser(S, u.id) };
  }, { public: true, dev: true });

  // Development only (404 in production): read mail sent to an address, since reset links go to signed-out users
  r.get("/api/dev/mail", ({ query }) => {
    const u = S.db.get("SELECT id FROM users WHERE email = ?", String(query.email ?? "").toLowerCase());
    return { items: u ? S.db.all("SELECT id, subject, body, created_at FROM dev_outbox WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", u.id) : [] };
  }, { public: true, dev: true });

  r.get("/api/me", ({ user }) => ({ user: user ? selfUser(S, user.id) : null, env: { dev_tools: S.cfg.devTools, payments: { provider: S.payments.name, test_mode: S.payments.testMode, available: S.payments.available }, payouts: { provider: S.payouts.name, test_mode: S.payouts.testMode, available: S.payouts.available }, live: { transport: S.cfg.live.transport, ice_servers: S.cfg.live.iceServers, max_viewers: S.cfg.live.meshMaxViewers }, transcoder: S.transcoder.name, mail: S.mail.name, realtime_url: S.cfg.realtimeUrl } }), { public: true });
  r.post("/api/realtime/ticket", ({ session }) => ({ ticket: issueSocketTicket(S, session), url: S.cfg.realtimeUrl, expires_in: TICKET_TTL_MS / 1000 }));

  r.get("/api/health", ({ req }) => ({ ok: true, via_proxy: !!req.tunibeatProxied, realtime: S.rt.stats(), audio: S.audio.stats(), time: S.now() }), { public: true });
}

/** Require a verified email for actions that move money out or publish for sale. */
export function requireVerifiedEmail(user) {
  if (!user.email_verified_at) throw new HttpError(403, "email_unverified", "Verify your email address first (check your inbox for the 6-digit code).");
}

export function revokeSessions(S, userId) {
  S.db.run("DELETE FROM sessions WHERE user_id = ?", userId);
  S.rt.disconnectUser(userId);
}
