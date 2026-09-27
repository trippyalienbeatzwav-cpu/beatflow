// Notifications: stored per recipient, grouped for display, and pushed in real time over the user channel.
// Delivery respects blocks, mutes and per-category preferences.
import { id } from "../lib/ids.js";
import { json } from "../lib/db.js";
import { bad } from "../lib/http.js";

export const CATEGORIES = {
  likes: { label: "Likes & reactions", types: ["like", "comment_like", "story_reaction"] },
  comments: { label: "Comments & replies", types: ["comment", "reply"] },
  follows: { label: "Followers", types: ["follow", "follow_request", "follow_accepted"] },
  mentions: { label: "Mentions & tags", types: ["mention", "tag"] },
  messages: { label: "Message requests", types: ["message_request"] },
  stories: { label: "Story replies", types: ["story_reply"] },
  reels: { label: "Reels activity", types: ["reel_milestone"] },
  live: { label: "Live videos", types: ["live_started", "live_scheduled"] },
  gifts: { label: "Gifts", types: ["gift_received"] },
  donations: { label: "Tips & donations", types: ["donation_received", "donation_refunded"] },
  earnings: { label: "Earnings & payouts", types: ["earnings_available", "withdrawal_update", "credits_added"] },
  store: { label: "Orders, sales & uploads", types: ["store_order_paid", "store_sale", "store_upload_ready", "store_upload_failed", "store_review"] },
  system: { label: "Account & safety", types: ["system", "report_update", "content_removed", "security"] },
};
const categoryOf = (type) => Object.keys(CATEGORIES).find((c) => CATEGORIES[c].types.includes(type)) ?? "system";
// Money and safety notices can't be silenced by mutes or blocks (the recipient must know about them)
const ALWAYS = new Set(["gifts", "donations", "earnings", "store", "system"]);
const GROUPABLE = new Set(["like", "comment_like", "story_reaction", "follow", "gift_received"]);

export function notify(S, { userId, type, actorId = null, targetType = null, targetId = null, data = {} }) {
  if (!userId || userId === actorId) return null;
  const cat = categoryOf(type);
  if (actorId && !ALWAYS.has(cat)) {
    const blocked = S.db.get(`SELECT 1 FROM blocks WHERE (blocker_id = ?1 AND blocked_id = ?2) OR (blocker_id = ?2 AND blocked_id = ?1)
      UNION ALL SELECT 1 FROM mutes WHERE muter_id = ?1 AND muted_id = ?2`, userId, actorId);
    if (blocked) return null;
  }
  const pref = S.db.get("SELECT in_app, push FROM notification_prefs WHERE user_id = ? AND type = ?", userId, cat) ?? { in_app: 1, push: 1 };
  if (!pref.in_app && !ALWAYS.has(cat)) return null;
  const nid = id("n");
  const groupKey = GROUPABLE.has(type) ? `${type}:${targetType ?? ""}:${targetId ?? ""}` : nid;
  const now = S.now();
  S.db.run("INSERT INTO notifications (id, user_id, type, actor_id, target_type, target_id, data, group_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    nid, userId, type, actorId, targetType, targetId, JSON.stringify(data), groupKey, now);
  const row = S.db.get("SELECT * FROM notifications WHERE id = ?", nid);
  const unread = S.db.get("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL", userId).n;
  S.rt?.toUser(userId, { t: "notification", item: serialize(S, [row])[0], unread, push: !!pref.push });
  return nid;
}

function serialize(S, rows) {
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
  const actors = actorIds.length ? Object.fromEntries(S.db.all(`SELECT u.id, u.username, u.display_name, u.is_verified, (SELECT storage_key FROM media WHERE id = u.avatar_media_id) k FROM users u WHERE u.id IN (${actorIds.map(() => "?").join(",")})`, ...actorIds)
    .map((u) => [u.id, { id: u.id, username: u.username, display_name: u.display_name, is_verified: !!u.is_verified, avatar_url: S.mediaUrl(u.k) }])) : {};
  return rows.map((r) => {
    let preview = null;
    if (r.target_type === "post") {
      const m = S.db.get("SELECT m.storage_key, m.poster_key, m.kind FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ? ORDER BY pm.position LIMIT 1", r.target_id);
      if (m) preview = S.mediaUrl(m.kind === "video" ? m.poster_key : m.storage_key);
    }
    return { id: r.id, type: r.type, category: categoryOf(r.type), actor: actors[r.actor_id] ?? null, target_type: r.target_type, target_id: r.target_id, data: json(r.data, {}), group_key: r.group_key, read: !!r.read_at, created_at: r.created_at, preview };
  });
}

export function register(r, S) {
  r.get("/api/notifications", ({ user, query }) => {
    const limit = 40;
    const filter = query.filter ?? "all";
    const cats = filter === "all" ? null : filter === "mentions" ? ["mentions", "comments"] : filter === "money" ? ["gifts", "donations", "earnings"] : filter === "follows" ? ["follows"] : null;
    const types = cats ? cats.flatMap((c) => CATEGORIES[c].types) : null;
    const rows = S.db.all(`SELECT * FROM notifications WHERE user_id = ? ${query.cursor ? "AND id < ?" : ""} ${types ? `AND type IN (${types.map(() => "?").join(",")})` : ""} ORDER BY id DESC LIMIT ?`,
      user.id, ...(query.cursor ? [String(query.cursor)] : []), ...(types ?? []), limit + 1);
    const page = rows.slice(0, limit);
    // Group rows that share a group key within this page ("Ana and 3 others liked your post")
    const items = serialize(S, page);
    const groups = [];
    const byKey = new Map();
    for (const it of items) {
      const g = byKey.get(it.group_key);
      if (g) { if (it.actor && !g.actors.some((a) => a.id === it.actor.id)) g.actors.push(it.actor); g.ids.push(it.id); g.read = g.read && it.read; continue; }
      const ng = { ...it, actors: it.actor ? [it.actor] : [], ids: [it.id] };
      byKey.set(it.group_key, ng); groups.push(ng);
    }
    return { items: groups, next_cursor: rows.length > limit ? page.at(-1).id : null, unread: S.db.get("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL", user.id).n };
  });

  r.post("/api/notifications/read", ({ user, body }) => {
    const now = S.now();
    if (body.all) S.db.run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now, user.id);
    else {
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
      if (!ids.length) throw bad("no_ids", "Pass ids or all: true.");
      S.db.run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`, now, user.id, ...ids);
    }
    const unread = S.db.get("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL", user.id).n;
    S.rt.toUser(user.id, { t: "notifications_read", unread });
    return { unread };
  });

  r.get("/api/me/notification-prefs", ({ user }) => {
    const rows = Object.fromEntries(S.db.all("SELECT * FROM notification_prefs WHERE user_id = ?", user.id).map((p) => [p.type, p]));
    return { items: Object.entries(CATEGORIES).map(([k, c]) => ({ category: k, label: c.label, in_app: rows[k] ? !!rows[k].in_app : true, push: rows[k] ? !!rows[k].push : true, locked: ALWAYS.has(k) })) };
  });
  r.patch("/api/me/notification-prefs", ({ user, body }) => {
    for (const [cat, v] of Object.entries(body)) {
      if (!CATEGORIES[cat]) throw bad("unknown_category", `Unknown category ${cat}.`);
      S.db.run(`INSERT INTO notification_prefs (user_id, type, in_app, push) VALUES (?,?,?,?)
        ON CONFLICT(user_id, type) DO UPDATE SET in_app = excluded.in_app, push = excluded.push`, user.id, cat, ALWAYS.has(cat) ? 1 : (v.in_app === false ? 0 : 1), v.push === false ? 0 : 1);
    }
    return { ok: true };
  });
}
