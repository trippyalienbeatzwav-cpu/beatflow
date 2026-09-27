// Account security: email verification codes, password reset, lockout, sessions and verified-only actions.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";

let T;
before(async () => { T = await startServer(); });
after(() => T.close());

const mail = async (c, email) => (await c.get(`/api/dev/mail?email=${encodeURIComponent(email)}`)).data.items;
const PW = "violet-harbour-42";

test("signup sends a verification code; wrong codes are counted and capped; the right code verifies", async () => {
  const c = T.client();
  const r = await c.post("/api/auth/signup", { username: "vera", email: "vera@example.com", password: PW });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email_verified, false);
  const [m] = await mail(c, "vera@example.com");
  const code = m.body.match(/\b(\d{6})\b/)[1];
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await c.post("/api/auth/verify-email", { code: wrong })).data.error.code, "invalid_code");
  const ok = await c.post("/api/auth/verify-email", { code });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email_verified, true);
  // Codes are stored hashed, never in plain text
  const row = T.db.get("SELECT token_hash FROM auth_tokens WHERE purpose = 'verify_email' ORDER BY created_at DESC LIMIT 1");
  assert.notEqual(row.token_hash, code);

  const c2 = T.client();
  await c2.post("/api/auth/signup", { username: "brute", email: "brute@example.com", password: PW });
  for (let i = 0; i < 5; i++) await c2.post("/api/auth/verify-email", { code: "123456" === code ? "654321" : "123456" });
  const [m2] = await mail(c2, "brute@example.com");
  const blocked = await c2.post("/api/auth/verify-email", { code: m2.body.match(/\b(\d{6})\b/)[1] });
  assert.equal(blocked.status, 429, "after 5 wrong attempts even the right code is refused until a new one is sent");
});

test("unverified accounts can't sell", async () => {
  const c = T.client();
  await c.post("/api/auth/signup", { username: "unverified", email: "unv@example.com", password: PW });
  const r = await c.post("/api/seller/beats", { title: "x" });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, "email_unverified");
});

test("password reset: no account enumeration, single-use link, all old sessions revoked", async () => {
  const anon = T.client();
  const a = await anon.post("/api/auth/password/forgot", { email: "nobody@example.com" });
  const b = await anon.post("/api/auth/password/forgot", { email: "vera@example.com" });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.data.message, b.data.message, "same answer whether or not the account exists");

  const old = T.client();
  assert.equal((await old.post("/api/auth/login", { login: "vera", password: PW })).status, 200);
  const [m] = await mail(anon, "vera@example.com");
  const token = m.body.match(/token=([\w.-]+)/)[1];
  assert.equal((await anon.post("/api/auth/password/reset", { token, password: "password1" })).data.error.code, "weak_password");
  const ok = await anon.post("/api/auth/password/reset", { token, password: "new-harbour-lights-7" });
  assert.equal(ok.status, 200);
  assert.equal((await old.get("/api/me")).data.user, null, "sessions created with the old password are signed out");
  assert.equal((await anon.post("/api/auth/password/reset", { token, password: "another-long-pass-9" })).status, 410, "links are single-use");
  assert.equal((await T.client().post("/api/auth/login", { login: "vera", password: PW })).status, 401);
  assert.equal((await T.client().post("/api/auth/login", { login: "vera", password: "new-harbour-lights-7" })).status, 200);
});

test("login lockout after repeated failures; the correct password is refused while locked", async () => {
  const c = T.client();
  await c.post("/api/auth/signup", { username: "lockme", email: "lockme@example.com", password: PW });
  let last;
  for (let i = 0; i < 10; i++) last = await T.client().post("/api/auth/login", { login: "lockme", password: "not-the-password" });
  assert.equal(last.status, 401);
  const locked = await T.client().post("/api/auth/login", { login: "lockme", password: PW });
  assert.equal(locked.status, 429);
  // Unknown and known accounts answer the same way to wrong passwords (no enumeration)
  const unknown = await T.client().post("/api/auth/login", { login: "no-such-user", password: "whatever-pass" });
  assert.equal(unknown.status, 401);
  // After the lock window passes the account works again
  const clock = T.S.now; T.S.now = () => clock() + 16 * 60_000;
  try { assert.equal((await T.client().post("/api/auth/login", { login: "lockme", password: PW })).status, 200); } finally { T.S.now = clock; }
});

test("sessions: list, sign out others, password change keeps only the current session", async () => {
  const a = T.client(), b = T.client();
  await a.post("/api/auth/signup", { username: "twodevices", email: "two@example.com", password: PW });
  await b.post("/api/auth/login", { login: "twodevices", password: PW });
  const list = await a.get("/api/auth/sessions");
  assert.ok(list.data.sessions.length >= 2);
  assert.equal(list.data.sessions.filter((s) => s.current).length, 1);
  assert.equal((await a.post("/api/auth/password/change", { current_password: "wrong-one-here", new_password: "brand-new-secret-5" })).status, 401);
  assert.equal((await a.post("/api/auth/password/change", { current_password: PW, new_password: "brand-new-secret-5" })).status, 200);
  assert.ok((await a.get("/api/me")).data.user, "the device that changed the password stays signed in");
  assert.equal((await b.get("/api/me")).data.user, null, "other devices are signed out");
});
