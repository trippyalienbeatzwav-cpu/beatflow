// Generates the original seed media for TUNIBEAT Social in a headless browser (Edge or Chrome via playwright-core):
// abstract generative images (WebP) and short vertical videos (WebM, VP8/VP9 + Opus) with synthesized audio.
/* global still, avatar, draw, clip -- helpers injected into the page before evaluate() calls */
// No third-party media is used. Output: server/seed-media/{images,videos}/ + manifest.json
//   npm run seed:media
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "server", "seed-media");
fs.mkdirSync(path.join(out, "images"), { recursive: true });
fs.mkdirSync(path.join(out, "videos"), { recursive: true });

const PALETTES = [
  ["#0f1115", "#c6f432", "#2ee6a6", "#f7f7f2"], ["#14091f", "#ff5d8f", "#ffb547", "#fff4e8"], ["#071a1f", "#39d0ff", "#7b61ff", "#e8f7ff"],
  ["#1a0f0a", "#ff7a3d", "#ffd166", "#fff8ef"], ["#0b0f1a", "#8d68ff", "#5fe0f7", "#f3f0ff"], ["#101410", "#9be15d", "#00c9a7", "#f0fff4"],
  ["#1c0b14", "#ff4d6d", "#c77dff", "#fff0f5"], ["#0d1321", "#f4d35e", "#ee964b", "#faf0ca"],
];
const SCENES = ["waves", "vinyl", "synth", "blobs", "bars", "rings", "halftone", "mixer", "grid", "sun"];

const jobs = {
  avatars: 16, covers: 8, posts: 36, stories: 10, thumbs: 5,
  reels: [
    { scene: "bars", secs: 7, bpm: 124 }, { scene: "vinyl", secs: 7, bpm: 96 }, { scene: "rings", secs: 6, bpm: 140 }, { scene: "waves", secs: 8, bpm: 110 },
    { scene: "synth", secs: 6, bpm: 128 }, { scene: "blobs", secs: 7, bpm: 88 }, { scene: "sun", secs: 6, bpm: 112 }, { scene: "mixer", secs: 7, bpm: 132 },
    { scene: "halftone", secs: 6, bpm: 100 }, { scene: "grid", secs: 7, bpm: 122 },
  ],
  videos: [{ scene: "vinyl", secs: 6, bpm: 90, w: 720, h: 720 }, { scene: "waves", secs: 6, bpm: 120, w: 720, h: 720 }],
  storyVideos: [{ scene: "rings", secs: 5, bpm: 118, w: 540, h: 960 }],
};

const PAGE_LIB = String.raw`
window.draw = function (ctx, w, h, scene, pal, seed, t) {
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const [bg, a, b, fg] = pal;
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, bg); g.addColorStop(1, shade(bg, 18));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const m = Math.min(w, h);
  ctx.save();
  if (scene === "waves") {
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.lineWidth = m * 0.012; ctx.strokeStyle = i % 2 ? a : b; ctx.globalAlpha = 0.25 + i * 0.08;
      for (let x = 0; x <= w; x += 6) { const y = h * (0.2 + i * 0.075) + Math.sin(x / (w * 0.09) + i + t * 2.4) * m * 0.05 * (1 + rnd() * 0.2); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  } else if (scene === "vinyl") {
    const cx = w / 2, cy = h / 2, r = m * 0.38; ctx.translate(cx, cy); ctx.rotate(t * 1.8);
    ctx.fillStyle = "#08080a"; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    for (let i = 0; i < 22; i++) { ctx.strokeStyle = "rgba(255,255,255," + (0.03 + (i % 3) * 0.02) + ")"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r * (0.42 + i * 0.026), 0, 7); ctx.stroke(); }
    ctx.fillStyle = a; ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, 7); ctx.fill(); ctx.fillStyle = b; ctx.fillRect(-r * 0.34, -r * 0.05, r * 0.68, r * 0.1);
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, r * 0.03, 0, 7); ctx.fill();
  } else if (scene === "synth") {
    const cols = 6, rows = 3, pad = m * 0.08, cw = (w - pad * 2) / cols, rh = h * 0.5 / rows;
    for (let r2 = 0; r2 < rows; r2++) for (let c = 0; c < cols; c++) { const x = pad + c * cw + cw / 2, y = h * 0.18 + r2 * rh + rh / 2, rad = Math.min(cw, rh) * 0.32;
      ctx.fillStyle = shade(bg, 30); ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); const ang = -2.3 + (rnd() * 4.6) + Math.sin(t * 2 + c + r2) * 0.4;
      ctx.strokeStyle = (c + r2) % 3 ? a : b; ctx.lineWidth = rad * 0.22; ctx.beginPath(); ctx.arc(x, y, rad * 1.18, -2.3 - 1.57, ang - 1.57); ctx.stroke(); }
    const keys = 14, kw = (w - pad * 2) / keys; for (let k = 0; k < keys; k++) { ctx.fillStyle = k === Math.floor((t * 4) % keys) ? a : fg; ctx.fillRect(pad + k * kw + 2, h * 0.74, kw - 4, h * 0.18); }
  } else if (scene === "blobs") {
    ctx.filter = "blur(" + Math.round(m * 0.06) + "px)"; for (let i = 0; i < 6; i++) { ctx.fillStyle = [a, b, fg][i % 3]; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(w * (0.2 + rnd() * 0.6) + Math.sin(t + i) * m * 0.08, h * (0.2 + rnd() * 0.6) + Math.cos(t * 1.3 + i) * m * 0.08, m * (0.14 + rnd() * 0.16), 0, 7); ctx.fill(); }
  } else if (scene === "bars") {
    const n = 32, bw = w / n; for (let i = 0; i < n; i++) { const v = 0.15 + Math.abs(Math.sin(i * 0.55 + t * 5 + rnd())) * 0.7; ctx.fillStyle = i % 4 ? a : b; ctx.globalAlpha = 0.9;
      ctx.fillRect(i * bw + bw * 0.18, h * (0.92 - v * 0.75), bw * 0.64, h * v * 0.75); }
  } else if (scene === "rings") {
    for (let i = 12; i > 0; i--) { ctx.strokeStyle = i % 2 ? a : b; ctx.globalAlpha = 0.18 + (12 - i) * 0.06; ctx.lineWidth = m * 0.02;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, (i * m * 0.045 + t * m * 0.08) % (m * 0.6), 0, 7); ctx.stroke(); }
  } else if (scene === "halftone") {
    const step = m * 0.045; for (let y = 0; y < h + step; y += step) for (let x = 0; x < w + step; x += step) { const d = Math.hypot(x - w * 0.6, y - h * 0.4) / m;
      const r3 = Math.max(0, step * 0.46 * (1 - d * 1.3 + Math.sin(t * 3 + x * 0.01) * 0.1)); ctx.fillStyle = d < 0.35 ? a : b; ctx.beginPath(); ctx.arc(x, y, r3, 0, 7); ctx.fill(); }
  } else if (scene === "mixer") {
    const n = 8, pad = w * 0.08, sw = (w - pad * 2) / n; for (let i = 0; i < n; i++) { const x = pad + i * sw + sw / 2; ctx.fillStyle = shade(bg, 34); ctx.fillRect(x - 3, h * 0.2, 6, h * 0.6);
      const v = 0.5 + Math.sin(t * 2 + i * 0.9 + rnd() * 3) * 0.35; ctx.fillStyle = i % 3 ? a : b; ctx.fillRect(x - sw * 0.3, h * (0.8 - v * 0.6) - 12, sw * 0.6, 24);
      for (let j = 0; j < 10; j++) { ctx.fillStyle = j / 10 < v ? (j > 7 ? "#ff4d6d" : a) : shade(bg, 22); ctx.fillRect(x + sw * 0.22, h * (0.78 - j * 0.055), sw * 0.12, h * 0.04); } }
  } else if (scene === "grid") {
    ctx.strokeStyle = a; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; const hz = h * 0.45;
    for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(w / 2, hz); ctx.lineTo(w / 2 + i * w * 0.12, h); ctx.stroke(); }
    for (let j = 0; j < 12; j++) { const y = hz + Math.pow(((j + (t * 2) % 1) / 12), 2) * (h - hz); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.globalAlpha = 1; const sg = ctx.createLinearGradient(0, hz - m * 0.3, 0, hz); sg.addColorStop(0, b); sg.addColorStop(1, a); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(w / 2, hz, m * 0.22, Math.PI, 0); ctx.fill();
  } else if (scene === "sun") {
    const sg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, m * 0.5); sg.addColorStop(0, fg); sg.addColorStop(0.35, a); sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 7; i++) { ctx.fillStyle = bg; ctx.fillRect(0, h * (0.44 + i * 0.05) + Math.sin(t * 3 + i) * 3, w, h * 0.012 * (i + 1)); }
    ctx.fillStyle = b; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += w / 10) ctx.lineTo(x, h * (0.72 + rnd() * 0.1)); ctx.lineTo(w, h); ctx.fill();
  }
  ctx.restore();
  // Film grain keeps gradients from banding after compression
  ctx.globalAlpha = 0.05; for (let i = 0; i < (w * h) / 900; i++) { ctx.fillStyle = rnd() > 0.5 ? "#fff" : "#000"; ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); } ctx.globalAlpha = 1;
  function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const c = (v) => Math.max(0, Math.min(255, v + amt)); return "rgb(" + c(n >> 16) + "," + c((n >> 8) & 255) + "," + c(n & 255) + ")"; }
};
window.avatar = function (ctx, w, pal, seed, letter) {
  draw(ctx, w, w, ["blobs", "rings", "halftone", "sun"][seed % 4], pal, seed, seed * 0.7);
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(0, 0, w, w);
  ctx.fillStyle = pal[3]; ctx.font = "800 " + Math.round(w * 0.44) + "px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(letter, w / 2, w / 2 + w * 0.03);
};
window.still = async function (w, h, fn) {
  const c = new OffscreenCanvas(w, h); const ctx = c.getContext("2d"); fn(ctx);
  const blob = await c.convertToBlob({ type: "image/webp", quality: 0.82 });
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s);
};
window.clip = async function (w, h, scene, pal, seed, secs, bpm) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d");
  const ac = new AudioContext(); const dest = ac.createMediaStreamDestination(); const master = ac.createGain(); master.gain.value = 0.5; master.connect(dest);
  const beat = 60 / bpm, t0 = ac.currentTime + 0.05;
  for (let i = 0; i < Math.ceil(secs / beat) + 1; i++) {
    const t = t0 + i * beat;
    const k = ac.createOscillator(), kg = ac.createGain(); k.frequency.setValueAtTime(140, t); k.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    kg.gain.setValueAtTime(0.9, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.25); k.connect(kg).connect(master); k.start(t); k.stop(t + 0.3);
    const n = ac.createBufferSource(); const nb = ac.createBuffer(1, ac.sampleRate * 0.05, ac.sampleRate); const d = nb.getChannelData(0); for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
    n.buffer = nb; const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000; const ng = ac.createGain(); ng.gain.value = 0.25; n.connect(hp).connect(ng).connect(master); n.start(t + beat / 2);
    if (i % 2 === 0) { const o = ac.createOscillator(), og = ac.createGain(); o.type = "sawtooth"; const notes = [220, 261.6, 196, 246.9]; o.frequency.value = notes[(i / 2 + seed) % 4];
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.12, t + 0.05); og.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.8);
      o.connect(lp).connect(og).connect(master); o.start(t); o.stop(t + beat * 2); }
  }
  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_400_000 }); const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r)); rec.start(250);
  const start = performance.now(); let poster = null;
  await new Promise((resolve) => { const frame = () => { const t = (performance.now() - start) / 1000; draw(ctx, w, h, scene, pal, seed, t);
      if (!poster && t > 0.4) poster = c.toDataURL("image/webp", 0.8); if (t < secs) requestAnimationFrame(frame); else resolve(); }; frame(); });
  rec.stop(); await done; await ac.close();
  const blob = new Blob(chunks, { type: "video/webm" }); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
  return { video: btoa(s), poster: poster.split(",")[1], secs };
};`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><title>seed</title><body></body>");
await page.addScriptTag({ content: PAGE_LIB });
const manifest = { generated_at: new Date().toISOString(), images: {}, videos: {} };
const save = (dir, name, b64) => { fs.writeFileSync(path.join(out, dir, name), Buffer.from(b64, "base64")); return `${dir}/${name}`; };
const LETTERS = "NMALSTKJREDPSSTF";   // initials matching the seeded users (by avatar index)

for (let i = 0; i < jobs.avatars; i++) {
  const b64 = await page.evaluate(([i, pal, l]) => still(400, 400, (ctx) => avatar(ctx, 400, pal, i + 3, l)), [i, PALETTES[i % 8], LETTERS[i]]);
  manifest.images[`avatar_${i}`] = { file: save("images", `avatar_${i}.webp`, b64), w: 400, h: 400 };
}
for (let i = 0; i < jobs.covers; i++) {
  const b64 = await page.evaluate(([i, pal, sc]) => still(1500, 500, (ctx) => draw(ctx, 1500, 500, sc, pal, i + 11, i * 0.9)), [i, PALETTES[(i + 3) % 8], SCENES[(i * 3) % SCENES.length]]);
  manifest.images[`cover_${i}`] = { file: save("images", `cover_${i}.webp`, b64), w: 1500, h: 500 };
}
for (let i = 0; i < jobs.posts; i++) {
  const [w, h] = i % 3 === 0 ? [1080, 1080] : [1080, 1350];
  const b64 = await page.evaluate(([w, h, i, pal, sc]) => still(w, h, (ctx) => draw(ctx, w, h, sc, pal, i + 101, i * 0.37)), [w, h, i, PALETTES[i % 8], SCENES[i % SCENES.length]]);
  manifest.images[`post_${i}`] = { file: save("images", `post_${i}.webp`, b64), w, h, scene: SCENES[i % SCENES.length] };
}
for (let i = 0; i < jobs.stories; i++) {
  const b64 = await page.evaluate(([i, pal, sc]) => still(1080, 1920, (ctx) => draw(ctx, 1080, 1920, sc, pal, i + 301, i * 0.5)), [i, PALETTES[(i + 5) % 8], SCENES[(i + 4) % SCENES.length]]);
  manifest.images[`story_${i}`] = { file: save("images", `story_${i}.webp`, b64), w: 1080, h: 1920 };
}
for (let i = 0; i < jobs.thumbs; i++) {
  const b64 = await page.evaluate(([i, pal, sc]) => still(1280, 720, (ctx) => draw(ctx, 1280, 720, sc, pal, i + 501, i)), [i, PALETTES[(i + 2) % 8], SCENES[(i + 7) % SCENES.length]]);
  manifest.images[`thumb_${i}`] = { file: save("images", `thumb_${i}.webp`, b64), w: 1280, h: 720 };
}
const clips = [
  ...jobs.reels.map((r, i) => ({ ...r, key: `reel_${i}`, w: 540, h: 960 })),
  ...jobs.videos.map((r, i) => ({ ...r, key: `video_${i}` })),
  ...jobs.storyVideos.map((r, i) => ({ ...r, key: `storyvid_${i}` })),
];
for (const [i, c] of clips.entries()) {
  process.stdout.write(`recording ${c.key} (${c.secs}s)… `);
  const res = await page.evaluate(([c, pal, seed]) => clip(c.w, c.h, c.scene, pal, seed, c.secs, c.bpm), [c, PALETTES[(i + 1) % 8], i + 700]);
  manifest.videos[c.key] = { file: save("videos", `${c.key}.webm`, res.video), poster: save("images", `${c.key}_poster.webp`, res.poster), w: c.w, h: c.h, duration_ms: c.secs * 1000, bpm: c.bpm };
  console.log(`${(Buffer.from(res.video, "base64").length / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`Seed media written to ${path.relative(root, out)}`);
