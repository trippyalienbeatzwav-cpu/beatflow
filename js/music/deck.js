/* ==========================================================================
   Electronic Music Store deck: the DJ-style preview UI around BF.previewEngine.
   • Mini overview waveform in the player bar (tap / drag to seek)
   • Deck panel: zoomable detail waveform with beat/bar grid, overview with preview window,
     sections, cues, loop, 3-band / blend and stereo views, full track info, store actions
   All positions come from the engine's audio clock (BF.previewEngine.position()).
   Keys (deck focused): Space play · ←/→ beat · Shift+←/→ bar · +/− zoom · L loop · 1–3 cues · M mute · Home/End preview start/end
   ========================================================================== */
(function () {
  const I = BF.icon, esc = BF.esc, E = () => BF.previewEngine;
  const ZOOM_BARS = [1, 2, 4, 8, 16, 32];
  const SEC_LABEL = { intro: "Intro", build: "Build-up", drop: "Drop", breakdown: "Breakdown", bass: "Bass section", outro: "Outro", silence: "Silence" };
  const S = { track: null, meta: null, win: null, overview: null, detail: null, mini: null, dWave: null, oWave: null, panel: null,
    zoomIdx: Number(localStorage.getItem("tb:deckZoom") ?? 2), mode: localStorage.getItem("tb:deckMode") || "3band", stereo: localStorage.getItem("tb:deckStereo") === "1",
    loop: null, hover: null, lastAnnounce: 0 };
  const announce = (msg) => { const l = BF.$("#live"); if (l) l.textContent = msg; };
  const fmt = (s) => BF.time(Math.max(0, s));
  const cuesFor = (m) => (m.gridReliable === false ? [] : m.cues).map((c) => ({ ...c, color: c.id === "A" ? "#ffcc33" : c.id === "B" ? "#ff5a5a" : "#3fd0ff" }));
  const beatP = () => (S.meta?.gridReliable !== false ? S.meta?.beatPeriod : null);
  const zoomSec = () => { const b = ZOOM_BARS[S.zoomIdx]; return beatP() ? b * 4 * beatP() : b * 2; };
  const state = (pos) => ({ pos, zoom: zoomSec(), loop: S.loop, cues: S.meta ? cuesFor(S.meta) : [], grid: S.meta?.gridReliable !== false, hover: S.hover });

  /* ---------- Data for the current track ---------- */
  async function load(track) {
    S.track = track; S.detail = null; S.loop = null;
    const { meta, overview } = await BF.trackAnalysis(track.id);
    if (S.track !== track) return;
    S.meta = meta; S.overview = overview; S.win = BF.previewWindow(meta, track);
    const data = { overview, meta, win: S.win };
    S.mini?.setData(data); S.oWave?.setData(data); S.dWave?.setData(data);
    paintPanel();
    // High-resolution waveform of the preview clip (worker); swaps in when ready
    BF.trackDetail(track.id).then((d) => {
      if (S.track !== track) return;
      S.detail = { levels: d.levels, offset: d.offset };
      const full = { overview, meta, win: S.win, detail: S.detail };
      S.dWave?.setData(full); S.oWave?.setData(full);
      const note = S.panel?.querySelector("[data-hires]"); if (note) note.hidden = true;
    }).catch(() => {});
  }

  /* ---------- Player bar ---------- */
  BF.deck = {
    /** Called by the player when a track is loaded. Returns HTML for the bar's waveform slot. */
    barHtml(track) {
      return `<div class="dj-mini" data-dj-mini data-track="${track.id}" role="slider" tabindex="0" aria-label="Seek within the preview of ${esc(track.kind === "track" ? BF.trackTitle(track) : track.title)}" aria-valuemin="0" aria-valuemax="${track.duration}" aria-valuenow="0">
        <canvas class="dj-canvas"></canvas></div>`;
    },
    mountBar(host, track) {
      S.mini?.destroy();
      const el = host.querySelector("[data-dj-mini]"); if (!el) return;
      S.mini = new BF.Wave(el.querySelector("canvas"), { kind: "overview", mode: S.mode });
      bindScrub(el, S.mini, "overview");
      load(track).catch(() => { el.innerHTML = `<span class="dj-mini-err">Waveform unavailable</span>`; });
    },
    tick(pos) {
      if (!S.meta) return;
      const st = state(pos);
      S.mini?.draw(st);
      if (S.panel && !S.panel.hidden) {
        S.oWave?.draw(st); S.dWave?.draw(st);
        const w = S.win;
        const q = (s) => S.panel.querySelector(s);
        q("[data-t-cur]").textContent = fmt(pos);
        q("[data-t-rem]").textContent = "−" + fmt(w.end - pos);
        q("[data-t-bar]").textContent = beatP() ? `Bar ${Math.floor((pos - (S.meta.firstDownbeat ?? 0)) / (beatP() * 4)) + 1} · Beat ${((Math.floor((pos - (S.meta.firstDownbeat ?? 0)) / beatP()) % 4) + 4) % 4 + 1}` : "—";
        const sec = S.meta.sections.find((s) => pos >= s.start && pos < s.end);
        q("[data-t-sec]").textContent = sec && S.meta.gridReliable !== false ? SEC_LABEL[sec.label] + (sec.vocal ? " · vocal" : "") : "";
        const ov = q("[data-dj-overview]"); ov?.setAttribute("aria-valuenow", Math.round(pos)); ov?.setAttribute("aria-valuetext", `${fmt(pos)} of ${fmt(S.meta.duration)}, preview ends ${fmt(w.end)}`);
      }
      const mini = BF.$("[data-dj-mini]"); if (mini) { mini.setAttribute("aria-valuenow", Math.round(pos)); mini.setAttribute("aria-valuetext", `${fmt(pos)}, preview ${fmt(S.win.start)} to ${fmt(S.win.end)}`); }
    },
    open: () => openPanel(),
    close: () => closePanel(),
    toggle: () => (S.panel && !S.panel.hidden ? closePanel() : openPanel()),
    get isOpen() { return !!S.panel && !S.panel.hidden; },
    state: () => ({ track: S.track?.id, meta: S.meta, win: S.win, zoomBars: ZOOM_BARS[S.zoomIdx], mode: S.mode, stereo: S.stereo, loop: S.loop, hasDetail: !!S.detail }),
  };

  /* ---------- Scrubbing (mouse/touch/pen) with accidental-seek protection ---------- */
  function bindScrub(el, wave, kind) {
    let drag = null;
    const tAt = (x) => {
      const r = el.getBoundingClientRect(), f = Math.max(0, Math.min(1, (x - r.left) / r.width));
      if (kind === "detail") return null;
      return f * (S.meta?.duration ?? 0);
    };
    const ensureCurrent = () => { if (BF.player.current()?.id !== S.track?.id) { BF.player.playBeat(S.track.id, null, 0.01); return false; } return true; };
    el.addEventListener("pointerdown", (e) => {
      if (!S.meta || e.button > 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: E().position(), started: e.pointerType === "mouse", type: e.pointerType };
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
      if (drag.started && kind === "overview") { ensureCurrent(); E().seek(tAt(e.clientX)); }
    });
    el.addEventListener("pointermove", (e) => {
      if (kind === "overview" && e.pointerType === "mouse") { S.hover = drag ? null : tAt(e.clientX); BF.deck.tick(E().position()); }
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      // Touch: only a clearly horizontal drag scrubs; vertical movement is page scrolling
      if (!drag.started) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) drag.started = true; else if (Math.abs(dy) > 10) { drag = null; return; } else return; }
      if (kind === "overview") E().seek(tAt(e.clientX));
      else { const r = el.getBoundingClientRect(); E().seek(drag.t0 - (dx / r.width) * zoomSec()); }   // jog: waveform follows the finger
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      // A tap (short, still) on the overview seeks there; the detail view needs a drag
      if (!drag.started && kind === "overview" && Math.hypot(dx, dy) < 8) { ensureCurrent(); E().seek(tAt(e.clientX)); }
      drag = null;
    };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", () => (drag = null));
    el.addEventListener("pointerleave", () => { S.hover = null; });
    el.addEventListener("keydown", (e) => keys(e, true));
  }

  /* ---------- Keyboard ---------- */
  function keys(e, fromSlider) {
    if (!S.meta || BF.player.current()?.id !== S.track?.id) return;
    if (e.key === " " && e.target.closest?.("button, a, input")) return;
    const p = beatP() ?? 1, pos = E().position();
    const k = e.key;
    let handled = true;
    if (k === "ArrowRight" || k === "ArrowLeft") { const step = (e.shiftKey ? 4 : 1) * p * (k === "ArrowRight" ? 1 : -1); E().seek(snap(pos + step)); }
    else if (k === "PageUp" || k === "PageDown") E().seek(pos + (k === "PageUp" ? 16 : -16) * p);
    else if (k === "Home") E().seek(S.win.start);
    else if (k === "End") E().seek(S.win.end - 1);
    else if (k === "+" || k === "=") zoom(-1);
    else if (k === "-" || k === "_") zoom(1);
    else if (k === "l" || k === "L") toggleLoop();
    else if (k === "m" || k === "M") toggleMute();
    else if (["1", "2", "3"].includes(k)) jumpCue(["A", "B", "C"][Number(k) - 1]);
    else if (k === " ") BF.player.toggleCurrent();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
    void fromSlider;
  }
  const snap = (t) => { const p = beatP(); if (!p) return t; const f = S.meta.firstDownbeat ?? S.meta.firstBeat; return f + Math.round((t - f) / p) * p; };
  function zoom(dir) {
    S.zoomIdx = Math.max(0, Math.min(ZOOM_BARS.length - 1, S.zoomIdx + dir));
    try { localStorage.setItem("tb:deckZoom", S.zoomIdx); } catch { /* ignore */ }
    const lbl = S.panel?.querySelector("[data-zoom-lbl]"); if (lbl) lbl.textContent = beatP() ? `${ZOOM_BARS[S.zoomIdx]} bar${ZOOM_BARS[S.zoomIdx] > 1 ? "s" : ""}` : `${ZOOM_BARS[S.zoomIdx] * 2}s`;
    announce(`Zoom ${lbl?.textContent ?? ""}`);
    BF.deck.tick(E().position());
  }
  function toggleLoop(bars) {
    if (S.loop && !bars) { S.loop = E().setLoop(null); announce("Loop off"); }
    else {
      const p = beatP();
      if (!p) { announce("Loops need a beat grid"); return; }
      const n = bars ?? 8, f = S.meta.firstDownbeat ?? 0, pos = E().position();
      const barStart = f + Math.floor((pos - f) / (p * 4)) * p * 4;
      let start = barStart, end = barStart + n * 4 * p;
      if (end > S.win.end) { end = f + Math.floor((S.win.end - f) / (p * 4)) * p * 4; start = end - n * 4 * p; }
      S.loop = E().setLoop({ start, end, bars: n });
      announce(`Looping ${n} bars from bar ${Math.round((start - f) / (p * 4)) + 1}`);
    }
    paintLoopButtons();
    BF.deck.tick(E().position());
  }
  function toggleMute() { const m = !E().muted; E().setMuted(m); announce(m ? "Muted" : "Sound on"); const b = BF.$('.player [data-p="mute"]'); if (b) { b.innerHTML = I(m ? "volume-x" : "volume", "i-sm"); b.setAttribute("aria-label", m ? "Unmute" : "Mute"); } }
  function jumpCue(id) {
    const c = cuesFor(S.meta).find((x) => x.id === id);
    if (!c) return;
    if (c.time < S.win.start || c.time > S.win.end) { announce(`Cue ${id} (${c.label}) is outside the preview`); BF.ui.toast({ kind: "info", title: `Cue ${id} · ${c.label} is outside the preview`, desc: `This preview covers ${fmt(S.win.start)}–${fmt(S.win.end)}. The full track is available after purchase.` }); return; }
    E().seek(c.time); announce(`Cue ${id}: ${c.label}`);
  }

  /* ---------- Deck panel ---------- */
  function openPanel() {
    const t = BF.player.current();
    if (!t || t.kind !== "track") return;
    if (!S.panel) buildPanel();
    S.panel.hidden = false;
    document.body.classList.add("deck-open");
    requestAnimationFrame(() => { S.oWave?.resize(); S.dWave?.resize(); paintPanel(); BF.deck.tick(E().position()); S.panel.querySelector("[data-dj-detail]")?.focus({ preventScroll: true }); });
    BF.$('.player [data-p="deck"]')?.setAttribute("aria-expanded", "true");
  }
  function closePanel() {
    if (!S.panel) return;
    S.panel.hidden = true;
    document.body.classList.remove("deck-open");
    BF.$('.player [data-p="deck"]')?.setAttribute("aria-expanded", "false");
  }
  function buildPanel() {
    const el = document.createElement("section");
    el.className = "deck"; el.id = "deck"; el.hidden = true;
    el.setAttribute("aria-label", "Track preview deck");
    el.innerHTML = `
      <div class="deck-inner">
        <header class="deck-head">
          <img class="deck-art" alt="" data-d-art>
          <div class="deck-title"><div class="deck-t1" data-d-title></div><div class="deck-t2" data-d-sub></div></div>
          <div class="deck-badges" data-d-badges></div>
          <button class="icon-btn" data-d="close" aria-label="Close deck">${I("chevron-down")}</button>
        </header>
        <div class="deck-wave">
          <div class="dj-detail" data-dj-detail role="slider" tabindex="0" aria-label="Zoomed waveform. Arrow keys move by beat, Shift+arrows by bar." aria-valuemin="0">
            <canvas class="dj-canvas"></canvas><span class="dj-hires" data-hires>Analysing preview audio…</span></div>
          <div class="dj-overview" data-dj-overview role="slider" tabindex="0" aria-label="Whole track. The bright window is the playable preview." aria-valuemin="0">
            <canvas class="dj-canvas"></canvas></div>
          <div class="dj-sections" data-d-sections aria-label="Track structure"></div>
        </div>
        <div class="deck-row">
          <div class="deck-times mono"><span data-t-cur>0:00</span><span class="deck-dim" data-t-rem>−0:00</span><span class="deck-dim" data-t-bar></span><span class="deck-sec" data-t-sec></span></div>
          <div class="deck-ctrls" role="group" aria-label="Deck controls">
            <button class="icon-btn" data-d="back" aria-label="Back one bar">${I("prev", "i-sm")}</button>
            <button class="play-btn" data-d="play" aria-label="Play">${I("play", "ic-play")}${I("pause", "ic-pause")}</button>
            <button class="icon-btn" data-d="fwd" aria-label="Forward one bar">${I("next", "i-sm")}</button>
            <span class="deck-sep"></span>
            <span class="deck-cues" data-d-cues></span>
            <span class="deck-sep"></span>
            <button class="deck-chip" data-d="loop" aria-pressed="false">${I("repeat", "i-xs")} Loop</button>
            <span class="deck-loopn" role="group" aria-label="Loop length">${[4, 8, 16].map((n) => `<button class="deck-chip sm" data-loopn="${n}" aria-pressed="false">${n}</button>`).join("")}</span>
            <span class="deck-sep"></span>
            <button class="icon-btn" data-d="zoomout" aria-label="Zoom out">${I("minus", "i-sm")}</button><span class="deck-zoom mono" data-zoom-lbl></span><button class="icon-btn" data-d="zoomin" aria-label="Zoom in">${I("plus", "i-sm")}</button>
            <span class="deck-sep"></span>
            <div class="deck-seg" role="group" aria-label="Waveform colouring"><button data-d="mode3" aria-pressed="${S.mode === "3band"}">3-Band</button><button data-d="modeb" aria-pressed="${S.mode !== "3band"}">Blend</button></div>
            <button class="deck-chip" data-d="stereo" aria-pressed="${S.stereo}">Stereo</button>
          </div>
        </div>
        <div class="deck-body">
          <dl class="deck-info" data-d-info></dl>
          <div class="deck-side">
            <div class="deck-actions" data-d-actions></div>
            <div class="deck-legend" aria-label="Waveform colour key">
              <span><i style="background:rgb(255,38,38)"></i><b>Low</b> Bass &amp; kick · 20–250 Hz</span>
              <span><i style="background:linear-gradient(90deg,rgb(48,214,92),rgb(250,222,44),rgb(255,138,22))"></i><b>Mid</b> Vocals &amp; synths · 250 Hz–4 kHz</span>
              <span><i style="background:rgb(48,130,255)"></i><b>High</b> Hats, cymbals &amp; snares · 4–20 kHz</span>
              <a href="#/electronic/player-lab">How these colours are measured →</a>
            </div>
            <p class="deck-note" data-d-note></p>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    S.panel = el;
    S.dWave = new BF.Wave(el.querySelector("[data-dj-detail] canvas"), { kind: "detail", mode: S.mode, stereo: S.stereo });
    S.oWave = new BF.Wave(el.querySelector("[data-dj-overview] canvas"), { kind: "overview", mode: S.mode });
    // The panel can be built after the track loaded: hand it the data already in hand
    if (S.meta) { const full = { overview: S.overview, meta: S.meta, win: S.win, detail: S.detail ?? undefined }; S.dWave.setData(full); S.oWave.setData(full); }
    bindScrub(el.querySelector("[data-dj-detail]"), S.dWave, "detail");
    bindScrub(el.querySelector("[data-dj-overview]"), S.oWave, "overview");
    el.querySelector("[data-dj-detail]").addEventListener("wheel", (e) => { if (!e.ctrlKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) { e.preventDefault(); zoom(e.deltaY > 0 ? 1 : -1); } else { e.preventDefault(); E().seek(E().position() + (e.deltaX / 400) * zoomSec()); } }, { passive: false });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePanel(); BF.$('.player [data-p="deck"]')?.focus(); } else if (!e.target.closest("button, input, a")) keys(e); });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-d]"); const k = b?.dataset.d;
      const p = beatP() ?? 2;
      if (k === "close") closePanel();
      if (e.target.closest("a[href]")) closePanel();
      if (k === "play") BF.player.toggleCurrent();
      if (k === "back") E().seek(snap(E().position() - 4 * p));
      if (k === "fwd") E().seek(snap(E().position() + 4 * p));
      if (k === "zoomin") zoom(-1); if (k === "zoomout") zoom(1);
      if (k === "loop") toggleLoop();
      if (k === "mode3" || k === "modeb") { S.mode = k === "mode3" ? "3band" : "blend"; try { localStorage.setItem("tb:deckMode", S.mode); } catch { /* ignore */ } [S.mini, S.oWave, S.dWave].forEach((w) => w?.setMode(S.mode)); el.querySelectorAll("[data-d=mode3],[data-d=modeb]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.d === k)); BF.deck.tick(E().position()); }
      if (k === "stereo") { S.stereo = !S.stereo; try { localStorage.setItem("tb:deckStereo", S.stereo ? "1" : "0"); } catch { /* ignore */ } S.dWave.setStereo(S.stereo); b.setAttribute("aria-pressed", S.stereo); announce(S.stereo ? "Stereo view: left channel above, right below" : "Mono view"); BF.deck.tick(E().position()); }
      const ln = e.target.closest("[data-loopn]"); if (ln) toggleLoop(Number(ln.dataset.loopn));
      const cue = e.target.closest("[data-cue]"); if (cue) jumpCue(cue.dataset.cue);
    });
    zoom(0);
  }
  function paintLoopButtons() {
    if (!S.panel) return;
    S.panel.querySelector("[data-d=loop]").setAttribute("aria-pressed", !!S.loop);
    S.panel.querySelectorAll("[data-loopn]").forEach((b) => b.setAttribute("aria-pressed", S.loop?.bars === Number(b.dataset.loopn)));
  }
  function paintPanel() {
    if (!S.panel || !S.track || !S.meta) return;
    const t = S.track, m = S.meta, rel = BF.releaseById[t.releaseId], label = rel.labelId ? BF.labelById[rel.labelId] : null;
    const q = (s) => S.panel.querySelector(s);
    q("[data-d-art]").src = t.art;
    q("[data-d-title]").innerHTML = `<a href="#/electronic/release/${rel.id}?t=${t.id}">${esc(t.title)}</a> <span class="deck-mix">${esc(t.mix || "Original Mix")}</span>`;
    q("[data-d-sub]").innerHTML = `${esc(BF.artistNames(t.artistIds))}${label ? ` · <a href="#/electronic/label/${label.id}">${esc(label.name)}</a>` : ""} · ${esc(rel.date)}`;
    const detected = m.gridReliable !== false ? m.bpm : null;
    q("[data-d-badges]").innerHTML = `<span class="deck-badge bpm" title="${detected ? `Detected ${detected} BPM (confidence ${Math.round(m.beatConfidence * 100)}%)` : "No reliable beat detected; label BPM shown"}"><b>${detected ?? t.bpm}</b> BPM</span>
      <span class="deck-badge key" title="Label key">${esc(t.key)} · <b>${esc(t.camelot)}</b></span><span class="deck-badge">${esc(BF.egenre(t.genre).name)}</span><span class="deck-badge">E${t.energy}</span>`;
    const w = S.win;
    q("[data-d-cues]").innerHTML = cuesFor(m).map((c) => `<button class="deck-cue" data-cue="${c.id}" style="--c:${c.color}" ${c.time < w.start || c.time > w.end ? 'aria-disabled="true"' : ""} title="${esc(c.label)} · ${fmt(c.time)}${c.time < w.start || c.time > w.end ? " (outside preview)" : ""}"><b>${c.id}</b> ${esc(c.label)}</button>`).join("") || `<span class="deck-dim">No cues</span>`;
    const dur = m.duration;
    q("[data-d-sections]").innerHTML = m.gridReliable === false ? `<span class="deck-dim">No clear beat: structure markers hidden</span>` : m.sections.filter((s) => s.label !== "silence").map((s) => `<span class="dj-sec s-${s.label}" style="left:${(s.start / dur) * 100}%;width:${((s.end - s.start) / dur) * 100}%" title="${SEC_LABEL[s.label]} · bars ${s.startBar + 1}–${s.startBar + s.bars}${s.vocal ? " · vocal" : ""}"><span>${SEC_LABEL[s.label]}${s.vocal ? " ♪" : ""}</span></span>`).join("");
    const owned = BF.store.ownsMusic("track", t.id);
    const fmts = rel.formats.join(" · ");
    const info = [
      ["Artist", esc(BF.artistNames(t.artistIds))], ["Title", esc(t.title)], ["Version", esc(t.mix || "Original Mix")], ["Label", label ? esc(label.name) : "Independent"],
      ["Release", `${esc(rel.title)} · ${esc(rel.date)}`], ["Genre", esc(BF.egenre(t.genre).name)],
      ["BPM", detected ? `${detected} <span class="deck-dim">(label ${t.bpm})</span>` : `${t.bpm} <span class="deck-dim">(label; no clear beat)</span>`],
      ["Key", `${esc(t.key)} · ${esc(t.camelot)}${m.key ? ` <span class="deck-dim">(analysis: ${esc(m.key.name)} · ${esc(m.key.camelot)})</span>` : ""}`],
      ["Energy", `${t.energy}/10`], ["Duration", fmt(dur)], ["Preview", `${fmt(w.length)} · ${fmt(w.start)}–${fmt(w.end)}`],
      ["Loudness", `${m.loudness.peakDb} dBFS peak · ${m.loudness.rmsDb} dB RMS`], ["Master", `${m.sampleRate / 1000} kHz stereo`],
      ["Preview audio", `Opus ${m.format.bitrate / 1000} kb/s · ${m.format.sampleRate / 1000} kHz`], ["Download formats", esc(fmts)],
      ["Plays", BF.fmtNum ? BF.fmtNum(BF.playCount(t)) : String(BF.playCount(t))],
      ["Tags", [m.sections.some((s) => s.vocal) ? "Vocal" : "Instrumental", t.energy >= 8 ? "Peak-time" : t.energy <= 4 ? "Warm-up" : "Groove", t.intro].map(esc).join(" · ")],
    ];
    q("[data-d-info]").innerHTML = info.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    const price = BF.money(BF.trackPrice(t, rel.formats[0]));
    q("[data-d-actions]").innerHTML = owned
      ? `<a class="btn btn-primary" href="#/electronic/library">${I("download", "i-sm")} Download (${esc(fmts)})</a>`
      : `<button class="btn btn-primary" data-action="add-music" data-kind="track" data-id="${t.id}">${I("bag-plus", "i-sm")} Buy track · ${price}</button>
         <button class="btn btn-secondary" data-action="add-music" data-kind="release" data-id="${rel.id}">${I("disc", "i-sm")} Buy release · ${BF.money(BF.releasePrice ? BF.releasePrice(rel) : rel.trackIds.reduce((s, id) => s + BF.trackPrice(BF.trackById[id], rel.formats[0]), 0))}</button>`;
    q("[data-d-actions]").insertAdjacentHTML("beforeend", `<div class="deck-actions-row">${BF.ui.favBtn(t.id, "btn btn-ghost btn-sm")}<button class="btn btn-ghost btn-sm" data-crate="${t.id}">${I("playlist", "i-sm")} Crate</button><button class="btn btn-ghost btn-sm" data-action="share" data-href="#/electronic/release/${rel.id}?t=${t.id}">${I("share", "i-sm")} Share</button></div>`);
    q("[data-d-actions]").querySelector("[data-crate]").onclick = () => BF.mui.openAddToCrate(t.id);
    q("[data-d-note]").textContent = w.clipEnd > w.end || w.start > 0 || w.end < dur
      ? `This preview plays ${fmt(w.start)}–${fmt(w.end)} of the track with a ${w.fadeIn}s fade-in and ${w.fadeOut.toFixed(1)}s fade-out. The full ${fmt(dur)} track downloads after purchase.`
      : "";
    q("[data-hires]").hidden = !!S.detail;
    paintLoopButtons();
  }
})();

/* ---------- Track waveforms across the store: canvas overviews from real analysis ---------- */
(function () {
  const esc = BF.esc;
  const waves = new WeakMap();
  // Every waveform in the stores is drawn from the item's analysed audio; items without audio show a placeholder
  BF.ui.waveform = (b, opts = {}) => (BF.hasAudio(b)
    ? `<div class="wf-canvas ${opts.cls || ""}" data-waveform="${b.id}" data-wf-track="${b.id}" role="slider" tabindex="0" aria-label="Preview waveform for ${esc(b.kind === "track" ? BF.trackTitle(b) : b.title)}" aria-valuemin="0" aria-valuemax="${b.duration}" aria-valuenow="0"><canvas class="dj-canvas"></canvas></div>`
    : `<div class="wf-canvas wf-missing ${opts.cls || ""}" aria-label="Preview unavailable"></div>`);
  function hydrate(el) {
    const id = el.dataset.wfTrack;
    const w = new BF.Wave(el.querySelector("canvas"), { kind: "overview", mode: localStorage.getItem("tb:deckMode") || "3band" });
    waves.set(el, w);
    BF.trackAnalysis(id).then(({ meta, overview }) => {
      w.setData({ overview, meta, win: BF.previewWindow(meta, BF.item(id)) });
      const cur = BF.player.current()?.id === id;
      w.draw({ pos: cur ? BF.previewEngine.position() : null, cues: [] });
    }).catch(() => el.classList.add("wf-missing"));
  }
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); hydrate(e.target); } }), { rootMargin: "300px" }) : null;
  const scan = () => BF.$$("[data-wf-track]:not([data-wf-obs])").forEach((el) => { el.dataset.wfObs = "1"; io ? io.observe(el) : hydrate(el); });
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  const baseTick = BF.deck.tick;
  BF.deck.tick = (pos) => {
    baseTick(pos);
    const id = BF.player.current()?.id;
    if (id) BF.$$(`[data-wf-track="${id}"]`).forEach((el) => waves.get(el)?.draw({ pos, cues: [] }));
  };
})();
