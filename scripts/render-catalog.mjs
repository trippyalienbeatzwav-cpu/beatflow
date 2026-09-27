/* global encodeWav, encodeRef -- defined in the ingest page before evaluate() calls */
// Catalog ingest: for every Electronic Music Store track, render its master (js/music/synth.js), analyse it
// with the same DSP the store uses (js/music/dsp.js), and write:
//   assets/audio/previews/<id>.opus     90 s Ogg Opus preview clip (64 kb/s, 48 kHz stereo)
//   assets/audio/analysis/<id>.wf       overview waveform of the FULL master (TBWF, 25 columns/s)
//   assets/audio/analysis/<id>.json     BPM, grid, key, sections, cues, loop, preview window, format
//   assets/audio/test/<A..G>.opus/.json reference tracks with ground truth (for the Player Lab and E2E tests)
//   assets/audio/qa-report.json         detected vs planned structure / metadata for the whole catalog
//   assets/audio/beats/<id>.opus/.wf/.json  Beats Store beats and pack demos (with --set beats)
// Usage: node scripts/render-catalog.mjs [--set tracks|beats] [--only t1,t2] [--jobs 3]
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as FX from "../tests/fixtures/audio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "assets", "audio");
for (const d of ["previews", "analysis", "test", "beats"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const JOBS = Number(arg("--jobs", 3));
const SET = arg("--set", "tracks");
const PREVIEW = SET === "beats" ? { length: 150, fadeIn: 0.05, fadeOut: 3, bitrate: 64000, fromStart: true } : { length: 90, fadeIn: 0.5, fadeOut: 3, bitrate: 64000 };
const DIRS = SET === "beats" ? { preview: "beats", analysis: "beats" } : { preview: "previews", analysis: "analysis" };

// ---- Catalog metadata (the seed catalog the database is built from) ----
const { loadSeedCatalog } = await import("../server/seed-data/catalog.js");
const { synthInput } = await import("../server/lib/audio/worker.js");
const cat = loadSeedCatalog();
const tracks = (SET === "beats"
  ? [...cat.beats.map((b) => synthInput({ kind: "beat", id: b.id, title: b.title, bpm: b.bpm, key: b.key, genre: b.genre, duration: b.duration })),
     ...cat.packs.map((k) => synthInput({ kind: "pack", id: k.id, title: k.title, bpm: k.bpm, key: k.key, genre: k.genre, duration: k.duration }))]
  : cat.tracks.map((t) => ({ id: t.id, title: t.title, bpm: t.bpm, key: t.key, family: t.family, energy: t.energy, duration: t.duration, intro: t.intro, outro: t.outro, genre: t.genre })))
  .filter((t) => !only || only.has(t.id));

// ---- Reference tracks as WAV (served to the page for Opus encoding) ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tb-ref-"));
const refs = [["A", FX.trackA()], ["B", FX.trackB()], ["C", FX.trackC()], ["D", FX.trackD()], ["E", FX.trackE()], ["F", FX.trackF()], ["G", FX.trackG()]];
if (!only && SET === "tracks") for (const [k, tr] of refs) FX.writeWav(path.join(tmp, `${k}.wav`), tr.ch);

// ---- Files are served to the page through Playwright request interception (no listening socket).
// The page origin is 127.0.0.1, which browsers treat as a secure context (required for WebCodecs).
const base = "http://127.0.0.1:47123";
function serve(route) {
  const u = decodeURIComponent(new URL(route.request().url()).pathname);
  if (u === "/") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>ingest</title>" });
  const file = u.startsWith("/ref/") ? path.join(tmp, path.basename(u)) : path.join(root, u);
  if ((!file.startsWith(root) && !file.startsWith(tmp)) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ status: 200, contentType: u.endsWith(".js") ? "text/javascript" : "application/octet-stream", body: fs.readFileSync(file) });
}

// ---- In-page helpers: Ogg Opus muxer + encode + verification ----
const PAGE_LIB = String.raw`
window.oggCrcTable = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0; t[i] = r >>> 0; } return t; })();
window.oggCrc = (b) => { let c = 0; for (let i = 0; i < b.length; i++) c = ((c << 8) ^ oggCrcTable[((c >>> 24) ^ b[i]) & 255]) >>> 0; return c >>> 0; };
window.oggPage = (serial, seq, granule, flags, packets) => {
  const lacing = []; for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const size = 27 + lacing.length + packets.reduce((a, p) => a + p.length, 0);
  const b = new Uint8Array(size); const dv = new DataView(b.buffer);
  b.set([79, 103, 103, 83]); b[4] = 0; b[5] = flags;
  dv.setUint32(6, Number(BigInt.asUintN(64, BigInt(granule)) & 0xffffffffn), true); dv.setUint32(10, Number(BigInt.asUintN(64, BigInt(granule)) >> 32n), true);
  dv.setUint32(14, serial, true); dv.setUint32(18, seq, true); dv.setUint32(22, 0, true); b[26] = lacing.length; b.set(lacing, 27);
  let o = 27 + lacing.length; for (const p of packets) { b.set(p, o); o += p.length; }
  dv.setUint32(22, oggCrc(b), true); return b;
};
window.encodeOpus = async (buffer, from, to, bitrate) => {
  const sr = buffer.sampleRate, a = Math.round(from * sr), n = Math.round(to * sr) - a;
  const L = buffer.getChannelData(0).subarray(a, a + n), R = buffer.getChannelData(1).subarray(a, a + n);
  const packets = []; let head = null;
  const enc = new AudioEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); packets.push({ d, dur: Math.round((c.duration ?? 20000) * 48 / 1000) }); if (m?.decoderConfig?.description) head = new Uint8Array(m.decoderConfig.description); }, error: (e) => { throw e; } });
  enc.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate });
  const CH = 48000;
  for (let i = 0; i < n; i += CH) { const m = Math.min(CH, n - i); const data = new Float32Array(m * 2); data.set(L.subarray(i, i + m), 0); data.set(R.subarray(i, i + m), m); enc.encode(new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data })); }
  await enc.flush(); enc.close();
  const pre = head[10] | (head[11] << 8);
  const tags = new TextEncoder().encode("OpusTags"), vendor = new TextEncoder().encode("TUNIBEAT ingest");
  const tp = new Uint8Array(8 + 4 + vendor.length + 4); tp.set(tags); new DataView(tp.buffer).setUint32(8, vendor.length, true); tp.set(vendor, 12);
  const serial = 0x54554e49, pages = [oggPage(serial, 0, 0, 2, [head]), oggPage(serial, 1, 0, 0, [tp])];
  let seq = 2, gran = pre, i = 0;
  while (i < packets.length) {
    const group = []; let segs = 0;
    while (i < packets.length && segs + Math.floor(packets[i].d.length / 255) + 1 <= 255 && group.length < 50) { segs += Math.floor(packets[i].d.length / 255) + 1; gran += packets[i].dur; group.push(packets[i].d); i++; }
    const last = i >= packets.length;
    pages.push(oggPage(serial, seq++, last ? pre + n : gran, last ? 4 : 0, group));
  }
  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of pages) { out.set(p, o); o += p.length; }
  return { bytes: out, preSkip: pre };
};
/** Decode the clip again and measure its alignment against the source (cross-correlation of the first 2 s). */
window.verifyClip = async (bytes, buffer, from) => {
  const ac = new OfflineAudioContext(2, 48000, 48000);
  const dec = await ac.decodeAudioData(bytes.slice().buffer);
  const src = buffer.getChannelData(0), a = Math.round(from * 48000), d = dec.getChannelData(0);
  let best = 0, bestLag = 0;
  for (let lag = -600; lag <= 600; lag++) { let s = 0; for (let i = 20000; i < 68000; i += 3) s += d[i] * (src[a + i + lag] ?? 0); if (s > best) { best = s; bestLag = lag; } }
  return { lagSamples: bestLag, decodedSeconds: dec.duration };
};
window.b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
window.encodeWav = async (url, opts) => {
  const ab = await (await fetch(url)).arrayBuffer();
  const ac = new OfflineAudioContext(2, 48000, 48000);
  const buf = await ac.decodeAudioData(ab);
  const clip = await encodeOpus(buf, 0, buf.duration, opts.bitrate);
  const check = await verifyClip(clip.bytes, buf, 0);
  return { opus: b64(clip.bytes), preSkip: clip.preSkip, check };
};
window.encodeRef = async (name, opts) => {
  const ab = await (await fetch("/ref/" + name + ".wav")).arrayBuffer();
  const ac = new OfflineAudioContext(2, 48000, 48000);
  const buf = await ac.decodeAudioData(ab);   // resampled to 48 kHz
  const clip = await encodeOpus(buf, 0, buf.duration, opts.bitrate);
  return b64(clip.bytes);
};`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
const page = await browser.newPage();
await page.route("http://127.0.0.1:47123/**", serve);
await page.goto(base + "/");
await page.addScriptTag({ content: PAGE_LIB });

// Render + analyse in worker threads; the browser page only encodes Opus (WebCodecs)
const { Worker } = await import("node:worker_threads");
const workers = Array.from({ length: Math.max(1, Math.min(JOBS, os.cpus().length - 1)) }, () => new Worker(new URL("./ingest-worker.mjs", import.meta.url)));
const qa = [];
let next = 0, encodeChain = Promise.resolve();
const t0 = Date.now();
await Promise.all(workers.map((w) => (async () => {
  while (next < tracks.length) {
    const tr = tracks[next++];
    const wavPath = path.join(tmp, `${tr.id}.wav`);
    const res = await new Promise((resolve) => { w.once("message", resolve); w.postMessage({ meta: tr, preview: PREVIEW, wavPath, dir: DIRS }); });
    // Serialise encodes on the single page
    const enc = await (encodeChain = encodeChain.then(() => page.evaluate(([u, o]) => encodeWav(u, o), [`/ref/${tr.id}.wav`, PREVIEW])));
    fs.rmSync(wavPath, { force: true });
    res.meta.format.preSkip = enc.preSkip;
    fs.writeFileSync(path.join(OUT, DIRS.preview, `${tr.id}.opus`), Buffer.from(enc.opus, "base64"));
    fs.writeFileSync(path.join(OUT, DIRS.analysis, `${tr.id}.wf`), res.wf);
    fs.writeFileSync(path.join(OUT, DIRS.analysis, `${tr.id}.json`), JSON.stringify(res.meta));
    const m = res.meta, planned = res.truth.sections;
    const drop = m.sections.find((s) => s.label === "drop"), pdrop = planned.find((s) => s.label === "drop");
    const norm = (k) => (k ?? "").replace("♯", "#").replace("♭", "b");
    const row = {
      id: tr.id, family: tr.family, metaBpm: tr.bpm, bpm: m.bpm, bpmMatch: Math.abs(m.bpm - tr.bpm) < 0.05,
      metaKey: tr.key, key: m.key?.name, keyMatch: norm(m.key?.name) === norm(tr.key),
      dropBarError: drop && pdrop ? drop.startBar - pdrop.startBar : null,
      sections: m.sections.map((s) => `${s.label}@${s.startBar}`).join(" "), planned: planned.map((s) => `${s.label}@${s.startBar}`).join(" "),
      clipLagSamples: enc.check.lagSamples, confidence: m.beatConfidence, ms: res.timings,
    };
    qa.push(row);
    console.log(`${tr.id.padEnd(4)} ${tr.family.padEnd(9)} bpm ${String(tr.bpm).padStart(3)}→${String(m.bpm).padEnd(6)} key ${tr.key}→${m.key?.name} dropΔbar ${row.dropBarError} lag ${enc.check.lagSamples} (${res.timings.render}+${res.timings.analyse} ms)`);
  }
})()));
workers.forEach((w) => w.terminate());

if (!only && SET === "tracks") {
  for (const [k, tr] of refs) {
    const b = await page.evaluate(([n, o]) => encodeRef(n, o), [k, PREVIEW]);
    fs.writeFileSync(path.join(OUT, "test", `${k}.opus`), Buffer.from(b, "base64"));
    fs.writeFileSync(path.join(OUT, "test", `${k}.json`), JSON.stringify({ id: k, name: tr.name, expect: tr.expect ?? null, bpm: tr.bpm ?? null, firstBeat: tr.firstBeat ?? null, sections: tr.sections ?? null }));
  }
}
const QA = path.join(OUT, SET === "beats" ? "qa-beats.json" : "qa-report.json");
const prev = fs.existsSync(QA) ? JSON.parse(fs.readFileSync(QA, "utf8")).tracks : [];
const all = [...prev.filter((p) => !qa.some((q) => q.id === p.id)), ...qa].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
const summary = {
  generated_at: new Date().toISOString(), tracks: all.length,
  bpmExact: all.filter((r) => r.bpmMatch).length, keyExact: all.filter((r) => r.keyMatch).length,
  dropWithin1Bar: all.filter((r) => r.dropBarError != null && Math.abs(r.dropBarError) <= 1).length,
  maxClipLagSamples: Math.max(...all.map((r) => Math.abs(r.clipLagSamples))),
};
fs.writeFileSync(QA, JSON.stringify({ summary, tracks: all }, null, 2));
console.log("summary", JSON.stringify(summary), `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close(); fs.rmSync(tmp, { recursive: true, force: true });
