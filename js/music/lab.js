/* ==========================================================================
   Player Lab (#/electronic/player-lab): proves the waveform against known audio.
   • Reference tracks A–G: synthesised with known content, encoded to Opus like the catalog,
     decoded and analysed here in the browser by the same worker the store uses. Each result is
     checked against its ground truth (band shares, dominant colour, BPM, drop position).
   • Analyse a local file: decode → STFT worker → the same renderer, with playback.
   • Store preview settings: length, start offset, fade-in, fade-out (BF.setPreviewConfig).
   Results are also exposed on window.__lab for the end-to-end tests.
   ========================================================================== */
(function () {
  const I = BF.icon, esc = BF.esc;
  const IDS = ["A", "B", "C", "D", "E", "F", "G"];
  const FAMILY = { low: "Red (bass & kick)", mid: "Green / yellow / orange (vocals & synths)", high: "Blue (hats & cymbals)", mixed: "A mix of all three", quiet: "Low energy, then silence" };

  /** Mean band shares and the fraction of columns each band dominates (ignoring near-silent columns). */
  function profile(level) {
    const D = TBDSP;
    let n = 0; const sum = { low: 0, mid: 0, high: 0 }, dom = { low: 0, mid: 0, high: 0 };
    for (let i = 0; i < level.n; i++) {
      if (level.rms[i] < 0.01) continue;
      const s = D.bandShares(level.low[i], level.lowMid[i], level.highMid[i], level.high[i]);
      sum.low += s.low; sum.mid += s.mid; sum.high += s.high; dom[D.dominant(s)]++; n++;
    }
    const f = (o) => ({ low: o.low / (n || 1), mid: o.mid / (n || 1), high: o.high / (n || 1) });
    return { ...f(sum), dom: f(dom), columns: n };
  }
  /** Classify lit canvas pixels by nearest band colour family. */
  function pixelFamilies(canvas) {
    const C = TBDSP.COLORS, d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const fam = [["low", C.RED], ["mid", C.GREEN], ["mid", C.YELLOW], ["mid", C.ORANGE], ["high", C.BLUE]];
    const out = { low: 0, mid: 0, high: 0 }; let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] < 150) continue;
      let best = null, bd = Infinity;
      for (const [k, c] of fam) { const e = (d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2; if (e < bd) { bd = e; best = k; } }
      out[best]++; n++;
    }
    return { low: out.low / (n || 1), mid: out.mid / (n || 1), high: out.high / (n || 1), pixels: n };
  }
  const pct = (x) => `${Math.round(x * 100)}%`;

  function judge(truth, a, p, px, ref) {
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, ok, detail });
    const e = truth.expect;
    if (e === "low" || e === "mid" || e === "high") {
      add(`${e} share > ${e === "mid" ? 75 : 85}%`, p[e] > (e === "mid" ? 0.75 : 0.85), pct(p[e]));
      add(`${e} dominates > 90% of moments`, p.dom[e] > 0.9, pct(p.dom[e]));
      add(`Canvas pixels mostly ${e === "low" ? "red" : e === "high" ? "blue" : "green/yellow/orange"}`, px[e] > 0.6, pct(px[e]));
    }
    if (e === "mixed") {
      for (const k of ["low", "mid", "high"]) add(`${k} share 10–75%`, p[k] > 0.1 && p[k] < 0.75, pct(p[k]));
      for (const k of ["low", "mid", "high"]) add(`${k} visible on canvas`, px[k] > 0.03, pct(px[k]));
    }
    if (e === "quiet" && ref) {
      add("≥ 18 dB quieter than track A", a.rmsDb < ref.rmsDb - 18, `${a.rmsDb.toFixed(1)} vs ${ref.rmsDb.toFixed(1)} dB`);
      const l = a.levels[0], from = Math.max(0, l.n - Math.round(l.sr / l.hop));
      let tail = 0; for (let i = from; i < l.n; i++) tail = Math.max(tail, l.maxL[i], l.maxR[i], -l.minL[i], -l.minR[i]);
      add("Last second is silent (flat line)", tail < 0.004, tail.toFixed(4));
    }
    if (truth.bpm) add(`BPM ${truth.bpm} ± 0.5`, a.bpm != null && Math.abs(a.bpm - truth.bpm) <= 0.5, a.bpm == null ? "no beat" : String(a.bpm));
    if (truth.sections) {
      const drop = truth.sections.find((s) => s.label === "drop"), got = a.sections.find((s) => s.label === "drop");
      const bar = (60 / truth.bpm) * 4;
      add("Drop found within 1 bar", !!got && Math.abs(got.start - drop.start) <= bar, got ? `${got.start.toFixed(2)}s vs ${drop.start.toFixed(2)}s` : "none");
      const want = truth.sections.map((s) => s.label).join(" › "), have = a.sections.filter((s) => s.label !== "silence").map((s) => s.label).join(" › ");
      add("Section order matches", want === have, have || "none");
    }
    return checks;
  }

  /* ---------- Shared lab playback (its own <audio>, never the store engine) ---------- */
  const P = { el: null, row: null, raf: 0, url: null };
  function playRow(row) {
    BF.player.pause?.();
    P.el ??= Object.assign(new Audio(), { preload: "auto" });
    if (P.row !== row) { P.el.src = row.src; P.row?.setPlaying(false); P.row = row; }
    if (P.el.paused) { P.el.play().catch(() => BF.ui.toast({ kind: "info", title: "Press play again to start audio" })); row.setPlaying(true); loop(); }
    else { P.el.pause(); row.setPlaying(false); }
    P.el.onended = () => row.setPlaying(false);
  }
  function loop() {
    cancelAnimationFrame(P.raf);
    const f = () => { if (P.row) P.row.draw(P.el.currentTime); if (P.el && !P.el.paused) P.raf = requestAnimationFrame(f); };
    P.raf = requestAnimationFrame(f);
  }
  const stopAll = () => { P.el?.pause(); P.row?.setPlaying(false); cancelAnimationFrame(P.raf); P.row = null; };

  /** A waveform row bound to analysis results: overview (+ optional zoomed detail) with a playhead from audio.currentTime. */
  function makeRow(host, a, src, { detail = false } = {}) {
    const meta = { duration: a.duration, beatPeriod: a.period, firstDownbeat: a.downbeats?.[0], firstBeat: a.beats?.[0], gridReliable: a.beatConfidence >= 0.2 };
    const win = { start: 0, end: a.duration, clipStart: 0, clipEnd: a.duration };
    const ov = host.querySelector("[data-lab-ov]"), dt = host.querySelector("[data-lab-dt]");
    const lvlIdx = Math.min(a.levels.length - 1, 2);
    const data = { overview: a.levels[lvlIdx], meta, win, detail: { levels: a.levels, offset: 0 } };
    const oW = new BF.Wave(ov.querySelector("canvas"), { kind: "overview", mode: "3band" }); oW.setData({ ...data, win: null });
    const dW = detail && dt ? new BF.Wave(dt.querySelector("canvas"), { kind: "detail", mode: "3band" }) : null; dW?.setData(data);
    // Cues only mean something on arranged material (the detail rows); short loops get none
    const cues = (detail ? a.cues ?? [] : []).map((c) => ({ ...c, color: c.id === "A" ? "#ffcc33" : c.id === "B" ? "#ff5a5a" : "#3fd0ff" }));
    const row = {
      src, oW, dW,
      draw(pos) { oW.draw({ pos, cues }); dW?.draw({ pos: pos ?? 0, zoom: meta.beatPeriod && meta.gridReliable ? meta.beatPeriod * 16 : 8, cues, grid: meta.gridReliable }); ov.setAttribute("aria-valuenow", Math.round(pos ?? 0)); },
      setPlaying(on) { const b = host.querySelector("[data-lab-play]"); b.innerHTML = I(on ? "pause" : "play", "i-sm"); b.setAttribute("aria-label", on ? "Pause" : "Play"); },
      destroy() { oW.destroy(); dW?.destroy(); },
    };
    const seek = (e) => { const r = ov.getBoundingClientRect(); const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration; if (P.row !== row) playRow(row); P.el.currentTime = t; row.draw(t); };
    ov.addEventListener("pointerdown", seek);
    ov.addEventListener("keydown", (e) => { if (P.row !== row) return; if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); P.el.currentTime += (e.key === "ArrowRight" ? 1 : -1) * (meta.beatPeriod ?? 1) * 4; row.draw(P.el.currentTime); } });
    host.querySelector("[data-lab-play]").addEventListener("click", () => playRow(row));
    requestAnimationFrame(() => { oW.resize(); dW?.resize(); row.draw(null); });
    return row;
  }

  async function decode(bytes) {
    const ctx = new OfflineAudioContext(2, 1, 48000);
    const buf = await ctx.decodeAudioData(bytes);
    return { ch: [new Float32Array(buf.getChannelData(0)), new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0))], sr: buf.sampleRate };
  }

  const waveBox = (label, detail) => `${detail ? `<div class="dj-detail lab-detail" data-lab-dt aria-hidden="true"><canvas class="dj-canvas"></canvas></div>` : ""}
    <div class="dj-overview lab-ov" data-lab-ov role="slider" tabindex="0" aria-label="${esc(label)} waveform. Click to seek." aria-valuemin="0" aria-valuenow="0"><canvas class="dj-canvas"></canvas></div>`;

  function render() {
    const cfg = BF.PREVIEW_CONFIG;
    const sel = (name, opts, v, fmt) => `<select class="input" name="${name}" id="lab-${name}">${opts.map((o) => `<option value="${o}" ${Number(v) === o ? "selected" : ""}>${fmt(o)}</option>`).join("")}</select>`;
    return `<div class="container lab">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/electronic">Electronic</a>${I("chevron-right", "i-xs")}<span aria-current="page">Player Lab</span></nav>
      <header class="lab-head">
        <h1 class="h1">Player Lab</h1>
        <p class="lead">Every waveform in the store is drawn from a frequency analysis of the real audio: <b class="c-low">red</b> for bass and kick (20–250 Hz), <b class="c-mid">green → yellow → orange</b> for vocals and synths (250 Hz–4 kHz), <b class="c-high">blue</b> for hats and cymbals (4–20 kHz). This page runs that analysis on reference audio with known content and checks the result.</p>
      </header>
      <section class="lab-sec" aria-labelledby="lab-ref-h">
        <div class="lab-sec-head"><h2 class="h3" id="lab-ref-h">Reference tracks</h2><button class="btn btn-primary btn-sm" data-lab-run>${I("wave", "i-sm")} Analyse all</button></div>
        <p class="subtle lab-note">Each track was synthesised with known instruments, encoded to Opus 64 kb/s like the store previews, and is decoded and analysed here in your browser (STFT, 2048-point FFT).</p>
        <div class="lab-summary" data-lab-summary aria-live="polite"></div>
        <ol class="lab-list">${IDS.map((id) => `<li class="lab-row" data-lab-row="${id}"><div class="lab-row-head"><button class="icon-btn" data-lab-play aria-label="Play" disabled>${I("play", "i-sm")}</button><div class="lab-row-t"><b data-lab-name>${id}</b><span class="subtle" data-lab-expect></span></div><span class="lab-status" data-lab-status>Not analysed</span></div>${waveBox("Track " + id, id === "G")}<ul class="lab-checks" data-lab-checks></ul></li>`).join("")}</ol>
      </section>
      <section class="lab-sec" aria-labelledby="lab-file-h">
        <div class="lab-sec-head"><h2 class="h3" id="lab-file-h">Analyse your own track</h2></div>
        <p class="subtle lab-note">Choose an audio file (WAV, MP3, FLAC, AAC, Ogg). It is decoded and analysed on this device only and is never uploaded.</p>
        <label class="btn btn-secondary lab-file">${I("upload", "i-sm")} Choose audio file<input type="file" accept="audio/*,.flac,.wav,.mp3,.ogg,.opus,.m4a,.aiff" data-lab-file class="sr-only"></label>
        <div class="lab-own" data-lab-own hidden>
          <div class="lab-row-head"><button class="icon-btn" data-lab-play aria-label="Play">${I("play", "i-sm")}</button><div class="lab-row-t"><b data-lab-fname></b><span class="subtle" data-lab-fmeta></span></div></div>
          ${waveBox("Your track", true)}
          <dl class="deck-info lab-own-info" data-lab-finfo></dl>
        </div>
        <p class="lab-err" data-lab-ferr role="alert" hidden></p>
      </section>
      <section class="lab-sec" aria-labelledby="lab-cfg-h">
        <div class="lab-sec-head"><h2 class="h3" id="lab-cfg-h">Store preview settings</h2></div>
        <p class="subtle lab-note">Previews are cut at ingest from the first build-up (up to 90 seconds). These settings shape what the store plays inside that clip. They apply to the next preview you start and are saved on this device.</p>
        <form class="lab-cfg" data-lab-cfg>
          <div class="field"><label for="lab-maxLength">Preview length</label>${sel("maxLength", [30, 45, 60, 90], cfg.maxLength, (o) => `${o} seconds`)}</div>
          <div class="field"><label for="lab-startOffset">Start</label>${sel("startOffset", [0, 8, 16, 32], cfg.startOffset ?? 0, (o) => (o ? `${o}s after the build-up starts` : "At the build-up (ingest start)"))}</div>
          <div class="field"><label for="lab-fadeIn">Fade-in</label>${sel("fadeIn", [0, 0.5, 1, 2], cfg.fadeIn, (o) => (o ? `${o} s` : "None"))}</div>
          <div class="field"><label for="lab-fadeOut">Fade-out</label>${sel("fadeOut", [0, 1, 3, 5], cfg.fadeOut, (o) => (o ? `${o} s` : "None"))}</div>
        </form>
        <p class="subtle lab-note" data-lab-cfgex aria-live="polite"></p>
      </section>
    </div>`;
  }

  function mount(el) {
    const rows = new Map(), results = {};
    const lab = (window.__lab = { results, done: false, own: null });
    const q = (s, r = el) => r.querySelector(s);

    async function loadOne(id) {
      const li = q(`[data-lab-row="${id}"]`);
      const truth = await fetch(`assets/audio/test/${id}.json`).then((r) => r.json());
      q("[data-lab-name]", li).textContent = truth.name;
      q("[data-lab-expect]", li).textContent = truth.expect ? `Expect: ${FAMILY[truth.expect]}` : `Expect: ${truth.bpm} BPM, ${truth.sections.map((s) => s.label).join(" › ")}`;
      return truth;
    }
    async function analyseOne(id, truth) {
      const li = q(`[data-lab-row="${id}"]`);
      q("[data-lab-status]", li).textContent = "Analysing…"; li.dataset.state = "busy";
      const src = `assets/audio/test/${id}.opus`;
      const { ch, sr } = await decode(await (await fetch(src)).arrayBuffer());
      const a = await BF.analyseFile(ch, sr);
      if (!el.isConnected) return null;
      rows.get(id)?.destroy();
      const row = makeRow(li, a, src, { detail: id === "G" });
      rows.set(id, row);
      q("[data-lab-play]", li).disabled = false;
      // Pixel check on an off-screen render so layout size never matters
      const oc = document.createElement("canvas"); oc.width = 600; oc.height = 80;
      const probe = new BF.Wave(oc, { kind: "overview", mode: "3band" });
      probe.w = 600; probe.h = 80; oc.width = 600; oc.height = 80;
      probe.setData({ overview: a.levels[Math.min(a.levels.length - 1, 2)], meta: { duration: a.duration }, win: null }); probe.draw({ pos: null, cues: [] }); probe.destroy();
      const p = profile(a.levels[0]), px = pixelFamilies(oc);
      const checks = judge(truth, a, p, px, results.A?.analysis);
      results[id] = { analysis: { bpm: a.bpm, rmsDb: a.rmsDb, peakDb: a.peakDb, duration: a.duration, sections: a.sections.map((s) => ({ label: s.label, start: s.start })), cues: a.cues, beatConfidence: a.beatConfidence, levels: a.levels }, profile: p, pixels: px, checks, pass: checks.every((c) => c.ok) };
      const ok = results[id].pass;
      li.dataset.state = ok ? "pass" : "fail";
      q("[data-lab-status]", li).innerHTML = `${I(ok ? "check" : "x", "i-xs")} ${ok ? "Pass" : "Fail"}`;
      q("[data-lab-checks]", li).innerHTML = `<li class="lab-shares"><span class="c-low">Low ${pct(p.low)}</span><span class="c-mid">Mid ${pct(p.mid)}</span><span class="c-high">High ${pct(p.high)}</span>${a.bpm ? `<span>${a.bpm} BPM</span>` : `<span>No beat</span>`}<span>${a.rmsDb.toFixed(1)} dB RMS</span></li>` +
        checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}">${I(c.ok ? "check" : "x", "i-xs")} ${esc(c.name)} <span class="subtle">${esc(c.detail)}</span></li>`).join("");
      return results[id];
    }
    async function runAll() {
      const btn = q("[data-lab-run]"); btn.disabled = true;
      lab.done = false;
      try {
        for (const id of IDS) { const t = await loadOne(id); await analyseOne(id, t); if (!el.isConnected) return; }
        const passed = IDS.filter((id) => results[id]?.pass).length;
        q("[data-lab-summary]").innerHTML = `<b>${passed} of ${IDS.length}</b> reference tracks match their ground truth.`;
      } catch (err) {
        q("[data-lab-summary]").textContent = `Analysis failed: ${err.message}`;
        lab.error = String(err.message);
      } finally { btn.disabled = false; lab.done = true; }
    }
    Promise.all(IDS.map(loadOne)).catch(() => {});
    q("[data-lab-run]").addEventListener("click", runAll);
    if (BF.parseHash().query.run === "1") runAll();

    // Local file
    let own = null;
    q("[data-lab-file]").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const err = q("[data-lab-ferr]"); err.hidden = true;
      const box = q("[data-lab-own]");
      if (f.size > 200 * 1024 * 1024) { err.hidden = false; err.textContent = "That file is over 200 MB. Choose a shorter track."; return; }
      q("[data-lab-fname]", box).textContent = f.name; q("[data-lab-fmeta]", box).textContent = "Decoding…"; box.hidden = false;
      try {
        const { ch, sr } = await decode(await f.arrayBuffer());
        if (ch[0].length / sr > 20 * 60) throw new Error("Tracks over 20 minutes are not supported here.");
        q("[data-lab-fmeta]", box).textContent = "Analysing…";
        const a = await BF.analyseFile(ch, sr);
        if (P.url) URL.revokeObjectURL(P.url);
        P.url = URL.createObjectURL(f);
        if (own) { if (P.row === own) stopAll(); own.destroy(); }
        const fresh = box.cloneNode(true); box.replaceWith(fresh);   // drop old listeners
        own = makeRow(fresh, a, P.url, { detail: true });
        const p = profile(a.levels[0]);
        lab.own = { bpm: a.bpm, key: a.key?.name, sections: a.sections.map((s) => s.label), profile: p };
        q("[data-lab-fmeta]", fresh).textContent = `${BF.time(a.duration)} · ${sr / 1000} kHz`;
        const reliable = a.beatConfidence >= 0.2;
        q("[data-lab-finfo]", fresh).innerHTML = [
          ["BPM", a.bpm && reliable ? `${a.bpm} <span class="deck-dim">(confidence ${Math.round(a.beatConfidence * 100)}%)</span>` : "No clear beat"],
          ["Key (estimate)", a.key ? `${esc(a.key.name)} · ${esc(a.key.camelot)}` : "—"],
          ["Structure", reliable && a.sections.length ? a.sections.filter((s) => s.label !== "silence").map((s) => `${esc(s.label)} ${BF.time(s.start)}`).join(" · ") : "—"],
          ["Spectrum", `<span class="c-low">Low ${pct(p.low)}</span> · <span class="c-mid">Mid ${pct(p.mid)}</span> · <span class="c-high">High ${pct(p.high)}</span>`],
          ["Level", `${a.peakDb.toFixed(1)} dBFS peak · ${a.rmsDb.toFixed(1)} dB RMS`],
        ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
      } catch (x) {
        q("[data-lab-own]").hidden = true;
        err.hidden = false; err.textContent = `Couldn't analyse that file: ${x.message || "the browser can't decode this format"}.`;
      }
    });

    // Preview settings
    const example = () => {
      const t = BF.ETRACKS.find((x) => x.id === "t5") ?? BF.ETRACKS[0];
      BF.trackAnalysis(t.id).then(({ meta }) => {
        const w = BF.previewWindow(meta);
        const ex = q("[data-lab-cfgex]"); if (ex) ex.textContent = `Example: “${BF.trackTitle(t)}” would preview ${BF.time(w.start)}–${BF.time(w.end)} (${Math.round(w.length)} s), fading in over ${w.fadeIn} s and out over ${w.fadeOut.toFixed(1)} s.`;
      }).catch(() => {});
    };
    q("[data-lab-cfg]").addEventListener("change", (e) => {
      BF.setPreviewConfig({ [e.target.name]: Number(e.target.value) });
      example();
      BF.ui.toast({ kind: "success", title: "Preview settings saved", desc: "They apply to the next preview you start." });
    });
    example();

    return () => { stopAll(); rows.forEach((r) => r.destroy()); own?.destroy(); if (P.url) { URL.revokeObjectURL(P.url); P.url = null; } };
  }

  BF.route("/electronic/player-lab", { title: "Player Lab", eco: "electronic", ecoActive: "", render, mount });
  BF.labProfile = profile;
})();
