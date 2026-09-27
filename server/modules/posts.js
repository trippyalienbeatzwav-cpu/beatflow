// Posts, reels, comments and interactions. Counters are updated in the same transaction as the row that
// changes them, and only when a row was actually inserted or deleted, so rapid repeated taps can't drift a count.
import { id } from "../lib/ids.js";
import { bad, forbidden, notFound, HttpError } from "../lib/http.js";
import { json } from "../lib/db.js";
import { cardsById, canSeeContent, getUser, privacyOf, audienceAllows, isBlockedEither, findByUsername } from "./users.js";
import { mediaOut, ownedMedia } from "./media.js";
import { notify } from "./notifications.js";

export const REACTIONS = ["like", "love", "fire", "laugh", "wow", "sad", "clap"];
const HASHTAG = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,50})/gu;
const MENTION = /(^|[^\w@])@([a-z0-9_.]{3,24})/gi;

export const parseHashtags = (t) => [...new Set([...String(t).matchAll(HASHTAG)].map((m) => m[2].toLowerCase()))].slice(0, 30);
export const parseMentions = (t) => [...new Set([...String(t).matchAll(MENTION)].map((m) => m[2].toLowerCase()))].slice(0, 20);

/** SQL visibility rule for posts `p` joined to authors `a`. Uses the named parameter :viewer. */
export const VISIBLE_SQL = `p.status = 'active' AND a.status = 'active'
  AND (p.author_id = :viewer OR (a.is_private = 0 AND p.visibility = 'public')
       OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = p.author_id AND f.status = 'active'))
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :viewer AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = :viewer))`;
/** Extra filters for discovery surfaces: hidden posts and muted authors are left out. */
export const DISCOVERY_SQL = `NOT EXISTS (SELECT 1 FROM hidden_posts h WHERE h.user_id = :viewer AND h.post_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM mutes mu WHERE mu.muter_id = :viewer AND mu.muted_id = p.author_id)`;

export function canViewPost(S, viewerId, p) {
  if (!p || p.status !== "active") return false;
  const author = getUser(S, p.author_id);
  if (!author || author.status !== "active") return false;
  if (viewerId === author.id) return true;
  if (isBlockedEither(S, viewerId, author.id)) return false;
  if (!author.is_private && p.visibility === "public") return true;
  // Private accounts and followers-only posts: active followers only
  return !!S.db.get("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ? AND status = 'active'", viewerId, author.id);
}

export function loadPost(S, pid, viewerId) {
  const p = S.db.get("SELECT * FROM posts WHERE id = ?", pid);
  if (!p || !canViewPost(S, viewerId, p)) throw notFound("This post isn’t available.");
  return p;
}

/** Batch-serialize posts for a viewer (no per-post N+1 on authors). */
export function serializePosts(S, rows, viewerId, depth = 0) {
  if (!rows.length) return [];
  const ids = rows.map((p) => p.id);
  const ph = ids.map(() => "?").join(",");
  const authors = cardsById(S, rows.map((p) => p.author_id));
  const mediaRows = S.db.all(`SELECT pm.post_id, pm.position, pm.alt, m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id IN (${ph}) ORDER BY pm.position`, ...ids);
  const reactions = Object.fromEntries(S.db.all(`SELECT target_id, kind FROM reactions WHERE user_id = ? AND target_type = 'post' AND target_id IN (${ph})`, viewerId, ...ids).map((r) => [r.target_id, r.kind]));
  const saved = new Set(S.db.all(`SELECT post_id FROM saves WHERE user_id = ? AND post_id IN (${ph})`, viewerId, ...ids).map((r) => r.post_id));
  const privacy = Object.fromEntries(S.db.all(`SELECT user_id, show_like_counts, allow_tips, comments FROM privacy_settings WHERE user_id IN (${[...new Set(rows.map((p) => p.author_id))].map(() => "?").join(",")})`, ...new Set(rows.map((p) => p.author_id))).map((r) => [r.user_id, r]));
  const authorIds = [...new Set(rows.map((p) => p.author_id))];
  const following = new Set(S.db.all(`SELECT followee_id FROM follows WHERE follower_id = ? AND status = 'active' AND followee_id IN (${authorIds.map(() => "?").join(",")})`, viewerId, ...authorIds).map((r) => r.followee_id));
  const tags = S.db.all(`SELECT post_id, user_id FROM post_tags WHERE post_id IN (${ph})`, ...ids);
  const tagCards = cardsById(S, tags.map((t) => t.user_id));
  const shared = depth === 0 ? rows.filter((p) => p.shared_post_id).map((p) => p.shared_post_id) : [];
  const sharedMap = {};
  if (shared.length) {
    const srows = S.db.all(`SELECT * FROM posts WHERE id IN (${shared.map(() => "?").join(",")})`, ...shared);
    const visible = srows.filter((sp) => canViewPost(S, viewerId, sp));
    serializePosts(S, visible, viewerId, 1).forEach((sp) => (sharedMap[sp.id] = sp));
  }
  const viewer = getUser(S, viewerId);
  return rows.map((p) => {
    const pv = privacy[p.author_id] ?? {};
    const own = p.author_id === viewerId;
    const author = authors[p.author_id];
    return {
      id: p.id, type: p.type, caption: p.caption, author, created_at: p.created_at, edited_at: p.edited_at, visibility: p.visibility, audio_title: p.audio_title,
      media: mediaRows.filter((m) => m.post_id === p.id).map((m) => ({ ...mediaOut(S, m), alt: m.alt })),
      counts: { likes: own || pv.show_like_counts ? p.like_count : null, comments: p.comment_count, shares: p.share_count, saves: own ? p.save_count : null, views: p.view_count },
      viewer: {
        reaction: reactions[p.id] ?? null, saved: saved.has(p.id), is_author: own, following_author: following.has(p.author_id),
        can_comment: own || (pv.comments === "everyone" || (pv.comments === "followers" && !!S.db.get("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ? AND status='active'", viewerId, p.author_id))),
        can_tip: !own && !!author?.is_creator && !!pv.allow_tips && !!p.allow_tips && S.payments.available,
        can_gift: !own && !!author?.is_creator,
        can_moderate: viewer?.role === "admin" || viewer?.role === "moderator",
      },
      tagged: tags.filter((t) => t.post_id === p.id).map((t) => tagCards[t.user_id]).filter(Boolean),
      shared_post: p.shared_post_id ? (sharedMap[p.shared_post_id] ?? { unavailable: true }) : null,
    };
  });
}

function upsertHashtags(S, postId, tags, now) {
  for (const t of tags) {
    S.db.run("INSERT OR IGNORE INTO post_hashtags (post_id, tag, created_at) VALUES (?,?,?)", postId, t, now);
    S.db.run(`INSERT INTO hashtags (tag, post_count, last_used_at) VALUES (?,1,?)
      ON CONFLICT(tag) DO UPDATE SET post_count = post_count + 1, last_used_at = excluded.last_used_at`, t, now);
  }
}
function dropHashtags(S, postId) {
  for (const { tag } of S.db.all("SELECT tag FROM post_hashtags WHERE post_id = ?", postId)) S.db.run("UPDATE hashtags SET post_count = MAX(post_count - 1, 0) WHERE tag = ?", tag);
  S.db.run("DELETE FROM post_hashtags WHERE post_id = ?", postId);
}

/** Record mentions the mentioned user allows, and notify them. Returns ids actually mentioned. */
export function recordMentions(S, { sourceType, sourceId, authorId, text, targetType = "post", targetId = null }) {
  const out = [];
  for (const name of parseMentions(text)) {
    const u = findByUsername(S, name);
    if (!u || u.id === authorId || u.status !== "active") continue;
    if (!audienceAllows(S, privacyOf(S, u.id).mentions, u.id, authorId)) continue;
    const r = S.db.run("INSERT OR IGNORE INTO mentions (id, source_type, source_id, author_id, mentioned_id, created_at) VALUES (?,?,?,?,?,?)", id("mn"), sourceType, sourceId, authorId, u.id, S.now());
    if (r.changes) { notify(S, { userId: u.id, type: "mention", actorId: authorId, targetType, targetId: targetId ?? sourceId, data: { source: sourceType, excerpt: String(text).slice(0, 120) } }); out.push(u.id); }
  }
  return out;
}

export function createPost(S, user, body) {
  const key = body.idempotency_key ? String(body.idempotency_key).slice(0, 80) : null;
  if (key) {
    const existing = S.db.get("SELECT * FROM posts WHERE author_id = ? AND idempotency_key = ?", user.id, key);
    if (existing) return existing;
  }
  S.limiter.take("post", user.id);
  const caption = String(body.caption ?? "").trim();
  if (caption.length > 2200) throw bad("caption_too_long", "Captions can be up to 2,200 characters.");
  const mediaIds = Array.isArray(body.media_ids) ? body.media_ids.slice(0, 11) : [];
  if (mediaIds.length > 10) throw bad("too_many_media", "Add up to 10 photos or videos.");
  const media = ownedMedia(S, user.id, mediaIds, ["image", "video"]);
  if (new Set(mediaIds).size !== mediaIds.length) throw bad("duplicate_media", "Each photo or video can be added once.");
  let type;
  let shared = null;
  if (body.shared_post_id) {
    shared = loadPost(S, String(body.shared_post_id), user.id);
    if (shared.shared_post_id) shared = loadPost(S, shared.shared_post_id, user.id);   // share the original
    if (media.length) throw bad("share_with_media", "Shared posts can’t add media.");
    type = "share";
  } else if (body.type === "reel") {
    if (media.length !== 1 || media[0].kind !== "video") throw bad("reel_needs_video", "A reel is one vertical video.");
    type = "reel";
  } else if (!media.length) {
    if (!caption) throw bad("empty_post", "Write something or add a photo or video.");
    type = "text";
  } else type = media.length > 1 ? "carousel" : media[0].kind === "video" ? "video" : "image";
  const visibility = body.visibility === "followers" ? "followers" : "public";
  const alts = Array.isArray(body.alts) ? body.alts : [];
  if (type === "text") {
    const dup = S.db.get("SELECT 1 FROM posts WHERE author_id = ? AND caption = ? AND created_at > ? AND status = 'active'", user.id, caption, S.now() - 60_000);
    if (dup) throw new HttpError(409, "duplicate_post", "You just posted that.");
  }
  const pid = id("p");
  const now = S.now();
  S.db.tx(() => {
    S.db.run(`INSERT INTO posts (id, author_id, type, caption, shared_post_id, audio_title, visibility, allow_tips, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      pid, user.id, type, caption, shared?.id ?? null, body.audio_title ? String(body.audio_title).slice(0, 80) : null, visibility, body.allow_tips === false ? 0 : 1, key, now);
    media.forEach((m, i) => S.db.run("INSERT INTO post_media (post_id, media_id, position, alt) VALUES (?,?,?,?)", pid, m.id, i, String(alts[i] ?? "").slice(0, 300)));
    upsertHashtags(S, pid, parseHashtags(caption), now);
    recordMentions(S, { sourceType: "post", sourceId: pid, authorId: user.id, text: caption });
    for (const tid of (Array.isArray(body.tagged_user_ids) ? body.tagged_user_ids : []).slice(0, 20)) {
      const t = getUser(S, String(tid));
      if (!t || t.id === user.id || !audienceAllows(S, privacyOf(S, t.id).tags, t.id, user.id)) continue;
      if (S.db.run("INSERT OR IGNORE INTO post_tags (post_id, user_id) VALUES (?,?)", pid, t.id).changes) notify(S, { userId: t.id, type: "tag", actorId: user.id, targetType: "post", targetId: pid });
    }
    if (shared) {
      S.db.run("INSERT INTO shares (id, user_id, post_id, channel, created_at) VALUES (?,?,?,?,?)", id("sh"), user.id, shared.id, "repost", now);
      S.db.run("UPDATE posts SET share_count = share_count + 1 WHERE id = ?", shared.id);
    }
  });
  return S.db.get("SELECT * FROM posts WHERE id = ?", pid);
}

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const dec = (s) => { try { return s ? JSON.parse(Buffer.from(String(s), "base64url").toString()) : null; } catch { throw bad("invalid_cursor", "Invalid cursor."); } };

function commentOut(S, rows, viewerId, postAuthorId) {
  const authors = cardsById(S, rows.map((c) => c.author_id));
  const liked = new Set(rows.length ? S.db.all(`SELECT target_id FROM reactions WHERE user_id = ? AND target_type = 'comment' AND target_id IN (${rows.map(() => "?").join(",")})`, viewerId, ...rows.map((c) => c.id)).map((r) => r.target_id) : []);
  return rows.map((c) => ({
    id: c.id, post_id: c.post_id, parent_id: c.parent_id, author: authors[c.author_id], body: c.status === "deleted" ? "" : c.body, status: c.status,
    like_count: c.like_count, reply_count: c.reply_count, created_at: c.created_at, liked: liked.has(c.id),
    can_delete: c.author_id === viewerId || postAuthorId === viewerId, restricted: c.status === "restricted",
  }));
}

export function register(r, S) {
  r.post("/api/posts", ({ user, body }) => {
    const p = createPost(S, user, body);
    return { post: serializePosts(S, [p], user.id)[0] };
  });

  r.get("/api/posts/:id", ({ params, user }) => ({ post: serializePosts(S, [loadPost(S, params.id, user.id)], user.id)[0] }));

  r.patch("/api/posts/:id", ({ params, user, body }) => {
    const p = S.db.get("SELECT * FROM posts WHERE id = ? AND status = 'active'", params.id);
    if (!p) throw notFound("Post not found.");
    if (p.author_id !== user.id) throw forbidden("not_author", "Only the author can edit this post.");
    const caption = String(body.caption ?? p.caption).trim();
    if (caption.length > 2200) throw bad("caption_too_long", "Captions can be up to 2,200 characters.");
    if (p.type === "text" && !caption) throw bad("empty_post", "A text post needs text.");
    S.db.tx(() => {
      S.db.run("UPDATE posts SET caption = ?, edited_at = ?, visibility = COALESCE(?, visibility) WHERE id = ?", caption, S.now(), ["public", "followers"].includes(body.visibility) ? body.visibility : null, p.id);
      dropHashtags(S, p.id);
      upsertHashtags(S, p.id, parseHashtags(caption), S.now());
      recordMentions(S, { sourceType: "post", sourceId: p.id, authorId: user.id, text: caption });
      if (Array.isArray(body.alts)) body.alts.forEach((a, i) => S.db.run("UPDATE post_media SET alt = ? WHERE post_id = ? AND position = ?", String(a ?? "").slice(0, 300), p.id, i));
    });
    return { post: serializePosts(S, [S.db.get("SELECT * FROM posts WHERE id = ?", p.id)], user.id)[0] };
  });

  r.delete("/api/posts/:id", ({ params, user }) => {
    const p = S.db.get("SELECT * FROM posts WHERE id = ? AND status = 'active'", params.id);
    if (!p) throw notFound("Post not found.");
    if (p.author_id !== user.id) throw forbidden("not_author", "Only the author can delete this post.");
    S.db.tx(() => {
      S.db.run("UPDATE posts SET status = 'deleted' WHERE id = ?", p.id);
      dropHashtags(S, p.id);
      if (p.shared_post_id) S.db.run("UPDATE posts SET share_count = MAX(share_count - 1, 0) WHERE id = ?", p.shared_post_id);
    });
    return { ok: true };
  });

  r.post("/api/posts/:id/react", ({ params, user, body }) => {
    S.limiter.take("react", user.id);
    const kind = body.kind ?? "like";
    if (!REACTIONS.includes(kind)) throw bad("invalid_reaction", "Unknown reaction.");
    return S.db.tx(() => {
      const p = loadPost(S, params.id, user.id);
      const had = S.db.get("SELECT kind FROM reactions WHERE user_id = ? AND target_type = 'post' AND target_id = ?", user.id, p.id);
      if (had) S.db.run("UPDATE reactions SET kind = ? WHERE user_id = ? AND target_type = 'post' AND target_id = ?", kind, user.id, p.id);
      else {
        S.db.run("INSERT INTO reactions (user_id, target_type, target_id, kind, created_at) VALUES (?,?,?,?,?)", user.id, "post", p.id, kind, S.now());
        S.db.run("UPDATE posts SET like_count = like_count + 1 WHERE id = ?", p.id);
        notify(S, { userId: p.author_id, type: "like", actorId: user.id, targetType: "post", targetId: p.id, data: { reaction: kind, post_type: p.type } });
      }
      return { reaction: kind, likes: S.db.get("SELECT like_count FROM posts WHERE id = ?", p.id).like_count };
    });
  });
  r.delete("/api/posts/:id/react", ({ params, user }) => S.db.tx(() => {
    const p = loadPost(S, params.id, user.id);
    if (S.db.run("DELETE FROM reactions WHERE user_id = ? AND target_type = 'post' AND target_id = ?", user.id, p.id).changes) S.db.run("UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?", p.id);
    return { reaction: null, likes: S.db.get("SELECT like_count FROM posts WHERE id = ?", p.id).like_count };
  }));
  r.get("/api/posts/:id/reactions", ({ params, user, query }) => {
    const p = loadPost(S, params.id, user.id);
    const pv = privacyOf(S, p.author_id);
    if (!pv.show_like_counts && p.author_id !== user.id) return { items: [], hidden: true };
    const c = dec(query.cursor);
    const rows = S.db.all(`SELECT user_id, kind, created_at FROM reactions WHERE target_type = 'post' AND target_id = ? ${c ? "AND created_at < ?" : ""} ORDER BY created_at DESC LIMIT 51`, p.id, ...(c ? [c.t] : []));
    const cards = cardsById(S, rows.map((x) => x.user_id));
    return { items: rows.slice(0, 50).map((x) => ({ user: cards[x.user_id], kind: x.kind })), next_cursor: rows.length > 50 ? enc({ t: rows[49].created_at }) : null };
  });

  r.post("/api/posts/:id/save", ({ params, user }) => S.db.tx(() => {
    const p = loadPost(S, params.id, user.id);
    if (S.db.run("INSERT OR IGNORE INTO saves (user_id, post_id, created_at) VALUES (?,?,?)", user.id, p.id, S.now()).changes) S.db.run("UPDATE posts SET save_count = save_count + 1 WHERE id = ?", p.id);
    return { saved: true };
  }));
  r.delete("/api/posts/:id/save", ({ params, user }) => S.db.tx(() => {
    if (S.db.run("DELETE FROM saves WHERE user_id = ? AND post_id = ?", user.id, params.id).changes) S.db.run("UPDATE posts SET save_count = MAX(save_count - 1, 0) WHERE id = ?", params.id);
    return { saved: false };
  }));

  r.post("/api/posts/:id/share", ({ params, user, body }) => S.db.tx(() => {
    const p = loadPost(S, params.id, user.id);
    const channel = ["link", "message"].includes(body.channel) ? body.channel : "link";
    // One counted share per person, post and channel per day
    const recent = S.db.get("SELECT 1 FROM shares WHERE user_id = ? AND post_id = ? AND channel = ? AND created_at > ?", user.id, p.id, channel, S.now() - 864e5);
    if (!recent) {
      S.db.run("INSERT INTO shares (id, user_id, post_id, channel, created_at) VALUES (?,?,?,?,?)", id("sh"), user.id, p.id, channel, S.now());
      S.db.run("UPDATE posts SET share_count = share_count + 1 WHERE id = ?", p.id);
    }
    return { shares: S.db.get("SELECT share_count FROM posts WHERE id = ?", p.id).share_count, url: `/#/social/p/${p.id}` };
  }));

  r.post("/api/posts/:id/hide", ({ params, user }) => {
    loadPost(S, params.id, user.id);
    S.db.run("INSERT OR IGNORE INTO hidden_posts (user_id, post_id, created_at) VALUES (?,?,?)", user.id, params.id, S.now());
    return { hidden: true };
  });
  r.delete("/api/posts/:id/hide", ({ params, user }) => { S.db.run("DELETE FROM hidden_posts WHERE user_id = ? AND post_id = ?", user.id, params.id); return { hidden: false }; });

  r.post("/api/posts/:id/view", ({ params, user, body }) => {
    const p = loadPost(S, params.id, user.id);
    const watch = Math.max(0, Math.min(Number(body.watch_ms) || 0, 3 * 3600_000));
    // A view counts once per viewer per 30 minutes. Watch time is always recorded (for averages).
    const recent = S.db.get("SELECT id FROM view_events WHERE viewer_id = ? AND target_type IN ('post','reel') AND target_id = ? AND created_at > ? ORDER BY id DESC LIMIT 1", user.id, p.id, S.now() - 30 * 60_000);
    S.db.tx(() => {
      if (recent) { if (watch) S.db.run("UPDATE view_events SET watch_ms = MAX(watch_ms, ?) WHERE id = ?", watch, recent.id); return; }
      S.db.run("INSERT INTO view_events (id, viewer_id, owner_id, target_type, target_id, watch_ms, created_at) VALUES (?,?,?,?,?,?,?)", id("v"), user.id, p.author_id, p.type === "reel" ? "reel" : "post", p.id, watch, S.now());
      if (p.author_id !== user.id) S.db.run("UPDATE posts SET view_count = view_count + 1 WHERE id = ?", p.id);
    });
    return { ok: true };
  });

  // ---------- Comments ----------
  r.get("/api/posts/:id/comments", ({ params, user, query }) => {
    const p = loadPost(S, params.id, user.id);
    const parent = query.parent_id ? String(query.parent_id) : null;
    const limit = parent ? 20 : 20;
    const rows = S.db.all(`SELECT c.* FROM comments c JOIN users a ON a.id = c.author_id
      WHERE c.post_id = :post AND ${parent ? "c.parent_id = :parent" : "c.parent_id IS NULL"} ${query.cursor ? "AND c.id > :cursor" : ""}
        AND a.status = 'active'
        AND (c.status = 'visible' OR (c.status = 'deleted' AND c.reply_count > 0) OR (c.status = 'restricted' AND (c.author_id = :viewer OR :author = :viewer)))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :viewer AND b.blocked_id = c.author_id) OR (b.blocker_id = c.author_id AND b.blocked_id = :viewer))
      ORDER BY c.id ASC LIMIT :limit`, { post: p.id, parent, cursor: query.cursor ? String(query.cursor) : null, viewer: user.id, author: p.author_id, limit: limit + 1 });
    const page = rows.slice(0, limit);
    return { items: commentOut(S, page, user.id, p.author_id), next_cursor: rows.length > limit ? page.at(-1).id : null };
  });

  r.post("/api/posts/:id/comments", ({ params, user, body }) => {
    S.limiter.take("comment", user.id);
    const text = String(body.body ?? "").trim();
    if (!text) throw bad("empty_comment", "Write a comment first.");
    if (text.length > 1000) throw bad("comment_too_long", "Comments can be up to 1,000 characters.");
    const out = S.db.tx(() => {
      const p = loadPost(S, params.id, user.id);
      const pv = privacyOf(S, p.author_id);
      if (p.author_id !== user.id) {
        if (pv.comments === "off") throw forbidden("comments_off", "Comments are turned off for this post.");
        if (pv.comments === "followers" && !S.db.get("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ? AND status = 'active'", user.id, p.author_id)) throw forbidden("comments_followers", "Only followers can comment on this post.");
      }
      if (S.db.get("SELECT 1 FROM comments WHERE author_id = ? AND post_id = ? AND body = ? AND created_at > ?", user.id, p.id, text, S.now() - 30_000)) throw new HttpError(409, "duplicate_comment", "You just posted that comment.");
      // New accounts can't drop links in comments (a common spam pattern)
      if (/https?:\/\//i.test(text) && S.now() - user.created_at < 24 * 3600_000) throw forbidden("links_blocked", "New accounts can’t post links in comments yet.");
      let parent = null;
      if (body.parent_id) {
        parent = S.db.get("SELECT * FROM comments WHERE id = ? AND post_id = ?", String(body.parent_id), p.id);
        if (!parent || parent.status === "removed") throw notFound("That comment isn’t available.");
        if (parent.parent_id) parent = S.db.get("SELECT * FROM comments WHERE id = ?", parent.parent_id);   // one level of threading
      }
      const restricted = !!S.db.get("SELECT 1 FROM restricts WHERE user_id = ? AND restricted_id = ?", p.author_id, user.id);
      const cid = id("cm");
      S.db.run("INSERT INTO comments (id, post_id, author_id, parent_id, body, status, created_at) VALUES (?,?,?,?,?,?,?)", cid, p.id, user.id, parent?.id ?? null, text, restricted ? "restricted" : "visible", S.now());
      if (!restricted) {
        S.db.run("UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?", p.id);
        if (parent) S.db.run("UPDATE comments SET reply_count = reply_count + 1 WHERE id = ?", parent.id);
        notify(S, { userId: p.author_id, type: "comment", actorId: user.id, targetType: "post", targetId: p.id, data: { comment_id: cid, excerpt: text.slice(0, 120) } });
        if (parent && parent.author_id !== p.author_id) notify(S, { userId: parent.author_id, type: "reply", actorId: user.id, targetType: "post", targetId: p.id, data: { comment_id: cid, excerpt: text.slice(0, 120) } });
        recordMentions(S, { sourceType: "comment", sourceId: cid, authorId: user.id, text, targetType: "post", targetId: p.id });
      }
      return { c: S.db.get("SELECT * FROM comments WHERE id = ?", cid), p };
    });
    return { comment: commentOut(S, [out.c], user.id, out.p.author_id)[0] };
  });

  r.delete("/api/comments/:id", ({ params, user }) => S.db.tx(() => {
    const c = S.db.get("SELECT c.*, p.author_id AS post_author FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?", params.id);
    if (!c || c.status === "deleted" || c.status === "removed") throw notFound("Comment not found.");
    if (c.author_id !== user.id && c.post_author !== user.id) throw forbidden("not_allowed", "You can’t delete this comment.");
    S.db.run("UPDATE comments SET status = 'deleted' WHERE id = ?", c.id);
    if (c.status === "visible") {
      S.db.run("UPDATE posts SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?", c.post_id);
      if (c.parent_id) S.db.run("UPDATE comments SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?", c.parent_id);
    }
    return { ok: true };
  }));

  r.post("/api/comments/:id/react", ({ params, user }) => S.db.tx(() => {
    S.limiter.take("react", user.id);
    const c = S.db.get("SELECT * FROM comments WHERE id = ? AND status = 'visible'", params.id);
    if (!c) throw notFound("Comment not found.");
    loadPost(S, c.post_id, user.id);
    if (S.db.run("INSERT OR IGNORE INTO reactions (user_id, target_type, target_id, kind, created_at) VALUES (?,?,?,?,?)", user.id, "comment", c.id, "like", S.now()).changes) {
      S.db.run("UPDATE comments SET like_count = like_count + 1 WHERE id = ?", c.id);
      notify(S, { userId: c.author_id, type: "comment_like", actorId: user.id, targetType: "post", targetId: c.post_id, data: { comment_id: c.id, excerpt: c.body.slice(0, 80) } });
    }
    return { liked: true, like_count: S.db.get("SELECT like_count FROM comments WHERE id = ?", c.id).like_count };
  }));
  r.delete("/api/comments/:id/react", ({ params, user }) => S.db.tx(() => {
    if (S.db.run("DELETE FROM reactions WHERE user_id = ? AND target_type = 'comment' AND target_id = ?", user.id, params.id).changes) S.db.run("UPDATE comments SET like_count = MAX(like_count - 1, 0) WHERE id = ?", params.id);
    return { liked: false, like_count: S.db.get("SELECT like_count FROM comments WHERE id = ?", params.id)?.like_count ?? 0 };
  }));

  // ---------- Profile grids ----------
  r.get("/api/users/:ref/posts", ({ params, user, query }) => {
    const owner = params.ref.startsWith("u_") ? getUser(S, params.ref) : findByUsername(S, params.ref);
    if (!owner || !canSeeContent(S, user.id, owner)) throw forbidden("private", "This account’s posts are private.");
    const tab = query.tab ?? "posts";
    const limit = 18;
    let where;
    if (tab === "reels") where = "p.author_id = :owner AND p.type = 'reel'";
    else if (tab === "tagged") where = "EXISTS (SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND t.user_id = :owner)";
    else if (tab === "saved") { if (owner.id !== user.id) throw forbidden("private", "Saved posts are private."); where = "EXISTS (SELECT 1 FROM saves s WHERE s.post_id = p.id AND s.user_id = :owner)"; }
    else where = "p.author_id = :owner AND p.type <> 'reel'";
    const rows = S.db.all(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id WHERE ${where} AND ${VISIBLE_SQL} ${query.cursor ? "AND p.id < :cursor" : ""} ORDER BY p.id DESC LIMIT :limit`,
      { owner: owner.id, viewer: user.id, cursor: query.cursor ? String(query.cursor) : null, limit: limit + 1 });
    const page = rows.slice(0, limit);
    return { items: serializePosts(S, page, user.id), next_cursor: rows.length > limit ? page.at(-1).id : null };
  });
}

export { json };
