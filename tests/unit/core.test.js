import { test } from "node:test";
import assert from "node:assert/strict";
import { id, idAt } from "../../server/lib/ids.js";
import { sniff, imageSize } from "../../server/modules/media.js";
import { ftsQuery } from "../../server/modules/search.js";
import { parseHashtags, parseMentions } from "../../server/modules/posts.js";
import { createLimiter } from "../../server/lib/ratelimit.js";
import { createPaymentProvider } from "../../server/adapters/payments.js";
import { createPayoutProvider } from "../../server/adapters/payouts.js";
import { safeJoin } from "../../server/lib/http.js";
import { openDb } from "../../server/lib/db.js";

test("ids are unique and sort chronologically", () => {
  const ids = Array.from({ length: 2000 }, () => id("p"));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ids);
  assert.ok(idAt("p", Date.now() - 1000) < id("p"));
});

test("content sniffing recognises real file signatures and rejects mismatches", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000002800000016808060000", "hex");
  assert.equal(sniff(png), "image/png");
  assert.deepEqual(imageSize(png, "image/png"), { width: 640, height: 360 });
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniff(Buffer.from("1a45dfa3000000000000", "hex")), "matroska");
  assert.equal(sniff(Buffer.from("000000186674797069736f6d00000000", "hex")), "iso-bmff");
  assert.equal(sniff(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(sniff(Buffer.from("%PDF-1.7 blah")), "application/pdf");
});

test("jpeg dimensions come from the SOF marker", () => {
  // SOI, APP0 (len 16), SOF0 with height 300 width 500
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, 0x03]), Buffer.alloc(16)]);
  assert.deepEqual(imageSize(jpg, "image/jpeg"), { width: 500, height: 300 });
});

test("FTS query builder neutralises operators and quotes", () => {
  assert.equal(ftsQuery('lo-fi "beats" OR NEAR(x)'), '"lo"* "fi"* "beats"* "or"* "near"* "x"*');
  assert.equal(ftsQuery("   "), "");
  assert.equal(ftsQuery("Café"), '"café"*');
});

test("hashtags and mentions are parsed, deduplicated and bounded", () => {
  assert.deepEqual(parseHashtags("Night #Techno #techno #lo_fi mail@x.com#nope"), ["techno", "lo_fi"]);
  assert.deepEqual(parseMentions("hi @Nova.Keys and @nova.keys, email a@b.co"), ["nova.keys"]);
  assert.equal(parseHashtags(Array.from({ length: 50 }, (_, i) => `#t${i}`).join(" ")).length, 30);
});

test("rate limiter blocks bursts and refills over time", () => {
  let now = 0;
  const lim = createLimiter(() => now);
  for (let i = 0; i < 15; i++) lim.take("gift", "u1");
  assert.throws(() => lim.take("gift", "u1"), (e) => e.status === 429 && e.code === "rate_limited");
  lim.take("gift", "u2");                       // other actors are unaffected
  now += 10_000;                                 // 15 per 30s → 5 tokens after 10s
  for (let i = 0; i < 5; i++) lim.take("gift", "u1");
  assert.throws(() => lim.take("gift", "u1"));
});

test("sandbox webhooks: valid signatures verify, tampered, stale and malformed ones don't", () => {
  const p = createPaymentProvider({ payments: { provider: "sandbox", sandboxWebhookSecret: "s3cret" } });
  const ev = p.signEvent({ id: "evt_1", type: "payment.succeeded", data: { provider_ref: "sbxpay_1" } });
  assert.equal(p.verifyWebhook(ev.body, ev.headers).providerRef, "sbxpay_1");
  const tampered = Buffer.from(ev.body.toString().replace("sbxpay_1", "sbxpay_2"));
  assert.throws(() => p.verifyWebhook(tampered, ev.headers), /signature/i);
  assert.throws(() => p.verifyWebhook(ev.body, {}), /signature/i);
  const t = Math.floor(Date.now() / 1000) - 3600;
  assert.throws(() => p.verifyWebhook(ev.body, { "x-sandbox-signature": `t=${t},v1=${"0".repeat(64)}` }), /tolerance/i);
  const other = createPaymentProvider({ payments: { provider: "sandbox", sandboxWebhookSecret: "different" } });
  assert.throws(() => other.verifyWebhook(ev.body, ev.headers), /mismatch/i);
});

test("unconfigured providers fail closed", () => {
  const p = createPaymentProvider({ payments: { provider: "none" } });
  assert.equal(p.available, false);
  assert.throws(() => p.createCheckout({}), (e) => e.status === 503);
  const po = createPayoutProvider({ payouts: { provider: "none" } });
  assert.throws(() => po.createAccount({}), (e) => e.status === 503);
});

test("static path resolution never escapes the web root", async () => {
  const path = await import("node:path");
  const root = path.resolve("/srv/app");
  for (const p of ["/../../etc/passwd", "/%2e%2e/%2e%2e/secret", "/css/../../server/app.js", "/js/..%2f..%2fpackage.json"]) {
    const out = safeJoin(root, p);
    assert.ok(out === null || out.startsWith(root), `${p} → ${out}`);
  }
});

test("database: balances cannot go negative and nested transactions roll back cleanly", () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO users (id, username, display_name, created_at) VALUES ('u_1','abc','A',0)");
  db.run("INSERT INTO wallets (user_id, credits, updated_at) VALUES ('u_1', 10, 0)");
  assert.throws(() => db.run("UPDATE wallets SET credits = credits - 11 WHERE user_id = 'u_1'"), /CHECK/);
  assert.throws(() => db.tx(() => {
    db.run("UPDATE wallets SET credits = 5 WHERE user_id = 'u_1'");
    db.tx(() => { db.run("UPDATE wallets SET credits = 1 WHERE user_id = 'u_1'"); throw new Error("inner"); });
  }), /inner/);
  assert.equal(db.get("SELECT credits FROM wallets").credits, 10);
  db.tx(() => {
    db.run("UPDATE wallets SET credits = 7 WHERE user_id = 'u_1'");
    try { db.tx(() => { db.run("UPDATE wallets SET credits = 2 WHERE user_id = 'u_1'"); throw new Error("x"); }); } catch { /* inner savepoint rolled back */ }
  });
  assert.equal(db.get("SELECT credits FROM wallets").credits, 7);
  assert.throws(() => db.tx(async () => {}), /synchronous/);
  db.close();
});
