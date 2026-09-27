// Payment provider adapters. Money-moving code talks only to this interface:
//   available, testMode, name
//   createCheckout({ paymentId, amountCents, currency, description, userId }) → { providerRef, checkout }
//   verifyWebhook(rawBody: Buffer, headers) → { id, type, providerRef, data }   (throws on bad signature)
//   refund({ providerRef, amountCents }) → { status: "succeeded" | "pending" | "failed" }
//
// "sandbox": a local stand-in for a hosted payment page. It moves NO real money and every response is
//            marked test_mode. Its webhooks are HMAC-signed and verified exactly like a real provider's.
// "stripe" : Stripe Checkout over the REST API. Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
//            Written against Stripe's documented API but NOT exercised here (no credentials).
// "none"   : payments disabled (the production default until a provider is configured).
import crypto from "node:crypto";
import { HttpError } from "../lib/http.js";
import { id } from "../lib/ids.js";

const hmac = (secret, s) => crypto.createHmac("sha256", secret).update(s).digest("hex");
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createPaymentProvider(cfg) {
  const p = cfg.payments.provider;
  if (p === "sandbox") return sandbox(cfg.payments.sandboxWebhookSecret);
  if (p === "stripe") return stripe(cfg.payments);
  return {
    name: "none", available: false, testMode: false,
    createCheckout() { throw new HttpError(503, "payments_not_configured", "Payments are not configured on this server."); },
    verifyWebhook() { throw new HttpError(503, "payments_not_configured", "Payments are not configured."); },
    refund() { throw new HttpError(503, "payments_not_configured", "Payments are not configured."); },
  };
}

function sandbox(secret) {
  return {
    name: "sandbox", available: true, testMode: true,
    createCheckout({ paymentId }) {
      const providerRef = id("sbxpay");
      return { providerRef, checkout: { type: "sandbox", session: providerRef, payment_id: paymentId, test_mode: true } };
    },
    /** Build a signed event the way a provider would deliver it (used by the sandbox "hosted page"). */
    signEvent(event) {
      const body = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      return { body: Buffer.from(body), headers: { "x-sandbox-signature": `t=${t},v1=${hmac(secret, `${t}.${body}`)}` } };
    },
    verifyWebhook(raw, headers) {
      const sig = String(headers["x-sandbox-signature"] ?? "");
      const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(sig);
      if (!m) throw new HttpError(400, "bad_signature", "Missing or malformed webhook signature.");
      if (Math.abs(Date.now() / 1000 - Number(m[1])) > 300) throw new HttpError(400, "stale_webhook", "Webhook timestamp outside tolerance.");
      if (!safeEq(hmac(secret, `${m[1]}.${raw.toString("utf8")}`), m[2])) throw new HttpError(400, "bad_signature", "Webhook signature mismatch.");
      const ev = JSON.parse(raw.toString("utf8"));
      return { id: ev.id, type: ev.type, providerRef: ev.data.provider_ref, data: ev.data };
    },
    refund() { return { status: "succeeded", test_mode: true }; },
  };
}

function stripe({ stripeSecretKey, stripeWebhookSecret }) {
  const ready = !!(stripeSecretKey && stripeWebhookSecret);
  const api = async (pathname, form) => {
    const r = await fetch(`https://api.stripe.com/v1/${pathname}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const j = /** @type {any} */ (await r.json());
    if (!r.ok) throw new HttpError(502, "provider_error", j.error?.message ?? "Payment provider error.");
    return j;
  };
  return {
    name: "stripe", available: ready, testMode: String(stripeSecretKey ?? "").startsWith("sk_test_"),
    async createCheckout({ paymentId, amountCents, currency, description, successUrl, cancelUrl }) {
      if (!ready) throw new HttpError(503, "payments_not_configured", "Stripe keys are not configured.");
      const s = await api("checkout/sessions", {
        mode: "payment", client_reference_id: paymentId, success_url: successUrl, cancel_url: cancelUrl,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(amountCents), "line_items[0][price_data][product_data][name]": description,
        "metadata[payment_id]": paymentId,
      });
      return { providerRef: s.id, checkout: { type: "redirect", url: s.url } };
    },
    verifyWebhook(raw, headers) {
      const sig = String(headers["stripe-signature"] ?? "");
      const parts = Object.fromEntries(sig.split(",").map((kv) => kv.split("=")));
      if (!parts.t || !parts.v1) throw new HttpError(400, "bad_signature", "Missing Stripe signature.");
      if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) throw new HttpError(400, "stale_webhook", "Stale webhook.");
      if (!safeEq(hmac(stripeWebhookSecret, `${parts.t}.${raw.toString("utf8")}`), parts.v1)) throw new HttpError(400, "bad_signature", "Signature mismatch.");
      const ev = JSON.parse(raw.toString("utf8"));
      const obj = ev.data?.object ?? {};
      const type = ev.type === "checkout.session.completed" ? "payment.succeeded"
        : ev.type === "checkout.session.expired" || ev.type === "checkout.session.async_payment_failed" ? "payment.failed"
        : ev.type === "charge.refunded" ? "refund.succeeded" : ev.type;
      return { id: ev.id, type, providerRef: obj.id, data: { payment_intent: obj.payment_intent } };
    },
    async refund({ paymentIntent, amountCents }) {
      const r = await api("refunds", { payment_intent: paymentIntent, amount: String(amountCents) });
      return { status: r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : "pending" };
    },
  };
}
