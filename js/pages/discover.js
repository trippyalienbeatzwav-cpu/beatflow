/* Discovery (filters, sort, grid/list), full search results, producer directory */
(function () {
  const I = BF.icon, ui = BF.ui;

  const SORTS = [["trending", "Trending"], ["popular", "Most played"], ["newest", "Newest"], ["price-asc", "Price: low to high"], ["price-desc", "Price: high to low"]];
  const LIC_FILTERS = [["stems", "Trackout / stems available"], ["exclusive", "Exclusive rights available"], ["free", "Free download"]];

  function stateFromQuery(q) {
    const list = (v) => (v ? v.split(",").filter(Boolean) : []);
    const range = (v, d) => (v ? v.split("-").map(Number) : d);
    return {
      q: q.q || "", genres: list(q.genre), moods: list(q.mood), keys: list(q.key), lic: list(q.lic),
      bpm: range(q.bpm, [60, 180]), price: range(q.price, [0, 60]),
      sort: q.sort || "trending", view: q.view || BF.store.get("view") || "grid", page: 1,
    };
  }
  function toQuery(s) {
    return {
      q: s.q, genre: s.genres.join(","), mood: s.moods.join(","), key: s.keys.join(","), lic: s.lic.join(","),
      bpm: s.bpm[0] === 60 && s.bpm[1] === 180 ? "" : s.bpm.join("-"),
      price: s.price[0] === 0 && s.price[1] === 60 ? "" : s.price.join("-"),
      sort: s.sort === "trending" ? "" : s.sort, view: s.view === "grid" ? "" : s.view,
    };
  }

  /* Text search runs on the server (full-text index); results are cached per query for this visit */
  const textHits = new Map();
  let onHits = null, searchError = null;
  function hitsFor(q) {
    const key = q.toLowerCase();
    if (textHits.has(key)) return textHits.get(key);
    textHits.set(key, null);
    BF.http.get(`/api/store/search?marketplace=beats&limit=50&q=${encodeURIComponent(q.slice(0, 200))}`)
      .then((r) => { searchError = null; textHits.set(key, r.groups.beat ?? []); onHits?.(); })
      .catch((err) => { textHits.delete(key); searchError = err; onHits?.(); });
    return null;
  }

  function apply(s, base = BF.BEATS) {
    let list = base.filter((b) => {
      if (s.genres.length && !s.genres.includes(b.genre)) return false;
      if (s.moods.length && !b.moods.some((m) => s.moods.includes(m))) return false;
      if (s.keys.length && !s.keys.includes(b.key)) return false;
      if (b.bpm < s.bpm[0] || b.bpm > s.bpm[1]) return false;
      const price = BF.basePrice(b);
      if (price < s.price[0] || (s.price[1] < 60 && price > s.price[1])) return false;
      if (s.lic.includes("exclusive") && !b.exclusiveAvailable) return false;
      if (s.lic.includes("free") && !b.freeDownload) return false;
      return true;
    });
    if (s.q) {
      const hits = hitsFor(s.q);
      if (!hits) { list = []; list.pending = true; return list; }
      list = list.filter((b) => hits.includes(b.id)).sort((a, b) => hits.indexOf(a.id) - hits.indexOf(b.id));
    }
    const sorters = {
      trending: (a, b) => b.trendScore - a.trendScore, popular: (a, b) => b.plays - a.plays, newest: (a, b) => a.daysAgo - b.daysAgo,
      "price-asc": (a, b) => BF.basePrice(a) - BF.basePrice(b), "price-desc": (a, b) => BF.basePrice(b) - BF.basePrice(a),
    };
    if (!s.q || s.sort !== "trending") list = [...list].sort(sorters[s.sort]);
    return list;
  }

  const countFor = (s, patch) => apply({ ...s, ...patch }).length;

  /* ---------- Filter panel (shared by sidebar + mobile drawer) ---------- */
  function filterPanel(s, idp) {
    const group = (id, title, icon, body, open = true, n = 0) => `<details class="fgroup" ${open ? "open" : ""}><summary><span>${I(icon, "i-sm")} ${title}</span>${n ? `<span class="fcount">${n}</span>` : ""}${I("chevron-down", "i-sm chev")}</summary><div class="fbody">${body}</div></details>`;
    return `
      ${group("genre", "Genre", "music", BF.GENRES.map((g) => `<label class="check"><input type="checkbox" data-f="genres" value="${g.id}" ${s.genres.includes(g.id) ? "checked" : ""}> ${g.name}<span class="count">${countFor(s, { genres: [g.id] })}</span></label>`).join(""), true, s.genres.length)}
      ${group("bpm", "BPM", "bpm", `
        <div class="dual-range" data-range="bpm" data-min="60" data-max="180">
          <div class="track"></div><div class="fill"></div>
          <input type="range" min="60" max="180" step="1" value="${s.bpm[0]}" aria-label="Minimum BPM">
          <input type="range" min="60" max="180" step="1" value="${s.bpm[1]}" aria-label="Maximum BPM">
        </div>
        <div class="range-values"><span data-rv="0">${s.bpm[0]}</span><span data-rv="1">${s.bpm[1]}${s.bpm[1] === 180 ? "+" : ""}</span></div>
        <div class="preset-row">${[["Slow", "60-89"], ["Mid", "90-119"], ["Up", "120-139"], ["Fast", "140-180"]].map(([l, v]) => `<button class="chip" data-bpm-preset="${v}" style="height:28px;font-size:12px">${l} <span class="mono subtle">${v.replace("-180", "+")}</span></button>`).join("")}</div>`, true, s.bpm[0] !== 60 || s.bpm[1] !== 180 ? 1 : 0)}
      ${group("key", "Key", "key", `<div class="key-grid">${BF.KEYS.map((k) => `<button class="chip key-chip" data-f-chip="keys" data-v="${k}" aria-pressed="${s.keys.includes(k)}">${k}</button>`).join("")}</div>`, s.keys.length > 0, s.keys.length)}
      ${group("mood", "Mood", "sparkle", `<div class="chip-wrap">${BF.MOODS.map((m) => `<button class="chip" data-f-chip="moods" data-v="${m}" aria-pressed="${s.moods.includes(m)}">${m}</button>`).join("")}</div>`, true, s.moods.length)}
      ${group("price", "Price (Basic lease)", "tag", `
        <div class="dual-range" data-range="price" data-min="0" data-max="60">
          <div class="track"></div><div class="fill"></div>
          <input type="range" min="0" max="60" step="5" value="${s.price[0]}" aria-label="Minimum price">
          <input type="range" min="0" max="60" step="5" value="${s.price[1]}" aria-label="Maximum price">
        </div>
        <div class="range-values"><span data-rv="0">$${s.price[0]}</span><span data-rv="1">$${s.price[1]}${s.price[1] === 60 ? "+" : ""}</span></div>`, false, s.price[0] !== 0 || s.price[1] !== 60 ? 1 : 0)}
      ${group("lic", "License", "license", LIC_FILTERS.map(([v, l]) => `<label class="check"><input type="checkbox" data-f="lic" value="${v}" ${s.lic.includes(v) ? "checked" : ""}> ${l}</label>`).join(""), true, s.lic.length)}
    `;
  }

  function activeChips(s) {
    const chips = [];
    if (s.q) chips.push(["q", "", `“${BF.esc(s.q)}”`]);
    s.genres.forEach((g) => chips.push(["genres", g, BF.genreById[g].name]));
    if (s.bpm[0] !== 60 || s.bpm[1] !== 180) chips.push(["bpm", "", `${s.bpm[0]}–${s.bpm[1]} BPM`]);
    s.keys.forEach((k) => chips.push(["keys", k, k]));
    s.moods.forEach((m) => chips.push(["moods", m, m]));
    if (s.price[0] !== 0 || s.price[1] !== 60) chips.push(["price", "", `$${s.price[0]}–$${s.price[1]}${s.price[1] === 60 ? "+" : ""}`]);
    s.lic.forEach((l) => chips.push(["lic", l, LIC_FILTERS.find((x) => x[0] === l)[1].split(" ")[0] + (l === "free" ? " download" : "")]));
    return chips;
  }

  function results(s, list) {
    if (!list.length) {
      return ui.empty({ icon: "search", title: "No beats match these filters", body: "Try widening the BPM range, removing a key, or searching a broader genre.", actions: `<button class="btn btn-primary" data-clear-all>Clear all filters</button><button class="btn btn-secondary" data-action="search">Search instead</button>` });
    }
    const shown = list.slice(0, s.page * 16);
    const ids = list.map((b) => b.id).join(",");
    const more = list.length > shown.length ? `<div style="display:flex;justify-content:center;margin-top:40px"><button class="btn btn-secondary btn-lg" data-more>Load more <span class="mono subtle">${list.length - shown.length}</span></button></div>` : `<p class="subtle" style="text-align:center;margin-top:40px;font-size:13px">You’ve reached the end · ${list.length} beats</p>`;
    if (s.view === "list") return `<div class="beat-list" role="list" data-queue="${ids}">${ui.beatListHead()}${shown.map((b, i) => ui.beatRow(b, i)).join("")}</div>${more}`;
    return `<div class="grid-beats" data-queue="${ids}">${shown.map((b) => ui.beatCard(b, { dur: true })).join("")}</div>${more}`;
  }

  BF.route("/beats/catalog", {
    title: "All beats",
    render(_, q) {
      const s = stateFromQuery(q);
      return `<div class="container discover">
        <header class="disc-head">
          <div><span class="eyebrow"><span class="idx">▶</span>Beats Store · catalog</span><h1 class="h1" style="margin-top:8px">All beats</h1></div>
          <form class="disc-search" role="search" data-disc-search>${I("search", "i-sm")}<label class="sr-only" for="dq">Filter by keyword</label><input id="dq" class="input" placeholder="Keyword, tag, producer, key…" value="${BF.esc(s.q)}" autocomplete="off"></form>
        </header>
        <div class="genre-strip" role="group" aria-label="Quick genre filter">
          <button class="chip" data-genre-quick="" aria-pressed="${!s.genres.length}">All genres</button>
          ${BF.GENRES.map((g) => `<button class="chip" data-genre-quick="${g.id}" aria-pressed="${s.genres.length === 1 && s.genres[0] === g.id}">${g.name}</button>`).join("")}
        </div>
        <div class="disc-layout">
          <aside class="filters" aria-label="Filters">
            <div class="filters-head"><h2 class="h4">Filters</h2><button class="link" style="font-size:13px" data-clear-all>Clear all</button></div>
            <div data-filters>${filterPanel(s, "d")}</div>
          </aside>
          <section class="disc-results" aria-labelledby="res-count">
            <div class="toolbar">
              <button class="btn btn-secondary btn-sm filters-toggle" data-open-filters>${I("sliders", "i-sm")} Filters <span data-fcount></span></button>
              <p id="res-count" class="res-count" aria-live="polite"></p>
              <div class="toolbar-right">
                <div class="dropdown">
                  <button class="btn btn-ghost btn-sm" data-dropdown aria-haspopup="menu" aria-expanded="false">${I("sort", "i-sm")}<span class="hide-sm">Sort:</span> <b data-sort-label></b>${I("chevron-down", "i-xs")}</button>
                  <div class="menu" role="menu">${SORTS.map(([v, l]) => `<button class="menu-item" role="menuitemradio" data-sort="${v}" aria-checked="${s.sort === v}">${l}</button>`).join("")}</div>
                </div>
                <div class="segmented" role="group" aria-label="View">
                  <button data-view="grid" aria-pressed="${s.view === "grid"}" aria-label="Grid view">${I("grid", "i-sm")}</button>
                  <button data-view="list" aria-pressed="${s.view === "list"}" aria-label="List view">${I("list", "i-sm")}</button>
                </div>
              </div>
            </div>
            <div class="active-chips" data-chips></div>
            <div data-results>${ui.skeletonCards(8)}</div>
          </section>
        </div>
      </div>`;
    },
    mount(el, _, q) {
      const s = stateFromQuery(q);
      let timer;
      const out = el.querySelector("[data-results]");

      function paint(withSkeleton) {
        const list = apply(s);
        el.querySelector("#res-count").innerHTML = `<b class="tnum">${list.length}</b> beat${list.length === 1 ? "" : "s"}${s.q ? ` for “${BF.esc(s.q)}”` : ""}`;
        el.querySelector("[data-sort-label]").textContent = SORTS.find((x) => x[0] === s.sort)[1];
        el.querySelectorAll("[data-sort]").forEach((m) => m.setAttribute("aria-checked", m.dataset.sort === s.sort));
        const chips = activeChips(s);
        el.querySelector("[data-chips]").innerHTML = chips.map(([k, v, l]) => `<button class="chip chip-removable" data-rm="${k}" data-v="${BF.esc(v)}" aria-label="Remove filter ${l}">${l} ${I("x", "i-xs x")}</button>`).join("") + (chips.length > 1 ? `<button class="link" style="font-size:13px;margin-left:4px" data-clear-all>Clear all</button>` : "");
        el.querySelector("[data-fcount]").textContent = chips.length ? `(${chips.length})` : "";
        el.querySelectorAll("[data-genre-quick]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.genreQuick ? s.genres.length === 1 && s.genres[0] === b.dataset.genreQuick : !s.genres.length));
        BF.setQuery(toQuery(s));
        void withSkeleton; clearTimeout(timer);
        if (searchError && s.q) { out.innerHTML = ui.empty({ kind: "error", icon: "alert", title: "Search isn’t responding", body: BF.esc(searchError.message), actions: `<button class="btn btn-primary" data-retry>${I("refresh", "i-sm")} Retry</button>` }); return; }
        // A skeleton only while the server search for this query is actually in flight
        if (list.pending) { out.innerHTML = s.view === "list" ? ui.skeletonRows(8) : ui.skeletonCards(8); return; }
        out.innerHTML = results(s, list); BF.player.sync();
      }
      function repaintFilters() { el.querySelector("[data-filters]").innerHTML = filterPanel(s, "d"); bindRanges(el.querySelector("[data-filters]")); }

      function bindRanges(scope) {
        scope.querySelectorAll("[data-range]").forEach((r) => {
          const [a, b] = r.querySelectorAll("input"); const key = r.dataset.range; const min = +r.dataset.min, max = +r.dataset.max;
          const fill = () => {
            let lo = +a.value, hi = +b.value; if (lo > hi) [lo, hi] = [hi, lo];
            r.querySelector(".fill").style.left = ((lo - min) / (max - min)) * 100 + "%";
            r.querySelector(".fill").style.right = (1 - (hi - min) / (max - min)) * 100 + "%";
            const pre = key === "price" ? "$" : "";
            r.parentElement.querySelector('[data-rv="0"]').textContent = pre + lo;
            r.parentElement.querySelector('[data-rv="1"]').textContent = pre + hi + (hi === max ? "+" : "");
            return [lo, hi];
          };
          fill();
          const commit = () => { s[key] = fill(); s.page = 1; paint(true); };
          [a, b].forEach((inp) => { inp.addEventListener("input", fill); inp.addEventListener("change", commit); });
        });
      }
      bindRanges(el);

      el.addEventListener("change", (e) => {
        const f = e.target.dataset.f; if (!f) return;
        if (e.target.closest(".drawer")) return;
        s[f] = e.target.checked ? [...s[f], e.target.value] : s[f].filter((x) => x !== e.target.value);
        s.page = 1; paint(true);
      });

      el.addEventListener("click", (e) => {
        const t = e.target;
        const chip = t.closest("[data-f-chip]");
        if (chip && !chip.closest(".drawer")) { const k = chip.dataset.fChip, v = chip.dataset.v; s[k] = s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v]; chip.setAttribute("aria-pressed", s[k].includes(v)); s.page = 1; paint(true); }
        const pre = t.closest("[data-bpm-preset]");
        if (pre && !pre.closest(".drawer")) { s.bpm = pre.dataset.bpmPreset.split("-").map(Number); repaintFilters(); paint(true); }
        const gq = t.closest("[data-genre-quick]");
        if (gq) { s.genres = gq.dataset.genreQuick ? [gq.dataset.genreQuick] : []; s.page = 1; repaintFilters(); paint(true); }
        const rm = t.closest("[data-rm]");
        if (rm) {
          const k = rm.dataset.rm, v = rm.dataset.v;
          if (k === "q") { s.q = ""; el.querySelector("#dq").value = ""; } else if (k === "bpm") s.bpm = [60, 180]; else if (k === "price") s.price = [0, 60]; else s[k] = s[k].filter((x) => x !== v);
          repaintFilters(); paint(true);
        }
        if (t.closest("[data-clear-all]")) { Object.assign(s, { q: "", genres: [], moods: [], keys: [], lic: [], bpm: [60, 180], price: [0, 60], page: 1 }); el.querySelector("#dq").value = ""; repaintFilters(); paint(true); }
        const so = t.closest("[data-sort]"); if (so) { s.sort = so.dataset.sort; paint(true); }
        const v = t.closest("[data-view]"); if (v) { s.view = v.dataset.view; BF.store.set("view", s.view); el.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b === v)); paint(false); }
        if (t.closest("[data-more]")) { s.page++; paint(false); }
        if (t.closest("[data-retry]")) { searchError = null; paint(true); }
        if (t.closest("[data-open-filters]")) openFilterDrawer();
      });

      el.querySelector("[data-disc-search]").addEventListener("submit", (e) => { e.preventDefault(); s.q = el.querySelector("#dq").value.trim(); if (s.q) BF.store.pushRecentSearch(s.q); s.page = 1; paint(true); });
      let deb; el.querySelector("#dq").addEventListener("input", (e) => { clearTimeout(deb); deb = setTimeout(() => { s.q = e.target.value.trim(); s.page = 1; paint(false); }, 250); });

      /* Mobile/tablet: filters in a drawer with staged changes + live count */
      function openFilterDrawer() {
        const draft = JSON.parse(JSON.stringify(s));
        const label = () => `Show ${apply(draft).length} beats`;
        BF.ui.drawer({
          title: "Filters", side: "left",
          body: `<div data-dfilters>${filterPanel(draft, "m")}</div>`,
          foot: `<button class="btn btn-ghost" data-dclear>Clear</button><button class="btn btn-primary" style="flex:1" data-dapply>${label()}</button>`,
          onMount(dr, close) {
            const refresh = () => (dr.querySelector("[data-dapply]").textContent = label());
            const rebind = () => { dr.querySelector("[data-dfilters]").innerHTML = filterPanel(draft, "m"); bindDraftRanges(); refresh(); };
            function bindDraftRanges() {
              dr.querySelectorAll("[data-range]").forEach((r) => {
                const [a, b] = r.querySelectorAll("input"); const key = r.dataset.range; const min = +r.dataset.min, max = +r.dataset.max;
                const fill = () => { let lo = +a.value, hi = +b.value; if (lo > hi) [lo, hi] = [hi, lo]; r.querySelector(".fill").style.left = ((lo - min) / (max - min)) * 100 + "%"; r.querySelector(".fill").style.right = (1 - (hi - min) / (max - min)) * 100 + "%"; const pre = key === "price" ? "$" : ""; r.parentElement.querySelector('[data-rv="0"]').textContent = pre + lo; r.parentElement.querySelector('[data-rv="1"]').textContent = pre + hi; draft[key] = [lo, hi]; refresh(); };
                fill(); [a, b].forEach((i) => i.addEventListener("input", fill));
              });
            }
            bindDraftRanges();
            dr.addEventListener("change", (e) => { const f = e.target.dataset.f; if (!f) return; draft[f] = e.target.checked ? [...draft[f], e.target.value] : draft[f].filter((x) => x !== e.target.value); refresh(); });
            dr.addEventListener("click", (e) => {
              const chip = e.target.closest("[data-f-chip]");
              if (chip) { const k = chip.dataset.fChip, v = chip.dataset.v; draft[k] = draft[k].includes(v) ? draft[k].filter((x) => x !== v) : [...draft[k], v]; chip.setAttribute("aria-pressed", draft[k].includes(v)); refresh(); }
              const pre = e.target.closest("[data-bpm-preset]"); if (pre) { draft.bpm = pre.dataset.bpmPreset.split("-").map(Number); rebind(); }
              if (e.target.closest("[data-dclear]")) { Object.assign(draft, { genres: [], moods: [], keys: [], lic: [], bpm: [60, 180], price: [0, 60] }); rebind(); }
              if (e.target.closest("[data-dapply]")) { Object.assign(s, draft, { page: 1 }); close(); repaintFilters(); paint(true); }
            });
          },
        });
      }

      onHits = () => paint(false);
      paint(true);
      return () => { clearTimeout(timer); onHits = null; };
    },
  });

  /* ---------- Producer directory ---------- */
  BF.route("/beats/producers", {
    title: "Producers",
    render() {
      const list = [...BF.PRODUCERS].sort((a, b) => b.followers - a.followers);
      return `<div class="container" style="padding-top:32px">
        <span class="eyebrow">Storefronts</span><h1 class="h1" style="margin:8px 0 8px">Producers</h1>
        <p class="muted" style="max-width:560px;margin-bottom:28px">Every storefront shows the producer’s verification status, ratings from verified buyers, and response time.</p>
        <div class="producer-grid">${list.map(ui.producerCard).join("")}</div></div>`;
    },
  });
})();
