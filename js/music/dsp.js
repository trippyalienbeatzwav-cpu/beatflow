// @ts-nocheck -- browser/worker/Node shared code without type annotations; covered by its own unit tests
/* ==========================================================================
   TUNIBEAT DSP — audio analysis for the Electronic Music Store deck.
   Pure functions over PCM (Float32Array per channel). Runs in a Web Worker, on the
   main thread, or in Node (tests and the catalog renderer). No DOM, no randomness.

   analyze(channels, sampleRate) →
     columns   per-hop waveform data (true peaks per channel, RMS, 4-band energies,
               spectral flux) plus mip levels for zoomed-out views
     beats     BPM, beat grid, downbeats, bars (from onset-strength autocorrelation)
     key       Krumhansl-Schmuckler key estimate from chroma
     sections  intro / build / drop / breakdown / outro / silence, per bar
   Colour mapping (bandColor / columnColor) is derived only from band energies:
     LOW 20–250 Hz → red · MID 250 Hz–4 kHz → green→yellow→orange · HIGH 4–20 kHz → blue
   ========================================================================== */
(function (root) {
  "use strict";
  const BANDS = { low: [20, 250], lowMid: [250, 1000], highMid: [1000, 4000], high: [4000, 20000] };
  const FFT_SIZE = 2048;

  /* ---------- FFT (iterative radix-2, in place) ---------- */
  const fftCache = new Map();
  function fftTables(n) {
    let t = fftCache.get(n);
    if (t) return t;
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
    const win = new Float64Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));   // Hann
    t = { rev, cos, sin, win };
    fftCache.set(n, t);
    return t;
  }
  /** In-place complex FFT of (re, im), length a power of two. */
  function fft(re, im) {
    const n = re.length;
    if (n & (n - 1)) throw new Error("FFT size must be a power of two");
    const { rev, cos, sin } = fftTables(n);
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = sin[k * step];
          const a = s + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  /** Power spectrum (|X|², bins 0..n/2) of a Hann-windowed frame centred at `center`. */
  function powerSpectrum(mono, center, n, out, re, im) {
    const { win } = fftTables(n);
    const start = center - (n >> 1);
    for (let i = 0; i < n; i++) { const j = start + i; re[i] = j >= 0 && j < mono.length ? mono[j] * win[i] : 0; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= n >> 1; k++) out[k] = re[k] * re[k] + im[k] * im[k];
    return out;
  }
  function bandBins(sr, n) {
    const hz = sr / n, nyq = sr / 2;
    const r = {};
    for (const [k, [lo, hi]] of Object.entries(BANDS)) r[k] = [Math.max(1, Math.round(lo / hz)), Math.min(n >> 1, Math.round(Math.min(hi, nyq) / hz))];
    return r;
  }

  /* ---------- Waveform columns ---------- */
  /**
   * One column per `hop` samples: true sample peaks per channel, RMS, band energies from an
   * STFT frame centred on the column, and spectral flux (onset strength).
   */
  function columns(channels, sr, { hop = 256, fftSize = FFT_SIZE, from = 0, to = channels[0].length } = {}) {
    const L = channels[0], R = channels[1] ?? channels[0];
    const len = to - from;
    const n = Math.max(1, Math.ceil(len / hop));
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) mono[i] = 0.5 * (L[from + i] + R[from + i]);
    const c = {
      hop, sr, n, from,
      maxL: new Float32Array(n), minL: new Float32Array(n), maxR: new Float32Array(n), minR: new Float32Array(n),
      rms: new Float32Array(n), low: new Float32Array(n), lowMid: new Float32Array(n), highMid: new Float32Array(n), high: new Float32Array(n),
      flux: new Float32Array(n), lowFlux: new Float32Array(n), rise: new Float32Array(n),
    };
    const bins = bandBins(sr, fftSize);
    const spec = new Float64Array((fftSize >> 1) + 1), prev = new Float64Array((fftSize >> 1) + 1);
    const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    const norm = 4 / (fftSize * fftSize);   // Hann-windowed power → mean-square scale
    for (let col = 0; col < n; col++) {
      const a = col * hop, b = Math.min(len, a + hop);
      let mxl = -1, mnl = 1, mxr = -1, mnr = 1, sq = 0;
      for (let i = a; i < b; i++) {
        const l = L[from + i], r = R[from + i];
        if (l > mxl) mxl = l; if (l < mnl) mnl = l; if (r > mxr) mxr = r; if (r < mnr) mnr = r;
        sq += mono[i] * mono[i];
      }
      c.maxL[col] = Math.max(0, mxl); c.minL[col] = Math.min(0, mnl); c.maxR[col] = Math.max(0, mxr); c.minR[col] = Math.min(0, mnr);
      c.rms[col] = Math.sqrt(sq / Math.max(1, b - a));
      c.rise[col] = col ? Math.max(0, c.rms[col] - c.rms[col - 1]) : 0;
      powerSpectrum(mono, a + (hop >> 1), fftSize, spec, re, im);
      for (const k of ["low", "lowMid", "highMid", "high"]) {
        const [lo, hi] = bins[k]; let e = 0;
        for (let j = lo; j < hi; j++) e += spec[j];
        c[k][col] = e * norm;
      }
      // Spectral flux on log-compressed magnitudes: positive changes only
      let f = 0, lf = 0;
      for (let j = 1; j < spec.length; j++) {
        const m = Math.log1p(1000 * Math.sqrt(spec[j] * norm)), d = m - prev[j];
        if (d > 0) { f += d; if (j < bins.low[1]) lf += d; }
        prev[j] = m;
      }
      c.flux[col] = f / (spec.length - 1); c.lowFlux[col] = lf / Math.max(1, bins.low[1] - 1);
    }
    return c;
  }

  /** Aggregate columns by `factor` (a coarser level for zoomed-out drawing). Peaks stay true peaks. */
  function downsample(c, factor) {
    const n = Math.ceil(c.n / factor);
    const o = { hop: c.hop * factor, sr: c.sr, n, from: c.from };
    for (const k of ["maxL", "maxR", "flux", "lowFlux"]) o[k] = new Float32Array(n);
    for (const k of ["minL", "minR"]) o[k] = new Float32Array(n);
    for (const k of ["rms", "low", "lowMid", "highMid", "high"]) o[k] = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = i * factor, b = Math.min(c.n, a + factor), m = b - a;
      let mxl = 0, mnl = 0, mxr = 0, mnr = 0, rs = 0, lo = 0, lm = 0, hm = 0, hi = 0, f = 0, lf = 0;
      for (let j = a; j < b; j++) {
        if (c.maxL[j] > mxl) mxl = c.maxL[j]; if (c.minL[j] < mnl) mnl = c.minL[j];
        if (c.maxR[j] > mxr) mxr = c.maxR[j]; if (c.minR[j] < mnr) mnr = c.minR[j];
        rs += c.rms[j] * c.rms[j]; lo += c.low[j]; lm += c.lowMid[j]; hm += c.highMid[j]; hi += c.high[j];
        if (c.flux[j] > f) f = c.flux[j]; if (c.lowFlux[j] > lf) lf = c.lowFlux[j];
      }
      o.maxL[i] = mxl; o.minL[i] = mnl; o.maxR[i] = mxr; o.minR[i] = mnr; o.rms[i] = Math.sqrt(rs / m);
      o.low[i] = lo / m; o.lowMid[i] = lm / m; o.highMid[i] = hm / m; o.high[i] = hi / m; o.flux[i] = f; o.lowFlux[i] = lf;
    }
    return o;
  }
  /** Mip chain: each level 4× coarser, until fewer than `min` columns remain. */
  function mipChain(c, min = 256) {
    const levels = [c];
    while (levels.at(-1).n > min * 4) levels.push(downsample(levels.at(-1), 4));
    return levels;
  }

  /* ---------- Frequency → colour ---------- */
  // Weights equalise the natural spectral tilt of music (≈ equal energy per octave is "balanced"):
  // a band's share is its energy per octave, then sharpened so the dominant band clearly dominates.
  const OCT = { low: Math.log2(250 / 20), mid: Math.log2(4000 / 250), high: Math.log2(20000 / 4000) };
  // Relative to the long-term spectrum of electronic mixes (≈ low 0 dB, mid −8 dB, high −18 dB per octave)
  const TILT = { low: 1, mid: 6.3, high: 63 };
  const SHARP = 0.75;
  /** Relative band shares (sum 1) for a column: { low, mid, high, midT } where midT ∈ [0,1] is the green→orange position. */
  function bandShares(low, lowMid, highMid, high) {
    const mid = lowMid + highMid;
    const wl = Math.pow((low / OCT.low) * TILT.low + 1e-12, SHARP);
    const wm = Math.pow((mid / OCT.mid) * TILT.mid + 1e-12, SHARP);
    const wh = Math.pow((high / OCT.high) * TILT.high + 1e-12, SHARP);
    const s = wl + wm + wh;
    // Mid colour: where the mid energy sits (250 Hz–1 kHz body vs 1–4 kHz presence) moves green → yellow → orange
    const presence = mid > 0 ? highMid / mid : 0;
    const midT = Math.max(0, Math.min(1, presence * 1.6));
    return { low: wl / s, mid: wm / s, high: wh / s, midT };
  }
  const RED = [255, 38, 38], GREEN = [48, 214, 92], YELLOW = [250, 222, 44], ORANGE = [255, 138, 22], BLUE = [48, 130, 255];
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  /** Mid-band colour for a position t: 0 green · 0.5 yellow · 1 orange. */
  function midColor(t) { return t < 0.5 ? mixRgb(GREEN, YELLOW, t * 2) : mixRgb(YELLOW, ORANGE, (t - 0.5) * 2); }
  /** Single blended colour for a column (linear-light mix of the three band colours by share). */
  function columnColor(sh) {
    const toLin = (v) => Math.pow(v / 255, 2.2), toS = (v) => Math.round(255 * Math.pow(Math.max(0, v), 1 / 2.2));
    const m = midColor(sh.midT);
    const out = [0, 1, 2].map((i) => toS(toLin(RED[i]) * sh.low + toLin(m[i]) * sh.mid + toLin(BLUE[i]) * sh.high));
    return out;
  }
  /** Which band family a colour share set represents most. */
  const dominant = (sh) => (sh.low >= sh.mid && sh.low >= sh.high ? "low" : sh.mid >= sh.high ? "mid" : "high");

  /* ---------- Onset envelope & beat tracking ---------- */
  function onsetEnvelope(c) {
    const n = c.n, o = new Float32Array(n);
    // Kicks carry the grid in electronic music: weight low-band flux most, then broadband flux and energy rises
    let ml = 1e-12, mf = 1e-12, mr = 1e-12;
    for (let i = 0; i < n; i++) { if (c.lowFlux[i] > ml) ml = c.lowFlux[i]; if (c.flux[i] > mf) mf = c.flux[i]; if (c.rise[i] > mr) mr = c.rise[i]; }
    for (let i = 0; i < n; i++) o[i] = 0.6 * (c.lowFlux[i] / ml) + 0.25 * (c.flux[i] / mf) + 0.15 * (c.rise[i] / mr);
    // Remove the local mean (≈0.4 s) so only transients remain
    const fr = c.sr / c.hop, w = Math.max(2, Math.round(fr * 0.2));
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + o[i];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - w), b = Math.min(n, i + w + 1); out[i] = Math.max(0, o[i] - (pre[b] - pre[a]) / (b - a)); }
    let m2 = 0; for (let i = 0; i < n; i++) if (out[i] > m2) m2 = out[i];
    if (m2 > 0) for (let i = 0; i < n; i++) out[i] /= m2;
    return out;
  }
  const interp = (a, x) => { const i = Math.floor(x); if (i < 0 || i + 1 >= a.length) return 0; const f = x - i; return a[i] * (1 - f) + a[i + 1] * f; };

  /** Comb score of a (period, phase) grid over an envelope. */
  function combScore(o, period, phase) {
    let s = 0, k = 0;
    for (let x = phase; x < o.length - 1; x += period) { s += interp(o, x); k++; }
    return k ? s / k : 0;
  }
  function phaseScan(o, period, steps) {
    let best = 0, bs = -1, sum = 0;
    for (let i = 0; i < steps; i++) { const ph = (i / steps) * period; const s = combScore(o, period, ph); sum += s; if (s > bs) { bs = s; best = ph; } }
    return { phase: best, score: bs, mean: sum / steps };
  }
  const tempoPrior = (b) => Math.exp(-0.5 * Math.pow(Math.log2(b / 126) / 0.55, 2));

  /**
   * Tempo and beat grid. Autocorrelation of the onset envelope ranks candidate tempi; a log-normal
   * prior around club tempi (or a genre `range`, e.g. [160, 185] for drum & bass) resolves octave
   * ambiguity; a comb search refines the BPM to 0.005 and the phase; the phase is then snapped to
   * sample-accurate energy rises so beat markers sit on the transient.
   */
  function detectBeats(c, { range = [70, 180], onset } = {}) {
    const [minBpm, maxBpm] = range;
    const o = onset ?? onsetEnvelope(c);
    const fr = c.sr / c.hop, n = o.length;
    if (n < fr * 4) return null;
    let riseMax = 0; for (let i = 0; i < n; i++) if (c.rise[i] > riseMax) riseMax = c.rise[i];
    const acf = (lag) => { let s = 0; const L = Math.floor(lag), f = lag - L; for (let i = 0; i + L + 1 < n; i++) s += o[i] * (o[i + L] * (1 - f) + o[i + L + 1] * f); return s / (n - lag); };
    const cands = [];
    for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
      const lag = (60 * fr) / bpm;
      const s = acf(lag) + 0.5 * acf(lag * 2) + 0.25 * acf(lag * 4);
      cands.push({ bpm, s: s * (0.35 + 0.65 * tempoPrior(bpm)) });
    }
    cands.sort((a, b) => b.s - a.s);
    let best = { bpm: cands[0].bpm, score: -1 };
    for (const base of [cands[0].bpm, cands[0].bpm * 2, cands[0].bpm / 2].filter((b) => b >= minBpm && b <= maxBpm)) {
      for (let d = -1.5; d <= 1.5001; d += 0.05) {
        const b = base + d, period = (60 * fr) / b;
        const r = phaseScan(o, period, 24);
        const sc = r.score * (0.5 + 0.5 * tempoPrior(b));
        if (sc > best.score) best = { bpm: b, score: sc, raw: r.score };
      }
    }
    for (let d = -0.06; d <= 0.06001; d += 0.005) {
      const b = best.bpm + d, r = phaseScan(o, (60 * fr) / b, 24);
      if (r.score > best.raw) best = { ...best, bpm: b, raw: r.score };
    }
    const period0 = (60 * fr) / best.bpm;
    const ph = phaseScan(o, period0, Math.max(32, Math.ceil(period0 * 4)));
    // Regression refinement: locate the actual transient near each grid beat (sample-level energy rise),
    // then least-squares fit t_k = phase + k·period. This removes the small tempo error of the search
    // grid, which would otherwise drift by beats over a full track.
    const peaks = [];
    const w = Math.max(2, Math.round(period0 / 5));
    let k = 0;
    for (let x = ph.phase; x < n - 1; x += period0, k++) {
      const a = Math.max(0, Math.round(x - w)), b = Math.min(n - 1, Math.round(x + w));
      let bi = -1, bv = 0;
      for (let i = a; i <= b; i++) { const v = o[i] * 0.5 + (c.rise[i] / (riseMax + 1e-12)) * 0.5; if (v > bv) { bv = v; bi = i; } }
      if (bi >= 0 && o[bi] > 0.2) peaks.push([k, bi]);
    }
    let period = period0, phase = ph.phase;
    if (peaks.length >= 8) {
      const m = peaks.length, sx = peaks.reduce((s, p) => s + p[0], 0), sy = peaks.reduce((s, p) => s + p[1], 0);
      const sxx = peaks.reduce((s, p) => s + p[0] * p[0], 0), sxy = peaks.reduce((s, p) => s + p[0] * p[1], 0);
      const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx), icpt = (sy - slope * sx) / m;
      if (Math.abs(slope / period0 - 1) < 0.01) { period = slope; phase = icpt; }
    }
    phase = ((phase % period) + period) % period;
    // Confidence = contrast of the best phase × share of beats that land on a real transient
    const contrast = Math.max(0, Math.min(1, (ph.score - ph.mean) / (ph.score + 1e-9)));
    const coverage = Math.min(1, peaks.length / Math.max(1, k));
    const confidence = contrast * coverage;
    const bpm = (60 * fr) / period;
    const beats = [];
    for (let x = phase; x < n; x += period) beats.push((x * c.hop) / c.sr + c.from / c.sr);
    return { bpm: Math.round(bpm * 100) / 100, bpmExact: bpm, beats, period: 60 / bpm, confidence, coverage, onset: o };
  }

  /** Downbeat phase: bars change on the "one" — pick the beat offset (0–3) with the most spectral novelty. */
  function detectDownbeats(c, grid) {
    const fr = c.sr / c.hop;
    const feat = grid.beats.map((t) => {
      const a = Math.max(0, Math.round((t - c.from / c.sr) * fr)), b = Math.min(c.n, Math.round(a + grid.period * fr));
      const v = [0, 0, 0, 0, 0];
      for (let i = a; i < b; i++) { v[0] += c.low[i]; v[1] += c.lowMid[i]; v[2] += c.highMid[i]; v[3] += c.high[i]; v[4] += c.flux[i]; }
      return v.map((x) => Math.log10(1e-9 + x / Math.max(1, b - a)));
    });
    const score = [0, 0, 0, 0];
    for (let i = 1; i < feat.length; i++) {
      let d = 0; for (let k = 0; k < 5; k++) d += Math.abs(feat[i][k] - feat[i - 1][k]);
      score[i % 4] += d;
    }
    const offset = score.indexOf(Math.max(...score));
    const downbeats = grid.beats.filter((_, i) => i % 4 === offset);
    return { offset, downbeats, score };
  }

  /* ---------- Key (chroma + Krumhansl-Schmuckler) ---------- */
  const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const CAMELOT_MIN = { 8: "1A", 3: "2A", 10: "3A", 5: "4A", 0: "5A", 7: "6A", 2: "7A", 9: "8A", 4: "9A", 11: "10A", 6: "11A", 1: "12A" };
  const CAMELOT_MAJ = { 11: "1B", 6: "2B", 1: "3B", 8: "4B", 3: "5B", 10: "6B", 5: "7B", 0: "8B", 7: "9B", 2: "10B", 9: "11B", 4: "12B" };
  // Benchmarked on 16 rendered catalog tracks + fixture G: HPSS + plain chroma (100 Hz–2 kHz) was the most accurate variant.
  // Chroma-profile key detection is an estimate; the store shows the label-supplied key as authoritative.
  function detectKey(channels, sr, { fftSize = 8192, hopSec = 0.25, method = "plain", loHz = 100, hiHz = 2000, hpss = true, minMidi = 40, maxMidi = 84 } = {}) {
    const L = channels[0], R = channels[1] ?? L, len = L.length;
    const mono = new Float32Array(len); for (let i = 0; i < len; i++) mono[i] = 0.5 * (L[i] + R[i]);
    const spec = new Float64Array(fftSize / 2 + 1), re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    const hz = sr / fftSize, hop = Math.round(hopSec * sr);
    const lo = Math.ceil(loHz / hz), hi = Math.floor(hiHz / hz), nb = hi - lo + 1;
    const frames = [];
    for (let c = fftSize / 2; c < len - fftSize / 2; c += hop) {
      powerSpectrum(mono, c, fftSize, spec, re, im);
      const f = new Float32Array(nb); for (let k = 0; k < nb; k++) f[k] = Math.sqrt(spec[lo + k]);
      frames.push(f);
    }
    const H = 4, win = new Float32Array(2 * H + 1), chroma = new Float64Array(12);
    for (let t = 0; t < frames.length; t++) {
      let hmag = frames[t];
      if (hpss) {
        hmag = new Float32Array(nb);
        for (let k = 0; k < nb; k++) { let m = 0; for (let j = -H; j <= H; j++) win[m++] = frames[Math.min(frames.length - 1, Math.max(0, t + j))][k]; win.sort(); hmag[k] = win[H]; }
      }
      let tot = 0; for (let k = 0; k < nb; k++) tot += hmag[k];
      if (tot < 1e-9) continue;
      if (method === "salience") {
        const at = (f) => { const x = f / hz - lo, i = Math.round(x); if (i < 1 || i >= nb - 1) return 0; return Math.max(hmag[i - 1], hmag[i], hmag[i + 1]); };
        const sal = new Float64Array(12);
        for (let m = minMidi; m <= maxMidi; m++) { const f = 440 * Math.pow(2, (m - 69) / 12); let s = 0; for (let h = 1; h <= 6; h++) s += Math.pow(0.8, h - 1) * at(f * h); sal[m % 12] += s * s; }
        let st = 0; for (let i = 0; i < 12; i++) st += sal[i];
        if (st > 0) for (let i = 0; i < 12; i++) chroma[i] += sal[i] / st;
      } else {
        for (let k = 1; k < nb - 1; k++) {
          if (method === "peaks" && (hmag[k] < hmag[k - 1] || hmag[k] < hmag[k + 1])) continue;
          const midi = 69 + 12 * Math.log2(((lo + k) * hz) / 440);
          chroma[((Math.round(midi) % 12) + 12) % 12] += hmag[k] / tot;
        }
      }
    }
    const corr = (prof, shift) => {
      const x = [...Array(12)].map((_, i) => chroma[(i + shift) % 12]);
      const mx = x.reduce((a, b) => a + b) / 12, mp = prof.reduce((a, b) => a + b) / 12;
      let num = 0, dx = 0, dp = 0;
      for (let i = 0; i < 12; i++) { num += (x[i] - mx) * (prof[i] - mp); dx += (x[i] - mx) ** 2; dp += (prof[i] - mp) ** 2; }
      return num / Math.sqrt(dx * dp + 1e-12);
    };
    const all = [];
    for (let t = 0; t < 12; t++) { all.push({ tonic: t, minor: false, r: corr(KS_MAJ, t) }); all.push({ tonic: t, minor: true, r: corr(KS_MIN, t) }); }
    all.sort((a, b) => b.r - a.r);
    const k = all[0];
    return { tonic: k.tonic, minor: k.minor, name: `${NAMES[k.tonic]} ${k.minor ? "min" : "maj"}`, camelot: (k.minor ? CAMELOT_MIN : CAMELOT_MAJ)[k.tonic], confidence: Math.max(0, k.r - all[1].r), chroma: [...chroma] };
  }

  /* ---------- Structure ---------- */
  const db = (x) => 20 * Math.log10(x + 1e-9);
  /**
   * Structure from 4-bar blocks: each block is silence, no-kick (breakdown material), full (the loudest,
   * bass-heavy material = drop / high energy) or light (kick groove below full level). Runs of equal blocks
   * become sections; a light run whose highs rise into a drop is a build-up. Labels: intro, build, drop,
   * breakdown, bass (kick + bass groove mid-track), outro, silence; `vocal` marks mid-dominant sections.
   */
  function detectSections(c, grid, down) {
    const fr = c.sr / c.hop, t0 = c.from / c.sr;
    const bars = down.downbeats.map((t, i) => ({ start: t, end: down.downbeats[i + 1] ?? t + grid.period * 4 }));
    if (!bars.length) return { bars: [], sections: [] };
    const feats = bars.map((b) => {
      const a = Math.max(0, Math.round((b.start - t0) * fr)), e = Math.min(c.n, Math.round((b.end - t0) * fr));
      let rs = 0, lo = 0, lm = 0, hm = 0, hi = 0, m = 0;
      for (let i = a; i < e; i++) { rs += c.rms[i] ** 2; lo += c.low[i]; lm += c.lowMid[i]; hm += c.highMid[i]; hi += c.high[i]; m++; }
      m = Math.max(1, m);
      // Kick presence: low-band onsets on the beats versus half a beat later
      const pb = grid.period * fr, peakNear = (x) => { let v = 0; for (let i = Math.round(x) - 2; i <= Math.round(x) + 2; i++) if (i >= 0 && i < c.n && c.lowFlux[i] > v) v = c.lowFlux[i]; return v; };
      let on = 0, off = 0;
      for (let k = 0; k < 4; k++) { const x = (b.start - t0) * fr + k * pb; on += peakNear(x); off += (peakNear(x + pb / 4) + peakNear(x + pb / 2) + peakNear(x + (3 * pb) / 4)) / 3; }
      const sh = bandShares(lo / m, lm / m, hm / m, hi / m);
      return { rmsDb: db(Math.sqrt(rs / m)), low: sh.low, mid: sh.mid, high: sh.high, kick: Math.max(0, on - off) / 4, hiE: hi / m, loE: lo / m };
    });
    const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
    const loud = q(feats.map((f) => f.rmsDb), 0.9);
    const loRef = q(feats.map((f) => f.loE), 0.9) || 1e-12;
    // High-band reference = median of the loud, bass-full bars (risers and crashes would inflate a percentile)
    const cand = feats.filter((f) => f.rmsDb - loud > -2.5 && f.loE > loRef * 0.5).map((f) => f.hiE);
    const hiRef = (cand.length ? q(cand, 0.5) : q(feats.map((f) => f.hiE), 0.5)) || 1e-12;
    const B = 4;
    const blocks = [];
    for (let i = 0; i < feats.length; i += B) {
      const fs = feats.slice(i, i + B), avg = (k) => fs.reduce((s, f) => s + f[k], 0) / fs.length;
      const rmsDb = db(Math.sqrt(fs.reduce((s, f) => s + Math.pow(10, f.rmsDb / 10), 0) / fs.length));
      const rel = rmsDb - loud, loRel = 10 * Math.log10(avg("loE") / loRef + 1e-12), hiRel = 10 * Math.log10(avg("hiE") / hiRef + 1e-12);
      // Drops have everything near its peak (level, lows, highs); breakdowns lose the low end (kick and bass)
      const kind = rmsDb < -50 ? "silence" : loRel < -12 ? "nokick" : rel > -2.5 && loRel > -3 && hiRel > -4 ? "full" : "light";
      blocks.push({ startBar: i, endBar: Math.min(feats.length, i + B), kind, hiE: avg("hiE"), mid: avg("mid"), low: avg("low"), rel });
    }
    // Runs of equal kinds
    const runs = [];
    for (const b of blocks) { const r = runs.at(-1); if (r && r.kind === b.kind) { r.endBar = b.endBar; r.blocks.push(b); } else runs.push({ kind: b.kind, startBar: b.startBar, endBar: b.endBar, blocks: [b] }); }
    // Split the rising tail of a light run that leads into a full run into its own build run
    for (let i = 0; i < runs.length - 1; i++) {
      const r = runs[i];
      if (r.kind !== "light" || runs[i + 1].kind !== "full") continue;
      let j = r.blocks.length - 1;
      while (j > 0 && r.blocks[j].hiE > r.blocks[j - 1].hiE * 1.15) j--;
      // blocks[j] is the last block before the rise; the build starts on the first rising block
      const start = j === 0 && r.blocks.length <= 2 ? 0 : j + 1;
      if (start >= r.blocks.length || r.blocks.at(-1).hiE < r.blocks[0].hiE * 1.5) continue;
      if (start === 0) { r.kind = "build"; continue; }
      const build = { kind: "build", startBar: r.blocks[start].startBar, endBar: r.endBar, blocks: r.blocks.slice(start) };
      r.endBar = build.startBar; r.blocks = r.blocks.slice(0, start);
      runs.splice(i + 1, 0, build); i++;
    }
    // A build can be as loud as the drop (risers, snare rolls): split a full run whose highs rise block by
    // block and then fall at the next block (the drop) into build + drop
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (r.kind !== "full" || r.blocks.length < 3) continue;
      let k = 1;
      while (k < r.blocks.length && r.blocks[k].hiE > r.blocks[k - 1].hiE * 1.12) k++;
      if (k < 2 || k >= r.blocks.length || r.blocks[k].hiE > r.blocks[k - 1].hiE * 0.75) continue;
      const build = { kind: "build", startBar: r.startBar, endBar: r.blocks[k].startBar, blocks: r.blocks.slice(0, k) };
      r.startBar = build.endBar; r.blocks = r.blocks.slice(k);
      runs.splice(i, 0, build); i++;
    }
    const firstFull = runs.findIndex((r) => r.kind === "full");
    const lastFull = runs.map((r) => r.kind).lastIndexOf("full");
    const sections = runs.map((r, i) => {
      let label;
      if (r.kind === "silence") label = "silence";
      else if (r.kind === "full") label = "drop";
      else if (r.kind === "build") label = "build";
      else if (firstFull === -1) label = i === 0 ? "intro" : r.kind === "nokick" ? "breakdown" : "bass";
      else if (i < firstFull) label = "intro";
      else if (i > lastFull) label = "outro";
      else label = r.kind === "nokick" ? "breakdown" : "bass";
      const mid = r.blocks.reduce((s, b) => s + b.mid, 0) / r.blocks.length;
      return { label, start: bars[r.startBar].start, end: bars[r.endBar - 1].end, startBar: r.startBar, bars: r.endBar - r.startBar, vocal: mid > 0.5 && label !== "drop" };
    });
    return { bars: bars.map((b, i) => ({ ...b, n: i + 1, ...feats[i] })), sections };
  }

  /** Suggested cues and a loop from structure. */
  function cuePoints(down, sections, grid) {
    const cues = [];
    if (down.downbeats.length) cues.push({ id: "A", label: "Start", time: down.downbeats[0] });
    const drop = sections.find((s) => s.label === "drop");
    if (drop) cues.push({ id: "B", label: "Drop", time: drop.start });
    const brk = sections.find((s) => s.label === "breakdown");
    if (brk) cues.push({ id: "C", label: "Breakdown", time: brk.start });
    const loop = drop ? { start: drop.start, end: drop.start + grid.period * 4 * 8, bars: 8 } : null;
    return { cues, loop };
  }

  /** Full analysis of decoded audio. */
  function analyze(channels, sr, { hop = 256, from = 0, to, withKey = true, bpmRange } = {}) {
    const cols = columns(channels, sr, { hop, from, to: to ?? channels[0].length });
    const grid = detectBeats(cols, bpmRange ? { range: bpmRange } : {});
    const down = grid ? detectDownbeats(cols, grid) : { offset: 0, downbeats: [] };
    const struct = grid ? detectSections(cols, grid, down) : { bars: [], sections: [] };
    const cp = grid ? cuePoints(down, struct.sections, grid) : { cues: [], loop: null };
    let peak = 0, sq = 0;
    for (let i = 0; i < cols.n; i++) { peak = Math.max(peak, cols.maxL[i], cols.maxR[i], -cols.minL[i], -cols.minR[i]); sq += cols.rms[i] ** 2; }
    return {
      sampleRate: sr, duration: (to ?? channels[0].length) / sr - from / sr, channels: channels.length,
      levels: mipChain(cols),
      bpm: grid?.bpm ?? null, beatConfidence: grid?.confidence ?? 0, beats: grid?.beats ?? [], period: grid?.period ?? null,
      downbeatOffset: down.offset, downbeats: down.downbeats,
      bars: struct.bars, sections: struct.sections, cues: cp.cues, loop: cp.loop,
      key: withKey ? detectKey(channels, sr) : null,
      peakDb: db(peak), rmsDb: db(Math.sqrt(sq / cols.n)),
    };
  }

  /* ---------- Compact binary form (for files and caches) ---------- */
  // Layout: "TBWF" · u32 version · u32 jsonLen · JSON header · u8 columns (11 fields × n).
  // Amplitudes are linear 0–255 (peaks stay accurate); energies are log-scaled (-90…0 dB → 0–255).
  const FIELDS = ["maxL", "minL", "maxR", "minR", "rms", "low", "lowMid", "highMid", "high", "flux", "lowFlux"];
  function encodeLevel(c, meta = {}) {
    const n = c.n;
    const eMax = Math.max(...["low", "lowMid", "highMid", "high"].map((k) => c[k].reduce((a, b) => (b > a ? b : a), 1e-12)));
    const fMax = Math.max(c.flux.reduce((a, b) => (b > a ? b : a), 1e-12), 1e-12), lfMax = Math.max(c.lowFlux.reduce((a, b) => (b > a ? b : a), 1e-12), 1e-12);
    const head = new TextEncoder().encode(JSON.stringify({ ...meta, n, hop: c.hop, sr: c.sr, from: c.from, eMax, fMax, lfMax }));
    const buf = new Uint8Array(12 + head.length + n * FIELDS.length);
    const dv = new DataView(buf.buffer);
    buf.set([84, 66, 87, 70]); dv.setUint32(4, 1, true); dv.setUint32(8, head.length, true); buf.set(head, 12);
    let o = 12 + head.length;
    const q = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const qe = (e) => q(((10 * Math.log10(e / eMax + 1e-12) + 90) / 90) * 255);
    for (const f of FIELDS) {
      const src = c[f];
      for (let i = 0; i < n; i++) {
        buf[o++] = f.startsWith("min") ? q(-src[i] * 255) : f === "flux" ? q((src[i] / fMax) * 255) : f === "lowFlux" ? q((src[i] / lfMax) * 255) : ["low", "lowMid", "highMid", "high"].includes(f) ? qe(src[i]) : q(src[i] * 255);
      }
    }
    return buf;
  }
  function decodeLevel(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8[0] !== 84 || u8[1] !== 66 || u8[2] !== 87 || u8[3] !== 70) throw new Error("Not a TBWF waveform file");
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const hl = dv.getUint32(8, true);
    const meta = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hl)));
    const n = meta.n; let o = 12 + hl;
    const c = { n, hop: meta.hop, sr: meta.sr, from: meta.from ?? 0 };
    const de = (v) => meta.eMax * Math.pow(10, ((v / 255) * 90 - 90) / 10);
    for (const f of FIELDS) {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const v = u8[o++];
        a[i] = f.startsWith("min") ? -v / 255 : f === "flux" ? (v / 255) * meta.fMax : f === "lowFlux" ? (v / 255) * meta.lfMax : ["low", "lowMid", "highMid", "high"].includes(f) ? (v === 0 ? 0 : de(v)) : v / 255;
      }
      c[f] = a;
    }
    return { meta, level: c };
  }

  const api = { BANDS, FFT_SIZE, fft, powerSpectrum, bandBins, columns, downsample, mipChain, bandShares, midColor, columnColor, dominant, onsetEnvelope, detectBeats, detectDownbeats, detectKey, detectSections, cuePoints, analyze, encodeLevel, decodeLevel, COLORS: { RED, GREEN, YELLOW, ORANGE, BLUE } };
  root.TBDSP = api;
})(typeof self !== "undefined" ? self : globalThis);
