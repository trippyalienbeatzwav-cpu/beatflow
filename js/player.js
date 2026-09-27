/* ==========================================================================
   Global player — persistent across routes and shared by both marketplaces
   (beats and electronic tracks). Owns the queue, renders the bottom bar /
   mobile mini-player / full-screen sheet, and keeps every on-page play button
   and waveform in sync with the transport.
   ========================================================================== */
(function () {
  const I = BF.icon;
  // Every item plays its real, analysed preview clip through BF.previewEngine (js/music/engine.js)
  const A = BF.transport;
  const S = { queue: [], index: -1, repeat: false, shuffle: false, muted: false };
  let root, rafPending = false;

  const cur = () => (S.index >= 0 ? BF.item(S.queue[S.index]) : null);
  const isTrack = (b) => b && b.kind === "track";

  /** Display metadata for any playable item. */
  function meta(b) {
    if (isTrack(b)) {
      const a = BF.eartistById[b.artistIds[0]];
      const fmt = BF.store.get("dlFormat");
      const rel = BF.releaseById[b.releaseId];
      return {
        title: BF.trackTitle(b), href: `#/electronic/release/${b.releaseId}?t=${b.id}`, name: BF.artistNames(b.artistIds), nameHref: `#/electronic/artist/${a.handle}`, verified: a.verified,
        spec: `<span class="spec"><span class="hl">${b.bpm} BPM</span><span>${b.key} · ${b.camelot}</span><span>E${b.energy}</span><span>${BF.egenre(b.genre).name}</span></span>`,
        owned: BF.store.ownsMusic("track", b.id) || BF.store.ownsMusic("release", b.releaseId),
        price: "Buy track · " + BF.money(BF.trackPrice(b, rel.formats.includes(fmt) ? fmt : rel.formats[0])),
        buy: BF.isPack(rel) ? `data-action="add-music" data-kind="release" data-id="${rel.id}"` : `data-action="add-music" data-kind="track" data-id="${b.id}"`,
      };
    }
    const p = BF.producerOf(b);
    if (b.kind === "pack") {
      return {
        title: b.title, href: `#/beats/pack/${b.id}`, name: p.name, nameHref: `#/beats/producer/${p.handle}`, verified: p.verified,
        spec: `<span class="spec"><span class="hl">${BF.PACK_TYPES[b.type]}</span><span>${b.bpm} BPM</span><span>${b.key}</span></span>`,
        owned: BF.store.ownsPack(b.id), price: "Buy pack · " + BF.money(b.price), buy: `data-action="add-pack" data-id="${b.id}"`,
      };
    }
    return {
      title: b.title, href: `#/beats/beat/${b.id}`, name: p.name, nameHref: `#/beats/producer/${p.handle}`, verified: p.verified,
      spec: BF.ui.spec(b, { dur: false, genre: true }), owned: BF.store.ownsBeat(b.id), price: "License from " + BF.money(BF.basePrice(b)), buy: `data-action="license" data-beat="${b.id}"`,
    };
  }
  BF.playMeta = meta;

  function render() {
    root = BF.$("#player");
    root.innerHTML = `
      <div class="player-progress-top" aria-hidden="true"><span></span></div>
      <div class="p-now">
        <button class="art" data-p="expand" aria-label="Open now playing"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></button>
        <div class="meta">
          <div class="p-title"><span class="p-store" data-p="store"></span><a class="truncate" data-p="title" href="#"></a><span class="eq paused" aria-hidden="true"><span></span><span></span><span></span></span></div>
          <a class="p-producer" data-p="producer" href="#"></a>
          <span data-p="spec"></span>
        </div>
        <span class="hide-md" data-p="fav"></span>
      </div>
      <div class="p-center">
        <div class="p-controls">
          <button class="icon-btn hide-mobile" data-p="shuffle" aria-label="Shuffle" aria-pressed="false" data-tip="Shuffle">${I("shuffle", "i-sm")}</button>
          <button class="icon-btn hide-mobile" data-p="prev" aria-label="Previous" data-tip="Previous">${I("prev", "i-sm")}</button>
          <button class="play-btn" data-p="toggle" aria-label="Play">${I("play", "ic-play")}${I("pause", "ic-pause")}</button>
          <button class="icon-btn" data-p="next" aria-label="Next" data-tip="Next">${I("next", "i-sm")}</button>
          <button class="icon-btn hide-mobile" data-p="repeat" aria-label="Repeat" aria-pressed="false" data-tip="Repeat">${I("repeat", "i-sm")}</button>
          <button class="p-djmode hide-mobile" data-p="djmode" hidden></button>
          <button class="p-deckbtn" data-p="deck" hidden aria-expanded="false" aria-controls="deck" aria-label="Open the preview deck">${I("wave", "i-sm")}<span class="hide-sm">Deck</span></button>
        </div>
        <div class="p-scrub">
          <span class="t" data-p="cur">0:00</span>
          <div data-p="wave" style="flex:1;min-width:0"></div>
          <span class="t" data-p="dur">0:00</span>
        </div>
      </div>
      <div class="p-right">
        <button class="btn btn-sm btn-primary p-lic" data-p="buy">${I("bag-plus", "i-xs")}<span data-p="price">—</span></button>
        <button class="icon-btn hide-md" data-p="crate" aria-label="Add to playlist" data-tip="Add to playlist" hidden>${I("playlist", "i-sm")}</button>
        <button class="icon-btn hide-md" data-p="queue" aria-label="Open queue" data-tip="Queue">${I("queue", "i-sm")}</button>
        <div class="p-vol">
          <button class="icon-btn sm" data-p="mute" aria-label="Mute">${I("volume", "i-sm")}</button>
          <input type="range" class="range" data-p="vol" min="0" max="1" step="0.01" aria-label="Volume">
        </div>
      </div>`;
    root.classList.add("is-empty");
    const vol = root.querySelector("[data-p=vol]");
    vol.value = BF.store.get("volume");
    vol.style.setProperty("--val", vol.value * 100 + "%");
    document.addEventListener("pointerdown", () => A.setVolume(S.muted ? 0 : +vol.value), { once: true });

    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-p]"); if (!b) return;
      const k = b.dataset.p;
      if (k === "toggle") toggle();
      if (k === "next") next(true);
      if (k === "prev") prev();
      if (k === "repeat") { S.repeat = !S.repeat; b.setAttribute("aria-pressed", S.repeat); }
      if (k === "shuffle") { S.shuffle = !S.shuffle; b.setAttribute("aria-pressed", S.shuffle); }
      if (k === "queue") openQueue();
      if (k === "crate" && cur()) BF.mui.openAddToCrate(cur().id);
      if (k === "djmode") { BF.store.set("previewMode", BF.store.get("previewMode") === "drop" ? "start" : "drop"); paintDjMode(); }
      if (k === "buy") {
        e.preventDefault(); const c = cur(); if (!c) return;
        if (c.kind === "pack") return BF.beatsUI.addPack(c.id);
        if (!isTrack(c)) return BF.ui.openLicensePicker(c.id);
        if (meta(c).owned) { location.hash = "#/electronic/library"; return; }
        const rel = BF.releaseById[c.releaseId];
        BF.isPack(rel) ? BF.mui.addMusic("release", rel.id) : BF.mui.addMusic("track", c.id);
      }
      if (k === "deck") BF.deck?.toggle();
      if (k === "mute") { S.muted = !S.muted; A.setVolume(S.muted ? 0 : +vol.value); b.innerHTML = I(S.muted ? "volume-x" : "volume", "i-sm"); b.setAttribute("aria-label", S.muted ? "Unmute" : "Mute"); }
      if (k === "expand") { if (window.matchMedia("(max-width: 860px)").matches) openSheet(); else if (cur()) location.hash = meta(cur()).href; }
    });
    root.querySelector(".p-now .meta").addEventListener("click", (e) => {
      if (window.matchMedia("(max-width: 860px)").matches) { e.preventDefault(); openSheet(); }
    });
    vol.addEventListener("input", () => {
      vol.style.setProperty("--val", vol.value * 100 + "%");
      S.muted = false; A.setVolume(+vol.value); BF.store.set("volume", +vol.value);
    });
  }

  function paintDjMode() {
    const b = root.querySelector("[data-p=djmode]"); const c = cur();
    b.hidden = !isTrack(c);
    const drop = BF.store.get("previewMode") === "drop";
    b.innerHTML = `<span class="mono">DJ</span> ${drop ? "From drop" : "From start"}`;
    b.setAttribute("aria-label", `DJ preview: starts ${drop ? "at the drop" : "from the intro"}. Toggle.`);
    b.setAttribute("aria-pressed", drop);
  }

  function paintMeta() {
    const b = cur(); if (!b) return;
    const m = meta(b);
    root.classList.remove("is-empty");
    root.classList.toggle("is-track", isTrack(b));
    const store = root.querySelector("[data-p=store]"); store.textContent = isTrack(b) ? "Electronic" : "Beats"; store.dataset.m = isTrack(b) ? "electronic" : "beats";
    document.body.classList.remove("no-player");
    root.querySelector(".p-now .art img").src = b.art;
    const t = root.querySelector("[data-p=title]"); t.textContent = m.title; t.href = m.href;
    const pr = root.querySelector("[data-p=producer]"); pr.innerHTML = `${BF.esc(m.name)}${m.verified ? BF.verifiedSeal() : ""}`; pr.href = m.nameHref;
    root.querySelector("[data-p=spec]").innerHTML = m.spec;
    root.querySelector("[data-p=fav]").innerHTML = BF.ui.favBtn(b.id, "icon-btn");
    const wave = root.querySelector("[data-p=wave]");
    if (BF.hasAudio(b) && BF.deck) { wave.innerHTML = BF.deck.barHtml(b); BF.deck.mountBar(wave, b); }
    else wave.innerHTML = `<div class="dj-mini dj-mini-err">Preview unavailable</div>`;
    root.querySelector("[data-p=deck]").hidden = !isTrack(b);
    if (!isTrack(b)) BF.deck?.close();
    root.querySelector("[data-p=dur]").textContent = BF.time(b.duration);
    root.querySelector("[data-p=price]").textContent = m.owned ? (isTrack(b) ? "Owned · Download" : "Owned · Library") : m.price;
    root.querySelector("[data-p=crate]").hidden = !isTrack(b);
    paintDjMode();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: m.title, artist: m.name, album: BF.brand.name, artwork: [{ src: b.art, sizes: "512x512", type: "image/svg+xml" }] });
    }
  }

  /** Sync every play button / card / waveform on the page to the transport state. */
  function sync() {
    const b = cur(); const playing = A.playing;
    BF.$$('[data-action="play"], .player [data-p="toggle"], .player-sheet [data-s="toggle"]').forEach((btn) => {
      const isCur = btn.dataset.beat ? b && btn.dataset.beat === b.id : !!b;
      const on = isCur && playing;
      btn.classList.toggle("is-playing", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const it = btn.dataset.beat ? BF.item(btn.dataset.beat) : b;
      const title = it ? (isTrack(it) ? BF.trackTitle(it) : it.title) : "";
      btn.setAttribute("aria-label", `${on ? "Pause" : "Play"} ${title}`.trim());
      btn.querySelectorAll(".ic-play").forEach((i) => (i.style.display = on ? "none" : ""));
      btn.querySelectorAll(".ic-pause").forEach((i) => (i.style.display = on ? "block" : "none"));
    });
    BF.$$("[data-beat-card]").forEach((c) => c.classList.toggle("is-current", !!b && c.dataset.beatCard === b.id));
    BF.$$(".eq").forEach((e) => e.classList.toggle("paused", !playing));
    tick(A.position());
  }

  function tick(pos) {
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const b = cur(); if (!b) return;
      const frac = Math.min(1, pos / b.duration);
      const c = root.querySelector("[data-p=cur]"); if (c) c.textContent = BF.time(pos);
      const top = root.querySelector(".player-progress-top span"); if (top) top.style.width = frac * 100 + "%";
      BF.$$(`[data-waveform="${b.id}"]`).forEach((w) => paintWave(w, frac, pos, b));
      if (BF.hasAudio(b)) BF.deck?.tick(pos);
      const st = BF.$(".player-sheet [data-s=cur]"); if (st) st.textContent = BF.time(pos);
      if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
        try { navigator.mediaSession.setPositionState({ duration: b.duration, position: Math.min(pos, b.duration), playbackRate: 1 }); } catch {}
      }
    });
  }
  function paintWave(w, frac, pos, b) {
    const bars = w.querySelectorAll(".bar"); const n = bars.length; const cut = Math.floor(frac * n);
    for (let i = 0; i < n; i++) bars[i].classList.toggle("played", i < cut);
    const head = w.querySelector(".wf-head"); if (head) head.style.left = frac * 100 + "%";
    w.setAttribute("aria-valuenow", Math.floor(pos));
    w.setAttribute("aria-valuetext", `${BF.time(pos)} of ${BF.time(b.duration)}`);
  }

  /* ---------- Transport ---------- */
  async function start(at = 0, fromUser = true) {
    const b = cur(); if (!b) return;
    // DJ-friendly preview: electronic tracks can start at the drop instead of the intro
    try { await A.load(b, at); }
    catch (err) { paintMeta(); sync(); BF.ui.toast({ kind: "info", title: "Preview unavailable", desc: BF.esc(err.code === "no_audio" ? "The audio for this item is still being processed." : err.message) }); return; }
    paintMeta();
    // "From drop": jump to the analysed drop cue when it lies inside the preview
    if (isTrack(b) && A.engine === "preview" && fromUser && at === 0 && BF.store.get("previewMode") === "drop") { const c = BF.previewEngine.meta?.cues?.find((x) => x.id === "B"); if (c) A.seek(c.time); }
    try { await A.play(); } catch { BF.ui.toast({ kind: "info", title: "Press play to start the preview", desc: "Your browser blocked autoplay." }); }
    A.setVolume(S.muted ? 0 : BF.store.get("volume"));
    sync();
  }
  function toggle() { if (!cur()) return; A.toggle(); setTimeout(sync, 0); }
  function next(manual) {
    if (!S.queue.length) return;
    if (S.shuffle) S.index = Math.floor(Math.random() * S.queue.length);
    else if (S.index < S.queue.length - 1) S.index++;
    else if (S.repeat || manual) S.index = 0;
    else { A.pause(); sync(); return; }
    start(0);
  }
  function prev() {
    if (A.position() > 3) { A.seek(0); return; }
    S.index = Math.max(0, S.index - 1); start(0);
  }

  A.onTick = tick;
  A.onEnded = () => { if (S.repeat && !S.shuffle && S.queue.length === 1) start(0); else next(false); };

  /* ---------- Waveform scrubbing (any waveform on the page) ---------- */
  function bindWaveforms() {
    let dragging = null;
    const fracAt = (w, x) => { const r = w.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)); };
    let touch = null;
    const seekTo = (w, x) => {
      const id = w.dataset.waveform; const b = BF.item(id); if (!b) return;
      const f = fracAt(w, x);
      if (cur()?.id === id) A.seek(f * b.duration);
      else BF.player.playBeat(id, null, Math.max(0.01, f * b.duration));
    };
    document.addEventListener("pointerdown", (e) => {
      const w = e.target.closest?.("[data-waveform]"); if (!w) return;
      // Touch/pen: never seek on contact (the page may be scrolling); a still tap seeks on release
      if (e.pointerType !== "mouse") { touch = { w, x: e.clientX, y: e.clientY }; return; }
      seekTo(w, e.clientX);
      dragging = w; w.setPointerCapture?.(e.pointerId);
    });
    document.addEventListener("pointerup", (e) => {
      if (touch && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) < 8) seekTo(touch.w, e.clientX);
      touch = null;
    });
    document.addEventListener("pointercancel", () => (touch = null));
    document.addEventListener("pointermove", (e) => {
      const w = e.target.closest?.("[data-waveform]");
      if (w && !w.dataset.wfTrack) { const bars = w.querySelectorAll(".bar"); const h = Math.floor(fracAt(w, e.clientX) * bars.length); bars.forEach((bar, i) => bar.classList.toggle("hovered", i < h)); }
      if (dragging && cur()) A.seek(fracAt(dragging, e.clientX) * cur().duration);
    });
    document.addEventListener("pointerup", () => (dragging = null));
    document.addEventListener("pointerleave", (e) => e.target.closest?.("[data-waveform]") && BF.$$(".bar.hovered", e.target).forEach((b) => b.classList.remove("hovered")), true);
    document.addEventListener("keydown", (e) => {
      const w = e.target.closest?.("[data-waveform]"); if (!w) return;
      const b = BF.item(w.dataset.waveform); if (!b) return;
      const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 15, PageDown: -15 }[e.key];
      if (step == null && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const base = cur()?.id === b.id ? A.position() : 0;
      const target = e.key === "Home" ? 0 : e.key === "End" ? b.duration - 1 : base + step;
      if (cur()?.id === b.id) A.seek(target); else BF.player.playBeat(b.id, null, Math.max(0.01, target));
    });
  }

  /* ---------- Queue drawer ---------- */
  function openQueue() {
    const row = (id, i) => { const b = BF.item(id); const m = meta(b); return `<div class="queue-item ${i === S.index ? "is-current" : ""}"><div class="art sm"><img src="${b.art}" alt=""></div><div class="meta"><div class="truncate" style="font-weight:600;font-size:14px">${BF.esc(m.title)}</div><div class="subtle truncate" style="font-size:12.5px">${BF.esc(m.name)} · ${b.bpm} BPM${isTrack(b) ? ` · ${b.camelot}` : ""}</div></div>${i === S.index ? `<span class="eq ${A.playing ? "" : "paused"}" style="color:var(--accent-text)"><span></span><span></span><span></span></span>` : `<button class="icon-btn sm" data-q-play="${i}" aria-label="Play ${BF.esc(m.title)}">${I("play", "i-sm")}</button><button class="icon-btn sm" data-q-rm="${i}" aria-label="Remove ${BF.esc(m.title)} from queue">${I("x", "i-sm")}</button>`}</div>`; };
    const body = () => S.queue.length ? `<p class="eyebrow no-rule" style="margin-bottom:8px">Now playing</p>${row(S.queue[S.index], S.index)}<p class="eyebrow no-rule" style="margin:20px 0 8px">Up next · ${S.queue.length - S.index - 1}</p>${S.queue.map((id, i) => (i > S.index ? row(id, i) : "")).join("") || `<p class="subtle" style="font-size:14px;padding:8px">Nothing queued. Add tracks from any list with “Add to queue”.</p>`}` : BF.ui.empty({ icon: "queue", title: "Queue is empty", body: "Press play on any beat or track to start listening." });
    BF.ui.drawer({
      title: "Queue", body: body(),
      foot: `<button class="btn btn-ghost btn-block" data-q-clear>Clear up next</button>`,
      onMount(el) {
        el.addEventListener("click", (e) => {
          const p = e.target.closest("[data-q-play]"), rm = e.target.closest("[data-q-rm]");
          if (p) { S.index = +p.dataset.qPlay; start(0); }
          if (rm) { S.queue.splice(+rm.dataset.qRm, 1); }
          if (e.target.closest("[data-q-clear]")) S.queue = S.queue.slice(0, S.index + 1);
          if (p || rm || e.target.closest("[data-q-clear]")) el.querySelector(".drawer-body").innerHTML = body();
        });
      },
    });
  }

  /* ---------- Mobile full-screen sheet ---------- */
  function openSheet() {
    const b = cur(); if (!b) return;
    const m = meta(b);
    const el = document.createElement("div");
    el.className = "player-sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Now playing");
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between"><button class="icon-btn" data-s="close" aria-label="Minimize player">${I("chevron-down")}</button><span class="eyebrow no-rule">Now playing</span><button class="icon-btn" data-s="queue" aria-label="Open queue">${I("queue")}</button></div>
      <div class="sheet-art"><img src="${b.art}" alt="Artwork for ${BF.esc(m.title)}"></div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="min-width:0"><a href="${m.href}" data-s="close" class="h2 truncate" style="display:block">${BF.esc(m.title)}</a><a href="${m.nameHref}" data-s="close" class="muted" style="display:inline-flex;gap:4px;align-items:center">${BF.esc(m.name)}${m.verified ? BF.verifiedSeal() : ""}</a><div style="margin-top:6px">${m.spec}</div></div>
        <div style="display:flex">${isTrack(b) ? `<button class="icon-btn" data-s="crate" aria-label="Add to playlist">${I("playlist")}</button>` : ""}${BF.ui.favBtn(b.id)}</div>
      </div>
      <div style="margin:22px 0 6px">${BF.ui.waveform(b, { bars: 64, markers: isTrack(b) })}</div>
      <div style="display:flex;justify-content:space-between" class="mono subtle"><span data-s="cur" style="font-size:12px">0:00</span><span style="font-size:12px">${BF.time(b.duration)}</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 26px">
        <button class="icon-btn" data-s="shuffle" aria-label="Shuffle" aria-pressed="${S.shuffle}">${I("shuffle")}</button>
        <button class="icon-btn" data-s="prev" aria-label="Previous">${I("prev", "i-lg")}</button>
        <button class="play-btn xl" data-s="toggle" aria-label="Play">${I("play", "ic-play")}${I("pause", "ic-pause")}</button>
        <button class="icon-btn" data-s="next" aria-label="Next">${I("next", "i-lg")}</button>
        <button class="icon-btn" data-s="repeat" aria-label="Repeat" aria-pressed="${S.repeat}">${I("repeat")}</button>
      </div>
      <button class="btn btn-primary btn-lg btn-block" ${m.buy}>${I("bag-plus", "i-sm")} ${m.price}</button>`;
    document.body.appendChild(el); document.body.style.overflow = "hidden";
    let release;
    const close = () => { release && release(); el.remove(); if (!BF.$(".modal-backdrop, .drawer")) document.body.style.overflow = ""; };
    release = BF.trap(el, close);
    el.addEventListener("click", (e) => {
      const k = e.target.closest("[data-s]")?.dataset.s; if (!k) return;
      if (k === "close") close();
      if (k === "toggle") toggle();
      if (k === "next") { next(true); close(); openSheet(); }
      if (k === "prev") { prev(); close(); openSheet(); }
      if (k === "queue") openQueue();
      if (k === "crate") BF.mui.openAddToCrate(b.id);
      if (k === "repeat") { S.repeat = !S.repeat; e.target.closest("[data-s]").setAttribute("aria-pressed", S.repeat); }
      if (k === "shuffle") { S.shuffle = !S.shuffle; e.target.closest("[data-s]").setAttribute("aria-pressed", S.shuffle); }
    });
    let y0 = null;
    el.addEventListener("touchstart", (e) => { if (el.scrollTop === 0) y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchend", (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) close(); y0 = null; });
    sync();
  }

  /* ---------- Public API ---------- */
  BF.player = {
    init() {
      render(); bindWaveforms();
      document.body.classList.add("no-player");
      if ("mediaSession" in navigator) {
        const ms = navigator.mediaSession;
        ms.setActionHandler("play", () => { A.play(); sync(); });
        ms.setActionHandler("pause", () => { A.pause(); sync(); });
        ms.setActionHandler("nexttrack", () => next(true));
        ms.setActionHandler("previoustrack", prev);
      }
      document.addEventListener("keydown", (e) => {
        if (e.target.closest?.("input, textarea, select, [contenteditable], [role=slider], button, a")) return;
        if (e.code === "Space" && cur()) { e.preventDefault(); toggle(); }
        if (e.key === "ArrowRight" && e.shiftKey) next(true);
        if (e.key === "ArrowLeft" && e.shiftKey) prev();
      });
    },
    /** at > 0 means "seek here" (waveform click); at === 0 respects DJ preview mode. */
    playBeat(id, queue, at = 0) {
      if (cur()?.id === id && at === 0) { toggle(); return; }
      if (queue && queue.includes(id)) { S.queue = queue.slice(); S.index = queue.indexOf(id); }
      else {
        const i = S.queue.indexOf(id);
        if (i >= 0) S.index = i;
        else { S.queue.splice(S.index + 1, 0, id); S.index++; }
      }
      start(at, true);
    },
    toggleCurrent() { toggle(); },
    pause() { if (A.playing) { A.pause(); sync(); } },
    enqueue(id) { if (!S.queue.includes(id)) S.queue.push(id); if (S.index < 0) { S.index = 0; start(0); } },
    sync,
    current: cur,
  };
})();
