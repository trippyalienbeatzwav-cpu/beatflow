// @ts-nocheck -- reference-signal generator shared by unit, API and ingest code; asserted by tests/unit/dsp.test.js
// Deterministic reference audio for DSP tests. Each generator returns stereo PCM plus ground truth.
// These are real signals with known spectral content (not waveform drawings): kick/sub energy below 250 Hz,
// formant-synthesised vowels and synth chords in 250 Hz–4 kHz, noise-based hats/cymbals above 4 kHz.
import fs from "node:fs";

export const SR = 44100;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const buf = (sec) => [new Float32Array(Math.ceil(sec * SR)), new Float32Array(Math.ceil(sec * SR))];
const add = (ch, i, l, r = l) => { if (i >= 0 && i < ch[0].length) { ch[0][i] += l; ch[1][i] += r; } };

export function kick(ch, t, v = 1) {
  const s = Math.round(t * SR), n = Math.round(0.34 * SR); let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / SR, f = 45 + 110 * Math.exp(-x * 38);
    ph += (2 * Math.PI * f) / SR;
    const e = Math.exp(-x * 9) * (x < 0.002 ? x / 0.002 : 1);
    add(ch, s + i, v * 0.9 * Math.sin(ph) * e);
  }
}
export function sub(ch, t, dur, f, v = 0.45) {
  const s = Math.round(t * SR), n = Math.round(dur * SR);
  for (let i = 0; i < n; i++) { const e = Math.min(1, i / 300) * Math.min(1, (n - i) / 600); add(ch, s + i, v * e * (Math.sin((2 * Math.PI * f * i) / SR) + 0.15 * Math.sin((4 * Math.PI * f * i) / SR))); }
}
/** One-pole-cascade high-pass on noise: energy above `hp` Hz. */
export function hat(ch, t, dur, v, r, { hp = 7000, pan = 0 } = {}) {
  const s = Math.round(t * SR), n = Math.round(dur * SR);
  const a = Math.exp((-2 * Math.PI * hp) / SR);
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    const y = a * (y1 + x - x1); x1 = x; y1 = y;           // 1st high-pass
    const z = a * (y2 + y - x2); x2 = y; y2 = z;           // 2nd high-pass (steeper)
    const e = Math.exp((-i / SR) / (dur / 5));
    add(ch, s + i, v * z * e * (1 - pan), v * z * e * (1 + pan));
  }
}
/** Band-limited sawtooth by additive synthesis up to `maxHz`. */
function sawSample(f, i, maxHz = 4000) { let s = 0; for (let h = 1; h * f < maxHz; h++) s += Math.sin((2 * Math.PI * f * h * i) / SR) / h; return s * 0.55; }
export function chord(ch, t, dur, freqs, v = 0.12, maxHz = 3600) {
  const s = Math.round(t * SR), n = Math.round(dur * SR);
  for (let i = 0; i < n; i++) {
    const e = Math.min(1, i / (0.02 * SR)) * Math.min(1, (n - i) / (0.05 * SR));
    let l = 0, r = 0;
    freqs.forEach((f, k) => { l += sawSample(f * 1.003, i, maxHz); r += sawSample(f * 0.997, i + k * 7, maxHz); });
    add(ch, s + i, v * e * l, v * e * r);
  }
}
/** Formant-synthesised sung vowel: glottal pulse train through three vocal-tract resonances. */
const VOWELS = { a: [[800, 80, 1], [1150, 90, 0.5], [2900, 120, 0.25]], o: [[450, 70, 1], [800, 80, 0.45], [2830, 100, 0.15]], e: [[400, 60, 1], [1600, 80, 0.55], [2700, 100, 0.35]] };
export function vocal(ch, t, dur, f0, vowel = "a", v = 0.5) {
  const s = Math.round(t * SR), n = Math.round(dur * SR);
  const fm = VOWELS[vowel].map(([fc, bw, g]) => { const r = Math.exp((-Math.PI * bw) / SR), th = (2 * Math.PI * fc) / SR; return { a1: -2 * r * Math.cos(th), a2: r * r, g: g * (1 - r), y1: 0, y2: 0 }; });
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const vib = 1 + 0.012 * Math.sin((2 * Math.PI * 5.5 * i) / SR);
    ph += (f0 * vib) / SR; if (ph >= 1) ph -= 1;
    const src = ph < 0.4 ? Math.sin((Math.PI * ph) / 0.4) ** 2 - 0.3 : -0.3;   // Rosenberg-style glottal pulse
    let out = 0;
    for (const f of fm) { const y = f.g * src - f.a1 * f.y1 - f.a2 * f.y2; f.y2 = f.y1; f.y1 = y; out += y; }
    const e = Math.min(1, i / (0.04 * SR)) * Math.min(1, (n - i) / (0.06 * SR));
    add(ch, s + i, v * 6 * out * e);
  }
}
export function crash(ch, t, v, r) { hat(ch, t, 1.4, v, r, { hp: 5000 }); }

export function writeWav(file, ch) {
  const n = ch[0].length, data = Buffer.alloc(44 + n * 4);
  data.write("RIFF", 0); data.writeUInt32LE(36 + n * 4, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 32767), 44 + i * 4 + c * 2);
  fs.writeFileSync(file, data);
}
function normalize(ch, peak = 0.89) { let m = 0; for (const c of ch) for (const x of c) m = Math.max(m, Math.abs(x)); if (m > 0) for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= peak / m; return ch; }

const beatT = (bpm, b, t0 = 0.1) => t0 + (b * 60) / bpm;

/** A — heavy kick + sub bass (four-to-the-floor, offbeat sub). */
export function trackA(sec = 12, bpm = 126) {
  const ch = buf(sec);
  for (let b = 0; beatT(bpm, b) < sec - 0.5; b++) { kick(ch, beatT(bpm, b)); sub(ch, beatT(bpm, b + 0.5), (30 / bpm) * 0.9, 55); }
  return { name: "A · Kick + bass", ch: normalize(ch), expect: "low", bpm, firstBeat: 0.1 };
}
/** B — vocal-heavy (sung vowels, no drums). */
export function trackB(sec = 12) {
  const ch = buf(sec); const notes = [[220, "a"], [247, "o"], [262, "e"], [196, "a"], [220, "o"], [294, "e"]];
  for (let i = 0; i * 2 < sec - 0.3; i++) { const [f, vw] = notes[i % notes.length]; vocal(ch, i * 2 + 0.05, 1.9, f, vw); }
  return { name: "B · Vocal", ch: normalize(ch), expect: "mid" };
}
/** C — synth-heavy (detuned saw chords + plucks, low-passed like a typical lead/pad). */
export function trackC(sec = 12) {
  const ch = buf(sec); const prog = [[330, 392, 494], [294, 370, 440], [262, 330, 392], [294, 349, 440]];
  for (let i = 0; i * 1.5 < sec - 0.2; i++) { chord(ch, i * 1.5, 1.45, prog[i % 4], 0.1); chord(ch, i * 1.5 + 0.75, 0.3, [prog[i % 4][2] * 2], 0.08, 4000); }
  return { name: "C · Synths", ch: normalize(ch), expect: "mid" };
}
/** D — hi-hats, open hats and a ride (noise above ~6 kHz). */
export function trackD(sec = 12, bpm = 128) {
  const ch = buf(sec); const r = rng(4);
  for (let s = 0; beatT(bpm, s / 4) < sec - 0.3; s++) {
    const t = beatT(bpm, s / 4);
    if (s % 4 === 2) hat(ch, t, 0.22, 0.5, r, { hp: 6500, pan: 0.2 }); else hat(ch, t, 0.05, 0.4, r, { hp: 8000, pan: -0.2 });
    if (s % 8 === 0) hat(ch, t, 0.9, 0.18, r, { hp: 5500 });
  }
  return { name: "D · Hats & cymbals", ch: normalize(ch), expect: "high", bpm };
}
/** E — full mix: kick, sub, synth stabs, vocal line and hats together. */
export function trackE(sec = 12, bpm = 124) {
  const ch = buf(sec); const r = rng(5);
  for (let b = 0; beatT(bpm, b) < sec - 0.5; b++) {
    const t = beatT(bpm, b);
    kick(ch, t, 0.8); sub(ch, beatT(bpm, b + 0.5), (30 / bpm) * 0.9, 49, 0.3);
    hat(ch, beatT(bpm, b + 0.5), 0.22, 0.9, r, { hp: 6500 }); hat(ch, beatT(bpm, b + 0.25), 0.06, 0.6, r, { hp: 8500 }); hat(ch, beatT(bpm, b + 0.75), 0.06, 0.6, r, { hp: 8500 });
    if (b % 4 === 0) crash(ch, t, 0.12, r);
    if (b % 2 === 1) chord(ch, t, 0.2, [392, 494, 587], 0.05, 9000);
  }
  for (let i = 0; i * 2 < sec - 0.3; i++) vocal(ch, i * 2 + 0.1, 1.8, [262, 294, 330, 294][i % 4], ["a", "e", "o", "a"][i % 4], 0.07);
  return { name: "E · Full mix", ch: normalize(ch), expect: "mixed", bpm };
}
/** F — breakdown: a quiet pad, then silence. */
export function trackF(sec = 12) {
  const ch = buf(sec);
  chord(ch, 0.2, sec * 0.6, [220, 277, 330], 0.03, 1800);
  return { name: "F · Breakdown", ch, expect: "quiet", silenceFrom: 0.2 + sec * 0.6 };
}
/**
 * G — arranged electronic track with ground truth structure (124 BPM, 4/4):
 * intro 16 · build 8 · drop 16 · breakdown 16 · build 8 · drop 16 · outro 16 bars.
 * Downbeats are marked by bass-note changes and crashes, like real productions.
 */
export function trackG(bpm = 124, t0 = 0.25) {
  const plan = [["intro", 16], ["build", 8], ["drop", 16], ["breakdown", 16], ["build", 8], ["drop", 16], ["outro", 16]];
  const barSec = (4 * 60) / bpm;
  const totalBars = plan.reduce((a, p) => a + p[1], 0);
  const ch = buf(t0 + totalBars * barSec + 1);
  const r = rng(7);
  const roots = [55, 49, 41.2, 43.65];
  let bar = 0;
  const sections = [];
  for (const [label, n] of plan) {
    sections.push({ label, startBar: bar, bars: n, start: t0 + bar * barSec });
    for (let i = 0; i < n; i++, bar++) {
      const bt = t0 + bar * barSec;
      const f = roots[bar % 4];
      if (i === 0 && label !== "intro") crash(ch, bt, 0.35, r);
      for (let b = 0; b < 4; b++) {
        const t = bt + (b * 60) / bpm;
        const kickOn = label !== "breakdown" && !(label === "build" && i >= n - 1 && b > 1);
        if (kickOn) kick(ch, t, label === "intro" || label === "outro" ? 0.75 : 1);
        if (label === "drop") sub(ch, t + 30 / bpm, (30 / bpm) * 0.9, f, 0.4);
        if (label !== "breakdown") { hat(ch, t + 30 / bpm, 0.06, label === "build" ? 0.25 + 0.3 * (i / n) : 0.4, r, { hp: 7500 }); }
        if (label === "drop") { hat(ch, t + 15 / bpm, 0.03, 0.22, r, { hp: 9000 }); hat(ch, t + 45 / bpm, 0.03, 0.22, r, { hp: 9000 }); if (b % 2 === 1) chord(ch, t, 0.22, [f * 8, f * 8 * (bar % 2 ? 1.25 : 1.2), f * 12], 0.05); }
        if (label === "build" && i >= n - 2) for (let s = 0; s < 4; s++) hat(ch, t + (s * 15) / bpm, 0.04, 0.25 + 0.4 * (i / n), r, { hp: 3500 });
      }
      if (label === "build") hat(ch, bt, barSec, 0.05 + 0.5 * (i / n) ** 2, r, { hp: 3000 });   // noise riser
      if (label === "breakdown") { chord(ch, bt, barSec, [f * 4, f * 4 * (bar % 2 ? 1.25 : 1.2), f * 6], 0.02, 2500); if (i % 2 === 0) vocal(ch, bt + 0.1, barSec * 1.8, f * 4, ["a", "o", "e"][i % 3], 0.015); }
    }
  }
  return { name: "G · Arranged track", ch: normalize(ch), bpm, firstBeat: t0, downbeatOffset: 0, sections, barSec };
}
/** Tempo-only clips for BPM detection across genres. */
export function tempoClip(bpm, style = "four", sec = 20) {
  const ch = buf(sec); const r = rng(Math.round(bpm));
  const beats = sec * bpm / 60;
  for (let b = 0; b < beats - 1; b++) {
    const t = beatT(bpm, b);
    if (style === "four") { kick(ch, t); hat(ch, beatT(bpm, b + 0.5), 0.05, 0.4, r); }
    if (style === "dnb") { if (b % 4 === 0) kick(ch, t); if (b % 4 === 2) kick(ch, beatT(bpm, b + 0.5)); if (b % 2 === 1) hat(ch, t, 0.12, 0.6, r, { hp: 1800 }); hat(ch, beatT(bpm, b + 0.5), 0.03, 0.3, r); hat(ch, t, 0.03, 0.3, r); }
    if (style === "halftime") { if (b % 4 === 0) kick(ch, t); if (b % 4 === 2) hat(ch, t, 0.14, 0.6, r, { hp: 1800 }); hat(ch, t, 0.03, 0.3, r); hat(ch, beatT(bpm, b + 0.5), 0.03, 0.25, r); }
  }
  return { ch: normalize(ch), bpm, firstBeat: 0.1 };
}
