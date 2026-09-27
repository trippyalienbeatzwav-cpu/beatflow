// Seeds a fictional community on first boot (or with `npm run seed`, which resets the data dir).
// Everything goes through the real code paths (createPost, follow, sendGift, signed payment webhooks), so the
// seeded ledger reconciles exactly like live data. Media comes from server/seed-media (npm run seed:media).
import fs from "node:fs";
import { seedStoreCatalog, seedStoreActivity } from "./seed-store.js";
import path from "node:path";
import crypto from "node:crypto";
import { id, idAt } from "./lib/ids.js";
import { ensureUserRows, follow } from "./modules/users.js";
import { storeFile } from "./modules/media.js";
import { createPost } from "./modules/posts.js";
import { notify } from "./modules/notifications.js";
import { purchaseCredits, handlePaymentEvent, sendGift, createDonation, releaseEarnings } from "./modules/wallet.js";
import { sendDirect, postMessage } from "./modules/messages.js";

const H = 3600_000, D = 24 * H;
const key = () => crypto.randomBytes(12).toString("hex");

const USERS = [
  { u: "nova.keys", n: "Nova Keys", bio: "Producer & keys. Neo-soul chords, late-night drums. Live sessions every Thursday.", creator: 1, verified: 1, av: 0, cv: 0, links: [{ label: "Beats Store", url: "https://tunibeat.example/beats" }] },
  { u: "mira.kaan", n: "Mira Kaan", bio: "Melodic techno DJ · Berlin ↔ Lisbon. Label: Vantage Sound.", creator: 1, verified: 1, av: 1, cv: 1 },
  { u: "ayo.drums", n: "Ayo Adebayo", bio: "Session drummer. Afrobeats, amapiano, whatever grooves.", creator: 1, av: 2, cv: 2 },
  { u: "lumen.vox", n: "Lumen", bio: "Vocalist / topliner. Harmonies are my love language.", creator: 1, verified: 1, av: 3, cv: 3 },
  { u: "saint.loops", n: "Saint Loops", bio: "Drill & trap loops. 140 or nothing.", creator: 1, av: 4, cv: 4 },
  { u: "tape.theory", n: "Tape Theory", bio: "Lo-fi on real tape. Hiss included at no extra charge.", creator: 1, av: 5, cv: 5 },
  { u: "kora.sound", n: "Kora", bio: "Amapiano dancer & choreographer. Log drums move me.", creator: 1, av: 6, cv: 6 },
  { u: "juno.fm", n: "Juno FM", bio: "Weekly radio show for new electronic music.", creator: 1, av: 7, cv: 7, privacy: { messages: "following" } },
  { u: "rafi.listens", n: "Rafi", bio: "Crate digger. I buy the records you post about.", av: 8, fan: true },
  { u: "ella.writes", n: "Ella Moreau", bio: "Songwriter. Mostly voice memos.", av: 9, private: 1 },
  { u: "dex.mixes", n: "Dex", bio: "Mix engineer. Send stems, not excuses.", creator: 1, av: 10 },
  { u: "priya.plays", n: "Priya", bio: "Bedroom DJ, festival regular.", av: 11, fan: true },
  { u: "sol.synth", n: "Sol", bio: "Modular synth patches and ambient walks.", creator: 1, av: 12 },
  { u: "sam.new", n: "Sam", bio: "", av: 13, fresh: true },
  { u: "tunibeat.team", n: "TUNIBEAT Trust & Safety", bio: "Official moderation team. Reports go to us.", role: "admin", verified: 1, av: 14 },
  { u: "free.followers.99", n: "FREE FOLLOWERS", bio: "DM for 10k followers 🔥🔥 cheap", av: 15, spam: true },
];

/** @type {any[]} */
const POSTS = [
  // [author, kind, caption, media keys, ageHours]
  ["nova.keys", "carousel", "New chord pack coming Friday. These are the voicings I keep going back to. #neosoul #production #keys", ["post_0", "post_1", "post_2"], 200],
  ["mira.kaan", "image", "Lisbon, 5am, last record of the night. Thank you to everyone who stayed. #techno #dj #liveset", ["post_3"], 190],
  ["ayo.drums", "reel", "Log drum pattern breakdown. Ghost notes on the 'and' of 3 do all the work. #amapiano #production", ["reel_0"], 180],
  ["tape.theory", "image", "Bounced the whole EP to a four-track and back. Worth it for the wobble. #lofi #studio", ["post_4"], 170],
  ["lumen.vox", "text", "Hot take: the best hook is the one you almost didn't record. Keep the first take. #vocals #songwriting", [], 160],
  ["saint.loops", "reel", "140 BPM loop from scratch in 60 seconds. @nova.keys should flip this 👀 #drill #beatmaking", ["reel_1"], 150],
  ["kora.sound", "reel", "New choreo to a log drum groove. Full version on Sunday. #dance #amapiano", ["reel_2"], 140],
  ["mira.kaan", "reel", "Blending two tracks in 8A → 9A. Harmonic mixing makes the transition feel effortless. #dj #techno #mix", ["reel_3"], 130],
  ["nova.keys", "video", "Late-night keys session. Headphones on. #studio #keys", ["video_0"], 120],
  ["sol.synth", "carousel", "Patch notes from this morning's walk: three oscillators, one mood. #synth #sounddesign", ["post_5", "post_6"], 110],
  ["dex.mixes", "text", "Mix tip: check your low end in mono before you touch the master bus. Every time. #mixing #production", [], 100],
  ["juno.fm", "image", "This week's show: 14 new tracks, 3 world premieres. Link in bio. #house #techno", ["post_7"], 96],
  ["ayo.drums", "image", "Rehearsal room views. #studio #bts #gear", ["post_8"], 90],
  ["lumen.vox", "reel", "Stacking harmonies: one voice, eight layers. #vocals #bts", ["reel_4"], 84],
  ["tape.theory", "reel", "Sampling a cassette I found at a flea market. #lofi #beatmaking", ["reel_5"], 78],
  ["nova.keys", "text", "Thank you for 10k! Going live Thursday to build a beat from your suggestions. Drop ideas below. #production", [], 72],
  ["priya.plays", "image", "First time playing out, and my hands were shaking the whole set 😅 #dj", ["post_9"], 66],
  ["kora.sound", "carousel", "Behind the scenes of Sunday's shoot. #dance #bts", ["post_10", "post_11", "post_12"], 60],
  ["mira.kaan", "text", "Label news: Vantage Sound opens demo submissions next month. Melodic techno and progressive only, please. #techno", [], 54],
  ["saint.loops", "image", "The whole setup. It's not much but it bangs. #studio #gear", ["post_13"], 48],
  ["sol.synth", "reel", "Generative patch running for an hour. Here are 7 seconds of it. #synth #ambient", ["reel_6"], 42],
  ["dex.mixes", "carousel", "Before/after on a vocal chain (visualized). #mixing", ["post_14", "post_15"], 36],
  ["nova.keys", "reel", "Chop → flip → bounce. #beatmaking #neosoul", ["reel_7"], 30],
  ["juno.fm", "video", "Studio cam from last night's broadcast. #radio #house", ["video_1"], 26],
  ["lumen.vox", "image", "Vocal booth selfie (the booth is a closet). #vocals #studio", ["post_16"], 22],
  ["ayo.drums", "reel", "Polyrhythm practice: 3 over 4 until it feels like home. #production", ["reel_8"], 18],
  ["mira.kaan", "carousel", "Crate for Saturday. Can you guess the opener? #vinyl #dj", ["post_17", "post_18", "post_19", "post_20"], 14],
  ["tape.theory", "text", "Currently looking for a vocalist for a slow jam. @lumen.vox are you around? #songwriting", [], 10],
  ["kora.sound", "reel", "Tried the new routine at the club and the floor went up. #dance #amapiano #club", ["reel_9"], 7],
  ["ella.writes", "text", "Wrote a verse on the train today. Nobody will hear it yet. #songwriting", [], 6],
  ["nova.keys", "image", "Thursday live setup is ready. See you there. #studio #liveset", ["post_21"], 4],
  ["free.followers.99", "text", "GET 10K FOLLOWERS NOW 🔥🔥 cheap cheap DM me #dj #techno #production", [], 3],
  ["sol.synth", "image", "Morning light on the rack. #synth #gear", ["post_22"], 2],
  ["priya.plays", "text", "Anyone going to the warehouse party on Saturday? #techno", [], 1],
];

/** @type {any[]} */
const COMMENTS = [
  ["mira.kaan", 0, "These voicings are unreal. Chord 2 especially."], ["lumen.vox", 0, "Can I write over this??"], ["rafi.listens", 0, "Pre-ordering the second it drops."],
  ["nova.keys", 1, "That last record 🙏"], ["priya.plays", 1, "I was there! Best closing set of the year."], ["kora.sound", 2, "Stealing this for my next routine."],
  ["nova.keys", 5, "Say less, flipping it tonight 🔥"], ["dex.mixes", 7, "Clean blend. What were the two tracks?"], ["rafi.listens", 7, "Track ID please 🙏"],
  ["tape.theory", 8, "Those keys are so warm."], ["ayo.drums", 10, "Mono check saves lives."], ["rafi.listens", 15, "Do a 124 BPM house flip!"],
  ["lumen.vox", 15, "Vocal chops please."], ["priya.plays", 15, "Amapiano version!!"], ["mira.kaan", 16, "Everyone shakes the first time. You did great."],
  ["nova.keys", 22, "The flip on this 👀"], ["ayo.drums", 25, "3 over 4 is the gateway drug."], ["lumen.vox", 27, "Always around for a slow jam 💛"],
  ["juno.fm", 26, "Playing this on the show this week."], ["sam.new", 22, "How did you learn to chop like this?"],
];

function mediaFrom(S, manifest, owner, k, when) {
  const entry = manifest.images[k] ?? manifest.videos[k];
  if (!entry) return null;
  const dir = S.cfg.seedMediaDir;
  if (manifest.videos[k]) {
    const poster = storeFile(S, { ownerId: owner, kind: "image", mime: "image/webp", buf: fs.readFileSync(path.join(dir, entry.poster)), width: entry.w, height: entry.h, createdAt: when });
    const vid = storeFile(S, { ownerId: owner, kind: "video", mime: "video/webm", buf: fs.readFileSync(path.join(dir, entry.file)), width: entry.w, height: entry.h, durationMs: entry.duration_ms, createdAt: when });
    S.db.run("UPDATE media SET poster_key = ? WHERE id = ?", poster.storage_key, vid.id);
    return vid;
  }
  return storeFile(S, { ownerId: owner, kind: "image", mime: "image/webp", buf: fs.readFileSync(path.join(dir, entry.file)), width: entry.w, height: entry.h, createdAt: when });
}

async function sandboxPay(S, pay) {
  const p = S.db.get("SELECT * FROM payments WHERE id = ?", pay);
  const ev = S.payments.signEvent({ id: id("evt"), type: "payment.succeeded", data: { provider_ref: p.provider_ref } });
  return handlePaymentEvent(S, "sandbox", S.payments.verifyWebhook(ev.body, ev.headers));
}

export async function seed(S, { log = (..._args) => {} } = {}) {
  const manifestFile = path.join(S.cfg.seedMediaDir, "manifest.json");
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : { images: {}, videos: {} };
  const hasMedia = Object.keys(manifest.images).length > 0;
  if (!hasMedia) log("seed: no seed media found (run `npm run seed:media`); seeding text-only content");
  const now = S.now();
  const limitsWereOn = S.limiter.enabled;
  S.limiter.setEnabled(false);
  const byName = {};

  // ---- Settings, gift catalog, credit packs ----
  // Development default: earnings clear after 2 minutes so the full money flow can be exercised in one sitting.
  S.db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('monetization', ?, ?)", JSON.stringify({ earnings_hold_seconds: 120 }), now);
  const gifts = [
    ["gift_heart", "Heart", "heart", "float", 5, 1], ["gift_clap", "Claps", "clap", "pulse", 10, 2], ["gift_star", "Star", "star", "burst", 25, 3], ["gift_fire", "Fire", "fire", "burst", 50, 4],
    ["gift_flower", "Flowers", "flower", "rain", 100, 5], ["gift_vinyl", "Gold Record", "vinyl", "spin", 500, 6], ["gift_rocket", "Headliner", "rocket", "burst", 1000, 7],
  ];
  gifts.forEach(([gid, name, icon, anim, cost, sort]) => S.db.run(`INSERT INTO gift_catalog (id, name, icon, animation, credit_cost, creator_share_bps, platform_fee_bps, availability, status, sort, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    gid, name, icon, anim, cost, 7000, 3000, gid === "gift_rocket" ? "live_only" : "everywhere", "active", sort, now));
  S.db.run(`INSERT INTO gift_catalog (id, name, icon, animation, credit_cost, creator_share_bps, platform_fee_bps, availability, status, sort, updated_at) VALUES ('gift_crown','Crown','crown','spin',2500,7000,3000,'live_only','disabled',8,?)`, now);
  [["pack_100", 100, 129], ["pack_550", 550, 649], ["pack_1200", 1200, 1399], ["pack_3000", 3000, 3399]].forEach(([pid, c, a], i) =>
    S.db.run("INSERT INTO credit_packages (id, credits, amount_cents, currency, status, sort) VALUES (?,?,?,?,?,?)", pid, c, a, "USD", "active", i));

  // ---- Users ----
  USERS.forEach((u, i) => {
    const uid = idAt("u", now - 40 * D + i * H);
    const created = u.fresh ? now - 2 * H : now - (40 - i) * D;
    S.db.run(`INSERT INTO users (id, username, email, display_name, bio, links, is_private, is_creator, is_verified, role, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      uid, u.u, `${u.u.replace(/\W/g, "")}@demo.tunibeat.example`, u.n, u.bio, JSON.stringify(u.links ?? []), u.private ?? 0, u.creator ?? 0, u.verified ?? 0, u.role ?? "user", created);
    ensureUserRows(S, uid);
    if (u.privacy) S.db.run("UPDATE privacy_settings SET messages = ? WHERE user_id = ?", u.privacy.messages, uid);
    if (hasMedia) {
      const av = mediaFrom(S, manifest, uid, `avatar_${u.av}`, created);
      const cv = u.cv != null ? mediaFrom(S, manifest, uid, `cover_${u.cv}`, created) : null;
      S.db.run("UPDATE users SET avatar_media_id = ?, cover_media_id = ? WHERE id = ?", av?.id ?? null, cv?.id ?? null, uid);
    }
    byName[u.u] = S.db.get("SELECT * FROM users WHERE id = ?", uid);
  });
  const U = (n) => byName[n];

  // ---- Follow graph (through follow(), so private accounts get pending requests) ----
  const everyoneFollows = ["nova.keys", "mira.kaan", "lumen.vox"];
  for (const u of USERS) for (const t of everyoneFollows) if (u.u !== t && !u.spam) follow(S, U(u.u), U(t).id);
  const pairs = [["rafi.listens", ["ayo.drums", "tape.theory", "kora.sound", "juno.fm", "saint.loops", "priya.plays", "sol.synth", "dex.mixes"]],
    ["priya.plays", ["mira.kaan", "juno.fm", "kora.sound", "rafi.listens"]], ["nova.keys", ["saint.loops", "tape.theory", "ayo.drums", "dex.mixes", "rafi.listens", "ella.writes", "kora.sound"]],
    ["mira.kaan", ["juno.fm", "sol.synth", "priya.plays", "nova.keys"]], ["ayo.drums", ["kora.sound", "saint.loops"]], ["kora.sound", ["ayo.drums", "priya.plays"]],
    ["lumen.vox", ["tape.theory", "ella.writes", "nova.keys"]], ["tape.theory", ["lumen.vox", "sol.synth"]], ["dex.mixes", ["saint.loops", "tape.theory"]],
    ["juno.fm", ["mira.kaan", "sol.synth"]], ["sol.synth", ["tape.theory"]], ["ella.writes", ["lumen.vox"]], ["sam.new", ["kora.sound"]]];
  for (const [a, list] of pairs) for (const b of list) follow(S, U(a), U(b).id);
  // Ella is private: accept Nova and Lumen; leave Rafi's request pending
  follow(S, U("rafi.listens"), U("ella.writes").id);
  S.db.run("UPDATE follows SET status = 'active' WHERE followee_id = ? AND follower_id IN (?, ?)", U("ella.writes").id, U("nova.keys").id, U("lumen.vox").id);
  S.db.run("UPDATE follows SET created_at = ? - (abs(random()) % ?)", now, 30 * D);
  S.db.run("INSERT INTO close_friends (user_id, friend_id, created_at) VALUES (?,?,?)", U("nova.keys").id, U("lumen.vox").id, now);

  // ---- Posts (oldest first, so time-sortable ids stay chronological) ----
  const posts = [];
  for (const [author, kind, caption, keys, age] of POSTS) {
    const when = now - age * H;
    const media = hasMedia ? keys.map((k) => mediaFrom(S, manifest, U(author).id, k, when)).filter(Boolean) : [];
    const p = createPost(S, U(author), { caption, media_ids: media.map((m) => m.id), type: kind === "reel" && media.length ? "reel" : undefined,
      alts: media.map(() => `Abstract generated artwork for ${U(author).display_name}'s post`), audio_title: kind === "reel" ? `Original sound · ${U(author).display_name}` : undefined });
    S.db.run("UPDATE posts SET created_at = ? WHERE id = ?", when, p.id);
    S.db.run("UPDATE post_hashtags SET created_at = ? WHERE post_id = ?", when, p.id);
    posts.push(S.db.get("SELECT * FROM posts WHERE id = ?", p.id));
  }
  // A share (repost) and a tagged post
  createPost(S, U("rafi.listens"), { shared_post_id: posts[7].id, caption: "This blend lives in my head now." });
  const tagged = createPost(S, U("lumen.vox"), { caption: "Studio day with the best. #bts", media_ids: hasMedia ? [mediaFrom(S, manifest, U("lumen.vox").id, "post_23", now - 3 * H).id] : [], tagged_user_ids: [U("nova.keys").id, U("tape.theory").id] });
  S.db.run("UPDATE posts SET created_at = ? WHERE id = ?", now - 3 * H, tagged.id);

  // ---- Engagement ----
  const fans = USERS.filter((u) => !u.spam && !u.fresh).map((u) => U(u.u));
  const KINDS = ["like", "like", "like", "love", "fire", "clap"];
  posts.forEach((p, i) => {
    const n = Math.max(2, Math.round(fans.length * (0.25 + ((i * 37) % 60) / 100)));
    fans.filter((f) => f.id !== p.author_id).slice(0, n).forEach((f, j) => {
      if (S.db.run("INSERT OR IGNORE INTO reactions (user_id, target_type, target_id, kind, created_at) VALUES (?,?,?,?,?)", f.id, "post", p.id, KINDS[(i + j) % KINDS.length], p.created_at + (j + 1) * 7 * 60_000).changes) {
        S.db.run("UPDATE posts SET like_count = like_count + 1 WHERE id = ?", p.id);
        if (i > POSTS.length - 12) notify(S, { userId: p.author_id, type: "like", actorId: f.id, targetType: "post", targetId: p.id, data: { reaction: "like", post_type: p.type } });
      }
    });
    // Views proportional to engagement; reels get watch time for averages
    const views = 40 + ((i * 131) % 900);
    S.db.run("UPDATE posts SET view_count = ?, share_count = ?, save_count = ? WHERE id = ?", views, (i * 7) % 23, (i * 5) % 17, p.id);
    for (let v = 0; v < Math.min(views, 25); v++) S.db.run("INSERT INTO view_events (id, viewer_id, owner_id, target_type, target_id, watch_ms, created_at) VALUES (?,?,?,?,?,?,?)",
      id("v"), null, p.author_id, p.type === "reel" ? "reel" : "post", p.id, p.type === "reel" ? 2500 + ((v * 977) % 5000) : 0, p.created_at + v * 37 * 60_000);
  });
  for (const [who, pi, body] of COMMENTS) {
    const p = posts[pi];
    const cid = idAt("cm", p.created_at + 20 * 60_000);
    S.db.run("INSERT INTO comments (id, post_id, author_id, body, created_at) VALUES (?,?,?,?,?)", cid, p.id, U(who).id, body, p.created_at + 20 * 60_000);
    S.db.run("UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?", p.id);
    if (pi >= 15) notify(S, { userId: p.author_id, type: "comment", actorId: U(who).id, targetType: "post", targetId: p.id, data: { comment_id: cid, excerpt: body } });
  }
  // A reply thread
  const parent = S.db.get("SELECT * FROM comments WHERE post_id = ? ORDER BY id LIMIT 1", posts[15].id);
  S.db.run("INSERT INTO comments (id, post_id, author_id, parent_id, body, created_at) VALUES (?,?,?,?,?,?)", id("cm"), posts[15].id, U("nova.keys").id, parent.id, "124 house flip is happening 🫡", now - 60 * 60_000);
  S.db.run("UPDATE comments SET reply_count = reply_count + 1 WHERE id = ?", parent.id);
  S.db.run("UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?", posts[15].id);
  S.db.run("INSERT OR IGNORE INTO saves (user_id, post_id, created_at) VALUES (?,?,?)", U("rafi.listens").id, posts[7].id, now - 2 * H);
  S.db.run("INSERT OR IGNORE INTO saves (user_id, post_id, created_at) VALUES (?,?,?)", U("rafi.listens").id, posts[2].id, now - 5 * H);

  // ---- Stories (active, inside the last 20 hours) ----
  /** @type {any[]} */
  const STORIES = [["nova.keys", "story_0", "Building Thursday's live set 🎹", 18, "public"], ["nova.keys", null, "Which BPM for the live flip?", 5, "public", "#1b1030"], ["nova.keys", "story_1", "Close friends preview 👀", 3, "close_friends"],
    ["mira.kaan", "story_2", "Soundcheck", 12, "public"], ["mira.kaan", "storyvid_0", "", 2, "public"], ["kora.sound", "story_3", "Rehearsal day", 9, "public"],
    ["lumen.vox", "story_4", "New harmony stack", 7, "followers"], ["tape.theory", "story_5", "Flea market haul", 15, "public"], ["ayo.drums", "story_6", "", 4, "public"],
    ["juno.fm", "story_7", "Show tonight, 9pm", 1, "public"], ["ella.writes", null, "Voice memo #214", 8, "followers", "#0d2b2b"]];
  for (const [who, mk, text, age, audience, bg] of STORIES) {
    const when = now - age * H;
    const media = hasMedia && mk ? mediaFrom(S, manifest, U(who).id, mk, when) : null;
    const stickers = who === "nova.keys" && age === 5 ? [{ type: "question", value: "124 or 140?", x: 0.5, y: 0.62 }] : who === "mira.kaan" && age === 12 ? [{ type: "hashtag", value: "techno", x: 0.3, y: 0.8 }] : [];
    S.db.run(`INSERT INTO stories (id, author_id, media_id, content, audience, created_at, expires_at, link_url, audio_title) VALUES (?,?,?,?,?,?,?,?,?)`,
      idAt("st", when), U(who).id, media?.id ?? null, JSON.stringify({ text, bg: bg ?? null, stickers, hashtags: [] }), audience, when, when + S.cfg.storyLifetimeMs,
      who === "juno.fm" ? "https://tunibeat.example/radio" : null, who === "kora.sound" ? "Original sound · Kora" : null);
  }
  // Some views on Nova's first story
  const st0 = S.db.get("SELECT id FROM stories WHERE author_id = ? ORDER BY created_at LIMIT 1", U("nova.keys").id);
  ["rafi.listens", "mira.kaan", "priya.plays", "lumen.vox"].forEach((n, i) => S.db.run("INSERT INTO story_views (story_id, viewer_id, viewed_at) VALUES (?,?,?)", st0.id, U(n).id, now - (10 - i) * H));
  S.db.run("INSERT INTO reactions (user_id, target_type, target_id, kind, created_at) VALUES (?,?,?,?,?)", U("mira.kaan").id, "story", st0.id, "fire", now - 9 * H);

  // ---- Live: scheduled and past sessions (nothing is "live now" until someone actually broadcasts) ----
  const thumb = (who, k) => (hasMedia ? mediaFrom(S, manifest, U(who).id, k, now)?.id : null);
  S.db.run(`INSERT INTO live_streams (id, host_id, title, description, category, thumbnail_media_id, audience, status, transport, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id("lv"), U("mira.kaan").id, "Sunrise set: melodic techno", "Two hours, all vinyl. Requests in chat.", "DJ set", thumb("mira.kaan", "thumb_0"), "public", "scheduled", S.cfg.live.transport, now + 26 * H, now);
  S.db.run(`INSERT INTO live_streams (id, host_id, title, description, category, thumbnail_media_id, audience, status, transport, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id("lv"), U("nova.keys").id, "Building a beat from your suggestions", "Drop BPM, key and vibe in chat.", "Production session", thumb("nova.keys", "thumb_1"), "public", "scheduled", S.cfg.live.transport, now + 50 * H, now);
  for (let i = 0; i < 3; i++) {
    const start = now - (6 + i * 7) * D;
    S.db.run(`INSERT INTO live_streams (id, host_id, title, category, audience, status, transport, started_at, ended_at, peak_viewers, unique_viewers, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      idAt("lv", start), U("nova.keys").id, ["Thursday session #12", "Thursday session #11", "Thursday session #10"][i], "Production session", "public", "ended", S.cfg.live.transport, start, start + 75 * 60_000, 42 - i * 9, 118 - i * 25, start);
  }

  // ---- Messages ----
  sendDirect(S, U("rafi.listens"), U("nova.keys").id, { body: "Your chord pack post convinced me to finally learn keys 😅", client_id: key() });
  sendDirect(S, U("nova.keys"), U("rafi.listens").id, { body: "Ha! Start with 7th chords and you’re halfway there.", client_id: key() });
  sendDirect(S, U("rafi.listens"), U("nova.keys").id, { kind: "post_share", ref: { post_id: posts[7].id }, body: "Have you heard this blend?", client_id: key() });
  sendDirect(S, U("lumen.vox"), U("nova.keys").id, { body: "Thursday live: want me to jump on for a toplining segment?", client_id: key() });
  sendDirect(S, U("priya.plays"), U("juno.fm").id, { body: "Hi! Would love to send you a mix for the show.", client_id: key() });   // lands in Juno's requests
  sendDirect(S, U("free.followers.99"), U("rafi.listens").id, { body: "want 10k followers?? cheap", client_id: key() });
  const g = S.db.get("SELECT id FROM conversations WHERE id = ?", (() => {
    const cid = id("cv"); const t = now - 30 * H;
    S.db.run("INSERT INTO conversations (id, kind, title, created_by, last_message_at, created_at) VALUES (?,?,?,?,?,?)", cid, "group", "Thursday live crew", U("nova.keys").id, t, t);
    for (const [n, role] of [["nova.keys", "owner"], ["lumen.vox", "member"], ["dex.mixes", "member"], ["tape.theory", "member"]]) S.db.run("INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)", cid, U(n).id, role, "active", t);
    return cid;
  })());
  const conv = S.db.get("SELECT * FROM conversations WHERE id = ?", g.id);
  postMessage(S, conv, U("nova.keys"), { body: "Run of show for Thursday: 20 min build, 10 min vocals with Lumen, then mix notes from Dex.", client_id: key() });
  postMessage(S, conv, U("dex.mixes"), { body: "I’ll bring the reference tracks.", client_id: key() });
  postMessage(S, conv, U("lumen.vox"), { body: "🎤🎤", client_id: key() });

  // ---- Money: through real code paths, in test mode ----
  if (S.payments.name === "sandbox") {
    for (const [who, pack] of [["rafi.listens", "pack_1200"], ["priya.plays", "pack_550"]]) {
      const out = await purchaseCredits(S, U(who), { package_id: pack, idempotency_key: key() + key() });
      await sandboxPay(S, out.checkout.payment_id);
    }
    const p0 = posts.find((p) => p.author_id === U("nova.keys").id);
    for (const [sender, giftId, ctx] of [["rafi.listens", "gift_fire", "post"], ["rafi.listens", "gift_vinyl", "profile"], ["priya.plays", "gift_star", "post"], ["rafi.listens", "gift_flower", "profile"], ["priya.plays", "gift_heart", "profile"]]) {
      sendGift(S, U(sender), { gift_id: giftId, recipient_id: U("nova.keys").id, context_type: ctx, context_id: ctx === "post" ? p0.id : undefined, idempotency_key: key() + key() });
    }
    sendGift(S, U("rafi.listens"), { gift_id: "gift_star", recipient_id: U("mira.kaan").id, context_type: "profile", idempotency_key: key() + key() });
    const tip = await createDonation(S, U("priya.plays"), { recipient_id: U("nova.keys").id, amount_cents: 1500, message: "For the chord pack. Thank you!", context_type: "profile", idempotency_key: key() + key() });
    await sandboxPay(S, tip.checkout.payment_id);
    const tip2 = await createDonation(S, U("rafi.listens"), { recipient_id: U("nova.keys").id, amount_cents: 2500, message: "Keep the Thursday sessions coming", context_type: "profile", idempotency_key: key() + key() });
    await sandboxPay(S, tip2.checkout.payment_id);
    // Let part of Nova's earnings clear the hold so the Studio shows an available balance to withdraw
    S.db.run("UPDATE earnings SET available_at = ? WHERE creator_id = ? AND source_type = 'donation'", now - 1, U("nova.keys").id);
    S.db.run("UPDATE earnings SET available_at = ? WHERE id IN (SELECT id FROM earnings WHERE creator_id = ? AND source_type = 'gift' ORDER BY id LIMIT 2)", now - 1, U("nova.keys").id);
    releaseEarnings(S);
  }

  // ---- Reports (for the moderation queue) ----
  const spamPost = S.db.get("SELECT id FROM posts WHERE author_id = ? ORDER BY id DESC LIMIT 1", U("free.followers.99").id);
  for (const [who, reason, details] of [["rafi.listens", "spam", "Selling followers."], ["priya.plays", "spam", ""], ["mira.kaan", "scam", "Asks people to DM for paid followers."]]) {
    S.db.run("INSERT INTO reports (id, reporter_id, target_type, target_id, target_owner_id, reason, details, created_at) VALUES (?,?,?,?,?,?,?,?)", id("rp"), U(who).id, "post", spamPost.id, U("free.followers.99").id, reason, details, now - 2 * H);
  }
  S.db.run("INSERT INTO reports (id, reporter_id, target_type, target_id, target_owner_id, reason, details, created_at) VALUES (?,?,?,?,?,?,?,?)", id("rp"), U("rafi.listens").id, "user", U("free.followers.99").id, U("free.followers.99").id, "impersonation", "Spam DMs.", now - H);

  // Demo accounts sign in without passwords (development only) and count as verified
  S.db.run("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL");
  // ---- Stores (catalog, sellers, demo purchases) ----
  const storeCatalog = seedStoreCatalog(S, { log });
  await seedStoreActivity(S, storeCatalog, { log });

  S.limiter.setEnabled(limitsWereOn);
  S.limiter.reset();
  log(`seed: ${USERS.length} users, ${posts.length + 2} posts, ${STORIES.length} stories${hasMedia ? "" : " (no media)"}`);
}

export async function seedIfEmpty(S, opts) {
  if (S.db.get("SELECT COUNT(*) n FROM users").n > 0) {
    // A database from before the stores moved server-side: add the store catalog and demo activity only
    if (S.db.get("SELECT COUNT(*) n FROM store_genres").n === 0) {
      const limitsWereOn = S.limiter.enabled;
      S.limiter.setEnabled(false);
      try { const cat = seedStoreCatalog(S, opts); await seedStoreActivity(S, cat, opts); }
      finally { S.limiter.setEnabled(limitsWereOn); }
    }
    return false;
  }
  await seed(S, opts);
  return true;
}

// `node server/seed.js --reset` wipes the data directory and seeds a fresh database
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  const { loadConfig } = await import("./config.js");
  const cfg = loadConfig();
  if (process.argv.includes("--reset")) fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  const { createApp } = await import("./app.js");
  const app = await createApp({ quiet: false });
  await app.close();
  console.log("Seeded", cfg.dataDir);
}
