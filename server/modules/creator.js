// Creator Studio: earnings summary, analytics, payout methods and withdrawals.
// Withdrawal lifecycle: pending (needs email-code verification) → processing (sent to the payout provider,
// or waiting for staff review above the threshold) → completed | failed. Rejected and cancelled are terminal
// too. Funds move available → held when requested, and held → out (completed) or back (failed, rejected, cancelled).
import crypto from "node:crypto";
import { id } from "../lib/ids.js";
import { bad, forbidden, notFound, HttpError } from "../lib/http.js";
import { settings, ledger, balances } from "./wallet.js";
import { notify } from "./notifications.js";
import { counts } from "./users.js";

const hashCode = (wid, code) => crypto.createHash("sha256").update(`${wid}:${code}`).digest("hex");

function withdrawalOut(S, w) {
  const m = S.db.get("SELECT label, provider FROM payout_methods WHERE id = ?", w.payout_method_id);
  return { id: w.id, amount_cents: w.amount_cents, currency: w.currency, status: w.status, verified: !!w.verified_at, needs_verification: w.status === "pending" && !w.verified_at,
    awaiting_review: w.status === "processing" && !w.provider_ref, method: m ? { label: m.label, provider: m.provider } : null, failure_reason: w.failure_reason,
    test_mode: !!w.test_mode, created_at: w.created_at, updated_at: w.updated_at };
}

/** Move a held withdrawal to its final state and reconcile balances. */
export function settleWithdrawal(S, wid, status, reason = null, actorId = null) {
  const out = S.db.tx(() => {
    const w = S.db.get("SELECT * FROM withdrawals WHERE id = ?", wid);
    if (!w || !["pending", "processing"].includes(w.status)) return null;
    const now = S.now();
    S.db.run("UPDATE withdrawals SET status = ?, failure_reason = ?, reviewed_by = COALESCE(?, reviewed_by), updated_at = ? WHERE id = ?", status, reason, actorId, now, w.id);
    S.db.run("UPDATE creator_balances SET held_cents = held_cents - ?, updated_at = ? WHERE user_id = ?", w.amount_cents, now, w.creator_id);
    ledger(S, { userId: w.creator_id, type: status === "completed" ? "withdrawal" : "withdrawal_reversal", amount: -w.amount_cents, unit: "cents", balance: "held", relatedType: "withdrawal", relatedId: w.id, test: w.test_mode, status: status === "completed" ? "completed" : "reversed" });
    if (status !== "completed") {
      S.db.run("UPDATE creator_balances SET available_cents = available_cents + ? WHERE user_id = ?", w.amount_cents, w.creator_id);
      ledger(S, { userId: w.creator_id, type: "withdrawal_reversal", amount: w.amount_cents, unit: "cents", balance: "available", relatedType: "withdrawal", relatedId: w.id, test: w.test_mode, note: reason });
    } else {
      ledger(S, { userId: w.creator_id, type: "withdrawal", amount: w.amount_cents, unit: "cents", balance: "external", relatedType: "withdrawal", relatedId: w.id, test: w.test_mode, note: "Paid out" });
    }
    return S.db.get("SELECT * FROM withdrawals WHERE id = ?", w.id);
  });
  if (out) {
    S.rt.toUser(out.creator_id, { t: "earnings", balances: balances(S, out.creator_id) });
    S.rt.toUser(out.creator_id, { t: "withdrawal", withdrawal: withdrawalOut(S, out) });
    notify(S, { userId: out.creator_id, type: "withdrawal_update", targetType: "withdrawal", targetId: out.id, data: { status, amount_cents: out.amount_cents, reason, test_mode: !!out.test_mode } });
  }
  return out;
}

/** Hand a verified withdrawal to the payout provider. */
export function dispatchPayout(S, w) {
  const m = S.db.get("SELECT * FROM payout_methods WHERE id = ?", w.payout_method_id);
  const res = S.payouts.payout({ providerRef: m.provider_ref, amountCents: w.amount_cents, currency: w.currency, idempotencyKey: w.id },
    (outcome) => !S.closed && settleWithdrawal(S, w.id, outcome.status === "completed" ? "completed" : "failed", outcome.reason ?? null));
  S.db.run("UPDATE withdrawals SET provider_ref = ?, updated_at = ? WHERE id = ?", res.providerRef, S.now(), w.id);
}

function daily(S, sql, args, days) {
  const since = S.now() - days * 864e5;
  const rows = S.db.all(sql, ...args, since);
  const byDay = Object.fromEntries(rows.map((r) => [r.d, r.v]));
  return [...Array(days).keys()].map((i) => {
    const d = new Date(S.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10);
    return { date: d, value: byDay[d] ?? 0 };
  });
}

export function register(r, S) {
  r.get("/api/creator/overview", ({ user, query }) => {
    const days = [7, 30, 90].includes(Number(query.days)) ? Number(query.days) : 30;
    const since = S.now() - days * 864e5;
    const b = balances(S, user.id);
    const DAY = "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')";
    const sums = S.db.get(`SELECT
        (SELECT COALESCE(SUM(gross_cents),0) FROM gifts WHERE recipient_id = ?1 AND created_at > ?2) AS gift_gross,
        (SELECT COALESCE(SUM(creator_cents),0) FROM gifts WHERE recipient_id = ?1 AND created_at > ?2) AS gift_net,
        (SELECT COUNT(*) FROM gifts WHERE recipient_id = ?1 AND created_at > ?2) AS gift_count,
        (SELECT COALESCE(SUM(amount_cents),0) FROM donations WHERE recipient_id = ?1 AND status = 'succeeded' AND created_at > ?2) AS donation_gross,
        (SELECT COALESCE(SUM(creator_cents),0) FROM donations WHERE recipient_id = ?1 AND status = 'succeeded' AND created_at > ?2) AS donation_net,
        (SELECT COUNT(*) FROM donations WHERE recipient_id = ?1 AND status = 'succeeded' AND created_at > ?2) AS donation_count,
        (SELECT COALESCE(SUM(platform_cents),0) FROM gifts WHERE recipient_id = ?1 AND created_at > ?2)
          + (SELECT COALESCE(SUM(fee_cents),0) FROM donations WHERE recipient_id = ?1 AND status = 'succeeded' AND created_at > ?2) AS fees,
        (SELECT COUNT(*) FROM view_events WHERE owner_id = ?1 AND created_at > ?2) AS views,
        (SELECT COUNT(*) FROM follows WHERE followee_id = ?1 AND status = 'active' AND created_at > ?2) AS new_followers,
        (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id = r.target_id WHERE r.target_type = 'post' AND p.author_id = ?1 AND r.created_at > ?2) AS reactions,
        (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id = c.post_id WHERE p.author_id = ?1 AND c.author_id <> ?1 AND c.created_at > ?2) AS comments,
        (SELECT COUNT(*) FROM shares s JOIN posts p ON p.id = s.post_id WHERE p.author_id = ?1 AND s.created_at > ?2) AS shares,
        (SELECT COUNT(*) FROM saves s JOIN posts p ON p.id = s.post_id WHERE p.author_id = ?1 AND s.created_at > ?2) AS saves,
        (SELECT COALESCE(AVG(watch_ms),0) FROM view_events WHERE owner_id = ?1 AND target_type = 'reel' AND watch_ms > 0 AND created_at > ?2) AS avg_reel_watch_ms,
        (SELECT COALESCE(MAX(peak_viewers),0) FROM live_streams WHERE host_id = ?1 AND started_at > ?2) AS live_peak,
        (SELECT COUNT(*) FROM live_streams WHERE host_id = ?1 AND started_at > ?2) AS live_sessions,
        (SELECT COALESCE(AVG(watch_ms),0) FROM live_viewers lv JOIN live_streams l ON l.id = lv.stream_id WHERE l.host_id = ?1 AND lv.watch_ms > 0 AND l.started_at > ?2) AS avg_live_watch_ms`, user.id, since);
    const interactions = sums.reactions + sums.comments + sums.shares + sums.saves;
    const top = S.db.all(`SELECT p.id, p.type, p.caption, p.view_count, p.like_count, p.comment_count, p.share_count,
        (SELECT m.storage_key FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) k,
        (SELECT m.poster_key FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) pk
      FROM posts p WHERE p.author_id = ? AND p.status = 'active' ORDER BY (p.view_count + 5 * p.like_count + 10 * p.comment_count) DESC LIMIT 6`, user.id);
    const lives = S.db.all("SELECT id, title, started_at, ended_at, peak_viewers, unique_viewers FROM live_streams WHERE host_id = ? AND status = 'ended' ORDER BY started_at DESC LIMIT 5", user.id);
    return {
      days, balances: b, totals: { ...sums, net: sums.gift_net + sums.donation_net, gross: sums.gift_gross + sums.donation_gross, engagement_rate: sums.views ? interactions / sums.views : 0, interactions },
      followers: counts(S, user.id).followers,
      series: {
        views: daily(S, `SELECT ${DAY} d, COUNT(*) v FROM view_events WHERE owner_id = ? AND created_at > ? GROUP BY d`, [user.id], days),
        followers: daily(S, `SELECT ${DAY} d, COUNT(*) v FROM follows WHERE followee_id = ? AND status = 'active' AND created_at > ? GROUP BY d`, [user.id], days),
        gifts: daily(S, `SELECT ${DAY} d, SUM(creator_cents) v FROM gifts WHERE recipient_id = ? AND created_at > ? GROUP BY d`, [user.id], days),
        donations: daily(S, `SELECT ${DAY} d, SUM(creator_cents) v FROM donations WHERE recipient_id = ? AND status = 'succeeded' AND created_at > ? GROUP BY d`, [user.id], days),
      },
      top_content: top.map((p) => ({ id: p.id, type: p.type, caption: p.caption.slice(0, 80), views: p.view_count, likes: p.like_count, comments: p.comment_count, shares: p.share_count, thumb_url: S.mediaUrl(p.pk ?? p.k) })),
      recent_lives: lives,
      payouts: { provider: S.payouts.name, available: S.payouts.available, test_mode: S.payouts.testMode },
      settings: (({ withdrawal, earnings_hold_seconds, donation }) => ({ withdrawal, earnings_hold_seconds, donation_fee_bps: donation.fee_bps }))(settings(S)),
    };
  });

  r.get("/api/creator/earnings", ({ user, query }) => {
    const rows = S.db.all(`SELECT * FROM earnings WHERE creator_id = ? ${query.cursor ? "AND id < ?" : ""} ORDER BY id DESC LIMIT 31`, user.id, ...(query.cursor ? [String(query.cursor)] : []));
    const page = rows.slice(0, 30);
    return { items: page.map((e) => {
      const src = e.source_type === "gift" ? S.db.get("SELECT sender_id AS from_id, gift_name AS label, context_type FROM gifts WHERE id = ?", e.source_id) : S.db.get("SELECT donor_id AS from_id, message AS label, context_type FROM donations WHERE id = ?", e.source_id);
      const from = src ? S.db.get("SELECT username, display_name FROM users WHERE id = ?", src.from_id) : null;
      return { ...e, from, label: src?.label ?? "", context_type: src?.context_type };
    }), next_cursor: rows.length > 30 ? page.at(-1).id : null };
  });

  // ---------- Payout methods (sandbox accounts in development) ----------
  r.get("/api/creator/payout-methods", ({ user }) => ({
    items: S.db.all("SELECT id, provider, label, status, test_mode, created_at FROM payout_methods WHERE user_id = ? AND status <> 'disabled' ORDER BY created_at DESC", user.id).map((m) => ({ ...m, test_mode: !!m.test_mode })),
    provider: { name: S.payouts.name, available: S.payouts.available, test_mode: S.payouts.testMode },
  }));
  r.post("/api/creator/payout-methods", ({ user, body }) => {
    if (!user.is_creator) throw forbidden("not_creator", "Turn on creator tools first.");
    if (!S.payouts.available) throw new HttpError(503, "payouts_not_configured", "Payouts aren’t configured on this server.");
    const n = S.db.get("SELECT COUNT(*) n FROM payout_methods WHERE user_id = ? AND status <> 'disabled'", user.id).n;
    if (n >= 3) throw bad("too_many_methods", "You can have up to 3 payout methods.");
    const acct = S.payouts.createAccount({ userId: user.id, scenario: body.scenario === "fails" ? "fails" : "succeeds" });
    const mid = id("pm");
    S.db.run("INSERT INTO payout_methods (id, user_id, provider, provider_ref, label, status, test_mode, created_at) VALUES (?,?,?,?,?,?,?,?)", mid, user.id, S.payouts.name, acct.providerRef, acct.label, acct.status, S.payouts.testMode ? 1 : 0, S.now());
    return { method: S.db.get("SELECT id, provider, label, status, test_mode, created_at FROM payout_methods WHERE id = ?", mid) };
  });
  r.delete("/api/creator/payout-methods/:id", ({ user, params }) => {
    if (S.db.get("SELECT 1 FROM withdrawals WHERE payout_method_id = ? AND status IN ('pending','processing')", params.id)) throw new HttpError(409, "method_in_use", "A withdrawal is using this method.");
    S.db.run("UPDATE payout_methods SET status = 'disabled' WHERE id = ? AND user_id = ?", params.id, user.id);
    return { ok: true };
  });

  // ---------- Withdrawals ----------
  r.get("/api/creator/withdrawals", ({ user }) => ({ items: S.db.all("SELECT * FROM withdrawals WHERE creator_id = ? ORDER BY id DESC LIMIT 50", user.id).map((w) => withdrawalOut(S, w)) }));

  r.post("/api/creator/withdrawals", ({ user, body }) => {
    if (!user.is_creator) throw forbidden("not_creator", "Only creators can withdraw.");
    if (!S.payouts.available) throw new HttpError(503, "payouts_not_configured", "Payouts aren’t configured on this server.");
    if (!S.mail.available) throw new HttpError(503, "mail_not_configured", "Verification email isn’t configured on this server.");
    const key = String(body.idempotency_key ?? "");
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw bad("idempotency_key_required", "A unique idempotency_key is required.");
    const prior = S.db.get("SELECT * FROM withdrawals WHERE creator_id = ? AND idempotency_key = ?", user.id, key);
    if (prior) return { withdrawal: withdrawalOut(S, prior), duplicate: true };
    S.limiter.take("withdrawal", user.id);
    const cfg = settings(S).withdrawal;
    const amount = Number(body.amount_cents);
    if (!Number.isInteger(amount) || amount < cfg.min_cents || amount > cfg.max_cents) throw bad("amount_out_of_range", `Withdraw between $${(cfg.min_cents / 100).toFixed(2)} and $${(cfg.max_cents / 100).toFixed(2)}.`);
    const method = S.db.get("SELECT * FROM payout_methods WHERE id = ? AND user_id = ? AND status = 'verified'", String(body.payout_method_id ?? ""), user.id);
    if (!method) throw bad("invalid_payout_method", "Add a verified payout method first.");
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const wid = id("wd");
    const now = S.now();
    S.db.tx(() => {
      if (S.db.get("SELECT 1 FROM withdrawals WHERE creator_id = ? AND status IN ('pending','processing')", user.id)) throw new HttpError(409, "withdrawal_open", "You already have a withdrawal in progress.");
      const hold = S.db.run("UPDATE creator_balances SET available_cents = available_cents - ?, held_cents = held_cents + ?, updated_at = ? WHERE user_id = ? AND available_cents >= ?", amount, amount, now, user.id, amount);
      if (!hold.changes) throw new HttpError(402, "insufficient_balance", "That’s more than your available balance.");
      S.db.run(`INSERT INTO withdrawals (id, creator_id, amount_cents, currency, payout_method_id, status, code_hash, code_expires_at, idempotency_key, test_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        wid, user.id, amount, settings(S).currency, method.id, "pending", hashCode(wid, code), now + cfg.code_ttl_minutes * 60_000, key, method.test_mode, now, now);
      ledger(S, { userId: user.id, type: "withdrawal", amount: -amount, unit: "cents", balance: "available", status: "pending", relatedType: "withdrawal", relatedId: wid, test: method.test_mode, note: "Held for withdrawal" });
      ledger(S, { userId: user.id, type: "withdrawal", amount, unit: "cents", balance: "held", status: "pending", relatedType: "withdrawal", relatedId: wid, test: method.test_mode });
    });
    S.mail.send({ userId: user.id, subject: "Confirm your withdrawal", body: `Your TUNIBEAT withdrawal code is ${code}. It expires in ${cfg.code_ttl_minutes} minutes. If you didn't request a withdrawal of $${(amount / 100).toFixed(2)}, secure your account.` });
    S.rt.toUser(user.id, { t: "earnings", balances: balances(S, user.id) });
    return { withdrawal: withdrawalOut(S, S.db.get("SELECT * FROM withdrawals WHERE id = ?", wid)) };
  });

  r.post("/api/creator/withdrawals/:id/verify", ({ user, params, body }) => {
    S.limiter.take("withdrawal_code", user.id);
    const w = S.db.get("SELECT * FROM withdrawals WHERE id = ? AND creator_id = ?", params.id, user.id);
    if (!w) throw notFound("Withdrawal not found.");
    if (w.status !== "pending" || w.verified_at) throw new HttpError(409, "not_pending", "This withdrawal isn’t waiting for a code.");
    if (w.code_expires_at < S.now()) { settleWithdrawal(S, w.id, "cancelled", "Verification code expired"); throw new HttpError(410, "code_expired", "The code expired, so the withdrawal was cancelled. Start again."); }
    if (w.code_attempts >= 5) { settleWithdrawal(S, w.id, "cancelled", "Too many wrong codes"); throw forbidden("too_many_attempts", "Too many wrong codes. The withdrawal was cancelled."); }
    const code = String(body.code ?? "").trim();
    const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(hashCode(w.id, code)), Buffer.from(w.code_hash));
    if (!ok) {
      S.db.run("UPDATE withdrawals SET code_attempts = code_attempts + 1 WHERE id = ?", w.id);
      throw bad("wrong_code", `That code isn’t right. ${4 - w.code_attempts} attempt(s) left.`);
    }
    const review = w.amount_cents > settings(S).withdrawal.review_threshold_cents;
    S.db.run("UPDATE withdrawals SET verified_at = ?, code_hash = NULL, status = 'processing', updated_at = ? WHERE id = ?", S.now(), S.now(), w.id);
    const fresh = S.db.get("SELECT * FROM withdrawals WHERE id = ?", w.id);
    if (!review) dispatchPayout(S, fresh);
    return { withdrawal: withdrawalOut(S, S.db.get("SELECT * FROM withdrawals WHERE id = ?", w.id)) };
  });

  r.post("/api/creator/withdrawals/:id/cancel", ({ user, params }) => {
    const w = S.db.get("SELECT * FROM withdrawals WHERE id = ? AND creator_id = ?", params.id, user.id);
    if (!w) throw notFound("Withdrawal not found.");
    if (w.provider_ref) throw new HttpError(409, "already_sent", "This withdrawal was already sent to the payout provider.");
    const out = settleWithdrawal(S, w.id, "cancelled", "Cancelled by creator");
    if (!out) throw new HttpError(409, "not_cancellable", "This withdrawal can’t be cancelled.");
    return { withdrawal: withdrawalOut(S, out) };
  });

  // Development mail sink: shows verification codes when no email provider is configured
  r.get("/api/dev/outbox", ({ user }) => ({ items: S.db.all("SELECT id, subject, body, created_at FROM dev_outbox WHERE user_id = ? ORDER BY id DESC LIMIT 20", user.id) }), { dev: true });
}

export { withdrawalOut };
