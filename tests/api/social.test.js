import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { startServer, ikey } from "../helpers.js";
import { expireStories } from "../../server/modules/stories.js";

let T, nova, rafi, ella, priya, admin, mira, spam;
const uid = (n) => T.db.get("SELECT id FROM users WHERE username = ?", n).id;

before(async () => {
  T = await startServer();
  [nova, rafi, ella, priya, admin, mira, spam] = await Promise.all(["nova.keys", "rafi.listens", "ella.writes", "priya.plays", "tunibeat.team", "mira.kaan", "free.followers.99"].map((u) => T.as(u)));
});
after(() => T.close());

/* ---------------------------------------------------------------- auth ---- */
test("auth: signup validation, login, logout and session cookie", async () => {
  const c = T.client();
  assert.equal((await c.post("/api/auth/signup", { username: "x", email: "a@b.co", password: "long enough pw" })).data.error.code, "invalid_username");
  assert.equal((await c.post("/api/auth/signup", { username: "newbie", email: "nope", password: "long enough pw" })).data.error.code, "invalid_email");
  assert.equal((await c.post("/api/auth/signup", { username: "newbie", email: "n@b.co", password: "short" })).data.error.code, "weak_password");
  assert.equal((await c.post("/api/auth/signup", { username: "nova.keys", email: "n@b.co", password: "long enough pw" })).status, 409);
  const ok = await c.post("/api/auth/signup", { username: "newbie", email: "newbie@example.com", password: "long enough pw" });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("set-cookie"), /HttpOnly/);
  assert.match(ok.headers.get("set-cookie"), /SameSite=Lax/);
  assert.equal((await c.get("/api/me")).data.user.username, "newbie");
  await c.post("/api/auth/logout");
  assert.equal((await c.get("/api/me")).data.user, null);
  assert.equal((await c.post("/api/auth/login", { login: "newbie", password: "wrong password" })).status, 401);
  assert.equal((await c.post("/api/auth/login", { login: "NEWBIE@example.com", password: "long enough pw" })).status, 200);
  const db = T.db.get("SELECT password_hash FROM users WHERE username = 'newbie'");
  assert.match(db.password_hash, /^scrypt\$/);
});

test("security: CSRF header required for writes; unauthenticated requests refused", async () => {
  const r = await fetch(`${T.base}/api/posts`, { method: "POST", headers: { "content-type": "application/json", cookie: nova.cookie }, body: JSON.stringify({ caption: "csrf" }) });
  assert.equal(r.status, 403);
  assert.equal((await T.client().get("/api/feed")).status, 401);
  const html = await fetch(`${T.base}/`);
  assert.match(html.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await fetch(`${T.base}/server/app.js`)).status, 404, "server source is not served");
  assert.equal((await fetch(`${T.base}/package.json`)).status, 404);
  assert.equal((await fetch(`${T.base}/js/../server/config.js`)).status, 404);
});

test("suspended accounts lose their sessions", async () => {
  const c = T.client();
  await c.post("/api/auth/signup", { username: "rulebreaker", email: "rb@example.com", password: "long enough pw" });
  assert.equal((await c.get("/api/feed")).status, 200);
  await admin.post(`/api/admin/users/${uid("rulebreaker")}/status`, { status: "suspended", reason: "test" });
  assert.equal((await c.get("/api/feed")).status, 401);
  assert.equal((await c.post("/api/auth/login", { login: "rulebreaker", password: "long enough pw" })).status, 403);
});

/* ---------------------------------------------------------------- graph ---- */
test("follow: public follow is immediate, idempotent, counts stay exact under rapid toggling", async () => {
  const target = uid("sol.synth");
  const base = (await priya.get(`/api/users/sol.synth`)).data.counts.followers;
  const ops = [];
  for (let i = 0; i < 20; i++) ops.push(i % 2 ? priya.del(`/api/users/${target}/follow`) : priya.post(`/api/users/${target}/follow`));
  await Promise.all(ops);
  await priya.post(`/api/users/${target}/follow`);
  await priya.post(`/api/users/${target}/follow`);
  const after1 = (await priya.get(`/api/users/sol.synth`)).data;
  assert.equal(after1.relationship.following, "active");
  const wasFollowing = T.db.get("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?", uid("priya.plays"), target);
  assert.ok(wasFollowing);
  assert.equal(after1.counts.followers, T.db.get("SELECT COUNT(*) n FROM follows WHERE followee_id = ? AND status = 'active'", target).n);
  assert.ok(after1.counts.followers >= base);
});

test("private accounts: follow requests, hidden content, accept and remove follower", async () => {
  const eid = uid("ella.writes");
  const prof = await priya.get("/api/users/ella.writes");
  assert.equal(prof.data.content_visible, false);
  assert.equal((await priya.get("/api/users/ella.writes/posts")).status, 403);
  assert.equal((await priya.get("/api/users/ella.writes/followers")).status, 403);
  const f = await priya.post(`/api/users/${eid}/follow`);
  assert.equal(f.data.following, "pending");
  const reqs = await ella.get("/api/me/follow-requests");
  assert.ok(reqs.data.items.some((u) => u.username === "priya.plays"));
  // Ella's followers-only text post is invisible in search and feed
  const s = await priya.get("/api/search?q=train&type=posts");
  assert.equal(s.data.results.posts.items.length, 0);
  await ella.post(`/api/me/follow-requests/${uid("priya.plays")}/accept`);
  assert.equal((await priya.get("/api/users/ella.writes")).data.content_visible, true);
  assert.ok((await priya.get("/api/users/ella.writes/posts")).data.items.length >= 1);
  await ella.del(`/api/me/followers/${uid("priya.plays")}`);
  assert.equal((await priya.get("/api/users/ella.writes/posts")).status, 403);
});

test("blocking: hides profiles both ways, removes follows, stops messages and comments", async () => {
  await spam.post(`/api/users/${uid("mira.kaan")}/follow`);
  await mira.post(`/api/users/${uid("free.followers.99")}/block`);
  assert.equal((await spam.get("/api/users/mira.kaan")).status, 404);
  assert.equal(T.db.get("SELECT COUNT(*) n FROM follows WHERE follower_id = ? AND followee_id = ?", uid("free.followers.99"), uid("mira.kaan")).n, 0);
  assert.equal((await spam.post(`/api/users/${uid("mira.kaan")}/follow`)).status, 403);
  assert.equal((await spam.post("/api/conversations", { user_ids: [uid("mira.kaan")] })).status, 403);
  const miraPost = T.db.get("SELECT id FROM posts WHERE author_id = ? LIMIT 1", uid("mira.kaan")).id;
  assert.equal((await spam.get(`/api/posts/${miraPost}`)).status, 404);
  const feed = await spam.get("/api/feed?tab=latest");
  assert.ok(feed.data.items.every((p) => p.author.id !== uid("mira.kaan")));
});

/* ---------------------------------------------------------------- posts ---- */
test("posts: text post, hashtags, mentions (respecting privacy), edit, idempotent create, delete", async () => {
  const k = ikey();
  const r = await nova.post("/api/posts", { caption: "Testing #TestTag with @rafi.listens and @ella.writes", idempotency_key: k });
  assert.equal(r.status, 200);
  assert.equal(r.data.post.type, "text");
  assert.equal((await nova.post("/api/posts", { caption: "Testing #TestTag with @rafi.listens and @ella.writes", idempotency_key: k })).data.post.id, r.data.post.id);
  const mentioned = T.db.all("SELECT mentioned_id FROM mentions WHERE source_id = ?", r.data.post.id).map((m) => m.mentioned_id);
  assert.ok(mentioned.includes(uid("rafi.listens")));
  await T.db.run("UPDATE privacy_settings SET mentions = 'nobody' WHERE user_id = ?", uid("priya.plays"));
  const r2 = await nova.post("/api/posts", { caption: "hey @priya.plays #other" });
  assert.equal(T.db.get("SELECT COUNT(*) n FROM mentions WHERE source_id = ?", r2.data.post.id).n, 0, "mention setting respected");
  const tag = await rafi.get("/api/hashtags/testtag");
  assert.ok(tag.data.items.some((p) => p.id === r.data.post.id));
  assert.equal((await rafi.patch(`/api/posts/${r.data.post.id}`, { caption: "hijack" })).status, 403);
  const e = await nova.patch(`/api/posts/${r.data.post.id}`, { caption: "Edited #NewTag" });
  assert.ok(e.data.post.edited_at);
  assert.equal((await rafi.get("/api/hashtags/testtag")).data.post_count, 0);
  assert.equal((await nova.post("/api/posts", { caption: "" })).data.error.code, "empty_post");
  await nova.del(`/api/posts/${r.data.post.id}`);
  assert.equal((await rafi.get(`/api/posts/${r.data.post.id}`)).status, 404);
});

test("reactions: one per user, switching kind doesn't double count, concurrent likes stay exact", async () => {
  const pid = T.db.get("SELECT id FROM posts WHERE author_id = ? AND type = 'text' LIMIT 1", uid("lumen.vox")).id;
  const before1 = T.db.get("SELECT like_count FROM posts WHERE id = ?", pid).like_count;
  await Promise.all(Array.from({ length: 10 }, () => priya.post(`/api/posts/${pid}/react`, { kind: "like" })));
  await priya.post(`/api/posts/${pid}/react`, { kind: "fire" });
  const hadBefore = T.db.get("SELECT 1 FROM reactions WHERE user_id = ? AND target_id = ?", uid("priya.plays"), pid);
  assert.ok(hadBefore);
  const mid = T.db.get("SELECT like_count FROM posts WHERE id = ?", pid).like_count;
  assert.ok(mid === before1 || mid === before1 + 1);
  assert.equal(mid, T.db.get("SELECT COUNT(*) n FROM reactions WHERE target_type = 'post' AND target_id = ?", pid).n);
  await Promise.all(Array.from({ length: 5 }, () => priya.del(`/api/posts/${pid}/react`)));
  assert.equal(T.db.get("SELECT like_count FROM posts WHERE id = ?", pid).like_count, T.db.get("SELECT COUNT(*) n FROM reactions WHERE target_type = 'post' AND target_id = ?", pid).n);
  assert.equal((await priya.post(`/api/posts/${pid}/react`, { kind: "evil" })).status, 400);
});

test("save, share, hide, views", async () => {
  const pid = T.db.get("SELECT id FROM posts WHERE author_id = ? AND type = 'reel' LIMIT 1", uid("kora.sound")).id;
  await priya.post(`/api/posts/${pid}/save`);
  await priya.post(`/api/posts/${pid}/save`);
  const saved = await priya.get(`/api/users/priya.plays/posts?tab=saved`);
  assert.ok(saved.data.items.some((p) => p.id === pid));
  assert.equal((await rafi.get(`/api/users/priya.plays/posts?tab=saved`)).status, 403);
  const s1 = await priya.post(`/api/posts/${pid}/share`, { channel: "link" });
  const s2 = await priya.post(`/api/posts/${pid}/share`, { channel: "link" });
  assert.equal(s2.data.shares, s1.data.shares, "one counted link share per day");
  const v0 = T.db.get("SELECT view_count FROM posts WHERE id = ?", pid).view_count;
  await priya.post(`/api/posts/${pid}/view`, { watch_ms: 3000 });
  await priya.post(`/api/posts/${pid}/view`, { watch_ms: 5000 });
  assert.equal(T.db.get("SELECT view_count FROM posts WHERE id = ?", pid).view_count, v0 + 1);
  await priya.post(`/api/posts/${pid}/hide`);
  const feed = await priya.get("/api/feed?tab=latest");
  assert.ok(!feed.data.items.some((p) => p.id === pid));
});

test("comments: privacy, restricted users, replies, delete, duplicate protection", async () => {
  const pid = T.db.get("SELECT id FROM posts WHERE author_id = ? AND type = 'text' ORDER BY id DESC LIMIT 1", uid("nova.keys")).id;
  const c = await priya.post(`/api/posts/${pid}/comments`, { body: "Love this" });
  assert.equal(c.status, 200);
  assert.equal((await priya.post(`/api/posts/${pid}/comments`, { body: "Love this" })).status, 409);
  const reply = await nova.post(`/api/posts/${pid}/comments`, { body: "Thank you!", parent_id: c.data.comment.id });
  assert.equal(reply.data.comment.parent_id, c.data.comment.id);
  const replies = await rafi.get(`/api/posts/${pid}/comments?parent_id=${c.data.comment.id}`);
  assert.equal(replies.data.items.length, 1);
  // Restrict: Priya's new comments are visible only to Priya and Nova
  await nova.post(`/api/users/${uid("priya.plays")}/restrict`);
  const hidden = await priya.post(`/api/posts/${pid}/comments`, { body: "Restricted words" });
  assert.equal(hidden.data.comment.restricted, true);
  const asRafi = await rafi.get(`/api/posts/${pid}/comments`);
  assert.ok(!asRafi.data.items.some((x) => x.id === hidden.data.comment.id));
  const asNova = await nova.get(`/api/posts/${pid}/comments`);
  assert.ok(asNova.data.items.some((x) => x.id === hidden.data.comment.id));
  await nova.del(`/api/users/${uid("priya.plays")}/restrict`);
  // Comment controls
  await T.db.run("UPDATE privacy_settings SET comments = 'off' WHERE user_id = ?", uid("nova.keys"));
  assert.equal((await rafi.post(`/api/posts/${pid}/comments`, { body: "hello" })).data.error.code, "comments_off");
  await T.db.run("UPDATE privacy_settings SET comments = 'everyone' WHERE user_id = ?", uid("nova.keys"));
  // Post author can delete others' comments; others can't
  assert.equal((await rafi.del(`/api/comments/${c.data.comment.id}`)).status, 403);
  assert.equal((await nova.del(`/api/comments/${c.data.comment.id}`)).status, 200);
});

/* ---------------------------------------------------------------- feed ---- */
test("feed: every tab paginates without duplicates and ends", async () => {
  for (const tab of ["for_you", "following", "latest", "trending"]) {
    const seen = new Set();
    let cursor = null, pages = 0;
    do {
      const r = await rafi.get(`/api/feed?tab=${tab}${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(r.status, 200, tab);
      for (const p of r.data.items) { assert.ok(!seen.has(p.id), `${tab} duplicate ${p.id}`); seen.add(p.id); }
      cursor = r.data.next_cursor;
      pages++;
    } while (cursor && pages < 20);
    assert.ok(seen.size > 0, `${tab} returns posts`);
    assert.ok(pages < 20, `${tab} terminates`);
  }
  assert.equal((await rafi.get("/api/feed?tab=latest&cursor=%%%")).status, 200);
  assert.equal((await rafi.get("/api/feed?tab=for_you&cursor=not-base64-json")).status, 400);
});

test("feed never exposes private or followers-only content to non-followers", async () => {
  const privateIds = new Set(T.db.all("SELECT p.id FROM posts p JOIN users u ON u.id = p.author_id WHERE u.is_private = 1 OR p.visibility = 'followers'").map((x) => x.id));
  const sam = await T.as("sam.new");
  for (const tab of ["for_you", "latest", "trending"]) {
    let cursor = null;
    do {
      const r = await sam.get(`/api/feed?tab=${tab}${cursor ? `&cursor=${cursor}` : ""}`);
      r.data.items.forEach((p) => assert.ok(!privateIds.has(p.id), `${tab} leaked ${p.id}`));
      cursor = r.data.next_cursor;
    } while (cursor);
  }
  const ex = await sam.get("/api/explore");
  [...ex.data.posts, ...ex.data.reels].forEach((p) => assert.ok(!privateIds.has(p.id)));
});

test("reels feed returns only reels and supports deep links", async () => {
  const r = await rafi.get("/api/reels");
  assert.ok(r.data.items.length > 0);
  assert.ok(r.data.items.every((p) => p.type === "reel"));
  assert.ok(r.data.items.every((p) => p.media[0].kind === "video" && p.media[0].poster_url));
  const target = r.data.items.at(-1).id;
  assert.equal((await rafi.get(`/api/reels?start=${target}`)).data.items[0].id, target);
});

/* ---------------------------------------------------------------- stories ---- */
test("stories: audience (public / followers / close friends), views, reactions, viewers list, expiry", async () => {
  const cf = T.db.get("SELECT id FROM stories WHERE author_id = ? AND audience = 'close_friends'", uid("nova.keys")).id;
  const asLumen = await (await T.as("lumen.vox")).get(`/api/stories/user/${uid("nova.keys")}`);
  assert.ok(asLumen.data.items.some((s) => s.id === cf), "close friend sees it");
  const asRafi = await rafi.get(`/api/stories/user/${uid("nova.keys")}`);
  assert.ok(!asRafi.data.items.some((s) => s.id === cf), "others don't");
  assert.equal((await rafi.post(`/api/stories/${cf}/view`)).status, 404);
  const pub = asRafi.data.items[0];
  const priorViews = T.db.get("SELECT view_count FROM story_views WHERE story_id = ? AND viewer_id = ?", pub.id, uid("rafi.listens"))?.view_count ?? 0;
  await rafi.post(`/api/stories/${pub.id}/view`);
  await rafi.post(`/api/stories/${pub.id}/view`);
  await rafi.post(`/api/stories/${pub.id}/react`, { kind: "fire" });
  const viewers = await nova.get(`/api/stories/${pub.id}/viewers`);
  const me = viewers.data.items.find((v) => v.user.username === "rafi.listens");
  assert.equal(me.views, priorViews + 2);
  assert.equal(me.reaction, "fire");
  assert.equal((await rafi.get(`/api/stories/${pub.id}/viewers`)).status, 403);
  const own = await nova.get(`/api/stories/user/${uid("nova.keys")}`);
  assert.ok(own.data.items[0].stats.unique_viewers >= 1);
  // Reply lands as a DM with a story reference
  const reply = await rafi.post(`/api/stories/${pub.id}/reply`, { body: "🔥🔥", client_id: ikey() });
  assert.equal(reply.data.message.kind, "story_reply");
  // Create and expire
  const mine = await rafi.post("/api/stories", { content: { text: "hello world", bg: "#123456" }, audience: "public" });
  assert.equal(mine.status, 200);
  T.db.run("UPDATE stories SET created_at = ?, expires_at = ? WHERE id = ?", Date.now() - 864e5 - 10, Date.now() - 1, mine.data.story.id);
  assert.ok(expireStories(T.S) >= 1);
  assert.ok(!(await priya.get(`/api/stories/user/${uid("rafi.listens")}`)).data.items.some((s) => s.id === mine.data.story.id));
  assert.equal((await rafi.post("/api/stories", { content: { text: "" } })).data.error.code, "empty_story");
  assert.equal((await rafi.post("/api/stories", { content: { text: "x" }, link_url: "javascript:alert(1)" })).data.error.code, "invalid_link");
});

test("story tray lists unseen first and includes own stories", async () => {
  const tray = await nova.get("/api/stories/tray");
  assert.equal(tray.data.items[0].is_self, true);
  const r = await rafi.get("/api/stories/tray");
  const firstSeen = r.data.items.findIndex((x) => x.unseen === 0 && !x.is_self);
  const lastUnseen = r.data.items.map((x) => x.unseen > 0 && !x.is_self).lastIndexOf(true);
  assert.ok(firstSeen === -1 || lastUnseen < firstSeen);
});

/* ---------------------------------------------------------------- search & explore ---- */
test("search: users, hashtags, posts, reels; pagination and history", async () => {
  const all = await rafi.get("/api/search?q=nova");
  assert.equal(all.data.results.users.items[0].username, "nova.keys");
  const tags = await rafi.get("/api/search?q=%23tech&type=hashtags");
  assert.ok(tags.data.results.hashtags.items.some((t) => t.tag === "techno"));
  const reels = await rafi.get("/api/search?q=%23amapiano&type=reels");
  assert.ok(reels.data.results.reels.items.every((p) => p.type === "reel"));
  const empty = await rafi.get("/api/search?q=zzqqxx");
  assert.equal(empty.data.results.users.items.length, 0);
  const inj = await rafi.get(`/api/search?q=${encodeURIComponent('") OR 1=1 --')}`);
  assert.equal(inj.status, 200);
  await rafi.post("/api/search/history", { query: "melodic techno" });
  assert.equal((await rafi.get("/api/search/history")).data.items[0].query, "melodic techno");
  await rafi.del("/api/search/history");
  assert.equal((await rafi.get("/api/search/history")).data.items.length, 0);
  const sug = await rafi.get("/api/search/suggest?q=mi");
  assert.ok(sug.data.users.some((u) => u.username === "mira.kaan"));
});

test("explore returns trending tags, creators, reels, posts and categories", async () => {
  const ex = await rafi.get("/api/explore");
  assert.ok(ex.data.trending_tags.length > 0);
  assert.ok(ex.data.creators.every((c) => c.is_creator));
  assert.ok(ex.data.categories.length >= 5);
  const cat = await rafi.get("/api/explore?category=dance");
  assert.ok([...cat.data.posts, ...cat.data.reels].every((p) => /#(dance|choreo|amapiano)/i.test(p.caption)));
});

/* ---------------------------------------------------------------- notifications ---- */
test("notifications: grouping, read state, preferences and mutes", async () => {
  const pid = (await nova.post("/api/posts", { caption: "Notify test" })).data.post.id;
  await rafi.post(`/api/posts/${pid}/react`, { kind: "like" });
  await priya.post(`/api/posts/${pid}/react`, { kind: "love" });
  const n = await nova.get("/api/notifications");
  const g = n.data.items.find((x) => x.type === "like" && x.target_id === pid);
  assert.equal(g.actors.length, 2, "likes on one post are grouped");
  await nova.post("/api/notifications/read", { ids: g.ids });
  assert.ok((await nova.get("/api/notifications")).data.items.find((x) => x.target_id === pid).read);
  await nova.patch("/api/me/notification-prefs", { likes: { in_app: false } });
  await (await T.as("sol.synth")).post(`/api/posts/${pid}/react`, { kind: "like" });
  assert.ok(!(await nova.get("/api/notifications")).data.items.find((x) => x.target_id === pid && x.actors.some((a) => a.username === "sol.synth")));
  await nova.patch("/api/me/notification-prefs", { likes: { in_app: true }, earnings: { in_app: false } });
  const prefs = await nova.get("/api/me/notification-prefs");
  assert.equal(prefs.data.items.find((p) => p.category === "earnings").in_app, true, "money notices can't be switched off");
  await nova.post("/api/notifications/read", { all: true });
  assert.equal((await nova.get("/api/notifications")).data.unread, 0);
});

/* ---------------------------------------------------------------- media ---- */
test("media: chunked upload with resume, validation of type, size and content, cancel", async () => {
  const file = fs.readFileSync(path.join(T.S.cfg.seedMediaDir, "images", "post_0.webp"));
  const init = await rafi.post("/api/media/uploads", { purpose: "post", filename: "art.webp", mime: "image/webp", bytes: file.length });
  assert.equal(init.status, 200);
  const { id: upId, chunk_size: cs, chunks } = init.data.upload;
  // Upload chunks out of order, one of them twice (retry)
  const order = [...Array(chunks).keys()].reverse();
  for (const i of [...order, order[0]]) {
    const r = await rafi.raw("PUT", `/api/media/uploads/${upId}/chunks/${i}`, undefined, { raw: file.subarray(i * cs, Math.min(file.length, (i + 1) * cs)), headers: { "content-type": "application/octet-stream" } });
    assert.equal(r.status, 200);
  }
  const status = await rafi.get(`/api/media/uploads/${upId}`);
  assert.equal(status.data.upload.received.length, chunks);
  const done = await rafi.post(`/api/media/uploads/${upId}/complete`, { sha256: crypto.createHash("sha256").update(file).digest("hex") });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.media.kind, "image");
  assert.ok(done.data.media.width > 0);
  const served = await fetch(T.base + done.data.media.url);
  assert.equal(served.status, 200);
  assert.match(served.headers.get("content-security-policy"), /sandbox/);
  // Range request (video seeking)
  const part = await fetch(T.base + done.data.media.url, { headers: { range: "bytes=0-9" } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 10);
  // Disguised file: claims to be PNG but isn't
  const fake = Buffer.from("<svg onload=alert(1)></svg>");
  const bad = await rafi.post("/api/media/uploads", { purpose: "post", filename: "x.png", mime: "image/png", bytes: fake.length });
  await rafi.raw("PUT", `/api/media/uploads/${bad.data.upload.id}/chunks/0`, undefined, { raw: fake });
  assert.equal((await rafi.post(`/api/media/uploads/${bad.data.upload.id}/complete`)).data.error.code, "content_mismatch");
  // Disallowed type, oversize, wrong chunk size, incomplete, cancel
  assert.equal((await rafi.post("/api/media/uploads", { purpose: "post", mime: "image/svg+xml", bytes: 10 })).data.error.code, "unsupported_type");
  assert.equal((await rafi.post("/api/media/uploads", { purpose: "post", mime: "image/png", bytes: 500 * 1024 * 1024 })).status, 413);
  const inc = await rafi.post("/api/media/uploads", { purpose: "post", mime: "image/webp", bytes: file.length });
  assert.equal((await rafi.raw("PUT", `/api/media/uploads/${inc.data.upload.id}/chunks/0`, undefined, { raw: Buffer.alloc(10) })).data.error.code, "chunk_size_mismatch");
  assert.equal((await rafi.post(`/api/media/uploads/${inc.data.upload.id}/complete`)).data.error.code, "upload_incomplete");
  assert.equal((await rafi.del(`/api/media/uploads/${inc.data.upload.id}`)).status, 200);
  assert.equal((await rafi.post(`/api/media/uploads/${inc.data.upload.id}/complete`)).status, 409);
  // Someone else's media can't be attached
  assert.equal((await priya.post("/api/posts", { media_ids: [done.data.media.id] })).data.error.code, "invalid_media");
  const post = await rafi.post("/api/posts", { media_ids: [done.data.media.id], caption: "Uploaded #art", alts: ["Pink vinyl record"] });
  assert.equal(post.data.post.type, "image");
  assert.equal(post.data.post.media[0].alt, "Pink vinyl record");
});

/* ---------------------------------------------------------------- moderation ---- */
test("reports and moderation: report → queue → remove content and suspend user", async () => {
  const spamPost = T.db.get("SELECT id FROM posts WHERE author_id = ? LIMIT 1", uid("free.followers.99")).id;
  assert.equal((await rafi.post("/api/reports", { target_type: "post", target_id: spamPost, reason: "bogus" })).status, 400);
  const again = await rafi.post("/api/reports", { target_type: "post", target_id: spamPost, reason: "spam" });
  assert.equal(again.data.already_reported, true);
  assert.equal((await rafi.get("/api/admin/reports")).status, 403);
  const q = await admin.get("/api/admin/reports");
  const item = q.data.items.find((x) => x.target_id === spamPost);
  assert.ok(item.n >= 3);
  await admin.post(`/api/admin/reports/${item.id}/resolve`, { action: "remove_content", note: "Follower selling" });
  assert.equal((await rafi.get(`/api/posts/${spamPost}`)).status, 404);
  const userReport = (await admin.get("/api/admin/reports")).data.items.find((x) => x.target_type === "user");
  await admin.post(`/api/admin/reports/${userReport.id}/resolve`, { action: "suspend_user" });
  assert.equal((await spam.get("/api/me")).data.user, null);
  const notes = await rafi.get("/api/notifications");
  assert.ok(notes.data.items.some((n) => n.type === "report_update"));
});
