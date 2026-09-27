// Credits, gifts and donations. All money logic runs on the server:
//  • prices come from the gift catalog and the credit packages on the server; clients send only ids
//  • every write is idempotent (unique user + idempotency_key) and runs in a single SQLite transaction
//  • balances are rows with CHECK (>= 0); a debit that would overdraw fails (no double spending)
//  • every balance change writes matching ledger rows (transactions), which the tests reconcile
//  • payment results arrive only as signed provider webhooks, and replays are ignored
//
// GIFTS ≠ DONATIONS: a gift is a virtual item bought with credits the viewer already holds. A donation
// (tip) is a direct money payment that goes through the payment provider every time.
import { id } from "../lib/ids.js";
import { bad, forbidden, notFound, HttpError, readBody } from "../lib/http.js";
import { json } from "../lib/db.js";
import { getUser, isBlockedEither, privacyOf, card } from "./users.js";
import { notify } from "./notifications.js";
import { canWatch } from "./live.js";
import { canViewPost } from "./posts.js";

export const DEFAULT_SETTINGS = {
  currency: "USD",
  credit_value_cents: 1,              // gross value of one credit when it's gifted
  earnings_hold_seconds: 7 * 86400,   // pending → available after this long (refund and chargeback window)
  refund_window_hours: 72,
  donation: { min_cents: 100, max_cents: 50_000, fee_bps: 500, allowed_contexts: ["live", "post", "profile"] },
  gifts: { min_account_age_minutes: 10, max_credits_per_minute: 5_000, daily_credit_limit: 50_000 },
  withdrawal: { min_cents: 1_000, max_cents: 500_000, review_threshold_cents: 20_000, code_ttl_minutes: 10 },
};
export function settings(S) {
  const row = S.db.get("SELECT value FROM settings WHERE key = 'monetization'");
  const v = json(row?.value, {});
  return { ...DEFAULT_SETTINGS, ...v, donation: { ...DEFAULT_SETTINGS.donation, ...v.donation }, gifts: { ...DEFAULT_SETTINGS.gifts, ...v.gifts }, withdrawal: { ...DEFAULT_SETTINGS.withdrawal, ...v.withdrawal } };
}

const testMode = (S) => (S.payments.testMode ? 1 : 0);
export function ledger(S, { userId, type, amount, unit, balance, status = "completed", relatedType = null, relatedId = null, contextType = null, contextId = null, counterpartyId = null, note = null, test = 1 }) {
  S.db.run(`INSERT INTO transactions (id, user_id, type, amount, unit, currency, balance, status, related_type, related_id, context_type, context_id, counterparty_id, test_mode, note, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id("tx"), userId, type, amount, unit, unit === "cents" ? settings(S).currency : null, balance, status, relatedType, relatedId, contextType, contextId, counterpartyId, test, note, S.now());
}
export const balances = (S, uid) => S.db.get("SELECT pending_cents, available_cents, held_cents, lifetime_cents FROM creator_balances WHERE user_id = ?", uid);
const credits = (S, uid) => S.db.get("SELECT credits FROM wallets WHERE user_id = ?", uid)?.credits ?? 0;

function requireKey(body) {
  const k = String(body.idempotency_key ?? "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(k)) throw bad("idempotency_key_required", "A unique idempotency_key (16–80 chars) is required for payments.");
  return k;
}

/** Check that a gift or donation target (live / post / profile) is valid for this recipient. */
function validateContext(S, user, recipient, contextType, contextId) {
  if (contextType === "live") {
    const st = S.db.get("SELECT * FROM live_streams WHERE id = ?", String(contextId ?? ""));
    if (!st || st.status !== "live") throw bad("live_not_active", "This live has ended.");
    if (st.host_id !== recipient.id) throw bad("wrong_recipient", "Gifts in a live go to its host.");
    if (!canWatch(S, user.id, st)) throw forbidden("cannot_watch", "You can’t support in this live.");
    return st.id;
  }
  if (contextType === "post") {
    const p = S.db.get("SELECT * FROM posts WHERE id = ?", String(contextId ?? ""));
    if (!p || !canViewPost(S, user.id, p)) throw notFound("That post isn’t available.");
    if (p.author_id !== recipient.id) throw bad("wrong_recipient", "Support on a post goes to its author.");
    return p.id;
  }
  if (contextType === "profile") return null;
  throw bad("invalid_context", "Unknown context.");
}

function assertRecipient(S, user, recipientId) {
  const r = getUser(S, String(recipientId ?? ""));
  if (!r || r.status !== "active") throw notFound("That creator isn’t available.");
  if (r.id === user.id) throw bad("self_support", "You can’t send gifts or tips to yourself.");
  if (!r.is_creator) throw bad("not_creator", "This account doesn’t accept gifts or tips.");
  if (isBlockedEither(S, user.id, r.id)) throw forbidden("blocked", "You can’t support this account.");
  return r;
}

/* ------------------------------------------------------------------ credits ------ */
export async function purchaseCredits(S, user, body) {
  if (!S.payments.available) throw new HttpError(503, "payments_not_configured", "Buying credits isn’t available on this server.");
  const key = requireKey(body);
  const existing = S.db.get("SELECT * FROM credit_purchases WHERE user_id = ? AND idempotency_key = ?", user.id, key);
  if (existing) return purchaseOut(S, existing);
  S.limiter.take("payment", user.id);
  const pkg = S.db.get("SELECT * FROM credit_packages WHERE id = ? AND status = 'active'", String(body.package_id ?? ""));
  if (!pkg) throw bad("invalid_package", "That credit pack isn’t available.");
  const pid = id("pay"), cpid = id("cp"), now = S.now();
  S.db.tx(() => {
    S.db.run("INSERT INTO payments (id, user_id, purpose, purpose_id, amount_cents, currency, provider, status, test_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      pid, user.id, "credit_purchase", cpid, pkg.amount_cents, pkg.currency, S.payments.name, "requires_payment", testMode(S), now, now);
    S.db.run("INSERT INTO credit_purchases (id, user_id, package_id, credits, amount_cents, currency, status, payment_id, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      cpid, user.id, pkg.id, pkg.credits, pkg.amount_cents, pkg.currency, "requires_payment", pid, key, now);
  });
  await openCheckout(S, pid, { amountCents: pkg.amount_cents, currency: pkg.currency, description: `${pkg.credits} TUNIBEAT credits`, userId: user.id });
  return purchaseOut(S, S.db.get("SELECT * FROM credit_purchases WHERE id = ?", cpid));
}

export async function openCheckout(S, paymentId, opts) {
  try {
    const out = await S.payments.createCheckout({ paymentId, successUrl: `${S.cfg.publicUrl ?? ""}/#/social/wallet?paid=${paymentId}`, cancelUrl: `${S.cfg.publicUrl ?? ""}/#/social/wallet?cancelled=${paymentId}`, ...opts });
    S.db.run("UPDATE payments SET provider_ref = ?, updated_at = ? WHERE id = ?", out.providerRef, S.now(), paymentId);
    checkouts.set(paymentId, out.checkout);
  } catch (err) {
    failPayment(S, paymentId);
    throw err;
  }
}
const checkouts = new Map();   // paymentId → checkout descriptor (session or redirect URL)
/** The checkout descriptor for a payment that still needs paying (sandbox sessions can be rebuilt after a restart). */
export function checkoutFor(S, pay) {
  if (!pay || pay.status !== "requires_payment") return null;
  return checkouts.get(pay.id) ?? (pay.provider === "sandbox" ? { type: "sandbox", session: pay.provider_ref, payment_id: pay.id, test_mode: true } : null);
}

function purchaseOut(S, cp) {
  const pay = S.db.get("SELECT * FROM payments WHERE id = ?", cp.payment_id);
  return { purchase: { id: cp.id, credits: cp.credits, amount_cents: cp.amount_cents, currency: cp.currency, status: cp.status, created_at: cp.created_at, test_mode: !!pay?.test_mode },
    checkout: cp.status === "requires_payment" ? checkouts.get(cp.payment_id) ?? (pay?.provider === "sandbox" ? { type: "sandbox", session: pay.provider_ref, payment_id: pay.id, test_mode: true } : null) : null };
}

/**
 * Other modules (the stores) settle their own payment purposes through the same verified-webhook path:
 *   succeed(S, payment) runs inside the settling transaction and returns data for after(S, data, payment),
 *   which runs after commit (notifications, real-time events); fail(S, payment) runs inside a transaction.
 */
const PURPOSES = new Map();
export function registerPaymentPurpose(name, handlers) { PURPOSES.set(name, handlers); }

export function failPayment(S, paymentId) {
  S.db.tx(() => {
    const p = S.db.get("SELECT * FROM payments WHERE id = ?", paymentId);
    if (!p || p.status !== "requires_payment") return;
    S.db.run("UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ?", S.now(), p.id);
    if (PURPOSES.has(p.purpose)) PURPOSES.get(p.purpose).fail(S, p);
    else if (p.purpose === "credit_purchase") S.db.run("UPDATE credit_purchases SET status = 'failed' WHERE id = ?", p.purpose_id);
    else S.db.run("UPDATE donations SET status = 'failed' WHERE id = ?", p.purpose_id);
  });
}

/** Apply a verified provider event. Idempotent: replays are recorded once and then ignored. */
export function handlePaymentEvent(S, provider, ev) {
  const fresh = S.db.run("INSERT OR IGNORE INTO webhook_events (provider, event_id, type, received_at) VALUES (?,?,?,?)", provider, String(ev.id), String(ev.type), S.now()).changes;
  if (!fresh) return { ok: true, duplicate: true };
  const pay = S.db.get("SELECT * FROM payments WHERE provider = ? AND provider_ref = ?", provider, String(ev.providerRef ?? ""));
  if (!pay) return { ok: true, ignored: "unknown_payment" };
  if (ev.type === "payment.failed") { failPayment(S, pay.id); S.rt.toUser(pay.user_id, { t: "payment", payment_id: pay.id, status: "failed" }); return { ok: true, status: "failed" }; }
  if (ev.type !== "payment.succeeded") return { ok: true, ignored: ev.type };

  const after = S.db.tx(() => {
    const p = S.db.get("SELECT * FROM payments WHERE id = ?", pay.id);
    if (p.status !== "requires_payment") return null;              // already settled: never credit twice
    const now = S.now();
    S.db.run("UPDATE payments SET status = 'succeeded', updated_at = ? WHERE id = ?", now, p.id);
    if (PURPOSES.has(p.purpose)) return { kind: "purpose", info: PURPOSES.get(p.purpose).succeed(S, p) };
    if (p.purpose === "credit_purchase") {
      const cp = S.db.get("SELECT * FROM credit_purchases WHERE id = ?", p.purpose_id);
      S.db.run("UPDATE credit_purchases SET status = 'succeeded', completed_at = ? WHERE id = ?", now, cp.id);
      S.db.run("UPDATE wallets SET credits = credits + ?, updated_at = ? WHERE user_id = ?", cp.credits, now, cp.user_id);
      ledger(S, { userId: cp.user_id, type: "credit_purchase", amount: cp.credits, unit: "credits", balance: "wallet", relatedType: "credit_purchase", relatedId: cp.id, test: p.test_mode, note: `Paid ${(cp.amount_cents / 100).toFixed(2)} ${cp.currency}` });
      return { kind: "credits", cp };
    }
    const d = S.db.get("SELECT * FROM donations WHERE id = ?", p.purpose_id);
    S.db.run("UPDATE donations SET status = 'succeeded', completed_at = ? WHERE id = ?", now, d.id);
    const hold = settings(S).earnings_hold_seconds * 1000;
    S.db.run("INSERT INTO earnings (id, creator_id, source_type, source_id, gross_cents, fee_cents, net_cents, status, available_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id("er"), d.recipient_id, "donation", d.id, d.amount_cents, d.fee_cents, d.creator_cents, "pending", now + hold, now);
    S.db.run("UPDATE creator_balances SET pending_cents = pending_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = ? WHERE user_id = ?", d.creator_cents, d.creator_cents, now, d.recipient_id);
    ledger(S, { userId: d.donor_id, type: "donation_sent", amount: -d.amount_cents, unit: "cents", balance: "external", relatedType: "donation", relatedId: d.id, contextType: d.context_type, contextId: d.context_id, counterpartyId: d.recipient_id, test: p.test_mode });
    ledger(S, { userId: d.recipient_id, type: "donation_received", amount: d.amount_cents, unit: "cents", balance: "pending", relatedType: "donation", relatedId: d.id, contextType: d.context_type, contextId: d.context_id, counterpartyId: d.donor_id, test: p.test_mode });
    if (d.fee_cents) ledger(S, { userId: d.recipient_id, type: "platform_fee", amount: -d.fee_cents, unit: "cents", balance: "pending", relatedType: "donation", relatedId: d.id, test: p.test_mode });
    return { kind: "donation", d };
  });
  if (!after) return { ok: true, already: true };
  if (after.kind === "purpose") {
    PURPOSES.get(pay.purpose).after?.(S, after.info, pay);
    S.rt.toUser(pay.user_id, { t: "payment", payment_id: pay.id, status: "succeeded", purpose: pay.purpose });
    return { ok: true, status: "succeeded" };
  }
  if (after.kind === "credits") {
    S.rt.toUser(after.cp.user_id, { t: "wallet", credits: credits(S, after.cp.user_id) });
    S.rt.toUser(after.cp.user_id, { t: "payment", payment_id: pay.id, status: "succeeded", purpose: "credit_purchase" });
    notify(S, { userId: after.cp.user_id, type: "credits_added", targetType: "wallet", data: { credits: after.cp.credits, test_mode: !!pay.test_mode } });
  } else {
    const d = after.d;
    S.rt.toUser(d.donor_id, { t: "payment", payment_id: pay.id, status: "succeeded", purpose: "donation", donation_id: d.id });
    S.rt.toUser(d.recipient_id, { t: "earnings", balances: balances(S, d.recipient_id) });
    notify(S, { userId: d.recipient_id, type: "donation_received", actorId: d.donor_id, targetType: d.context_type, targetId: d.context_id ?? d.donor_id, data: { amount_cents: d.amount_cents, net_cents: d.creator_cents, message: d.message, test_mode: !!pay.test_mode } });
    if (d.context_type === "live") {
      const lm = id("lm");
      S.db.run("INSERT INTO live_messages (id, stream_id, user_id, kind, body, data, created_at) VALUES (?,?,?,?,?,?,?)", lm, d.context_id, d.donor_id, "donation", d.message.slice(0, 200) || "Sent a tip", JSON.stringify({ amount_cents: d.amount_cents, currency: d.currency, test_mode: !!pay.test_mode }), S.now());
      S.rt.publish(`live:${d.context_id}`, { t: "live:donation", stream: d.context_id, message_id: lm, user: card(S, d.donor_id), amount_cents: d.amount_cents, currency: d.currency, message: d.message, test_mode: !!pay.test_mode });
    }
  }
  return { ok: true, status: "succeeded" };
}

/* ------------------------------------------------------------------ gifts -------- */
export function sendGift(S, user, body) {
  const key = requireKey(body);
  const prior = S.db.get("SELECT * FROM gifts WHERE sender_id = ? AND idempotency_key = ?", user.id, key);
  if (prior) return { gift: giftOut(prior), credits: credits(S, user.id), duplicate: true };
  S.limiter.take("gift", user.id);
  const cfg = settings(S);
  const recipient = assertRecipient(S, user, body.recipient_id);
  const contextType = String(body.context_type ?? "profile");
  const contextId = validateContext(S, user, recipient, contextType, body.context_id);
  const g = S.db.get("SELECT * FROM gift_catalog WHERE id = ? AND status = 'active'", String(body.gift_id ?? ""));
  if (!g) throw bad("invalid_gift", "That gift isn’t available.");
  if (g.availability === "live_only" && contextType !== "live") throw bad("gift_live_only", `${g.name} can only be sent during a live.`);
  if (g.availability === "profile_only" && contextType === "live") throw bad("gift_not_in_live", `${g.name} can’t be sent during a live.`);
  const now = S.now();
  if (now - user.created_at < cfg.gifts.min_account_age_minutes * 60_000) throw forbidden("account_too_new", `New accounts can send gifts ${cfg.gifts.min_account_age_minutes} minutes after sign-up.`);
  const lastMinute = S.db.get("SELECT COALESCE(SUM(credit_cost),0) n FROM gifts WHERE sender_id = ? AND created_at > ?", user.id, now - 60_000).n;
  if (lastMinute + g.credit_cost > cfg.gifts.max_credits_per_minute) throw new HttpError(429, "gift_velocity", "You’re sending gifts too fast. Take a breath and try again in a minute.");
  const today = S.db.get("SELECT COALESCE(SUM(credit_cost),0) n FROM gifts WHERE sender_id = ? AND created_at > ?", user.id, now - 864e5).n;
  if (today + g.credit_cost > cfg.gifts.daily_credit_limit) throw forbidden("daily_limit", "You’ve reached today’s gifting limit.");

  const gross = g.credit_cost * cfg.credit_value_cents;
  const creatorCents = Math.floor((gross * g.creator_share_bps) / 10_000);
  const platformCents = gross - creatorCents;
  const gid = id("gf");
  S.db.tx(() => {
    const debit = S.db.run("UPDATE wallets SET credits = credits - ?, updated_at = ? WHERE user_id = ? AND credits >= ?", g.credit_cost, now, user.id, g.credit_cost);
    if (!debit.changes) throw new HttpError(402, "insufficient_credits", "You don’t have enough credits for that gift.", { needed: g.credit_cost, credits: credits(S, user.id) });
    S.db.run(`INSERT INTO gifts (id, sender_id, recipient_id, gift_id, gift_name, credit_cost, gross_cents, creator_cents, platform_cents, context_type, context_id, idempotency_key, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, gid, user.id, recipient.id, g.id, g.name, g.credit_cost, gross, creatorCents, platformCents, contextType, contextId, key, now);
    S.db.run("INSERT INTO earnings (id, creator_id, source_type, source_id, gross_cents, fee_cents, net_cents, status, available_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id("er"), recipient.id, "gift", gid, gross, platformCents, creatorCents, "pending", now + cfg.earnings_hold_seconds * 1000, now);
    S.db.run("UPDATE creator_balances SET pending_cents = pending_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = ? WHERE user_id = ?", creatorCents, creatorCents, now, recipient.id);
    const t = testMode(S);
    ledger(S, { userId: user.id, type: "gift_sent", amount: -g.credit_cost, unit: "credits", balance: "wallet", relatedType: "gift", relatedId: gid, contextType, contextId, counterpartyId: recipient.id, test: t, note: g.name });
    ledger(S, { userId: recipient.id, type: "gift_received", amount: gross, unit: "cents", balance: "pending", relatedType: "gift", relatedId: gid, contextType, contextId, counterpartyId: user.id, test: t, note: g.name });
    if (platformCents) ledger(S, { userId: recipient.id, type: "platform_fee", amount: -platformCents, unit: "cents", balance: "pending", relatedType: "gift", relatedId: gid, test: t });
  });
  const gift = S.db.get("SELECT * FROM gifts WHERE id = ?", gid);
  const left = credits(S, user.id);
  S.rt.toUser(user.id, { t: "wallet", credits: left });
  S.rt.toUser(recipient.id, { t: "earnings", balances: balances(S, recipient.id) });
  notify(S, { userId: recipient.id, type: "gift_received", actorId: user.id, targetType: contextType, targetId: contextId ?? user.id, data: { gift: g.name, icon: g.icon, credits: g.credit_cost, net_cents: creatorCents } });
  if (contextType === "live") {
    const lm = id("lm");
    S.db.run("INSERT INTO live_messages (id, stream_id, user_id, kind, body, data, created_at) VALUES (?,?,?,?,?,?,?)", lm, contextId, user.id, "gift", `sent ${g.name}`, JSON.stringify({ gift_id: g.id, icon: g.icon, animation: g.animation, credits: g.credit_cost }), now);
    S.rt.publish(`live:${contextId}`, { t: "live:gift", stream: contextId, message_id: lm, gift: { id: g.id, name: g.name, icon: g.icon, animation: g.animation, credits: g.credit_cost }, user: card(S, user.id) });
  }
  return { gift: giftOut(gift), credits: left };
}
const giftOut = (g) => ({ id: g.id, gift_id: g.gift_id, name: g.gift_name, credits: g.credit_cost, recipient_id: g.recipient_id, context_type: g.context_type, context_id: g.context_id, created_at: g.created_at });

/* ------------------------------------------------------------------ donations ---- */
export async function createDonation(S, user, body) {
  if (!S.payments.available) throw new HttpError(503, "payments_not_configured", "Tips aren’t available on this server.");
  const key = requireKey(body);
  const prior = S.db.get("SELECT * FROM donations WHERE donor_id = ? AND idempotency_key = ?", user.id, key);
  if (prior) return donationOut(S, prior);
  S.limiter.take("payment", user.id);
  const cfg = settings(S);
  const recipient = assertRecipient(S, user, body.recipient_id);
  if (!privacyOf(S, recipient.id).allow_tips) throw forbidden("tips_off", "This creator isn’t accepting tips right now.");
  const contextType = String(body.context_type ?? "profile");
  if (!cfg.donation.allowed_contexts.includes(contextType)) throw bad("invalid_context", "Tips aren’t enabled here.");
  const contextId = validateContext(S, user, recipient, contextType, body.context_id);
  if (contextType === "post" && !S.db.get("SELECT allow_tips FROM posts WHERE id = ?", contextId)?.allow_tips) throw forbidden("tips_off", "Tips are off for this post.");
  const amount = Number(body.amount_cents);
  if (!Number.isInteger(amount)) throw bad("invalid_amount", "Amount must be a whole number of cents.");
  if (amount < cfg.donation.min_cents || amount > cfg.donation.max_cents) throw bad("amount_out_of_range", `Tips are between ${(cfg.donation.min_cents / 100).toFixed(2)} and ${(cfg.donation.max_cents / 100).toFixed(2)} ${cfg.currency}.`);
  if (body.currency && body.currency !== cfg.currency) throw bad("invalid_currency", `Tips are in ${cfg.currency}.`);
  const message = String(body.message ?? "").trim().slice(0, 200);
  const fee = Math.round((amount * cfg.donation.fee_bps) / 10_000);
  const did = id("dn"), pid = id("pay"), now = S.now();
  S.db.tx(() => {
    S.db.run("INSERT INTO payments (id, user_id, purpose, purpose_id, amount_cents, currency, provider, status, test_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      pid, user.id, "donation", did, amount, cfg.currency, S.payments.name, "requires_payment", testMode(S), now, now);
    S.db.run(`INSERT INTO donations (id, donor_id, recipient_id, amount_cents, currency, fee_cents, creator_cents, message, context_type, context_id, status, payment_id, idempotency_key, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, did, user.id, recipient.id, amount, cfg.currency, fee, amount - fee, message, contextType, contextId, "requires_payment", pid, key, now);
  });
  await openCheckout(S, pid, { amountCents: amount, currency: cfg.currency, description: `Tip for @${recipient.username}`, userId: user.id });
  return donationOut(S, S.db.get("SELECT * FROM donations WHERE id = ?", did));
}
function donationOut(S, d) {
  const pay = S.db.get("SELECT * FROM payments WHERE id = ?", d.payment_id);
  return {
    donation: { id: d.id, recipient: card(S, d.recipient_id), amount_cents: d.amount_cents, fee_cents: d.fee_cents, creator_cents: d.creator_cents, currency: d.currency, message: d.message, status: d.status, context_type: d.context_type, context_id: d.context_id, created_at: d.created_at, test_mode: !!pay?.test_mode },
    checkout: d.status === "requires_payment" ? checkouts.get(d.payment_id) ?? (pay?.provider === "sandbox" ? { type: "sandbox", session: pay.provider_ref, payment_id: pay.id, test_mode: true } : null) : null,
  };
}

/* ------------------------------------------------------------------ release job -- */
export function releaseEarnings(S) {
  const due = S.db.all("SELECT * FROM earnings WHERE status = 'pending' AND available_at <= ? LIMIT 500", S.now());
  const touched = new Set();
  for (const e of due) {
    S.db.tx(() => {
      const r = S.db.run("UPDATE earnings SET status = 'available' WHERE id = ? AND status = 'pending'", e.id);
      if (!r.changes) return;
      S.db.run("UPDATE creator_balances SET pending_cents = pending_cents - ?, available_cents = available_cents + ?, updated_at = ? WHERE user_id = ?", e.net_cents, e.net_cents, S.now(), e.creator_id);
      ledger(S, { userId: e.creator_id, type: "earning_release", amount: -e.net_cents, unit: "cents", balance: "pending", relatedType: e.source_type, relatedId: e.source_id });
      ledger(S, { userId: e.creator_id, type: "earning_release", amount: e.net_cents, unit: "cents", balance: "available", relatedType: e.source_type, relatedId: e.source_id });
      touched.add(e.creator_id);
    });
  }
  for (const uid of touched) {
    S.rt.toUser(uid, { t: "earnings", balances: balances(S, uid) });
    notify(S, { userId: uid, type: "earnings_available", targetType: "wallet", data: { balances: balances(S, uid) } });
  }
  return due.length;
}

/* ------------------------------------------------------------------ refunds ------ */
export async function refundDonation(S, admin, donationId, reason) {
  const d = S.db.get("SELECT * FROM donations WHERE id = ?", donationId);
  if (!d) throw notFound("Donation not found.");
  if (d.status !== "succeeded") throw new HttpError(409, "not_refundable", `This donation is ${d.status}.`);
  const cfg = settings(S);
  if (S.now() - d.completed_at > cfg.refund_window_hours * 3600_000) throw new HttpError(409, "refund_window_closed", `Refunds are possible for ${cfg.refund_window_hours} hours.`);
  const e = S.db.get("SELECT * FROM earnings WHERE source_type = 'donation' AND source_id = ?", d.id);
  const b = balances(S, d.recipient_id);
  const bucket = e.status === "pending" ? "pending" : "available";
  if ((bucket === "pending" ? b.pending_cents : b.available_cents) < e.net_cents) throw new HttpError(409, "insufficient_creator_balance", "The creator has already withdrawn these funds; handle this as a manual adjustment.");
  const pay = S.db.get("SELECT * FROM payments WHERE id = ?", d.payment_id);
  const res = await S.payments.refund({ providerRef: pay.provider_ref, amountCents: d.amount_cents });
  if (res.status === "failed") throw new HttpError(502, "refund_failed", "The payment provider rejected the refund.");
  S.db.tx(() => {
    const cur = S.db.get("SELECT status FROM donations WHERE id = ?", d.id);
    if (cur.status !== "succeeded") throw new HttpError(409, "not_refundable", "Already refunded.");
    const now = S.now();
    S.db.run("UPDATE donations SET status = 'refunded', refunded_at = ? WHERE id = ?", now, d.id);
    S.db.run("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", now, pay.id);
    S.db.run("UPDATE earnings SET status = 'reversed' WHERE id = ?", e.id);
    S.db.run(`UPDATE creator_balances SET ${bucket}_cents = ${bucket}_cents - ?, lifetime_cents = lifetime_cents - ?, updated_at = ? WHERE user_id = ?`, e.net_cents, e.net_cents, now, d.recipient_id);
    ledger(S, { userId: d.recipient_id, type: "refund_reversal", amount: -e.net_cents, unit: "cents", balance: bucket, relatedType: "donation", relatedId: d.id, counterpartyId: d.donor_id, test: pay.test_mode, note: reason });
    ledger(S, { userId: d.donor_id, type: "refund", amount: d.amount_cents, unit: "cents", balance: "external", relatedType: "donation", relatedId: d.id, counterpartyId: d.recipient_id, test: pay.test_mode, note: reason });
    S.db.run("INSERT INTO moderation_actions (id, moderator_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)", id("ma"), admin.id, "refund_donation", "donation", d.id, reason ?? null, now);
  });
  notify(S, { userId: d.recipient_id, type: "donation_refunded", targetType: "donation", targetId: d.id, data: { amount_cents: d.amount_cents } });
  notify(S, { userId: d.donor_id, type: "system", targetType: "donation", targetId: d.id, data: { text: `Your tip of $${(d.amount_cents / 100).toFixed(2)} was refunded.` } });
  S.rt.toUser(d.recipient_id, { t: "earnings", balances: balances(S, d.recipient_id) });
  return { ok: true };
}

/* ------------------------------------------------------------------ routes ------- */
export function register(r, S) {
  r.get("/api/wallet", ({ user }) => ({
    credits: credits(S, user.id),
    packages: S.db.all("SELECT id, credits, amount_cents, currency FROM credit_packages WHERE status = 'active' ORDER BY sort"),
    payments: { provider: S.payments.name, available: S.payments.available, test_mode: S.payments.testMode },
    balances: balances(S, user.id),
    settings: (({ currency, donation, credit_value_cents, earnings_hold_seconds }) => ({ currency, donation: { min_cents: donation.min_cents, max_cents: donation.max_cents, fee_bps: donation.fee_bps }, credit_value_cents, earnings_hold_seconds }))(settings(S)),
  }));

  r.get("/api/wallet/transactions", ({ user, query }) => {
    const scope = query.scope === "earnings" ? "AND balance IN ('pending','available','held')" : query.scope === "wallet" ? "AND balance IN ('wallet','external')" : "";
    const rows = S.db.all(`SELECT * FROM transactions WHERE user_id = ? ${scope} ${query.cursor ? "AND id < ?" : ""} ORDER BY id DESC LIMIT 31`, user.id, ...(query.cursor ? [String(query.cursor)] : []));
    const page = rows.slice(0, 30);
    const cps = {};
    page.filter((t) => t.counterparty_id).forEach((t) => (cps[t.counterparty_id] = card(S, t.counterparty_id)));
    return { items: page.map((t) => ({ ...t, test_mode: !!t.test_mode, counterparty: cps[t.counterparty_id] ?? null })), next_cursor: rows.length > 30 ? page.at(-1).id : null };
  });

  r.post("/api/wallet/purchases", ({ user, body }) => purchaseCredits(S, user, body));
  r.get("/api/wallet/purchases/:id", ({ user, params }) => {
    const cp = S.db.get("SELECT * FROM credit_purchases WHERE id = ? AND user_id = ?", params.id, user.id);
    if (!cp) throw notFound("Purchase not found.");
    return purchaseOut(S, cp);
  });

  r.get("/api/gifts/catalog", ({ query }) => ({
    items: S.db.all(`SELECT id, name, icon, animation, credit_cost, availability FROM gift_catalog WHERE status = 'active' ${query.context === "live" ? "AND availability <> 'profile_only'" : query.context ? "AND availability <> 'live_only'" : ""} ORDER BY sort, credit_cost`),
  }));
  r.post("/api/gifts/send", ({ user, body }) => sendGift(S, user, body));

  r.post("/api/donations", ({ user, body }) => createDonation(S, user, body));
  r.get("/api/donations/:id", ({ user, params }) => {
    const d = S.db.get("SELECT * FROM donations WHERE id = ? AND (donor_id = ? OR recipient_id = ?)", params.id, user.id, user.id);
    if (!d) throw notFound("Donation not found.");
    return donationOut(S, d);
  });

  // Sandbox "hosted payment page" (dev only). It emits a signed webhook exactly as a real provider would.
  r.post("/api/payments/sandbox/:ref/complete", ({ user, params, body }) => {
    if (S.payments.name !== "sandbox") throw notFound();
    const pay = S.db.get("SELECT * FROM payments WHERE provider = 'sandbox' AND provider_ref = ? AND user_id = ?", params.ref, user.id);
    if (!pay) throw notFound("Checkout session not found.");
    const outcome = body.outcome === "decline" ? "payment.failed" : body.outcome === "cancel" ? "payment.failed" : "payment.succeeded";
    const ev = S.payments.signEvent({ id: id("evt"), type: outcome, data: { provider_ref: pay.provider_ref } });
    const verified = S.payments.verifyWebhook(ev.body, ev.headers);
    const res = handlePaymentEvent(S, "sandbox", verified);
    return { ...res, payment_id: pay.id, test_mode: true };
  }, { dev: true });

  // Provider webhooks: authenticated by signature, not by session or CSRF header
  r.post("/api/payments/webhooks/:provider", async ({ params, req }) => {
    if (params.provider !== S.payments.name) throw notFound();
    const raw = await readBody(req, 256 * 1024);
    const ev = S.payments.verifyWebhook(raw, req.headers);
    return handlePaymentEvent(S, params.provider, ev);
  }, { public: true, webhook: true, raw: true });
}

export function jobs(S) { S.every(Number(process.env.EARNINGS_RELEASE_INTERVAL_MS ?? 15_000), () => releaseEarnings(S)); }
