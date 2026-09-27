// Search (SQLite FTS5 over users and captions) and Explore. Every result set runs through the same
// visibility rules as the feed, so private or blocked content never surfaces here.
import { bad } from "../lib/http.js";
import { VISIBLE_SQL, DISCOVERY_SQL, serializePosts } from "./posts.js";
import { userCard } from "./users.js";
import { liveCards } from "./live.js";

export const CATEGORIES = [
  { id: "production", label: "Production", tags: ["production", "beatmaking", "producer", "mixing", "sounddesign"] },
  { id: "dj", label: "DJ & club", tags: ["dj", "techno", "house", "club", "mix", "vinyl"] },
  { id: "vocals", label: "Vocals", tags: ["vocals", "singing", "topline", "songwriting"] },
  { id: "studio", label: "Studio life", tags: ["studio", "bts", "gear", "synth"] },
  { id: "dance", label: "Dance", tags: ["dance", "choreo", "amapiano"] },
  { id: "live", label: "Live sets", tags: ["liveset", "live", "gig", "festival"] },
];

/** Turn free text into a safe FTS5 prefix query: "lo fi" → "lo"* "fi"* */
export function ftsQuery(q) {
  const toks = String(q).toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [];
  return toks.slice(0, 6).map((t) => `"${t}"*`).join(" ");
}
const offCursor = (c) => { const n = c ? Number(Buffer.from(String(c), "base64url").toString()) : 0; if (!Number.isInteger(n) || n < 0 || n > 5000) throw bad("invalid_cursor", "Invalid cursor."); return n; };
const nextOff = (n) => Buffer.from(String(n)).toString("base64url");

function searchUsers(S, viewerId, q, off, limit) {
  const fts = ftsQuery(q.replace(/^@/, ""));
  if (!fts) return { items: [], next_cursor: null };
  const rows = S.db.all(`SELECT u.*, (SELECT storage_key FROM media WHERE id = u.avatar_media_id) AS avatar_key,
      (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id AND f.status = 'active') AS fc,
      EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = u.id AND f.status = 'active') AS following
    FROM users_fts JOIN users u ON u.rowid = users_fts.rowid
    WHERE users_fts MATCH :q AND u.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = :viewer)
    ORDER BY (lower(u.username) = lower(:raw)) DESC, following DESC, bm25(users_fts, 10.0, 5.0, 1.0) + -0.001 * fc ASC
    LIMIT :limit OFFSET :off`, { q: fts, raw: q.replace(/^@/, ""), viewer: viewerId, limit: limit + 1, off });
  return { items: rows.slice(0, limit).map((u) => ({ ...userCard(S, u), followers: u.fc, following: !!u.following, bio: u.bio.slice(0, 100) })), next_cursor: rows.length > limit ? nextOff(off + limit) : null };
}

function searchPosts(S, viewerId, q, off, limit, reels) {
  const tag = /^#[\p{L}\p{N}_]+$/u.test(q.trim()) ? q.trim().slice(1).toLowerCase() : null;
  const fts = tag ? null : ftsQuery(q);
  if (!tag && !fts) return { items: [], next_cursor: null };
  const rows = S.db.all(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id
    ${tag ? "JOIN post_hashtags ph ON ph.post_id = p.id AND ph.tag = :tag" : "JOIN posts_fts ON posts_fts.rowid = p.rowid AND posts_fts MATCH :q"}
    WHERE ${VISIBLE_SQL} AND ${DISCOVERY_SQL} AND p.type ${reels ? "= 'reel'" : "<> 'reel'"}
    ORDER BY (p.like_count + 3 * p.comment_count + 2 * p.share_count) DESC, p.id DESC LIMIT :limit OFFSET :off`, { tag, q: fts, viewer: viewerId, limit: limit + 1, off });
  return { items: serializePosts(S, rows.slice(0, limit), viewerId), next_cursor: rows.length > limit ? nextOff(off + limit) : null };
}

function searchTags(S, q, off, limit) {
  const t = q.replace(/^#/, "").toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
  if (!t) return { items: [], next_cursor: null };
  const rows = S.db.all("SELECT tag, post_count FROM hashtags WHERE tag LIKE ? ESCAPE '\\' AND post_count > 0 ORDER BY (tag = ?) DESC, post_count DESC LIMIT ? OFFSET ?", t.replace(/[%_\\]/g, "\\$&") + "%", t, limit + 1, off);
  return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? nextOff(off + limit) : null };
}

function searchLive(S, viewerId, q, limit) {
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  return { items: liveCards(S, viewerId, { limit, match: like, includeScheduled: true }), next_cursor: null };
}

export function register(r, S) {
  r.get("/api/search", ({ user, query }) => {
    S.limiter.take("search", user.id);
    const q = String(query.q ?? "").trim().slice(0, 100);
    const type = query.type ?? "all";
    if (!q) return { q, type, results: {} };
    const off = offCursor(query.cursor);
    if (type === "all") {
      return { q, type, results: {
        users: searchUsers(S, user.id, q, 0, 5), hashtags: searchTags(S, q, 0, 6),
        posts: searchPosts(S, user.id, q, 0, 6, false), reels: searchPosts(S, user.id, q, 0, 6, true), live: searchLive(S, user.id, q, 4),
      } };
    }
    const handlers = {
      users: () => searchUsers(S, user.id, q, off, 20), posts: () => searchPosts(S, user.id, q, off, 18, false), reels: () => searchPosts(S, user.id, q, off, 18, true),
      hashtags: () => searchTags(S, q, off, 30), live: () => searchLive(S, user.id, q, 20),
    };
    if (!handlers[type]) throw bad("invalid_type", "Unknown search type.");
    return { q, type, results: { [type]: handlers[type]() } };
  });

  r.get("/api/search/suggest", ({ user, query }) => {
    S.limiter.take("search", user.id);
    const q = String(query.q ?? "").trim().slice(0, 60);
    if (!q) return { users: [], hashtags: [] };
    return { users: q.startsWith("#") ? [] : searchUsers(S, user.id, q, 0, 6).items, hashtags: searchTags(S, q, 0, q.startsWith("#") ? 8 : 3).items };
  });

  r.get("/api/search/history", ({ user }) => ({ items: S.db.all("SELECT query, created_at FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 12", user.id) }));
  r.post("/api/search/history", ({ user, body }) => {
    const q = String(body.query ?? "").trim().slice(0, 100);
    if (!q) throw bad("empty_query", "Nothing to save.");
    S.db.run(`INSERT INTO search_history (user_id, query, created_at) VALUES (?,?,?) ON CONFLICT(user_id, query) DO UPDATE SET created_at = excluded.created_at`, user.id, q, S.now());
    S.db.run("DELETE FROM search_history WHERE user_id = ? AND query NOT IN (SELECT query FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 30)", user.id, user.id);
    return { ok: true };
  });
  r.delete("/api/search/history", ({ user, query }) => {
    if (query.q) S.db.run("DELETE FROM search_history WHERE user_id = ? AND query = ?", user.id, String(query.q));
    else S.db.run("DELETE FROM search_history WHERE user_id = ?", user.id);
    return { ok: true };
  });

  r.get("/api/explore", ({ user, query }) => {
    const since = S.now() - 7 * 864e5;
    const cat = CATEGORIES.find((c) => c.id === query.category);
    const tagFilter = cat ? `AND EXISTS (SELECT 1 FROM post_hashtags ph WHERE ph.post_id = p.id AND ph.tag IN (${cat.tags.map((t) => `'${t}'`).join(",")}))` : "";
    const popular = (reels, limit) => S.db.all(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id
      WHERE ${VISIBLE_SQL} AND ${DISCOVERY_SQL} AND a.is_private = 0 AND p.visibility = 'public' AND p.author_id <> :viewer
        AND p.type ${reels ? "= 'reel'" : "IN ('image','carousel','video','text')"} AND p.created_at > :since ${tagFilter}
      ORDER BY (p.like_count + 3 * p.comment_count + 4 * p.share_count + 3 * p.save_count + 0.02 * p.view_count) DESC, p.id DESC LIMIT :limit`,
    { viewer: user.id, since: S.now() - 21 * 864e5, limit });
    const trending = S.db.all(`SELECT ph.tag, COUNT(*) AS recent, h.post_count FROM post_hashtags ph JOIN hashtags h ON h.tag = ph.tag
      JOIN posts p ON p.id = ph.post_id JOIN users a ON a.id = p.author_id
      WHERE ph.created_at > ? AND p.status = 'active' AND a.is_private = 0 AND p.visibility = 'public'
      GROUP BY ph.tag ORDER BY recent DESC, h.post_count DESC LIMIT 12`, since);
    const creators = S.db.all(`SELECT u.*, (SELECT storage_key FROM media WHERE id = u.avatar_media_id) AS avatar_key,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id AND f.status = 'active') AS fc
      FROM users u WHERE u.is_creator = 1 AND u.status = 'active' AND u.id <> :viewer AND u.is_private = 0
        AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = :viewer AND followee_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :viewer AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :viewer))
      ORDER BY fc DESC LIMIT 10`, { viewer: user.id });
    return {
      categories: CATEGORIES.map(({ id, label }) => ({ id, label })), category: cat?.id ?? null,
      trending_tags: trending.map((t) => ({ tag: t.tag, recent: t.recent, post_count: t.post_count })),
      creators: creators.map((u) => ({ ...userCard(S, u), followers: u.fc, bio: u.bio.slice(0, 90) })),
      reels: serializePosts(S, popular(true, 8), user.id),
      posts: serializePosts(S, popular(false, 24), user.id),
      live: liveCards(S, user.id, { limit: 8, includeScheduled: true }),
    };
  });

  r.get("/api/hashtags/:tag", ({ user, params, query }) => {
    const tag = params.tag.toLowerCase().replace(/^#/, "");
    const h = S.db.get("SELECT * FROM hashtags WHERE tag = ?", tag);
    const off = offCursor(query.cursor);
    const recent = query.sort === "recent";
    const rows = S.db.all(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id JOIN post_hashtags ph ON ph.post_id = p.id AND ph.tag = :tag
      WHERE ${VISIBLE_SQL} AND ${DISCOVERY_SQL}
      ORDER BY ${recent ? "p.id DESC" : "(p.like_count + 3 * p.comment_count + 4 * p.share_count) DESC, p.id DESC"} LIMIT :limit OFFSET :off`, { tag, viewer: user.id, limit: 19, off });
    return { tag, post_count: h?.post_count ?? 0, items: serializePosts(S, rows.slice(0, 18), user.id), next_cursor: rows.length > 18 ? nextOff(off + 18) : null };
  });
}
