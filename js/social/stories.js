/* ==========================================================================
   TUNIBEAT Social — story tray and full-screen viewer
   Tap left/right · hold to pause · swipe between people · swipe down to close
   Keyboard: ← → navigate · Space pause · M mute · Esc close
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const QUICK = [["love", "❤️"], ["fire", "🔥"], ["clap", "👏"], ["laugh", "😂"], ["wow", "😮"]];
  const IMAGE_MS = 5000;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  SX.renderStoryTray = async (host) => {
    if (!host) return;
    try {
      const r = await api.get("/api/stories/tray");
      const me = SX.state.me;
      const mine = r.items.find((x) => x.is_self);
      const others = r.items.filter((x) => !x.is_self);
      host.innerHTML = `<div class="s-story-row" role="list">
        <div class="s-story" role="listitem">${mine
          ? `<button class="s-story-btn" data-open="${me.id}" aria-label="View your story">${SX.avatar(me, "lg", { link: false, story: mine.unseen ? "new" : "seen", ring: true })}</button><a class="s-story-add" href="#/social/create?mode=story" aria-label="Add to your story">${I("plus", "i-xs")}</a>`
          : `<a class="s-story-btn" href="#/social/create?mode=story" aria-label="Add a story">${SX.avatar(me, "lg", { link: false })}<span class="s-story-add">${I("plus", "i-xs")}</span></a>`}
          <span class="s-story-name">Your story</span></div>
        ${others.map((x) => `<div class="s-story" role="listitem"><button class="s-story-btn" data-open="${x.user.id}" aria-label="View story from ${esc(x.user.display_name)}${x.unseen ? ", new" : ""}">${SX.avatar(x.user, "lg", { link: false, ring: true, story: x.unseen ? "new" : "seen" })}${x.close_friends ? `<span class="s-cf-badge" title="Close friends">★</span>` : ""}</button><span class="s-story-name">${esc(x.user.username)}</span></div>`).join("")}
      </div>`;
      const order = [...(mine ? [me.id] : []), ...others.map((x) => x.user.id)];
      host.onclick = (e) => { const b = e.target.closest("[data-open]"); if (!b) return; SX.openStories(order, order.indexOf(b.dataset.open), () => SX.renderStoryTray(host)); };
      if (!r.items.length && !mine) host.querySelector(".s-story-row").insertAdjacentHTML("beforeend", `<p class="s-story-hint">Stories from people you follow appear here for 24 hours.</p>`);
    } catch { host.innerHTML = ""; }
  };

  /** Open the viewer on authors[start]; onClose refreshes the tray (seen rings). */
  SX.openStories = (authors, start = 0, onClose) => {
    const ov = document.createElement("div");
    ov.className = "s-sv";
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Stories");
    ov.innerHTML = `<div class="s-sv-stage" data-stage>
        <div class="s-sv-bars" data-bars></div>
        <header class="s-sv-head" data-head></header>
        <div class="s-sv-content" data-content></div>
        <button class="s-sv-zone prev" data-nav="-1" aria-label="Previous"></button>
        <button class="s-sv-zone next" data-nav="1" aria-label="Next"></button>
        <footer class="s-sv-foot" data-foot></footer>
        <div class="s-sv-paused" data-paused hidden>${I("pause")}</div>
      </div>
      <button class="s-sv-close" data-close aria-label="Close stories">${I("x")}</button>
      <button class="s-sv-arrow left" data-person="-1" aria-label="Previous person">${I("chevron-left")}</button>
      <button class="s-sv-arrow right" data-person="1" aria-label="Next person">${I("chevron-right")}</button>`;
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    const release = BF.trap(ov, () => close());
    let ai = start, si = 0, stories = [], t0 = 0, elapsed = 0, dur = IMAGE_MS, paused = false, raf = 0, video = null, holdT = null, held = false;
    const $ = (s) => ov.querySelector(s);

    async function loadAuthor(i, fromEnd = false) {
      if (i < 0) { i = 0; }
      if (i >= authors.length) return close();
      ai = i;
      $("[data-content]").innerHTML = `<div class="s-spinner light" role="status" aria-label="Loading story"></div>`;
      try {
        const r = await api.get(`/api/stories/user/${authors[ai]}`);
        stories = r.items;
        if (!stories.length) return loadAuthor(ai + 1);
        // Start at the first unseen story unless navigating backwards
        si = fromEnd ? stories.length - 1 : Math.max(0, stories.findIndex((s) => !s.seen && !s.is_author));
        show();
      } catch { loadAuthor(ai + 1); }
    }

    function show() {
      cancelAnimationFrame(raf);
      video?.pause(); video = null;
      const s = stories[si];
      elapsed = 0; paused = false; $("[data-paused]").hidden = true;
      $("[data-bars]").innerHTML = stories.map((_, i) => `<span class="${i < si ? "done" : ""}"><i ${i === si ? "data-fill" : ""}></i></span>`).join("");
      $("[data-head]").innerHTML = `${SX.avatar(s.author, "sm", { link: false })}<div class="s-sv-who"><b>${esc(s.author.display_name)}</b>${s.author.is_verified ? SX.verified() : ""} <span>${SX.ago(s.created_at)}</span>${s.audience === "close_friends" ? `<span class="s-cf-pill">★ Close friends</span>` : ""}</div>
        ${s.audio_title ? `<span class="s-sv-audio">${I("music", "i-xs")} ${esc(s.audio_title)}</span>` : ""}
        <div class="s-sv-tools">${s.media?.kind === "video" ? `<button class="s-sv-btn" data-mute aria-label="${SX.state.reelsMuted ? "Unmute" : "Mute"}">${I(SX.state.reelsMuted ? "volume-x" : "volume", "i-sm")}</button>` : ""}
          <button class="s-sv-btn" data-pause aria-label="Pause">${I("pause", "i-sm")}</button><button class="s-sv-btn" data-more aria-label="Story options">${I("more", "i-sm")}</button></div>`;
      const c = s.content ?? {};
      const stickers = (c.stickers ?? []).map((st) => {
        const pos = `left:${st.x * 100}%;top:${st.y * 100}%`;
        if (st.type === "mention") return `<a class="s-sticker mention" style="${pos}" href="#/social/u/${esc(st.value.replace(/^@/, ""))}">@${esc(st.value.replace(/^@/, ""))}</a>`;
        if (st.type === "hashtag") return `<a class="s-sticker tag" style="${pos}" href="#/social/tag/${encodeURIComponent(st.value.replace(/^#/, ""))}">#${esc(st.value.replace(/^#/, ""))}</a>`;
        if (st.type === "emoji") return `<span class="s-sticker emoji" style="${pos}">${esc(st.value)}</span>`;
        if (st.type === "music") return `<span class="s-sticker music" style="${pos}">${I("music", "i-xs")} ${esc(st.value)}</span>`;
        if (st.type === "question") return `<button class="s-sticker question" style="${pos}" data-question="${esc(st.value)}"><b>${esc(st.value)}</b><span>Tap to answer</span></button>`;
        return `<span class="s-sticker text" style="${pos}">${esc(st.value)}</span>`;
      }).join("");
      const body = s.media
        ? s.media.kind === "video"
          ? `<video src="${s.media.url}" poster="${s.media.poster_url ?? ""}" playsinline ${SX.state.reelsMuted ? "muted" : ""} preload="auto" aria-label="Story video"></video>`
          : `<img src="${s.media.url}" alt="${esc(c.text || "Story from " + s.author.display_name)}">`
        : `<div class="s-sv-textbg" style="background:${esc(c.bg || "#1b1030")}"></div>`;
      $("[data-content]").innerHTML = `${body}${c.text ? `<p class="s-sv-text ${s.media ? "over" : ""}">${SX.rich(c.text)}</p>` : ""}${stickers}${s.link_url ? `<a class="s-sticker link" style="left:50%;top:78%" href="${esc(s.link_url)}" target="_blank" rel="noopener noreferrer nofollow ugc">${I("link", "i-xs")} ${esc(s.link_url.replace(/^https?:\/\//, "").slice(0, 32))}</a>` : ""}`;
      $("[data-foot]").innerHTML = s.is_author
        ? `<button class="s-sv-seen" data-viewers>${I("eye", "i-sm")} ${s.stats?.unique_viewers ? `Seen by ${s.stats.unique_viewers}` : "No views yet"}${s.stats?.reactions ? ` · ${s.stats.reactions} reaction${s.stats.reactions === 1 ? "" : "s"}` : ""}${s.stats?.replies ? ` · ${s.stats.replies} repl${s.stats.replies === 1 ? "y" : "ies"}` : ""}</button>`
        : `${s.can_reply ? `<form class="s-sv-reply" data-reply><label class="sr-only" for="sv-reply">Reply to ${esc(s.author.display_name)}</label><input id="sv-reply" maxlength="1000" placeholder="Reply to ${esc(s.author.display_name)}…" autocomplete="off"><button aria-label="Send reply">${I("send", "i-sm")}</button></form>` : ""}
           <div class="s-sv-react" role="group" aria-label="React">${QUICK.map(([k, e]) => `<button data-react="${k}" class="${s.reaction === k ? "on" : ""}" aria-label="React ${k}">${e}</button>`).join("")}</div>`;
      if (!s.is_author && !s.seen) { s.seen = true; api.post(`/api/stories/${s.id}/view`).catch(() => {}); }
      video = $("[data-content] video");
      if (video) {
        dur = IMAGE_MS;
        video.addEventListener("loadedmetadata", () => { if (isFinite(video.duration)) dur = Math.min(60_000, video.duration * 1000); });
        video.addEventListener("ended", () => next());
        video.addEventListener("waiting", () => (t0 = performance.now() - elapsed));
        video.play().catch(() => { video.muted = true; SX.state.reelsMuted = true; video.play().catch(() => {}); });
      } else dur = IMAGE_MS;
      // Preload the next image so taps feel instant
      const nx = stories[si + 1];
      if (nx?.media?.kind === "image") new Image().src = nx.media.url;
      t0 = performance.now();
      tick();
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      if (paused) return;
      elapsed = video && !video.paused ? video.currentTime * 1000 : video ? elapsed : performance.now() - t0;
      const f = $("[data-fill]");
      if (f) f.style.transform = `scaleX(${Math.min(1, elapsed / dur)})`;
      if (!video && elapsed >= dur) next();
    }
    function setPaused(v) {
      paused = v;
      $("[data-paused]").hidden = !v || held;
      if (video) v ? video.pause() : video.play().catch(() => {});
      if (!v) t0 = performance.now() - elapsed;
      const pb = $("[data-pause]"); if (pb) { pb.innerHTML = I(v ? "play" : "pause", "i-sm"); pb.setAttribute("aria-label", v ? "Play" : "Pause"); }
    }
    function next() { if (si < stories.length - 1) { si++; show(); } else loadAuthor(ai + 1); }
    function prev() { if (si > 0) { si--; show(); } else if (ai > 0) loadAuthor(ai - 1, true); else { elapsed = 0; t0 = performance.now(); if (video) video.currentTime = 0; } }
    function close() {
      cancelAnimationFrame(raf); video?.pause(); release(); ov.remove();
      if (!BF.$(".modal-backdrop, .s-sv")) document.body.style.overflow = "";
      if (location.hash.startsWith("#/social/stories/")) history.length > 1 ? history.back() : (location.hash = "#/social");
      onClose?.();
    }

    ov.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.closest("[data-close]")) return close();
      const nav = t.closest("[data-nav]"); if (nav && !held) return nav.dataset.nav === "1" ? next() : prev();
      const person = t.closest("[data-person]"); if (person) return loadAuthor(ai + Number(person.dataset.person));
      if (t.closest("[data-pause]")) return setPaused(!paused);
      if (t.closest("[data-mute]")) { SX.state.reelsMuted = !SX.state.reelsMuted; if (video) video.muted = SX.state.reelsMuted; t.closest("[data-mute]").innerHTML = I(SX.state.reelsMuted ? "volume-x" : "volume", "i-sm"); return; }
      const s = stories[si];
      const react = t.closest("[data-react]");
      if (react) {
        const k = react.dataset.react;
        ov.querySelectorAll("[data-react]").forEach((b) => b.classList.toggle("on", b === react));
        if (!reduce()) { const f = document.createElement("span"); f.className = "s-sv-float"; f.textContent = react.textContent; $("[data-stage]").appendChild(f); setTimeout(() => f.remove(), 1200); }
        try { await api.post(`/api/stories/${s.id}/react`, { kind: k }); s.reaction = k; } catch (err) { SX.fail(err); }
        return;
      }
      const q = t.closest("[data-question]");
      if (q) { setPaused(true); const inp = $("[data-reply] input"); if (inp) { inp.value = `${q.dataset.question} → `; inp.focus(); } return; }
      if (t.closest("[data-viewers]")) { setPaused(true); return viewers(s); }
      if (t.closest("[data-more]")) {
        setPaused(true);
        SX.menu("Story", [
          s.is_author && { label: "Delete story", icon: "trash", danger: true, run: async () => { try { await api.del(`/api/stories/${s.id}`); stories.splice(si, 1); SX.toast({ title: "Story deleted" }); if (!stories.length) close(); else { si = Math.min(si, stories.length - 1); show(); } } catch (err) { SX.fail(err); } } },
          !s.is_author && { label: `Mute @${s.author.username}’s stories`, icon: "volume-x", run: async () => { await api.post(`/api/users/${s.author.id}/mute`).catch(() => {}); SX.toast({ kind: "info", title: "Muted", desc: "You won’t see their stories in your tray." }); loadAuthor(ai + 1); } },
          !s.is_author && { label: "Report story", icon: "flag", danger: true, run: () => SX.report("story", s.id, "story") },
          { label: "Go to profile", icon: "user", run: () => { close(); location.hash = `#/social/u/${s.author.username}`; } },
        ]);
      }
    });
    ov.addEventListener("submit", async (e) => {
      if (!e.target.matches("[data-reply]")) return;
      e.preventDefault();
      const inp = e.target.querySelector("input");
      const body = inp.value.trim(); if (!body) return;
      const s = stories[si];
      try { await api.post(`/api/stories/${s.id}/reply`, { body, client_id: SX.ikey() }); inp.value = ""; inp.blur(); SX.toast({ title: "Reply sent", desc: `Sent to ${esc(s.author.display_name)} in Messages`, action: { href: "#/social/messages", label: "Open" } }); setPaused(false); }
      catch (err) { SX.fail(err, "Couldn’t send reply"); }
    });
    ov.addEventListener("focusin", (e) => { if (e.target.matches("[data-reply] input")) setPaused(true); });
    ov.addEventListener("focusout", (e) => { if (e.target.matches("[data-reply] input") && !e.target.value) setPaused(false); });
    // Hold to pause; swipe to navigate/close
    let x0 = 0, y0 = 0;
    const stage = $("[data-stage]");
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button:not([data-nav]),a,input,form")) return;
      x0 = e.clientX; y0 = e.clientY; held = false;
      holdT = setTimeout(() => { held = true; setPaused(true); }, 220);
    });
    stage.addEventListener("pointerup", (e) => {
      clearTimeout(holdT);
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (held) { setPaused(false); setTimeout(() => (held = false), 0); return; }
      if (Math.abs(dy) > 90 && dy > Math.abs(dx)) close();
      else if (Math.abs(dx) > 70) loadAuthor(ai + (dx < 0 ? 1 : -1));
    });
    stage.addEventListener("pointercancel", () => { clearTimeout(holdT); if (held) setPaused(false); held = false; });
    ov.addEventListener("keydown", (e) => {
      if (e.target.matches("input")) { if (e.key === "Escape") e.target.blur(); return; }
      if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") { e.preventDefault(); setPaused(!paused); }
      else if (e.key.toLowerCase() === "m" && video) { SX.state.reelsMuted = !SX.state.reelsMuted; video.muted = SX.state.reelsMuted; }
    });
    document.addEventListener("visibilitychange", function vis() { if (!ov.isConnected) return document.removeEventListener("visibilitychange", vis); if (document.hidden) setPaused(true); });

    async function viewers(s) {
      SX.sheet({
        title: "Story activity", body: `<div class="s-user-list" data-v>${SX.skeletonRows(3)}</div>`,
        onMount: async (bd) => {
          try {
            const r = await api.get(`/api/stories/${s.id}/viewers`);
            bd.querySelector("[data-v]").innerHTML = `<p class="muted" style="margin:0 0 8px">${r.items.length} viewer${r.items.length === 1 ? "" : "s"} · only you can see this</p>` + (r.items.map((v) => `<div class="s-user-row">${SX.avatar(v.user, "sm")}<div class="grow">${SX.name(v.user, { handle: true })}<div class="s-handle">${SX.ago(v.viewed_at)}${v.views > 1 ? ` · viewed ${v.views}×` : ""}</div></div>${v.reaction ? `<span class="s-emoji">${Object.fromEntries(QUICK)[v.reaction] ?? "❤️"}</span>` : ""}</div>`).join("") || "");
          } catch (err) { bd.querySelector("[data-v]").innerHTML = SX.errorBox(err, false); }
        },
      });
    }
    loadAuthor(ai);
    return close;
  };

  // Deep link: #/social/stories/:userId
  SX.route("/social/stories/:uid", {
    title: "Stories", active: "home",
    async mount(el, p) {
      el.innerHTML = SX.skeletonPosts(1);
      SX.openStories([p.uid], 0);
    },
  });
})();
