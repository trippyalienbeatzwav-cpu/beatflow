// Financial flows: credits, gifts, donations, earnings, withdrawals. Every test ends by reconciling the ledger.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ikey, sleep } from "../helpers.js";
import { reconcile } from "../../server/modules/admin.js";
import { releaseEarnings } from "../../server/modules/wallet.js";

let T, rafi, nova, priya, admin, sam;
const uid = (name) => T.db.get("SELECT id FROM users WHERE username = ?", name).id;
const credits = (name) => T.db.get("SELECT credits FROM wallets WHERE user_id = ?", uid(name)).credits;
const bal = (name) => T.db.get("SELECT * FROM creator_balances WHERE user_id = ?", uid(name));
const assertLedger = () => { const r = reconcile(T.S); assert.deepEqual(r.mismatches, [], "ledger must reconcile with balances"); };

before(async () => {
  T = await startServer({ config: { payouts: { provider: "sandbox", sandboxSettleMs: 150 } } });
  [rafi, nova, priya, admin, sam] = await Promise.all(["rafi.listens", "nova.keys", "priya.plays", "tunibeat.team", "sam.new"].map((u) => T.as(u)));
});
after(() => T.close());

test("seeded ledger reconciles", () => assertLedger());

test("credit purchase: sandbox checkout → signed webhook → credits added once", async () => {
  const start = credits("rafi.listens");
  const k = ikey();
  const r1 = await rafi.post("/api/wallet/purchases", { package_id: "pack_100", idempotency_key: k });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.purchase.status, "requires_payment");
  assert.equal(r1.data.checkout.type, "sandbox");
  assert.equal(r1.data.purchase.test_mode, true);
  // Retrying with the same key returns the same purchase, not a second one
  const r2 = await rafi.post("/api/wallet/purchases", { package_id: "pack_100", idempotency_key: k });
  assert.equal(r2.data.purchase.id, r1.data.purchase.id);
  assert.equal(credits("rafi.listens"), start, "no credits before payment");
  const done = await rafi.post(`/api/payments/sandbox/${r1.data.checkout.session}/complete`, { outcome: "succeed" });
  assert.equal(done.data.status, "succeeded");
  assert.equal(credits("rafi.listens"), start + 100);
  // Completing again (a replayed "hosted page" confirm) does not add credits again
  const again = await rafi.post(`/api/payments/sandbox/${r1.data.checkout.session}/complete`, { outcome: "succeed" });
  assert.ok(again.data.already || again.data.duplicate);
  assert.equal(credits("rafi.listens"), start + 100);
  // Another user can't complete Rafi's session
  const other = await priya.post(`/api/payments/sandbox/${r1.data.checkout.session}/complete`, { outcome: "succeed" });
  assert.equal(other.status, 404);
  assertLedger();
});

test("webhook endpoint: replayed events are ignored, forged ones rejected", async () => {
  const r = await rafi.post("/api/wallet/purchases", { package_id: "pack_550", idempotency_key: ikey() });
  const pay = T.db.get("SELECT * FROM payments WHERE purpose_id = ?", r.data.purchase.id);
  const before1 = credits("rafi.listens");
  const ev = T.S.payments.signEvent({ id: "evt_replay_1", type: "payment.succeeded", data: { provider_ref: pay.provider_ref } });
  const post = (body, headers) => fetch(`${T.base}/api/payments/webhooks/sandbox`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  assert.equal((await post(ev.body, ev.headers)).status, 200);
  const replay = /** @type {any} */ (await (await post(ev.body, ev.headers)).json());
  assert.equal(replay.duplicate, true);
  assert.equal(credits("rafi.listens"), before1 + 550);
  const forged = await post(Buffer.from(JSON.stringify({ id: "evt_forged", type: "payment.succeeded", data: { provider_ref: pay.provider_ref } })), { "x-sandbox-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"a".repeat(64)}` });
  assert.equal(forged.status, 400);
  assert.equal(credits("rafi.listens"), before1 + 550);
  assertLedger();
});

test("declined payment adds nothing and marks the purchase failed", async () => {
  const start = credits("priya.plays");
  const r = await priya.post("/api/wallet/purchases", { package_id: "pack_100", idempotency_key: ikey() });
  await priya.post(`/api/payments/sandbox/${r.data.checkout.session}/complete`, { outcome: "decline" });
  const cp = await priya.get(`/api/wallet/purchases/${r.data.purchase.id}`);
  assert.equal(cp.data.purchase.status, "failed");
  assert.equal(credits("priya.plays"), start);
});

test("purchases require an idempotency key and a real package", async () => {
  assert.equal((await rafi.post("/api/wallet/purchases", { package_id: "pack_100" })).data.error.code, "idempotency_key_required");
  assert.equal((await rafi.post("/api/wallet/purchases", { package_id: "pack_free", idempotency_key: ikey() })).data.error.code, "invalid_package");
});

test("gift: server prices it, debits credits, credits creator pending; client-sent prices are ignored", async () => {
  const c0 = credits("rafi.listens"), b0 = bal("nova.keys");
  const r = await rafi.post("/api/gifts/send", { gift_id: "gift_star", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey(), credit_cost: 1, price: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.gift.credits, 25);
  assert.equal(credits("rafi.listens"), c0 - 25);
  assert.equal(bal("nova.keys").pending_cents, b0.pending_cents + Math.floor(25 * 7000 / 10000));
  const g = T.db.get("SELECT * FROM gifts WHERE id = ?", r.data.gift.id);
  assert.equal(g.creator_cents + g.platform_cents, g.gross_cents);
  assertLedger();
});

test("gift idempotency: the same key never charges twice", async () => {
  const k = ikey();
  const c0 = credits("rafi.listens");
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => rafi.post("/api/gifts/send", { gift_id: "gift_heart", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: k })));
  assert.deepEqual([a, b, c].map((x) => x.status), [200, 200, 200]);
  assert.equal(new Set([a, b, c].map((x) => x.data.gift.id)).size, 1);
  assert.equal(credits("rafi.listens"), c0 - 5);
  assertLedger();
});

test("double spending is impossible: concurrent gifts can't overdraw the wallet", async () => {
  // Give Sam exactly 60 credits through a real purchase flow… then try to spend 50 three times at once
  T.db.run("UPDATE users SET created_at = ? WHERE username = 'sam.new'", Date.now() - 864e5);
  const p = await sam.post("/api/wallet/purchases", { package_id: "pack_100", idempotency_key: ikey() });
  await sam.post(`/api/payments/sandbox/${p.data.checkout.session}/complete`, { outcome: "succeed" });
  assert.equal(credits("sam.new"), 100);
  const results = await Promise.all([1, 2, 3].map(() => sam.post("/api/gifts/send", { gift_id: "gift_fire", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey() })));
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, 2);
  assert.equal(results.find((r) => r.status !== 200).data.error.code, "insufficient_credits");
  assert.equal(credits("sam.new"), 0);
  assertLedger();
});

test("gift rules: no self-gifts, non-creators, disabled gifts, live-only gifts outside live, blocked users", async () => {
  const send = (c, body) => c.post("/api/gifts/send", { idempotency_key: ikey(), context_type: "profile", ...body });
  assert.equal((await send(nova, { gift_id: "gift_heart", recipient_id: uid("nova.keys") })).data.error.code, "self_support");
  assert.equal((await send(rafi, { gift_id: "gift_heart", recipient_id: uid("priya.plays") })).data.error.code, "not_creator");
  assert.equal((await send(rafi, { gift_id: "gift_crown", recipient_id: uid("nova.keys") })).data.error.code, "invalid_gift");
  assert.equal((await send(rafi, { gift_id: "gift_rocket", recipient_id: uid("nova.keys") })).data.error.code, "gift_live_only");
  assert.equal((await send(rafi, { gift_id: "gift_heart", recipient_id: uid("nova.keys"), context_type: "live", context_id: "lv_nope" })).data.error.code, "live_not_active");
  await nova.post(`/api/users/${uid("rafi.listens")}/block`);
  assert.equal((await send(rafi, { gift_id: "gift_heart", recipient_id: uid("nova.keys") })).status, 403);
  await nova.del(`/api/users/${uid("rafi.listens")}/block`);
});

test("gift anti-abuse: new accounts wait, velocity and daily limits apply", async () => {
  const fresh = T.client();
  await fresh.post("/api/auth/signup", { username: "fresh_gifter", email: "fresh@example.com", password: "correct horse battery" });
  T.db.run("UPDATE wallets SET credits = 10000 WHERE user_id = ?", uid("fresh_gifter"));
  T.db.run("INSERT INTO transactions (id, user_id, type, amount, unit, balance, status, test_mode, created_at) VALUES ('tx_seedfresh', ?, 'adjustment', 10000, 'credits', 'wallet', 'completed', 1, ?)", uid("fresh_gifter"), Date.now());
  const r = await fresh.post("/api/gifts/send", { gift_id: "gift_heart", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey() });
  assert.equal(r.data.error.code, "account_too_new");
  T.db.run("UPDATE users SET created_at = ? WHERE username = 'fresh_gifter'", Date.now() - 864e5);
  await admin.patch("/api/admin/settings/monetization", { gifts: { max_credits_per_minute: 1200 } });
  const a = await fresh.post("/api/gifts/send", { gift_id: "gift_rocket_x", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey() });
  assert.equal(a.data.error.code, "invalid_gift");
  const b1 = await fresh.post("/api/gifts/send", { gift_id: "gift_vinyl", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey() });
  assert.equal(b1.status, 200);
  const b2 = await fresh.post("/api/gifts/send", { gift_id: "gift_vinyl", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey() });
  assert.equal(b2.status, 200);
  const b3 = await fresh.post("/api/gifts/send", { gift_id: "gift_vinyl", recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey() });
  assert.equal(b3.data.error.code, "gift_velocity");
  await admin.patch("/api/admin/settings/monetization", { gifts: { max_credits_per_minute: 5000 } });
  assertLedger();
});

test("donation: limits, fee split, pending → available after hold, and gifts ≠ donations", async () => {
  const tip = (body) => priya.post("/api/donations", { recipient_id: uid("nova.keys"), context_type: "profile", idempotency_key: ikey(), ...body });
  assert.equal((await tip({ amount_cents: 50 })).data.error.code, "amount_out_of_range");
  assert.equal((await tip({ amount_cents: 10_000_000 })).data.error.code, "amount_out_of_range");
  assert.equal((await tip({ amount_cents: 12.5 })).data.error.code, "invalid_amount");
  assert.equal((await tip({ amount_cents: 1000, currency: "EUR" })).data.error.code, "invalid_currency");
  const b0 = bal("nova.keys");
  const c0 = credits("priya.plays");
  const r = await tip({ amount_cents: 2000, message: "Great stream" });
  assert.equal(r.data.donation.status, "requires_payment");
  assert.equal(r.data.donation.fee_cents, 100);        // 5%
  assert.equal(r.data.donation.creator_cents, 1900);
  assert.equal(bal("nova.keys").pending_cents, b0.pending_cents, "nothing until the payment succeeds");
  await priya.post(`/api/payments/sandbox/${r.data.checkout.session}/complete`, { outcome: "succeed" });
  assert.equal(bal("nova.keys").pending_cents, b0.pending_cents + 1900);
  assert.equal(credits("priya.plays"), c0, "donations never touch credits");
  // Hold period: release job moves it to available only when due
  releaseEarnings(T.S);
  assert.equal(bal("nova.keys").pending_cents, b0.pending_cents + 1900);
  T.db.run("UPDATE earnings SET available_at = ? WHERE source_type = 'donation' AND source_id = ?", Date.now() - 1, r.data.donation.id);
  releaseEarnings(T.S);
  const b1 = bal("nova.keys");
  assert.equal(b1.pending_cents, b0.pending_cents);
  assert.equal(b1.available_cents, b0.available_cents + 1900);
  assertLedger();
});

test("refunds: donation refund reverses creator earnings once; spent credits can't be refunded", async () => {
  const r = await priya.post("/api/donations", { recipient_id: uid("nova.keys"), context_type: "profile", amount_cents: 700, idempotency_key: ikey() });
  await priya.post(`/api/payments/sandbox/${r.data.checkout.session}/complete`, { outcome: "succeed" });
  const b0 = bal("nova.keys");
  assert.equal((await nova.post(`/api/admin/donations/${r.data.donation.id}/refund`, {})).status, 403, "only admins refund");
  const ref = await admin.post(`/api/admin/donations/${r.data.donation.id}/refund`, { reason: "Donor request" });
  assert.equal(ref.status, 200, JSON.stringify(ref.data));
  assert.equal(bal("nova.keys").pending_cents, b0.pending_cents - 665);
  assert.equal((await admin.post(`/api/admin/donations/${r.data.donation.id}/refund`, {})).status, 409, "no double refunds");
  // Spend then refund is blocked
  const p = await priya.post("/api/wallet/purchases", { package_id: "pack_100", idempotency_key: ikey() });
  await priya.post(`/api/payments/sandbox/${p.data.checkout.session}/complete`, { outcome: "succeed" });
  T.db.run("UPDATE wallets SET credits = 0 WHERE user_id = ?", uid("priya.plays"));
  T.db.run("INSERT INTO transactions (id, user_id, type, amount, unit, balance, status, test_mode, created_at) SELECT 'tx_zero_priya', user_id, 'adjustment', -(SELECT SUM(amount) FROM transactions WHERE user_id = ?1 AND balance = 'wallet'), 'credits', 'wallet', 'completed', 1, ?2 FROM wallets WHERE user_id = ?1", uid("priya.plays"), Date.now());
  const rr = await admin.post(`/api/admin/purchases/${p.data.purchase.id}/refund`, {});
  assert.equal(rr.data.error.code, "credits_spent");
  assertLedger();
});

test("withdrawal lifecycle: hold → code verification → payout → completed", async () => {
  const methods = await nova.post("/api/creator/payout-methods", { scenario: "succeeds" });
  assert.equal(methods.status, 200);
  assert.equal(methods.data.method.test_mode, 1);
  assert.ok(!JSON.stringify(methods.data).includes("sbx_acct"), "provider account token is never sent to the client");
  const b0 = bal("nova.keys");
  assert.ok(b0.available_cents >= 1000, "seed gives Nova an available balance");
  const k = ikey();
  const over = await nova.post("/api/creator/withdrawals", { amount_cents: b0.available_cents + 1, payout_method_id: methods.data.method.id, idempotency_key: ikey() });
  assert.equal(over.data.error.code, b0.available_cents + 1 > 500_000 ? "amount_out_of_range" : "insufficient_balance");
  const w = await nova.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: methods.data.method.id, idempotency_key: k });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.equal(w.data.withdrawal.status, "pending");
  assert.equal(w.data.withdrawal.needs_verification, true);
  assert.equal(bal("nova.keys").available_cents, b0.available_cents - 1000);
  assert.equal(bal("nova.keys").held_cents, b0.held_cents + 1000);
  // Same key → same withdrawal; a second open withdrawal is refused
  assert.equal((await nova.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: methods.data.method.id, idempotency_key: k })).data.withdrawal.id, w.data.withdrawal.id);
  assert.equal((await nova.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: methods.data.method.id, idempotency_key: ikey() })).data.error.code, "withdrawal_open");
  // Wrong code, then the right one from the dev outbox
  assert.equal((await nova.post(`/api/creator/withdrawals/${w.data.withdrawal.id}/verify`, { code: "000000" })).data.error.code, "wrong_code");
  const mail = await nova.get("/api/dev/outbox");
  const code = /\b(\d{6})\b/.exec(mail.data.items[0].body)[1];
  assert.equal((await rafi.post(`/api/creator/withdrawals/${w.data.withdrawal.id}/verify`, { code })).status, 404, "other users can't verify");
  const v = await nova.post(`/api/creator/withdrawals/${w.data.withdrawal.id}/verify`, { code });
  assert.equal(v.data.withdrawal.status, "processing");
  await sleep(400);
  const list = await nova.get("/api/creator/withdrawals");
  assert.equal(list.data.items[0].status, "completed");
  assert.equal(bal("nova.keys").held_cents, b0.held_cents);
  assert.equal(bal("nova.keys").available_cents, b0.available_cents - 1000);
  assertLedger();
});

test("withdrawal failure and cancellation return funds to available", async () => {
  const fail = await nova.post("/api/creator/payout-methods", { scenario: "fails" });
  const b0 = bal("nova.keys");
  const w = await nova.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: fail.data.method.id, idempotency_key: ikey() });
  const code = /\b(\d{6})\b/.exec((await nova.get("/api/dev/outbox")).data.items[0].body)[1];
  await nova.post(`/api/creator/withdrawals/${w.data.withdrawal.id}/verify`, { code });
  await sleep(400);
  const got = (await nova.get("/api/creator/withdrawals")).data.items.find((x) => x.id === w.data.withdrawal.id);
  assert.equal(got.status, "failed");
  assert.match(got.failure_reason, /sandbox/i);
  assert.equal(bal("nova.keys").available_cents, b0.available_cents);
  const ok = (await nova.get("/api/creator/payout-methods")).data.items.find((m) => m.label === "Test bank account");
  const w2 = await nova.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: ok.id, idempotency_key: ikey() });
  const c = await nova.post(`/api/creator/withdrawals/${w2.data.withdrawal.id}/cancel`);
  assert.equal(c.data.withdrawal.status, "cancelled");
  assert.equal(bal("nova.keys").available_cents, b0.available_cents);
  assertLedger();
});

test("large withdrawals wait for staff review; admins approve or reject", async () => {
  await admin.patch("/api/admin/settings/monetization", { withdrawal: { review_threshold_cents: 1500 } });
  const ok = (await nova.get("/api/creator/payout-methods")).data.items.find((m) => m.label === "Test bank account");
  const b0 = bal("nova.keys");
  const amount = Math.min(b0.available_cents, 2000);
  assert.ok(amount > 1500);
  const w = await nova.post("/api/creator/withdrawals", { amount_cents: amount, payout_method_id: ok.id, idempotency_key: ikey() });
  const code = /\b(\d{6})\b/.exec((await nova.get("/api/dev/outbox")).data.items[0].body)[1];
  const v = await nova.post(`/api/creator/withdrawals/${w.data.withdrawal.id}/verify`, { code });
  assert.equal(v.data.withdrawal.awaiting_review, true);
  assert.equal((await nova.post(`/api/admin/withdrawals/${w.data.withdrawal.id}/approve`)).status, 403);
  const queue = await admin.get("/api/admin/withdrawals");
  assert.ok(queue.data.items.some((x) => x.id === w.data.withdrawal.id));
  const rej = await admin.post(`/api/admin/withdrawals/${w.data.withdrawal.id}/reject`, { reason: "Verify identity first" });
  assert.equal(rej.data.withdrawal.status, "rejected");
  assert.equal(bal("nova.keys").available_cents, b0.available_cents);
  await admin.patch("/api/admin/settings/monetization", { withdrawal: { review_threshold_cents: 20_000 } });
  assertLedger();
});

test("verification codes: expiry and attempt limits cancel the withdrawal", async () => {
  const ok = (await nova.get("/api/creator/payout-methods")).data.items.find((m) => m.label === "Test bank account");
  const b0 = bal("nova.keys");
  const w = await nova.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: ok.id, idempotency_key: ikey() });
  for (let i = 0; i < 5; i++) await nova.post(`/api/creator/withdrawals/${w.data.withdrawal.id}/verify`, { code: "111111" });
  const r = await nova.post(`/api/creator/withdrawals/${w.data.withdrawal.id}/verify`, { code: "111111" });
  assert.equal(r.data.error.code, "too_many_attempts");
  assert.equal(bal("nova.keys").available_cents, b0.available_cents);
  const w2 = await nova.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: ok.id, idempotency_key: ikey() });
  T.db.run("UPDATE withdrawals SET code_expires_at = ? WHERE id = ?", Date.now() - 1, w2.data.withdrawal.id);
  const e = await nova.post(`/api/creator/withdrawals/${w2.data.withdrawal.id}/verify`, { code: "123456" });
  assert.equal(e.data.error.code, "code_expired");
  assert.equal(bal("nova.keys").available_cents, b0.available_cents);
  assertLedger();
});

test("non-creators can't withdraw; balances are private", async () => {
  assert.equal((await rafi.post("/api/creator/withdrawals", { amount_cents: 1000, payout_method_id: "x", idempotency_key: ikey() })).data.error.code, "not_creator");
  const w = await rafi.get("/api/wallet");
  assert.equal(w.data.balances.available_cents, 0);
  const tx = await rafi.get("/api/wallet/transactions");
  assert.ok(tx.data.items.every((t) => t.user_id === uid("rafi.listens")));
});

test("admin settings validation and role enforcement", async () => {
  assert.equal((await nova.get("/api/admin/settings/monetization")).status, 403);
  assert.equal((await admin.patch("/api/admin/settings/monetization", { donation: { fee_bps: 9000 } })).status, 400);
  assert.equal((await admin.patch("/api/admin/settings/monetization", { currency: "usd" })).status, 400);
  const g = await admin.post("/api/admin/gifts", { name: "Bad", icon: "star", animation: "float", credit_cost: 0 });
  assert.equal(g.data.error.code, "invalid_cost");
  const ok = await admin.post("/api/admin/gifts", { name: "Mic Drop", icon: "mic", animation: "burst", credit_cost: 75, creator_share_bps: 8000 });
  assert.equal(ok.data.gift.platform_fee_bps, 2000);
  const upd = await admin.patch(`/api/admin/gifts/${ok.data.gift.id}`, { credit_cost: 80 });
  assert.equal(upd.data.gift.credit_cost, 80);
  const cat = await rafi.get("/api/gifts/catalog");
  assert.ok(cat.data.items.some((x) => x.name === "Mic Drop" && x.credit_cost === 80));
  assert.ok(!cat.data.items.some((x) => x.id === "gift_crown"), "disabled gifts are hidden");
});

test("final reconciliation across everything", () => assertLedger());
