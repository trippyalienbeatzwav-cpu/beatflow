/* ==========================================================================
   Frequency-coloured waveform renderer (canvas, high-DPI).
   Every pixel column is drawn from analysis columns of the real audio:
     amplitude = true signed sample peaks (positive up, negative down; L/R split in stereo view)
     colour    = band energies → LOW red · MID green→yellow→orange · HIGH blue
   "3-band" draws each band's envelope at its own measured size (largest behind), so a kick section
   is a red body, hats are blue detail on top, vocals/synths sit in between. "Blend" draws one
   energy-weighted colour per column. Nothing is random or decorative.
   Per frame work is a handful of batched paths; static overview layers are cached.
   ========================================================================== */
(function () {
  const D = () => window.TBDSP;
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const MID_STEPS = 16;

  /** Aggregate columns [a, b) of a level into one pixel column (true peaks, mean energies). */
  function agg(l, a, b, out) {
    a = Math.max(0, a | 0); b = Math.min(l.n, Math.max(a + 1, b | 0));
    let mxl = 0, mnl = 0, mxr = 0, mnr = 0, lo = 0, lm = 0, hm = 0, hi = 0;
    for (let i = a; i < b; i++) {
      if (l.maxL[i] > mxl) mxl = l.maxL[i]; if (l.minL[i] < mnl) mnl = l.minL[i];
      if (l.maxR[i] > mxr) mxr = l.maxR[i]; if (l.minR[i] < mnr) mnr = l.minR[i];
      lo += l.low[i]; lm += l.lowMid[i]; hm += l.highMid[i]; hi += l.high[i];
    }
    const m = b - a;
    out.maxL = mxl; out.minL = mnl; out.maxR = mxr; out.minR = mnr; out.low = lo / m; out.lowMid = lm / m; out.highMid = hm / m; out.high = hi / m;
    return out;
  }
  /** Relative band sizes (0–1, dominant = 1) from the same weighting the colour shares use. */
  function bandSizes(c) {
    const s = D().bandShares(c.low, c.lowMid, c.highMid, c.high);
    const m = Math.max(s.low, s.mid, s.high) || 1;
    return { low: Math.sqrt(s.low / m), mid: Math.sqrt(s.mid / m), high: Math.sqrt(s.high / m), midT: s.midT, shares: s };
  }

  class Wave {
    constructor(canvas, { kind = "overview", mode = "3band", stereo = false } = {}) {
      this.cv = canvas; this.ctx = canvas.getContext("2d"); this.kind = kind; this.mode = mode; this.stereo = stereo;
      this.data = null; this.static = null; this.w = 0; this.h = 0; this.dpr = 1;
      this.ro = new ResizeObserver(() => { this.static = null; this.resize(); this.redraw?.(); });
      this.ro.observe(canvas);
      this.resize();
    }
    destroy() { this.ro.disconnect(); }
    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = Math.min(3, window.devicePixelRatio || 1);
      this.w = Math.max(1, Math.round(r.width * this.dpr)); this.h = Math.max(1, Math.round(r.height * this.dpr));
      if (this.cv.width !== this.w || this.cv.height !== this.h) { this.cv.width = this.w; this.cv.height = this.h; }
    }
    /** data: { overview, detail?: {levels, offset}, meta, win } */
    setData(d) { this.data = d; this.static = null; }
    setMode(mode) { this.mode = mode; this.static = null; }
    setStereo(s) { this.stereo = s; this.static = null; }
    css(name, fb) { return getComputedStyle(this.cv).getPropertyValue(name).trim() || fb; }

    /* Draw columns x0..x1 mapping pixel x → time range via tAt(x), using level(s) chosen by lvlFor(t0,t1). */
    paintColumns(ctx, x0, x1, tAt, sourceAt, alphaAt) {
      const H = this.h, stereo = this.stereo && this.kind === "detail";
      const lanes = stereo ? [{ mid: H * 0.25, amp: H * 0.24, ch: "L" }, { mid: H * 0.75, amp: H * 0.24, ch: "R" }] : [{ mid: H * 0.5, amp: H * 0.48, ch: "M" }];
      const c = {};
      // Batched paths: low (red), high (blue), mid bucketed by colour position, blend bucketed by colour
      const paths = new Map();
      const path = (key) => { let p = paths.get(key); if (!p) { p = new Path2D(); paths.set(key, p); } return p; };
      for (let x = x0; x < x1; x++) {
        const tA = tAt(x), tB = tAt(x + 1);
        const src = sourceAt(tA, tB);
        if (!src) continue;
        const { level, off } = src;
        const iA = (tA - off) * level.sr / level.hop, iB = (tB - off) * level.sr / level.hop;
        if (iB < 0 || iA >= level.n) continue;
        agg(level, Math.floor(iA), Math.ceil(iB), c);
        const alpha = alphaAt ? alphaAt(tA) : 1;
        const sizes = this.mode === "3band" ? bandSizes(c) : null;
        for (const lane of lanes) {
          const top = lane.ch === "L" ? c.maxL : lane.ch === "R" ? c.maxR : Math.max(c.maxL, c.maxR);
          const bot = lane.ch === "L" ? c.minL : lane.ch === "R" ? c.minR : Math.min(c.minL, c.minR);
          if (top <= 0 && bot >= 0) continue;
          const col = (key, f, rank = 0) => path(`${rank}#${key}|${alpha}`).rect(x, lane.mid - top * f * lane.amp, 1, Math.max(1, (top - bot) * f * lane.amp));
          if (sizes) {
            const order = [["low", sizes.low], ["mid", sizes.mid], ["high", sizes.high]].sort((a, b) => b[1] - a[1]);
            order.forEach(([b, f], rank) => col(b === "mid" ? `mid${Math.round(sizes.midT * (MID_STEPS - 1))}` : b, f, rank));
          } else {
            const cc = D().columnColor(D().bandShares(c.low, c.lowMid, c.highMid, c.high));
            col(`rgb${cc[0] >> 3},${cc[1] >> 3},${cc[2] >> 3}`, 1);
          }
        }
      }
      // Painter order by size rank: every column's largest band first, smaller bands on top
      const C = D().COLORS;
      const fillKey = (k) => {
        const [key, a] = k.split("#")[1].split("|");
        let colr;
        if (key === "low") colr = C.RED; else if (key === "high") colr = C.BLUE;
        else if (key.startsWith("mid")) colr = D().midColor(Number(key.slice(3)) / (MID_STEPS - 1));
        else colr = key.slice(3).split(",").map((v) => Number(v) * 8 + 4);
        ctx.fillStyle = rgb(colr, Number(a));
        ctx.fill(paths.get(k));
      };
      const keys = [...paths.keys()];
      keys.sort((a, b) => Number(a.split("#")[0]) - Number(b.split("#")[0])).forEach(fillKey);
    }

    /* ---------- Overview ---------- */
    drawOverview(state) {
      const { ctx, w: W, h: H } = this;
      const d = this.data;
      ctx.clearRect(0, 0, W, H);
      if (!d) return;
      const dur = d.meta.duration, x2t = (x) => (x / W) * dur, t2x = (t) => (t / dur) * W;
      if (!this.static || this.static.w !== W || this.static.h !== H || this.static.mode !== this.mode) {
        const oc = document.createElement("canvas"); oc.width = W; oc.height = H;
        const octx = oc.getContext("2d");
        this.paintColumns(octx, 0, W, x2t, () => ({ level: d.overview, off: 0 }));
        this.static = { canvas: oc, w: W, h: H, mode: this.mode };
      }
      ctx.drawImage(this.static.canvas, 0, 0);
      const bg = this.css("--wf-veil", "rgba(10,10,14,.62)");
      // Outside the preview window: veiled (you can't play it here)
      if (d.win) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, t2x(d.win.start), H); ctx.fillRect(t2x(d.win.end), 0, W - t2x(d.win.end), H);
        ctx.fillStyle = this.css("--wf-preview", "rgba(255,255,255,.9)");
        ctx.fillRect(t2x(d.win.start), 0, 1 * this.dpr, H); ctx.fillRect(t2x(d.win.end) - this.dpr, 0, 1 * this.dpr, H);
      }
      // Played portion (within the preview) is dimmed, DJ-style
      if (state.pos != null && d.win) {
        ctx.fillStyle = this.css("--wf-played", "rgba(10,10,14,.45)");
        ctx.fillRect(t2x(d.win.start), 0, Math.max(0, t2x(state.pos) - t2x(d.win.start)), H);
      }
      if (state.loop) { ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fillRect(t2x(state.loop.start), 0, t2x(state.loop.end) - t2x(state.loop.start), H); }
      this.drawCues(ctx, t2x, H, state, true);
      if (state.hover != null) { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(t2x(state.hover), 0, this.dpr, H); }
      if (state.pos != null) this.playhead(ctx, t2x(state.pos), H);
    }

    /* ---------- Detail (zoomed, playhead fixed in the centre) ---------- */
    drawDetail(state) {
      const { ctx, w: W, h: H, dpr } = this;
      const d = this.data;
      ctx.clearRect(0, 0, W, H);
      if (!d) return;
      const span = state.zoom, t0 = state.pos - span / 2, x2t = (x) => t0 + (x / W) * span, t2x = (t) => ((t - t0) / span) * W;
      const secPerPx = span / W;
      const win = d.win;
      // Level choice: finest level with ≥ 1 column per pixel from the clip analysis; the overview elsewhere
      const lvl = d.detail?.levels ? d.detail.levels.find((l, i, a) => l.hop / l.sr >= secPerPx * 0.5 || i === a.length - 1) : null;
      const source = (tA) => {
        if (lvl && win && tA >= (win.clipStart ?? win.start) && tA < win.clipEnd) return { level: lvl, off: d.detail.offset };
        return { level: d.overview, off: 0 };
      };
      // Grid behind the waveform
      this.drawGrid(ctx, t0, span, t2x, H, state);
      this.paintColumns(ctx, 0, W, x2t, source, (t) => (win && (t < win.start || t > win.end) ? 0.35 : 1));
      if (this.stereo) { ctx.fillStyle = this.css("--wf-grid", "rgba(255,255,255,.18)"); ctx.fillRect(0, H / 2 - dpr / 2, W, dpr); }
      else { ctx.fillStyle = this.css("--wf-center", "rgba(255,255,255,.22)"); ctx.fillRect(0, H / 2 - dpr / 2, W, dpr); }
      // Played portion dimmed; outside-preview veiled
      ctx.fillStyle = this.css("--wf-played", "rgba(10,10,14,.45)");
      ctx.fillRect(0, 0, W / 2, H);
      if (win) {
        ctx.fillStyle = this.css("--wf-veil", "rgba(10,10,14,.62)");
        if (win.start > t0) ctx.fillRect(0, 0, t2x(win.start), H);
        if (win.end < t0 + span) ctx.fillRect(t2x(win.end), 0, W - t2x(win.end), H);
      }
      if (state.loop) {
        const a = t2x(state.loop.start), b = t2x(state.loop.end);
        ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fillRect(a, 0, b - a, H);
        ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(a, 0, 2 * dpr, H); ctx.fillRect(b - 2 * dpr, 0, 2 * dpr, H);
      }
      this.drawCues(ctx, t2x, H, state, false);
      this.playhead(ctx, W / 2, H);
    }
    drawGrid(ctx, t0, span, t2x, H, state) {
      const m = this.data.meta;
      if (!m.beatPeriod || !state.grid) return;
      const p = m.beatPeriod, pxPerBeat = (p / span) * this.w;
      if (pxPerBeat < 3 * this.dpr) return;
      const first = m.firstDownbeat ?? m.firstBeat;
      const k0 = Math.floor((t0 - first) / p), k1 = Math.ceil((t0 + span - first) / p);
      ctx.font = `${10 * this.dpr}px ui-monospace, "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      for (let k = k0; k <= k1; k++) {
        const t = first + k * p;
        if (t < 0) continue;
        const x = Math.round(t2x(t));
        const barStart = ((k % 4) + 4) % 4 === 0, bar = Math.floor(k / 4) + 1;
        const phrase = barStart && ((bar - 1) % 16 === 0);
        ctx.fillStyle = phrase ? "rgba(255,255,255,.42)" : barStart ? "rgba(255,255,255,.26)" : "rgba(255,255,255,.1)";
        ctx.fillRect(x, barStart ? 0 : this.h * 0.08, this.dpr, barStart ? this.h : this.h * 0.84);
        const every = pxPerBeat * 4 > 42 * this.dpr ? 1 : pxPerBeat * 4 > 14 * this.dpr ? 4 : 16;
        if (barStart && bar > 0 && (bar - 1) % every === 0) { ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillText(String(bar), x + 3 * this.dpr, 3 * this.dpr); }
      }
    }
    drawCues(ctx, t2x, H, state, compact) {
      const cues = state.cues ?? [];
      ctx.font = `700 ${(compact ? 9 : 11) * this.dpr}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      for (const c of cues) {
        const x = Math.round(t2x(c.time)), s = (compact ? 7 : 10) * this.dpr;
        if (x < -s || x > this.w + s) continue;
        ctx.fillStyle = c.color ?? "#ffcc33";
        ctx.fillRect(x, 0, this.dpr, H);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + s * 1.6, 0); ctx.lineTo(x + s * 1.6, s * 1.4); ctx.lineTo(x, s * 1.9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#111"; ctx.fillText(c.id, x + s * 0.35, s * 0.72);
      }
    }
    playhead(ctx, x, H) {
      const d = this.dpr;
      ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(x - 2 * d, 0, 4 * d, H);
      ctx.fillStyle = this.css("--wf-head", "#ffffff"); ctx.fillRect(x - d, 0, 2 * d, H);
    }
    draw(state) { this.redraw = () => this.draw(state); if (this.kind === "detail") this.drawDetail(state); else this.drawOverview(state); }
  }
  BF.Wave = Wave;
  BF.waveBandSizes = bandSizes;
})();
