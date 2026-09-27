// Store catalog: read models for both marketplaces, search, and genre administration.
// Responses use the shapes the front end renders (camelCase view models); the database stays relational.
// Counters shown in the store = imported history from the seed catalog (data.imported) + live activity
// counted here (plays, favourites, paid sales, follows, verified reviews).
import { json } from "../../lib/db.js";
import { bad, notFound, HttpError } from "../../lib/http.js";
import { licensePriceCents, trackPriceCents, releasePriceCents } from "./pricing.js";

const DAY = 864e5;
const RELEASE_TYPES = ["single", "ep", "album", "remix", "compilation", "dj-tool"];
const FORMATS = ["WAV", "AIFF", "MP3"];

/* ------------------------------------------------------------------ helpers ------ */
const ph = (n) => new Array(n).fill("?").join(",");
const artOf = (S, mediaKey, d) => (mediaKey ? S.mediaUrl(mediaKey) : d.art ?? null);
function audioOut(a) {
  if (!a) return null;
  return { id: a.id, status: a.status, preview: a.preview_url, analysis: a.analysis_url, waveform: a.waveform_url, duration_ms: a.duration_ms, source: a.source };
}
const counts = (S, sql, ...args) => new Map(S.db.all(sql, ...args).map((r) => [r.k, r.n]));

/** Live counters for many items at once (no per-item queries). */
function liveStats(S, since = S.now() - 14 * DAY) {
  return {
    favs: counts(S, "SELECT kind || ':' || item_id k, COUNT(*) n FROM favorites GROUP BY kind, item_id"),
    sales: counts(S, `SELECT oi.kind || ':' || oi.item_id k, COUNT(*) n FROM order_items oi JOIN store_orders o ON o.id = oi.order_id WHERE o.status = 'paid' GROUP BY oi.kind, oi.item_id`),
    recentSales: counts(S, `SELECT oi.kind || ':' || oi.item_id k, COUNT(*) n FROM order_items oi JOIN store_orders o ON o.id = oi.order_id WHERE o.status = 'paid' AND o.paid_at > ? GROUP BY oi.kind, oi.item_id`, since),
    recentPlays: counts(S, "SELECT kind || ':' || item_id k, COUNT(*) n FROM plays WHERE created_at > ? GROUP BY kind, item_id", since),
    follows: counts(S, "SELECT target_kind || ':' || target_id k, COUNT(*) n FROM store_follows GROUP BY target_kind, target_id"),
    reviews: new Map(S.db.all("SELECT producer_id k, COUNT(*) n, SUM(rating) s FROM producer_reviews GROUP BY producer_id").map((r) => [r.k, r])),
    releaseSalesByTrack: counts(S, `SELECT t.id k, COUNT(*) n FROM order_items oi JOIN store_orders o ON o.id = oi.order_id JOIN tracks t ON t.release_id = oi.item_id
      WHERE o.status = 'paid' AND oi.kind = 'release' GROUP BY t.id`),
  };
}
const trend = (imp, st, key) => Math.round((imp.trendScore ?? 0) + 6 * (st.recentSales.get(key) ?? 0) + (st.recentPlays.get(key) ?? 0) / 5);

/* ------------------------------------------------------------------ view models -- */
export function licenseOut(l) {
  const d = json(l.data, {});
  return { id: l.id, name: l.name, short: l.short, price: l.price_cents / 100, price_cents: l.price_cents, exclusive: !!l.exclusive, formats: json(l.formats, []), files: d.files, summary: d.summary, terms: d.terms, popular: !!d.popular };
}
export function beatOut(S, b, ctx) {
  const d = json(b.data, {}), imp = d.imported ?? {}, st = ctx.stats, key = `beat:${b.id}`;
  const exclusiveHeld = b.exclusive_hold_until && b.exclusive_hold_until > S.now();
  return {
    id: b.id, kind: "beat", marketplace: "beats", status: b.status, slug: d.slug, title: b.title, producerId: b.producer_id, genre: b.genre_id,
    bpm: b.bpm, key: b.musical_key, moods: d.moods ?? [], tags: d.tags ?? [], duration: b.duration_sec, priceMult: b.price_mult,
    art: artOf(S, b.art_key, d), artStyle: d.art?.style, palette: d.art?.palette,
    plays: (imp.plays ?? 0) + b.play_count, likes: (imp.likes ?? 0) + (st.favs.get(key) ?? 0), sales: (imp.sales ?? 0) + (st.sales.get(key) ?? 0),
    trendScore: trend(imp, st, key), daysAgo: Math.max(0, Math.floor((S.now() - (b.published_at ?? b.created_at)) / DAY)),
    exclusiveAvailable: !!b.exclusive_available && b.status === "published" && !exclusiveHeld, freeDownload: !!b.free_download,
    description: d.description ?? "", credits: d.credits ?? [], contentId: d.contentId ?? "Not registered", stems: d.stems ?? [],
    prices: Object.fromEntries(ctx.licenses.map((l) => [l.id, licensePriceCents(l, b.price_mult)])),
    // Tiers that include stems need stems to deliver: catalog renders have them; uploads only if the producer added a stems .zip
    licensesAvailable: ctx.licenses.filter((l) => !json(l.formats, []).includes("STEMS") || stemsAvailable(ctx.audio.get(b.audio_id))).map((l) => l.id),
    audio: audioOut(ctx.audio.get(b.audio_id)),
  };
}
export const stemsAvailable = (a) => !!a && (a.source === "synth" || !!a.stems_media_id);
export function packOut(S, k, ctx) {
  const d = json(k.data, {});
  return {
    id: k.id, kind: "pack", marketplace: "beats", status: k.status, type: k.type, title: k.title, producerId: k.producer_id, genre: k.genre_id, bpm: k.bpm, key: k.musical_key,
    contents: d.contents, size: d.size, price: k.price_cents / 100, price_cents: k.price_cents, duration: d.duration ?? 75, formats: ["WAV"],
    art: artOf(S, k.art_key, d), terms: d.terms, audio: audioOut(ctx.audio.get(k.audio_id)),
  };
}
function producerOut(S, p, ctx) {
  const d = json(p.data, {}), imp = d.imported ?? {}, st = ctx.stats, rv = st.reviews.get(p.id);
  const beatIds = ctx.beatsByProducer.get(p.id) ?? [];
  const reviewCount = (imp.reviews ?? 0) + (rv?.n ?? 0);
  const rating = reviewCount ? ((imp.rating ?? 0) * (imp.reviews ?? 0) + (rv?.s ?? 0)) / reviewCount : null;
  const sales = (imp.sales ?? 0) + beatIds.reduce((s, id) => s + (st.sales.get(`beat:${id}`) ?? 0), 0);
  return {
    id: p.id, handle: p.handle, name: p.name, verified: !!p.verified, marketplace: "beats", kind: "producer", username: p.username ?? null, userId: p.user_id ?? null,
    location: d.location, palette: d.palette, since: d.since, bio: d.bio ?? "", genres: d.genres ?? [], responseTime: d.responseTime, socials: d.socials ?? {},
    avatar: d.avatar ?? null, banner: d.banner ?? null,
    followers: (imp.followers ?? 0) + (st.follows.get(`producer:${p.id}`) ?? 0), sales, rating: rating ? Math.round(rating * 10) / 10 : null, reviews: reviewCount,
    beatIds, totalBeats: beatIds.length,
  };
}
function labelOut(S, l, ctx) {
  const d = json(l.data, {}), imp = d.imported ?? {};
  return { id: l.id, kind: "label", marketplace: "electronic", name: l.name, verified: !!l.verified, mono: d.mono, prefix: d.prefix, city: d.city, founded: d.founded, palette: d.palette,
    genres: d.genres ?? [], bio: d.bio ?? "", banner: d.banner ?? null, followers: (imp.followers ?? 0) + (ctx.stats.follows.get(`label:${l.id}`) ?? 0),
    releaseIds: ctx.releasesByLabel.get(l.id) ?? [] };
}
function artistOut(S, a, ctx) {
  const d = json(a.data, {}), imp = d.imported ?? {};
  return { id: a.id, kind: "artist", marketplace: "electronic", name: a.name, handle: a.handle, verified: !!a.verified, username: a.username ?? null, userId: a.user_id ?? null, city: d.city, palette: d.palette,
    genres: d.genres ?? [], bio: d.bio ?? "", avatar: d.avatar ?? null, banner: d.banner ?? null,
    followers: (imp.followers ?? 0) + (ctx.stats.follows.get(`artist:${a.id}`) ?? 0), releaseIds: ctx.releasesByArtist.get(a.id) ?? [] };
}
function releaseOut(S, r, ctx) {
  const d = json(r.data, {});
  const trackIds = ctx.tracksByRelease.get(r.id) ?? [];
  const formats = json(r.formats, []);
  return { id: r.id, kind: "release", marketplace: "electronic", status: r.status, type: r.type, title: r.title, artistIds: ctx.releaseArtists.get(r.id) ?? [], labelId: r.label_id,
    cat: r.cat, upc: r.upc, date: r.release_date, genre: r.genre_id, art: artOf(S, r.art_key, d), palette: d.art?.palette, formats, trackIds, description: d.description ?? "",
    prices: Object.fromEntries(formats.map((f) => [f, releasePriceCents(trackIds.length, f)])) };
}
function trackOut(S, t, ctx) {
  const d = json(t.data, {}), imp = d.imported ?? {}, st = ctx.stats, key = `track:${t.id}`;
  const rel = ctx.releaseRows.get(t.release_id);
  const people = ctx.trackArtists.get(t.id) ?? { primary: [], remixer: [] };
  const a = ctx.audio.get(t.audio_id);
  const drop = json(a?.analysis, {}).cues?.find((c) => c.id === "B")?.time;
  return {
    id: t.id, kind: "track", marketplace: "electronic", status: t.status, releaseId: t.release_id, n: t.position, title: t.title, mix: t.mix,
    artistIds: people.primary, remixerId: people.remixer[0] ?? null, genre: t.genre_id, family: d.family, bpm: t.bpm, key: t.musical_key, camelot: t.camelot,
    duration: t.duration_sec, energy: t.energy, intro: d.intro ?? "", outro: d.outro ?? "", dropAt: Math.round(drop ?? d.dropAt ?? 0), explicit: !!t.explicit, isrc: t.isrc,
    labelId: rel?.label_id ?? null, date: rel?.release_date, art: rel ? artOf(S, rel.art_key, json(rel.data, {})) : null,
    plays: (imp.plays ?? 0) + t.play_count, downloads: (imp.downloads ?? 0) + (st.sales.get(key) ?? 0) + (st.releaseSalesByTrack.get(t.id) ?? 0),
    trendScore: trend(imp, st, key), prices: Object.fromEntries(FORMATS.map((f) => [f, trackPriceCents(f)])), audio: audioOut(a),
  };
}
const GENRE_FAMILIES = ["four", "techno", "trance", "afro", "minimal", "disco", "dnb", "halftime", "garage", "breaks", "synth", "downtempo", "ambient", "hardcore", "trap", "drill", "boombap", "rnb", "dembow", "lofi"];
function genreOut(g) {
  const d = json(g.data, {});
  return { id: g.id, name: g.name, marketplace: g.marketplace, bpm: g.bpm_lo ? [g.bpm_lo, g.bpm_hi] : null, family: g.family, palette: d.palette, style: d.style, order: g.position, visible: !!g.visible, count: d.count };
}

/* ------------------------------------------------------------------ context ------ */
/** Everything needed to serialise many items with a fixed number of queries. */
export function buildContext(S, { statuses = ["published"] } = {}) {
  const st = ph(statuses.length);
  const licenses = S.db.all("SELECT * FROM licenses ORDER BY position");
  const audio = new Map(S.db.all("SELECT * FROM audio_assets").map((a) => [a.id, a]));
  const beats = S.db.all(`SELECT b.*, m.storage_key art_key FROM beats b LEFT JOIN media m ON m.id = b.art_media_id WHERE b.status IN (${st}) ORDER BY COALESCE(b.published_at, b.created_at) DESC`, ...statuses);
  const packs = S.db.all(`SELECT k.*, m.storage_key art_key FROM packs k LEFT JOIN media m ON m.id = json_extract(k.data, '$.art_media_id') WHERE k.status IN (${st}) ORDER BY k.id`, ...statuses);
  const releases = S.db.all(`SELECT r.*, m.storage_key art_key FROM releases r LEFT JOIN media m ON m.id = r.art_media_id WHERE r.status IN (${st}) ORDER BY r.release_date DESC, r.id`, ...statuses);
  const relIds = new Set(releases.map((r) => r.id));
  const tracks = S.db.all(`SELECT * FROM tracks WHERE status IN (${st}) ORDER BY release_id, position`, ...statuses).filter((t) => relIds.has(t.release_id));
  const ctx = {
    licenses, audio, beats, packs, releases, tracks, stats: liveStats(S),
    releaseRows: new Map(releases.map((r) => [r.id, r])),
    beatsByProducer: new Map(), tracksByRelease: new Map(), releasesByLabel: new Map(), releasesByArtist: new Map(), releaseArtists: new Map(), trackArtists: new Map(),
  };
  const push = (m, k, v) => { const a = m.get(k) ?? []; if (!a.includes(v)) a.push(v); m.set(k, a); };
  beats.forEach((b) => push(ctx.beatsByProducer, b.producer_id, b.id));
  tracks.forEach((t) => push(ctx.tracksByRelease, t.release_id, t.id));
  releases.forEach((r) => r.label_id && push(ctx.releasesByLabel, r.label_id, r.id));
  for (const ra of S.db.all("SELECT * FROM release_artists ORDER BY position")) if (relIds.has(ra.release_id)) { push(ctx.releaseArtists, ra.release_id, ra.artist_id); push(ctx.releasesByArtist, ra.artist_id, ra.release_id); }
  const trackRel = new Map(tracks.map((t) => [t.id, t.release_id]));
  for (const ta of S.db.all("SELECT * FROM track_artists ORDER BY position")) {
    if (!trackRel.has(ta.track_id)) continue;
    const p = ctx.trackArtists.get(ta.track_id) ?? { primary: [], remixer: [], featured: [] };
    p[ta.role].push(ta.artist_id); ctx.trackArtists.set(ta.track_id, p);
    push(ctx.releasesByArtist, ta.artist_id, trackRel.get(ta.track_id));
  }
  return ctx;
}

/* ------------------------------------------------------------------ bootstrap ---- */
/**
 * The whole public catalog in one cacheable response (the catalog is small; list endpoints below
 * page and filter server-side for larger catalogs). Rebuilt when the catalog changes or after 30 s,
 * so counters stay fresh without rebuilding on every request.
 */
export function invalidateCatalog(S) { S.storeCache = null; }
export function bootstrap(S) {
  if (S.storeCache && S.now() - S.storeCache.at < 30_000) return S.storeCache;
  const ctx = buildContext(S);
  const genres = S.db.all("SELECT * FROM store_genres ORDER BY marketplace, position").map(genreOut);
  const payload = {
    version: S.now(),
    genres: { beats: genres.filter((g) => g.marketplace === "beats"), electronic: genres.filter((g) => g.marketplace === "electronic") },
    licenses: ctx.licenses.map(licenseOut),
    producers: S.db.all("SELECT p.*, u.username FROM producers p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id").map((p) => producerOut(S, p, ctx)),
    beats: ctx.beats.map((b) => beatOut(S, b, ctx)),
    packs: ctx.packs.map((k) => packOut(S, k, ctx)),
    labels: S.db.all("SELECT * FROM labels ORDER BY created_at, id").map((l) => labelOut(S, l, ctx)),
    artists: S.db.all("SELECT a.*, u.username FROM artists a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at, a.id").map((a) => artistOut(S, a, ctx)),
    releases: ctx.releases.map((r) => releaseOut(S, r, ctx)),
    tracks: ctx.tracks.map((t) => trackOut(S, t, ctx)),
    playlists: publicPlaylists(S),
    trendingSearches: trendingSearches(S),
    // Anonymous: which live item sold, which tier/format, when. No buyer data.
    recentSales: S.db.all(`SELECT oi.kind, oi.item_id, oi.license_id, oi.format, o.paid_at FROM order_items oi JOIN store_orders o ON o.id = oi.order_id
      WHERE o.status = 'paid' AND oi.kind IN ('beat', 'pack') ORDER BY o.paid_at DESC LIMIT 12`).map((r) => ({ kind: r.kind, itemId: r.item_id, licenseId: r.license_id, paidAt: r.paid_at })),
  };
  const body = JSON.stringify(payload);
  S.storeCache = { at: S.now(), body, etag: `W/"${payload.version.toString(36)}-${body.length.toString(36)}"` };
  return S.storeCache;
}
function publicPlaylists(S) {
  const lists = S.db.all(`SELECT pl.*, pr.id producer_id FROM playlists pl JOIN producers pr ON pr.user_id = pl.user_id WHERE pl.is_public = 1 AND pl.kind = 'beats' ORDER BY pl.created_at`);
  const items = S.db.all(`SELECT pi.* FROM playlist_items pi JOIN playlists pl ON pl.id = pi.playlist_id WHERE pl.is_public = 1 ORDER BY pi.position`);
  const live = new Set(S.db.all("SELECT id FROM beats WHERE status = 'published'").map((b) => b.id));
  return lists.map((p) => ({ id: p.id, title: p.title, by: p.producer_id, beatIds: items.filter((i) => i.playlist_id === p.id && live.has(i.item_id)).map((i) => i.item_id) }));
}
function trendingSearches(S) {
  const rows = S.db.all("SELECT query, COUNT(*) n FROM store_search_log WHERE created_at > ? AND results > 0 GROUP BY query ORDER BY n DESC, MAX(created_at) DESC LIMIT 8", S.now() - 7 * DAY);
  return rows.map((r) => r.query);
}

/* ------------------------------------------------------------------ search ------- */
const people = (S, ids) => ids.map((i) => i).join(" ");
/** Rebuild the search index rows for the published catalog (called after catalog changes; cheap at this size). */
export function reindexSearch(S) {
  S.db.tx(() => {
    S.db.run("DELETE FROM store_search");
    const ins = (kind, id, m, title, who, tags) => S.db.run("INSERT INTO store_search (kind, item_id, marketplace, title, people, tags) VALUES (?,?,?,?,?,?)", kind, id, m, title, who, tags);
    const g = new Map(S.db.all("SELECT id, name FROM store_genres").map((x) => [x.id, x.name]));
    for (const b of S.db.all("SELECT b.*, p.name pname FROM beats b JOIN producers p ON p.id = b.producer_id WHERE b.status = 'published'")) {
      const d = json(b.data, {});
      ins("beat", b.id, "beats", b.title, b.pname, [g.get(b.genre_id), b.musical_key, `${b.bpm} bpm`, ...(d.moods ?? []), ...(d.tags ?? [])].join(" "));
    }
    for (const k of S.db.all("SELECT k.*, p.name pname FROM packs k JOIN producers p ON p.id = k.producer_id WHERE k.status = 'published'")) ins("pack", k.id, "beats", k.title, k.pname, [k.type, g.get(k.genre_id)].join(" "));
    for (const p of S.db.all("SELECT * FROM producers")) ins("producer", p.id, "beats", p.name, p.handle, (json(p.data, {}).genres ?? []).map((x) => g.get(x) ?? x).join(" "));
    const artistNames = new Map(S.db.all("SELECT id, name FROM artists").map((a) => [a.id, a.name]));
    for (const t of S.db.all(`SELECT t.*, r.title rtitle, r.cat, l.name lname FROM tracks t JOIN releases r ON r.id = t.release_id LEFT JOIN labels l ON l.id = r.label_id WHERE t.status = 'published' AND r.status = 'published'`)) {
      const who = S.db.all("SELECT artist_id FROM track_artists WHERE track_id = ?", t.id).map((x) => artistNames.get(x.artist_id));
      ins("track", t.id, "electronic", `${t.title} ${t.mix}`, people(S, who), [g.get(t.genre_id), t.musical_key, t.camelot, `${Math.round(t.bpm)} bpm`, t.rtitle, t.cat, t.lname].join(" "));
    }
    for (const r of S.db.all("SELECT r.*, l.name lname FROM releases r LEFT JOIN labels l ON l.id = r.label_id WHERE r.status = 'published'")) {
      const who = S.db.all("SELECT artist_id FROM release_artists WHERE release_id = ?", r.id).map((x) => artistNames.get(x.artist_id));
      ins("release", r.id, "electronic", r.title, people(S, who), [r.type, r.cat, r.lname, g.get(r.genre_id)].join(" "));
    }
    for (const a of S.db.all("SELECT * FROM artists")) ins("artist", a.id, "electronic", a.name, a.handle, (json(a.data, {}).genres ?? []).map((x) => g.get(x) ?? x).join(" "));
    for (const l of S.db.all("SELECT * FROM labels")) ins("label", l.id, "electronic", l.name, "", (json(l.data, {}).genres ?? []).map((x) => g.get(x) ?? x).join(" "));
  });
}
/** Full-text search across the stores. Terms are quoted so user input can never inject FTS syntax. */
export function searchStore(S, { q, marketplace, limit = 8, log = true }) {
  const terms = String(q ?? "").toLowerCase().normalize("NFKC").replace(/["*^:()]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return { query: "", groups: {} };
  if (marketplace && !["beats", "electronic"].includes(marketplace)) throw bad("invalid_marketplace", "Unknown marketplace.");
  const match = terms.map((t) => `"${t}"*`).join(" ");
  const rows = S.db.all(`SELECT kind, item_id, marketplace, bm25(store_search, 0, 0, 0, 8, 4, 1) score FROM store_search WHERE store_search MATCH ? ${marketplace ? "AND marketplace = ?" : ""} ORDER BY score LIMIT 400`,
    ...(marketplace ? [match, marketplace] : [match]));
  const groups = {};
  for (const r of rows) { const g = (groups[r.kind] ??= []); if (g.length < Math.min(50, limit)) g.push(r.item_id); }
  const clean = terms.join(" ").slice(0, 80);
  if (log && clean.length >= 2) S.db.run("INSERT INTO store_search_log (marketplace, query, results, created_at) VALUES (?,?,?,?)", marketplace ?? null, clean, rows.length, S.now());
  return { query: clean, total: rows.length, groups };
}

/* ------------------------------------------------------------------ routes ------- */
const intParam = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
function page(items, query) {
  const limit = intParam(query.limit, 1, 100, 24), offset = intParam(query.offset, 0, 1e6, 0);
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, next_offset: offset + limit < items.length ? offset + limit : null };
}

export function register(r, S) {
  r.get("/api/store/bootstrap", ({ req, res }) => {
    const c = bootstrap(S);
    if (req.headers["if-none-match"] === c.etag) { res.writeHead(304, { ETag: c.etag }); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ETag: c.etag, "Content-Length": Buffer.byteLength(c.body) });
    res.end(c.body);
  }, { public: true });

  // Beats with server-side filtering, sorting and pagination
  r.get("/api/store/beats", ({ query }) => {
    const ctx = buildContext(S);
    let list = ctx.beats.map((b) => beatOut(S, b, ctx));
    if (query.genre) { const gs = String(query.genre).split(","); list = list.filter((b) => gs.includes(b.genre)); }
    if (query.producer) list = list.filter((b) => b.producerId === query.producer);
    if (query.bpm_min) list = list.filter((b) => b.bpm >= Number(query.bpm_min));
    if (query.bpm_max) list = list.filter((b) => b.bpm <= Number(query.bpm_max));
    if (query.key) list = list.filter((b) => b.key === query.key);
    if (query.mood) list = list.filter((b) => b.moods.includes(query.mood));
    if (query.max_price) list = list.filter((b) => b.prices.basic <= Number(query.max_price) * 100);
    if (query.free === "1") list = list.filter((b) => b.freeDownload);
    if (query.q) { const hit = new Set(searchStore(S, { q: query.q, marketplace: "beats", limit: 50, log: false }).groups.beat ?? []); list = list.filter((b) => hit.has(b.id)); }
    const sorts = { trending: (a, b) => b.trendScore - a.trendScore, newest: (a, b) => a.daysAgo - b.daysAgo, plays: (a, b) => b.plays - a.plays,
      price_asc: (a, b) => a.prices.basic - b.prices.basic, price_desc: (a, b) => b.prices.basic - a.prices.basic, bpm: (a, b) => a.bpm - b.bpm };
    if (query.sort && !sorts[query.sort]) throw bad("invalid_sort", `Sort by one of: ${Object.keys(sorts).join(", ")}.`);
    list.sort(sorts[query.sort ?? "trending"]);
    return page(list, query);
  }, { public: true });

  // Tracks: BPM range, Camelot key (optionally harmonic neighbours), energy, genre, label, release type
  r.get("/api/store/tracks", ({ query }) => {
    const ctx = buildContext(S);
    let list = ctx.tracks.map((t) => trackOut(S, t, ctx));
    const rel = (t) => ctx.releaseRows.get(t.releaseId);
    if (query.genre) { const gs = String(query.genre).split(","); list = list.filter((t) => gs.includes(t.genre)); }
    if (query.bpm_min) list = list.filter((t) => t.bpm >= Number(query.bpm_min));
    if (query.bpm_max) list = list.filter((t) => t.bpm <= Number(query.bpm_max));
    if (query.energy_min) list = list.filter((t) => t.energy >= Number(query.energy_min));
    if (query.label) list = list.filter((t) => t.labelId === query.label);
    if (query.type) { if (!RELEASE_TYPES.includes(query.type)) throw bad("invalid_type", "Unknown release type."); list = list.filter((t) => rel(t).type === query.type); }
    if (query.camelot) {
      const code = String(query.camelot).toUpperCase();
      if (!/^(1[0-2]|[1-9])[AB]$/.test(code)) throw bad("invalid_key", "Camelot keys look like 8A or 11B.");
      const n = parseInt(code, 10), l = code.slice(-1), wrap = (x) => ((x + 11) % 12) + 1;
      const ok = query.harmonic === "1" ? [code, wrap(n - 1) + l, wrap(n + 1) + l, n + (l === "A" ? "B" : "A")] : [code];
      list = list.filter((t) => ok.includes(t.camelot));
    }
    if (query.q) { const hit = new Set(searchStore(S, { q: query.q, marketplace: "electronic", limit: 50, log: false }).groups.track ?? []); list = list.filter((t) => hit.has(t.id)); }
    const sorts = { trending: (a, b) => b.trendScore - a.trendScore, newest: (a, b) => String(b.date).localeCompare(String(a.date)), downloads: (a, b) => b.downloads - a.downloads,
      bpm: (a, b) => a.bpm - b.bpm, energy: (a, b) => b.energy - a.energy };
    if (query.sort && !sorts[query.sort]) throw bad("invalid_sort", `Sort by one of: ${Object.keys(sorts).join(", ")}.`);
    list.sort(sorts[query.sort ?? "trending"]);
    return page(list, query);
  }, { public: true });

  r.get("/api/store/beats/:id", ({ params }) => {
    const ctx = buildContext(S);
    const b = ctx.beats.find((x) => x.id === params.id);
    if (!b) throw notFound("That beat isn’t available.");
    const reviews = S.db.all(`SELECT rv.id, rv.rating, rv.body, rv.created_at, u.display_name, u.username, oi.item_id beat_id FROM producer_reviews rv JOIN users u ON u.id = rv.user_id
      JOIN order_items oi ON oi.id = rv.order_item_id WHERE rv.producer_id = ? ORDER BY rv.created_at DESC LIMIT 20`, b.producer_id);
    return { beat: beatOut(S, b, ctx), licenses: ctx.licenses.map(licenseOut), reviews };
  }, { public: true });

  r.get("/api/store/releases/:id", ({ params }) => {
    const ctx = buildContext(S);
    const rel = ctx.releaseRows.get(params.id);
    if (!rel) throw notFound("That release isn’t available.");
    return { release: releaseOut(S, rel, ctx), tracks: ctx.tracks.filter((t) => t.release_id === rel.id).map((t) => trackOut(S, t, ctx)) };
  }, { public: true });

  r.get("/api/store/producers/:handle", ({ params }) => {
    const p = S.db.get("SELECT p.*, u.username FROM producers p LEFT JOIN users u ON u.id = p.user_id WHERE p.handle = ?", params.handle);
    if (!p) throw notFound("No producer with that handle.");
    const ctx = buildContext(S);
    const reviews = S.db.all(`SELECT rv.id, rv.rating, rv.body, rv.created_at, u.display_name, u.username, oi.item_id beat_id FROM producer_reviews rv JOIN users u ON u.id = rv.user_id
      JOIN order_items oi ON oi.id = rv.order_item_id WHERE rv.producer_id = ? ORDER BY rv.created_at DESC LIMIT 50`, p.id);
    return { producer: producerOut(S, p, ctx), beats: ctx.beats.filter((b) => b.producer_id === p.id).map((b) => beatOut(S, b, ctx)), reviews };
  }, { public: true });

  r.get("/api/store/search", ({ query }) => {
    const out = searchStore(S, { q: String(query.q ?? "").slice(0, 200), marketplace: query.marketplace || undefined, limit: intParam(query.limit, 1, 50, 8) });
    return out;
  }, { public: true });

  /* ----- Genre taxonomy administration (admins) ----- */
  r.get("/api/store/admin/genres", () => ({ genres: S.db.all("SELECT * FROM store_genres ORDER BY marketplace, position").map(genreOut) }), { role: "admin" });
  r.patch("/api/store/admin/genres/:id", ({ params, body }) => {
    const g = S.db.get("SELECT * FROM store_genres WHERE id = ?", params.id);
    if (!g) throw notFound("No such genre.");
    const name = body.name != null ? String(body.name).trim() : g.name;
    if (!name || name.length > 40) throw bad("invalid_name", "Genre names are 1–40 characters.");
    const visible = body.visible != null ? (body.visible ? 1 : 0) : g.visible;
    const position = body.position != null ? intParam(body.position, 0, 999, g.position) : g.position;
    const lo = body.bpm_lo != null ? intParam(body.bpm_lo, 40, 250, g.bpm_lo) : g.bpm_lo, hi = body.bpm_hi != null ? intParam(body.bpm_hi, 40, 250, g.bpm_hi) : g.bpm_hi;
    if (lo != null && hi != null && lo > hi) throw bad("invalid_bpm", "The BPM range is reversed.");
    const family = body.family != null ? String(body.family) : g.family;
    if (family !== g.family && !GENRE_FAMILIES.includes(family)) throw bad("invalid_family", "Unknown preview pattern.");
    S.db.run("UPDATE store_genres SET name = ?, visible = ?, position = ?, bpm_lo = ?, bpm_hi = ?, family = ?, updated_at = ? WHERE id = ?", name, visible, position, lo, hi, family, S.now(), g.id);
    invalidateCatalog(S); reindexSearch(S);
    return { genre: genreOut(S.db.get("SELECT * FROM store_genres WHERE id = ?", g.id)) };
  }, { role: "admin" });
  r.post("/api/store/admin/genres", ({ body }) => {
    const name = String(body.name ?? "").trim();
    const marketplace = body.marketplace === "beats" ? "beats" : "electronic";
    if (!name || name.length > 40) throw bad("invalid_name", "Genre names are 1–40 characters.");
    const id = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    if (!id) throw bad("invalid_name", "Use letters or numbers in the name.");
    if (S.db.get("SELECT 1 FROM store_genres WHERE id = ?", id)) throw new HttpError(409, "genre_exists", "A genre with that name already exists.");
    const lo = intParam(body.bpm_lo, 40, 250, 100), hi = intParam(body.bpm_hi, 40, 250, 140);
    if (lo > hi) throw bad("invalid_bpm", "The BPM range is reversed.");
    const pos = (S.db.get("SELECT MAX(position) m FROM store_genres WHERE marketplace = ?", marketplace).m ?? 0) + 1;
    S.db.run("INSERT INTO store_genres (id, marketplace, name, bpm_lo, bpm_hi, family, position, visible, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      id, marketplace, name, lo, hi, GENRE_FAMILIES.includes(body.family) ? body.family : "four", pos, 1, JSON.stringify({ palette: "graphite", style: "rings" }), S.now(), S.now());
    invalidateCatalog(S);
    return { genre: genreOut(S.db.get("SELECT * FROM store_genres WHERE id = ?", id)) };
  }, { role: "admin" });
}
