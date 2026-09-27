// Feeds. Chronological tabs page with keyset cursors on the time-sortable post id.
// Ranked tabs (For You, Trending, Reels) score a bounded candidate set. The cursor carries the ranking
// timestamp plus the last (score, id), so later pages continue the same ranking with no duplicates.
import { bad } from "../lib/http.js";
import { VISIBLE_SQL, DISCOVERY_SQL, serializePosts } from "./posts.js";
import { liveCards } from "./live.js";

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const dec = (s) => { try { return s ? JSON.parse(Buffer.from(String(s), "base64url").toString()) : null; } catch { throw bad("invalid_cursor", "Invalid cursor."); } };
const PAGE = 10;

function interestProfile(S, viewerId, since) {
  // Authors and hashtags the viewer engaged with recently (reactions, comments, saves)
  const authors = new Map(S.db.all(`SELECT p.author_id a, COUNT(*) n FROM reactions r JOIN posts p ON p.id = r.target_id
      WHERE r.user_id = ? AND r.target_type = 'post' AND r.created_at > ? GROUP BY p.author_id
    UNION ALL SELECT p.author_id, COUNT(*) * 2 FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.author_id = ? AND c.created_at > ? GROUP BY p.author_id`,
  viewerId, since, viewerId, since).map((r) => [r.a, r.n]));
  const tags = new Map(S.db.all(`SELECT ph.tag t, COUNT(*) n FROM post_hashtags ph WHERE ph.post_id IN (
      SELECT target_id FROM reactions WHERE user_id = ? AND target_type = 'post' AND created_at > ?
      UNION SELECT post_id FROM saves WHERE user_id = ? AND created_at > ?) GROUP BY ph.tag ORDER BY n DESC LIMIT 25`, viewerId, since, viewerId, since).map((r) => [r.t, r.n]));
  return { authors, tags };
}

function rank(S, viewerId, { reelsOnly = false, trending = false, cursor, limit = PAGE, excludeOwn = true }) {
  const c = dec(cursor);
  const t = c?.t ?? S.now();
  const since = t - (trending ? 3 : 21) * 864e5;
  const rows = S.db.all(`SELECT p.*, EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = p.author_id AND f.status = 'active') AS followed,
        EXISTS (SELECT 1 FROM view_events v WHERE v.viewer_id = :viewer AND v.target_id = p.id) AS seen
      FROM posts p JOIN users a ON a.id = p.author_id
      WHERE ${VISIBLE_SQL} AND ${DISCOVERY_SQL} AND p.created_at > :since AND p.created_at <= :t
        ${reelsOnly ? "AND p.type = 'reel'" : ""} ${excludeOwn ? "AND p.author_id <> :viewer" : ""} ${trending ? "AND a.is_private = 0" : ""}
      ORDER BY p.id DESC LIMIT 600`, { viewer: viewerId, since, t });
  const { authors, tags } = trending ? { authors: new Map(), tags: new Map() } : interestProfile(S, viewerId, t - 30 * 864e5);
  const postTags = new Map();
  if (tags.size && rows.length) {
    for (const r of S.db.all(`SELECT post_id, tag FROM post_hashtags WHERE post_id IN (${rows.map(() => "?").join(",")})`, ...rows.map((p) => p.id))) {
      if (!postTags.has(r.post_id)) postTags.set(r.post_id, []);
      postTags.get(r.post_id).push(r.tag);
    }
  }
  const scored = rows.map((p) => {
    const ageH = Math.max(0, (t - p.created_at) / 3600_000);
    const engagement = 1 + p.like_count + 3 * p.comment_count + 4 * p.share_count + 3 * p.save_count + 0.02 * p.view_count;
    let s = engagement / Math.pow(ageH + 2, trending ? 1.1 : 1.35);
    if (!trending) {
      if (p.followed) s *= 1.6;
      s *= 1 + Math.min(authors.get(p.author_id) ?? 0, 10) * 0.08;
      const matches = (postTags.get(p.id) ?? []).reduce((n, tg) => n + (tags.has(tg) ? 1 : 0), 0);
      s *= 1 + Math.min(matches, 4) * 0.15;
      if (p.seen) s *= 0.35;
      if (p.type === "reel" || p.type === "video") s *= 1.1;
    }
    return { p, s: Math.round(s * 1e6) / 1e6 };
  }).sort((a, b) => b.s - a.s || (a.p.id < b.p.id ? 1 : -1));
  const after = c ? scored.filter((x) => x.s < c.s || (x.s === c.s && x.p.id < c.id)) : scored;
  const page = after.slice(0, limit);
  return { rows: page.map((x) => x.p), next_cursor: after.length > limit ? enc({ t, s: page.at(-1).s, id: page.at(-1).p.id }) : null };
}

function chronological(S, viewerId, { following, cursor, limit = PAGE }) {
  const rows = S.db.all(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id
    WHERE ${VISIBLE_SQL} AND ${DISCOVERY_SQL}
      ${following ? "AND (p.author_id = :viewer OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = p.author_id AND f.status = 'active'))" : "AND a.is_private = 0 AND p.visibility = 'public'"}
      ${cursor ? "AND p.id < :cursor" : ""}
    ORDER BY p.id DESC LIMIT :limit`, { viewer: viewerId, cursor: cursor ? String(cursor) : null, limit: limit + 1 });
  const page = rows.slice(0, limit);
  return { rows: page, next_cursor: rows.length > limit ? page.at(-1).id : null };
}

export function register(r, S) {
  // Public showcase for the platform home page: posters of popular reels from public accounts only
  r.get("/api/public/highlights", () => ({
    items: S.db.all(`SELECT m.poster_key FROM posts p JOIN users a ON a.id = p.author_id JOIN post_media pm ON pm.post_id = p.id AND pm.position = 0 JOIN media m ON m.id = pm.media_id
      WHERE p.type = 'reel' AND p.status = 'active' AND p.visibility = 'public' AND a.is_private = 0 AND a.status = 'active' AND m.poster_key IS NOT NULL
      ORDER BY (p.like_count + p.view_count / 20) DESC LIMIT 3`).map((x) => ({ poster_url: S.mediaUrl(x.poster_key) })),
  }), { public: true });

  r.get("/api/feed", ({ user, query }) => {
    const tab = query.tab ?? "for_you";
    let res;
    if (tab === "for_you") res = rank(S, user.id, { cursor: query.cursor });
    else if (tab === "trending") res = rank(S, user.id, { cursor: query.cursor, trending: true, excludeOwn: false });
    else if (tab === "following") res = chronological(S, user.id, { following: true, cursor: query.cursor });
    else if (tab === "latest") res = chronological(S, user.id, { following: false, cursor: query.cursor });
    else throw bad("invalid_tab", "Unknown feed tab.");
    return {
      tab, items: serializePosts(S, res.rows, user.id), next_cursor: res.next_cursor,
      // Live streams surface at the top of the first page of the personal feeds
      live: !query.cursor && (tab === "for_you" || tab === "following") ? liveCards(S, user.id, { followingOnly: tab === "following", limit: 6 }) : undefined,
    };
  });

  r.get("/api/reels", ({ user, query }) => {
    const res = rank(S, user.id, { reelsOnly: true, cursor: query.cursor, limit: 6 });
    let rows = res.rows;
    // Deep link: put the requested reel first
    if (query.start && !query.cursor) {
      const first = S.db.all(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id WHERE p.id = :id AND p.type = 'reel' AND ${VISIBLE_SQL}`, { id: String(query.start), viewer: user.id });
      rows = [...first, ...rows.filter((p) => p.id !== query.start)];
    }
    // Always offer something to watch: when the ranked pool runs dry, fall back to the viewer's own reels
    if (!rows.length && !query.cursor) rows = S.db.all(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id WHERE p.type = 'reel' AND ${VISIBLE_SQL} ORDER BY p.id DESC LIMIT 6`, { viewer: user.id });
    return { items: serializePosts(S, rows, user.id), next_cursor: res.next_cursor };
  });
}
