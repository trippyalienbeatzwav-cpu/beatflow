// Store pricing. The ONLY place prices, discounts, fees and seller splits are calculated; the client
// shows what the server quotes and never sends amounts. All money is integer cents.
import { json } from "../../lib/db.js";

export const FORMAT_ADD_CENTS = { MP3: 0, WAV: 50, AIFF: 50 };
export const TRACK_BASE_CENTS = 149;
export const BEAT_SERVICE_FEE_CENTS = 149;       // license agreement generation + stem hosting, once per order with beats
export const BUNDLE_BPS = 2000;                  // 2+ non-exclusive leases from one producer → 20% off those lines
export const COMMISSION_BPS = { beats: 1500, electronic: 2000 };   // platform share of each paid line

/** License price for a beat: producer multiplier on the license base, ending in .99 (exclusives round to tens). */
export function licensePriceCents(license, priceMult) {
  const dollars = (license.price_cents / 100) * priceMult;
  return license.exclusive ? Math.round(dollars / 10) * 1000 - 1 : Math.round(dollars) * 100 - 1;
}
export const trackPriceCents = (format) => TRACK_BASE_CENTS + (FORMAT_ADD_CENTS[format] ?? 0);
/** Whole release: 20% off the sum of its tracks (rounded up to a .99 price) when it has 2+ tracks. */
export function releasePriceCents(trackCount, format) {
  const sum = trackCount * trackPriceCents(format);
  return trackCount > 1 ? Math.ceil((sum * 0.8) / 100) * 100 - 1 : sum;
}

/** Split `total` across `weights` proportionally with exact integer sums (largest remainder). */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!total || !sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { out[i]++; rest--; } });
  return out;
}

/**
 * Quote resolved lines: [{ key, kind, marketplace, unit_cents, producer_id?, license_exclusive? }].
 * Returns per-line discounts and seller/platform splits plus order-level totals per marketplace.
 */
export function quoteLines(lines, promo) {
  const subtotal = lines.reduce((s, l) => s + l.unit_cents, 0);
  // Producer bundle: 2+ non-exclusive leases from the same producer
  const bundle = new Array(lines.length).fill(0);
  const byProducer = new Map();
  lines.forEach((l, i) => { if (l.kind === "beat" && !l.license_exclusive) byProducer.set(l.producer_id, [...(byProducer.get(l.producer_id) ?? []), i]); });
  for (const idx of byProducer.values()) if (idx.length >= 2) idx.forEach((i) => (bundle[i] = Math.round((lines[i].unit_cents * BUNDLE_BPS) / 10000)));
  const bundleTotal = bundle.reduce((a, b) => a + b, 0);
  // Promo: a percentage of what's left after the bundle, spread over lines by their remaining value
  const afterBundle = lines.map((l, i) => l.unit_cents - bundle[i]);
  const promoTotal = promo ? Math.round(((subtotal - bundleTotal) * promo.percent_bps) / 10000) : 0;
  const promoParts = allocate(promoTotal, afterBundle);
  const out = lines.map((l, i) => {
    const discount = bundle[i] + promoParts[i];
    const paid = l.unit_cents - discount;
    const fee = Math.round((paid * COMMISSION_BPS[l.marketplace]) / 10000);
    return { ...l, bundle_cents: bundle[i], promo_cents: promoParts[i], discount_cents: discount, paid_cents: paid, fee_cents: fee, seller_cents: paid - fee };
  });
  const hasBeats = lines.some((l) => l.kind === "beat");
  const serviceFee = hasBeats ? BEAT_SERVICE_FEE_CENTS : 0;
  const orders = {};
  for (const l of out) {
    const o = (orders[l.marketplace] ??= { marketplace: l.marketplace, subtotal_cents: 0, discount_cents: 0, fee_cents: 0, total_cents: 0, lines: [] });
    o.subtotal_cents += l.unit_cents; o.discount_cents += l.discount_cents; o.lines.push(l.key);
  }
  if (orders.beats) orders.beats.fee_cents = serviceFee;       // the service fee belongs to the Beats Store order
  for (const o of Object.values(orders)) o.total_cents = o.subtotal_cents - o.discount_cents + o.fee_cents;
  const discount = bundleTotal + promoTotal;
  return {
    lines: out, orders: Object.values(orders),
    subtotal_cents: subtotal, bundle_cents: bundleTotal, promo_cents: promoTotal, discount_cents: discount,
    service_fee_cents: serviceFee, tax_cents: 0, total_cents: subtotal - discount + serviceFee,
    promo: promo ? { code: promo.code, percent: promo.percent_bps / 100 } : null,
  };
}

export const beatData = (b) => json(b.data, {});
