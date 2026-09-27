// Audio-analysis verification: every assertion is about the actual signal, not the drawing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../../js/music/dsp.js";
import * as A from "../fixtures/audio.js";

const D = globalThis.TBDSP;
const SR = A.SR;
const tone = (hz, sec = 2, amp = 0.5, right = true) => {
  const n = Math.round(sec * SR), l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR); r[i] = right ? l[i] : 0; }
  return [l, r];
};
/** Share averages over audible columns plus the fraction of columns each band dominates. */
function profile(ch) {
  const c = D.columns(ch, SR);
  const tot = { low: 0, mid: 0, high: 0, midT: 0 }, dom = { low: 0, mid: 0, high: 0 };
  let n = 0;
  for (let i = 0; i < c.n; i++) {
    if (c.rms[i] < 0.005) continue;
    const s = D.bandShares(c.low[i], c.lowMid[i], c.highMid[i], c.high[i]);
    tot.low += s.low; tot.mid += s.mid; tot.high += s.high; tot.midT += s.midT; dom[D.dominant(s)]++; n++;
  }
  for (const k in tot) tot[k] /= n;
  for (const k in dom) dom[k] /= n;
  return { ...tot, dom, c };
}

test("FFT matches a direct DFT", () => {
  const N = 64, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.9) + (i % 7) / 10;
  const x = [...re];
  D.fft(re, im);
  for (let k = 0; k < N; k++) {
    let r = 0, m = 0;
    for (let t = 0; t < N; t++) { r += x[t] * Math.cos((2 * Math.PI * k * t) / N); m -= x[t] * Math.sin((2 * Math.PI * k * t) / N); }
    assert.ok(Math.abs(r - re[k]) < 1e-9 && Math.abs(m - im[k]) < 1e-9, `bin ${k}`);
  }
});

test("pure tones land in the right band and colour", () => {
  const cases = [[55, "low"], [120, "low"], [400, "mid"], [1000, "mid"], [2500, "mid"], [6000, "high"], [12000, "high"]];
  for (const [hz, band] of cases) {
    const p = profile(tone(hz));
    assert.ok(p[band] > 0.95, `${hz} Hz → ${band} share ${p[band].toFixed(3)}`);
  }
  // Within the mid band, body (≈250 Hz–1 kHz) reads green and presence (1–4 kHz) reads orange
  assert.ok(profile(tone(400)).midT < 0.2, "400 Hz is green");
  assert.ok(profile(tone(3000)).midT > 0.8, "3 kHz is orange");
  const [r, g, b] = D.columnColor(D.bandShares(1, 0, 0, 0));
  assert.ok(r > 200 && g < 80 && b < 80, "pure low energy renders red");
  const [r2, _g2, b2] = D.columnColor(D.bandShares(0, 0, 0, 1));
  assert.ok(b2 > 200 && r2 < 80, "pure high energy renders blue");
  const [r3, g3, b3] = D.columnColor(D.bandShares(0, 1, 0, 0));
  assert.ok(g3 > 180 && b3 < 120 && r3 < 120, "low-mid renders green");
  void g; void b;
});

test("amplitude: true peaks per channel, stereo differences preserved, no smoothing", () => {
  const p = D.columns(tone(440, 1, 0.5, false), SR);
  const mid = Math.floor(p.n / 2);
  assert.ok(Math.abs(p.maxL[mid] - 0.5) < 0.005 && Math.abs(p.minL[mid] + 0.5) < 0.005, "left ±0.5");
  assert.equal(p.maxR[mid], 0, "right channel silent stays silent");
  // A kick transient appears in the column that contains it, not smeared into earlier ones
  const ch = [new Float32Array(SR), new Float32Array(SR)];
  A.kick(ch, 0.5);
  const c = D.columns(ch, SR);
  const col = Math.floor((0.5 * SR) / c.hop);
  assert.ok(c.maxL[col + 1] > 0.3, "transient column is loud");
  assert.equal(c.maxL[col - 2], 0, "column before the transient is silent");
});

test("Track A (kick + bass) is predominantly RED", () => {
  const p = profile(A.trackA().ch);
  assert.ok(p.low > 0.85, `low share ${p.low}`);
  assert.ok(p.dom.low > 0.9, `red-dominant columns ${p.dom.low}`);
});
test("Track B (vocal) is GREEN/YELLOW/ORANGE", () => {
  const p = profile(A.trackB().ch);
  assert.ok(p.mid > 0.75, `mid share ${p.mid}`);
  assert.ok(p.dom.mid > 0.9);
});
test("Track C (synths) is GREEN/YELLOW/ORANGE", () => {
  const p = profile(A.trackC().ch);
  assert.ok(p.mid > 0.75, `mid share ${p.mid}`);
  assert.ok(p.dom.mid > 0.9);
});
test("Track D (hats & cymbals) is predominantly BLUE", () => {
  const p = profile(A.trackD().ch);
  assert.ok(p.high > 0.85, `high share ${p.high}`);
  assert.ok(p.dom.high > 0.9);
});
test("Track E (full mix) is a controlled combination of all three bands", () => {
  const p = profile(A.trackE().ch);
  for (const k of ["low", "mid", "high"]) assert.ok(p[k] > 0.1 && p[k] < 0.75, `${k} share ${p[k].toFixed(2)}`);
  for (const k of ["low", "mid", "high"]) assert.ok(p.dom[k] > 0.03, `${k} dominates some columns (${p.dom[k].toFixed(2)})`);
});
test("Track F (breakdown → silence) has low energy and true silence", () => {
  const f = A.trackF(), a = A.trackA();
  const cf = D.columns(f.ch, SR), ca = D.columns(a.ch, SR);
  const mean = (c) => c.rms.reduce((s, x) => s + x, 0) / c.n;
  assert.ok(mean(cf) < mean(ca) / 8, "breakdown is much quieter than the kick section");
  const s = Math.ceil((f.silenceFrom * SR) / cf.hop) + 20;
  for (let i = s; i < cf.n; i++) assert.equal(cf.maxL[i], 0);
});

test("BPM and beat phase across electronic tempi", () => {
  for (const [bpm, style, range] of [[124, "four"], [128, "four"], [132, "four"], [140, "four"], [90, "halftime"], [174, "dnb", [160, 190]]]) {
    const t = A.tempoClip(bpm, style);
    const a = D.analyze(t.ch, SR, { withKey: false, bpmRange: range });
    assert.ok(Math.abs(a.bpm - bpm) <= 0.05, `${bpm} → ${a.bpm}`);
    const period = 60 / bpm;
    const err = Math.abs(((a.beats[0] - t.firstBeat) % period + period * 1.5) % period - period / 2);
    assert.ok(err < 0.01, `${bpm} BPM phase error ${(err * 1000).toFixed(1)} ms`);
    assert.ok(a.beatConfidence > 0.45, `${bpm} confidence ${a.beatConfidence}`);
  }
});
test("beat confidence is low for beatless material", () => {
  for (const tr of [A.trackB(), A.trackC(), A.trackF()]) {
    const a = D.analyze(tr.ch, SR, { withKey: false });
    assert.ok(a.beatConfidence < 0.35, `${tr.name} confidence ${a.beatConfidence}`);
  }
});

test("arranged track: tempo, grid drift, downbeats, structure and key", () => {
  const g = A.trackG();
  const a = D.analyze(g.ch, SR);
  assert.ok(Math.abs(a.bpm - g.bpm) < 0.02, `bpm ${a.bpm}`);
  // Grid must not drift: the last beat of the track still lands within 10 ms of the truth
  const last = a.beats.at(-10);
  const period = 60 / g.bpm;
  const k = Math.round((last - g.firstBeat) / period);
  assert.ok(Math.abs(last - (g.firstBeat + k * period)) < 0.01, "no drift over 96 bars");
  assert.ok(Math.abs(a.downbeats[0] - g.firstBeat) < 0.01, "first downbeat on bar 1");
  assert.deepEqual(a.sections.filter((s) => s.label !== "silence").map((s) => [s.label, s.startBar, s.bars]), g.sections.map((s) => [s.label, s.startBar, s.bars]));
  assert.ok(a.sections.find((s) => s.label === "breakdown").vocal, "breakdown flagged as vocal/melodic");
  // A minor progression (Am · G · Em · F): A minor or its relative C major (same Camelot number, both mix harmonically)
  assert.ok(["A min", "C maj"].includes(a.key.name), a.key.name);
  assert.ok(a.key.camelot.startsWith("8"), a.key.camelot);
  assert.ok(a.cues.some((c) => c.label === "Drop" && Math.abs(c.time - g.sections[2].start) < 0.02));
  assert.equal(a.loop.bars, 8);
});

test("compact binary form round-trips within quantisation limits", () => {
  const c = D.columns(A.trackE(6).ch, SR, { hop: 1024 });
  const { level } = D.decodeLevel(D.encodeLevel(c, { id: "t" }));
  assert.equal(level.n, c.n);
  for (let i = 0; i < c.n; i += 7) {
    assert.ok(Math.abs(level.maxL[i] - c.maxL[i]) <= 1 / 255 + 1e-6);
    assert.ok(Math.abs(level.minR[i] - c.minR[i]) <= 1 / 255 + 1e-6);
    const s1 = D.bandShares(c.low[i], c.lowMid[i], c.highMid[i], c.high[i]), s2 = D.bandShares(level.low[i], level.lowMid[i], level.highMid[i], level.high[i]);
    if (c.rms[i] > 0.01) assert.equal(D.dominant(s1), D.dominant(s2), `colour family preserved at ${i}`);
  }
});

test("deterministic and free of randomness; a 6-minute track analyses quickly", () => {
  const src = fs.readFileSync(new URL("../../js/music/dsp.js", import.meta.url), "utf8");
  assert.ok(!/Math\.random/.test(src), "no Math.random in the analyser");
  const g = A.trackG();
  const a1 = D.analyze(g.ch, SR, { withKey: false }), a2 = D.analyze(g.ch, SR, { withKey: false });
  assert.equal(a1.bpm, a2.bpm);
  assert.deepEqual(Array.from(a1.levels[1].low.slice(0, 200)), Array.from(a2.levels[1].low.slice(0, 200)));
  // Two concatenated arranged tracks ≈ 6.3 minutes
  const long = [0, 1].map((k) => { const x = new Float32Array(g.ch[k].length * 2); x.set(g.ch[k]); x.set(g.ch[k], g.ch[k].length); return x; });
  const t0 = performance.now();
  const a = D.analyze(long, SR);
  const ms = performance.now() - t0;
  assert.ok(ms < 20000, `6-min analysis took ${ms.toFixed(0)} ms`);
  assert.ok(a.levels.length >= 3, "mip levels for zoomed-out views");
  assert.ok(a.levels.at(-1).n <= 1024, "coarsest level is small");
});
