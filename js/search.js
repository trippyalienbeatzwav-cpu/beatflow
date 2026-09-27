/* ==========================================================================
   Global search — command-palette overlay (⌘K / Ctrl+K / "/"). Suggestions
   come from the server's full-text search (BF.api.search), grouped by store,
   plus recent searches on this device and popular searches from the server.
   Full results live at #/search?q=.
   ========================================================================== */
(function () {
  const I = BF.icon;

  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hl = (text, q) => {
    const t = BF.esc(text); if (!q) return t;
    const i = norm(text).indexOf(norm(q)); if (i < 0) return t;
    return BF.esc(text.slice(0, i)) + "<mark>" + BF.esc(text.slice(i, i + q.length)) + "</mark>" + BF.esc(text.slice(i + q.length));
  };

  const p0 = (q, m) => m.parsed.text || q;
  let overlay = null;

  /** Popular searches from the server (last 7 days); a few suggestions until there is traffic. */
  const trendingFor = () => BF.TRENDING_SEARCHES ?? [];

  /** Search overlay. Scoped to the current store by default; "Search both marketplaces" is an explicit toggle. */
  function open(initial = "") {
    if (overlay) return;
    const scope = BF.currentMarketplace();          // "beats" | "electronic" | null (platform pages)
    let both = !scope;
    const placeholder = () => (both ? "Search both marketplaces…" : scope === "beats" ? "Search beats, producers, packs, BPM…" : "Search tracks, releases, artists, labels, BPM, key…");
    overlay = document.createElement("div");
    overlay.className = "search-overlay";
    overlay.dataset.eco = scope || "platform";
    overlay.innerHTML = `<div class="search-panel" role="dialog" aria-modal="true" aria-label="Search">
      <div class="search-input-row">${I("search")}
        <input type="search" id="gsearch" placeholder="${placeholder()}" autocomplete="off" spellcheck="false"
          role="combobox" aria-expanded="true" aria-controls="gs-results" aria-autocomplete="list" value="${BF.esc(initial)}" autofocus>
        <button class="btn btn-sm btn-ghost" data-close>Esc</button></div>
      <div class="search-scope" data-scope></div>
      <div class="search-results" id="gs-results" role="listbox" aria-label="Suggestions"></div>
      <div class="search-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span><span><span class="kbd">↵</span> open</span><span><span class="kbd">esc</span> close</span><span style="margin-left:auto">${scope === "beats" ? "Try “dark trap 140”" : "Try “124 BPM melodic techno” or “8A”"}</span></div>
    </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    const input = overlay.querySelector("input");
    const results = overlay.querySelector("#gs-results");
    let active = -1;

    const close = () => { release(); overlay.remove(); overlay = null; if (!BF.$(".modal-backdrop, .drawer, .player-sheet")) document.body.style.overflow = ""; };
    const release = BF.trap(overlay, close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-close]")) close(); });
    const go = (href, q) => { if (q) BF.store.pushRecentSearch(q); close(); location.hash = href; };
    const resultsPage = (q) => `${both ? "#/search" : BF.MARKETPLACES[scope].search}?q=${encodeURIComponent(q)}`;

    const paintScope = () => {
      overlay.querySelector("[data-scope]").innerHTML = scope
        ? `<span>${I(scope === "beats" ? "mic" : "headphones", "i-xs")} Searching <b>${both ? "both marketplaces" : BF.MARKETPLACES[scope].name}</b></span>
           <button class="scope-toggle" data-both aria-pressed="${both}">${both ? `Only ${BF.MARKETPLACES[scope].name}` : "Search both marketplaces"}</button>`
        : `<span>${I("search", "i-xs")} Searching <b>both marketplaces</b> · results are grouped by store</span>`;
      input.placeholder = placeholder();
    };

    const item = (href, art, title, sub, kind, q, round) => `<a class="search-item" role="option" aria-selected="false" href="${href}" data-q="${BF.esc(q || "")}">
      ${art ? `<div class="${round ? "avatar sm" : "art sm"}" style="${round ? "width:40px;height:40px" : ""}"><img src="${art}" alt=""></div>` : `<div class="state-icon" style="width:40px;height:40px;border-radius:8px;margin:0">${I(kind === "recent" ? "clock" : kind === "trend" ? "trend-up" : "search", "i-sm")}</div>`}
      <div class="meta"><div class="truncate" style="font-weight:550">${title}</div>${sub ? `<div class="subtle truncate" style="font-size:12.5px">${sub}</div>` : ""}</div>
      <span class="kind">${kind === "recent" || kind === "trend" ? "" : kind}</span></a>`;
    const storeHead = (m) => `<div class="search-store-head" data-m="${m}">${I(m === "beats" ? "mic" : "headphones", "i-xs")} ${BF.MARKETPLACES[m].name}</div>`;

    function beatsBlock(q, r) {
      return (r.beats.beats.length ? `<div class="search-group-label"><span>Beats</span><span>${r.beats.totalBeats}</span></div>` + r.beats.beats.map((b) => item(`#/beats/beat/${b.id}`, b.art, hl(b.title, q), `${BF.esc(BF.producerOf(b).name)} · ${b.bpm} BPM · ${b.key} · ${BF.genreById[b.genre].name}`, "Beat", q)).join("") : "") +
        (r.packs.length ? `<div class="search-group-label"><span>Packs</span></div>` + r.packs.slice(0, 3).map((k) => item(`#/beats/pack/${k.id}`, k.art, hl(k.title, q), `${BF.PACK_TYPES[k.type]} · ${BF.esc(BF.producerById[k.producerId].name)}`, "Pack", q)).join("") : "") +
        (r.beats.producers.length ? `<div class="search-group-label"><span>Producers</span></div>` + r.beats.producers.map((p) => item(`#/beats/producer/${p.handle}`, p.avatar, hl(p.name, q) + (p.verified ? " " + BF.verifiedSeal() : ""), `${BF.num(p.followers)} followers · ${BF.esc(p.location)}`, "Producer", q, true)).join("") : "") +
        (r.beats.genres?.length ? `<div class="search-group-label"><span>Genres</span></div>` + r.beats.genres.map((g) => item(`#/beats/catalog?genre=${g.id}`, BF.art(g.id, g.style, g.palette), hl(g.name, q), `${g.count.toLocaleString()} beats`, "Genre", q)).join("") : "");
    }
    function musicBlock(q, m) {
      return (m.parsed.any ? `<a class="search-item parsed-item" role="option" aria-selected="false" href="${BF.musicQueryToStore(m.parsed)}" data-q="${BF.esc(q)}"><div class="state-icon" style="width:40px;height:40px;border-radius:4px;margin:0">${I("sliders", "i-sm")}</div><div class="meta"><div style="font-weight:550">Open in the Electronic Music Store with these filters</div><div class="parsed" style="margin:4px 0 0">${BF.parsedChips(m.parsed)}</div></div><span class="kind">${m.totalTracks} tracks</span></a>` : "") +
        (m.tracks.length ? `<div class="search-group-label"><span>Tracks</span><span>${m.totalTracks}</span></div>` + m.tracks.map((t) => item(`#/electronic/release/${t.releaseId}?t=${t.id}`, t.art, hl(BF.trackTitle(t), p0(q, m)), `${BF.esc(BF.artistNames(t.artistIds))} · ${BF.esc(BF.labelName(t.labelId))} · ${t.bpm} BPM · ${t.camelot}`, "Track", q)).join("") : "") +
        (m.releases.length ? `<div class="search-group-label"><span>Releases</span></div>` + m.releases.slice(0, 3).map((x) => item(`#/electronic/release/${x.id}`, x.art, hl(x.title, p0(q, m)), `${BF.releaseTypeName(x.type)} · ${BF.esc(BF.artistNames(x.artistIds))} · <span class="mono">${x.cat}</span>`, "Release", q)).join("") : "") +
        (m.artists.length ? `<div class="search-group-label"><span>Artists</span></div>` + m.artists.map((a) => item(`#/electronic/artist/${a.handle}`, a.avatar, hl(a.name, q) + (a.verified ? " " + BF.verifiedSeal() : ""), `${BF.num(a.followers)} followers · ${BF.esc(a.city)}`, "Artist", q, true)).join("") : "") +
        (m.labels.length ? `<div class="search-group-label"><span>Labels</span></div>` + m.labels.map((l) => item(`#/electronic/label/${l.id}`, BF.banner("label-" + l.id, l.palette), hl(l.name, q), `${l.releaseIds.length} releases · ${BF.esc(l.city)}`, "Label", q)).join("") : "");
    }

    let searchSeq = 0;
    async function renderResults() {
      const q = input.value.trim();
      active = -1;
      paintScope();
      if (!q) {
        const rec = BF.store.get("recentSearches");
        const trendFor = (m) => `<div class="search-group-label"><span>Popular searches</span></div>${trendingFor().slice(0, 6).map((t) => item(`${BF.MARKETPLACES[m].search}?q=${encodeURIComponent(t)}`, "", BF.esc(t), "", "trend", t)).join("")}`;
        results.innerHTML = (rec.length ? `<div class="search-group-label"><span>Recent</span><button class="link" style="font-size:11px" data-clear-recent>Clear</button></div>${rec.map((r) => item(resultsPage(r), "", BF.esc(r), "", "recent", r)).join("")}` : "") +
          trendFor(both ? "electronic" : scope) +
          (!both && scope === "beats" ? `<div class="search-group-label"><span>Beat genres</span></div><div class="chip-wrap" style="padding:4px 10px 10px">${BF.GENRES.map((g) => `<a class="chip" href="#/beats/catalog?genre=${g.id}" data-close>${g.name}</a>`).join("")}</div>` : "") +
          (!both && scope === "electronic" ? `<div class="search-group-label"><span>Genres</span></div><div class="chip-wrap" style="padding:4px 10px 10px">${BF.egenres().filter((g) => g.visible !== false).slice(0, 12).map((g) => `<a class="chip" href="#/electronic/genre/${g.id}" data-close>${BF.esc(g.name)}</a>`).join("")}</div>` : "");
        return;
      }
      const seq = ++searchSeq;
      results.setAttribute("aria-busy", "true");
      let r;
      try { r = await BF.api.search(q.slice(0, 200), { marketplace: both ? undefined : scope, limit: 4 }); }
      catch (err) { if (seq === searchSeq) { results.removeAttribute("aria-busy"); results.innerHTML = BF.ui.empty({ kind: "error", icon: "alert", title: "Search isn’t responding", body: BF.esc(err.message) }); } return; }
      if (seq !== searchSeq || !overlay) return;   // a newer query is on its way
      results.removeAttribute("aria-busy");
      const bh = r.beats ? beatsBlock(q, r) : "", mh = r.electronic ? musicBlock(q, r.electronic) : "";
      if (!bh && !mh) {
        results.innerHTML = BF.ui.empty({ icon: "search", title: `No matches for “${BF.esc(q)}”`, body: both ? "Nothing in either store. Try a genre, a key like “8A”, or a BPM." : `Nothing in the ${BF.MARKETPLACES[scope].name}. Try a broader term — or search both marketplaces.` });
        return;
      }
      const counts = [r.beats ? `${r.beats.totalBeats || 0} beats` : "", r.electronic ? `${r.electronic.totalTracks} tracks` : ""].filter(Boolean).join(" · ");
      results.innerHTML = item(resultsPage(q), "", `See all results for “<b>${BF.esc(q)}</b>”`, counts, "search", q) +
        (both ? (bh ? storeHead("beats") + bh : "") + (mh ? storeHead("electronic") + mh : "") : bh + mh);
    }

    let deb;
    input.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(renderResults, 160); });
    input.addEventListener("keydown", (e) => {
      const items = BF.$$(".search-item", results);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach((it, i) => it.setAttribute("aria-selected", i === active));
        items[active]?.scrollIntoView({ block: "nearest" });
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const it = items[active];
        if (it) go(it.getAttribute("href"), input.value.trim() || it.dataset.q);
        else if (input.value.trim()) go(resultsPage(input.value.trim()), input.value.trim());
      }
    });
    overlay.addEventListener("click", (e) => { if (e.target.closest("[data-both]")) { both = !both; renderResults(); input.focus(); } });
    results.addEventListener("click", (e) => {
      if (e.target.closest("[data-clear-recent]")) { BF.store.set("recentSearches", []); renderResults(); input.focus(); return; }
      const a = e.target.closest(".search-item");
      if (a) { e.preventDefault(); go(a.getAttribute("href"), input.value.trim() || a.dataset.q); }
      if (e.target.closest("a.chip")) close();
    });
    renderResults();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  BF.search = { open };
  document.addEventListener("keydown", (e) => {
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !e.target.closest?.("input, textarea, select, [contenteditable]"))) {
      e.preventDefault(); open();
    }
  });
})();
