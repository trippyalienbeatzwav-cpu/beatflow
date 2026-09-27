/* ==========================================================================
   TUNIBEAT Social — Reels: full-screen vertical short video
   Only the active reel and its neighbours hold a video source (others are released),
   the next reel preloads, and watch time is reported when you move on.
   Keys: ↑/↓ or J/K navigate · Space play/pause · M mute · L like
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function sideHtml(p) {
    const r = p.viewer.reaction;
    return `<div class="s-reel-side" role="group" aria-label="Reel actions">
      <div class="s-reel-author">${SX.avatar(p.author, "md")}${p.author.id !== SX.state.me.id && !p.viewer.following_author ? `<button class="s-reel-follow" data-follow="${p.author.id}" data-state="none" aria-label="Follow ${esc(p.author.display_name)}">${I("plus", "i-xs")}</button>` : ""}</div>
      <button class="s-reel-act ${r ? "on" : ""}" data-r="like" aria-pressed="${!!r}" aria-label="${r ? "Remove like" : "Like"}">${r && r !== "like" ? `<span class="s-emoji">${Object.fromEntries(SX.REACTIONS.map((x) => [x[0], x[1]]))[r]}</span>` : I(r ? "heart-fill" : "heart")}<span>${p.counts.likes != null ? SX.count(p.counts.likes) : ""}</span></button>
      <button class="s-reel-act" data-r="comment" aria-label="Comments">${I("comment")}<span>${SX.count(p.counts.comments)}</span></button>
      <button class="s-reel-act" data-r="share" aria-label="Share">${I("send")}<span>${SX.count(p.counts.shares) || "Share"}</span></button>
      ${p.viewer.can_gift ? `<button class="s-reel-act gift" data-r="gift" aria-label="Send a gift">${I("gift")}<span>Gift</span></button>` : ""}
      <button class="s-reel-act ${p.viewer.saved ? "on" : ""}" data-r="save" aria-pressed="${p.viewer.saved}" aria-label="${p.viewer.saved ? "Unsave" : "Save"}">${I(p.viewer.saved ? "bookmark-fill" : "bookmark")}</button>
      <button class="s-reel-act" data-r="more" aria-label="More">${I("more")}</button>
    </div>`;
  }
  function reelHtml(p) {
    SX.postCache.set(p.id, p);
    const v = p.media[0];
    return `<section class="s-reel" data-reel="${p.id}" aria-label="Reel by ${esc(p.author.display_name)}" aria-roledescription="reel">
      <div class="s-reel-frame">
        <video data-v="${v.url}" poster="${v.poster_url ?? ""}" playsinline loop preload="none" ${SX.state.reelsMuted ? "muted" : ""} aria-label="${esc(p.caption.slice(0, 80) || "Reel video")}"></video>
        <button class="s-reel-tap" data-r="toggle" aria-label="Play or pause"></button>
        <span class="s-reel-flash" data-flash aria-hidden="true"></span>
        <div class="s-reel-meta">
          <div class="s-reel-by">${SX.name(p.author)}${p.author.id !== SX.state.me.id && !p.viewer.following_author ? ` · <button class="s-link" data-follow="${p.author.id}" data-state="none">Follow</button>` : ""}</div>
          ${p.caption ? `<div class="s-reel-cap clamp" data-cap>${SX.rich(p.caption)}</div>` : ""}
          <div class="s-reel-audio"><span class="s-reel-audio-ic">${I("music", "i-xs")}</span><span class="s-marquee"><span>${esc(p.audio_title ?? `Original sound · ${p.author.display_name}`)}</span></span></div>
        </div>
        <label class="s-reel-progress"><span class="sr-only">Seek</span><input type="range" min="0" max="1000" value="0" data-seek aria-label="Seek"></label>
        <span class="s-reel-loading" data-loading hidden><span class="s-spinner light"></span></span>
      </div>
      ${sideHtml(p)}
    </section>`;
  }

  SX.route("/social/reels", { title: "Reels", active: "reels", bare: true, mount: (el, p, q) => mountReels(el, q.start) });
  SX.route("/social/reels/:id", { title: "Reels", active: "reels", bare: true, mount: (el, p) => mountReels(el, p.id) });

  async function mountReels(el, startId) {
    el.innerHTML = `<div class="s-reels" data-feed tabindex="-1" aria-label="Reels. Use arrow keys to move between reels.">
      <div class="s-reels-top"><button class="s-reel-top-btn" data-back aria-label="Back">${I("arrow-left")}</button><h1 class="s-reels-title">Reels</h1>
        <button class="s-reel-top-btn" data-mute aria-label="${SX.state.reelsMuted ? "Unmute" : "Mute"}">${I(SX.state.reelsMuted ? "volume-x" : "volume")}</button>
        <a class="s-reel-top-btn" href="#/social/create?mode=reel" aria-label="Create a reel">${I("camera")}</a></div>
      <div data-list></div><div class="s-reels-end" data-end></div></div>`;
    const feed = el.querySelector("[data-feed]");
    const list = el.querySelector("[data-list]");
    document.body.classList.add("s-reels-on");
    let cursor = null, done = false, loading = false, active = null, watchStart = 0;
    const reported = new Set();

    async function load() {
      if (loading || done) return;
      loading = true;
      el.querySelector("[data-end]").innerHTML = `<div class="s-spinner light"></div>`;
      try {
        const r = await api.get(`/api/reels${SX.qs({ cursor, start: cursor ? null : startId })}`);
        const fresh = r.items.filter((x) => !list.querySelector(`[data-reel="${x.id}"]`));
        list.insertAdjacentHTML("beforeend", fresh.map(reelHtml).join(""));
        fresh.forEach((x) => { const s = list.querySelector(`[data-reel="${x.id}"]`); io.observe(s); });
        cursor = r.next_cursor; done = !cursor;
        el.querySelector("[data-end]").innerHTML = done ? (list.children.length ? `<p class="s-end light">You’ve seen every reel for now. <a href="#/social/create?mode=reel">Make one</a></p>` : SX.empty({ icon: "reels", title: "No reels yet", body: "Be the first to post one.", actions: `<a class="s-btn primary" href="#/social/create?mode=reel">Create a reel</a>` })) : "";
      } catch (err) {
        el.querySelector("[data-end]").innerHTML = `<div class="s-list-error light"><span>${esc(err.message)}</span><button class="s-btn sm" data-retry-load>Retry</button></div>`;
      } finally { loading = false; }
    }

    // Keep sources only on the active reel ±1 so memory stays flat on long sessions
    function window_(sec) {
      const all = [...list.children];
      const i = all.indexOf(sec);
      all.forEach((s, j) => {
        const v = s.querySelector("video");
        if (Math.abs(j - i) <= 1) {
          if (!v.src) { v.src = v.dataset.v; v.preload = j === i ? "auto" : "metadata"; }
        } else if (v.src) { v.pause(); v.removeAttribute("src"); v.load(); }
      });
      if (i >= all.length - 3) load();
    }
    function report(sec) {
      if (!sec) return;
      const v = sec.querySelector("video");
      const watched = watchStart ? Math.round(performance.now() - watchStart) : 0;
      if (watched > 500 && !reported.has(sec.dataset.reel + ":" + Math.floor(watched / 1000))) {
        reported.add(sec.dataset.reel + ":" + Math.floor(watched / 1000));
        api.post(`/api/posts/${sec.dataset.reel}/view`, { watch_ms: Math.min(watched, (v.duration || 3600) * 1000 * 3) }).catch(() => {});
      }
      watchStart = 0;
    }
    function activate(sec) {
      if (active === sec) return;
      if (active) { const v = active.querySelector("video"); v.pause(); report(active); active.classList.remove("on"); }
      active = sec; sec.classList.add("on");
      window_(sec);
      const v = sec.querySelector("video");
      v.muted = SX.state.reelsMuted;
      play(v, sec);
      history.replaceState(null, "", `#/social/reels/${sec.dataset.reel}`);
    }
    function play(v, sec) {
      const spin = sec.querySelector("[data-loading]");
      v.play().then(() => { watchStart = performance.now(); spin.hidden = true; }).catch(() => {
        // Autoplay with sound was blocked: fall back to muted
        if (!v.muted) { v.muted = true; SX.state.reelsMuted = true; syncMute(); v.play().catch(() => {}); }
      });
    }
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting && e.intersectionRatio >= 0.7) activate(e.target); }, { root: null, threshold: [0.7] });

    function syncMute() { const b = el.querySelector("[data-mute]"); b.innerHTML = I(SX.state.reelsMuted ? "volume-x" : "volume"); b.setAttribute("aria-label", SX.state.reelsMuted ? "Unmute" : "Mute"); list.querySelectorAll("video").forEach((v) => (v.muted = SX.state.reelsMuted)); }
    function flash(sec, icon) { if (reduce()) return; const f = sec.querySelector("[data-flash]"); f.innerHTML = I(icon); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
    function rerender(p) { const sec = list.querySelector(`[data-reel="${p.id}"]`); sec?.querySelector(".s-reel-side").replaceWith(Object.assign(document.createElement("div"), { innerHTML: sideHtml(p) }).firstElementChild); }
    function go(dir) {
      const all = [...list.children];
      const i = active ? all.indexOf(active) : -1;
      const n = all[Math.max(0, Math.min(all.length - 1, i + dir))];
      n?.scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "start" });
    }

    // Progress + buffering
    const onTime = (e) => {
      const v = e.target; if (!v.matches(".s-reel video")) return;
      const sec = v.closest("[data-reel]");
      if (e.type === "timeupdate" && v.duration) { const s = sec.querySelector("[data-seek]"); if (!s.matches(":active")) s.value = Math.round((v.currentTime / v.duration) * 1000); }
      if (e.type === "waiting") sec.querySelector("[data-loading]").hidden = false;
      if (e.type === "playing") sec.querySelector("[data-loading]").hidden = true;
    };
    list.addEventListener("timeupdate", onTime, true); list.addEventListener("waiting", onTime, true); list.addEventListener("playing", onTime, true);
    list.addEventListener("input", (e) => { if (!e.target.matches("[data-seek]")) return; const v = e.target.closest("[data-reel]").querySelector("video"); if (v.duration) v.currentTime = (e.target.value / 1000) * v.duration; });

    let lastTap = 0;
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return history.length > 1 ? history.back() : (location.hash = "#/social");
      if (e.target.closest("[data-mute]")) { SX.state.reelsMuted = !SX.state.reelsMuted; syncMute(); return; }
      if (e.target.closest("[data-retry-load]")) { load(); return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      const sec = b.closest("[data-reel]"); const p = SX.postCache.get(sec.dataset.reel); const v = sec.querySelector("video");
      switch (b.dataset.r) {
        case "toggle": {
          const now = Date.now();
          if (now - lastTap < 280) { if (!p.viewer.reaction) SX.setReaction(p, "like", null, () => rerender(p)); flash(sec, "heart-fill"); lastTap = 0; return; }
          lastTap = now;
          setTimeout(() => { if (lastTap !== now) return; if (v.paused) { play(v, sec); flash(sec, "play"); } else { v.pause(); report(sec); flash(sec, "pause"); } }, 280);
          break;
        }
        case "like": SX.setReaction(p, p.viewer.reaction ? null : "like", null, () => rerender(p)); if (!p.viewer.reaction) flash(sec, "heart-fill"); break;
        case "comment": SX.openComments(p); break;
        case "share": SX.share(p); break;
        case "save": SX.toggleSave(p, null, () => rerender(p)); break;
        case "gift": SX.openGifts?.({ recipient: p.author, contextType: "post", contextId: p.id }); break;
        case "more": SX.postMenu(p, sec); break;
      }
    });
    el.addEventListener("contextmenu", (e) => { const b = e.target.closest('[data-r="like"]'); if (!b) return; e.preventDefault(); const p = SX.postCache.get(b.closest("[data-reel]").dataset.reel); SX.pickReaction(p, b, () => rerender(p)); });
    SX.bindFollow(el, () => {});
    const onKey = (e) => {
      if (e.target.closest("input, textarea, .modal-backdrop")) return;
      const k = e.key.toLowerCase();
      if (k === "arrowdown" || k === "j") { e.preventDefault(); go(1); }
      else if (k === "arrowup" || k === "k") { e.preventDefault(); go(-1); }
      else if (k === " ") { e.preventDefault(); active?.querySelector('[data-r="toggle"]').click(); }
      else if (k === "m") { SX.state.reelsMuted = !SX.state.reelsMuted; syncMute(); }
      else if (k === "l" && active) active.querySelector('[data-r="like"]').click();
    };
    document.addEventListener("keydown", onKey);
    const onVis = () => { if (document.hidden && active) { active.querySelector("video").pause(); report(active); } };
    document.addEventListener("visibilitychange", onVis);
    await load();
    feed.focus({ preventScroll: true });
    return () => {
      report(active); io.disconnect();
      document.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onVis);
      document.body.classList.remove("s-reels-on");
      list.querySelectorAll("video").forEach((v) => { v.pause(); v.removeAttribute("src"); v.load(); });
    };
  }
})();
