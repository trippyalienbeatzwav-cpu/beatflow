// Store library: what a customer owns and the files that come with it.
// Masters are never served from a public path. A download is prepared for a specific entitlement
// (rendered/encoded in the audio worker pool, then cached), and fetched through a short-lived,
// HMAC-signed link bound to the buyer's account. Every download is recorded.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { id } from "../../lib/ids.js";
import { json } from "../../lib/db.js";
import { bad, notFound, forbidden, HttpError, sendFile } from "../../lib/http.js";
import { COUNTRIES } from "./commerce.js";

const LINK_TTL_MS = 15 * 60_000;
const EXT = { WAV: "wav", AIFF: "aiff", MP3: "mp3" };
// eslint-disable-next-line no-control-regex -- strips control characters from download filenames
const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 150);

/* ------------------------------------------------------------------ what can be downloaded */
function assetFor(S, audioId) { return audioId ? S.db.get("SELECT * FROM audio_assets WHERE id = ?", audioId) : null; }
function sourceOf(S, asset) {
  if (!asset) return null;
  if (asset.source === "synth") return { spec: json(asset.synth_spec, {}) };
  const m = asset.master_media_id && S.db.get("SELECT * FROM media WHERE id = ?", asset.master_media_id);
  return m ? { file: path.join(S.privateDir, m.storage_key) } : null;
}
/** The files an entitlement unlocks: [{ file, format, label }]. */
export function filesFor(S, e) {
  if (e.kind === "beat") {
    if (!e.license_id) return [{ file: "master", format: "MP3", label: "MP3 (free download, non-commercial)" }];
    const lic = S.db.get("SELECT * FROM licenses WHERE id = ?", e.license_id);
    const beat = S.db.get("SELECT audio_id FROM beats WHERE id = ?", e.item_id);
    const asset = assetFor(S, beat?.audio_id);
    const f = json(lic.formats, []);
    const stems = f.includes("STEMS") && (asset?.source === "synth" || asset?.stems_media_id);
    return [...(f.includes("WAV") ? [{ file: "master", format: "WAV", label: "WAV 24-bit" }] : []), ...(f.includes("MP3") ? [{ file: "master", format: "MP3", label: "MP3 320" }] : []),
      ...(stems ? [{ file: "stems", format: "ZIP", label: "Stems (.zip)" }] : [])];
  }
  if (e.kind === "pack") return [{ file: "pack", format: "ZIP", label: "Pack (.zip)" }];
  const rel = e.kind === "release" ? S.db.get("SELECT formats FROM releases WHERE id = ?", e.item_id) : S.db.get("SELECT r.formats FROM releases r JOIN tracks t ON t.release_id = r.id WHERE t.id = ?", e.item_id);
  const formats = json(rel?.formats, []);
  return e.kind === "release" ? formats.map((fmt) => ({ file: "release", format: fmt, label: `Full release · ${fmt} (.zip)` })) : formats.map((fmt) => ({ file: "master", format: fmt, label: fmt }));
}

/* ------------------------------------------------------------------ documents ---- */
function licenseText(S, e) {
  const b = S.db.get("SELECT b.*, p.name pname, p.handle FROM beats b JOIN producers p ON p.id = b.producer_id WHERE b.id = ?", e.item_id);
  const lic = S.db.get("SELECT * FROM licenses WHERE id = ?", e.license_id);
  const oi = e.order_item_id && S.db.get("SELECT oi.*, o.id oid, o.paid_at FROM order_items oi JOIN store_orders o ON o.id = oi.order_id WHERE oi.id = ?", e.order_item_id);
  const c = oi && S.db.get("SELECT c.* FROM store_checkouts c JOIN store_orders o ON o.checkout_id = c.id WHERE o.id = ?", oi.oid);
  const terms = json(lic.data, {}).terms ?? [];
  return [
    `${lic.name.toUpperCase()} — LICENSE AGREEMENT`, "",
    `Beat:        "${b.title}" (${b.bpm} BPM, ${b.musical_key})`, `Producer:    ${b.pname} (licensor)`,
    `Licensee:    ${c?.legal_name ?? "Account holder"}${c?.alias ? ` p/k/a ${c.alias}` : ""}${c ? `, ${COUNTRIES[c.country] ?? c.country}` : ""}`,
    `Order:       ${oi?.oid ?? "—"}   Date: ${new Date(oi?.paid_at ?? e.created_at).toISOString().slice(0, 10)}   Paid: $${((oi?.paid_cents ?? 0) / 100).toFixed(2)}`, "",
    "Terms configured by the producer:", ...terms.map(([k, v]) => `  • ${k}: ${String(v).replace("{producer}", b.pname)}`), "",
    "This summary is generated from the producer’s license template for this order. It is not legal advice;",
    "the producer’s full agreement template governs. Credit the producer as shown above on every release.",
    S.payments.testMode ? "\nTEST MODE: issued for a sandbox payment. No money moved; not valid for commercial release." : "",
  ].join("\n") + "\n";
}

/* ------------------------------------------------------------------ signed links -- */
const sign = (S, payload) => crypto.createHmac("sha256", S.cfg.downloadSecret).update(payload).digest("base64url");
function linkFor(S, d, userId) {
  const exp = S.now() + LINK_TTL_MS;
  const payload = `${d.id}.${userId}.${exp}`;
  return { url: `/api/store/downloads/${d.id}/file?exp=${exp}&sig=${sign(S, payload)}`, expires_at: exp };
}
function verifyLink(S, d, userId, exp, sig) {
  if (!/^\d{10,16}$/.test(String(exp)) || Number(exp) < S.now()) throw new HttpError(410, "link_expired", "This download link expired. Start the download again from your library.");
  const want = sign(S, `${d.id}.${userId}.${exp}`);
  if (typeof sig !== "string" || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw forbidden("bad_link", "This download link isn’t valid.");
}

/* ------------------------------------------------------------------ preparation --- */
function names(S, e, file, format) {
  const ext = file === "master" ? EXT[format] : "zip";
  if (e.kind === "beat") { const b = S.db.get("SELECT b.title, p.name FROM beats b JOIN producers p ON p.id = b.producer_id WHERE b.id = ?", e.item_id); return fileSafe(`${b.name} - ${b.title}${file === "stems" ? " - Stems" : ""}`) + "." + ext; }
  if (e.kind === "pack") return fileSafe(S.db.get("SELECT title FROM packs WHERE id = ?", e.item_id).title) + ".zip";
  if (e.kind === "release") { const r = S.db.get("SELECT title, cat FROM releases WHERE id = ?", e.item_id); return fileSafe(`${r.title} [${r.cat ?? e.item_id}] (${format})`) + ".zip"; }
  const t = S.db.get("SELECT title, mix FROM tracks WHERE id = ?", e.item_id);
  const who = S.db.all("SELECT a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = ? AND ta.role = 'primary' ORDER BY ta.position", e.item_id).map((x) => x.name).join(", ");
  return fileSafe(`${who} - ${t.title}${t.mix ? ` (${t.mix})` : ""}`) + "." + ext;
}
/** Start (or reuse) the job that produces the file for a download record. */
function prepare(S, d, e) {
  const fmt = d.format;
  let key, job;
  if (d.file === "master") {
    const audioId = e.kind === "beat" ? S.db.get("SELECT audio_id FROM beats WHERE id = ?", e.item_id)?.audio_id : S.db.get("SELECT audio_id FROM tracks WHERE id = ?", d.track_id ?? e.item_id)?.audio_id;
    const asset = assetFor(S, audioId), src = sourceOf(S, asset);
    if (!src) throw new HttpError(409, "audio_unavailable", "The audio for this item isn’t available yet.");
    key = `${asset.id}/master.${EXT[fmt]}`; job = { op: "master", format: fmt, ...src };
  } else if (d.file === "stems") {
    const b = S.db.get("SELECT * FROM beats WHERE id = ?", e.item_id), asset = assetFor(S, b.audio_id);
    if (asset?.source === "upload") {
      const m = asset.stems_media_id && S.db.get("SELECT * FROM media WHERE id = ?", asset.stems_media_id);
      if (!m) throw new HttpError(409, "stems_unavailable", "The producer hasn’t uploaded stems for this beat.");
      return Promise.resolve({ path: path.join(S.privateDir, m.storage_key), bytes: m.bytes });
    }
    key = `${asset.id}/stems.zip`; // Cached once per beat and shared by every licensee, so the archive carries generic terms only;
    // each buyer's personal agreement is a separate document (/license)
    job = { op: "stems", spec: json(asset.synth_spec, {}), base: b.title, readme: `${b.title}: instrument stems (24-bit / 48 kHz WAV).
Use is governed by your license agreement, available in your TUNIBEAT library.
` };
  } else if (d.file === "pack") {
    const k = S.db.get("SELECT * FROM packs WHERE id = ?", e.item_id), asset = assetFor(S, k.audio_id);
    key = `${asset.id}/pack.zip`; job = { op: "pack", spec: json(asset.synth_spec, {}), base: k.title, readme: `${k.title}\n\n${json(k.data, {}).terms ?? ""}\n` };
  } else {
    const tracks = S.db.all("SELECT t.*, a.source, a.synth_spec, a.master_media_id FROM tracks t JOIN audio_assets a ON a.id = t.audio_id WHERE t.release_id = ? AND t.status = 'published' ORDER BY position", e.item_id);
    key = `releases/${e.item_id}/${fmt}.zip`;
    job = { op: "release", format: fmt, readme: "Purchase terms: personal listening and DJ performance. Redistribution, re-uploading or resale isn’t permitted.\n",
      tracks: tracks.map((t) => ({ name: fileSafe(`${String(t.position).padStart(2, "0")} ${t.title}${t.mix ? ` (${t.mix})` : ""}`), ...sourceOf(S, { source: t.source, synth_spec: t.synth_spec, master_media_id: t.master_media_id }) })) };
  }
  return S.audio.file(key, job);
}
function startPreparing(S, d, e) {
  if (S.downloadsInProgress.has(d.id)) return;
  S.downloadsInProgress.add(d.id);
  let p;
  try { p = prepare(S, d, e); } catch (err) { S.downloadsInProgress.delete(d.id); throw err; }
  p.then((out) => {
    S.db.run("UPDATE downloads SET status = 'ready', bytes = ?, file_path = ? WHERE id = ?", out.bytes, out.path, d.id);
  }).catch((err) => {
    S.log("download preparation failed", d.id, err.message);
    S.db.run("UPDATE downloads SET status = 'failed' WHERE id = ?", d.id);
  }).finally(() => S.downloadsInProgress.delete(d.id));
}
function downloadOut(S, d, userId) {
  const ready = (d.status === "ready" || d.status === "completed") && d.file_path && fs.existsSync(d.file_path);
  return { id: d.id, entitlement_id: d.entitlement_id, file: d.file, format: d.format, filename: d.filename, bytes: d.bytes,
    status: d.status === "failed" ? "failed" : ready ? (d.status === "completed" ? "completed" : "ready") : "preparing", created_at: d.created_at, completed_at: d.completed_at,
    ...(ready ? linkFor(S, d, userId) : {}) };
}

/* ------------------------------------------------------------------ library view -- */
export function libraryOut(S, userId, marketplace) {
  const rows = S.db.all(`SELECT e.*, oi.order_id, oi.paid_cents, oi.title FROM entitlements e LEFT JOIN order_items oi ON oi.id = e.order_item_id
    WHERE e.user_id = ? AND e.revoked_at IS NULL ORDER BY e.created_at DESC`, userId);
  const reviewed = new Set(S.db.all("SELECT order_item_id FROM producer_reviews WHERE user_id = ?", userId).map((r) => r.order_item_id));
  const out = rows.map((e) => ({ id: e.id, kind: e.kind, item_id: e.item_id, license_id: e.license_id, format: e.format, order_id: e.order_id, order_item_id: e.order_item_id, reviewed: !!e.order_item_id && reviewed.has(e.order_item_id), paid_cents: e.paid_cents, title: e.title,
    marketplace: e.kind === "beat" || e.kind === "pack" ? "beats" : "electronic", purchased_at: e.created_at, files: filesFor(S, e) }));
  const downloads = S.db.all("SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", userId).map((d) => downloadOut(S, d, userId));
  return { items: marketplace ? out.filter((x) => x.marketplace === marketplace) : out, downloads };
}

/* ------------------------------------------------------------------ routes ------- */
export function register(r, S) {
  S.downloadsInProgress = new Set();

  r.get("/api/store/library", ({ user, query }) => {
    if (query.marketplace && !["beats", "electronic"].includes(query.marketplace)) throw bad("invalid_marketplace", "Unknown marketplace.");
    return libraryOut(S, user.id, query.marketplace);
  });

  r.post("/api/store/library/:id/downloads", ({ user, params, body }) => {
    S.limiter.take("download", user.id);
    const e = S.db.get("SELECT * FROM entitlements WHERE id = ? AND user_id = ? AND revoked_at IS NULL", params.id, user.id);
    if (!e) throw notFound("That purchase isn’t in your library.");
    const file = String(body.file ?? ""), format = String(body.format ?? "");
    const allowed = filesFor(S, e);
    if (!allowed.some((f) => f.file === file && f.format === format)) throw bad("file_not_included", "That file isn’t included with this purchase.");
    const d = { id: id("dl"), user_id: user.id, entitlement_id: e.id, file, format, filename: names(S, e, file, format), bytes: 0, status: "preparing", created_at: S.now() };
    S.db.run("INSERT INTO downloads (id, user_id, entitlement_id, file, format, filename, bytes, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)", d.id, d.user_id, d.entitlement_id, file, format, d.filename, 0, "preparing", d.created_at);
    startPreparing(S, d, e);
    return { download: downloadOut(S, S.db.get("SELECT * FROM downloads WHERE id = ?", d.id), user.id) };
  });

  r.get("/api/store/downloads/:id", ({ user, params }) => {
    const d = S.db.get("SELECT * FROM downloads WHERE id = ? AND user_id = ?", params.id, user.id);
    if (!d) throw notFound("Download not found.");
    // Preparation interrupted (restart) or the cached file was trimmed: prepare again
    const cached = d.file_path && fs.existsSync(d.file_path);
    if ((d.status === "preparing" || ((d.status === "ready" || d.status === "completed") && !cached)) && !S.downloadsInProgress.has(d.id)) {
      const e = S.db.get("SELECT * FROM entitlements WHERE id = ? AND revoked_at IS NULL", d.entitlement_id);
      if (e) { S.db.run("UPDATE downloads SET status = 'preparing' WHERE id = ?", d.id); startPreparing(S, d, e); }
    }
    return { download: downloadOut(S, S.db.get("SELECT * FROM downloads WHERE id = ?", d.id), user.id) };
  });

  // The file itself: signed link + the same signed-in account + a still-valid entitlement
  r.get("/api/store/downloads/:id/file", ({ user, params, query, req, res }) => {
    const d = S.db.get("SELECT * FROM downloads WHERE id = ? AND user_id = ?", params.id, user.id);
    if (!d) throw notFound("Download not found.");
    verifyLink(S, d, user.id, query.exp, query.sig);
    if (!S.db.get("SELECT 1 FROM entitlements WHERE id = ? AND user_id = ? AND revoked_at IS NULL", d.entitlement_id, user.id)) throw forbidden("not_owned", "This purchase is no longer in your library.");
    const file = d.file_path;
    if (!file || !fs.existsSync(file) || d.status === "preparing" || d.status === "failed") throw new HttpError(409, "not_ready", "This download is still being prepared.");
    const type = d.file === "master" ? { WAV: "audio/wav", AIFF: "audio/aiff", MP3: "audio/mpeg" }[d.format] : "application/zip";
    const encoded = encodeURIComponent(d.filename);
    res.on("finish", () => { if (!req.headers.range) S.db.run("UPDATE downloads SET status = 'completed', completed_at = ? WHERE id = ?", S.now(), d.id); });
    sendFile(req, res, file, { type, cache: "private, no-store",
      extraHeaders: { "Content-Disposition": `attachment; filename="${d.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encoded}` } });
  });

  r.get("/api/store/library/:id/license", ({ user, params, res }) => {
    const e = S.db.get("SELECT * FROM entitlements WHERE id = ? AND user_id = ? AND kind = 'beat'", params.id, user.id);
    if (!e || !e.license_id) throw notFound("License agreement not found.");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="license-${e.item_id}-${e.license_id}.txt"`, "Cache-Control": "no-store" });
    res.end(licenseText(S, e));
  });

  // Producer-enabled free downloads (MP3, non-commercial): an entitlement without a license tier
  r.post("/api/store/beats/:id/free-download", ({ user, params }) => {
    S.limiter.take("download", user.id);
    const b = S.db.get("SELECT * FROM beats WHERE id = ? AND status = 'published'", params.id);
    if (!b || !b.free_download) throw notFound("This beat isn’t offered as a free download.");
    let e = S.db.get("SELECT * FROM entitlements WHERE user_id = ? AND kind = 'beat' AND item_id = ? AND license_id IS NULL AND revoked_at IS NULL", user.id, b.id);
    if (!e) {
      S.db.run("INSERT INTO entitlements (id, user_id, kind, item_id, license_id, format, created_at) VALUES (?,?,?,?,NULL,'MP3',?)", id("en"), user.id, "beat", b.id, S.now());
      e = S.db.get("SELECT * FROM entitlements WHERE user_id = ? AND kind = 'beat' AND item_id = ? AND license_id IS NULL AND revoked_at IS NULL", user.id, b.id);
    }
    return { entitlement: { id: e.id, files: filesFor(S, e) } };
  });
}

export function jobs(S) { S.every(30 * 60_000, () => { try { S.audio.trim(); } catch (err) { S.log("cache trim failed", err); } }); }
export const _test = { verifyLink, linkFor, fileSafe, path, fs };
