// Users, profiles, privacy and the social graph (follow / request / block / mute / restrict / close friends).
// Privacy and blocks are enforced here, server-side; other modules call these helpers instead of reimplementing them.
import { bad, forbidden, notFound, HttpError } from "../lib/http.js";
import { json } from "../lib/db.js";
import { notify } from "./notifications.js";

export function ensureUserRows(S, uid) {
  const now = S.now();
  S.db.run("INSERT OR IGNORE INTO privacy_settings (user_id, updated_at) VALUES (?,?)", uid, now);
  S.db.run("INSERT OR IGNORE INTO wallets (user_id, credits, updated_at) VALUES (?,0,?)", uid, now);
  S.db.run("INSERT OR IGNORE INTO creator_balances (user_id, updated_at) VALUES (?,?)", uid, now);
}

export const privacyOf = (S, uid) => S.db.get("SELECT * FROM privacy_settings WHERE user_id = ?", uid);
export const getUser = (S, uid) => S.db.get("SELECT * FROM users WHERE id = ?", uid);

export function isBlockedEither(S, a, b) {
  if (!a || !b || a === b) return false;
  return !!S.db.get("SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)", a, b, b, a);
}
export const followStatus = (S, follower, followee) => S.db.get("SELECT status FROM follows WHERE follower_id = ? AND followee_id = ?", follower, followee)?.status ?? null;
export const isFollowing = (S, follower, followee) => followStatus(S, follower, followee) === "active";

/** Can viewer see this owner's non-public content (posts, reels, followers list)? */
export function canSeeContent(S, viewerId, owner) {
  if (!owner || owner.status !== "active") return false;
  if (viewerId === owner.id) return true;
  if (isBlockedEither(S, viewerId, owner.id)) return false;
  return !owner.is_private || isFollowing(S, viewerId, owner.id);
}

/** Resolve an "everyone | following | nobody" setting: may `actor` do this to `owner`? */
export function audienceAllows(S, setting, ownerId, actorId) {
  if (ownerId === actorId) return true;
  if (isBlockedEither(S, ownerId, actorId)) return false;
  if (setting === "everyone") return true;
  if (setting === "following") return isFollowing(S, ownerId, actorId);   // people the owner follows
  if (setting === "followers") return isFollowing(S, actorId, ownerId);   // people who follow the owner
  return false;
}

const AVATAR_SQL = "(SELECT storage_key FROM media WHERE id = u.avatar_media_id)";
export function userCard(S, u) {
  if (!u) return null;
  const key = u.avatar_key !== undefined ? u.avatar_key : S.db.get("SELECT storage_key FROM media WHERE id = ?", u.avatar_media_id)?.storage_key;
  return { id: u.id, username: u.username, display_name: u.display_name, avatar_url: S.mediaUrl(key), is_verified: !!u.is_verified, is_creator: !!u.is_creator, is_private: !!u.is_private };
}
export function cardsById(S, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const rows = S.db.all(`SELECT u.*, ${AVATAR_SQL} AS avatar_key FROM users u WHERE u.id IN (${uniq.map(() => "?").join(",")})`, ...uniq);
  return Object.fromEntries(rows.map((r) => [r.id, userCard(S, r)]));
}
export const card = (S, uid) => cardsById(S, [uid])[uid] ?? null;

export function counts(S, uid) {
  return S.db.get(`SELECT
      (SELECT COUNT(*) FROM follows WHERE followee_id = ?1 AND status = 'active') AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?1 AND status = 'active') AS following,
      (SELECT COUNT(*) FROM posts WHERE author_id = ?1 AND status = 'active' AND type <> 'reel') AS posts,
      (SELECT COUNT(*) FROM posts WHERE author_id = ?1 AND status = 'active' AND type = 'reel') AS reels,
      (SELECT COALESCE(SUM(like_count),0) FROM posts WHERE author_id = ?1 AND status = 'active') AS likes`, uid);
}

export function relationship(S, viewerId, targetId) {
  if (!viewerId || viewerId === targetId) return { self: viewerId === targetId };
  const g = (sql, ...a) => !!S.db.get(sql, ...a);
  return {
    self: false,
    following: followStatus(S, viewerId, targetId) ?? "none",
    followed_by: isFollowing(S, targetId, viewerId),
    blocking: g("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?", viewerId, targetId),
    blocked_by: g("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?", targetId, viewerId),
    muted: g("SELECT 1 FROM mutes WHERE muter_id = ? AND muted_id = ?", viewerId, targetId),
    restricted: g("SELECT 1 FROM restricts WHERE user_id = ? AND restricted_id = ?", viewerId, targetId),
    close_friend: g("SELECT 1 FROM close_friends WHERE user_id = ? AND friend_id = ?", viewerId, targetId),
  };
}

export function selfUser(S, uid) {
  const u = getUser(S, uid);
  const keys = S.db.get("SELECT (SELECT storage_key FROM media WHERE id = ?) a, (SELECT storage_key FROM media WHERE id = ?) c", u.avatar_media_id, u.cover_media_id);
  const unread = S.db.get(`SELECT
      (SELECT COUNT(*) FROM notifications WHERE user_id = ?1 AND read_at IS NULL) AS notifications,
      (SELECT COUNT(*) FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
        WHERE cm.user_id = ?1 AND cm.state = 'active' AND c.last_message_id IS NOT NULL
          AND (cm.last_read_id IS NULL OR cm.last_read_id < c.last_message_id)
          AND (SELECT sender_id FROM messages WHERE id = c.last_message_id) <> ?1) AS messages,
      (SELECT COUNT(*) FROM conversation_members WHERE user_id = ?1 AND state = 'request') AS message_requests,
      (SELECT COUNT(*) FROM follows WHERE followee_id = ?1 AND status = 'pending') AS follow_requests`, uid);
  return {
    id: u.id, username: u.username, email: u.email, display_name: u.display_name, bio: u.bio, links: json(u.links, []),
    avatar_url: S.mediaUrl(keys.a), cover_url: S.mediaUrl(keys.c), avatar_media_id: u.avatar_media_id, cover_media_id: u.cover_media_id,
    is_private: !!u.is_private, is_creator: !!u.is_creator, is_verified: !!u.is_verified, role: u.role, created_at: u.created_at,
    email_verified: !!u.email_verified_at, has_password: !!u.password_hash,
    counts: counts(S, uid), unread,
    credits: S.db.get("SELECT credits FROM wallets WHERE user_id = ?", uid)?.credits ?? 0,
    privacy: publicPrivacy(privacyOf(S, uid)),
  };
}
const publicPrivacy = (p) => p && ({ messages: p.messages, comments: p.comments, mentions: p.mentions, tags: p.tags, story_audience: p.story_audience, live_audience: p.live_audience, activity_status: !!p.activity_status, show_like_counts: !!p.show_like_counts, allow_tips: !!p.allow_tips });

export function findByUsername(S, username) { return S.db.get("SELECT * FROM users WHERE username = ?", username); }

function resolveTarget(S, ref, viewerId) {
  const u = ref.startsWith("u_") ? getUser(S, ref) : findByUsername(S, ref);
  // Blocked-by and banned users look like they don't exist
  if (!u || u.status === "banned" || (viewerId && viewerId !== u.id && S.db.get("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?", u.id, viewerId))) throw notFound("That account doesn’t exist or isn’t available.");
  return u;
}

export function profileOut(S, u, viewerId) {
  const rel = relationship(S, viewerId, u.id);
  const visible = canSeeContent(S, viewerId, u);
  const pv = privacyOf(S, u.id);
  const keys = S.db.get("SELECT (SELECT storage_key FROM media WHERE id = ?) a, (SELECT storage_key FROM media WHERE id = ?) c", u.avatar_media_id, u.cover_media_id);
  const liveNow = visible ? S.db.get("SELECT id, title FROM live_streams WHERE host_id = ? AND status = 'live'", u.id) : null;
  return {
    id: u.id, username: u.username, display_name: u.display_name, bio: u.bio, links: json(u.links, []),
    avatar_url: S.mediaUrl(keys.a), cover_url: S.mediaUrl(keys.c),
    is_private: !!u.is_private, is_creator: !!u.is_creator, is_verified: !!u.is_verified, status: u.status,
    counts: counts(S, u.id), relationship: rel, content_visible: visible && !rel.blocking,
    live: liveNow && !rel.blocking ? liveNow : null,
    supports: { tips: !!(u.is_creator && pv.allow_tips) && S.payments.available, gifts: !!u.is_creator },
    can_message: !rel.self && !rel.blocking && (pv.messages !== "nobody" || (!!viewerId && existingDm(S, viewerId, u.id))),
    created_at: u.created_at,
  };
}
const existingDm = (S, a, b) => !!S.db.get("SELECT 1 FROM conversations WHERE dm_key = ?", [a, b].sort().join(":"));

/* ---------- Follow graph ---------- */
export function follow(S, viewer, targetId) {
  return S.db.tx(() => {
    const target = getUser(S, targetId);
    if (!target || target.status !== "active") throw notFound("That account doesn’t exist.");
    if (target.id === viewer.id) throw bad("self_follow", "You can’t follow yourself.");
    if (isBlockedEither(S, viewer.id, target.id)) throw forbidden("blocked", "You can’t follow this account.");
    const existing = followStatus(S, viewer.id, target.id);
    if (existing) return existing;                     // idempotent: repeated taps don't change anything
    const status = target.is_private ? "pending" : "active";
    S.db.run("INSERT INTO follows (follower_id, followee_id, status, created_at) VALUES (?,?,?,?)", viewer.id, target.id, status, S.now());
    notify(S, { userId: target.id, type: status === "active" ? "follow" : "follow_request", actorId: viewer.id, targetType: "user", targetId: viewer.id });
    return status;
  });
}
export function unfollow(S, viewerId, targetId) {
  S.db.run("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?", viewerId, targetId);
}

/* ---------- Keyset pagination helper for user lists ---------- */
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const dec = (s) => { try { return s ? JSON.parse(Buffer.from(s, "base64url").toString()) : null; } catch { throw bad("invalid_cursor", "Invalid cursor."); } };
export { enc as encodeCursor, dec as decodeCursor };

function userList(S, sql, args, cursor, limit, viewerId) {
  const c = dec(cursor);
  const rows = S.db.all(sql.replace("/*CURSOR*/", c ? "AND (f.created_at < ? OR (f.created_at = ? AND u.id < ?))" : ""), ...args, ...(c ? [c.t, c.t, c.id] : []), limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({ ...userCard(S, r), relationship: viewerId ? { following: followStatus(S, viewerId, r.id) ?? "none", self: viewerId === r.id } : undefined })),
    next_cursor: rows.length > limit ? enc({ t: page.at(-1).f_at, id: page.at(-1).id }) : null,
  };
}

const LINK = /^https?:\/\/[^\s<>"]{3,200}$/i;

export function register(r, S) {
  r.get("/api/users/:ref", ({ params, user }) => profileOut(S, resolveTarget(S, params.ref, user.id), user.id));

  r.get("/api/users/:ref/followers", ({ params, query, user }) => {
    const u = resolveTarget(S, params.ref, user.id);
    if (!canSeeContent(S, user.id, u)) throw forbidden("private", "This account is private.");
    return userList(S, `SELECT u.*, f.created_at AS f_at, ${AVATAR_SQL} AS avatar_key FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? AND f.status = 'active' AND u.status = 'active' /*CURSOR*/ ORDER BY f.created_at DESC, u.id DESC LIMIT ?`, [u.id], query.cursor, 30, user.id);
  });
  r.get("/api/users/:ref/following", ({ params, query, user }) => {
    const u = resolveTarget(S, params.ref, user.id);
    if (!canSeeContent(S, user.id, u)) throw forbidden("private", "This account is private.");
    return userList(S, `SELECT u.*, f.created_at AS f_at, ${AVATAR_SQL} AS avatar_key FROM follows f JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ? AND f.status = 'active' AND u.status = 'active' /*CURSOR*/ ORDER BY f.created_at DESC, u.id DESC LIMIT ?`, [u.id], query.cursor, 30, user.id);
  });

  r.post("/api/users/:id/follow", ({ params, user }) => {
    S.limiter.take("follow", user.id);
    const state = follow(S, user, params.id);
    return { following: state, counts: counts(S, params.id) };
  });
  r.delete("/api/users/:id/follow", ({ params, user }) => {
    unfollow(S, user.id, params.id);
    return { following: "none", counts: counts(S, params.id) };
  });

  r.get("/api/me/follow-requests", ({ user }) => ({
    items: S.db.all(`SELECT u.*, ${AVATAR_SQL} AS avatar_key, f.created_at AS requested_at FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 100`, user.id).map((u) => ({ ...userCard(S, u), requested_at: u.requested_at })),
  }));
  r.post("/api/me/follow-requests/:id/:decision", ({ params, user }) => {
    if (!["accept", "decline"].includes(params.decision)) throw notFound();
    return S.db.tx(() => {
      const row = S.db.get("SELECT * FROM follows WHERE follower_id = ? AND followee_id = ? AND status = 'pending'", params.id, user.id);
      if (!row) throw notFound("That request no longer exists.");
      if (params.decision === "accept") {
        S.db.run("UPDATE follows SET status = 'active', created_at = ? WHERE follower_id = ? AND followee_id = ?", S.now(), params.id, user.id);
        notify(S, { userId: params.id, type: "follow_accepted", actorId: user.id, targetType: "user", targetId: user.id });
      } else S.db.run("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?", params.id, user.id);
      return { ok: true, counts: counts(S, user.id) };
    });
  });
  r.delete("/api/me/followers/:id", ({ params, user }) => {
    S.db.run("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?", params.id, user.id);
    return { ok: true, counts: counts(S, user.id) };
  });

  // Block / mute / restrict
  r.post("/api/users/:id/block", ({ params, user }) => {
    if (params.id === user.id) throw bad("self", "You can’t block yourself.");
    if (!getUser(S, params.id)) throw notFound();
    S.db.tx(() => {
      S.db.run("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)", user.id, params.id, S.now());
      S.db.run("DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)", user.id, params.id, params.id, user.id);
      S.db.run("DELETE FROM close_friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", user.id, params.id, params.id, user.id);
    });
    // Drop the blocked user out of the blocker's live rooms
    const liveRow = S.db.get("SELECT id FROM live_streams WHERE host_id = ? AND status = 'live'", user.id);
    if (liveRow) S.rt.kick(`live:${liveRow.id}`, params.id, { t: "live:removed", stream: liveRow.id, reason: "blocked" });
    return { ok: true };
  });
  r.delete("/api/users/:id/block", ({ params, user }) => { S.db.run("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?", user.id, params.id); return { ok: true }; });
  for (const [kind, table, a, b] of [["mute", "mutes", "muter_id", "muted_id"], ["restrict", "restricts", "user_id", "restricted_id"]]) {
    r.post(`/api/users/:id/${kind}`, ({ params, user }) => {
      if (params.id === user.id) throw bad("self", `You can’t ${kind} yourself.`);
      if (!getUser(S, params.id)) throw notFound();
      S.db.run(`INSERT OR IGNORE INTO ${table} (${a}, ${b}, created_at) VALUES (?,?,?)`, user.id, params.id, S.now());
      return { ok: true };
    });
    r.delete(`/api/users/:id/${kind}`, ({ params, user }) => { S.db.run(`DELETE FROM ${table} WHERE ${a} = ? AND ${b} = ?`, user.id, params.id); return { ok: true }; });
  }
  r.get("/api/me/relationships/:kind", ({ params, user }) => {
    const map = { blocked: ["blocks", "blocker_id", "blocked_id"], muted: ["mutes", "muter_id", "muted_id"], restricted: ["restricts", "user_id", "restricted_id"], close_friends: ["close_friends", "user_id", "friend_id"] };
    const m = map[params.kind]; if (!m) throw notFound();
    return { items: S.db.all(`SELECT u.*, ${AVATAR_SQL} AS avatar_key FROM ${m[0]} x JOIN users u ON u.id = x.${m[2]} WHERE x.${m[1]} = ? ORDER BY x.created_at DESC LIMIT 500`, user.id).map((u) => userCard(S, u)) };
  });
  r.post("/api/me/close-friends/:id", ({ params, user }) => {
    if (params.id === user.id || !getUser(S, params.id)) throw bad("invalid", "Can’t add that account.");
    if (isBlockedEither(S, user.id, params.id)) throw forbidden();
    S.db.run("INSERT OR IGNORE INTO close_friends (user_id, friend_id, created_at) VALUES (?,?,?)", user.id, params.id, S.now());
    return { ok: true };
  });
  r.delete("/api/me/close-friends/:id", ({ params, user }) => { S.db.run("DELETE FROM close_friends WHERE user_id = ? AND friend_id = ?", user.id, params.id); return { ok: true }; });

  // Profile & settings
  r.patch("/api/me/profile", ({ body, user }) => {
    const sets = [], vals = [];
    const put = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
    if (body.display_name !== undefined) {
      const v = String(body.display_name).trim();
      if (!v || v.length > 50) throw bad("invalid_name", "Display names are 1–50 characters.");
      put("display_name", v);
    }
    if (body.username !== undefined) {
      const v = String(body.username).trim();
      if (!/^[a-z0-9_.]{3,24}$/i.test(v)) throw bad("invalid_username", "Usernames are 3–24 letters, numbers, dots or underscores.");
      const other = findByUsername(S, v);
      if (other && other.id !== user.id) throw new HttpError(409, "username_taken", "That username is taken.");
      put("username", v);
    }
    if (body.bio !== undefined) { const v = String(body.bio); if (v.length > 300) throw bad("bio_too_long", "Bios are at most 300 characters."); put("bio", v); }
    if (body.links !== undefined) {
      if (!Array.isArray(body.links) || body.links.length > 5) throw bad("invalid_links", "Add up to 5 links.");
      const links = body.links.map((l) => ({ label: String(l.label ?? "").slice(0, 40), url: String(l.url ?? "").trim() }));
      if (links.some((l) => !LINK.test(l.url))) throw bad("invalid_link", "Links must start with http:// or https://");
      put("links", JSON.stringify(links));
    }
    for (const col of ["avatar_media_id", "cover_media_id"]) {
      if (body[col] === undefined) continue;
      if (body[col] === null) { put(col, null); continue; }
      const m = S.db.get("SELECT * FROM media WHERE id = ? AND owner_id = ? AND kind = 'image' AND status = 'ready'", String(body[col]), user.id);
      if (!m) throw bad("invalid_media", "Upload an image first.");
      put(col, m.id);
    }
    if (body.is_creator !== undefined) put("is_creator", body.is_creator ? 1 : 0);
    let becamePublic = false;
    if (body.is_private !== undefined) { put("is_private", body.is_private ? 1 : 0); becamePublic = !body.is_private && !!user.is_private; }
    if (!sets.length) return { user: selfUser(S, user.id) };
    S.db.tx(() => {
      S.db.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...vals, user.id);
      // Going public approves everyone who was waiting
      if (becamePublic) S.db.run("UPDATE follows SET status = 'active' WHERE followee_id = ? AND status = 'pending'", user.id);
    });
    return { user: selfUser(S, user.id) };
  });

  const ENUMS = {
    messages: ["everyone", "following", "nobody"], comments: ["everyone", "followers", "off"], mentions: ["everyone", "following", "nobody"],
    tags: ["everyone", "following", "nobody"], story_audience: ["public", "followers", "close_friends"], live_audience: ["public", "followers"],
  };
  r.get("/api/me/privacy", ({ user }) => publicPrivacy(privacyOf(S, user.id)));
  r.patch("/api/me/privacy", ({ body, user }) => {
    const sets = [], vals = [];
    for (const [k, allowed] of Object.entries(ENUMS)) {
      if (body[k] === undefined) continue;
      if (!allowed.includes(body[k])) throw bad("invalid_" + k, `${k} must be one of ${allowed.join(", ")}.`);
      sets.push(`${k} = ?`); vals.push(body[k]);
    }
    for (const k of ["activity_status", "show_like_counts", "allow_tips"]) if (body[k] !== undefined) { sets.push(`${k} = ?`); vals.push(body[k] ? 1 : 0); }
    if (sets.length) S.db.run(`UPDATE privacy_settings SET ${sets.join(", ")}, updated_at = ? WHERE user_id = ?`, ...vals, S.now(), user.id);
    return publicPrivacy(privacyOf(S, user.id));
  });

  r.get("/api/suggestions/creators", ({ user, query }) => {
    const limit = Math.min(Number(query.limit) || 8, 30);
    const rows = S.db.all(`SELECT u.*, ${AVATAR_SQL} AS avatar_key,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id AND f.status = 'active') AS fc,
        (SELECT COUNT(*) FROM follows f1 JOIN follows f2 ON f2.follower_id = f1.followee_id
           WHERE f1.follower_id = ?1 AND f1.status = 'active' AND f2.followee_id = u.id AND f2.status = 'active') AS mutual
      FROM users u WHERE u.id <> ?1 AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ?1 AND followee_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = ?1 AND blocked_id = u.id) OR (blocker_id = u.id AND blocked_id = ?1))
      ORDER BY u.is_creator DESC, mutual DESC, fc DESC LIMIT ?2`, user.id, limit);
    return { items: rows.map((u) => ({ ...userCard(S, u), followers: u.fc, mutual: u.mutual, bio: u.bio })) };
  });
}
