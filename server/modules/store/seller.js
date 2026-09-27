// Seller tools for both stores: analytics computed from real orders and plays, the seller's own catalog,
// and uploads. An upload is a private lossless master; the audio worker analyses it on the server
// (STFT waveform, BPM grid, key, structure), cuts an MP3 preview, and only then can the item go live.
import fs from "node:fs";
import path from "node:path";
import { id } from "../../lib/ids.js";
import { json } from "../../lib/db.js";
import { bad, notFound, forbidden, HttpError, sendFile } from "../../lib/http.js";
import { notify } from "../notifications.js";
import { balances } from "../wallet.js";
import { invalidateCatalog, reindexSearch } from "./catalog.js";
import { requireVerifiedEmail } from "../auth.js";
import { plain } from "../../lib/text.js";

const DAY = 864e5;
const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"].flatMap((n) => [`${n} maj`, `${n} min`]);
const MOODS = ["Dark", "Energetic", "Chill", "Melancholic", "Romantic", "Aggressive", "Uplifting", "Dreamy", "Bouncy", "Cinematic"];
const RELEASE_TYPES = ["single", "ep", "album", "remix", "compilation", "dj-tool"];
const ART_STYLES = ["sun", "stripes", "bloom", "rings", "monolith", "shards", "grid", "waves", "bars", "horizon"];
const ART_PALETTES = ["violet", "ice", "gold", "blood", "rose", "chrome", "acid", "dusk", "ember", "jade", "ocean", "mono", "electric", "graphite", "ultra", "acidnight"];
const CAM_MIN = { 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7, 9: 8, 4: 9, 11: 10, 6: 11, 1: 12 }, CAM_MAJ = { 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7, 0: 8, 7: 9, 2: 10, 9: 11, 4: 12 };
export function camelot(key) {
  const m = /^([A-G])([♯#♭b]?)\s*(maj|min)/.exec(key || ""); if (!m) return "";
  const s = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "♯" || m[2] === "#" ? 1 : m[2] === "♭" || m[2] === "b" ? -1 : 0) + 12) % 12;
  return m[3] === "min" ? CAM_MIN[s] + "A" : CAM_MAJ[s] + "B";
}
const str = (v, max, name, min = 1) => { const s = plain(v).trim().replace(/\s+/g, " "); if (s.length < min || s.length > max) throw bad(`invalid_${name}`, `${name.replace(/_/g, " ")} must be ${min}–${max} characters.`); return s; };
const optInt = (v, lo, hi, name) => { if (v == null || v === "") return null; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`invalid_${name}`, `${name} must be between ${lo} and ${hi}.`); return n; };
const list = (v, max, allowed) => (Array.isArray(v) ? v : []).map((x) => plain(x).trim()).filter((x) => x && (!allowed || allowed.includes(x))).slice(0, max);

/* ------------------------------------------------------------------ identity ----- */
function producerFor(S, user, create) {
  let p = S.db.get("SELECT * FROM producers WHERE user_id = ?", user.id);
  if (!p && create) {
    const handle = user.username.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32) || `producer${user.id.slice(-6)}`;
    if (S.db.get("SELECT 1 FROM producers WHERE handle = ?", handle)) throw new HttpError(409, "handle_taken", "Your producer handle is taken. Contact support.");
    S.db.run("INSERT INTO producers (id, user_id, handle, name, verified, data, created_at) VALUES (?,?,?,?,0,?,?)", id("pr"), user.id, handle, plain(user.display_name).slice(0, 60), JSON.stringify({ bio: plain(user.bio), since: new Date(S.now()).getUTCFullYear(), genres: [] }), S.now());
    p = S.db.get("SELECT * FROM producers WHERE user_id = ?", user.id);
    invalidateCatalog(S);
  }
  return p;
}
function artistFor(S, user, create) {
  let a = S.db.get("SELECT * FROM artists WHERE user_id = ?", user.id);
  if (!a && create) {
    const handle = user.username.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32) || `artist${user.id.slice(-6)}`;
    if (S.db.get("SELECT 1 FROM artists WHERE handle = ?", handle)) throw new HttpError(409, "handle_taken", "Your artist handle is taken. Contact support.");
    S.db.run("INSERT INTO artists (id, user_id, handle, name, verified, data, created_at) VALUES (?,?,?,?,0,?,?)", id("ar"), user.id, handle, plain(user.display_name).slice(0, 60), JSON.stringify({ bio: plain(user.bio), genres: [] }), S.now());
    a = S.db.get("SELECT * FROM artists WHERE user_id = ?", user.id);
    invalidateCatalog(S);
  }
  return a;
}
/** Releases this account manages: its labels' releases and its own independent ones. */
const managedReleaseIds = (S, userId) => S.db.all("SELECT r.id FROM releases r LEFT JOIN labels l ON l.id = r.label_id WHERE r.owner_id = ? OR l.owner_id = ?", userId, userId).map((x) => x.id);

/* ------------------------------------------------------------------ analytics ---- */
export function dashboard(S, userId, marketplace, now = S.now()) {
  const lines = S.db.all(`SELECT oi.*, o.paid_at, o.status ostatus, o.id oid, c.country, c.user_id buyer_id FROM order_items oi JOIN store_orders o ON o.id = oi.order_id JOIN store_checkouts c ON c.id = o.checkout_id
    WHERE oi.seller_user_id = ? AND o.marketplace = ? AND o.status IN ('paid','refunded') ORDER BY o.paid_at DESC`, userId, marketplace);
  const paidLines = lines.filter((l) => l.ostatus === "paid");   // refunded sales are listed but never counted as revenue
  const itemIds = marketplace === "beats"
    ? S.db.all("SELECT b.id, 'beat' kind FROM beats b JOIN producers p ON p.id = b.producer_id WHERE p.user_id = ? UNION ALL SELECT k.id, 'pack' FROM packs k JOIN producers p ON p.id = k.producer_id WHERE p.user_id = ?", userId, userId)
    : S.db.all(`SELECT t.id, 'track' kind FROM tracks t WHERE t.release_id IN (${managedReleaseIds(S, userId).map(() => "?").join(",") || "NULL"})`, ...managedReleaseIds(S, userId));
  const playRows = itemIds.length ? S.db.all(`SELECT created_at FROM plays WHERE created_at > ? AND (kind || ':' || item_id) IN (${itemIds.map(() => "?").join(",")})`, now - 30 * DAY, ...itemIds.map((i) => `${i.kind}:${i.id}`)) : [];
  const inWindow = (a, b) => paidLines.filter((l) => l.paid_at > now - a * DAY && l.paid_at <= now - b * DAY);
  const sum = (ls, k) => ls.reduce((s, l) => s + l[k], 0);
  const cur = inWindow(30, 0), prev = inWindow(60, 30);
  // 12 calendar months ending with the current month
  const months = [];
  const d0 = new Date(now);
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)); months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), net_cents: 0, units: 0 }); }
  for (const l of paidLines) { const m = months.find((x) => x.key === new Date(l.paid_at).toISOString().slice(0, 7)); if (m) { m.net_cents += l.seller_cents; m.units++; } }
  const daily = Array.from({ length: 30 }, (_, i) => { const start = now - (30 - i) * DAY; return { day: new Date(start + DAY).toISOString().slice(0, 10), net_cents: 0, plays: 0, start }; });
  for (const l of cur) { const d = daily.find((x) => l.paid_at > x.start && l.paid_at <= x.start + DAY); if (d) d.net_cents += l.seller_cents; }
  for (const p of playRows) { const d = daily.find((x) => p.created_at > x.start && p.created_at <= x.start + DAY); if (d) d.plays++; }
  const mix = (key) => { const m = new Map(); for (const l of paidLines) if (l[key]) m.set(l[key], (m.get(l[key]) ?? 0) + 1); const tot = [...m.values()].reduce((a, b) => a + b, 0) || 1; return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, count: n, share: Math.round((n / tot) * 100) })); };
  const buyers = new Map();
  for (const l of paidLines) { const b = buyers.get(l.buyer_id) ?? { id: l.buyer_id, orders: new Set(), spent_cents: 0, last: 0 }; b.orders.add(l.oid); b.spent_cents += l.paid_cents; b.last = Math.max(b.last, l.paid_at); buyers.set(l.buyer_id, b); }
  const names = new Map(buyers.size ? S.db.all(`SELECT id, display_name, username FROM users WHERE id IN (${[...buyers.keys()].map(() => "?").join(",")})`, ...buyers.keys()).map((u) => [u.id, u]) : []);
  const top = new Map();
  for (const l of paidLines) { const t = top.get(`${l.kind}:${l.item_id}`) ?? { kind: l.kind, item_id: l.item_id, title: l.title.split(" — ")[0].split(" · ")[0], units: 0, net_cents: 0 }; t.units++; t.net_cents += l.seller_cents; top.set(`${l.kind}:${l.item_id}`, t); }
  return {
    marketplace, generated_at: now,
    kpis: {
      net_cents_30d: sum(cur, "seller_cents"), net_cents_prev_30d: sum(prev, "seller_cents"), gross_cents_30d: sum(cur, "paid_cents"), fees_cents_30d: sum(cur, "fee_cents"),
      orders_30d: new Set(cur.map((l) => l.oid)).size, units_30d: cur.length, plays_30d: playRows.length,
      conversion_pct: playRows.length ? Math.round((cur.length / playRows.length) * 10000) / 100 : null, lifetime_net_cents: sum(paidLines, "seller_cents"), lifetime_units: paidLines.length,
    },
    revenue_12m: months, daily_30: daily.map(({ start, ...d }) => d),
    license_mix: marketplace === "beats" ? mix("license_id") : [], format_mix: marketplace === "electronic" ? mix("format") : [],
    geo: (() => { const m = new Map(); for (const l of paidLines) m.set(l.country, (m.get(l.country) ?? 0) + 1); const tot = paidLines.length || 1; return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ country: k, count: n, share: Math.round((n / tot) * 100) })); })(),
    top_items: [...top.values()].sort((a, b) => b.net_cents - a.net_cents).slice(0, 10),
    recent_orders: lines.slice(0, 25).map((l) => ({ order_id: l.oid, item_id: l.item_id, kind: l.kind, title: l.title, license_id: l.license_id, format: l.format, paid_cents: l.paid_cents, net_cents: l.seller_cents,
      buyer: names.get(l.buyer_id)?.display_name ?? "Customer", date: l.paid_at, status: l.ostatus })),
    customers: [...buyers.values()].sort((a, b) => b.spent_cents - a.spent_cents).slice(0, 10).map((b) => ({ name: names.get(b.id)?.display_name ?? "Customer", username: names.get(b.id)?.username, orders: b.orders.size, spent_cents: b.spent_cents, last: b.last })),
    balances: balances(S, userId),
  };
}

/* ------------------------------------------------------------------ ingest ------- */
function publicAudioDir(S, assetId) { return path.join(S.privateDir, "audio-public", assetId); }
function masterFile(S, userId, mediaId) {
  const m = S.db.get("SELECT * FROM media WHERE id = ? AND owner_id = ? AND access = 'private' AND kind = 'audio' AND status = 'ready'", String(mediaId ?? ""), userId);
  if (!m || !["audio/wav", "audio/aiff"].includes(m.mime)) throw bad("invalid_master", "Upload the master as a WAV or AIFF file first.");
  return m;
}
function stemsMedia(S, userId, mediaId) {
  if (!mediaId) return null;
  const m = S.db.get("SELECT * FROM media WHERE id = ? AND owner_id = ? AND access = 'private' AND mime = 'application/zip' AND status = 'ready'", String(mediaId), userId);
  if (!m) throw bad("invalid_stems", "Upload the stems as a .zip archive first.");
  return m;
}
function artworkMedia(S, userId, mediaId) {
  if (!mediaId) return null;
  const m = S.db.get("SELECT * FROM media WHERE id = ? AND owner_id = ? AND access = 'public' AND kind = 'image' AND status = 'ready'", String(mediaId), userId);
  if (!m) throw bad("invalid_artwork", "Upload the artwork image first.");
  if (m.width < 500 || m.height < 500 || Math.abs(m.width - m.height) > m.width * 0.02) throw bad("invalid_artwork", "Artwork must be square and at least 500 × 500 px (3000 × 3000 recommended).");
  return m;
}
function createAsset(S, userId, master, stems) {
  const aid = id("aa"), now = S.now();
  S.db.run(`INSERT INTO audio_assets (id, owner_id, source, master_media_id, stems_media_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`, aid, userId, "upload", master.id, stems?.id ?? null, "processing", now, now);
  return aid;
}
/** The genre's typical tempo range, widened 10% each way, to guide beat detection when no BPM is declared. */
function genreRange(S, genreId) {
  const g = genreId && S.db.get("SELECT bpm_lo, bpm_hi FROM store_genres WHERE id = ?", genreId);
  return g?.bpm_lo && g?.bpm_hi ? [Math.max(40, Math.floor(g.bpm_lo * 0.9)), Math.min(250, Math.ceil(g.bpm_hi * 1.1))] : null;
}
/** Analyse an uploaded master in the worker pool, then run onDone(meta) or onFail(message). */
function ingest(S, assetId, { bpm, genreId = null, onDone, onFail }) {
  const a = S.db.get("SELECT a.*, m.storage_key FROM audio_assets a JOIN media m ON m.id = a.master_media_id WHERE a.id = ?", assetId);
  const job = { op: "ingest", id: "clip", file: path.join(S.privateDir, a.storage_key), outDir: publicAudioDir(S, assetId), publicPrefix: `/api/store/audio/${assetId}`, bpm: bpm ?? null, bpmRange: genreRange(S, genreId) };
  S.audio.run(job).then(({ meta }) => {
    if (S.closed) return;
    S.db.run(`UPDATE audio_assets SET status = 'ready', error = NULL, sample_rate = ?, channels = ?, bit_depth = ?, duration_ms = ?, preview_url = ?, analysis_url = ?, waveform_url = ?, analysis = ?, updated_at = ? WHERE id = ?`,
      meta.sampleRate, meta.channels, meta.bitDepth, Math.round(meta.duration * 1000), `/api/store/audio/${assetId}/preview.mp3`, `/api/store/audio/${assetId}/analysis.json`, `/api/store/audio/${assetId}/waveform.wf`,
      JSON.stringify({ bpm: meta.bpm, key: meta.key, cues: meta.cues, gridReliable: meta.gridReliable, beatConfidence: meta.beatConfidence }), S.now(), assetId);
    onDone(meta);
    invalidateCatalog(S); reindexSearch(S);
  }).catch((err) => {
    if (S.closed) return;
    S.db.run("UPDATE audio_assets SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", String(err.message).slice(0, 300), S.now(), assetId);
    onFail(err.message);
  });
}

/* ------------------------------------------------------------------ routes ------- */
export function register(r, S) {
  // Public preview/analysis for uploaded audio: only once the item is live (owners can always preview)
  r.get("/api/store/audio/:asset/:file", ({ params, user, req, res }) => {
    const files = { "preview.mp3": ["clip.mp3", "audio/mpeg"], "analysis.json": ["clip.json", "application/json"], "waveform.wf": ["clip.wf", "application/octet-stream"] };
    const f = files[params.file];
    const a = /^aa_[\w]+$/.test(params.asset) && S.db.get("SELECT * FROM audio_assets WHERE id = ? AND source = 'upload' AND status = 'ready'", params.asset);
    if (!f || !a) throw notFound();
    const live = S.db.get(`SELECT 1 FROM beats WHERE audio_id = ?1 AND status = 'published' UNION ALL SELECT 1 FROM tracks t JOIN releases r ON r.id = t.release_id WHERE t.audio_id = ?1 AND t.status = 'published' AND r.status = 'published'`, a.id);
    if (!live && a.owner_id !== user?.id) throw notFound();
    const ok = sendFile(req, res, path.join(publicAudioDir(S, a.id), f[0]), { type: f[1], cache: live ? "public, max-age=3600" : "private, no-store" });
    if (!ok) throw notFound();
  }, { public: true });

  r.get("/api/seller/dashboard", ({ user, query }) => {
    const m = query.marketplace === "electronic" ? "electronic" : "beats";
    return dashboard(S, user.id, m);
  });

  r.get("/api/seller/catalog", ({ user }) => {
    const p = producerFor(S, user, false);
    const rels = managedReleaseIds(S, user.id);
    const assets = (ids) => new Map(ids.filter(Boolean).length ? S.db.all(`SELECT id, status, error, analysis, duration_ms FROM audio_assets WHERE id IN (${ids.filter(Boolean).map(() => "?").join(",")})`, ...ids.filter(Boolean)).map((a) => [a.id, a]) : []);
    const beats = p ? S.db.all("SELECT * FROM beats WHERE producer_id = ? ORDER BY created_at DESC", p.id) : [];
    const tracks = rels.length ? S.db.all(`SELECT * FROM tracks WHERE release_id IN (${rels.map(() => "?").join(",")}) ORDER BY release_id, position`, ...rels) : [];
    const am = assets([...beats.map((b) => b.audio_id), ...tracks.map((t) => t.audio_id)]);
    const audioOut = (aid) => { const a = am.get(aid); return a ? { status: a.status, error: a.error, analysis: json(a.analysis, {}), duration_ms: a.duration_ms } : null; };
    return {
      producer: p ? { id: p.id, handle: p.handle, name: p.name } : null,
      beats: beats.map((b) => ({ id: b.id, title: b.title, status: b.status, genre: b.genre_id, bpm: b.bpm, key: b.musical_key, price_mult: b.price_mult, exclusive_available: !!b.exclusive_available, free_download: !!b.free_download, created_at: b.created_at, audio: audioOut(b.audio_id) })),
      releases: rels.length ? S.db.all(`SELECT * FROM releases WHERE id IN (${rels.map(() => "?").join(",")}) ORDER BY release_date DESC`, ...rels).map((rl) => ({ id: rl.id, title: rl.title, type: rl.type, status: rl.status, cat: rl.cat, release_date: rl.release_date, label_id: rl.label_id,
        tracks: tracks.filter((t) => t.release_id === rl.id).map((t) => ({ id: t.id, title: t.title, mix: t.mix, status: t.status, bpm: t.bpm, key: t.musical_key, audio: audioOut(t.audio_id) })) })) : [],
      labels: S.db.all("SELECT id, name FROM labels WHERE owner_id = ?", user.id),
    };
  });

  /* ----- Producer storefront profile (the handle is permanent: it's in every beat URL) ----- */
  const PALETTES = ["violet", "ice", "gold", "blood", "rose", "chrome", "acid", "dusk", "ember", "jade", "ocean", "mono"];
  r.patch("/api/seller/producer", ({ user, body }) => {
    const p = producerFor(S, user, false);
    if (!p) throw notFound("You don’t have a producer storefront yet. Upload a beat to create one.");
    const d = json(p.data, {});
    const name = body.name != null ? str(body.name, 60, "name") : p.name;
    if (body.bio != null) d.bio = plain(body.bio).trim().slice(0, 400);
    if (body.location != null) d.location = plain(body.location).trim().slice(0, 60);
    if (body.palette != null) { if (!PALETTES.includes(body.palette)) throw bad("invalid_palette", "Choose one of the theme colours."); d.palette = body.palette; }
    if (body.socials != null) {
      const s = body.socials ?? {};
      d.socials = { instagram: plain(s.instagram).trim().slice(0, 60), youtube: plain(s.youtube).trim().slice(0, 60), site: String(s.site ?? "").trim().replace(/^https?:\/\//, "").slice(0, 100) };
      if (d.socials.site && !/^[\w.-]+\.[a-z]{2,}(\/[\w./-]*)?$/i.test(d.socials.site)) throw bad("invalid_site", "Enter a website like example.com.");
    }
    S.db.run("UPDATE producers SET name = ?, data = ? WHERE id = ?", name, JSON.stringify(d), p.id);
    invalidateCatalog(S); reindexSearch(S);
    return { producer: { id: p.id, handle: p.handle, name, bio: d.bio, location: d.location, palette: d.palette, socials: d.socials } };
  });

  /* ----- Beats ----- */
  r.post("/api/seller/beats", ({ user, body }) => {
    requireVerifiedEmail(user);
    S.limiter.take("upload", user.id);
    const title = str(body.title, 80, "title");
    const genre = S.db.get("SELECT id FROM store_genres WHERE id = ? AND marketplace = 'beats'", String(body.genre ?? ""));
    if (!genre) throw bad("invalid_genre", "Choose a Beats Store genre.");
    const bpm = optInt(body.bpm, 40, 250, "bpm");
    const key = body.key ? String(body.key) : null;
    if (key && !KEYS.includes(key)) throw bad("invalid_key", "Choose a key like “F min” or “C maj”.");
    const priceMult = body.price_mult != null ? Number(body.price_mult) : 1;
    if (!(priceMult >= 0.5 && priceMult <= 5)) throw bad("invalid_price", "The price multiplier must be between 0.5× and 5×.");
    const master = masterFile(S, user.id, body.master_media_id), stems = stemsMedia(S, user.id, body.stems_media_id), art = artworkMedia(S, user.id, body.artwork_media_id);
    if (S.db.get("SELECT 1 FROM audio_assets WHERE master_media_id = ?", master.id)) throw new HttpError(409, "master_in_use", "That master is already attached to another item.");
    const p = producerFor(S, user, true);
    const bid = id("bt"), now = S.now();
    let aid;
    S.db.tx(() => {
      aid = createAsset(S, user.id, master, stems);
      S.db.run(`INSERT INTO beats (id, producer_id, title, genre_id, bpm, musical_key, duration_sec, price_mult, status, exclusive_available, free_download, audio_id, art_media_id, data, created_at)
        VALUES (?,?,?,?,?,?,?,?, 'processing', ?,?,?,?,?,?)`, bid, p.id, title, genre.id, bpm ?? 120, key ?? "A min", 5, Math.round(priceMult * 100) / 100, body.exclusive_available === false ? 0 : 1, body.free_download ? 1 : 0, aid, art?.id ?? null,
        JSON.stringify({ moods: list(body.moods, 3, MOODS), tags: list(body.tags, 10).map((t) => t.slice(0, 30)), description: plain(body.description).slice(0, 1000), credits: [["Produced by", p.name]],
          stems: [], bpm_declared: bpm, key_declared: key, publish: body.publish !== false,
          // Generated cover art (rendered by the client from these parameters) when no image was uploaded
          art: art ? undefined : { seed: `${bid}${title}`, style: ART_STYLES.includes(body.art?.style) ? body.art.style : "rings", palette: ART_PALETTES.includes(body.art?.palette) ? body.art.palette : "violet" } }), now);
    });
    ingest(S, aid, {
      bpm, genreId: genre.id,
      onDone: (meta) => {
        const b = S.db.get("SELECT * FROM beats WHERE id = ?", bid); if (!b) return;
        const d = json(b.data, {});
        S.db.run("UPDATE beats SET status = ?, duration_sec = ?, bpm = ?, musical_key = ?, published_at = ? WHERE id = ?", d.publish ? "published" : "draft", Math.round(meta.duration),
          d.bpm_declared ?? Math.round(meta.bpm ?? 120), d.key_declared ?? meta.key?.name ?? "A min", d.publish ? S.now() : null, bid);
        notify(S, { userId: user.id, type: "store_upload_ready", targetType: "beat", targetId: bid, data: { title, bpm: meta.bpm, key: meta.key?.name, published: !!d.publish } });
      },
      onFail: (msg) => {
        S.db.run("UPDATE beats SET status = 'draft' WHERE id = ?", bid);
        notify(S, { userId: user.id, type: "store_upload_failed", targetType: "beat", targetId: bid, data: { title, error: msg } });
      },
    });
    return { beat: { id: bid, status: "processing", audio_id: aid } };
  });

  r.patch("/api/seller/beats/:id", ({ user, params, body }) => {
    const b = S.db.get("SELECT b.* FROM beats b JOIN producers p ON p.id = b.producer_id WHERE b.id = ? AND p.user_id = ?", params.id, user.id);
    if (!b) throw notFound("Beat not found.");
    const d = json(b.data, {});
    const next = { title: body.title != null ? str(body.title, 80, "title") : b.title, price_mult: b.price_mult, status: b.status, exclusive: b.exclusive_available, free: b.free_download };
    if (body.price_mult != null) { const v = Number(body.price_mult); if (!(v >= 0.5 && v <= 5)) throw bad("invalid_price", "The price multiplier must be between 0.5× and 5×."); next.price_mult = Math.round(v * 100) / 100; }
    if (body.exclusive_available != null) next.exclusive = b.status === "sold_exclusive" ? 0 : body.exclusive_available ? 1 : 0;
    if (body.free_download != null) next.free = body.free_download ? 1 : 0;
    if (body.status != null) {
      const s = String(body.status);
      if (!["published", "draft", "removed"].includes(s)) throw bad("invalid_status", "Status must be published, draft or removed.");
      if (b.status === "sold_exclusive") throw new HttpError(409, "sold_exclusive", "This beat was sold with exclusive rights and can’t be relisted.");
      if (s === "published" && S.db.get("SELECT status FROM audio_assets WHERE id = ?", b.audio_id)?.status !== "ready") throw new HttpError(409, "audio_not_ready", "The audio is still processing (or failed). Fix it before publishing.");
      next.status = s;
    }
    if (body.description != null) d.description = plain(body.description).slice(0, 1000);
    if (body.moods != null) d.moods = list(body.moods, 3, MOODS);
    if (body.tags != null) d.tags = list(body.tags, 10).map((t) => t.slice(0, 30));
    S.db.run("UPDATE beats SET title = ?, price_mult = ?, status = ?, exclusive_available = ?, free_download = ?, data = ?, published_at = COALESCE(published_at, CASE WHEN ? = 'published' THEN ? END) WHERE id = ?",
      next.title, next.price_mult, next.status, next.exclusive, next.free, JSON.stringify(d), next.status, S.now(), b.id);
    // Unlisted items leave everyone's cart; purchased entitlements are unaffected
    if (next.status !== "published") S.db.run("DELETE FROM cart_items WHERE kind = 'beat' AND item_id = ?", b.id);
    invalidateCatalog(S); reindexSearch(S);
    return { beat: { id: b.id, status: next.status, title: next.title, price_mult: next.price_mult } };
  });

  /* ----- Releases ----- */
  r.post("/api/seller/releases", ({ user, body }) => {
    requireVerifiedEmail(user);
    S.limiter.take("upload", user.id);
    const title = str(body.title, 100, "title");
    const type = String(body.type ?? "");
    if (!RELEASE_TYPES.includes(type)) throw bad("invalid_type", "Choose a release type.");
    const genre = S.db.get("SELECT id FROM store_genres WHERE id = ? AND marketplace = 'electronic'", String(body.genre ?? ""));
    if (!genre) throw bad("invalid_genre", "Choose an Electronic Music Store genre.");
    const date = String(body.release_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw bad("invalid_date", "Enter the release date as YYYY-MM-DD.");
    const formats = list(body.formats, 3, ["WAV", "AIFF", "MP3"]);
    if (!formats.length) throw bad("invalid_formats", "Offer at least one download format.");
    const label = body.label_id ? S.db.get("SELECT * FROM labels WHERE id = ? AND owner_id = ?", String(body.label_id), user.id) : null;
    if (body.label_id && !label) throw forbidden("not_label_owner", "You can only release on labels you manage.");
    const cat = body.cat ? String(body.cat).toUpperCase().trim() : null;
    if (cat && !/^[A-Z0-9-]{2,16}$/.test(cat)) throw bad("invalid_cat", "Catalog numbers use letters, numbers and dashes (2–16).");
    if (cat && S.db.get("SELECT 1 FROM releases WHERE cat = ?", cat)) throw new HttpError(409, "cat_taken", "That catalog number is already used.");
    const upc = body.upc ? String(body.upc).trim() : null;
    if (upc && !/^\d{12,13}$/.test(upc)) throw bad("invalid_upc", "UPC/EAN codes are 12 or 13 digits.");
    if (upc && S.db.get("SELECT 1 FROM releases WHERE upc = ?", upc)) throw new HttpError(409, "upc_taken", "That UPC is already used.");
    const tracksIn = Array.isArray(body.tracks) ? body.tracks : [];
    if (!tracksIn.length || tracksIn.length > 40) throw bad("invalid_tracks", "A release needs 1–40 tracks.");
    const art = artworkMedia(S, user.id, body.artwork_media_id);
    const tracks = tracksIn.map((t, i) => {
      const key = t.key ? String(t.key) : null;
      if (key && !KEYS.includes(key)) throw bad("invalid_key", `Track ${i + 1}: choose a key like “F min”.`);
      const isrc = t.isrc ? String(t.isrc).toUpperCase().replace(/-/g, "") : null;
      if (isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) throw bad("invalid_isrc", `Track ${i + 1}: ISRC looks like CC-XXX-YY-NNNNN.`);
      if (isrc && S.db.get("SELECT 1 FROM tracks WHERE isrc = ?", isrc)) throw new HttpError(409, "isrc_taken", `Track ${i + 1}: that ISRC is already used.`);
      const master = masterFile(S, user.id, t.master_media_id);
      if (S.db.get("SELECT 1 FROM audio_assets WHERE master_media_id = ?", master.id)) throw new HttpError(409, "master_in_use", `Track ${i + 1}: that master is already attached to another item.`);
      return { title: str(t.title, 100, "track_title"), mix: plain(t.mix ?? "Original Mix").trim().slice(0, 60) || "Original Mix", bpm: optInt(t.bpm, 40, 250, "bpm"), key, energy: optInt(t.energy, 1, 10, "energy") ?? 6, explicit: !!t.explicit, isrc, master };
    });
    if (new Set(tracks.map((t) => t.master.id)).size !== tracks.length) throw bad("duplicate_master", "Each track needs its own master file.");
    const artist = label ? null : artistFor(S, user, true);
    const rid = id("rl"), now = S.now();
    const created = [];
    S.db.tx(() => {
      S.db.run(`INSERT INTO releases (id, label_id, owner_id, type, title, cat, release_date, genre_id, formats, upc, status, art_media_id, data, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'processing', ?,?,?)`,
        rid, label?.id ?? null, user.id, type, title, cat, date, genre.id, JSON.stringify(formats), upc, art?.id ?? null, JSON.stringify({ description: plain(body.description).slice(0, 1000), publish: body.publish !== false,
          art: art ? undefined : { seed: `${rid}${title}`, style: ART_STYLES.includes(body.art?.style) ? body.art.style : "horizon", palette: ART_PALETTES.includes(body.art?.palette) ? body.art.palette : "electric" } }), now);
      const primary = artist ?? artistFor(S, user, true);
      S.db.run("INSERT INTO release_artists (release_id, artist_id, position) VALUES (?,?,0)", rid, primary.id);
      tracks.forEach((t, i) => {
        const aid = createAsset(S, user.id, t.master, null), tid = id("tr");
        S.db.run(`INSERT INTO tracks (id, release_id, position, title, mix, genre_id, bpm, musical_key, camelot, energy, duration_sec, isrc, explicit, status, audio_id, data, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'processing', ?,?,?)`,
          tid, rid, i + 1, t.title, t.mix, genre.id, t.bpm ?? 120, t.key ?? "A min", camelot(t.key ?? "A min"), t.energy, 5, t.isrc, t.explicit ? 1 : 0, aid, JSON.stringify({ bpm_declared: t.bpm, key_declared: t.key }), now);
        S.db.run("INSERT INTO track_artists (track_id, artist_id, role, position) VALUES (?,?,'primary',0)", tid, primary.id);
        created.push({ tid, aid, bpm: t.bpm });
      });
    });
    const settle = () => {
      const rows = S.db.all("SELECT t.status, a.status astatus FROM tracks t JOIN audio_assets a ON a.id = t.audio_id WHERE t.release_id = ?", rid);
      if (rows.some((x) => x.astatus === "processing")) return;
      const rel = S.db.get("SELECT * FROM releases WHERE id = ?", rid);
      const ok = rows.every((x) => x.astatus === "ready");
      const publish = ok && json(rel.data, {}).publish;
      S.db.run("UPDATE releases SET status = ?, published_at = CASE WHEN ? THEN ? ELSE published_at END WHERE id = ?", publish ? "published" : "draft", publish ? 1 : 0, S.now(), rid);
      S.db.run("UPDATE tracks SET status = ? WHERE release_id = ? AND audio_id IN (SELECT id FROM audio_assets WHERE status = 'ready')", publish ? "published" : "draft", rid);
      invalidateCatalog(S); reindexSearch(S);
      notify(S, { userId: user.id, type: ok ? "store_upload_ready" : "store_upload_failed", targetType: "release", targetId: rid, data: { title, published: !!publish, failed: rows.filter((x) => x.astatus === "failed").length } });
    };
    for (const c of created) ingest(S, c.aid, {
      bpm: c.bpm, genreId: genre.id,
      onDone: (meta) => {
        const t = S.db.get("SELECT * FROM tracks WHERE id = ?", c.tid), d = json(t.data, {});
        const key = d.key_declared ?? meta.key?.name ?? "A min";
        S.db.run("UPDATE tracks SET status = 'draft', duration_sec = ?, bpm = ?, musical_key = ?, camelot = ? WHERE id = ?", Math.round(meta.duration), d.bpm_declared ?? Math.round((meta.bpm ?? 120) * 100) / 100, key, camelot(key), c.tid);
        settle();
      },
      onFail: () => { S.db.run("UPDATE tracks SET status = 'draft' WHERE id = ?", c.tid); settle(); },
    });
    return { release: { id: rid, status: "processing", tracks: created.map((c) => ({ id: c.tid, audio_id: c.aid })) } };
  });

  r.patch("/api/seller/releases/:id", ({ user, params, body }) => {
    if (!managedReleaseIds(S, user.id).includes(params.id)) throw notFound("Release not found.");
    const rel = S.db.get("SELECT * FROM releases WHERE id = ?", params.id);
    const s = body.status != null ? String(body.status) : rel.status;
    if (!["published", "draft", "removed"].includes(s)) throw bad("invalid_status", "Status must be published, draft or removed.");
    if (s === "published" && S.db.get("SELECT 1 FROM tracks t LEFT JOIN audio_assets a ON a.id = t.audio_id WHERE t.release_id = ? AND (a.status IS NULL OR a.status != 'ready')", rel.id)) throw new HttpError(409, "audio_not_ready", "Every track needs processed audio before the release can go live.");
    S.db.tx(() => {
      S.db.run("UPDATE releases SET status = ?, title = ?, published_at = COALESCE(published_at, CASE WHEN ? = 'published' THEN ? END) WHERE id = ?", s, body.title != null ? str(body.title, 100, "title") : rel.title, s, S.now(), rel.id);
      S.db.run("UPDATE tracks SET status = ? WHERE release_id = ?", s, rel.id);
      if (s !== "published") S.db.run("DELETE FROM cart_items WHERE (kind = 'release' AND item_id = ?1) OR (kind = 'track' AND item_id IN (SELECT id FROM tracks WHERE release_id = ?1))", rel.id);
    });
    invalidateCatalog(S); reindexSearch(S);
    return { release: { id: rel.id, status: s } };
  });

  /* ----- Verified-purchase reviews (Beats Store) ----- */
  r.post("/api/store/reviews", ({ user, body }) => {
    S.limiter.take("store_write", user.id);
    const oi = S.db.get(`SELECT oi.*, o.user_id buyer FROM order_items oi JOIN store_orders o ON o.id = oi.order_id WHERE oi.id = ? AND o.status = 'paid'`, String(body.order_item_id ?? ""));
    if (!oi || oi.buyer !== user.id || !["beat", "pack"].includes(oi.kind)) throw notFound("You can review producers you’ve bought from.");
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad("invalid_rating", "Rate from 1 to 5 stars.");
    const text = str(body.body, 1000, "review");
    const producer = S.db.get(`SELECT producer_id FROM ${oi.kind === "beat" ? "beats" : "packs"} WHERE id = ?`, oi.item_id);
    if (S.db.get("SELECT 1 FROM producer_reviews WHERE order_item_id = ?", oi.id)) throw new HttpError(409, "already_reviewed", "You already reviewed this purchase.");
    const rid = id("rv");
    S.db.run("INSERT INTO producer_reviews (id, producer_id, user_id, order_item_id, rating, body, created_at) VALUES (?,?,?,?,?,?,?)", rid, producer.producer_id, user.id, oi.id, rating, text, S.now());
    const owner = S.db.get("SELECT user_id FROM producers WHERE id = ?", producer.producer_id);
    notify(S, { userId: owner?.user_id, type: "store_review", actorId: user.id, targetType: "producer_review", targetId: rid, data: { rating, excerpt: text.slice(0, 120) } });
    invalidateCatalog(S);
    return { review: { id: rid, rating, body: text } };
  });
}

export const _internal = { fs };
