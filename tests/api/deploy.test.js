// Split hosting (static front end on Vercel, Node server elsewhere): trusted proxy IPs, WebSocket tickets,
// the Vercel middleware and the production mail adapter.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, wsClient } from "../helpers.js";
import { proxy } from "../../middleware.js";
import { createMailer } from "../../server/adapters/mail.js";

const SECRET = "test-proxy-secret-0123456789abcdef";
let T;
before(async () => { T = await startServer({ disableRateLimits: false, config: { proxySecret: SECRET, realtimeUrl: "wss://api.example.test/ws" } }); });
after(() => T.close());

const signup = (i, headers) => fetch(`${T.base}/api/auth/signup`, {
  method: "POST", headers: { "content-type": "application/json", "x-tunibeat-csrf": "1", ...headers },
  body: JSON.stringify({ username: `px_user_${i}`, email: `px${i}@example.com`, password: "amber-circuit-harbor-3" }),
});

test("visitor IPs from the proxy are trusted only with the shared secret", async () => {
  const h = (ip, secret = SECRET) => ({ "x-tunibeat-proxy": secret, "x-tunibeat-client-ip": ip });
  // Signup allows 5 per IP per hour. Different forwarded visitors each get their own budget…
  for (let i = 0; i < 7; i++) assert.equal((await signup(i, h(`203.0.113.${i + 1}`))).status, 200, `visitor ${i}`);
  // …while one visitor is limited, however the request arrives
  let last;
  for (let i = 0; i < 6; i++) last = await signup(100 + i, h("198.51.100.7"));
  assert.equal(last.status, 429);
  // A forged header without the right secret is ignored: the socket address is used (all local here)
  const spoof = [];
  for (let i = 0; i < 6; i++) spoof.push((await signup(200 + i, h(`192.0.2.${i + 1}`, "wrong-secret-wrong-secret-xx"))).status);
  assert.ok(spoof.includes(429), "spoofed IPs do not bypass the limit");
  const health = async (headers) => /** @type {any} */ (await (await fetch(`${T.base}/api/health`, { headers })).json()).via_proxy;
  assert.equal(await health(h("203.0.113.9")), true);
  assert.equal(await health(h("203.0.113.9", "nope")), false);
});

test("WebSocket tickets: single-use, session-bound, and required cross-origin", async () => {
  T.S.limiter.setEnabled(false);
  const nova = await T.as("nova.keys");
  const me = (await nova.get("/api/me")).data;
  assert.equal(me.env.realtime_url, "wss://api.example.test/ws");
  const { ticket, url } = (await nova.post("/api/realtime/ticket")).data;
  assert.equal(url, "wss://api.example.test/ws");
  const wsBase = T.base.replace("http", "ws") + "/ws";
  const ok = wsClient(`${wsBase}?ticket=${ticket}`, "");
  await ok.open();
  ok.close();
  await assert.rejects(wsClient(`${wsBase}?ticket=${ticket}`, "").open(), /401/, "a ticket works once");
  await assert.rejects(wsClient(`${wsBase}?ticket=forged`, "").open(), /401/);
  await assert.rejects(wsClient(wsBase, "").open(), /401/, "no ticket and no cookie");
  const late = (await nova.post("/api/realtime/ticket")).data.ticket;
  const clock = T.S.now; T.S.now = () => clock() + 61_000;
  try { await assert.rejects(wsClient(`${wsBase}?ticket=${late}`, "").open(), /401/, "expired"); } finally { T.S.now = clock; }
  const revoked = (await nova.post("/api/realtime/ticket")).data.ticket;
  await nova.post("/api/auth/logout");
  await assert.rejects(wsClient(`${wsBase}?ticket=${revoked}`, "").open(), /401/, "signing out invalidates tickets");
  assert.equal((await T.client().post("/api/realtime/ticket")).status, 401);
});

test("Vercel middleware: forwards /api to API_ORIGIN, strips spoofed headers, adds the visitor IP", () => {
  const req = (url, headers = {}) => new Request(url, { headers });
  const off = proxy(req("https://site.vercel.app/api/me"), {});
  assert.equal(off.status, 503, "not configured → clear 503, not a 404");
  for (const bad of ["http://api.example.com", "ftp://x", "not a url"]) assert.equal(proxy(req("https://s/api/me"), { API_ORIGIN: bad }).status, 503, bad);

  const res = proxy(req("https://site.vercel.app/api/store/search?q=dark%20trap", { "x-real-ip": "203.0.113.50", "x-tunibeat-proxy": "forged", "x-tunibeat-client-ip": "6.6.6.6", cookie: "tb_sid=abc" }),
    { API_ORIGIN: "https://api.example.com/", PROXY_SECRET: SECRET });
  assert.equal(res.headers.get("x-middleware-rewrite"), "https://api.example.com/api/store/search?q=dark%20trap");
  const up = (k) => res.headers.get(`x-middleware-request-${k}`);
  assert.equal(up("x-tunibeat-proxy"), SECRET);
  assert.equal(up("x-tunibeat-client-ip"), "203.0.113.50", "the visitor IP comes from Vercel's header, not the client's");
  assert.equal(up("cookie"), "tb_sid=abc", "session cookie passes through");
  const noSecret = proxy(req("https://s/media/x/y.webp", { "x-tunibeat-proxy": "forged" }), { API_ORIGIN: "https://api.example.com" });
  assert.equal(noSecret.headers.get("x-middleware-rewrite"), "https://api.example.com/media/x/y.webp");
  assert.equal(noSecret.headers.get("x-middleware-request-x-tunibeat-proxy"), null, "spoofed proxy header removed");
});

test("Resend mail adapter: sends to the account's address; delivery failures are logged, not thrown", async () => {
  const calls = [], logs = [];
  const S = { cfg: { mail: { provider: "resend", resendApiKey: "re_test", from: "TUNIBEAT <no-reply@example.com>" } }, db: T.db, log: (...a) => logs.push(a.join(" ")) };
  const ok = createMailer(S, { fetchImpl: async (url, init) => { calls.push([url, init]); return new Response("{}", { status: 200 }); } });
  const uid = T.db.get("SELECT id FROM users WHERE username = 'px_user_0'").id;
  await ok.send({ userId: uid, subject: "Code", body: "123456" });
  assert.equal(calls[0][0], "https://api.resend.com/emails");
  assert.equal(calls[0][1].headers.authorization, "Bearer re_test");
  assert.deepEqual(JSON.parse(calls[0][1].body), { from: "TUNIBEAT <no-reply@example.com>", to: ["px0@example.com"], subject: "Code", text: "123456" });
  const failing = createMailer(S, { fetchImpl: async () => new Response("bad key", { status: 401 }) });
  await failing.send({ userId: uid, subject: "x", body: "y" });
  assert.match(logs.join("\n"), /Resend 401/);
  assert.throws(() => createMailer({ cfg: { mail: { provider: "smtp" } } }), /Unknown MAIL_PROVIDER/);
});
