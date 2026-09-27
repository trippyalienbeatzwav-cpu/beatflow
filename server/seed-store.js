// Store seed: imports the fictional catalog (server/seed-data) into the database, creates a real
// account for every seller, links each track and beat to its analysed audio, then runs demo purchases
// through the real checkout + sandbox payment path so orders, earnings, libraries and dashboards
// contain genuine records. Counters like historical plays are kept separately as data.imported.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSeedCatalog } from "./seed-data/catalog.js";
import { ensureUserRows } from "./modules/users.js";
import { reindexSearch, invalidateCatalog } from "./modules/store/catalog.js";
import { id } from "./lib/ids.js";
import { writeCart, createCheckout } from "./modules/store/commerce.js";
import { handlePaymentEvent, releaseEarnings } from "./modules/wallet.js";
import { packPlan, packDescription } from "./lib/audio/worker.js";

/** What a generated pack archive really contains, and roughly how big it is (24-bit / 48 kHz stereo WAV). */
function packFacts(k) {
  const plan = packPlan(k.type), bytesPerSec = 48000 * 2 * 3, loopSec = (8 * 4 * 60) / k.bpm;
  const shots = Object.entries(plan.oneShots).reduce((s, [n, c]) => s + c * (n === "Bass" ? 1.2 : n === "Hi-hats" ? 0.25 : 0.6), 0);
  const secs = plan.stems ? 150 * 7 : plan.loops.length * loopSec + shots;
  return { contents: packDescription(k.type, k.bpm), size: `${Math.max(1, Math.round((secs * bytesPerSec) / 1048576))} MB` };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = 864e5;
const cents = (d) => Math.round(Number(d) * 100);

/** Sellers that already exist as social accounts are linked, not duplicated. */
const LINK = { a1: "mira.kaan" };
/** Label → who runs it in the seller dashboard (the demo account kairovance manages TUNIBEAT RECORDS). */
const LABEL_OWNER = { bfr: "kairovance", voidsignal: "oskarveil", nightwave: "nightjar", afterdark: "dunetheory", solstice: "petravos", kiln: "akinsol" };

function ensureSeller(S, username, displayName, createdAt, verified) {
  const u = S.db.get("SELECT id FROM users WHERE username = ?", username);
  if (u) return u.id;
  const uid = `u_${username.replace(/\W/g, "")}`;
  S.db.run(`INSERT INTO users (id, username, email, display_name, is_creator, is_verified, created_at, email_verified_at) VALUES (?,?,?,?,1,?,?,?)`,
    uid, username, `${username.replace(/\W/g, "")}@demo.tunibeat.example`, displayName.slice(0, 50), verified ? 1 : 0, createdAt, createdAt);
  ensureUserRows(S, uid);
  return uid;
}

/**
 * Audio asset for a catalog item whose master is rendered by the catalog synthesiser. The ingest script
 * wrote <analysisDir>/<id>.json + .wf and the preview clip named in the JSON; if they're missing the
 * asset is marked failed and the store shows the item without a playable preview.
 */
function synthAsset(S, id, spec, analysisDir, now) {
  const file = path.join(root, analysisDir, `${spec.id}.json`);
  const meta = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const previewFile = meta?.preview?.file ? `assets/audio/${meta.preview.file}` : null;
  const ok = !!(previewFile && fs.existsSync(path.join(root, previewFile)) && fs.existsSync(path.join(root, analysisDir, `${spec.id}.wf`)));
  S.db.run(`INSERT INTO audio_assets (id, source, synth_spec, sample_rate, channels, bit_depth, duration_ms, status, error, preview_url, analysis_url, waveform_url, analysis, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, "synth", JSON.stringify(spec), 48000, 2, 24, Math.round(spec.duration * 1000), ok ? "ready" : "failed", ok ? null : "Preview not ingested yet (run the catalog ingest script)",
    ok ? previewFile : null, ok ? `${analysisDir}/${spec.id}.json` : null, ok ? `${analysisDir}/${spec.id}.wf` : null,
    JSON.stringify(ok ? { bpm: meta.bpm, key: meta.key, cues: meta.cues, gridReliable: meta.gridReliable, beatConfidence: meta.beatConfidence } : {}), now, now);
  return id;
}

export function seedStoreCatalog(S, { log = (..._a) => {} } = {}) {
  const cat = loadSeedCatalog();
  const now = S.now();
  S.db.tx(() => {
    // ---- Taxonomy & license templates ----
    cat.beatGenres.forEach((g, i) => S.db.run("INSERT INTO store_genres (id, marketplace, name, position, visible, data, created_at, updated_at) VALUES (?,?,?,?,1,?,?,?)",
      g.id, "beats", g.name, i, JSON.stringify({ palette: g.palette, style: g.style, count: g.count }), now, now));
    cat.electronicGenres.forEach((g) => S.db.run("INSERT INTO store_genres (id, marketplace, name, bpm_lo, bpm_hi, family, position, visible, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)",
      g.id, "electronic", g.name, g.bpm[0], g.bpm[1], g.family, g.order, JSON.stringify({ palette: g.palette, style: g.style }), now, now));
    cat.licenses.forEach((l, i) => S.db.run("INSERT INTO licenses (id, name, short, price_cents, exclusive, formats, position, data) VALUES (?,?,?,?,?,?,?,?)",
      l.id, l.name, l.short, cents(l.price), l.exclusive ? 1 : 0, JSON.stringify(l.formats), i, JSON.stringify({ files: l.files, summary: l.summary, terms: l.terms, popular: !!l.popular })));

    // ---- Beats Store sellers & products ----
    for (const p of cat.producers) {
      const uid = ensureSeller(S, p.handle, p.name, now - (2026 - p.since) * 365 * D, p.verified);
      S.db.run("INSERT INTO producers (id, user_id, handle, name, verified, data, created_at) VALUES (?,?,?,?,?,?,?)", p.id, uid, p.handle, p.name, p.verified ? 1 : 0,
        JSON.stringify({ location: p.location, palette: p.palette, since: p.since, bio: p.bio, genres: p.genres, responseTime: p.responseTime, socials: p.socials, avatar: p.avatar, banner: p.banner,
          imported: { followers: p.followers, sales: p.sales, rating: p.rating, reviews: p.reviews } }), now - (2026 - p.since) * 365 * D);
    }
    for (const b of cat.beats) {
      const spec = { kind: "beat", id: b.id, title: b.title, bpm: b.bpm, key: b.key, genre: b.genre, duration: b.duration, energy: 7 };
      const aid = synthAsset(S, `aa_${b.id}`, spec, "assets/audio/beats", now);
      const published = now - b.daysAgo * D;
      S.db.run(`INSERT INTO beats (id, producer_id, title, genre_id, bpm, musical_key, duration_sec, price_mult, status, exclusive_available, free_download, audio_id, data, created_at, published_at)
        VALUES (?,?,?,?,?,?,?,?,'published',?,?,?,?,?,?)`,
        b.id, b.producerId, b.title, b.genre, b.bpm, b.key, b.duration, b.priceMult, b.exclusiveAvailable ? 1 : 0, b.freeDownload ? 1 : 0, aid,
        JSON.stringify({ slug: b.slug, moods: b.moods, tags: b.tags, description: b.description, credits: b.credits, contentId: b.contentId, stems: b.stems, art: b.art,
          imported: { plays: b.plays, likes: b.likes, sales: b.sales, trendScore: b.trendScore } }), published, published);
    }
    for (const k of cat.packs) {
      const spec = { kind: "pack", id: k.id, title: k.title, bpm: k.bpm, key: k.key, genre: k.genre, type: k.type, duration: k.duration };
      const aid = synthAsset(S, `aa_${k.id}`, spec, "assets/audio/beats", now);
      S.db.run(`INSERT INTO packs (id, producer_id, title, type, genre_id, bpm, musical_key, price_cents, status, audio_id, data, created_at, published_at) VALUES (?,?,?,?,?,?,?,?,'published',?,?,?,?)`,
        k.id, k.producerId, k.title, k.type, k.genre, k.bpm, k.key, cents(k.price), aid, JSON.stringify({ ...packFacts(k), duration: k.duration, terms: k.terms, art: k.art }), now - 60 * D, now - 60 * D);
    }
    const producerUser = new Map(S.db.all("SELECT id, user_id FROM producers").map((p) => [p.id, p.user_id]));
    cat.playlists.forEach((pl, i) => {
      const pid = `pl_${pl.id}`;
      S.db.run("INSERT INTO playlists (id, user_id, kind, title, is_public, created_at, updated_at) VALUES (?,?,?,?,1,?,?)", pid, producerUser.get(pl.by), "beats", pl.title, now - (30 - i) * D, now - (30 - i) * D);
      pl.beatIds.forEach((bid, j) => S.db.run("INSERT INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?,?,?,?)", pid, bid, j, now - (30 - i) * D));
    });

    // ---- Electronic Music Store: artists, labels, releases, tracks ----
    for (const a of cat.artists) {
      const uid = ensureSeller(S, LINK[a.id] ?? a.handle, a.name, now - 400 * D, a.verified);
      S.db.run("INSERT INTO artists (id, user_id, handle, name, verified, data, created_at) VALUES (?,?,?,?,?,?,?)", a.id, uid, a.handle, a.name, a.verified ? 1 : 0,
        JSON.stringify({ city: a.city, palette: a.palette, genres: a.genres, bio: a.bio, avatar: a.avatar, banner: a.banner, imported: { followers: a.followers } }), now - 400 * D);
    }
    const userOf = (username) => S.db.get("SELECT id FROM users WHERE username = ?", username)?.id ?? null;
    for (const l of cat.labels) {
      S.db.run("INSERT INTO labels (id, owner_id, name, verified, data, created_at) VALUES (?,?,?,?,?,?)", l.id, userOf(LABEL_OWNER[l.id]), l.name, l.verified ? 1 : 0,
        JSON.stringify({ mono: l.mono, prefix: l.prefix, city: l.city, founded: l.founded, palette: l.palette, genres: l.genres, bio: l.bio, banner: l.banner, imported: { followers: l.followers } }), now - (2026 - l.founded) * 365 * D);
    }
    const artistUser = new Map(S.db.all("SELECT id, user_id FROM artists").map((a) => [a.id, a.user_id]));
    const labelOwner = new Map(S.db.all("SELECT id, owner_id FROM labels").map((l) => [l.id, l.owner_id]));
    const trackById = new Map(cat.tracks.map((t) => [t.id, t]));
    for (const r of cat.releases) {
      const created = Date.parse(r.date + "T10:00:00Z");
      S.db.run(`INSERT INTO releases (id, label_id, owner_id, type, title, cat, release_date, genre_id, formats, upc, status, data, created_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,'published',?,?,?)`,
        r.id, r.labelId, r.labelId ? labelOwner.get(r.labelId) : artistUser.get(r.artistIds[0]), r.type, r.title, r.cat, r.date, r.genre, JSON.stringify(r.formats), null,
        JSON.stringify({ description: r.description, art: r.art }), created, created);
      r.artistIds.forEach((aid, i) => S.db.run("INSERT INTO release_artists (release_id, artist_id, position) VALUES (?,?,?)", r.id, aid, i));
      for (const tid of r.trackIds) {
        const t = trackById.get(tid);
        const spec = { kind: "track", id: t.id, title: t.title, bpm: t.bpm, key: t.key, family: t.family, energy: t.energy, duration: t.duration, intro: t.intro, outro: t.outro, genre: t.genre };
        const aid = synthAsset(S, `aa_${t.id}`, spec, "assets/audio/analysis", now);
        S.db.run(`INSERT INTO tracks (id, release_id, position, title, mix, genre_id, bpm, musical_key, camelot, energy, duration_sec, isrc, explicit, status, audio_id, data, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?)`,
          t.id, r.id, t.n, t.title, t.mix || "", t.genre, t.bpm, t.key, t.camelot, t.energy, t.duration, `QZTB${r.date.slice(2, 4)}${String(Number(t.id.slice(1))).padStart(5, "0")}`, t.explicit ? 1 : 0, aid,
          JSON.stringify({ family: t.family, intro: t.intro, outro: t.outro, dropAt: t.dropAt, imported: { plays: t.plays, downloads: t.downloads, trendScore: t.trendScore } }), created);
        t.artistIds.forEach((aid2, i) => S.db.run("INSERT OR IGNORE INTO track_artists (track_id, artist_id, role, position) VALUES (?,?,?,?)", t.id, aid2, "primary", i));
        if (t.remixerId) S.db.run("INSERT OR IGNORE INTO track_artists (track_id, artist_id, role, position) VALUES (?,?,?,?)", t.id, t.remixerId, "remixer", 0);
      }
    }
    // Launch promo codes (validated and redeemed server-side)
    S.db.run("INSERT INTO promo_codes (code, percent_bps, active, once_per_user, created_at) VALUES ('FLOW10', 1000, 1, 1, ?), ('FIRSTDROP', 1500, 1, 1, ?)", now, now);
  });
  reindexSearch(S);
  invalidateCatalog(S);
  const n = (t) => S.db.get(`SELECT COUNT(*) n FROM ${t}`).n;
  log(`seed: store catalog ${n("beats")} beats, ${n("packs")} packs, ${n("releases")} releases, ${n("tracks")} tracks, ${S.db.get("SELECT COUNT(*) n FROM audio_assets WHERE status = 'ready'").n} analysed audio assets`);
  return cat;
}

/* ---------------------------------------------------------------- demo activity -- */
const BUYERS = [["tariq.m", "Tariq M."], ["joi.carter", "Joi Carter"], ["lvcid", "LVCID"], ["marco.villa", "Marco Villa"], ["ella.rhodes", "Ella Rhodes"], ["dre.santos", "Dre Santos"],
  ["kzn.music", "KZN"], ["nia.blue", "Nia Blue"], ["yung.orion", "Yung Orion"], ["sasha.k", "Sasha K."], ["benny.q", "Benny Q."], ["mila.voss", "Mila Voss"]];
const COUNTRIES = ["US", "US", "GB", "DE", "DE", "NL", "FR", "CA", "BR", "JP", "NG", "US", "GB"];

async function pay(S, userId, items, { at, country = "US", promo = null, legal }) {
  const clock = S.now;
  S.now = () => at;
  try {
    writeCart(S, userId, items);
    const u = S.db.get("SELECT * FROM users WHERE id = ?", userId);
    const { checkout } = await createCheckout(S, u, { idempotency_key: id("seed").replace(/_/g, "-") + "-ck", email: u.email, legal_name: legal ?? u.display_name, country, postal_code: "10001", agree: true, promo_code: promo });
    const p = S.db.get("SELECT * FROM payments WHERE id = ?", checkout.payment.id);
    const ev = S.payments.signEvent({ id: id("evt"), type: "payment.succeeded", data: { provider_ref: p.provider_ref } });
    handlePaymentEvent(S, "sandbox", S.payments.verifyWebhook(ev.body, ev.headers));
    return checkout;
  } finally { S.now = clock; }
}

/** Purchases, reviews, favourites, crates and listening history made by seeded accounts through the real services. */
export async function seedStoreActivity(S, cat, { log = (..._a) => {} } = {}) {
  const now = S.now();
  const rnd = (() => { let a = 20260926; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const buyers = BUYERS.map(([u, n], i) => ensureSeller(S, u, n, now - (400 - i * 10) * D, false));
  S.db.run(`UPDATE users SET is_creator = 0 WHERE id IN (${buyers.map(() => "?").join(",")})`, ...buyers);
  const kairo = S.db.get("SELECT id FROM users WHERE username = 'kairovance'").id;
  let checkouts = 0;
  const tryPay = async (uid, items, opts) => { try { await pay(S, uid, items, opts); checkouts++; } catch (err) { if (!["cart_invalid", "exclusive_unavailable", "promo_used"].includes(err.code)) throw err; } };

  // A year of sales across both stores (weighted towards recent months)
  const beats = cat.beats.map((b) => b.id), tracks = cat.tracks.map((t) => t.id), releases = cat.releases.filter((r) => r.trackIds.length > 1).map((r) => r.id);
  const lic = ["basic", "basic", "basic", "premium", "premium", "trackout"];
  const fmts = ["WAV", "WAV", "MP3", "AIFF"];
  const relFormats = new Map(cat.releases.map((r) => [r.id, r.formats]));
  const trackRel = new Map(cat.tracks.map((t) => [t.id, t.releaseId]));
  for (let i = 0; i < 90; i++) {
    const daysAgo = Math.floor(Math.pow(rnd(), 1.6) * 360) + 1;
    const at = now - daysAgo * D + Math.floor(rnd() * D * 0.8);
    const items = [];
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const r = rnd();
      if (r < 0.45) items.push({ kind: "beat", id: pick(beats), license_id: pick(lic) });
      else if (r < 0.55) items.push({ kind: "pack", id: pick(cat.packs).id });
      else if (r < 0.85) { const t = pick(tracks), f = pick(fmts); items.push({ kind: "track", id: t, format: relFormats.get(trackRel.get(t)).includes(f) ? f : "WAV" }); }
      else { const rl = pick(releases), f = pick(fmts); items.push({ kind: "release", id: rl, format: relFormats.get(rl).includes(f) ? f : "WAV" }); }
    }
    await tryPay(pick(buyers), items, { at, country: pick(COUNTRIES), promo: rnd() < 0.12 ? "FIRSTDROP" : null });
  }
  // One exclusive sale: the beat leaves the store, earlier leases stay valid
  await tryPay(buyers[1], [{ kind: "beat", id: "b14", license_id: "exclusive" }], { at: now - 38 * D, country: "US", legal: "Joi Carter" });

  // The demo account (kairovance) also buys music, as shown in its libraries
  await tryPay(kairo, [{ kind: "beat", id: "b4", license_id: "premium" }, { kind: "beat", id: "b8", license_id: "basic" }], { at: now - 8 * D, legal: "Kairo Vance" });
  await tryPay(kairo, [{ kind: "beat", id: "b10", license_id: "trackout" }, { kind: "pack", id: "k3" }], { at: now - 27 * D, legal: "Kairo Vance" });
  await tryPay(kairo, [{ kind: "release", id: "r5", format: "WAV" }, { kind: "track", id: "t19", format: "WAV" }], { at: now - 12 * D, legal: "Kairo Vance" });

  // Verified-purchase reviews: each reviewer buys the beat first
  for (const [i, rv] of cat.reviews.entries()) {
    const uid = buyers[i % buyers.length];
    await tryPay(uid, [{ kind: "beat", id: rv.beat, license_id: "basic" }], { at: now - (20 + i * 3) * D });
    const oi = S.db.get(`SELECT oi.id FROM order_items oi JOIN store_orders o ON o.id = oi.order_id WHERE o.user_id = ? AND oi.item_id = ? AND o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 1`, uid, rv.beat);
    const producer = S.db.get("SELECT producer_id FROM beats WHERE id = ?", rv.beat).producer_id;
    if (oi && !S.db.get("SELECT 1 FROM producer_reviews WHERE order_item_id = ?", oi.id)) S.db.run("INSERT INTO producer_reviews (id, producer_id, user_id, order_item_id, rating, body, created_at) VALUES (?,?,?,?,?,?,?)", id("rv"), producer, uid, oi.id, rv.stars, rv.text, now - (19 + i * 3) * D);
  }

  // Favourites, follows, crates and a month of preview listening by seeded accounts
  for (const [k, iid] of [["beat", "b3"], ["beat", "b8"], ["beat", "b12"], ["beat", "b19"], ["beat", "b26"], ["track", "t5"], ["release", "r2"]]) S.db.run("INSERT OR IGNORE INTO favorites (user_id, kind, item_id, created_at) VALUES (?,?,?,?)", kairo, k, iid, now - 5 * D);
  for (const [k, tid] of [["producer", "p2"], ["producer", "p4"], ["label", "voidsignal"], ["artist", "a1"]]) S.db.run("INSERT OR IGNORE INTO store_follows (user_id, target_kind, target_id, created_at) VALUES (?,?,?,?)", kairo, k, tid, now - 20 * D);
  /** @type {[string, string[]][]} */ ([["Friday Night", ["t1", "t30", "t5", "t57"]], ["Warm Up", ["t15", "t16", "t54"]], ["Peak Time", ["t1", "t4", "t21", "t25"]], ["After Hours", ["t17", "t51", "t58"]]]).forEach(([title, ids], i) => {
    const pid = id("pl");
    S.db.run("INSERT INTO playlists (id, user_id, kind, title, is_public, created_at, updated_at) VALUES (?,?,?,?,0,?,?)", pid, kairo, "crate", title, now - (15 - i) * D, now - (15 - i) * D);
    ids.filter((t) => tracks.includes(t)).forEach((t, j) => S.db.run("INSERT INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?,?,?,?)", pid, t, j, now - (15 - i) * D));
  });
  const shortlist = id("pl");
  S.db.run("INSERT INTO playlists (id, user_id, kind, title, is_public, created_at, updated_at) VALUES (?,?,?,?,0,?,?)", shortlist, kairo, "beats", "Album 2 — shortlist", now - 6 * D, now - 6 * D);
  ["b4", "b18", "b22"].forEach((b, j) => S.db.run("INSERT INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?,?,?,?)", shortlist, b, j, now - 6 * D));
  const listeners = [...buyers, kairo];
  S.db.tx(() => {
    for (let d = 30; d >= 1; d--) {
      const count = 25 + Math.floor(rnd() * 40) + (30 - d);
      for (let k = 0; k < count; k++) {
        const isBeat = rnd() < 0.5, iid = isBeat ? pick(beats) : pick(tracks), uid = pick(listeners), at = now - d * D + Math.floor(rnd() * D);
        S.db.run("INSERT INTO plays (kind, item_id, user_id, listener, created_at) VALUES (?,?,?,?,?)", isBeat ? "beat" : "track", iid, uid, uid, at);
        S.db.run(`UPDATE ${isBeat ? "beats" : "tracks"} SET play_count = play_count + 1 WHERE id = ?`, iid);
      }
    }
  });
  releaseEarnings(S);
  invalidateCatalog(S); reindexSearch(S);
  log(`seed: store activity ${checkouts} paid checkouts, ${S.db.get("SELECT COUNT(*) n FROM order_items").n} order lines, ${S.db.get("SELECT COUNT(*) n FROM producer_reviews").n} reviews, ${S.db.get("SELECT COUNT(*) n FROM plays").n} plays`);
}
