// User reports. A report records who reported what; staff act on it from the admin queue (admin.js).
import { id } from "../lib/ids.js";
import { bad, notFound } from "../lib/http.js";
import { canViewPost } from "./posts.js";

export const REASONS = ["spam", "harassment", "hate", "nudity", "violence", "self_harm", "scam", "ip", "impersonation", "minor_safety", "other"];

/** Resolve a report target to its owner, checking the reporter could actually see it. */
export function targetOwner(S, reporterId, type, tid) {
  switch (type) {
    case "post": case "reel": { const p = S.db.get("SELECT * FROM posts WHERE id = ?", tid); return p && canViewPost(S, reporterId, p) ? p.author_id : null; }
    case "comment": { const c = S.db.get("SELECT c.author_id, c.post_id FROM comments c WHERE c.id = ?", tid); return c && canViewPost(S, reporterId, S.db.get("SELECT * FROM posts WHERE id = ?", c.post_id)) ? c.author_id : null; }
    case "story": return S.db.get("SELECT author_id FROM stories WHERE id = ?", tid)?.author_id ?? null;
    case "live": return S.db.get("SELECT host_id FROM live_streams WHERE id = ?", tid)?.host_id ?? null;
    case "live_message": return S.db.get("SELECT user_id FROM live_messages WHERE id = ?", tid)?.user_id ?? null;
    case "message": return S.db.get(`SELECT m.sender_id FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ? WHERE m.id = ?`, reporterId, tid)?.sender_id ?? null;
    case "user": return S.db.get("SELECT id FROM users WHERE id = ?", tid)?.id ?? null;
    // Store items: the seller account behind them (only items that are on sale can be reported)
    case "beat": return S.db.get("SELECT p.user_id FROM beats b JOIN producers p ON p.id = b.producer_id WHERE b.id = ? AND b.status = 'published'", tid)?.user_id ?? null;
    case "pack": return S.db.get("SELECT p.user_id FROM packs k JOIN producers p ON p.id = k.producer_id WHERE k.id = ? AND k.status = 'published'", tid)?.user_id ?? null;
    case "track": return S.db.get("SELECT COALESCE(l.owner_id, r.owner_id) o FROM tracks t JOIN releases r ON r.id = t.release_id LEFT JOIN labels l ON l.id = r.label_id WHERE t.id = ? AND t.status = 'published'", tid)?.o ?? null;
    case "release": return S.db.get("SELECT COALESCE(l.owner_id, r.owner_id) o FROM releases r LEFT JOIN labels l ON l.id = r.label_id WHERE r.id = ? AND r.status = 'published'", tid)?.o ?? null;
    default: return null;
  }
}

export function register(r, S) {
  r.post("/api/reports", ({ user, body }) => {
    S.limiter.take("report", user.id);
    const type = String(body.target_type ?? "");
    const tid = String(body.target_id ?? "");
    if (!REASONS.includes(body.reason)) throw bad("invalid_reason", "Pick a reason.");
    const owner = targetOwner(S, user.id, type, tid);
    if (!owner) throw notFound("We couldn’t find what you’re reporting.");
    if (owner === user.id) throw bad("own_content", "You can’t report your own content.");
    const res = S.db.run(`INSERT OR IGNORE INTO reports (id, reporter_id, target_type, target_id, target_owner_id, reason, details, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      id("rp"), user.id, type, tid, owner, body.reason, String(body.details ?? "").slice(0, 1000), S.now());
    return { ok: true, already_reported: !res.changes };
  });
}
