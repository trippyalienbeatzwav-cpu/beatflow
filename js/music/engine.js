/* ==========================================================================
   Preview engine and analysis loader (both stores).

   Every item with ready audio (item.audio from the server) plays its real preview clip. One <audio>
   element streams it and its currentTime is the ONLY clock: track position = clip zero + currentTime,
   where clip zero is the clip's start in the track minus any codec delay the browser doesn't strip.
   Fades, loop, preview end and every waveform playhead are derived from it on each animation frame.
   Web Audio (MediaElementSource → fade gain → volume gain) applies fades without touching the clock.

   Analysis: the full-track overview waveform + structure come from ingest (item.audio.analysis /
   .waveform). The zoomable high-resolution waveform is computed in a Worker from the decoded preview
   clip itself (lazy, cached in memory and IndexedDB). Items without ready audio can't be played; there
   is no synthesised stand-in.
   ========================================================================== */
(function () {
  /** Store-wide preview policy. Per-track windows come from ingest; the store can shorten and fade at runtime. */
  BF.PREVIEW_CONFIG = Object.assign({ maxLength: 90, fadeIn: 0.5, fadeOut: 3, startOffset: 0 }, JSON.parse(localStorage.getItem("tb:previewConfig") || "{}"));
  BF.setPreviewConfig = (c) => { Object.assign(BF.PREVIEW_CONFIG, c); try { localStorage.setItem("tb:previewConfig", JSON.stringify(BF.PREVIEW_CONFIG)); } catch { /* private mode */ } };

  /* ---------- Analysis data ---------- */
  const metaCache = new Map(), detailCache = new Map();
  const audioOf = (id) => { const a = BF.item(id)?.audio; return a && a.status === "ready" && a.preview ? a : null; };
  BF.hasAudio = (item) => !!(item && item.audio && item.audio.status === "ready" && item.audio.preview);
  BF.trackAnalysis = (id) => {
    if (!metaCache.has(id)) {
      metaCache.set(id, (async () => {
        const a = audioOf(id);
        if (!a) throw new Error("No analysed audio for " + id);
        const [meta, wf] = await Promise.all([
          fetch(a.analysis).then((r) => { if (!r.ok) throw new Error("No analysis for " + id); return r.json(); }),
          fetch(a.waveform).then((r) => { if (!r.ok) throw new Error("No waveform for " + id); return r.arrayBuffer(); }),
        ]);
        const { level } = TBDSP.decodeLevel(wf);
        return { meta: { ...meta, previewUrl: a.preview }, overview: level };
      })().catch((err) => { metaCache.delete(id); throw err; }));
    }
    return metaCache.get(id);
  };
  /** Where sample 0 of the preview file sits in track time (clip start minus codec delay the browser keeps). */
  const clipZero = (meta) => meta.preview.start - (meta.format?.clockOffset ?? 0);
  BF.previewWindow = (meta, item) => {
    // The clip was cut at ingest. For club tracks the store can start later inside it, shorten it and change fades;
    // beats and pack demos play their whole clip (artists judge the full instrumental).
    const cfg = BF.PREVIEW_CONFIG, p = meta.preview, full = item && item.kind !== "track";
    const start = full ? p.start : Math.min(p.start + Math.max(0, cfg.startOffset || 0), p.end - 10);
    const end = full ? p.end : Math.min(p.end, start + (cfg.maxLength || 90));
    return { start, end, clipStart: clipZero(meta), clipEnd: p.end, fadeIn: full ? p.fadeIn : cfg.fadeIn ?? p.fadeIn, fadeOut: Math.min(full ? p.fadeOut : cfg.fadeOut ?? p.fadeOut, (end - start) / 3), length: end - start };
  };

  // IndexedDB cache for worker results (key: track id + clip size) so revisits skip analysis
  const idb = (() => {
    let dbp = null;
    const open = () => (dbp ??= new Promise((res, rej) => { const r = indexedDB.open("tb-waveforms", 1); r.onupgradeneeded = () => r.result.createObjectStore("detail"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const tx = async (mode, fn) => { try { const db = await open(); return await new Promise((res, rej) => { const t = db.transaction("detail", mode); const q = fn(t.objectStore("detail")); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); } catch { return undefined; } };
    return { get: (k) => tx("readonly", (s) => s.get(k)), put: (k, v) => tx("readwrite", (s) => s.put(v, k)) };
  })();
  let worker = null, jobId = 0;
  const pending = new Map();
  function analyseInWorker(channels, sr, opts) {
    worker ??= Object.assign(new Worker("js/music/analyzer.worker.js"), { onmessage: (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result); } });
    const id = ++jobId;
    return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, channels, sr, opts }, channels.map((c) => c.buffer)); });
  }
  let decodeCtx = null;
  /** High-resolution analysis of the preview clip (the audio people actually hear). */
  BF.trackDetail = (id) => {
    if (!detailCache.has(id)) {
      detailCache.set(id, (async () => {
        const { meta } = await BF.trackAnalysis(id);
        const bytes = await (await fetch(meta.previewUrl)).arrayBuffer();
        const key = `${id}:${bytes.byteLength}:v2`;
        const cached = await idb.get(key);
        if (cached) return cached;
        decodeCtx ??= new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 48000, 48000);
        const buf = await decodeCtx.decodeAudioData(bytes);
        const ch = [new Float32Array(buf.getChannelData(0)), new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0))];
        const res = await analyseInWorker(ch, buf.sampleRate, { hop: 256, offset: clipZero(meta), bpmRange: null });
        idb.put(key, res);
        return res;
      })().catch((err) => { detailCache.delete(id); throw err; }));
    }
    return detailCache.get(id);
  };
  BF.analyseFile = (channels, sr) => analyseInWorker(channels, sr, { hop: 256, offset: 0, full: true });

  /* ---------- Play counts: a listen of 5 s or more is reported; the server de-duplicates and counts it ---------- */
  BF.playCount = (t) => t.plays ?? 0;
  const countPlay = (item) => {
    BF.http.post("/api/store/plays", { kind: item.kind, id: item.id }).then((r) => { if (r.counted) item.plays = (item.plays ?? 0) + 1; }).catch(() => {});
    if (item.kind === "track") BF.store.pushRecent(item.id);
  };

  /* ---------- Engine ---------- */
  const E = {
    track: null, meta: null, win: null, el: null, ac: null, fade: null, vol: null,
    volume: 0.8, muted: false, loop: null, raf: 0, counted: false, listenedFrom: 0, error: null,
    onTick: null, onEnded: null, onState: null,
  };
  function ensureElement() {
    if (E.el) return E.el;
    const el = new Audio(); el.preload = "auto"; el.crossOrigin = "anonymous";
    el.addEventListener("ended", () => { stopLoop(); E.onEnded?.(); });
    el.addEventListener("waiting", () => E.onState?.("buffering"));
    el.addEventListener("playing", () => E.onState?.("playing"));
    el.addEventListener("pause", () => E.onState?.("paused"));
    el.addEventListener("error", () => { E.error = el.error; E.onState?.("error"); });
    E.el = el;
    return el;
  }
  function ensureGraph() {
    if (E.ac || !(window.AudioContext || window.webkitAudioContext)) return;
    try {
      E.ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = E.ac.createMediaElementSource(E.el);
      E.fade = E.ac.createGain(); E.vol = E.ac.createGain();
      src.connect(E.fade).connect(E.vol).connect(E.ac.destination);
      applyVolume();
    } catch { E.ac = null; }
  }
  // Audio time 0 is the first sample of the clip file (clipStart in track time)
  const trackPos = () => (E.win ? E.win.clipStart + (E.el?.currentTime ?? 0) : 0);
  const toClip = (t) => t - E.win.clipStart;
  function fadeGainAt(t) {
    const w = E.win; if (!w) return 1;
    return Math.max(0, Math.min(1, w.fadeIn > 0 ? (t - w.start) / w.fadeIn : 1, w.fadeOut > 0 ? (w.end - t) / w.fadeOut : 1));
  }
  function applyVolume() {
    const v = E.muted ? 0 : E.volume * E.volume;
    if (E.vol) E.vol.gain.setTargetAtTime(v, E.ac.currentTime, 0.015); else if (E.el) E.el.volume = Math.min(1, v);
  }
  function frame() {
    E.raf = requestAnimationFrame(frame);
    const t = trackPos();
    // Loop and preview end are enforced against the audio clock
    if (E.loop && t >= E.loop.end - 0.004) { E.el.currentTime = toClip(E.loop.start); }
    else if (t >= E.win.end) { E.el.pause(); E.el.currentTime = toClip(E.win.end); stopLoop(); E.onTick?.(E.win.end); E.onEnded?.(); return; }
    const g = fadeGainAt(t);
    if (E.fade) E.fade.gain.setTargetAtTime(g, E.ac.currentTime, 0.01); else if (E.el) E.el.volume = Math.min(1, (E.muted ? 0 : E.volume * E.volume) * g);
    if (!E.counted && t - E.listenedFrom > 5) { E.counted = true; countPlay(E.track); }
    E.onTick?.(t);
  }
  const startLoop = () => { cancelAnimationFrame(E.raf); E.raf = requestAnimationFrame(frame); };
  function stopLoop() { cancelAnimationFrame(E.raf); E.raf = 0; }

  BF.previewEngine = {
    get beat() { return E.track; }, get track() { return E.track; }, get meta() { return E.meta; }, get window() { return E.win; },
    get playing() { return !!E.el && !E.el.paused && !E.el.ended; },
    get element() { return E.el; },
    set onTick(fn) { E.onTick = fn; }, set onEnded(fn) { E.onEnded = fn; }, set onState(fn) { E.onState = fn; },
    get loop() { return E.loop; },
    /** Prepare a track. `at` is a track-time position (seconds in the full track). */
    async load(track, at = 0) {
      const el = ensureElement();
      const same = E.track?.id === track.id;
      if (!same) { el.pause(); stopLoop(); E.loop = null; E.counted = false; }
      E.track = track;
      const { meta } = await BF.trackAnalysis(track.id);
      if (E.track !== track) return false;
      E.meta = meta; E.win = BF.previewWindow(meta, track);
      if (!same) { el.src = meta.previewUrl; el.load(); }
      this.seek(at || E.win.start, true);
      return true;
    },
    async play() {
      if (!E.track) return;
      ensureElement(); ensureGraph();
      if (E.ac?.state === "suspended") await E.ac.resume();
      if (trackPos() >= E.win.end - 0.05 || trackPos() < E.win.start) E.el.currentTime = toClip(E.win.start);
      E.listenedFrom = trackPos();
      try { await E.el.play(); } catch (err) { E.onState?.("blocked"); throw err; }
      applyVolume(); startLoop();
    },
    pause() { E.el?.pause(); stopLoop(); E.onTick?.(trackPos()); },
    toggle() { return this.playing ? (this.pause(), false) : (this.play(), true); },
    /** Seek to track time; clamps to the preview window. Returns the time actually used. */
    seek(t, silent = false) {
      if (!E.win || !E.el) return 0;
      const c = Math.max(E.win.start, Math.min(E.win.end - 0.05, t));
      E.el.currentTime = toClip(c);
      if (!silent) E.onTick?.(c);
      return c;
    },
    position() { return trackPos(); },
    setVolume(v) { E.volume = v; E.muted = v === 0 ? E.muted : false; applyVolume(); },
    setMuted(m) { E.muted = m; applyVolume(); },
    get muted() { return E.muted; },
    setLoop(loop) { E.loop = loop && E.win ? { start: Math.max(E.win.start, loop.start), end: Math.min(E.win.end, loop.end), bars: loop.bars } : null; return E.loop; },
    fadeGainAt,
  };

  /* ---------- Transport: every playable item goes through the preview engine ---------- */
  const handlers = { onTick: null, onEnded: null };
  BF.transport = {
    get beat() { return BF.previewEngine.track; }, get playing() { return BF.previewEngine.playing; },
    get engine() { return "preview"; },
    set onTick(fn) { handlers.onTick = fn; BF.previewEngine.onTick = fn; },
    set onEnded(fn) { handlers.onEnded = fn; BF.previewEngine.onEnded = fn; },
    load(b, at = 0) {
      if (!BF.hasAudio(b)) { BF.previewEngine.pause(); this._loading = Promise.reject(Object.assign(new Error("This preview isn’t available yet."), { code: "no_audio" })); this._loading.catch(() => {}); return this._loading; }
      this._loading = BF.previewEngine.load(b, at);
      return this._loading;
    },
    async play() { await this._loading; return BF.previewEngine.play(); },
    pause() { BF.previewEngine.pause(); },
    toggle() { return BF.previewEngine.toggle(); },
    seek(s) { return BF.previewEngine.seek(s); },
    position() { return BF.previewEngine.position(); },
    setVolume(v) { BF.previewEngine.setVolume(v); },
  };
})();
