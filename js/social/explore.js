/* ==========================================================================
   TUNIBEAT Social — Explore and search
   Debounced suggestions, search history, per-type result tabs with pagination.
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const TYPES = [["all", "Top"], ["users", "Accounts"], ["posts", "Posts"], ["reels", "Reels"], ["hashtags", "Tags"], ["live", "Live"]];

  const userRow = (u) => `<div class="s-user-row">${SX.avatar(u, "md")}<div class="grow">${SX.name(u, { handle: true })}<div class="s-handle">${u.followers != null ? `${SX.count(u.followers)} followers` : ""}${u.bio ? ` · ${esc(u.bio)}` : ""}</div></div>${SX.followBtn(u, u.following ? "active" : "none", "sm")}</div>`;
  const tagRow = (t) => `<a class="s-user-row" href="#/social/tag/${encodeURIComponent(t.tag)}"><span class="s-tag-ic sm">${I("hash", "i-sm")}</span><div class="grow"><b>#${esc(t.tag)}</b><div class="s-handle">${SX.count(t.post_count)} posts</div></div></a>`;
  const liveRow = (l) => `<a class="s-user-row" href="#/social/live/${l.id}">${SX.avatar(l.host, "md", { link: false, live: l.status === "live" })}<div class="grow"><b>${esc(l.title)}</b><div class="s-handle">${esc(l.host.display_name)} · ${l.status === "live" ? `${SX.count(l.viewers)} watching` : `Scheduled ${l.scheduled_at ? SX.when(l.scheduled_at) : ""}`}</div></div>${l.status === "live" ? `<span class="s-live-badge">LIVE</span>` : ""}</a>`;

  SX.route("/social/explore", {
    title: (p, q) => (q.q ? `Search: ${q.q}` : "Explore"), active: "explore",
    render: (p, q) => `<div class="s-explore">
      <form class="s-searchbar" data-search role="search"><label class="sr-only" for="sq">Search people, posts, tags and lives</label>${I("search", "i-sm")}
        <input id="sq" name="q" type="search" placeholder="Search people, #tags, posts, lives" autocomplete="off" value="${esc(q.q ?? "")}" aria-autocomplete="list" aria-controls="s-sugg">
        <button type="button" class="s-icon-btn sm" data-clear aria-label="Clear search" ${q.q ? "" : "hidden"}>${I("x", "i-xs")}</button>
        <div class="s-suggest" id="s-sugg" data-sugg role="listbox" hidden></div></form>
      <div data-body></div></div>`,
    async mount(el, p, q) {
      const input = el.querySelector("#sq"), sugg = el.querySelector("[data-sugg]"), body = el.querySelector("[data-body]");
      let inf, type = TYPES.some(([k]) => k === q.type) ? q.type : "all";
      const cleanup = [];

      async function showHistory() {
        const h = await api.get("/api/search/history").catch(() => ({ items: [] }));
        if (!h.items.length || input.value) { sugg.hidden = true; return; }
        sugg.innerHTML = `<div class="s-sugg-head"><b>Recent</b><button type="button" class="s-link" data-clear-hist>Clear all</button></div>` + h.items.map((x) => `<div class="s-sugg-item"><button type="button" role="option" data-go="${esc(x.query)}">${I("clock", "i-xs")} ${esc(x.query)}</button><button type="button" class="s-icon-btn sm" data-del-hist="${esc(x.query)}" aria-label="Remove ${esc(x.query)} from history">${I("x", "i-xs")}</button></div>`).join("");
        sugg.hidden = false;
      }
      let t, ctrl;
      input.addEventListener("input", () => {
        el.querySelector("[data-clear]").hidden = !input.value;
        clearTimeout(t); ctrl?.abort();
        const v = input.value.trim();
        if (!v) return showHistory();
        t = setTimeout(async () => {
          ctrl = new AbortController();
          try {
            const r = await api.get(`/api/search/suggest?q=${encodeURIComponent(v)}`, { signal: ctrl.signal });
            sugg.innerHTML = [...r.hashtags.map((h) => `<button type="button" role="option" data-go="#${esc(h.tag)}">${I("hash", "i-xs")} #${esc(h.tag)} <span class="s-handle">${SX.count(h.post_count)} posts</span></button>`),
              ...r.users.map((u) => `<a role="option" href="#/social/u/${esc(u.username)}" data-hist="${esc(u.username)}">${SX.avatar(u, "xs", { link: false })} ${SX.name(u, { link: false, handle: true })}</a>`)].join("")
              + `<button type="button" role="option" class="s-sugg-all" data-go="${esc(v)}">${I("search", "i-xs")} See all results for “${esc(v)}”</button>`;
            sugg.hidden = false;
          } catch { /* aborted */ }
        }, 220);
      });
      input.addEventListener("focus", () => !input.value && showHistory());
      input.addEventListener("keydown", (e) => {
        const opts = [...sugg.querySelectorAll("[role=option]")];
        if (!opts.length || sugg.hidden) return;
        const i = opts.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); opts[0].focus(); }
        if (e.key === "Escape") sugg.hidden = true;
        void i;
      });
      sugg.addEventListener("keydown", (e) => {
        const opts = [...sugg.querySelectorAll("[role=option]")]; const i = opts.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)]?.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); i <= 0 ? input.focus() : opts[i - 1].focus(); }
        if (e.key === "Escape") { sugg.hidden = true; input.focus(); }
      });
      const outside = (e) => { if (!el.querySelector("[data-search]").contains(e.target)) sugg.hidden = true; };
      document.addEventListener("pointerdown", outside);
      cleanup.push(() => document.removeEventListener("pointerdown", outside));
      const go = (v) => { sugg.hidden = true; input.value = v; api.post("/api/search/history", { query: v }).catch(() => {}); BF.setQuery({ q: v, type: "" }); type = "all"; results(v); };
      el.querySelector("[data-search]").addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) go(v); });
      el.addEventListener("click", async (e) => {
        const g = e.target.closest("[data-go]"); if (g) return go(g.dataset.go);
        const h = e.target.closest("[data-hist]"); if (h) api.post("/api/search/history", { query: "@" + h.dataset.hist }).catch(() => {});
        if (e.target.closest("[data-clear]")) { input.value = ""; el.querySelector("[data-clear]").hidden = true; BF.setQuery({ q: "", type: "" }); explore(); input.focus(); }
        if (e.target.closest("[data-clear-hist]")) { await api.del("/api/search/history").catch(() => {}); sugg.hidden = true; }
        const dh = e.target.closest("[data-del-hist]"); if (dh) { await api.del(`/api/search/history?q=${encodeURIComponent(dh.dataset.delHist)}`).catch(() => {}); showHistory(); }
        const tt = e.target.closest("[data-type]"); if (tt) { type = tt.dataset.type; BF.setQuery({ type: type === "all" ? "" : type }); results(input.value.trim()); }
        const cat = e.target.closest("[data-cat]"); if (cat) explore(cat.dataset.cat || null);
      });
      SX.bindFollow(el);

      async function results(v) {
        inf?.destroy(); inf = null;
        body.innerHTML = `<div class="s-tabs scroll" role="tablist">${TYPES.map(([k, l]) => `<button role="tab" data-type="${k}" aria-selected="${k === type}">${l}</button>`).join("")}</div><div data-res>${SX.skeletonRows(4)}</div>`;
        const res = body.querySelector("[data-res]");
        if (type === "all") {
          const r = await api.get(`/api/search?q=${encodeURIComponent(v)}`);
          const R = r.results;
          const total = ["users", "hashtags", "posts", "reels", "live"].reduce((n, k) => n + (R[k]?.items.length ?? 0), 0);
          if (!total) { res.innerHTML = SX.empty({ icon: "search", title: `No results for “${esc(v)}”`, body: "Check the spelling, or try a hashtag like #techno or a creator’s name." }); return; }
          res.innerHTML = `${R.users.items.length ? `<section><h2 class="s-h6">Accounts</h2><div class="s-user-list">${R.users.items.map(userRow).join("")}</div></section>` : ""}
            ${R.live.items.length ? `<section><h2 class="s-h6">Live</h2><div class="s-user-list">${R.live.items.map(liveRow).join("")}</div></section>` : ""}
            ${R.hashtags.items.length ? `<section><h2 class="s-h6">Tags</h2><div class="s-chips">${R.hashtags.items.map((t2) => `<a class="s-chip" href="#/social/tag/${encodeURIComponent(t2.tag)}">#${esc(t2.tag)} <small>${SX.count(t2.post_count)}</small></a>`).join("")}</div></section>` : ""}
            ${R.reels.items.length ? `<section><h2 class="s-h6">Reels</h2><div class="s-grid reels">${R.reels.items.map(SX.gridCell).join("")}</div></section>` : ""}
            ${R.posts.items.length ? `<section><h2 class="s-h6">Posts</h2><div class="s-grid">${R.posts.items.map(SX.gridCell).join("")}</div></section>` : ""}`;
          SX.lazy(res);
          return;
        }
        res.innerHTML = `<div class="${type === "posts" || type === "reels" ? `s-grid ${type === "reels" ? "reels" : ""}` : "s-user-list"}" data-rl></div>`;
        inf = SX.infinite({
          list: res.querySelector("[data-rl]"),
          load: async (c) => { const r = await api.get(`/api/search${SX.qs({ q: v, type, cursor: c })}`); return r.results[type]; },
          render: (items) => items.map(type === "users" ? userRow : type === "hashtags" ? tagRow : type === "live" ? liveRow : SX.gridCell).join(""),
          empty: SX.empty({ icon: "search", title: `No ${TYPES.find(([k]) => k === type)[1].toLowerCase()} match “${esc(v)}”` }),
        });
        inf.more();
      }

      async function explore(category = null) {
        inf?.destroy(); inf = null;
        body.innerHTML = SX.skeletonGrid(9);
        const r = await api.get(`/api/explore${category ? `?category=${category}` : ""}`);
        const live = r.live.filter((l) => l.status === "live");
        body.innerHTML = `<div class="s-chips scroll" role="group" aria-label="Categories"><button class="s-chip btn ${!r.category ? "on" : ""}" data-cat="">For you</button>${r.categories.map((c) => `<button class="s-chip btn ${r.category === c.id ? "on" : ""}" data-cat="${c.id}">${esc(c.label)}</button>`).join("")}</div>
          ${live.length ? `<section><h2 class="s-h6"><span class="s-live-dot"></span> Live now</h2><div class="s-live-strip">${live.map((l) => `<a class="s-live-card" href="#/social/live/${l.id}">${SX.avatar(l.host, "md", { link: false, live: true })}<span><b>${esc(l.host.display_name)}</b><small>${esc(l.title)}</small></span></a>`).join("")}</div></section>` : ""}
          ${r.trending_tags.length && !category ? `<section><h2 class="s-h6">${I("trend-up", "i-sm")} Trending</h2><div class="s-chips">${r.trending_tags.map((t2) => `<a class="s-chip" href="#/social/tag/${encodeURIComponent(t2.tag)}">#${esc(t2.tag)} <small>${t2.recent} new</small></a>`).join("")}</div></section>` : ""}
          ${r.creators.length && !category ? `<section><h2 class="s-h6">Creators to follow</h2><div class="s-creators">${r.creators.map((u) => `<div class="s-creator-card">${SX.avatar(u, "lg")}${SX.name(u)}<span class="s-handle">${SX.count(u.followers)} followers</span><p>${esc(u.bio)}</p>${SX.followBtn(u, "none", "sm")}</div>`).join("")}</div></section>` : ""}
          ${r.reels.length ? `<section><h2 class="s-h6">${I("reels", "i-sm")} Popular reels <a class="s-link" href="#/social/reels">Watch all</a></h2><div class="s-grid reels row">${r.reels.map(SX.gridCell).join("")}</div></section>` : ""}
          <section><h2 class="s-h6">Popular posts</h2>${r.posts.length ? `<div class="s-grid">${r.posts.map(SX.gridCell).join("")}</div>` : SX.empty({ icon: "image", title: "Nothing here yet", body: "Posts in this category will show up here." })}</section>
          ${r.live.filter((l) => l.status === "scheduled").length ? `<section><h2 class="s-h6">${I("calendar", "i-sm")} Upcoming lives</h2><div class="s-user-list">${r.live.filter((l) => l.status === "scheduled").map(liveRow).join("")}</div></section>` : ""}`;
        SX.lazy(body);
      }
      if (q.q) results(q.q); else explore();
      return () => { inf?.destroy(); cleanup.forEach((f) => f()); };
    },
  });
})();
