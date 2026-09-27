// Stories: disappear after the configured lifetime (STORY_LIFETIME_MS, default 24h). The audience is
// enforced server-side (public / followers / close friends) on top of account privacy and blocks.
import { id } from "../lib/ids.js";
import { bad, forbidden, notFound } from "../lib/http.js";
import { json } from "../lib/db.js";
import { cardsById, getUser, privacyOf, isBlockedEither } from "./users.js";
import { mediaOut, ownedMedia } from "./media.js";
import { notify } from "./notifications.js";
import { recordMentions, parseHashtags, REACTIONS } from "./posts.js";
import { sendDirect } from "./messages.js";

const STICKERS = ["mention", "hashtag", "emoji", "link", "music", "text", "question"];

/** SQL: stories `s` by authors `a` that :viewer may see right now. */
const VISIBLE = `s.status = 'active' AND s.expires_at > :now AND a.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :viewer AND b.blocked_id = s.author_id) OR (b.blocker_id = s.author_id AND b.blocked_id = :viewer))
  AND (s.author_id = :viewer
    OR (s.audience = 'public' AND a.is_private = 0)
    OR (s.audience IN ('public','followers') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = s.author_id AND f.status = 'active'))
    OR (s.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends c WHERE c.user_id = s.author_id AND c.friend_id = :viewer)))`;

function loadVisible(S, sid, viewerId) {
  const s = S.db.get(`SELECT s.* FROM stories s JOIN users a ON a.id = s.author_id WHERE s.id = :id AND ${VISIBLE}`, { id: sid, viewer: viewerId, now: S.now() });
  if (!s) throw notFound("This story is no longer available.");
  return s;
}

function storyOut(S, rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map((s) => s.id);
  const ph = ids.map(() => "?").join(",");
  const media = Object.fromEntries(S.db.all(`SELECT * FROM media WHERE id IN (${rows.map(() => "?").join(",")})`, ...rows.map((s) => s.media_id ?? "")).map((m) => [m.id, m]));
  const seen = new Set(S.db.all(`SELECT story_id FROM story_views WHERE viewer_id = ? AND story_id IN (${ph})`, viewerId, ...ids).map((r) => r.story_id));
  const reacted = Object.fromEntries(S.db.all(`SELECT target_id, kind FROM reactions WHERE user_id = ? AND target_type = 'story' AND target_id IN (${ph})`, viewerId, ...ids).map((r) => [r.target_id, r.kind]));
  const authors = cardsById(S, rows.map((s) => s.author_id));
  return rows.map((s) => {
    const own = s.author_id === viewerId;
    const stats = own ? S.db.get(`SELECT (SELECT COUNT(*) FROM story_views WHERE story_id = ?1) AS unique_viewers, (SELECT COALESCE(SUM(view_count),0) FROM story_views WHERE story_id = ?1) AS views,
        (SELECT COUNT(*) FROM reactions WHERE target_type = 'story' AND target_id = ?1) AS reactions,
        (SELECT COUNT(*) FROM messages WHERE kind = 'story_reply' AND json_extract(ref, '$.story_id') = ?1) AS replies`, s.id) : null;
    return {
      id: s.id, author: authors[s.author_id], media: mediaOut(S, media[s.media_id]), content: json(s.content, {}), link_url: s.link_url, audio_title: s.audio_title,
      audience: own ? s.audience : undefined, created_at: s.created_at, expires_at: s.expires_at, seen: seen.has(s.id), reaction: reacted[s.id] ?? null, is_author: own, stats,
      can_reply: !own && privacyOf(S, s.author_id).messages !== "nobody",
    };
  });
}

export function register(r, S) {
  r.get("/api/stories/tray", ({ user }) => {
    const rows = S.db.all(`SELECT s.author_id, COUNT(*) AS n, MAX(s.created_at) AS latest,
        SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = :viewer) THEN 1 ELSE 0 END) AS unseen,
        MAX(CASE WHEN s.audience = 'close_friends' THEN 1 ELSE 0 END) AS cf
      FROM stories s JOIN users a ON a.id = s.author_id
      WHERE ${VISIBLE} AND (s.author_id = :viewer OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = s.author_id AND f.status = 'active'))
        AND NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = :viewer AND m.muted_id = s.author_id)
      GROUP BY s.author_id`, { viewer: user.id, now: S.now() });
    const cards = cardsById(S, rows.map((x) => x.author_id));
    rows.sort((a, b) => Number(b.author_id === user.id) - Number(a.author_id === user.id) || Number(b.unseen > 0) - Number(a.unseen > 0) || b.latest - a.latest);
    return { items: rows.map((x) => ({ user: cards[x.author_id], count: x.n, unseen: x.unseen, latest_at: x.latest, close_friends: !!x.cf, is_self: x.author_id === user.id })) };
  });

  r.get("/api/stories/user/:id", ({ params, user }) => {
    const owner = getUser(S, params.id);
    if (!owner || isBlockedEither(S, user.id, owner.id)) throw notFound("No stories.");
    const rows = S.db.all(`SELECT s.* FROM stories s JOIN users a ON a.id = s.author_id WHERE s.author_id = :owner AND ${VISIBLE} ORDER BY s.created_at ASC`, { owner: owner.id, viewer: user.id, now: S.now() });
    return { items: storyOut(S, rows, user.id) };
  });

  r.post("/api/stories", ({ user, body }) => {
    S.limiter.take("post", user.id);
    const content = body.content && typeof body.content === "object" ? body.content : {};
    const text = String(content.text ?? "").slice(0, 300);
    const media = body.media_id ? ownedMedia(S, user.id, [body.media_id], ["image", "video"])[0] : null;
    if (!media && !text.trim()) throw bad("empty_story", "Add a photo, video or some text.");
    const stickers = (Array.isArray(content.stickers) ? content.stickers : []).slice(0, 10).map((st) => {
      if (!STICKERS.includes(st.type)) throw bad("invalid_sticker", "Unknown sticker type.");
      return { type: st.type, value: String(st.value ?? "").slice(0, 80), x: Math.max(0, Math.min(1, Number(st.x) || 0.5)), y: Math.max(0, Math.min(1, Number(st.y) || 0.5)) };
    });
    const link = body.link_url ? String(body.link_url).trim() : null;
    if (link && !/^https?:\/\/[^\s<>"]{3,300}$/i.test(link)) throw bad("invalid_link", "Links must start with http:// or https://");
    const audience = ["public", "followers", "close_friends"].includes(body.audience) ? body.audience : privacyOf(S, user.id).story_audience;
    const bg = /^#[0-9a-f]{6}$/i.test(content.bg ?? "") ? content.bg : null;
    const allText = [text, ...stickers.filter((s) => s.type === "mention" || s.type === "text").map((s) => (s.type === "mention" ? "@" + s.value.replace(/^@/, "") : s.value))].join(" ");
    const sid = id("st");
    const now = S.now();
    S.db.tx(() => {
      S.db.run(`INSERT INTO stories (id, author_id, media_id, content, link_url, audio_title, audience, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        sid, user.id, media?.id ?? null, JSON.stringify({ text, bg, stickers, hashtags: parseHashtags(allText + " " + stickers.filter((s) => s.type === "hashtag").map((s) => "#" + s.value.replace(/^#/, "")).join(" ")) }),
        link, body.audio_title ? String(body.audio_title).slice(0, 80) : null, audience, now, now + S.cfg.storyLifetimeMs);
      recordMentions(S, { sourceType: "story", sourceId: sid, authorId: user.id, text: allText, targetType: "story", targetId: sid });
    });
    return { story: storyOut(S, [S.db.get("SELECT * FROM stories WHERE id = ?", sid)], user.id)[0] };
  });

  r.post("/api/stories/:id/view", ({ params, user }) => {
    const s = loadVisible(S, params.id, user.id);
    if (s.author_id === user.id) return { ok: true };
    S.db.tx(() => {
      const fresh = S.db.run("INSERT OR IGNORE INTO story_views (story_id, viewer_id, viewed_at) VALUES (?,?,?)", s.id, user.id, S.now()).changes;
      if (!fresh) S.db.run("UPDATE story_views SET view_count = view_count + 1, viewed_at = ? WHERE story_id = ? AND viewer_id = ?", S.now(), s.id, user.id);
      else S.db.run("INSERT INTO view_events (id, viewer_id, owner_id, target_type, target_id, created_at) VALUES (?,?,?,?,?,?)", id("v"), user.id, s.author_id, "story", s.id, S.now());
    });
    return { ok: true };
  });

  r.post("/api/stories/:id/react", ({ params, user, body }) => {
    S.limiter.take("react", user.id);
    const kind = body.kind ?? "love";
    if (!REACTIONS.includes(kind)) throw bad("invalid_reaction", "Unknown reaction.");
    const s = loadVisible(S, params.id, user.id);
    if (s.author_id === user.id) throw bad("own_story", "You can’t react to your own story.");
    const fresh = S.db.tx(() => {
      const had = S.db.get("SELECT 1 FROM reactions WHERE user_id = ? AND target_type = 'story' AND target_id = ?", user.id, s.id);
      S.db.run(`INSERT INTO reactions (user_id, target_type, target_id, kind, created_at) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET kind = excluded.kind`, user.id, "story", s.id, kind, S.now());
      return !had;
    });
    if (fresh) notify(S, { userId: s.author_id, type: "story_reaction", actorId: user.id, targetType: "story", targetId: s.id, data: { reaction: kind } });
    return { reaction: kind };
  });
  r.delete("/api/stories/:id/react", ({ params, user }) => { S.db.run("DELETE FROM reactions WHERE user_id = ? AND target_type = 'story' AND target_id = ?", user.id, params.id); return { reaction: null }; });

  r.post("/api/stories/:id/reply", ({ params, user, body }) => {
    const s = loadVisible(S, params.id, user.id);
    if (s.author_id === user.id) throw bad("own_story", "You can’t reply to your own story.");
    const text = String(body.body ?? "").trim();
    if (!text) throw bad("empty_reply", "Write a reply first.");
    const out = sendDirect(S, user, s.author_id, { kind: "story_reply", body: text, ref: { story_id: s.id }, client_id: body.client_id });
    notify(S, { userId: s.author_id, type: "story_reply", actorId: user.id, targetType: "conversation", targetId: out.conversation_id, data: { excerpt: text.slice(0, 120), story_id: s.id } });
    return out;
  });

  r.get("/api/stories/:id/viewers", ({ params, user }) => {
    const s = S.db.get("SELECT * FROM stories WHERE id = ?", params.id);
    if (!s) throw notFound("Story not found.");
    if (s.author_id !== user.id) throw forbidden("not_author", "Only the author can see who viewed a story.");
    const rows = S.db.all(`SELECT v.viewer_id, v.viewed_at, v.view_count, r.kind AS reaction FROM story_views v
      LEFT JOIN reactions r ON r.user_id = v.viewer_id AND r.target_type = 'story' AND r.target_id = v.story_id
      WHERE v.story_id = ? ORDER BY v.viewed_at DESC LIMIT 500`, s.id);
    const cards = cardsById(S, rows.map((x) => x.viewer_id));
    return { items: rows.map((x) => ({ user: cards[x.viewer_id], viewed_at: x.viewed_at, views: x.view_count, reaction: x.reaction })) };
  });

  r.delete("/api/stories/:id", ({ params, user }) => {
    const s = S.db.get("SELECT * FROM stories WHERE id = ? AND author_id = ?", params.id, user.id);
    if (!s) throw notFound("Story not found.");
    S.db.run("UPDATE stories SET status = 'deleted' WHERE id = ?", s.id);
    return { ok: true };
  });

  r.get("/api/me/stories/archive", ({ user }) => ({
    items: storyOut(S, S.db.all("SELECT * FROM stories WHERE author_id = ? AND status IN ('active','expired') ORDER BY created_at DESC LIMIT 60", user.id), user.id),
  }));
}

export function expireStories(S) {
  return S.db.run("UPDATE stories SET status = 'expired' WHERE status = 'active' AND expires_at <= ?", S.now()).changes;
}
export function jobs(S) { S.every(60_000, () => expireStories(S)); }
