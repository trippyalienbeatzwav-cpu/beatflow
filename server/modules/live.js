// Live streaming. Media: WebRTC ("webrtc-mesh"). The host's browser keeps one peer connection per viewer,
// and this server only relays connection-setup (SDP/ICE) messages over WebSockets. It never touches
// the audio or video. The server is authoritative for stream state, audience, viewer counts, chat,
// moderation, and the gift and donation events that wallet.js publishes into the room.
// Scaling beyond the mesh cap needs an SFU (LiveKit or mediasoup) or a managed service behind the same
// signalling contract; see docs/SOCIAL.md.
import { id } from "../lib/ids.js";
import { bad, forbidden, notFound, HttpError } from "../lib/http.js";
import { json } from "../lib/db.js";
import { cardsById, getUser, isBlockedEither, isFollowing, privacyOf, card } from "./users.js";
import { mediaOut, ownedMedia } from "./media.js";
import { notify } from "./notifications.js";
import { recordMentions, REACTIONS } from "./posts.js";

export const LIVE_CATEGORIES = ["Music performance", "Production session", "DJ set", "Q&A", "Studio tour", "Just chatting", "Tutorial"];

const hostConns = new Map();       // streamId → Set<connId> of the host's sockets publishing media
const graceTimers = new Map();     // streamId → timeout while the host is reconnecting
const health = new Map();          // streamId → last reported stats
const reactionCounts = new Map();  // streamId → number
const lastChat = new Map();        // `${stream}:${user}` → ms (slow mode)

export function canWatch(S, viewerId, st) {
  if (!st) return false;
  const host = getUser(S, st.host_id);
  if (!host || host.status !== "active") return false;
  if (viewerId === host.id) return true;
  if (isBlockedEither(S, viewerId, host.id)) return false;
  if (sanction(S, st.host_id, viewerId, "ban")) return false;
  if (host.is_private || st.audience === "followers") return isFollowing(S, viewerId, host.id);
  return true;
}
function sanction(S, hostId, userId, kind) {
  const s = S.db.get("SELECT * FROM live_sanctions WHERE host_id = ? AND user_id = ? AND kind = ?", hostId, userId, kind);
  if (!s) return null;
  if (s.until && s.until < S.now()) { S.db.run("DELETE FROM live_sanctions WHERE host_id = ? AND user_id = ? AND kind = ?", hostId, userId, kind); return null; }
  return s;
}
const isMod = (S, hostId, userId) => hostId === userId || !!S.db.get("SELECT 1 FROM live_moderators WHERE host_id = ? AND moderator_id = ?", hostId, userId) || ["admin", "moderator"].includes(getUser(S, userId)?.role);

/** Distinct signed-in viewers currently connected to the room (the host is not counted). */
export function viewerCount(S, st) {
  return new Set(S.rt.members(`live:${st.id}`).filter((c) => c.userId !== st.host_id).map((c) => c.userId)).size;
}

export function liveCards(S, viewerId, { followingOnly = false, limit = 10, match = null, includeScheduled = false, hostId = null } = {}) {
  const rows = S.db.all(`SELECT l.* FROM live_streams l JOIN users h ON h.id = l.host_id
    WHERE (l.status = 'live' ${includeScheduled ? "OR (l.status = 'scheduled' AND l.scheduled_at > :soon)" : ""}) AND h.status = 'active'
      ${hostId ? "AND l.host_id = :host" : ""}
      ${followingOnly ? "AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = l.host_id AND f.status = 'active')" : ""}
      ${match ? "AND (l.title LIKE :match ESCAPE '\\' OR l.category LIKE :match ESCAPE '\\' OR h.username LIKE :match ESCAPE '\\' OR h.display_name LIKE :match ESCAPE '\\')" : ""}
    ORDER BY l.status = 'live' DESC, l.started_at DESC, l.scheduled_at ASC LIMIT 100`, { viewer: viewerId, soon: S.now() - 3600_000, match, host: hostId });
  const visible = rows.filter((l) => canWatch(S, viewerId, l)).slice(0, limit);
  const hosts = cardsById(S, visible.map((l) => l.host_id));
  const thumbs = Object.fromEntries(visible.filter((l) => l.thumbnail_media_id).map((l) => [l.id, S.db.get("SELECT storage_key FROM media WHERE id = ?", l.thumbnail_media_id)?.storage_key]));
  return visible.map((l) => ({
    id: l.id, title: l.title, category: l.category, status: l.status, host: hosts[l.host_id], thumbnail_url: S.mediaUrl(thumbs[l.id]),
    viewers: l.status === "live" ? viewerCount(S, l) : 0, started_at: l.started_at, scheduled_at: l.scheduled_at, audience: l.audience,
    reconnecting: graceTimers.has(l.id),
  }));
}

function msgOut(S, rows) {
  const cards = cardsById(S, rows.map((m) => m.user_id));
  return rows.map((m) => ({ id: m.id, stream_id: m.stream_id, user: cards[m.user_id], kind: m.kind, body: m.status === "deleted" ? "" : m.body, data: json(m.data, {}), deleted: m.status === "deleted", created_at: m.created_at }));
}

function loadStream(S, sid) {
  const st = S.db.get("SELECT * FROM live_streams WHERE id = ?", sid);
  if (!st) throw notFound("This live video doesn’t exist.");
  return st;
}

function streamOut(S, st, viewerId) {
  const mod = isMod(S, st.host_id, viewerId);
  const mute = sanction(S, st.host_id, viewerId, "mute");
  const pinned = st.pinned_message_id ? S.db.get("SELECT * FROM live_messages WHERE id = ? AND status = 'visible'", st.pinned_message_id) : null;
  const thumb = st.thumbnail_media_id ? S.db.get("SELECT * FROM media WHERE id = ?", st.thumbnail_media_id) : null;
  const totals = S.db.get(`SELECT (SELECT COUNT(*) FROM gifts WHERE context_type = 'live' AND context_id = ?1) AS gifts,
      (SELECT COALESCE(SUM(credit_cost),0) FROM gifts WHERE context_type = 'live' AND context_id = ?1) AS gift_credits,
      (SELECT COUNT(*) FROM donations WHERE context_type = 'live' AND context_id = ?1 AND status = 'succeeded') AS donations`, st.id);
  const hostCard = card(S, st.host_id);
  const pv = privacyOf(S, st.host_id);
  return {
    id: st.id, title: st.title, description: st.description, category: st.category, audience: st.audience, status: st.status, transport: st.transport,
    host: hostCard, thumbnail: mediaOut(S, thumb), scheduled_at: st.scheduled_at, started_at: st.started_at, ended_at: st.ended_at,
    slow_mode_seconds: st.slow_mode_seconds, pinned: pinned ? msgOut(S, [pinned])[0] : null,
    viewers: st.status === "live" ? viewerCount(S, st) : 0, peak_viewers: st.peak_viewers, unique_viewers: st.unique_viewers,
    reconnecting: graceTimers.has(st.id), totals,
    viewer: {
      is_host: st.host_id === viewerId, is_moderator: mod, muted_until: mute ? (mute.until ?? -1) : null,
      following: isFollowing(S, viewerId, st.host_id), can_tip: st.host_id !== viewerId && !!hostCard?.is_creator && !!pv.allow_tips && S.payments.available,
      can_gift: st.host_id !== viewerId && !!hostCard?.is_creator,
    },
    rtc: { ice_servers: S.cfg.live.iceServers, max_viewers: S.cfg.live.meshMaxViewers },
  };
}

function setState(S, st, status, extra = {}) {
  S.rt.publish(`live:${st.id}`, { t: "live:state", stream: st.id, status, ...extra });
}

export function endStream(S, sid, reason = "host_ended") {
  const st = S.db.get("SELECT * FROM live_streams WHERE id = ?", sid);
  if (!st || st.status !== "live") return;
  clearTimeout(graceTimers.get(sid)); graceTimers.delete(sid);
  const now = S.now();
  S.db.tx(() => {
    S.db.run("UPDATE live_streams SET status = 'ended', ended_at = ? WHERE id = ?", now, sid);
    S.db.run("UPDATE live_viewers SET left_at = ?, watch_ms = ? - joined_at WHERE stream_id = ? AND left_at IS NULL", now, now, sid);
    S.db.run("INSERT INTO live_messages (id, stream_id, user_id, kind, body, created_at) VALUES (?,?,?,?,?,?)", id("lm"), sid, st.host_id, "system", reason === "host_disconnected" ? "The live ended after the host lost connection." : "The live has ended.", now);
  });
  setState(S, st, "ended", { reason });
  hostConns.delete(sid); health.delete(sid); reactionCounts.delete(sid);
}

export function register(r, S) {
  r.get("/api/live", ({ user, query }) => {
    if (query.status === "ended") {
      const host = query.host ? String(query.host) : user.id;
      const rows = S.db.all("SELECT * FROM live_streams WHERE host_id = ? AND status = 'ended' ORDER BY started_at DESC LIMIT 30", host);
      if (host !== user.id && !rows.every((st) => canWatch(S, user.id, st))) throw forbidden();
      return { items: rows.map((st) => ({ id: st.id, title: st.title, category: st.category, started_at: st.started_at, ended_at: st.ended_at, peak_viewers: st.peak_viewers, unique_viewers: st.unique_viewers })) };
    }
    return { items: liveCards(S, user.id, { limit: 40, includeScheduled: query.status !== "live", followingOnly: query.following === "1", hostId: query.host ? String(query.host) : null }), categories: LIVE_CATEGORIES };
  });

  r.post("/api/live", ({ user, body }) => {
    const title = String(body.title ?? "").trim();
    if (!title || title.length > 100) throw bad("invalid_title", "Give your live a title (up to 100 characters).");
    const category = LIVE_CATEGORIES.includes(body.category) ? body.category : LIVE_CATEGORIES[0];
    const audience = ["public", "followers"].includes(body.audience) ? body.audience : privacyOf(S, user.id).live_audience;
    const thumb = body.thumbnail_media_id ? ownedMedia(S, user.id, [body.thumbnail_media_id], ["image"])[0] : null;
    let scheduledAt = null;
    if (body.scheduled_at != null) {
      scheduledAt = Number(body.scheduled_at);
      if (!Number.isFinite(scheduledAt) || scheduledAt < S.now() + 60_000 || scheduledAt > S.now() + 30 * 864e5) throw bad("invalid_schedule", "Schedule between 1 minute and 30 days from now.");
    }
    const open = S.db.get("SELECT COUNT(*) n FROM live_streams WHERE host_id = ? AND status = 'scheduled'", user.id).n;
    if (open >= 10) throw bad("too_many_scheduled", "You can have up to 10 scheduled lives.");
    const sid = id("lv");
    S.db.run(`INSERT INTO live_streams (id, host_id, title, description, category, thumbnail_media_id, audience, status, transport, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      sid, user.id, title, String(body.description ?? "").slice(0, 500), category, thumb?.id ?? null, audience, "scheduled", S.cfg.live.transport, scheduledAt, S.now());
    if (scheduledAt) {
      const followers = S.db.all("SELECT follower_id FROM follows WHERE followee_id = ? AND status = 'active' LIMIT 5000", user.id);
      followers.forEach((f) => notify(S, { userId: f.follower_id, type: "live_scheduled", actorId: user.id, targetType: "live", targetId: sid, data: { title, scheduled_at: scheduledAt } }));
    }
    recordMentions(S, { sourceType: "live", sourceId: sid, authorId: user.id, text: `${title} ${body.description ?? ""}`, targetType: "live", targetId: sid });
    return { stream: streamOut(S, loadStream(S, sid), user.id) };
  });

  r.get("/api/live/:id", ({ params, user }) => {
    const st = loadStream(S, params.id);
    if (!canWatch(S, user.id, st)) throw notFound("This live video isn’t available.");
    const recent = S.db.all("SELECT * FROM (SELECT * FROM live_messages WHERE stream_id = ? AND status = 'visible' ORDER BY id DESC LIMIT 60) ORDER BY id ASC", st.id);
    return { stream: streamOut(S, st, user.id), messages: msgOut(S, recent) };
  });

  r.post("/api/live/:id/start", ({ params, user }) => {
    const st = loadStream(S, params.id);
    if (st.host_id !== user.id) throw forbidden("not_host", "Only the host can start this live.");
    if (st.status !== "scheduled") throw new HttpError(409, "invalid_state", `This live is ${st.status}.`);
    if (S.db.get("SELECT 1 FROM live_streams WHERE host_id = ? AND status = 'live'", user.id)) throw new HttpError(409, "already_live", "You’re already live in another session. End it first.");
    const now = S.now();
    S.db.run("UPDATE live_streams SET status = 'live', started_at = ? WHERE id = ? AND status = 'scheduled'", now, st.id);
    S.db.run("INSERT INTO live_messages (id, stream_id, user_id, kind, body, created_at) VALUES (?,?,?,?,?,?)", id("lm"), st.id, user.id, "system", "Live started. Be kind: chat is moderated.", now);
    const followers = S.db.all("SELECT follower_id FROM follows WHERE followee_id = ? AND status = 'active' LIMIT 5000", user.id);
    followers.forEach((f) => notify(S, { userId: f.follower_id, type: "live_started", actorId: user.id, targetType: "live", targetId: st.id, data: { title: st.title } }));
    const fresh = loadStream(S, st.id);
    setState(S, fresh, "live");
    return { stream: streamOut(S, fresh, user.id) };
  });

  r.post("/api/live/:id/end", ({ params, user }) => {
    const st = loadStream(S, params.id);
    if (st.host_id !== user.id && !["admin", "moderator"].includes(user.role)) throw forbidden("not_host", "Only the host can end this live.");
    if (st.status === "scheduled") { S.db.run("UPDATE live_streams SET status = 'cancelled' WHERE id = ?", st.id); return { stream: streamOut(S, loadStream(S, st.id), user.id) }; }
    if (st.status !== "live") throw new HttpError(409, "invalid_state", `This live is ${st.status}.`);
    endStream(S, st.id, st.host_id === user.id ? "host_ended" : "moderator_ended");
    const summary = S.db.get(`SELECT l.peak_viewers, l.unique_viewers, l.started_at, l.ended_at,
        (SELECT COALESCE(SUM(watch_ms),0) FROM live_viewers WHERE stream_id = l.id) AS watch_ms,
        (SELECT COUNT(*) FROM live_messages WHERE stream_id = l.id AND kind = 'chat') AS chat_messages,
        (SELECT COALESCE(SUM(creator_cents),0) FROM gifts WHERE context_type = 'live' AND context_id = l.id) AS gift_cents,
        (SELECT COALESCE(SUM(creator_cents),0) FROM donations WHERE context_type = 'live' AND context_id = l.id AND status = 'succeeded') AS donation_cents,
        (SELECT COUNT(*) FROM follows WHERE followee_id = l.host_id AND created_at BETWEEN l.started_at AND l.ended_at) AS new_followers
      FROM live_streams l WHERE l.id = ?`, st.id);
    return { stream: streamOut(S, loadStream(S, st.id), user.id), summary };
  });

  r.patch("/api/live/:id", ({ params, user, body }) => {
    const st = loadStream(S, params.id);
    if (!isMod(S, st.host_id, user.id)) throw forbidden();
    if (body.slow_mode_seconds !== undefined) {
      const v = Number(body.slow_mode_seconds);
      if (![0, 3, 5, 10, 30, 60, 120].includes(v)) throw bad("invalid_slow_mode", "Slow mode must be one of 0, 3, 5, 10, 30, 60, 120 seconds.");
      S.db.run("UPDATE live_streams SET slow_mode_seconds = ? WHERE id = ?", v, st.id);
      S.rt.publish(`live:${st.id}`, { t: "live:settings", stream: st.id, slow_mode_seconds: v });
    }
    if (st.host_id === user.id) {
      if (body.title !== undefined) { const t = String(body.title).trim(); if (!t || t.length > 100) throw bad("invalid_title", "Titles are 1–100 characters."); S.db.run("UPDATE live_streams SET title = ? WHERE id = ?", t, st.id); }
      if (body.description !== undefined) S.db.run("UPDATE live_streams SET description = ? WHERE id = ?", String(body.description).slice(0, 500), st.id);
    }
    return { stream: streamOut(S, loadStream(S, st.id), user.id) };
  });

  r.get("/api/live/:id/messages", ({ params, user, query }) => {
    const st = loadStream(S, params.id);
    if (!canWatch(S, user.id, st)) throw notFound();
    const rows = S.db.all(`SELECT * FROM live_messages WHERE stream_id = ? AND status = 'visible' ${query.after ? "AND id > ?" : ""} ORDER BY id ASC LIMIT 200`, st.id, ...(query.after ? [String(query.after)] : []));
    return { items: msgOut(S, rows) };
  });

  r.post("/api/live/:id/messages", ({ params, user, body }) => {
    const st = loadStream(S, params.id);
    if (st.status !== "live") throw new HttpError(409, "not_live", "Chat opens when the live starts.");
    if (!canWatch(S, user.id, st)) throw notFound();
    const mute = sanction(S, st.host_id, user.id, "mute");
    if (mute) throw forbidden("muted", mute.until ? `You’re timed out for ${Math.ceil((mute.until - S.now()) / 60000)} more minute(s).` : "You can’t chat in this live.");
    const text = String(body.body ?? "").trim();
    if (!text) throw bad("empty", "Write a message.");
    if (text.length > 200) throw bad("too_long", "Chat messages can be up to 200 characters.");
    const mod = isMod(S, st.host_id, user.id);
    if (!mod) {
      S.limiter.take("live_chat", user.id);
      const k = `${st.id}:${user.id}`;
      const last = lastChat.get(k) ?? 0;
      if (st.slow_mode_seconds && S.now() - last < st.slow_mode_seconds * 1000) throw new HttpError(429, "slow_mode", `Slow mode is on. Wait ${Math.ceil((st.slow_mode_seconds * 1000 - (S.now() - last)) / 1000)}s.`);
      if (S.db.get("SELECT 1 FROM live_messages WHERE stream_id = ? AND user_id = ? AND body = ? AND created_at > ?", st.id, user.id, text, S.now() - 15_000)) throw new HttpError(409, "duplicate", "You just sent that.");
      lastChat.set(k, S.now());
    }
    const mid = id("lm");
    S.db.run("INSERT INTO live_messages (id, stream_id, user_id, kind, body, data, created_at) VALUES (?,?,?,?,?,?,?)", mid, st.id, user.id, "chat", text, JSON.stringify({ mod, host: st.host_id === user.id, supporter: !!S.db.get("SELECT 1 FROM gifts WHERE sender_id = ? AND recipient_id = ? LIMIT 1", user.id, st.host_id) }), S.now());
    const out = msgOut(S, [S.db.get("SELECT * FROM live_messages WHERE id = ?", mid)])[0];
    S.rt.publish(`live:${st.id}`, { t: "live:chat", stream: st.id, message: out });
    recordMentions(S, { sourceType: "live", sourceId: mid, authorId: user.id, text, targetType: "live", targetId: st.id });
    return { message: out };
  });

  r.delete("/api/live/:id/messages/:mid", ({ params, user }) => {
    const st = loadStream(S, params.id);
    const m = S.db.get("SELECT * FROM live_messages WHERE id = ? AND stream_id = ?", params.mid, st.id);
    if (!m) throw notFound();
    if (m.user_id !== user.id && !isMod(S, st.host_id, user.id)) throw forbidden();
    S.db.run("UPDATE live_messages SET status = 'deleted' WHERE id = ?", m.id);
    if (st.pinned_message_id === m.id) S.db.run("UPDATE live_streams SET pinned_message_id = NULL WHERE id = ?", st.id);
    S.rt.publish(`live:${st.id}`, { t: "live:chat_deleted", stream: st.id, message_id: m.id });
    return { ok: true };
  });

  r.post("/api/live/:id/pin", ({ params, user, body }) => {
    const st = loadStream(S, params.id);
    if (!isMod(S, st.host_id, user.id)) throw forbidden();
    const mid = body.message_id ? String(body.message_id) : null;
    if (mid && !S.db.get("SELECT 1 FROM live_messages WHERE id = ? AND stream_id = ? AND kind = 'chat' AND status = 'visible'", mid, st.id)) throw notFound("Message not found.");
    S.db.run("UPDATE live_streams SET pinned_message_id = ? WHERE id = ?", mid, st.id);
    const pinned = mid ? msgOut(S, [S.db.get("SELECT * FROM live_messages WHERE id = ?", mid)])[0] : null;
    S.rt.publish(`live:${st.id}`, { t: "live:pinned", stream: st.id, message: pinned });
    return { pinned };
  });

  r.post("/api/live/:id/moderation", ({ params, user, body }) => {
    const st = loadStream(S, params.id);
    if (!isMod(S, st.host_id, user.id)) throw forbidden("not_moderator", "Only the host and moderators can do that.");
    const target = getUser(S, String(body.user_id ?? ""));
    if (!target) throw notFound("Unknown viewer.");
    if (target.id === st.host_id) throw bad("host", "You can’t moderate the host.");
    if (isMod(S, st.host_id, target.id) && st.host_id !== user.id) throw forbidden("peer_moderator", "Only the host can moderate a moderator.");
    const now = S.now();
    const ch = `live:${st.id}`;
    switch (body.action) {
      case "mute": {
        const minutes = [1, 5, 10, 30, 60, 1440].includes(Number(body.minutes)) ? Number(body.minutes) : 5;
        S.db.run(`INSERT INTO live_sanctions (host_id, user_id, kind, until, issued_by, created_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(host_id, user_id, kind) DO UPDATE SET until = excluded.until, issued_by = excluded.issued_by`, st.host_id, target.id, "mute", now + minutes * 60_000, user.id, now);
        S.rt.toUser(target.id, { t: "live:muted", stream: st.id, until: now + minutes * 60_000 });
        break;
      }
      case "unmute": S.db.run("DELETE FROM live_sanctions WHERE host_id = ? AND user_id = ? AND kind = 'mute'", st.host_id, target.id); S.rt.toUser(target.id, { t: "live:muted", stream: st.id, until: null }); break;
      case "ban":
        S.db.run(`INSERT OR REPLACE INTO live_sanctions (host_id, user_id, kind, until, issued_by, created_at) VALUES (?,?,?,?,?,?)`, st.host_id, target.id, "ban", null, user.id, now);
        S.rt.kick(ch, target.id, { t: "live:removed", stream: st.id, reason: "banned" });
        break;
      case "unban": S.db.run("DELETE FROM live_sanctions WHERE host_id = ? AND user_id = ? AND kind = 'ban'", st.host_id, target.id); break;
      case "block":
        if (st.host_id !== user.id) throw forbidden("host_only", "Only the host can block.");
        S.db.tx(() => {
          S.db.run("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)", user.id, target.id, now);
          S.db.run("DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)", user.id, target.id, target.id, user.id);
        });
        S.rt.kick(ch, target.id, { t: "live:removed", stream: st.id, reason: "blocked" });
        break;
      default: throw bad("invalid_action", "Unknown moderation action.");
    }
    S.db.run("INSERT INTO moderation_actions (id, moderator_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)", id("ma"), user.id, `live_${body.action}`, "user", target.id, `stream ${st.id}`, now);
    // Clear the offender's recent messages from everyone's chat on ban/block
    if (body.action === "ban" || body.action === "block") {
      const recent = S.db.all("SELECT id FROM live_messages WHERE stream_id = ? AND user_id = ? AND status = 'visible' AND kind = 'chat'", st.id, target.id);
      recent.forEach((m) => { S.db.run("UPDATE live_messages SET status = 'deleted' WHERE id = ?", m.id); S.rt.publish(ch, { t: "live:chat_deleted", stream: st.id, message_id: m.id }); });
    }
    return { ok: true };
  });

  r.get("/api/live/:id/moderators", ({ params, user }) => {
    const st = loadStream(S, params.id);
    if (st.host_id !== user.id) throw forbidden();
    return { items: Object.values(cardsById(S, S.db.all("SELECT moderator_id FROM live_moderators WHERE host_id = ?", user.id).map((m) => m.moderator_id))) };
  });
  r.post("/api/live/:id/moderators", ({ params, user, body }) => {
    const st = loadStream(S, params.id);
    if (st.host_id !== user.id) throw forbidden("host_only", "Only the host can add moderators.");
    const target = getUser(S, String(body.user_id ?? ""));
    if (!target || target.id === user.id) throw bad("invalid_user", "Pick someone else.");
    S.db.run("INSERT OR IGNORE INTO live_moderators (host_id, moderator_id, created_at) VALUES (?,?,?)", user.id, target.id, S.now());
    S.rt.toUser(target.id, { t: "live:moderator", stream: st.id, granted: true });
    return { ok: true };
  });
  r.delete("/api/live/:id/moderators/:uid", ({ params, user }) => {
    const st = loadStream(S, params.id);
    if (st.host_id !== user.id) throw forbidden();
    S.db.run("DELETE FROM live_moderators WHERE host_id = ? AND moderator_id = ?", user.id, params.uid);
    return { ok: true };
  });

  r.post("/api/live/:id/react", ({ params, user, body }) => {
    S.limiter.take("live_react", user.id);
    const st = loadStream(S, params.id);
    if (st.status !== "live" || !canWatch(S, user.id, st)) throw notFound();
    const kind = REACTIONS.includes(body.kind) ? body.kind : "love";
    reactionCounts.set(st.id, (reactionCounts.get(st.id) ?? 0) + 1);
    S.rt.publish(`live:${st.id}`, { t: "live:reaction", stream: st.id, kind, user_id: user.id });
    return { ok: true };
  });
}

export function init(S) {
  const { rt } = S;
  rt.guard("live:", (conn, sid) => {
    const st = S.db.get("SELECT * FROM live_streams WHERE id = ?", sid);
    if (!st || !["live", "scheduled"].includes(st.status) || !canWatch(S, conn.userId, st)) return false;
    if (st.transport === "webrtc-mesh" && conn.userId !== st.host_id) {
      const present = new Set(rt.members(`live:${sid}`).map((c) => c.userId));
      if (!present.has(conn.userId) && viewerCount(S, st) >= S.cfg.live.meshMaxViewers) {
        rt.toConn(conn.id, { t: "live:full", stream: sid, max: S.cfg.live.meshMaxViewers });
        return false;
      }
    }
    return true;
  });

  const broadcastCount = (st) => {
    const n = viewerCount(S, st);
    if (n > st.peak_viewers) S.db.run("UPDATE live_streams SET peak_viewers = ? WHERE id = ? AND peak_viewers < ?", n, st.id, n);
    rt.publish(`live:${st.id}`, { t: "live:viewers", stream: st.id, count: n });
  };

  rt.onJoin((conn, ch) => {
    if (!ch.startsWith("live:")) return;
    const sid = ch.slice(5);
    const st = S.db.get("SELECT * FROM live_streams WHERE id = ?", sid);
    if (!st || conn.userId === st.host_id) return;
    conn.meta[`join:${sid}`] = S.now();
    S.db.tx(() => {
      const first = !S.db.get("SELECT 1 FROM live_viewers WHERE stream_id = ? AND user_id = ?", sid, conn.userId);
      S.db.run("INSERT INTO live_viewers (id, stream_id, user_id, joined_at) VALUES (?,?,?,?)", id("lvv"), sid, conn.userId, S.now());
      if (first) S.db.run("UPDATE live_streams SET unique_viewers = unique_viewers + 1 WHERE id = ?", sid);
    });
    broadcastCount(st);
    // Ask the host to open a peer connection to this viewer
    for (const hc of hostConns.get(sid) ?? []) rt.toConn(hc, { t: "live:viewer_joined", stream: sid, conn: conn.id, user: card(S, conn.userId) });
  });

  rt.onLeave((conn, ch) => {
    if (!ch.startsWith("live:")) return;
    const sid = ch.slice(5);
    const st = S.db.get("SELECT * FROM live_streams WHERE id = ?", sid);
    if (!st) return;
    if (conn.userId === st.host_id) {
      const set = hostConns.get(sid);
      if (set?.delete(conn.id) && !set.size && st.status === "live") {
        // Host dropped: keep the room open for the grace period so they can reconnect
        setState(S, st, "reconnecting");
        { const t = setTimeout(() => { if (!S.closed) endStream(S, sid, "host_disconnected"); }, S.cfg.live.hostReconnectGraceMs); t.unref(); graceTimers.set(sid, t); }
      }
      return;
    }
    const joined = conn.meta[`join:${sid}`];
    if (joined) {
      S.db.run("UPDATE live_viewers SET left_at = ?, watch_ms = ? WHERE id = (SELECT id FROM live_viewers WHERE stream_id = ? AND user_id = ? AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1)", S.now(), S.now() - joined, sid, conn.userId);
      delete conn.meta[`join:${sid}`];
    }
    broadcastCount(st);
    for (const hc of hostConns.get(sid) ?? []) rt.toConn(hc, { t: "live:viewer_left", stream: sid, conn: conn.id });
  });

  // The host's browser announces it is publishing (after start, and again after any reconnect)
  rt.on("live:host", (conn, msg) => {
    const sid = String(msg.stream ?? "");
    const st = S.db.get("SELECT * FROM live_streams WHERE id = ?", sid);
    if (!st || st.host_id !== conn.userId || st.status !== "live") throw new HttpError(403, "not_host", "Not your live.");
    if (!conn.subs.has(`live:${sid}`)) throw new HttpError(400, "not_subscribed", "Subscribe to the room first.");
    if (!hostConns.has(sid)) hostConns.set(sid, new Set());
    hostConns.get(sid).add(conn.id);
    if (graceTimers.has(sid)) { clearTimeout(graceTimers.get(sid)); graceTimers.delete(sid); setState(S, st, "live", { resumed: true }); }
    const viewers = rt.members(`live:${sid}`).filter((c) => c.userId !== st.host_id).map((c) => ({ conn: c.id, user: card(S, c.userId) }));
    rt.toConn(conn.id, { t: "live:viewers_list", stream: sid, viewers });
  });

  // A viewer asks for a fresh offer (first join after the host arrived, or after an ICE failure)
  rt.on("live:ready", (conn, msg) => {
    const sid = String(msg.stream ?? "");
    if (!conn.subs.has(`live:${sid}`)) return;
    for (const hc of hostConns.get(sid) ?? []) rt.toConn(hc, { t: "live:viewer_joined", stream: sid, conn: conn.id, user: card(S, conn.userId), restart: true });
  });

  // SDP / ICE relay, host ↔ viewer only, both in the same room
  rt.on("live:signal", (conn, msg) => {
    const sid = String(msg.stream ?? "");
    const to = rt.conn(String(msg.to ?? ""));
    if (!to || !conn.subs.has(`live:${sid}`) || !to.subs.has(`live:${sid}`)) return;
    const hosts = hostConns.get(sid) ?? new Set();
    const fromHost = hosts.has(conn.id), toHost = hosts.has(to.id);
    if (fromHost === toHost) return;          // viewer↔viewer or host↔host is never relayed
    const data = msg.data;
    if (!data || typeof data !== "object" || JSON.stringify(data).length > 32_000) return;
    rt.toConn(to.id, { t: "live:signal", stream: sid, from: conn.id, data });
  });

  rt.on("live:health", (conn, msg) => {
    const sid = String(msg.stream ?? "");
    if (!(hostConns.get(sid) ?? new Set()).has(conn.id)) return;
    const s = msg.stats ?? {};
    const stats = { bitrate_kbps: Number(s.bitrate_kbps) || 0, fps: Number(s.fps) || 0, width: Number(s.width) || 0, height: Number(s.height) || 0, peers: Number(s.peers) || 0, packet_loss: Number(s.packet_loss) || 0, at: S.now() };
    health.set(sid, stats);
    const quality = stats.fps >= 20 && stats.packet_loss < 0.05 ? "good" : stats.fps >= 10 ? "fair" : "poor";
    rt.publish(`live:${sid}`, { t: "live:health", stream: sid, quality, stats: { fps: stats.fps, peers: stats.peers } });
  });
}

export function stop() {
  for (const t of graceTimers.values()) clearTimeout(t);
  graceTimers.clear(); hostConns.clear(); health.clear(); reactionCounts.clear(); lastChat.clear();
}

export function jobs(S) {
  // Safety net: a "live" stream with no host socket and no grace timer (e.g. after a server restart) is ended
  S.every(60_000, () => {
    for (const st of S.db.all("SELECT id, started_at FROM live_streams WHERE status = 'live'")) {
      if (!(hostConns.get(st.id)?.size) && !graceTimers.has(st.id) && S.now() - st.started_at > S.cfg.live.hostReconnectGraceMs) endStream(S, st.id, "host_disconnected");
    }
  });
}
