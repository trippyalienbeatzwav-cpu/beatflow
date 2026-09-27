// @ts-nocheck -- browser/worker/Node shared code without type annotations; covered by its own unit tests
/* ==========================================================================
   TUNIBEAT catalog synthesiser (ingest only). Renders an original, full-length stereo master for each
   catalog track from its metadata (genre family, BPM, key, energy, length), sample by sample in plain
   JavaScript (PolyBLEP oscillators, RBJ biquads, seeded noise). It stands in for the label-supplied
   masters a real store would ingest: everything downstream (analysis, waveform, preview clip) treats
   the result as ordinary audio. Deterministic; runs in Node or a browser.
   ========================================================================== */
(function (root) {
  "use strict";
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function parseKey(k) {
    const m = /^([A-G])([♯#♭b]?)\s*(maj|min)/.exec(k) || [];
    let r = NOTE[m[1]] ?? 9;
    if (m[2] === "♯" || m[2] === "#") r++; if (m[2] === "♭" || m[2] === "b") r--;
    return { root: (r + 12) % 12, minor: m[3] !== "maj" };
  }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

  const FAMILY_RANGES = {
    techno: [118, 160], trance: [124, 145], ambient: [55, 100], downtempo: [70, 110], breaks: [85, 140], four: [105, 135], afro: [110, 130], dnb: [160, 185],
    garage: [125, 140], synth: [88, 125], halftime: [130, 160], disco: [105, 125], minimal: [118, 132], hardcore: [160, 200],
    trap: [120, 170], drill: [130, 150], boombap: [70, 100], rnb: [60, 115], dembow: [85, 105], lofi: [65, 95],
  };
  /** Beats Store genres → synth family (instrumentals for artists: 808s, boom bap swing, dembow…). */
  const BEAT_FAMILIES = { trap: "trap", drill: "drill", "hip-hop": "boombap", rnb: "rnb", afrobeats: "afro", pop: "synth", "lo-fi": "lofi", soul: "rnb", reggaeton: "dembow" };
  const PAT = {
    techno: { k: [0, 4, 8, 12], s: [4, 12], h: "all", o: [2, 6, 10, 14], b: [2, 3, 6, 7, 10, 11, 14, 15], bass: "rumble", lead: "stab" },
    four: { k: [0, 4, 8, 12], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [2, 6, 10, 14], b: [2, 6, 10, 14], bass: "pluck", lead: "chords", vox: true },
    disco: { k: [0, 4, 8, 12], s: [4, 12], h: "all", o: [2, 6, 10, 14], b: [0, 3, 6, 8, 11, 14], bass: "pluck", lead: "chords", vox: true },
    minimal: { k: [0, 4, 8, 12], s: [12], h: [2, 6, 10, 14], o: [], b: [3, 11], bass: "sub", lead: "stab" },
    afro: { k: [0, 4, 8, 12], s: [], p: [3, 7, 10, 14], h: "all", o: [6, 14], b: [3, 10], bass: "sub", lead: "chords", vox: true },
    trance: { k: [0, 4, 8, 12], s: [4, 12], h: [2, 6, 10, 14], o: [2, 6, 10, 14], b: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], bass: "pluck", lead: "arp", vox: true },
    dnb: { k: [0, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [], b: [0, 10], bass: "reese", lead: "stab" },
    halftime: { k: [0, 3], s: [8], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [], b: [0], bass: "reese", lead: "stab" },
    garage: { k: [0, 10], s: [4, 12], h: [2, 5, 6, 10, 13, 14], o: [], b: [0, 7, 10], bass: "sub", lead: "chords", vox: true, swing: 0.2 },
    trap: { k: [0, 7, 10], s: [8], h: "all", o: [], b: [0, 7, 10], bass: "808", lead: "bells", roll: true },
    drill: { k: [0, 6, 11], s: [8], h: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], o: [], b: [0, 6, 11], bass: "808", lead: "stab" },
    boombap: { k: [0, 7, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [14], b: [0, 7, 10], bass: "sub", lead: "chords", swing: 0.18 },
    rnb: { k: [0, 7, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [], b: [0, 7, 10], bass: "sub", lead: "chords", vox: true },
    dembow: { k: [0, 4, 8, 12], s: [3, 6, 11, 14], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [], b: [0, 3, 8, 11], bass: "sub", lead: "stab" },
    lofi: { k: [0, 7, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [], b: [0, 10], bass: "sub", lead: "chords", swing: 0.22 },
    breaks: { k: [0, 6, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [14], b: [0, 6, 10], bass: "sub", lead: "stab" },
    synth: { k: [0, 8], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], o: [], b: [0, 2, 4, 6, 8, 10, 12, 14], bass: "pluck", lead: "arp" },
    downtempo: { k: [0, 10], s: [8], h: [2, 6, 10, 14], o: [], b: [0, 10], bass: "sub", lead: "chords", vox: true },
    ambient: { k: [], s: [], h: [], o: [], b: [], bass: "sub", lead: "pad", vox: true },
    hardcore: { k: [0, 4, 8, 12], s: [4, 12], h: "all", o: [2, 6, 10, 14], b: [], bass: "sub", lead: "stab" },
  };

  function plan(t) {
    const total = Math.max(32, Math.floor((t.duration * t.bpm) / 240));
    const intro = Math.min(Math.max(8, parseInt(t.intro, 10) || 16), Math.floor(total * 0.2 / 8) * 8 || 8);
    const outro = Math.min(Math.max(8, parseInt(t.outro, 10) || 16), Math.floor(total * 0.2 / 8) * 8 || 8);
    const mid = total - intro - outro;
    const b1 = 8, bd = mid >= 72 ? 16 : 8, b2 = 8;
    const drops = mid - b1 - bd - b2;
    const d1 = Math.max(8, Math.floor(drops / 16) * 8), d2 = Math.max(8, drops - d1);
    const secs = [["intro", intro], ["build", b1], ["drop", d1], ["breakdown", bd], ["build", b2], ["drop", d2], ["outro", outro]];
    let bar = 0;
    return secs.map(([label, bars]) => { const s = { label, startBar: bar, bars }; bar += bars; return s; });
  }

  /* ---------- DSP primitives ---------- */
  class Biquad {
    constructor(type, f, q, sr) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q); }
    set(type, f, q = 0.707) {
      const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
      let b0, b1, b2; const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
      if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
      else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
      else { b0 = al; b1 = 0; b2 = -al; }
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    }
    p(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
  }
  const blep = (t, dt) => (t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0);

  /**
   * Render a master. Options: only = a stem name (renders just that bus, with identical timing and
   * randomness, so stems line up with the master); raw = skip the bus saturation (stems are pre-master);
   * gain = fixed output gain instead of peak normalisation (pass the master's gain so stems match it).
   */
  function renderTrack(t, { sampleRate = 48000, tail = 1.5, only = null, raw = false, gain = null } = {}) {
    const SR = sampleRate;
    const fam = PAT[t.family] ? t.family : "four";
    const P = PAT[fam];
    const beatSec = 60 / t.bpm, barSec = beatSec * 4, stepSec = beatSec / 4;
    const sections = plan(t);
    const totalBars = sections.reduce((a, s) => a + s.bars, 0);
    const lead = 0.5;
    const len = Math.ceil((lead + totalBars * barSec + tail) * SR);
    const L = new Float32Array(len), R = new Float32Array(len);
    const r = rng(hash(t.id + t.title));
    const noise = () => r() * 2 - 1;
    const { root, minor } = parseKey(t.key);
    const scale = minor ? MIN : MAJ;
    const deg = (d, oct) => 12 * oct + root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    const prog = minor ? [[0, 5, 3, 4], [0, 3, 5, 6], [0, 6, 5, 4]][hash(t.id) % 3] : [[0, 4, 5, 3], [0, 5, 3, 4]][hash(t.id) % 2];
    const E = Math.max(1, Math.min(10, t.energy ?? 7)) / 10;
    // Every voice plays on a named bus; in stem mode only that bus reaches the output
    let bus = "mix";
    const used = {};
    const put = (i, v, pan) => { if (i < 0 || i >= len) return; used[bus] = true; if (only && bus !== only) return; L[i] += v * Math.min(1, 1 - pan); R[i] += v * Math.min(1, 1 + pan); };
    const tag = (name, fn) => (...a) => { if (bus !== "mix") return fn(...a); bus = name; try { return fn(...a); } finally { bus = "mix"; } };
    const at = (sec) => Math.round(sec * SR);

    const kick = (t0, v) => {
      const s = at(t0), n = at(0.36); let ph = 0;
      const top = fam === "techno" || fam === "hardcore" ? 170 : 150, bot = fam === "dnb" ? 52 : 45;
      for (let i = 0; i < n; i++) { const x = i / SR; ph += (2 * Math.PI * (bot + (top - bot) * Math.exp(-x * 38))) / SR; put(s + i, v * Math.sin(ph) * Math.exp(-x * 8.5) * (x < 0.002 ? x / 0.002 : 1), 0); }
      const hp = new Biquad("bp", 3200, 1, SR);
      for (let i = 0; i < at(0.012); i++) put(s + i, 0.18 * v * hp.p(noise()) * (1 - i / at(0.012)), 0);
    };
    const noiseHit = (t0, { f = 8000, type = "hp", q = 0.7, peak, dec, pan = 0, dur }) => {
      const s = at(t0), n = at(dur ?? dec * 5), flt = new Biquad(type, f, q, SR), flt2 = new Biquad(type, f, q, SR);
      for (let i = 0; i < n; i++) put(s + i, peak * flt2.p(flt.p(noise())) * Math.exp(-i / SR / dec), pan);
    };
    const hat = (t0, v, open) => noiseHit(t0, { f: open ? 6500 : 8500, peak: (open ? 0.35 : 0.3) * v * (0.6 + 0.5 * E), dec: open ? 0.07 : 0.012, pan: open ? 0.3 : -0.25 });
    const clap = (t0) => { for (let k = 0; k < 3; k++) noiseHit(t0 + k * 0.009, { f: 1600, type: "bp", q: 0.8, peak: 0.55, dec: k === 2 ? 0.05 : 0.006 }); };
    const snare = (t0, v = 1) => {
      noiseHit(t0, { f: 2500, type: "bp", q: 0.6, peak: 0.5 * v, dec: 0.045 });
      const s = at(t0); let ph = 0;
      for (let i = 0; i < at(0.12); i++) { ph += (2 * Math.PI * (160 + 50 * Math.exp(-i / SR * 40))) / SR; put(s + i, 0.3 * v * Math.sin(ph) * Math.exp(-i / SR / 0.03), 0); }
    };
    const ride = (t0) => noiseHit(t0, { f: 5000, peak: 0.12, dec: 0.15, pan: 0.35 });
    const crash = (t0) => noiseHit(t0, { f: 3500, peak: 0.3, dec: 0.45, dur: 2 });
    const perc = (t0) => { const s = at(t0); let ph = 0; for (let i = 0; i < at(0.12); i++) { ph += (2 * Math.PI * (300 + 120 * Math.exp(-i / SR * 30))) / SR; put(s + i, 0.25 * Math.sin(ph) * Math.exp(-i / SR / 0.03), 0.4); } };
    /** Saw voice(s) through a low-pass with an ADSR-ish envelope. */
    const saws = (t0, midi, dur, { cutoff = 3000, q = 0.7, peak = 0.08, attack = 0.005, release = 0.08, detune = [0], pan = 0, sub = 0, sine = false, cutEnd } = {}) => {
      const s = at(t0), n = at(dur), f = mtof(midi);
      const lp = new Biquad("lp", cutoff, q, SR);
      const phs = detune.map((d, k) => (k * 0.37) % 1), incs = detune.map((d) => (f * Math.pow(2, d / 1200)) / SR);
      let sp = 0;
      for (let i = 0; i < n; i++) {
        if (cutEnd && (i & 63) === 0) lp.set("lp", cutoff + (cutEnd - cutoff) * (i / n), q);
        let x = 0;
        if (sine) { x = Math.sin(2 * Math.PI * phs[0]); phs[0] = (phs[0] + incs[0]) % 1; }
        else for (let k = 0; k < phs.length; k++) { const p = phs[k]; x += 2 * p - 1 - blep(p, incs[k]); phs[k] = (p + incs[k]) % 1; }
        if (sub) { sp = (sp + f / 2 / SR) % 1; x += sub * Math.sin(2 * Math.PI * sp); }
        const tt = i / SR, e = Math.min(1, tt / attack) * Math.min(1, (dur - tt) / release);
        put(s + i, peak * e * lp.p(x / Math.sqrt(phs.length)), pan);
      }
    };
    const bass = (t0, midi, dur, kind) => {
      if (kind === "sub") return saws(t0, midi, dur, { sine: true, peak: 0.55, attack: 0.004, release: 0.03 });
      if (kind === "808") return saws(t0, midi - 12, Math.max(dur, 0.35), { sine: true, peak: 0.75, attack: 0.002, release: 0.12, sub: 0.15 });
      if (kind === "rumble") return saws(t0, midi, dur, { cutoff: 170, q: 1.2, peak: 0.75, release: 0.03, sub: 0.6 });
      if (kind === "reese") return saws(t0, midi, dur, { cutoff: 420, q: 1, peak: 0.5, detune: [-9, 9], release: 0.04, sub: 0.5 });
      return saws(t0, midi, dur, { cutoff: 650, q: 3, peak: 0.45, release: 0.03, sub: 0.4 });
    };
    const VOW = [[800, 1150, 2900], [450, 800, 2830], [400, 1600, 2700], [350, 2000, 2800]];
    const vox = (t0, midi, dur, v) => {
      const s = at(t0), n = at(dur), f0 = mtof(midi), fm = VOW[hash(t0) % VOW.length].map((fc, k) => ({ b: new Biquad("bp", fc, 9, SR), g: [1, 0.55, 0.3][k] }));
      let ph = 0;
      for (let i = 0; i < n; i++) {
        ph += (f0 * (1 + 0.012 * Math.sin((2 * Math.PI * 5.2 * i) / SR))) / SR; if (ph >= 1) ph -= 1;
        const src = ph < 0.4 ? Math.sin((Math.PI * ph) / 0.4) ** 2 - 0.3 : -0.3;
        let y = 0; for (const x of fm) y += x.g * x.b.p(src);
        const tt = i / SR, e = Math.min(1, tt / 0.06) * Math.min(1, (dur - tt) / 0.2);
        put(s + i, 1.6 * v * y * e, 0.05);
      }
    };
    const riser = (t0, dur) => {
      const s = at(t0), n = at(dur), bp = new Biquad("bp", 600, 1.2, SR);
      for (let i = 0; i < n; i++) { if ((i & 63) === 0) bp.set("bp", 600 * Math.pow(15, i / n), 1.2); put(s + i, 0.35 * (i / n) ** 2 * bp.p(noise()), 0); }
    };

    const I = { kick: tag("Kick", kick), snare: tag("Snare & Clap", snare), clap: tag("Snare & Clap", clap), hat: tag("Hi-hats", hat), ride: tag("Cymbals", ride), crash: tag("Cymbals", crash),
      perc: tag("Percussion", perc), bass: tag("Bass", bass), saws: tag("Keys & Synths", saws), vox: tag("Vocals", vox), riser: tag("FX", riser) };
    const melody = Array.from({ length: 16 }, () => (r() < 0.55 ? Math.floor(r() * 7) : null));
    let bar = 0;
    for (const s of sections) {
      for (let i = 0; i < s.bars; i++, bar++) {
        const bt = lead + bar * barSec, cd = prog[bar % prog.length], L_ = s.label, prog1 = i / s.bars;
        const drop = L_ === "drop", intro = L_ === "intro", outro = L_ === "outro", build = L_ === "build", brk = L_ === "breakdown";
        if (i === 0 && (drop || brk)) I.crash(bt);
        if (build && i === 0) I.riser(bt, s.bars * barSec);
        for (let st = 0; st < 16; st++) {
          const t0 = bt + st * stepSec;
          if (!brk && P.k.includes(st) && !(build && i === s.bars - 1 && st >= 8)) I.kick(t0, intro || outro ? 0.8 : 0.95);
          if (!brk && (drop || (build && i >= s.bars / 2)) && P.s.includes(st)) (["four", "disco", "afro", "garage"].includes(fam) ? I.clap : I.snare)(t0);
          if (build && i >= s.bars - 2 && st % (i === s.bars - 1 ? 1 : 2) === 0) I.snare(t0, 0.3 + 0.4 * prog1);
          if (!brk && (P.h === "all" || P.h.includes(st)) && (drop || build || i >= 4 || fam === "techno")) I.hat(t0 + (P.swing && st % 2 ? stepSec * P.swing : 0), st % 4 === 0 ? 1 : 0.7, false);
          if ((drop || (outro && i < s.bars / 2)) && P.o.includes(st)) I.hat(t0, 1, true);
          if (P.roll && drop && i % 4 === 3 && st >= 12) for (let k = 1; k < 3; k++) I.hat(t0 + (stepSec * k) / 3, 0.55, false);
          if (drop && P.lead === "bells" && st % 2 === 0 && melody[st] != null) I.saws(t0, deg(melody[st], 6), stepSec * 1.6, { sine: true, peak: 0.08, release: 0.25, pan: 0.2 });
          if (drop && P.p?.includes(st)) I.perc(t0);
          if (drop && st === 0 && bar % 2 === 0 && fam !== "ambient") I.ride(t0);
          const bs = P.b.length ? P.b : P.k;
          if ((drop || (outro && i < s.bars / 2) || (intro && i >= s.bars / 2 && fam === "techno")) && bs.includes(st)) {
            const next = bs.find((x) => x > st) ?? 16;
            I.bass(t0, deg(cd, P.bass === "sub" || P.bass === "rumble" || P.bass === "808" ? 1 : 2), Math.min((next - st) * stepSec, stepSec * 3) * 0.95, P.bass);
          }
          if (drop && P.lead === "stab" && (st === 3 || st === 11) && bar % 2 === 1) I.saws(t0, deg(cd + 4, 4), stepSec * 1.5, { cutoff: 2400, peak: 0.12, detune: [-8, 8], pan: -0.3 });
          if (drop && P.lead === "chords" && (st === 2 || st === 10)) [0, 2, 4].forEach((k) => I.saws(t0, deg(cd + k, 4), stepSec * 1.8, { cutoff: 3500, peak: 0.07, detune: [-7, 7], pan: [-0.35, 0.35, 0][k] }));
          if ((drop || build) && P.lead === "arp" && st % 2 === 1) I.saws(t0, deg(cd + [0, 2, 4, 7][(st >> 1) % 4], 5), stepSec * 1.3, { cutoff: build ? 1000 + 5000 * prog1 : 6000, peak: 0.07, pan: st % 4 === 1 ? -0.4 : 0.4 });
          if (drop && st % 4 === 0 && melody[st] != null && P.lead !== "arp" && fam !== "minimal") I.saws(t0 + stepSec * 2, deg(melody[st], 5), stepSec * 2, { cutoff: 5000, peak: 0.05, pan: 0.3 });
        }
        if (brk || fam === "ambient" || (intro && fam === "downtempo")) [0, 2, 4].forEach((k) => I.saws(bt, deg(cd + k, 4), barSec, { cutoff: brk ? 900 : 1400, cutEnd: brk ? 900 + 2600 * (prog1 + 1 / s.bars) : undefined, peak: 0.06, attack: 0.3, release: 0.4, detune: [-12, 12], pan: [-0.4, 0.4, 0][k] }));
        if (P.vox && ((brk && i % 2 === 0) || (drop && s.startBar > sections[2].startBar && i % 4 === 0))) I.vox(bt + beatSec * 0.5, deg(cd + 2, 4), barSec * (brk ? 1.8 : 0.9), brk ? 0.5 : 0.3);
        if (brk && !P.vox && i % 2 === 0) I.saws(bt, deg(cd + 4, 5), barSec * 1.5, { cutoff: 2600, peak: 0.07, attack: 0.05, release: 0.6, pan: 0.2 });
      }
    }
    // Gentle bus saturation, then normalise to −1 dBFS sample peak
    let peak = 0;
    for (let i = 0; i < len; i++) { if (!raw) { L[i] = Math.tanh(L[i] * 0.9); R[i] = Math.tanh(R[i] * 0.9); } peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    const k = gain ?? (peak > 0 ? 0.891 / peak : 1);
    for (let i = 0; i < len; i++) { L[i] *= k; R[i] *= k; }
    return { channels: [L, R], sampleRate: SR, gain: k, peak, stems: Object.keys(used).filter((x) => x !== "mix"), sections: sections.map((s) => ({ ...s, start: lead + s.startBar * barSec })), firstBeat: lead, family: fam, range: FAMILY_RANGES[fam] ?? [70, 180] };
  }

  root.TBSynth = { renderTrack, plan, FAMILY_RANGES, BEAT_FAMILIES, PAT, parseKey };
})(typeof self !== "undefined" ? self : globalThis);
