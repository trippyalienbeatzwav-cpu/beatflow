// Payout provider adapters (creator withdrawals).
//   createAccount({ userId, scenario }) → { providerRef, label, status }
//   payout({ providerRef, amountCents, currency, idempotencyKey }, onSettled) → { providerRef }
//       onSettled({ status: "completed" | "failed", reason }) fires when the provider reports the outcome.
//
// "sandbox": no money moves. Accounts are tokens such as "sbx_acct_…"; a "fails" scenario lets you test
//            failed payouts. Settlement happens after a short delay, as a real provider's webhook would.
// "none"   : withdrawals disabled. For production, implement this interface against a payout provider
//            (e.g. Stripe Connect transfers + payouts); bank details stay with the provider, never this server.
import { HttpError } from "../lib/http.js";
import { id } from "../lib/ids.js";

export function createPayoutProvider(cfg) {
  if (cfg.payouts.provider !== "sandbox") {
    const off = () => { throw new HttpError(503, "payouts_not_configured", "Payouts are not configured on this server."); };
    return { name: "none", available: false, testMode: false, createAccount: off, payout: off };
  }
  const settleMs = cfg.payouts.sandboxSettleMs ?? 3000;
  return {
    name: "sandbox", available: true, testMode: true,
    createAccount({ scenario }) {
      const fails = scenario === "fails";
      return { providerRef: `sbx_acct_${fails ? "fail_" : ""}${id("x").slice(2)}`, label: fails ? "Test account · always fails" : "Test bank account", status: "verified" };
    },
    payout({ providerRef }, onSettled) {
      const ref = id("sbxpo");
      const t = setTimeout(() => onSettled(providerRef.includes("_fail_")
        ? { status: "failed", reason: "The test bank rejected the transfer (sandbox failure scenario)." }
        : { status: "completed" }), settleMs);
      t.unref?.();
      return { providerRef: ref };
    },
  };
}
