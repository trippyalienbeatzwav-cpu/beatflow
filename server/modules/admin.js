// Staff tools. Moderators work the report queue; admins also manage money settings, the gift catalog,
// credit packs, withdrawal review and refunds. Every action is written to moderation_actions.
import { id } from "../lib/ids.js";
import { bad, notFound, HttpError } from "../lib/http.js";
import { json } from "../lib/db.js";
import { card, cardsById } from "./users.js";
import { notify } from "./notifications.js";
import { settings, DEFAULT_SETTINGS, refundDonation, ledger } from "./wallet.js";
import { settleWithdrawal, dispatchPayout, withdrawalOut } from "./creator.js";
import { endStream } from "./live.js";
import { revokeSessions } from "./auth.js";
import { mediaOut } from "./media.js";

const logAction = (S, mod, action, type, tid, reason) =>
  S.db.run("INSERT INTO moderation_actions (id, moderator_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)", id("ma"), mod.id, action, type, tid, reason ?? null, S.now());

function preview(S, type, tid) {
  switch (type) {
    case "post": case "reel": {
      const p = S.db.get("SELECT * FROM posts WHERE id = ?", tid);
      const m = p && S.db.get("SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ? ORDER BY pm.position LIMIT 1", p.id);
      return p && { text: p.caption, status: p.status, media: mediaOut(S, m), link: `#/social/p/${p.id}` };
    }
    case "comment": { const c = S.db.get("SELECT * FROM comments WHERE id = ?", tid); return c && { text: c.body, status: c.status, link: `#/social/p/${c.post_id}` }; }
    case "story": { const s = S.db.get("SELECT * FROM stories WHERE id = ?", tid); return s && { text: json(s.content, {}).text, status: s.status, media: mediaOut(S, s.media_id && S.db.get("SELECT * FROM media WHERE id = ?", s.media_id)) }; }
    case "live": { const l = S.db.get("SELECT * FROM live_streams WHERE id = ?", tid); return l && { text: l.title, status: l.status, link: `#/social/live/${l.id}` }; }
    case "live_message": { const m = S.db.get("SELECT * FROM live_messages WHERE id = ?", tid); return m && { text: m.body, status: m.status, link: `#/social/live/${m.stream_id}` }; }
    case "message": { const m = S.db.get("SELECT * FROM messages WHERE id = ?", tid); return m && { text: m.deleted_at ? "(unsent)" : m.body, status: m.deleted_at ? "deleted" : "visible" }; }
    case "user": { const u = S.db.get("SELECT * FROM users WHERE id = ?", tid); return u && { text: `${u.display_name} (@${u.username}) — ${u.bio}`, status: u.status, link: `#/social/u/${u.username}` }; }
    default: return null;
  }
}

function removeContent(S, type, tid) {
  switch (type) {
    case "post": case "reel": S.db.run("UPDATE posts SET status = 'removed' WHERE id = ?", tid); break;
    case "comment": {
      const c = S.db.get("SELECT * FROM comments WHERE id = ?", tid);
      if (c && c.status === "visible") {
        S.db.run("UPDATE posts SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?", c.post_id);
        if (c.parent_id) S.db.run("UPDATE comments SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?", c.parent_id);
      }
      S.db.run("UPDATE comments SET status = 'removed' WHERE id = ?", tid); break;
    }
    case "story": S.db.run("UPDATE stories SET status = 'removed' WHERE id = ?", tid); break;
    // Store items leave sale (and every cart); buyers keep their licenses and downloads
    case "beat": S.db.run("UPDATE beats SET status = 'removed' WHERE id = ?", tid); S.db.run("DELETE FROM cart_items WHERE kind = 'beat' AND item_id = ?", tid); S.storeCache = null; break;
    case "pack": S.db.run("UPDATE packs SET status = 'removed' WHERE id = ?", tid); S.db.run("DELETE FROM cart_items WHERE kind = 'pack' AND item_id = ?", tid); S.storeCache = null; break;
    case "track": S.db.run("UPDATE tracks SET status = 'removed' WHERE id = ?", tid); S.db.run("DELETE FROM cart_items WHERE kind = 'track' AND item_id = ?", tid); S.storeCache = null; break;
    case "release": S.db.run("UPDATE releases SET status = 'removed' WHERE id = ?", tid); S.db.run("UPDATE tracks SET status = 'removed' WHERE release_id = ?", tid); S.db.run("DELETE FROM cart_items WHERE (kind = 'release' AND item_id = ?1) OR (kind = 'track' AND item_id IN (SELECT id FROM tracks WHERE release_id = ?1))", tid); S.storeCache = null; break;
    case "live": endStream(S, tid, "moderator_ended"); break;
    case "live_message": {
      const m = S.db.get("SELECT * FROM live_messages WHERE id = ?", tid);
      S.db.run("UPDATE live_messages SET status = 'deleted' WHERE id = ?", tid);
      if (m) S.rt.publish(`live:${m.stream_id}`, { t: "live:chat_deleted", stream: m.stream_id, message_id: m.id });
      break;
    }
    case "message": S.db.run("UPDATE messages SET deleted_at = ?, body = '', media_id = NULL WHERE id = ?", S.now(), tid); break;
    default: throw bad("not_removable", "Use a user action for accounts.");
  }
}

function setUserStatus(S, mod, uid, status, reason) {
  const u = S.db.get("SELECT * FROM users WHERE id = ?", uid);
  if (!u) throw notFound("User not found.");
  if (u.role === "admin" && status !== "active") throw bad("protected", "Admins can’t be suspended here.");
  S.db.run("UPDATE users SET status = ? WHERE id = ?", status, uid);
  if (status !== "active") {
    revokeSessions(S, uid);
    const live = S.db.get("SELECT id FROM live_streams WHERE host_id = ? AND status = 'live'", uid);
    if (live) endStream(S, live.id, "moderator_ended");
  }
  logAction(S, mod, `user_${status}`, "user", uid, reason);
}

export function register(r, S) {
  const MOD = { role: "moderator" }, ADMIN = { role: "admin" };

  r.get("/api/admin/stats", () => S.db.get(`SELECT
      (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE status <> 'active') AS sanctioned,
      (SELECT COUNT(*) FROM posts WHERE status = 'active') AS posts, (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports,
      (SELECT COUNT(*) FROM live_streams WHERE status = 'live') AS live_now,
      (SELECT COUNT(*) FROM withdrawals WHERE status = 'processing' AND provider_ref IS NULL) AS withdrawals_to_review,
      (SELECT COALESCE(SUM(credit_cost),0) FROM gifts WHERE created_at > ?1) AS gift_credits_24h,
      (SELECT COALESCE(SUM(amount_cents),0) FROM donations WHERE status = 'succeeded' AND created_at > ?1) AS donation_cents_24h,
      (SELECT COALESCE(SUM(amount_cents),0) FROM credit_purchases WHERE status = 'succeeded' AND created_at > ?1) AS credit_sales_cents_24h`, S.now() - 864e5), MOD);

  r.get("/api/admin/reports", ({ query }) => {
    const status = ["open", "actioned", "dismissed"].includes(query.status) ? query.status : "open";
    const rows = S.db.all(`SELECT target_type, target_id, target_owner_id, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at,
        GROUP_CONCAT(DISTINCT reason) AS reasons, MIN(id) AS id FROM reports WHERE status = ? GROUP BY target_type, target_id ORDER BY n DESC, first_at ASC LIMIT 100`, status);
    const owners = cardsById(S, rows.map((x) => x.target_owner_id));
    return { items: rows.map((x) => ({ ...x, reasons: x.reasons.split(","), owner: owners[x.target_owner_id], preview: preview(S, x.target_type, x.target_id),
      details: S.db.all("SELECT reporter_id, reason, details, created_at FROM reports WHERE target_type = ? AND target_id = ? AND status = ? ORDER BY id LIMIT 10", x.target_type, x.target_id, status)
        .map((d) => ({ ...d, reporter: card(S, d.reporter_id) })) })) };
  }, MOD);

  r.post("/api/admin/reports/:id/resolve", ({ user, params, body }) => {
    const rep = S.db.get("SELECT * FROM reports WHERE id = ?", params.id);
    if (!rep) throw notFound("Report not found.");
    const action = String(body.action ?? "");
    const note = String(body.note ?? "").slice(0, 500);
    S.db.tx(() => {
      if (action === "remove_content") removeContent(S, rep.target_type, rep.target_id);
      else if (action === "suspend_user" || action === "ban_user") setUserStatus(S, user, rep.target_owner_id, action === "ban_user" ? "banned" : "suspended", note || rep.reason);
      else if (action !== "dismiss" && action !== "warn") throw bad("invalid_action", "Unknown action.");
      S.db.run("UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE target_type = ? AND target_id = ? AND status = 'open'",
        action === "dismiss" ? "dismissed" : "actioned", action + (note ? `: ${note}` : ""), user.id, S.now(), rep.target_type, rep.target_id);
      logAction(S, user, action, rep.target_type, rep.target_id, note || rep.reason);
    });
    if (action !== "dismiss" && rep.target_owner_id) notify(S, { userId: rep.target_owner_id, type: action === "warn" ? "system" : "content_removed", targetType: rep.target_type, targetId: rep.target_id, data: { reason: rep.reason, action, text: action === "warn" ? "A moderator reviewed a report about your content. Please follow the community guidelines." : undefined } });
    for (const x of S.db.all("SELECT DISTINCT reporter_id FROM reports WHERE target_type = ? AND target_id = ?", rep.target_type, rep.target_id))
      notify(S, { userId: x.reporter_id, type: "report_update", targetType: rep.target_type, targetId: rep.target_id, data: { outcome: action === "dismiss" ? "no_violation" : "action_taken" } });
    return { ok: true };
  }, MOD);

  r.post("/api/admin/users/:id/status", ({ user, params, body }) => {
    if (!["active", "suspended", "banned"].includes(body.status)) throw bad("invalid_status", "Unknown status.");
    setUserStatus(S, user, params.id, body.status, String(body.reason ?? ""));
    return { ok: true };
  }, MOD);

  // ---------- Gift catalog ----------
  const GIFT_FIELDS = ["name", "icon", "animation", "credit_cost", "creator_share_bps", "availability", "status", "sort"];
  const validGift = (g) => {
    if (!g.name || String(g.name).length > 40) throw bad("invalid_name", "Gift names are 1–40 characters.");
    if (!/^[a-z0-9-]{2,24}$/.test(g.icon)) throw bad("invalid_icon", "Icon must be an icon key (a-z, 0-9, -).");
    if (!["float", "burst", "rain", "spin", "pulse"].includes(g.animation)) throw bad("invalid_animation", "Unknown animation.");
    if (!Number.isInteger(g.credit_cost) || g.credit_cost < 1 || g.credit_cost > 100_000) throw bad("invalid_cost", "Cost is 1–100,000 credits.");
    if (!Number.isInteger(g.creator_share_bps) || g.creator_share_bps < 0 || g.creator_share_bps > 10_000) throw bad("invalid_share", "Creator share is 0–100%.");
    if (!["everywhere", "live_only", "profile_only"].includes(g.availability)) throw bad("invalid_availability", "Unknown availability.");
    if (!["active", "disabled", "archived"].includes(g.status)) throw bad("invalid_status", "Unknown status.");
  };
  r.get("/api/admin/gifts", () => ({ items: S.db.all("SELECT * FROM gift_catalog ORDER BY sort, credit_cost") }), ADMIN);
  r.post("/api/admin/gifts", ({ user, body }) => {
    const g = { name: String(body.name ?? "").trim(), icon: String(body.icon ?? ""), animation: body.animation ?? "float", credit_cost: Number(body.credit_cost), creator_share_bps: Number(body.creator_share_bps ?? 7000), availability: body.availability ?? "everywhere", status: body.status ?? "active", sort: Number(body.sort ?? 100) };
    validGift(g);
    const gid = id("gift");
    S.db.run("INSERT INTO gift_catalog (id, name, icon, animation, credit_cost, creator_share_bps, platform_fee_bps, availability, status, sort, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      gid, g.name, g.icon, g.animation, g.credit_cost, g.creator_share_bps, 10_000 - g.creator_share_bps, g.availability, g.status, g.sort, S.now());
    logAction(S, user, "gift_create", "gift", gid);
    return { gift: S.db.get("SELECT * FROM gift_catalog WHERE id = ?", gid) };
  }, ADMIN);
  r.patch("/api/admin/gifts/:id", ({ user, params, body }) => {
    const cur = S.db.get("SELECT * FROM gift_catalog WHERE id = ?", params.id);
    if (!cur) throw notFound("Gift not found.");
    const g = { ...cur };
    for (const f of GIFT_FIELDS) if (body[f] !== undefined) g[f] = ["credit_cost", "creator_share_bps", "sort"].includes(f) ? Number(body[f]) : body[f];
    validGift(g);
    // Price changes apply to future gifts only; past gifts keep the price they were bought at
    S.db.run("UPDATE gift_catalog SET name = ?, icon = ?, animation = ?, credit_cost = ?, creator_share_bps = ?, platform_fee_bps = ?, availability = ?, status = ?, sort = ?, updated_at = ? WHERE id = ?",
      g.name, g.icon, g.animation, g.credit_cost, g.creator_share_bps, 10_000 - g.creator_share_bps, g.availability, g.status, g.sort, S.now(), g.id);
    logAction(S, user, "gift_update", "gift", g.id, JSON.stringify(body).slice(0, 300));
    return { gift: S.db.get("SELECT * FROM gift_catalog WHERE id = ?", g.id) };
  }, ADMIN);

  r.get("/api/admin/credit-packages", () => ({ items: S.db.all("SELECT * FROM credit_packages ORDER BY sort") }), ADMIN);
  r.patch("/api/admin/credit-packages/:id", ({ user, params, body }) => {
    const p = S.db.get("SELECT * FROM credit_packages WHERE id = ?", params.id);
    if (!p) throw notFound();
    const credits = body.credits !== undefined ? Number(body.credits) : p.credits;
    const amount = body.amount_cents !== undefined ? Number(body.amount_cents) : p.amount_cents;
    const status = body.status ?? p.status;
    if (!Number.isInteger(credits) || credits < 1 || !Number.isInteger(amount) || amount < 50 || !["active", "disabled"].includes(status)) throw bad("invalid_package", "Invalid package values.");
    S.db.run("UPDATE credit_packages SET credits = ?, amount_cents = ?, status = ? WHERE id = ?", credits, amount, status, p.id);
    logAction(S, user, "package_update", "credit_package", p.id);
    return { package: S.db.get("SELECT * FROM credit_packages WHERE id = ?", p.id) };
  }, ADMIN);

  // ---------- Monetization settings ----------
  r.get("/api/admin/settings/monetization", () => ({ settings: settings(S), defaults: DEFAULT_SETTINGS }), ADMIN);
  r.patch("/api/admin/settings/monetization", ({ user, body }) => {
    const cur = settings(S);
    const next = { ...cur, ...pick(body, ["currency", "credit_value_cents", "earnings_hold_seconds", "refund_window_hours"]),
      donation: { ...cur.donation, ...(body.donation ?? {}) }, gifts: { ...cur.gifts, ...(body.gifts ?? {}) }, withdrawal: { ...cur.withdrawal, ...(body.withdrawal ?? {}) } };
    const int = (v, lo, hi, name) => { if (!Number.isInteger(v) || v < lo || v > hi) throw bad("invalid_" + name, `${name} must be between ${lo} and ${hi}.`); };
    if (!/^[A-Z]{3}$/.test(next.currency)) throw bad("invalid_currency", "Currency is a 3-letter ISO code.");
    int(next.credit_value_cents, 1, 100, "credit_value_cents");
    int(next.earnings_hold_seconds, 0, 90 * 86400, "earnings_hold_seconds");
    int(next.refund_window_hours, 0, 24 * 180, "refund_window_hours");
    int(next.donation.min_cents, 50, 100_000, "donation.min_cents");
    int(next.donation.max_cents, next.donation.min_cents, 10_000_000, "donation.max_cents");
    int(next.donation.fee_bps, 0, 5_000, "donation.fee_bps");
    int(next.gifts.min_account_age_minutes, 0, 60 * 24 * 30, "gifts.min_account_age_minutes");
    int(next.gifts.max_credits_per_minute, 1, 10_000_000, "gifts.max_credits_per_minute");
    int(next.gifts.daily_credit_limit, 1, 100_000_000, "gifts.daily_credit_limit");
    int(next.withdrawal.min_cents, 100, 1_000_000, "withdrawal.min_cents");
    int(next.withdrawal.max_cents, next.withdrawal.min_cents, 100_000_000, "withdrawal.max_cents");
    int(next.withdrawal.review_threshold_cents, 0, 100_000_000, "withdrawal.review_threshold_cents");
    S.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('monetization', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      JSON.stringify(next), user.id, S.now());
    logAction(S, user, "settings_update", "settings", "monetization", JSON.stringify(body).slice(0, 300));
    return { settings: settings(S) };
  }, ADMIN);

  // ---------- Withdrawals review ----------
  r.get("/api/admin/withdrawals", ({ query }) => {
    const rows = query.status === "all"
      ? S.db.all("SELECT * FROM withdrawals ORDER BY id DESC LIMIT 100")
      : S.db.all("SELECT * FROM withdrawals WHERE status = 'processing' AND provider_ref IS NULL ORDER BY id ASC LIMIT 100");
    return { items: rows.map((w) => ({ ...withdrawalOut(S, w), creator: card(S, w.creator_id) })) };
  }, ADMIN);
  r.post("/api/admin/withdrawals/:id/:decision", ({ user, params, body }) => {
    const w = S.db.get("SELECT * FROM withdrawals WHERE id = ?", params.id);
    if (!w) throw notFound("Withdrawal not found.");
    if (w.status !== "processing" || w.provider_ref) throw new HttpError(409, "not_reviewable", "This withdrawal isn’t waiting for review.");
    if (params.decision === "approve") { S.db.run("UPDATE withdrawals SET reviewed_by = ? WHERE id = ?", user.id, w.id); dispatchPayout(S, w); }
    else if (params.decision === "reject") settleWithdrawal(S, w.id, "rejected", String(body.reason ?? "Rejected by review").slice(0, 200), user.id);
    else throw notFound();
    logAction(S, user, `withdrawal_${params.decision}`, "withdrawal", w.id, body.reason);
    return { withdrawal: withdrawalOut(S, S.db.get("SELECT * FROM withdrawals WHERE id = ?", w.id)) };
  }, ADMIN);

  // ---------- Refunds ----------
  r.get("/api/admin/donations", () => ({
    items: S.db.all("SELECT * FROM donations ORDER BY id DESC LIMIT 100").map((d) => ({ ...d, donor: card(S, d.donor_id), recipient: card(S, d.recipient_id) })),
  }), ADMIN);
  r.post("/api/admin/donations/:id/refund", ({ user, params, body }) => refundDonation(S, user, params.id, String(body.reason ?? "").slice(0, 200)), ADMIN);
  r.post("/api/admin/purchases/:id/refund", ({ user, params, body }) => {
    const cp = S.db.get("SELECT * FROM credit_purchases WHERE id = ?", params.id);
    if (!cp || cp.status !== "succeeded") throw new HttpError(409, "not_refundable", "Only completed purchases can be refunded.");
    S.db.tx(() => {
      // Only unspent credits can be refunded (prevents "spend then refund" abuse)
      const r2 = S.db.run("UPDATE wallets SET credits = credits - ?, updated_at = ? WHERE user_id = ? AND credits >= ?", cp.credits, S.now(), cp.user_id, cp.credits);
      if (!r2.changes) throw new HttpError(409, "credits_spent", "These credits were already spent, so they can’t be refunded.");
      S.db.run("UPDATE credit_purchases SET status = 'refunded' WHERE id = ?", cp.id);
      S.db.run("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", S.now(), cp.payment_id);
      ledger(S, { userId: cp.user_id, type: "refund", amount: -cp.credits, unit: "credits", balance: "wallet", relatedType: "credit_purchase", relatedId: cp.id, note: String(body.reason ?? "") });
      logAction(S, user, "refund_purchase", "credit_purchase", cp.id, body.reason);
    });
    return { ok: true };
  }, ADMIN);

  /** Ledger reconciliation: every balance must equal the sum of its ledger rows. */
  r.get("/api/admin/ledger/reconcile", () => reconcile(S), ADMIN);
}

export function reconcile(S) {
  const mismatches = [];
  const sums = new Map(S.db.all("SELECT user_id, balance, SUM(amount) s FROM transactions WHERE balance IN ('wallet','pending','available','held') GROUP BY user_id, balance").map((x) => [`${x.user_id}:${x.balance}`, x.s]));
  for (const w of S.db.all("SELECT user_id, credits FROM wallets")) if ((sums.get(`${w.user_id}:wallet`) ?? 0) !== w.credits) mismatches.push({ user_id: w.user_id, bucket: "wallet", balance: w.credits, ledger: sums.get(`${w.user_id}:wallet`) ?? 0 });
  for (const b of S.db.all("SELECT * FROM creator_balances")) {
    for (const [bucket, col] of [["pending", "pending_cents"], ["available", "available_cents"], ["held", "held_cents"]]) {
      if ((sums.get(`${b.user_id}:${bucket}`) ?? 0) !== b[col]) mismatches.push({ user_id: b.user_id, bucket, balance: b[col], ledger: sums.get(`${b.user_id}:${bucket}`) ?? 0 });
    }
  }
  return { ok: !mismatches.length, mismatches, checked_at: S.now() };
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
