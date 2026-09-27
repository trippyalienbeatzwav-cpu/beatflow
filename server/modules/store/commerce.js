// Store commerce: cart → server quote → checkout (one payment, one order per marketplace) → settlement.
// The client never sends prices. Settlement runs only from a verified payment webhook, inside one
// transaction: orders are marked paid, entitlements granted, seller earnings recorded (pending until the
// hold period passes) and every money movement written to the ledger.
import { id } from "../../lib/ids.js";
import { json } from "../../lib/db.js";
import { bad, notFound, HttpError } from "../../lib/http.js";
import { settings, ledger, balances, openCheckout, checkoutFor, registerPaymentPurpose, failPayment } from "../wallet.js";
import { notify } from "../notifications.js";
import { licensePriceCents, trackPriceCents, releasePriceCents, quoteLines } from "./pricing.js";
import { invalidateCatalog, reindexSearch, stemsAvailable } from "./catalog.js";

const KINDS = ["beat", "pack", "track", "release"];
const FORMATS = ["WAV", "AIFF", "MP3"];
const HOLD_MS = 30 * 60_000;                                  // exclusive rights held while a checkout is unpaid
export const COUNTRIES = { US: "United States", GB: "United Kingdom", DE: "Germany", NL: "Netherlands", CA: "Canada", FR: "France", NG: "Nigeria", BR: "Brazil", JP: "Japan", ZA: "South Africa", AU: "Australia", ES: "Spain", IT: "Italy", SE: "Sweden", IE: "Ireland" };

/* ------------------------------------------------------------------ ownership ---- */
export function owns(S, userId, kind, itemId, licenseId = null) {
  if (!userId) return false;
  const active = "revoked_at IS NULL AND user_id = ?";
  if (kind === "beat") return !!S.db.get(`SELECT 1 FROM entitlements WHERE ${active} AND kind = 'beat' AND item_id = ? ${licenseId ? "AND license_id = ?" : ""}`, ...(licenseId ? [userId, itemId, licenseId] : [userId, itemId]));
  if (kind === "track") return !!S.db.get(`SELECT 1 FROM entitlements WHERE ${active} AND ((kind = 'track' AND item_id = ?) OR (kind = 'release' AND item_id = (SELECT release_id FROM tracks WHERE id = ?)))`, userId, itemId, itemId);
  return !!S.db.get(`SELECT 1 FROM entitlements WHERE ${active} AND kind = ? AND item_id = ?`, userId, kind, itemId);
}

/* ------------------------------------------------------------------ line resolution */
const lineKey = (kind, itemId) => `${kind}:${itemId}`;
/** Turn a requested cart line into a priced, validated line — or a problem the buyer can fix. */
export function resolveLine(S, userId, raw) {
  const kind = String(raw.kind ?? ""), itemId = String(raw.id ?? raw.item_id ?? "");
  const key = lineKey(kind, itemId);
  const problem = (code, message) => ({ key, kind, item_id: itemId, problem: { code, message } });
  if (!KINDS.includes(kind) || !/^[\w-]{1,40}$/.test(itemId)) return problem("invalid_item", "That item doesn’t exist.");
  const now = S.now();
  if (kind === "beat") {
    const b = S.db.get("SELECT b.*, p.user_id seller FROM beats b JOIN producers p ON p.id = b.producer_id WHERE b.id = ?", itemId);
    if (!b || b.status !== "published") return problem("unavailable", b?.status === "sold_exclusive" ? "This beat was sold with exclusive rights." : "This beat is no longer for sale.");
    if (raw.format) return problem("invalid_line", "Beats are licensed, not bought by download format.");
    const lic = S.db.get("SELECT * FROM licenses WHERE id = ?", String(raw.license_id ?? raw.licenseId ?? "basic"));
    if (!lic) return problem("invalid_license", "Choose a license tier.");
    if (userId && b.seller === userId) return problem("own_item", "You can’t buy your own beat.");
    if (json(lic.formats, []).includes("STEMS") && !stemsAvailable(S.db.get("SELECT * FROM audio_assets WHERE id = ?", b.audio_id))) return problem("license_unavailable", `The ${lic.name} includes stems, and this producer hasn’t uploaded them.`);
    const heldByOther = b.exclusive_hold_until > now && S.db.get("SELECT user_id FROM store_checkouts WHERE id = ?", b.exclusive_hold_checkout)?.user_id !== userId;
    if (lic.exclusive && (!b.exclusive_available || heldByOther)) return problem("exclusive_unavailable", "Exclusive rights aren’t available for this beat right now.");
    if (owns(S, userId, "beat", b.id, lic.id)) return problem("already_owned", `You already own the ${lic.name} for this beat.`);
    return { key, kind, marketplace: "beats", item_id: b.id, license_id: lic.id, format: null, title: `${b.title} — ${lic.name}`, seller_user_id: b.seller, producer_id: b.producer_id,
      license_exclusive: !!lic.exclusive, unit_cents: licensePriceCents(lic, b.price_mult) };
  }
  if (kind === "pack") {
    const k = S.db.get("SELECT k.*, p.user_id seller FROM packs k JOIN producers p ON p.id = k.producer_id WHERE k.id = ?", itemId);
    if (!k || k.status !== "published") return problem("unavailable", "This pack is no longer for sale.");
    if (userId && k.seller === userId) return problem("own_item", "You can’t buy your own pack.");
    if (owns(S, userId, "pack", k.id)) return problem("already_owned", "You already own this pack.");
    return { key, kind, marketplace: "beats", item_id: k.id, license_id: null, format: null, title: k.title, seller_user_id: k.seller, producer_id: k.producer_id, unit_cents: k.price_cents };
  }
  const releaseOf = (rid) => S.db.get(`SELECT r.*, COALESCE(l.owner_id, r.owner_id) seller FROM releases r LEFT JOIN labels l ON l.id = r.label_id WHERE r.id = ?`, rid);
  if (kind === "track") {
    const t = S.db.get("SELECT * FROM tracks WHERE id = ?", itemId);
    const rel = t && releaseOf(t.release_id);
    if (!t || t.status !== "published" || rel?.status !== "published") return problem("unavailable", "This track is no longer for sale.");
    const format = String(raw.format ?? "");
    if (!json(rel.formats, []).includes(format)) return problem("invalid_format", `${format || "That format"} isn’t offered for this track.`);
    if (raw.license_id || raw.licenseId) return problem("invalid_line", "Electronic music is sold as downloads, not licenses.");
    if (userId && rel.seller === userId) return problem("own_item", "You can’t buy your own release.");
    if (owns(S, userId, "track", t.id)) return problem("already_owned", "You already own this track.");
    return { key, kind, marketplace: "electronic", item_id: t.id, license_id: null, format, title: `${t.title}${t.mix ? ` (${t.mix})` : ""} · ${format}`, seller_user_id: rel.seller, release_id: rel.id, unit_cents: trackPriceCents(format) };
  }
  const rel = releaseOf(itemId);
  if (!rel || rel.status !== "published") return problem("unavailable", "This release is no longer for sale.");
  const format = String(raw.format ?? "");
  if (!json(rel.formats, []).includes(format)) return problem("invalid_format", `${format || "That format"} isn’t offered for this release.`);
  if (userId && rel.seller === userId) return problem("own_item", "You can’t buy your own release.");
  if (owns(S, userId, "release", rel.id)) return problem("already_owned", "You already own this release.");
  const n = S.db.get("SELECT COUNT(*) n FROM tracks WHERE release_id = ? AND status = 'published'", rel.id).n;
  return { key, kind, marketplace: "electronic", item_id: rel.id, license_id: null, format, title: `${rel.title} · ${format}`, seller_user_id: rel.seller, release_id: rel.id, unit_cents: releasePriceCents(n, format) };
}

/** Normalise a list of requested lines: dedupe, and a whole release supersedes its individual tracks. */
function normalise(S, items) {
  if (!Array.isArray(items)) throw bad("invalid_cart", "Cart items must be a list.");
  if (items.length > 100) throw bad("cart_too_large", "A cart can hold up to 100 items.");
  const byKey = new Map();
  for (const it of items) { if (it && typeof it === "object") byKey.set(lineKey(String(it.kind), String(it.id ?? it.item_id)), it); }
  const releases = new Set([...byKey.values()].filter((i) => i.kind === "release").map((i) => String(i.id ?? i.item_id)));
  if (releases.size) for (const [k, it] of byKey) if (it.kind === "track") { const t = S.db.get("SELECT release_id FROM tracks WHERE id = ?", String(it.id ?? it.item_id)); if (t && releases.has(t.release_id)) byKey.delete(k); }
  return [...byKey.values()];
}

export function findPromo(S, code, userId) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(c)) throw bad("invalid_promo", `“${String(code).slice(0, 24)}” isn’t a valid code.`);
  const p = S.db.get("SELECT * FROM promo_codes WHERE code = ?", c);
  if (!p || !p.active || (p.ends_at && p.ends_at < S.now()) || (p.max_redemptions && p.redemptions >= p.max_redemptions)) throw bad("invalid_promo", `“${c}” isn’t a valid code.`);
  if (userId && p.once_per_user && S.db.get("SELECT 1 FROM store_checkouts WHERE user_id = ? AND promo_code = ? AND status = 'paid'", userId, p.code)) throw bad("promo_used", `You’ve already used ${p.code}.`);
  return p;
}

/** Price a set of requested lines. Problems are returned, never silently dropped. */
export function quote(S, userId, items, promoCode) {
  const resolved = normalise(S, items).map((it) => resolveLine(S, userId, it));
  const ok = resolved.filter((l) => !l.problem), problems = resolved.filter((l) => l.problem).map((l) => ({ key: l.key, ...l.problem }));
  const promo = findPromo(S, promoCode, userId);
  return { ...quoteLines(ok, promo), problems };
}

/* ------------------------------------------------------------------ cart --------- */
const cartRows = (S, userId) => S.db.all("SELECT * FROM cart_items WHERE user_id = ? ORDER BY added_at", userId).map((c) => ({ kind: c.kind, id: c.item_id, license_id: c.license_id, format: c.format }));
function cartOut(S, userId, promo) {
  const items = cartRows(S, userId);
  let q;
  try { q = quote(S, userId, items, promo); } catch (err) { if (err.code !== "invalid_promo" && err.code !== "promo_used") throw err; q = { ...quote(S, userId, items, null), promo_error: err.message }; }
  return { items, quote: q };
}
export function writeCart(S, userId, items) {
  const norm = normalise(S, items);
  S.db.tx(() => {
    S.db.run("DELETE FROM cart_items WHERE user_id = ?", userId);
    const now = S.now();
    norm.forEach((it, i) => {
      const kind = String(it.kind), itemId = String(it.id ?? it.item_id);
      if (!KINDS.includes(kind) || !/^[\w-]{1,40}$/.test(itemId)) throw bad("invalid_item", "One of the cart items is invalid.");
      const lic = kind === "beat" ? String(it.license_id ?? it.licenseId ?? "basic") : null;
      const fmt = kind === "track" || kind === "release" ? String(it.format ?? "") : null;
      if (lic && !S.db.get("SELECT 1 FROM licenses WHERE id = ?", lic)) throw bad("invalid_license", "Unknown license tier.");
      if (fmt !== null && !FORMATS.includes(fmt)) throw bad("invalid_format", "Formats are WAV, AIFF or MP3.");
      S.db.run("INSERT INTO cart_items (user_id, line_key, kind, item_id, license_id, format, added_at) VALUES (?,?,?,?,?,?,?)", userId, lineKey(kind, itemId), kind, itemId, lic, fmt, now + i);
    });
  });
}

/* ------------------------------------------------------------------ checkout ----- */
const orderId = (m) => `${m === "beats" ? "TBB" : "TBE"}-${Date.now().toString(36).slice(-4).toUpperCase()}-${id("x").slice(-3).toUpperCase()}`;

export function checkoutOut(S, c) {
  const orders = S.db.all("SELECT * FROM store_orders WHERE checkout_id = ? ORDER BY marketplace", c.id);
  const items = orders.length ? S.db.all(`SELECT * FROM order_items WHERE order_id IN (${orders.map(() => "?").join(",")}) ORDER BY created_at, id`, ...orders.map((o) => o.id)) : [];
  const pay = c.payment_id ? S.db.get("SELECT * FROM payments WHERE id = ?", c.payment_id) : null;
  const ent = new Map(items.length ? S.db.all(`SELECT id, order_item_id FROM entitlements WHERE order_item_id IN (${items.map(() => "?").join(",")})`, ...items.map((i) => i.id)).map((e) => [e.order_item_id, e.id]) : []);
  return {
    id: c.id, status: c.status, created_at: c.created_at, email: c.email, legal_name: c.legal_name, alias: c.alias, country: c.country, promo_code: c.promo_code,
    subtotal_cents: c.subtotal_cents, discount_cents: c.discount_cents, fee_cents: c.fee_cents, tax_cents: c.tax_cents, total_cents: c.total_cents, currency: c.currency,
    payment: pay ? { id: pay.id, status: pay.status, provider: pay.provider, test_mode: !!pay.test_mode } : null,
    checkout: checkoutFor(S, pay),
    orders: orders.map((o) => ({ id: o.id, marketplace: o.marketplace, status: o.status, subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, fee_cents: o.fee_cents, total_cents: o.total_cents, paid_at: o.paid_at,
      items: items.filter((i) => i.order_id === o.id).map((i) => ({ id: i.id, kind: i.kind, item_id: i.item_id, license_id: i.license_id, format: i.format, title: i.title, unit_cents: i.unit_cents, discount_cents: i.discount_cents, paid_cents: i.paid_cents, entitlement_id: ent.get(i.id) ?? null })) })),
  };
}

export async function createCheckout(S, user, body) {
  const key = String(body.idempotency_key ?? "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw bad("idempotency_key_required", "A unique idempotency_key (16–80 chars) is required.");
  const prior = S.db.get("SELECT * FROM store_checkouts WHERE user_id = ? AND idempotency_key = ?", user.id, key);
  if (prior) return { checkout: checkoutOut(S, prior), duplicate: true };
  S.limiter.take("payment", user.id);
  if (!S.payments.available) throw new HttpError(503, "payments_not_configured", "Payments are not configured on this server.");
  const email = String(body.email ?? "").trim().toLowerCase();
  const legal = String(body.legal_name ?? "").trim().replace(/\s+/g, " ");
  const alias = String(body.alias ?? "").trim().slice(0, 60) || null;
  const country = String(body.country ?? "").toUpperCase();
  const postal = String(body.postal_code ?? "").trim();
  const errors = {};
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email address.";
  if (legal.length < 2 || legal.length > 100) errors.legal_name = "Enter your full name (2–100 characters).";
  if (!COUNTRIES[country]) errors.country = "Choose a supported country.";
  if (!/^[A-Za-z0-9 -]{2,12}$/.test(postal)) errors.postal_code = "Enter a valid postal code.";
  if (body.agree !== true) errors.agree = "Please confirm the terms to continue.";
  if (Object.keys(errors).length) throw bad("invalid_checkout", "Check the highlighted fields.", { fields: errors });

  const items = cartRows(S, user.id);
  if (!items.length) throw bad("empty_cart", "Your cart is empty.");
  const q = quote(S, user.id, items, body.promo_code || null);
  if (q.problems.length) throw new HttpError(409, "cart_invalid", "Some items in your cart can’t be bought. Review your cart.", { problems: q.problems });
  if (body.expected_total_cents != null && Number(body.expected_total_cents) !== q.total_cents) throw new HttpError(409, "price_changed", "Prices changed since you last looked. Review the new total.", { quote: q });
  if (q.total_cents <= 0) throw bad("invalid_total", "This order has nothing to pay.");

  // A new checkout supersedes this buyer's older unpaid ones (and frees their exclusive holds)
  for (const old of S.db.all("SELECT * FROM store_checkouts WHERE user_id = ? AND status = 'requires_payment'", user.id)) {
    failPayment(S, old.payment_id);
    S.db.run("UPDATE store_checkouts SET status = 'cancelled' WHERE id = ?", old.id);
    S.db.run("UPDATE store_orders SET status = 'cancelled' WHERE checkout_id = ?", old.id);
  }
  const cid = id("co"), pid = id("pay"), now = S.now();
  S.db.tx(() => {
    // Reserve exclusive rights for this checkout; fails if someone else holds or bought them
    for (const l of q.lines.filter((x) => x.license_exclusive)) {
      const ok = S.db.run(`UPDATE beats SET exclusive_hold_checkout = ?, exclusive_hold_until = ? WHERE id = ? AND status = 'published' AND exclusive_available = 1
        AND (exclusive_hold_until IS NULL OR exclusive_hold_until < ?)`, cid, now + HOLD_MS, l.item_id, now).changes;
      if (!ok) throw new HttpError(409, "exclusive_unavailable", "Someone else is buying exclusive rights to this beat right now.");
    }
    S.db.run("INSERT INTO payments (id, user_id, purpose, purpose_id, amount_cents, currency, provider, status, test_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      pid, user.id, "store_checkout", cid, q.total_cents, "USD", S.payments.name, "requires_payment", S.payments.testMode ? 1 : 0, now, now);
    S.db.run(`INSERT INTO store_checkouts (id, user_id, idempotency_key, payment_id, status, promo_code, email, legal_name, alias, country, postal_code, subtotal_cents, discount_cents, fee_cents, tax_cents, total_cents, currency, created_at, updated_at)
      VALUES (?,?,?,?,'requires_payment',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, cid, user.id, key, pid, q.promo?.code ?? null, email, legal, alias, country, postal,
      q.subtotal_cents, q.discount_cents, q.service_fee_cents, q.tax_cents, q.total_cents, "USD", now, now);
    for (const o of q.orders) {
      const oid = orderId(o.marketplace);
      S.db.run(`INSERT INTO store_orders (id, checkout_id, user_id, marketplace, status, subtotal_cents, discount_cents, fee_cents, total_cents, currency, created_at) VALUES (?,?,?,?,'pending',?,?,?,?,?,?)`,
        oid, cid, user.id, o.marketplace, o.subtotal_cents, o.discount_cents, o.fee_cents, o.total_cents, "USD", now);
      for (const l of q.lines.filter((x) => x.marketplace === o.marketplace)) {
        S.db.run(`INSERT INTO order_items (id, order_id, kind, item_id, license_id, format, title, seller_user_id, unit_cents, discount_cents, paid_cents, fee_cents, seller_cents, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id("oi"), oid, l.kind, l.item_id, l.license_id, l.format, l.title.slice(0, 200), l.seller_user_id, l.unit_cents, l.discount_cents, l.paid_cents, l.fee_cents, l.seller_cents, now);
      }
    }
  });
  const base = S.cfg.publicUrl ?? "";
  await openCheckout(S, pid, { amountCents: q.total_cents, currency: "USD", description: `TUNIBEAT order (${q.lines.length} item${q.lines.length === 1 ? "" : "s"})`, userId: user.id,
    successUrl: `${base}/#/checkout/success?c=${cid}`, cancelUrl: `${base}/#/checkout?cancelled=${cid}` });
  return { checkout: checkoutOut(S, S.db.get("SELECT * FROM store_checkouts WHERE id = ?", cid)) };
}

/* ------------------------------------------------------------------ settlement --- */
function releaseHolds(S, checkoutId) {
  S.db.run("UPDATE beats SET exclusive_hold_checkout = NULL, exclusive_hold_until = NULL WHERE exclusive_hold_checkout = ?", checkoutId);
}
registerPaymentPurpose("store_checkout", {
  succeed(S, p) {
    const c = S.db.get("SELECT * FROM store_checkouts WHERE id = ?", p.purpose_id);
    const now = S.now();
    S.db.run("UPDATE store_checkouts SET status = 'paid', updated_at = ? WHERE id = ?", now, c.id);
    S.db.run("UPDATE store_orders SET status = 'paid', paid_at = ? WHERE checkout_id = ?", now, c.id);
    const items = S.db.all("SELECT oi.* FROM order_items oi JOIN store_orders o ON o.id = oi.order_id WHERE o.checkout_id = ?", c.id);
    const hold = settings(S).earnings_hold_seconds * 1000;
    const sellers = new Map();
    for (const it of items) {
      S.db.run("INSERT OR IGNORE INTO entitlements (id, user_id, kind, item_id, license_id, format, order_item_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("en"), c.user_id, it.kind, it.item_id, it.license_id, it.format, it.id, now);
      if (it.kind === "beat" && S.db.get("SELECT exclusive FROM licenses WHERE id = ?", it.license_id)?.exclusive) {
        S.db.run("UPDATE beats SET status = 'sold_exclusive', exclusive_available = 0, exclusive_hold_checkout = NULL, exclusive_hold_until = NULL WHERE id = ?", it.item_id);
        S.db.run("DELETE FROM cart_items WHERE kind = 'beat' AND item_id = ? AND user_id != ?", it.item_id, c.user_id);
      }
      if (it.seller_user_id && it.seller_cents > 0) {
        S.db.run("INSERT INTO earnings (id, creator_id, source_type, source_id, gross_cents, fee_cents, net_cents, status, available_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          id("er"), it.seller_user_id, "sale", it.id, it.paid_cents, it.fee_cents, it.seller_cents, "pending", now + hold, now);
        S.db.run("UPDATE creator_balances SET pending_cents = pending_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = ? WHERE user_id = ?", it.seller_cents, it.seller_cents, now, it.seller_user_id);
        ledger(S, { userId: it.seller_user_id, type: "sale_received", amount: it.paid_cents, unit: "cents", balance: "pending", relatedType: "order_item", relatedId: it.id, counterpartyId: c.user_id, test: p.test_mode });
        if (it.fee_cents) ledger(S, { userId: it.seller_user_id, type: "platform_fee", amount: -it.fee_cents, unit: "cents", balance: "pending", relatedType: "order_item", relatedId: it.id, test: p.test_mode });
        sellers.set(it.seller_user_id, [...(sellers.get(it.seller_user_id) ?? []), it]);
      }
    }
    ledger(S, { userId: c.user_id, type: "purchase", amount: -c.total_cents, unit: "cents", balance: "external", relatedType: "store_checkout", relatedId: c.id, test: p.test_mode });
    if (c.promo_code) S.db.run("UPDATE promo_codes SET redemptions = redemptions + 1 WHERE code = ?", c.promo_code);
    // Purchased lines leave the cart
    for (const it of items) S.db.run("DELETE FROM cart_items WHERE user_id = ? AND line_key = ?", c.user_id, `${it.kind}:${it.item_id}`);
    releaseHolds(S, c.id);
    return { checkoutId: c.id, userId: c.user_id, sellers: [...sellers.entries()], orders: S.db.all("SELECT id, marketplace, total_cents FROM store_orders WHERE checkout_id = ?", c.id) };
  },
  after(S, info) {
    invalidateCatalog(S);
    notify(S, { userId: info.userId, type: "store_order_paid", targetType: "store_checkout", targetId: info.checkoutId, data: { orders: info.orders } });
    for (const [sellerId, items] of info.sellers) {
      notify(S, { userId: sellerId, type: "store_sale", actorId: info.userId, targetType: "store_sale", targetId: items[0].order_id,
        data: { items: items.map((i) => ({ title: i.title, kind: i.kind, net_cents: i.seller_cents })), net_cents: items.reduce((s, i) => s + i.seller_cents, 0) } });
      S.rt.toUser(sellerId, { t: "store:sale", order_id: items[0].order_id });
    }
    S.rt.toUser(info.userId, { t: "store:checkout", checkout_id: info.checkoutId, status: "paid" });
  },
  fail(S, p) {
    S.db.run("UPDATE store_checkouts SET status = 'failed', updated_at = ? WHERE id = ?", S.now(), p.purpose_id);
    S.db.run("UPDATE store_orders SET status = 'failed' WHERE checkout_id = ?", p.purpose_id);
    releaseHolds(S, p.purpose_id);
  },
});

/** Unpaid checkouts expire after the hold period: the payment is cancelled and exclusive holds released. */
export function expireCheckouts(S) {
  const stale = S.db.all("SELECT * FROM store_checkouts WHERE status = 'requires_payment' AND created_at < ?", S.now() - HOLD_MS);
  for (const c of stale) S.db.tx(() => {
    S.db.run("UPDATE store_checkouts SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'requires_payment'", S.now(), c.id);
    S.db.run("UPDATE store_orders SET status = 'cancelled' WHERE checkout_id = ? AND status = 'pending'", c.id);
    S.db.run("UPDATE payments SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'requires_payment'", S.now(), c.payment_id);
    releaseHolds(S, c.id);
  });
  return stale.length;
}

/* ------------------------------------------------------------------ receipts ----- */
const money = (c) => `$${(c / 100).toFixed(2)}`;
function receiptText(S, o, c, items) {
  const lines = [
    "TUNIBEAT — RECEIPT", "", `Order:        ${o.id} (${o.marketplace === "beats" ? "Beats Store" : "Electronic Music Store"})`, `Payment:      ${c.payment_id}${S.payments.testMode ? " (TEST MODE — no money moved)" : ""}`,
    `Date:         ${new Date(o.paid_at ?? o.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC`, `Customer:     ${c.legal_name}${c.alias ? ` p/k/a ${c.alias}` : ""} <${c.email}>`,
    `Country:      ${COUNTRIES[c.country] ?? c.country} ${c.postal_code}`, `Status:       ${o.status}`, "", "Items",
    ...items.map((i) => `  ${i.title.padEnd(56).slice(0, 56)} ${money(i.unit_cents).padStart(9)}${i.discount_cents ? `  (−${money(i.discount_cents)})` : ""}`),
    "", `Subtotal      ${money(o.subtotal_cents)}`, `Discounts     −${money(o.discount_cents)}`, `Fees          ${money(o.fee_cents)}`, `Tax           ${money(0)} (digital goods; see Terms)`, `Total         ${money(o.total_cents)} USD`, "",
    "Downloads are available in your library. Terms: https://tunibeat.example/legal/terms",
  ];
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------ routes ------- */
/* ------------------------------------------------------------------ refunds ------ */
/**
 * Refund a whole paid checkout (one payment). The provider refund runs first; then, atomically: orders are
 * marked refunded, entitlements revoked (downloads stop working), seller earnings reversed from the bucket they
 * are in, and ledger entries written. An exclusive that was refunded goes back to the producer as a draft.
 */
export async function refundStoreCheckout(S, admin, checkoutId, reason) {
  const c = S.db.get("SELECT * FROM store_checkouts WHERE id = ?", checkoutId);
  if (!c) throw notFound("Checkout not found.");
  const orders = S.db.all("SELECT * FROM store_orders WHERE checkout_id = ?", c.id);
  if (c.status !== "paid" || !orders.some((o) => o.status === "paid")) throw new HttpError(409, "not_refundable", "Only paid orders can be refunded.");
  const items = S.db.all("SELECT oi.* FROM order_items oi JOIN store_orders o ON o.id = oi.order_id WHERE o.checkout_id = ?", c.id);
  const earnings = items.map((it) => S.db.get("SELECT * FROM earnings WHERE source_type = 'sale' AND source_id = ?", it.id)).filter(Boolean);
  // Every seller must still hold the money in the bucket it sits in (otherwise it was withdrawn: manual adjustment)
  const need = new Map();
  for (const e of earnings) { if (e.status === "reversed") continue; const k = `${e.creator_id}:${e.status === "pending" ? "pending" : "available"}`; need.set(k, (need.get(k) ?? 0) + e.net_cents); }
  for (const [k, cents] of need) { const [uid, bucket] = k.split(":"); if ((balances(S, uid)?.[`${bucket}_cents`] ?? 0) < cents) throw new HttpError(409, "insufficient_creator_balance", "A seller has already withdrawn these funds; handle this as a manual adjustment."); }
  const pay = c.payment_id ? S.db.get("SELECT * FROM payments WHERE id = ?", c.payment_id) : null;
  if (pay) {
    const res = await S.payments.refund({ providerRef: pay.provider_ref, amountCents: c.total_cents });
    if (res.status === "failed") throw new HttpError(502, "refund_failed", "The payment provider rejected the refund.");
  }
  const now = S.now();
  S.db.tx(() => {
    if (!S.db.get("SELECT 1 FROM store_orders WHERE checkout_id = ? AND status = 'paid'", c.id)) throw new HttpError(409, "not_refundable", "Already refunded.");
    S.db.run("UPDATE store_orders SET status = 'refunded' WHERE checkout_id = ? AND status = 'paid'", c.id);
    if (pay) S.db.run("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", now, pay.id);
    for (const it of items) {
      S.db.run("UPDATE entitlements SET revoked_at = ? WHERE order_item_id = ? AND revoked_at IS NULL", now, it.id);
      if (it.kind === "beat" && S.db.get("SELECT exclusive FROM licenses WHERE id = ?", it.license_id)?.exclusive)
        S.db.run("UPDATE beats SET status = 'draft', exclusive_available = 1 WHERE id = ? AND status = 'sold_exclusive'", it.item_id);
    }
    for (const e of earnings) {
      if (e.status === "reversed") continue;
      const bucket = e.status === "pending" ? "pending" : "available";
      S.db.run("UPDATE earnings SET status = 'reversed' WHERE id = ?", e.id);
      S.db.run(`UPDATE creator_balances SET ${bucket}_cents = ${bucket}_cents - ?, lifetime_cents = lifetime_cents - ?, updated_at = ? WHERE user_id = ?`, e.net_cents, e.net_cents, now, e.creator_id);
      ledger(S, { userId: e.creator_id, type: "sale_reversal", amount: -e.net_cents, unit: "cents", balance: bucket, relatedType: "order_item", relatedId: e.source_id, counterpartyId: c.user_id, test: pay?.test_mode ?? 1, note: reason });
    }
    ledger(S, { userId: c.user_id, type: "refund", amount: c.total_cents, unit: "cents", balance: "external", relatedType: "store_checkout", relatedId: c.id, test: pay?.test_mode ?? 1, note: reason });
    S.db.run("INSERT INTO moderation_actions (id, moderator_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)", id("ma"), admin.id, "refund_store_order", "store_checkout", c.id, reason ?? null, now);
  });
  invalidateCatalog(S); reindexSearch(S);
  notify(S, { userId: c.user_id, type: "system", targetType: "store_checkout", targetId: c.id, data: { text: `Your order of ${(c.total_cents / 100).toFixed(2)} was refunded. The items were removed from your library.` } });
  for (const uid of new Set(earnings.map((e) => e.creator_id))) { notify(S, { userId: uid, type: "system", targetType: "store_checkout", targetId: c.id, data: { text: "A sale was refunded and its earnings reversed." } }); S.rt.toUser(uid, { t: "earnings", balances: balances(S, uid) }); }
  return { ok: true, refunded_cents: c.total_cents };
}

export function register(r, S) {
  r.get("/api/store/cart", ({ user, query }) => cartOut(S, user.id, query.promo_code || null));
  r.put("/api/store/cart", ({ user, body }) => { S.limiter.take("cart", user.id); writeCart(S, user.id, body.items ?? []); return cartOut(S, user.id, body.promo_code || null); });
  r.post("/api/store/cart/items", ({ user, body }) => {
    S.limiter.take("cart", user.id);
    const items = cartRows(S, user.id);
    const kind = String(body.kind ?? ""), itemId = String(body.id ?? "");
    let status = "added";
    if (kind === "track") {
      const t = S.db.get("SELECT release_id FROM tracks WHERE id = ?", itemId);
      if (t && items.some((i) => i.kind === "release" && i.id === t.release_id)) return { status: "covered", ...cartOut(S, user.id) };
    }
    const line = resolveLine(S, user.id, body);
    if (line.problem) throw new HttpError(line.problem.code === "unavailable" ? 410 : 400, line.problem.code, line.problem.message);
    const existing = items.findIndex((i) => i.kind === kind && i.id === itemId);
    if (existing >= 0) { items[existing] = { kind, id: itemId, license_id: line.license_id, format: line.format }; status = "updated"; }
    else items.push({ kind, id: itemId, license_id: line.license_id, format: line.format });
    const before = items.length;
    writeCart(S, user.id, items);
    const replaced = kind === "release" ? before - cartRows(S, user.id).length : 0;
    return { status, replaced, ...cartOut(S, user.id) };
  });
  r.delete("/api/store/cart/items/:key", ({ user, params }) => {
    S.db.run("DELETE FROM cart_items WHERE user_id = ? AND line_key = ?", user.id, params.key);
    return cartOut(S, user.id);
  });
  // Quotes for signed-out shoppers (their cart lives on the device until they sign in)
  r.post("/api/store/quote", ({ user, body, ip }) => { S.limiter.take("cart", user?.id ?? ip); return quote(S, user?.id ?? null, body.items ?? [], body.promo_code || null); }, { public: true });
  r.post("/api/store/promo", ({ user, body, ip }) => {
    S.limiter.take("cart", user?.id ?? ip);
    const p = findPromo(S, body.code, user?.id ?? null);
    return { promo: { code: p.code, percent: p.percent_bps / 100 } };
  }, { public: true });

  r.post("/api/store/checkout", ({ user, body }) => createCheckout(S, user, body));
  r.get("/api/store/checkouts/:id", ({ user, params }) => {
    const c = S.db.get("SELECT * FROM store_checkouts WHERE id = ? AND user_id = ?", params.id, user.id);
    if (!c) throw notFound("Checkout not found.");
    return { checkout: checkoutOut(S, c) };
  });
  // Buyer cancels an unpaid checkout (releases any exclusive hold immediately)
  r.post("/api/store/checkouts/:id/cancel", ({ user, params }) => {
    const c = S.db.get("SELECT * FROM store_checkouts WHERE id = ? AND user_id = ?", params.id, user.id);
    if (!c) throw notFound("Checkout not found.");
    if (c.status === "requires_payment") {
      failPayment(S, c.payment_id);
      S.db.run("UPDATE store_checkouts SET status = 'cancelled' WHERE id = ?", c.id);
      S.db.run("UPDATE store_orders SET status = 'cancelled' WHERE checkout_id = ?", c.id);
    }
    return { checkout: checkoutOut(S, S.db.get("SELECT * FROM store_checkouts WHERE id = ?", c.id)) };
  });
  r.post("/api/admin/store-checkouts/:id/refund", ({ user, params, body }) => refundStoreCheckout(S, user, params.id, String(body.reason ?? "").slice(0, 200) || null), { role: "admin" });
  r.get("/api/store/orders", ({ user, query }) => {
    const m = query.marketplace;
    if (m && !["beats", "electronic"].includes(m)) throw bad("invalid_marketplace", "Unknown marketplace.");
    const rows = S.db.all(`SELECT c.* FROM store_checkouts c WHERE c.user_id = ? AND c.status IN ('paid','failed','cancelled','requires_payment') ORDER BY c.created_at DESC LIMIT 100`, user.id);
    const out = rows.map((c) => checkoutOut(S, c)).flatMap((c) => c.orders.map((o) => ({ ...o, checkout_id: c.id, payment: c.payment, created_at: c.created_at })));
    return { orders: m ? out.filter((o) => o.marketplace === m) : out };
  });
  r.get("/api/store/orders/:id/receipt", ({ user, params, res }) => {
    const o = S.db.get("SELECT * FROM store_orders WHERE id = ? AND user_id = ?", params.id, user.id);
    if (!o) throw notFound("Order not found.");
    const c = S.db.get("SELECT * FROM store_checkouts WHERE id = ?", o.checkout_id);
    const text = receiptText(S, o, c, S.db.all("SELECT * FROM order_items WHERE order_id = ?", o.id));
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${o.id}-receipt.txt"`, "Cache-Control": "no-store" });
    res.end(text);
  });
}

export function jobs(S) { S.every(60_000, () => expireCheckouts(S)); }
