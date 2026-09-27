// Music stores: catalog, pricing, cart → checkout → sandbox payment → entitlements, protected downloads,
// exclusive rights, refunds, seller uploads (real WAV ingest) and upload validation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, ikey, sleep } from "../helpers.js";
import { encodeWav } from "../../server/lib/audio/codec.js";
import { ZipWriter } from "../../server/lib/audio/zip.js";
import { tempoClip } from "../fixtures/audio.js";

let T, rafi, priya, nova, kairo, admin;
before(async () => {
  T = await startServer();
  [rafi, priya, nova, kairo, admin] = await Promise.all(["rafi.listens", "priya.plays", "nova.keys", "kairovance", "tunibeat.team"].map((u) => T.as(u)));
});
after(() => T.close());

/** @returns {Promise<any>} the public catalog */
const catalog = async () => (await fetch(`${T.base}/api/store/bootstrap`)).json();
const buyer = (u) => ({ email: `${u}@example.com`, legal_name: "Test Buyer", country: "US", postal_code: "10001", agree: true });
async function buy(c, items, extra = {}) {
  await c.put("/api/store/cart", { items });
  const r = await c.post("/api/store/checkout", { idempotency_key: ikey(), ...buyer("t"), ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const done = await c.post(`/api/payments/sandbox/${r.data.checkout.checkout.session}/complete`, { outcome: "succeed" });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  return (await c.get(`/api/store/checkouts/${r.data.checkout.id}`)).data.checkout;
}
async function download(c, entitlementId, file, format, timeoutMs = 120_000) {
  let d = (await c.post(`/api/store/library/${entitlementId}/downloads`, { file, format })).data.download;
  const t0 = Date.now();
  while (d.status === "preparing") { assert.ok(Date.now() - t0 < timeoutMs, "download prepared in time"); await sleep(250); d = (await c.get(`/api/store/downloads/${d.id}`)).data.download; }
  return d;
}
/** A real stereo WAV: 120 BPM kick + A-minor pad. */
function wav(seconds = 10, bpm = 120) {
  const sr = 44100, n = sr * seconds, beat = 60 / bpm, ch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, tb = t % beat;
    const kick = tb < 0.2 ? Math.sin(2 * Math.PI * (50 + 110 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 14) : 0;
    ch[i] = 0.7 * kick + 0.08 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 329.63 * t));
  }
  return encodeWav([ch, ch], sr, 16);
}
async function upload(c, buf, purpose, mime, filename) {
  const init = await c.post("/api/media/uploads", { purpose, mime, bytes: buf.length, filename });
  if (init.status !== 200) return init;
  const { id, chunk_size: cs, chunks } = init.data.upload;
  for (let i = 0; i < chunks; i++) await c.raw("PUT", `/api/media/uploads/${id}/chunks/${i}`, undefined, { raw: buf.subarray(i * cs, Math.min(buf.length, (i + 1) * cs)), headers: { "content-type": "application/octet-stream" } });
  return c.post(`/api/media/uploads/${id}/complete`);
}

/* ------------------------------------------------------------------ catalog -------- */
test("catalog bootstrap is public, cached with an ETag, and contains no private fields", async () => {
  const r = await fetch(`${T.base}/api/store/bootstrap`);
  assert.equal(r.status, 200);
  const etag = r.headers.get("etag");
  const body = /** @type {any} */ (await r.json());
  assert.ok(body.beats.length > 20 && body.releases.length > 5);
  assert.equal((await fetch(`${T.base}/api/store/bootstrap`, { headers: { "if-none-match": etag } })).status, 304);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /password|email|storage_key|master_media_id/i, "no secrets or private storage in the public catalog");
  for (const s of body.recentSales) assert.deepEqual(Object.keys(s).sort(), ["itemId", "kind", "licenseId", "paidAt"], "recent sales are anonymous");
});

test("search uses the full-text index and neutralises operators", async () => {
  const r = await rafi.get("/api/store/search?q=midnight");
  assert.equal(r.status, 200);
  assert.ok(r.data.groups.beat.includes("b1"));
  for (const q of ['"', "AND OR NOT", "*", "title:x", "(((", "x".repeat(500)]) assert.equal((await rafi.get(`/api/store/search?q=${encodeURIComponent(q)}`)).status, 200, q);
});

/* ------------------------------------------------------------------ pricing -------- */
test("quote: prices, bundle discount, promo and fee are computed on the server", async () => {
  const items = [{ kind: "beat", id: "b1", license_id: "premium" }, { kind: "beat", id: "b3", license_id: "basic" }, { kind: "beat", id: "b5", license_id: "basic" }];
  const q = (await rafi.post("/api/store/quote", { items })).data;
  assert.deepEqual(q.problems, []);
  assert.equal(q.total_cents, q.subtotal_cents - q.discount_cents + q.service_fee_cents + q.tax_cents);
  for (const l of q.lines) assert.equal(l.seller_cents + l.fee_cents, l.paid_cents, "commission split is exact");
  assert.ok(q.discount_cents > 0, "3+ beats earn the bundle discount");
  const withPromo = (await rafi.post("/api/store/quote", { items, promo_code: "FLOW10" })).data;
  assert.ok(withPromo.total_cents < q.total_cents);
  assert.equal((await rafi.post("/api/store/quote", { items, promo_code: "NOPE" })).data.error.code, "invalid_promo");
  // Client-supplied prices are ignored
  const tampered = (await rafi.post("/api/store/quote", { items: items.map((i) => ({ ...i, unit_cents: 1, price: 0.01 })) })).data;
  assert.equal(tampered.total_cents, q.total_cents);
});

test("cart rules: own items, unknown tiers, invalid ids and oversize carts are rejected", async () => {
  const own = (await kairo.post("/api/store/quote", { items: [{ kind: "beat", id: "b1", license_id: "basic" }] })).data;
  assert.equal(own.problems[0].code, "own_item");
  const q = (await rafi.post("/api/store/quote", { items: [{ kind: "beat", id: "b1", license_id: "platinum" }, { kind: "beat", id: "nope", license_id: "basic" }, { kind: "hack", id: "x" }] })).data;
  assert.equal(q.problems.length, 3);
  const big = Array.from({ length: 101 }, (_, i) => ({ kind: "beat", id: `b${i}`, license_id: "basic" }));
  assert.equal((await rafi.post("/api/store/quote", { items: big })).status, 400);
});

/* ------------------------------------------------------------------ checkout ------- */
test("checkout: idempotent, rejects stale totals, pays once, grants entitlements and seller earnings", async () => {
  await priya.put("/api/store/cart", { items: [{ kind: "beat", id: "b6", license_id: "premium" }] });
  const quote = (await priya.get("/api/store/cart")).data.quote;
  const key = ikey();
  assert.equal((await priya.post("/api/store/checkout", { idempotency_key: key, ...buyer("p"), expected_total_cents: quote.total_cents + 1 })).data.error.code, "price_changed");
  const a = await priya.post("/api/store/checkout", { idempotency_key: key, ...buyer("p"), expected_total_cents: quote.total_cents });
  const b = await priya.post("/api/store/checkout", { idempotency_key: key, ...buyer("p"), expected_total_cents: quote.total_cents });
  assert.equal(a.data.checkout.id, b.data.checkout.id, "same key → same checkout");
  assert.equal(a.data.checkout.total_cents, quote.total_cents);
  const sellerBefore = T.db.get("SELECT pending_cents FROM creator_balances WHERE user_id = 'u_kairovance'").pending_cents;
  const session = a.data.checkout.checkout.session;
  assert.equal((await rafi.post(`/api/payments/sandbox/${session}/complete`, { outcome: "succeed" })).status, 404, "someone else can't complete my payment");
  await priya.post(`/api/payments/sandbox/${session}/complete`, { outcome: "succeed" });
  await priya.post(`/api/payments/sandbox/${session}/complete`, { outcome: "succeed" });
  const c = (await priya.get(`/api/store/checkouts/${a.data.checkout.id}`)).data.checkout;
  assert.equal(c.status, "paid");
  assert.equal(T.db.get("SELECT COUNT(*) n FROM entitlements e JOIN users u ON u.id = e.user_id WHERE u.username = 'priya.plays' AND e.item_id = 'b6' AND e.revoked_at IS NULL").n, 1, "exactly one entitlement");
  const item = c.orders[0].items[0];
  const sellerAfter = T.db.get("SELECT pending_cents FROM creator_balances WHERE user_id = 'u_kairovance'").pending_cents;
  const oi = T.db.get("SELECT * FROM order_items WHERE id = ?", item.id);
  assert.equal(sellerAfter - sellerBefore, oi.seller_cents);
  assert.equal(oi.seller_cents + oi.fee_cents, oi.paid_cents);
  assert.deepEqual((await priya.get("/api/store/cart")).data.items, [], "bought items leave the cart");
  assert.equal((await priya.post("/api/store/quote", { items: [{ kind: "beat", id: "b6", license_id: "premium" }] })).data.problems[0].code, "already_owned");
  const rec = await admin.get("/api/admin/ledger/reconcile");
  assert.equal(rec.status, 200);
  assert.equal(rec.data.ok, true, JSON.stringify(rec.data).slice(0, 400));
});

test("exclusive rights: a pending checkout holds them, payment removes the beat, the loser can't buy", async () => {
  await rafi.put("/api/store/cart", { items: [{ kind: "beat", id: "b2", license_id: "exclusive" }] });
  const r = await rafi.post("/api/store/checkout", { idempotency_key: ikey(), ...buyer("r") });
  assert.equal(r.status, 200);
  const held = (await priya.post("/api/store/quote", { items: [{ kind: "beat", id: "b2", license_id: "exclusive" }] })).data;
  assert.equal(held.problems[0].code, "exclusive_unavailable");
  await rafi.post(`/api/payments/sandbox/${r.data.checkout.checkout.session}/complete`, { outcome: "succeed" });
  assert.equal(T.db.get("SELECT status FROM beats WHERE id = 'b2'").status, "sold_exclusive");
  assert.ok(!(await catalog()).beats.some((b) => b.id === "b2"), "sold exclusives leave the store");
  await priya.put("/api/store/cart", { items: [{ kind: "beat", id: "b2", license_id: "basic" }] });
  const lose = await priya.post("/api/store/checkout", { idempotency_key: ikey(), ...buyer("p") });
  assert.equal(lose.status, 409);
  assert.equal(lose.data.error.code, "cart_invalid");
  await priya.put("/api/store/cart", { items: [] });
});

test("declined payments grant nothing and release exclusive holds", async () => {
  await priya.put("/api/store/cart", { items: [{ kind: "beat", id: "b7", license_id: "exclusive" }] });
  const r = await priya.post("/api/store/checkout", { idempotency_key: ikey(), ...buyer("p") });
  await priya.post(`/api/payments/sandbox/${r.data.checkout.checkout.session}/complete`, { outcome: "decline" });
  assert.equal((await priya.get(`/api/store/checkouts/${r.data.checkout.id}`)).data.checkout.status, "failed");
  assert.equal(T.db.get("SELECT COUNT(*) n FROM entitlements e JOIN users u ON u.id = e.user_id WHERE u.username = 'priya.plays' AND item_id = 'b7'").n, 0);
  assert.deepEqual((await rafi.post("/api/store/quote", { items: [{ kind: "beat", id: "b7", license_id: "exclusive" }] })).data.problems, []);
  await priya.put("/api/store/cart", { items: [] });
});

/* ------------------------------------------------------------------ downloads ------ */
test("downloads: signed, account-bound links; other users, tampered and expired links are refused", { timeout: 240_000 }, async () => {
  const c = await buy(rafi, [{ kind: "beat", id: "b9", license_id: "basic" }]);
  const ent = c.orders[0].items[0].entitlement_id;
  assert.equal((await rafi.post(`/api/store/library/${ent}/downloads`, { file: "stems", format: "WAV" })).status, 400, "a Basic lease doesn't include stems");
  assert.equal((await priya.post(`/api/store/library/${ent}/downloads`, { file: "master", format: "MP3" })).status, 404, "IDOR: someone else's entitlement");
  const d = await download(rafi, ent, "master", "MP3");
  assert.equal(d.status, "ready");
  const res = await rafi.raw("GET", d.url);
  assert.equal(res.status, 200);
  const file = await fetch(T.base + d.url, { headers: { cookie: rafi.cookie, range: "bytes=0-2" } });
  const head = Buffer.from(await file.arrayBuffer());
  assert.ok(head[0] === 0xff || head.toString("latin1", 0, 3) === "ID3", "an MP3 file");
  assert.equal((await priya.raw("GET", d.url)).status, 404, "the link is bound to the buyer's account (and doesn't reveal the download exists)");
  assert.equal((await fetch(T.base + d.url)).status, 401, "anonymous");
  assert.equal((await rafi.raw("GET", d.url.replace(/sig=.{4}/, "sig=AAAA"))).status, 403, "tampered signature");
  const clock = T.S.now; T.S.now = () => clock() + 20 * 60_000;
  try { assert.equal((await rafi.raw("GET", d.url)).status, 410, "expired link"); } finally { T.S.now = clock; }
  const lic = await rafi.raw("GET", `/api/store/library/${ent}/license`);
  assert.equal(lic.status, 200);
  assert.match(String(lic.data), /Test Buyer/);
  assert.match(String(lic.data), new RegExp(c.orders[0].id));
});

/* ------------------------------------------------------------------ refunds -------- */
test("refunds: admin only; entitlements revoked, seller earnings reversed, not counted as revenue", { timeout: 120_000 }, async () => {
  const c = await buy(priya, [{ kind: "beat", id: "b10", license_id: "premium" }]);
  const ent = c.orders[0].items[0].entitlement_id;
  const seller = T.db.get("SELECT seller_user_id FROM order_items WHERE id = ?", c.orders[0].items[0].id).seller_user_id;
  const before = T.db.get("SELECT pending_cents FROM creator_balances WHERE user_id = ?", seller).pending_cents;
  assert.equal((await priya.post(`/api/admin/store-checkouts/${c.id}/refund`, {})).status, 403);
  const r = await admin.post(`/api/admin/store-checkouts/${c.id}/refund`, { reason: "test" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await admin.post(`/api/admin/store-checkouts/${c.id}/refund`, {})).status, 409, "no double refund");
  const after = T.db.get("SELECT pending_cents FROM creator_balances WHERE user_id = ?", seller).pending_cents;
  assert.equal(before - after, T.db.get("SELECT seller_cents FROM order_items WHERE id = ?", c.orders[0].items[0].id).seller_cents);
  assert.equal((await priya.post(`/api/store/library/${ent}/downloads`, { file: "master", format: "MP3" })).status, 404, "refunded items leave the library");
  assert.ok(!(await priya.get("/api/store/library")).data.items.some((e) => e.id === ent));
  const orders = (await priya.get("/api/store/orders")).data.orders;
  assert.equal(orders.find((o) => o.id === c.orders[0].id).status, "refunded");
  const sellerUser = T.db.get("SELECT username FROM users WHERE id = ?", seller).username;
  const dash = (await (await T.as(sellerUser)).get("/api/seller/dashboard?marketplace=beats")).data;
  const row = dash.recent_orders.find((o) => o.order_id === c.orders[0].id);
  assert.equal(row.status, "refunded");
  assert.ok(!dash.top_items.some((t) => t.units && t.item_id === "b10" && t.net_cents < 0));
  assert.equal((await admin.get("/api/admin/ledger/reconcile")).data.ok, true);
});

/* ------------------------------------------------------------------ seller uploads - */
test("upload validation: fake WAVs, archives with executables and oversize files are refused", async () => {
  const fake = await upload(nova, Buffer.from("RIFF....not really a wave file at all"), "master_audio", "audio/wav", "fake.wav");
  assert.equal(fake.data.error.code, "content_mismatch");
  const tmp = path.join(os.tmpdir(), `stems-${ikey()}.zip`);
  const z = new ZipWriter(tmp); z.add("kick.wav", wav(1)); z.add("payload.exe", Buffer.from("MZ")); z.close();
  const zipped = await upload(nova, fs.readFileSync(tmp), "stems_archive", "application/zip", "stems.zip");
  fs.rmSync(tmp, { force: true });
  assert.equal(zipped.data.error.code, "invalid_archive");
  assert.equal((await nova.post("/api/media/uploads", { purpose: "master_audio", mime: "audio/wav", bytes: 800 * 1024 * 1024, filename: "huge.wav" })).status, 413);
  assert.equal((await nova.post("/api/media/uploads", { purpose: "master_audio", mime: "application/x-msdownload", bytes: 10, filename: "x.exe" })).data.error.code, "unsupported_type");
});

test("seller upload: a real WAV is ingested (tempo and key detected), sanitised, previewed, and sold without stem tiers", { timeout: 120_000 }, async () => {
  const media = (await upload(nova, wav(12, 120), "master_audio", "audio/wav", "master.wav")).data.media;
  assert.ok(media?.id);
  const key = T.db.get("SELECT storage_key, access FROM media WHERE id = ?", media.id);
  assert.equal(key.access, "private");
  assert.equal((await fetch(`${T.base}/media/${key.storage_key}`)).status, 404, "masters are never served publicly");
  const r = await nova.post("/api/seller/beats", { title: 'Test <img src=x onerror=alert(1)> "Beat"', genre: "trap", tags: ["<b>x</b>"], master_media_id: media.id, publish: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await priya.post("/api/seller/beats", { title: "steal", genre: "trap", master_media_id: media.id })).data.error.code, "invalid_master", "someone else's upload can't be attached");
  let b;
  for (let i = 0; i < 200; i++) { b = (await nova.get("/api/seller/catalog")).data.beats.find((x) => x.id === r.data.beat.id); if (b.status !== "processing") break; await sleep(250); }
  assert.equal(b.status, "published", JSON.stringify(b.audio));
  assert.equal(Math.round(b.audio.analysis.bpm), 120);
  assert.equal(b.key, "A min");
  assert.doesNotMatch(b.title, /[<>"]/);
  const live = (await catalog()).beats.find((x) => x.id === b.id);
  assert.deepEqual(live.licensesAvailable, ["basic", "premium"], "no stems → no Trackout/Exclusive");
  assert.equal((await fetch(T.base + live.audio.preview)).status, 200, "public preview once live");
  assert.equal((await rafi.post("/api/store/quote", { items: [{ kind: "beat", id: b.id, license_id: "trackout" }] })).data.problems[0].code, "license_unavailable");
  assert.equal((await nova.post("/api/seller/beats", { title: "again", genre: "trap", master_media_id: media.id })).status, 409, "a master can't be reused");
});

test("seller dashboard numbers come from paid orders only", async () => {
  const d = (await nova.get("/api/seller/dashboard?marketplace=beats")).data;
  const paid = T.db.get(`SELECT COALESCE(SUM(oi.seller_cents), 0) s FROM order_items oi JOIN store_orders o ON o.id = oi.order_id JOIN users u ON u.id = oi.seller_user_id
    WHERE u.username = 'nova.keys' AND o.marketplace = 'beats' AND o.status = 'paid'`).s;
  assert.equal(d.kpis.lifetime_net_cents, paid);
  assert.equal((await rafi.get("/api/store/admin/genres")).status, 403);
});

test("release ingest: with no declared BPM the genre range guides tempo detection (174 BPM drum & bass)", { timeout: 120_000 }, async () => {
  const clip = tempoClip(174, "dnb", 16);
  const media = (await upload(nova, encodeWav(clip.ch, 44100, 16), "master_audio", "audio/wav", "dnb.wav")).data.media;
  const r = await nova.post("/api/seller/releases", { title: "Tempo Check", type: "single", genre: "drum-bass", release_date: "2026-10-01", formats: ["WAV", "MP3"], publish: false, tracks: [{ title: "Rollers", master_media_id: media.id }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let rel;
  for (let i = 0; i < 200; i++) { rel = (await nova.get("/api/seller/catalog")).data.releases.find((x) => x.id === r.data.release.id); if (rel.status !== "processing") break; await sleep(250); }
  assert.equal(rel.status, "draft");
  assert.ok(Math.abs(rel.tracks[0].bpm - 174) <= 1, `detected ${rel.tracks[0].bpm} BPM`);
});
