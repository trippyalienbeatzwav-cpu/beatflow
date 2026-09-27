// Media pipeline: chunked, resumable uploads → content sniffing and validation → storage → metadata row.
// Files go to disk under DATA_DIR/media (swap for object storage with a CDN in front; the DB holds only
// metadata and storage keys). Browsers do the image work before upload: downscaling, WebP, a small
// variant, and poster frames for video. The server re-validates every file it receives.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { id } from "../lib/ids.js";
import { bad, notFound, HttpError, readBody } from "../lib/http.js";
import { json } from "../lib/db.js";
import { probeAudio } from "../lib/audio/codec.js";
import { listZip } from "../lib/audio/zip.js";

const MIME = {
  image: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" },
  video: { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  audio: { "audio/webm": "weba", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/aiff": "aiff" },
  file: { "application/pdf": "pdf", "text/plain": "txt", "application/zip": "zip" },
};
const PURPOSE_KINDS = {
  post: ["image", "video"], reel: ["video"], story: ["image", "video"], avatar: ["image"], cover: ["image"],
  message: ["image", "video", "audio", "file"], live_thumbnail: ["image"], poster: ["image"], variant: ["image"],
  master_audio: ["audio"], stems_archive: ["file"], artwork: ["image"],
};
/** Store uploads: lossless masters and stems are private (never served from /media). */
const PRIVATE_PURPOSES = new Set(["master_audio", "stems_archive"]);
const PURPOSE_MIMES = { master_audio: ["audio/wav", "audio/aiff"], stems_archive: ["application/zip"] };
const MIME_ALIASES = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "audio/x-aiff": "audio/aiff", "application/x-zip-compressed": "application/zip" };
const STEM_EXT = /\.(wav|aif|aiff|txt|pdf)$/i;

export function sniff(buf) {
  const s = (a, b) => buf.subarray(a, b).toString("latin1");
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (s(0, 4) === "GIF8") return "image/gif";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "image/webp";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "audio/wav";
  if (s(0, 4) === "FORM" && (s(8, 12) === "AIFF" || s(8, 12) === "AIFC")) return "audio/aiff";
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return "matroska";   // webm video or audio
  if (s(4, 8) === "ftyp") {
    const brand = s(8, 12);
    return brand === "qt  " ? "video/quicktime" : /^(M4A |M4B )/.test(brand) ? "audio/mp4" : "iso-bmff";
  }
  if (s(0, 4) === "OggS") return "audio/ogg";
  if (s(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (s(0, 5) === "%PDF-") return "application/pdf";
  if (buf.readUInt32BE(0) === 0x504b0304) return "application/zip";
  return null;
}
function sniffMatches(sniffed, declared, buf) {
  if (sniffed === declared) return true;
  if (sniffed === "matroska") return declared === "video/webm" || declared === "audio/webm";
  if (sniffed === "iso-bmff") return declared === "video/mp4" || declared === "audio/mp4";
  if (sniffed === null && declared === "text/plain") return !buf.includes(0);
  return false;
}

/** Width/height straight from the image header, so client-reported dimensions are never trusted. */
export function imageSize(buf, mime) {
  try {
    if (mime === "image/png") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === "image/gif") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === "image/webp") {
      const chunk = buf.subarray(12, 16).toString("latin1");
      if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return null;
}

export function mediaOut(S, m) {
  if (!m) return null;
  const variants = json(m.variants, {});
  return {
    id: m.id, kind: m.kind, mime: m.mime, url: S.mediaUrl(m.storage_key), width: m.width, height: m.height, duration_ms: m.duration_ms, bytes: m.bytes,
    poster_url: S.mediaUrl(m.poster_key), variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, S.mediaUrl(v)])), status: m.status,
  };
}
export const lookupKey = (S, key) => S.db.get("SELECT kind, mime, access FROM media WHERE storage_key = ?", key);

/** Store a finished file (also used by the seeder). */
export function storeFile(S, { ownerId, kind, mime, buf, width = null, height = null, durationMs = null, createdAt = null }) {
  const mid = id("m");
  const now = createdAt ?? S.now();
  const dir = new Date(now).toISOString().slice(0, 7).replace("-", "");
  const key = `${dir}/${mid}.${MIME[kind][mime]}`;
  fs.mkdirSync(path.join(S.mediaDir, dir), { recursive: true });
  fs.writeFileSync(path.join(S.mediaDir, key), buf);
  S.db.run(`INSERT INTO media (id, owner_id, kind, mime, bytes, width, height, duration_ms, storage_key, sha256, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    mid, ownerId, kind, mime, buf.length, width, height, durationMs, key, crypto.createHash("sha256").update(buf).digest("hex"), "ready", now);
  return S.db.get("SELECT * FROM media WHERE id = ?", mid);
}

/** Validate that media ids belong to the user, are ready, and match the allowed kinds. */
export function ownedMedia(S, userId, ids, kinds) {
  return ids.map((mid) => {
    const m = S.db.get("SELECT * FROM media WHERE id = ? AND owner_id = ?", String(mid), userId);
    if (!m) throw bad("invalid_media", "One of the attachments wasn’t found. Upload it again.");
    if (m.status !== "ready") throw bad("media_not_ready", "An attachment is still processing.");
    if (kinds && !kinds.includes(m.kind)) throw bad("invalid_media_kind", `Expected ${kinds.join(" or ")}.`);
    return m;
  });
}

const partFile = (S, sid) => path.join(S.cfg.dataDir, "uploads", `${sid}.part`);

export function register(r, S) {
  const L = S.cfg.media;
  r.post("/api/media/uploads", ({ body, user }) => {
    S.limiter.take("upload", user.id);
    const purpose = String(body.purpose ?? "");
    const rawMime = String(body.mime ?? "").toLowerCase().split(";")[0];
    const mime = MIME_ALIASES[rawMime] ?? rawMime;
    if (PURPOSE_MIMES[purpose] && !PURPOSE_MIMES[purpose].includes(mime)) throw bad("unsupported_type", purpose === "master_audio" ? "Masters must be uncompressed WAV or AIFF files." : "Stems must be a .zip archive.");
    const kind = Object.keys(MIME).find((k) => MIME[k][mime]);
    if (!PURPOSE_KINDS[purpose]) throw bad("invalid_purpose", "Unknown upload purpose.");
    if (!kind || !PURPOSE_KINDS[purpose].includes(kind)) throw bad("unsupported_type", `That file type isn’t supported here. Allowed: ${PURPOSE_KINDS[purpose].flatMap((k) => Object.keys(MIME[k])).join(", ")}.`);
    const bytes = Number(body.bytes);
    const max = purpose === "master_audio" ? L.maxMasterBytes : purpose === "stems_archive" ? L.maxStemsBytes : { image: L.maxImageBytes, video: L.maxVideoBytes, audio: L.maxAudioBytes, file: L.maxFileBytes }[kind];
    if (!Number.isInteger(bytes) || bytes <= 0) throw bad("invalid_size", "File size is required.");
    if (bytes > max) throw new HttpError(413, "file_too_large", `That file is ${(bytes / 1048576).toFixed(1)} MB. The limit for ${kind} is ${max / 1048576} MB.`);
    const meta = { duration_ms: Number(body.duration_ms) || null, width: Number(body.width) || null, height: Number(body.height) || null };
    if (purpose === "reel" && meta.duration_ms && meta.duration_ms > 180_000) throw bad("reel_too_long", "Reels can be up to 3 minutes.");
    if (purpose === "story" && kind === "video" && meta.duration_ms && meta.duration_ms > 60_000) throw bad("story_too_long", "Story videos can be up to 60 seconds.");
    const sid = id("up");
    const now = S.now();
    fs.mkdirSync(path.dirname(partFile(S, sid)), { recursive: true });
    fs.writeFileSync(partFile(S, sid), Buffer.alloc(0));
    S.db.run(`INSERT INTO upload_sessions (id, owner_id, purpose, kind, filename, mime, total_bytes, chunk_size, meta, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      sid, user.id, purpose, kind, String(body.filename ?? "upload").slice(0, 120), mime, bytes, L.chunkSize, JSON.stringify(meta), now, now + L.uploadTtlMs);
    return { upload: { id: sid, chunk_size: L.chunkSize, chunks: Math.ceil(bytes / L.chunkSize), received: [] } };
  });

  const openSession = (sid, userId) => {
    const s = S.db.get("SELECT * FROM upload_sessions WHERE id = ? AND owner_id = ?", sid, userId);
    if (!s) throw notFound("Upload not found.");
    if (s.status !== "open") throw new HttpError(409, "upload_" + s.status, `This upload is ${s.status}.`);
    if (s.expires_at < S.now()) throw new HttpError(410, "upload_expired", "This upload expired. Start again.");
    return s;
  };

  r.get("/api/media/uploads/:id", ({ params, user }) => {
    const s = S.db.get("SELECT * FROM upload_sessions WHERE id = ? AND owner_id = ?", params.id, user.id);
    if (!s) throw notFound("Upload not found.");
    return { upload: { id: s.id, status: s.status, chunk_size: s.chunk_size, chunks: Math.ceil(s.total_bytes / s.chunk_size), received: json(s.received, []), media_id: s.media_id } };
  });

  r.put("/api/media/uploads/:id/chunks/:index", async ({ params, user, req }) => {
    const s = openSession(params.id, user.id);
    const index = Number(params.index);
    const chunks = Math.ceil(s.total_bytes / s.chunk_size);
    if (!Number.isInteger(index) || index < 0 || index >= chunks) throw bad("invalid_chunk", "Chunk index out of range.");
    const expected = index === chunks - 1 ? s.total_bytes - index * s.chunk_size : s.chunk_size;
    const buf = await readBody(req, s.chunk_size);
    if (buf.length !== expected) throw bad("chunk_size_mismatch", `Chunk ${index} should be ${expected} bytes, got ${buf.length}.`);
    const fd = fs.openSync(partFile(S, s.id), "r+");
    try { fs.writeSync(fd, buf, 0, buf.length, index * s.chunk_size); } finally { fs.closeSync(fd); }
    // Re-read inside the write so parallel chunk requests don't lose each other's progress
    const received = S.db.tx(() => {
      const cur = new Set(json(S.db.get("SELECT received FROM upload_sessions WHERE id = ?", s.id).received, []));
      cur.add(index);
      const arr = [...cur].sort((a, b) => a - b);
      S.db.run("UPDATE upload_sessions SET received = ? WHERE id = ?", JSON.stringify(arr), s.id);
      return arr;
    });
    return { received: received.length, chunks };
  }, { raw: true });

  r.post("/api/media/uploads/:id/complete", async ({ params, user, body }) => {
    const s = openSession(params.id, user.id);
    const chunks = Math.ceil(s.total_bytes / s.chunk_size);
    const received = json(s.received, []);
    if (received.length !== chunks) throw new HttpError(409, "upload_incomplete", `Received ${received.length} of ${chunks} chunks.`, { missing: [...Array(chunks).keys()].filter((i) => !received.includes(i)) });
    if (PRIVATE_PURPOSES.has(s.purpose)) return completePrivate(S, s, body);
    const buf = fs.readFileSync(partFile(S, s.id));
    const fail = (code, msg) => {
      S.db.run("UPDATE upload_sessions SET status = 'failed' WHERE id = ?", s.id);
      fs.rmSync(partFile(S, s.id), { force: true });
      return bad(code, msg);
    };
    if (buf.length !== s.total_bytes) throw fail("size_mismatch", "The uploaded file size doesn’t match.");
    if (body.sha256 && body.sha256 !== crypto.createHash("sha256").update(buf).digest("hex")) throw fail("checksum_mismatch", "The file was corrupted in transit. Try again.");
    if (!sniffMatches(sniff(buf), s.mime, buf)) throw fail("content_mismatch", "The file’s contents don’t match its type.");
    const meta = json(s.meta, {});
    let dims = null;
    if (s.kind === "image") {
      dims = imageSize(buf, s.mime);
      if (!dims || dims.width < 1 || dims.height < 1) throw fail("unreadable_image", "That image couldn’t be read.");
      if (dims.width > 8000 || dims.height > 8000) throw fail("image_too_large", "Images can be at most 8000 × 8000 px.");
    }
    // Poster frames and resized variants are uploaded first, then linked here (they must be the user's own images)
    const poster = body.poster_media_id ? S.db.get("SELECT * FROM media WHERE id = ? AND owner_id = ? AND kind = 'image'", String(body.poster_media_id), user.id) : null;
    const variants = {};
    for (const [name, mid] of Object.entries(body.variants ?? {})) {
      if (!/^w\d{2,4}$/.test(name)) continue;
      const v = S.db.get("SELECT storage_key FROM media WHERE id = ? AND owner_id = ? AND kind = 'image'", String(mid), user.id);
      if (v) variants[name] = v.storage_key;
    }
    const duration = s.kind === "video" || s.kind === "audio" ? Math.max(0, Math.min(Number(meta.duration_ms) || 0, 3 * 3600_000)) || null : null;
    const m = storeFile(S, { ownerId: user.id, kind: s.kind, mime: s.mime, buf, width: dims?.width ?? (s.kind === "video" ? meta.width : null), height: dims?.height ?? (s.kind === "video" ? meta.height : null), durationMs: duration });
    S.db.run("UPDATE media SET poster_key = ?, variants = ? WHERE id = ?", poster?.storage_key ?? null, JSON.stringify(variants), m.id);
    S.db.run("UPDATE upload_sessions SET status = 'complete', media_id = ? WHERE id = ?", m.id, s.id);
    fs.rmSync(partFile(S, s.id), { force: true });
    if (s.kind === "video" && S.transcoder.available) transcode(S, m);
    return { media: mediaOut(S, S.db.get("SELECT * FROM media WHERE id = ?", m.id)) };
  });

  r.delete("/api/media/uploads/:id", ({ params, user }) => {
    const s = S.db.get("SELECT * FROM upload_sessions WHERE id = ? AND owner_id = ?", params.id, user.id);
    if (!s) throw notFound("Upload not found.");
    if (s.status === "open") {
      S.db.run("UPDATE upload_sessions SET status = 'cancelled' WHERE id = ?", s.id);
      fs.rmSync(partFile(S, s.id), { force: true });
    }
    return { ok: true };
  });
}

/**
 * Private store files (lossless masters, stems archives): validated from the header or central
 * directory and hashed as a stream, then moved (not copied) into the private directory.
 */
async function completePrivate(S, s, body) {
  const part = partFile(S, s.id);
  const fail = (code, msg) => {
    S.db.run("UPDATE upload_sessions SET status = 'failed' WHERE id = ?", s.id);
    fs.rmSync(part, { force: true });
    return bad(code, msg);
  };
  const size = fs.statSync(part).size;
  if (size !== s.total_bytes) throw fail("size_mismatch", "The uploaded file size doesn’t match.");
  const sha = await new Promise((res, rej) => { const h = crypto.createHash("sha256"); fs.createReadStream(part).on("data", (c) => h.update(c)).on("end", () => res(h.digest("hex"))).on("error", rej); });
  if (body.sha256 && body.sha256 !== sha) throw fail("checksum_mismatch", "The file was corrupted in transit. Try again.");
  const head = Buffer.alloc(64); const fd = fs.openSync(part, "r"); fs.readSync(fd, head, 0, 64, 0); fs.closeSync(fd);
  if (s.purpose === "master_audio") {
    const kind = probeAudio(head);
    if (!kind || (kind === "wav") !== (s.mime === "audio/wav")) throw fail("content_mismatch", "That file isn’t a WAV or AIFF master.");
  } else {
    if (head.readUInt32BE(0) !== 0x504b0304) throw fail("content_mismatch", "That file isn’t a .zip archive.");
    let entries;
    try { entries = listZip(part); } catch (err) { throw fail("invalid_archive", err.message); }
    const files = entries.filter((e) => !e.name.endsWith("/"));
    if (!files.length) throw fail("invalid_archive", "The archive is empty.");
    const badEntry = files.find((e) => !STEM_EXT.test(e.name) || e.name.startsWith("__MACOSX"));
    if (badEntry) throw fail("invalid_archive", `Stems archives may only contain WAV/AIFF audio and text/PDF notes (found “${badEntry.name.slice(0, 60)}”).`);
  }
  const mid = id("m"), now = S.now();
  const dir = new Date(now).toISOString().slice(0, 7).replace("-", "");
  const key = `${dir}/${mid}.${MIME[s.kind][s.mime]}`;
  fs.mkdirSync(path.join(S.privateDir, dir), { recursive: true });
  fs.renameSync(part, path.join(S.privateDir, key));
  S.db.run(`INSERT INTO media (id, owner_id, kind, mime, bytes, storage_key, sha256, status, created_at, access) VALUES (?,?,?,?,?,?,?,?,?,'private')`, mid, s.owner_id, s.kind, s.mime, size, key, sha, "ready", now);
  S.db.run("UPDATE upload_sessions SET status = 'complete', media_id = ? WHERE id = ?", mid, s.id);
  const m = S.db.get("SELECT * FROM media WHERE id = ?", mid);
  return { media: { id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, status: m.status, private: true } };
}

function transcode(S, m) {
  const input = path.join(S.mediaDir, m.storage_key);
  const outKey = m.storage_key.replace(/\.\w+$/, ".720.mp4");
  S.db.run("UPDATE media SET status = 'processing' WHERE id = ?", m.id);
  S.transcoder.rendition720(input, path.join(S.mediaDir, outKey)).then((ok) => {
    const v = json(S.db.get("SELECT variants FROM media WHERE id = ?", m.id)?.variants, {});
    if (ok) v.v720 = outKey;
    S.db.run("UPDATE media SET status = 'ready', variants = ? WHERE id = ?", JSON.stringify(v), m.id);
  });
}

export function jobs(S) {
  S.every(10 * 60_000, () => {
    const stale = S.db.all("SELECT id FROM upload_sessions WHERE status = 'open' AND expires_at < ?", S.now());
    for (const s of stale) {
      fs.rmSync(partFile(S, s.id), { force: true });
      S.db.run("UPDATE upload_sessions SET status = 'expired' WHERE id = ?", s.id);
    }
  });
}
