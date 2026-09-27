/* ==========================================================================
   Electronic marketplace — pages.
   Every route declares eco: "electronic" so the shell applies the electronic
   identity (tokens, sub-navigation) while keeping the shared account, cart,
   player and library.
   ========================================================================== */
(function () {
  const I = BF.icon, ui = BF.ui, M = BF.mui, esc = BF.esc;

  /* ---------- Rankings (charts are data-driven, never editorial) ---------- */
  const chartOf = (tracks) => [...tracks].sort((a, b) => b.downloads - a.downloads || b.trendScore - a.trendScore);
  const moves = (n, seed) => { const r = BF.rng(seed); return Array.from({ length: n }, () => { const x = r(); return x < 0.12 ? "new" : x < 0.3 ? 0 : Math.round((r() - 0.45) * 12) || 1; }); };
  const trending = (tracks) => [...tracks].sort((a, b) => b.trendScore - a.trendScore);
  const sellable = () => BF.sellableTracks();
  const visibleGenres = () => BF.egenres().filter((g) => g.visible !== false);

  /* ---------- Smart search box (understands BPM, key, genre, label, type) ---------- */
  const smartSearch = (id, value = "", big = false) => `<form class="msearch ${big ? "big" : ""}" role="search" data-msearch>
      ${I("search", "i-sm")}<label class="sr-only" for="${id}">Search tracks, artists, labels, BPM or key</label>
      <input id="${id}" class="input" value="${esc(value)}" placeholder="Try “124 BPM melodic techno” or “8A deep house”" autocomplete="off">
      <button class="btn btn-sm btn-primary">Search</button></form><div class="parsed" data-parsed aria-live="polite"></div>`;
  function parsedChips(p) {
    const chips = [];
    if (p.bpm) chips.push(`${p.bpm[0]}–${p.bpm[1]} BPM`);
    p.keys.forEach((k) => chips.push(`Key ${k}`));
    p.genres.forEach((g) => chips.push(BF.egenre(g).name));
    p.labels.forEach((l) => chips.push(BF.labelById[l].name));
    p.artists.forEach((a) => chips.push(BF.eartistById[a].name));
    p.types.forEach((t) => chips.push(BF.releaseTypeName(t)));
    if (p.cat) chips.push("Cat. " + BF.releaseById[p.cat].cat);
    if (p.text) chips.push(`“${esc(p.text)}”`);
    return chips.length ? `<span class="subtle" style="font-size:12px">Understood:</span> ${chips.map((c) => `<span class="pchip">${c}</span>`).join("")}` : "";
  }
  const queryToStore = (p) => {
    const q = new URLSearchParams();
    if (p.text) q.set("q", p.text);
    if (p.bpm) q.set("bpm", p.bpm.join("-"));
    if (p.keys.length) q.set("key", p.keys.join(","));
    if (p.genres.length) q.set("genre", p.genres.join(","));
    if (p.labels.length) q.set("label", p.labels.join(","));
    if (p.artists.length) q.set("artist", p.artists.join(","));
    if (p.types.length) { q.set("type", p.types.join(",")); q.set("view", "releases"); }
    return "#/electronic/discover" + (q.toString() ? "?" + q : "");
  };
  function bindSmartSearch(el) {
    el.querySelectorAll("[data-msearch]").forEach((f) => {
      const inp = f.querySelector("input"), out = f.nextElementSibling;
      const upd = () => (out.innerHTML = inp.value.trim() ? parsedChips(BF.parseMusicQuery(inp.value)) : "");
      inp.addEventListener("input", upd); upd();
      f.addEventListener("submit", (e) => {
        e.preventDefault(); const v = inp.value.trim(); if (!v) return;
        BF.store.pushRecentSearch(v);
        const p = BF.parseMusicQuery(v);
        if (p.cat) { location.hash = `#/electronic/release/${p.cat}`; return; }
        location.hash = queryToStore(p);
      });
    });
  }
  BF.musicQueryToStore = queryToStore;
  BF.parsedChips = parsedChips;

  const rail = (inner, cls = "cols-6") => `<div class="rail ${cls}">${inner}</div>`;

  /* ======================================================================
     HOME
     ====================================================================== */
  function home() {
    const newest = [...BF.RELEASES].filter((r) => !BF.isPack(r)).sort((a, b) => b.date.localeCompare(a.date));
    const trend = trending(sellable()).slice(0, 10);
    const top = chartOf(sellable()).slice(0, 5);
    const feat = BF.releaseById.r2, ft = BF.trackById[feat.trackIds[0]];
    const recentGenres = [...new Set([...BF.store.get("recent"), ...BF.store.get("favorites")].map((id) => BF.trackById[id]?.genre).filter(Boolean))];
    const recGenres = recentGenres.length ? recentGenres : ["melodic-techno", "deep-house"];
    const seedTrack = BF.trackById[BF.store.get("recent")[0]];
    const recommended = sellable().filter((t) => recGenres.includes(t.genre) && !BF.store.get("recent").includes(t.id)).slice(0, 6);
    const underground = sellable().filter((t) => t.plays < 45000 && t.energy >= 5).slice(0, 6);
    const recentlyAdded = [...sellable()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 6);
    const spotLabel = BF.labelById.voidsignal, spotArtist = BF.eartistById.a1;
    return `
    <section class="ehero">
      <div class="container ehero-grid">
        <div class="ehero-copy">
          <span class="ehead-label">${BF.brand.name} · Electronic</span>
          <h1 class="edisplay">Discover your<br>next sound.</h1>
          <p class="ehero-sub">Explore electronic music from independent producers, DJs, and labels. Lossless downloads, harmonic keys and DJ-ready previews on every track.</p>
          ${smartSearch("ehs", "", true)}
          <div class="ehero-stats"><div><b>${BF.RELEASES.length}</b><span>releases</span></div><div><b>${BF.LABELS.length}</b><span>labels</span></div><div><b>${visibleGenres().length}</b><span>genres</span></div><div><b>WAV · AIFF · MP3</b><span>formats</span></div></div>
        </div>
        <div class="efeature" data-queue="${feat.trackIds.join(",")}" data-beat-card="${ft.id}">
          <a href="#/electronic/release/${feat.id}" class="efeature-art"><img src="${feat.art}" alt="Cover of ${esc(feat.title)}"></a>
          <div class="efeature-meta">
            <div><span class="ehead-label">New on ${esc(BF.labelById.bfr.name)}</span><a class="efeature-title" href="#/electronic/release/${feat.id}">${esc(feat.title)}</a><span class="muted">${M.artistLinks(feat.artistIds)}</span></div>
            ${ui.playBtn(ft.id, "lg accent")}
          </div>
          ${ui.waveform(ft, { bars: 110, markers: true, cls: "big" })}
          <div class="efeature-foot"><span class="spec"><span class="hl">${ft.bpm} BPM</span><span>${ft.key}</span><span>${ft.camelot}</span><span>${BF.egenre(ft.genre).name}</span></span>${M.buyBtn("track", ft.id)}</div>
        </div>
      </div>
    </section>

    <div class="container">
      <div class="egenre-strip" role="navigation" aria-label="Genres">${visibleGenres().map((g) => `<a class="chip" href="#/electronic/genre/${g.id}">${esc(g.name)}</a>`).join("")}</div>

      <section class="esec">${M.sectionHead("Out now", "New Releases", `<a class="see-all" href="#/electronic/discover?sort=newest&view=releases">All new releases ${I("arrow-right", "i-xs")}</a>`)}
        <div class="rgrid">${newest.slice(0, 6).map((r, i) => M.releaseCard(r, { size: i === 0 ? "lead" : "" })).join("")}</div></section>

      <section class="esec">${M.sectionHead(`<span class="chart-pill">${I("chart", "i-xs")} Chart</span> Ranked by 7-day downloads`, "Trending Tracks", `<a class="see-all" href="#/electronic/charts">Full charts ${I("arrow-right", "i-xs")}</a>`, "ranked")}
        ${M.trackList(trend, { rank: true, move: moves(10, 7) })}</section>

      <section class="esec" id="essentials">${M.sectionHead(`<span class="ed-pill">${I("sparkle", "i-xs")} Curated</span> For working DJs`, "DJ Essentials", "", "editorial")}
        <div class="edgrid">${BF.COLLECTIONS.map(M.editorialCard).join("")}</div></section>

      <div class="esplit">
        <section class="esec">${M.sectionHead(`<span class="chart-pill">${I("chart", "i-xs")} Chart</span> All-time`, "Top Downloads", `<a class="see-all" href="#/electronic/charts?tab=top100">Top 100 ${I("arrow-right", "i-xs")}</a>`, "ranked")}
          ${M.trackList(top, { rank: true, move: moves(5, 11), head: false })}</section>
        <section class="esec">${M.sectionHead("Recently added", "Fresh to the store", "")}
          ${M.trackList(recentlyAdded.slice(0, 5), { head: false })}</section>
      </div>

      <section class="esec">${M.sectionHead("Labels", "Featured Labels", `<a class="see-all" href="#/electronic/labels">All labels ${I("arrow-right", "i-xs")}</a>`)}
        <div class="lgrid">${BF.LABELS.slice(0, 4).map(M.labelCard).join("")}</div></section>

      <section class="esec spotlight">
        <a class="spot" href="#/electronic/label/${spotLabel.id}"><img src="${spotLabel.banner}" alt=""><div class="spot-body"><span class="ed-tag">${I("sparkle", "i-xs")} Label spotlight</span>${M.labelLogo(spotLabel, 56)}<h3>${esc(spotLabel.name)}</h3><p>${esc(spotLabel.bio)}</p><span class="link">Visit the label ${I("arrow-right", "i-xs")}</span></div></a>
        <a class="spot" href="#/electronic/artist/${spotArtist.handle}"><img src="${spotArtist.banner}" alt=""><div class="spot-body"><span class="ed-tag">${I("sparkle", "i-xs")} Artist spotlight</span><span class="avatar lg"><img src="${spotArtist.avatar}" alt=""></span><h3>${esc(spotArtist.name)}</h3><p>${esc(spotArtist.bio)}</p><span class="link">Open profile ${I("arrow-right", "i-xs")}</span></div></a>
      </section>

      <section class="esec">${M.sectionHead("Artists", "Featured Artists", `<a class="see-all" href="#/electronic/artists">All artists ${I("arrow-right", "i-xs")}</a>`)}
        ${rail(BF.EARTISTS.slice(0, 8).map(M.artistCard).join(""), "cols-6")}</section>

      <section class="esec">${M.sectionHead("Browse by sound", "Genre Collections", "")}
        <div class="ggrid">${visibleGenres().slice(0, 12).map((g) => M.genreTile(g, sellable().filter((t) => t.genre === g.id).length)).join("")}</div>
        <details class="more-genres"><summary class="btn btn-secondary btn-sm">All ${visibleGenres().length} genres ${I("chevron-down", "i-xs")}</summary><div class="ggrid" style="margin-top:12px">${visibleGenres().slice(12).map((g) => M.genreTile(g, sellable().filter((t) => t.genre === g.id).length)).join("")}</div></details></section>

      <section class="esec">${M.sectionHead("For you", "Recommended For You", "")}
        <p class="subtle" style="font-size:13px;margin:-8px 0 14px">${seedTrack ? `Because you played <a class="link" href="#/electronic/release/${seedTrack.releaseId}?t=${seedTrack.id}">${esc(BF.trackTitle(seedTrack))}</a> · ` : ""}based on ${recGenres.map((g) => BF.egenre(g).name).join(", ")}</p>
        ${M.trackList(recommended, { head: false, emptyTitle: "Play a few tracks", emptyBody: "Recommendations tune to what you preview, favorite and buy." })}</section>

      <section class="esec">${M.sectionHead(`<span class="ed-pill">${I("sparkle", "i-xs")} Curated</span> Under 45K plays`, "Underground Picks", "", "editorial")}
        ${M.trackList(underground, { head: false })}</section>


      <section class="esec"><div class="esell">
        <div><span class="ehead-label">For artists &amp; labels</span><h2 class="edisplay" style="font-size:clamp(2rem,4vw,3.2rem)">Release your music here.</h2>
          <p class="muted" style="max-width:520px;margin:10px 0 20px">Singles, EPs, albums, remixes, compilations and DJ tools — lossless delivery, ISRC-ready metadata, label storefronts and sales analytics by track, format and country.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-primary btn-lg" href="#/dashboard/release-upload">${I("cloud-upload", "i-sm")} Upload a release</a><a class="btn btn-ghost btn-lg" href="#/dashboard/music">See label analytics</a></div></div>
        <ul class="esell-list">${["WAV, AIFF & MP3 delivery", "Per-track and full-release pricing", "Label storefront with verified badge", "Charts, downloads & geographic sales"].map((x) => `<li>${I("check", "i-sm")} ${x}</li>`).join("")}</ul>
      </div></section>
    </div><div style="height:48px"></div>`;
  }

  BF.route("/electronic", { title: "Electronic Music", eco: "electronic", ecoActive: "home", render: home, mount(el) {
    bindSmartSearch(el);
    if (location.hash.includes("#essentials")) setTimeout(() => document.getElementById("essentials")?.scrollIntoView(), 50);
  } });

  /* ======================================================================
     STORE — DJ filters
     ====================================================================== */
  const SORTS = [["trending", "Trending"], ["newest", "Newest"], ["downloads", "Top downloads"], ["bpm-asc", "BPM: low → high"], ["bpm-desc", "BPM: high → low"], ["price", "Price"]];
  const DATES = [["", "Any time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]];

  function sFromQuery(q) {
    const list = (v) => (v ? v.split(",").filter(Boolean) : []);
    const range = (v, d) => (v ? v.split("-").map(Number) : d);
    return { q: q.q || "", genres: list(q.genre), keys: list(q.key), compat: q.compat || "", labels: list(q.label), artists: list(q.artist), types: list(q.type),
      bpm: range(q.bpm, [60, 200]), energy: range(q.energy, [1, 10]), price: range(q.price, [0, 30]), date: q.date || "", sort: q.sort || "trending", view: q.view || "tracks", collection: q.collection || "", page: 1 };
  }
  function sToQuery(s) {
    return { q: s.q, genre: s.genres.join(","), key: s.keys.join(","), compat: s.compat, label: s.labels.join(","), artist: s.artists.join(","), type: s.types.join(","),
      bpm: s.bpm[0] === 60 && s.bpm[1] === 200 ? "" : s.bpm.join("-"), energy: s.energy[0] === 1 && s.energy[1] === 10 ? "" : s.energy.join("-"),
      price: s.price[0] === 0 && s.price[1] === 30 ? "" : s.price.join("-"), date: s.date, sort: s.sort === "trending" ? "" : s.sort, view: s.view === "tracks" ? "" : s.view, collection: s.collection };
  }
  function trackMatches(t, s) {
    if (s.genres.length && !s.genres.includes(t.genre)) return false;
    if (t.bpm < s.bpm[0] || t.bpm > s.bpm[1]) return false;
    if (t.energy < s.energy[0] || t.energy > s.energy[1]) return false;
    const keys = s.compat ? BF.compatibleCamelot(s.compat) : s.keys;
    if (keys.length && !keys.includes(t.camelot)) return false;
    if (s.labels.length && !s.labels.includes(t.labelId || "independent")) return false;
    if (s.artists.length && !t.artistIds.concat(t.remixerId || []).some((a) => s.artists.includes(a))) return false;
    if (s.date && BF.daysSince(t.date) > +s.date) return false;
    const rel = BF.releaseById[t.releaseId];
    if (s.types.length && !s.types.includes(rel.type)) return false;
    const price = BF.isPack(rel) ? rel.packPrice : BF.trackPrice(t, BF.store.get("dlFormat"));
    if (price < s.price[0] || (s.price[1] < 30 && price > s.price[1])) return false;
    if (s.collection && !BF.collectionById[s.collection]?.filter(t)) return false;
    if (s.q) {
      const hay = [t.title, t.mix, BF.artistNames(t.artistIds), t.remixerId ? BF.eartistById[t.remixerId].name : "", BF.labelName(t.labelId), rel.title, rel.cat, BF.egenre(t.genre).name].join(" ").toLowerCase();
      if (!s.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  function applyStore(s) {
    const pool = s.collection ? BF.ETRACKS.filter((t) => !BF.isPack(BF.releaseById[t.releaseId]) || BF.releaseById[t.releaseId].type === "dj-tool") : BF.ETRACKS.filter((t) => !BF.isPack(BF.releaseById[t.releaseId]) || s.types.some((x) => ["sample-pack", "loops", "stems"].includes(x)));
    const list = pool.filter((t) => trackMatches(t, s));
    const sorts = { trending: (a, b) => b.trendScore - a.trendScore, newest: (a, b) => b.date.localeCompare(a.date), downloads: (a, b) => b.downloads - a.downloads, "bpm-asc": (a, b) => a.bpm - b.bpm, "bpm-desc": (a, b) => b.bpm - a.bpm, price: (a, b) => BF.trackPrice(a) - BF.trackPrice(b) };
    list.sort(sorts[s.sort] || sorts.trending);
    return list;
  }
  const countWith = (s, patch) => applyStore({ ...s, ...patch }).length;

  function storeFilters(s) {
    const grp = (title, icon, body, open, n) => `<details class="fgroup" ${open ? "open" : ""}><summary><span>${I(icon, "i-sm")} ${title}</span>${n ? `<span class="fcount">${n}</span>` : ""}${I("chevron-down", "i-sm chev")}</summary><div class="fbody">${body}</div></details>`;
    const dual = (key, min, max, step, val, fmt = (v) => v) => `<div class="dual-range" data-range="${key}" data-min="${min}" data-max="${max}"><div class="track"></div><div class="fill"></div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${val[0]}" aria-label="Minimum ${key}"><input type="range" min="${min}" max="${max}" step="${step}" value="${val[1]}" aria-label="Maximum ${key}"></div>
      <div class="range-values"><span data-rv="0">${fmt(val[0])}</span><span data-rv="1">${fmt(val[1])}</span></div>`;
    const gAll = visibleGenres();
    return `
      ${grp("Genre", "music", `<div class="genre-checks">${gAll.map((g, i) => `<label class="check ${i > 9 && !s.genres.includes(g.id) ? "more" : ""}"><input type="checkbox" data-f="genres" value="${g.id}" ${s.genres.includes(g.id) ? "checked" : ""}> ${esc(g.name)}<span class="count">${countWith(s, { genres: [g.id] })}</span></label>`).join("")}</div><button class="link" style="font-size:13px;margin-top:6px" data-more-genres>Show all ${gAll.length}</button>`, true, s.genres.length)}
      ${grp("BPM", "bpm", dual("bpm", 60, 200, 1, s.bpm) + `<div class="preset-row">${[["House", "118-128"], ["Techno", "128-140"], ["Trance", "134-140"], ["D&B", "170-176"]].map(([l, v]) => `<button class="chip" data-bpm-preset="${v}" style="height:28px;font-size:12px">${l}</button>`).join("")}</div>`, true, s.bpm[0] !== 60 || s.bpm[1] !== 200 ? 1 : 0)}
      ${grp("Key · Camelot", "key", `<div class="cam-grid" role="group" aria-label="Camelot keys">${BF.CAMELOT_WHEEL.map((k) => `<button class="cam ${k.endsWith("B") ? "maj" : ""}" style="--h:${M.camHue(k)}" data-key="${k}" aria-pressed="${s.keys.includes(k)}">${k}</button>`).join("")}</div>
        <label class="label" for="compat" style="margin-top:12px">Harmonic mix with</label><select class="select input-sm" id="compat" data-compat><option value="">Off</option>${BF.CAMELOT_WHEEL.map((k) => `<option ${s.compat === k ? "selected" : ""}>${k}</option>`).join("")}</select>
        <p class="hint" style="margin-top:6px">Shows the key, ±1 on the wheel and its relative major/minor.</p>`, s.keys.length || s.compat, s.keys.length + (s.compat ? 1 : 0))}
      ${grp("Energy", "bolt", dual("energy", 1, 10, 1, s.energy), true, s.energy[0] !== 1 || s.energy[1] !== 10 ? 1 : 0)}
      ${grp("Release date", "calendar", DATES.map(([v, l]) => `<label class="check"><input type="radio" name="edate" data-date value="${v}" ${s.date === v ? "checked" : ""}> ${l}</label>`).join(""), !!s.date, s.date ? 1 : 0)}
      ${grp("Label", "store", [...BF.LABELS.map((l) => [l.id, l.name]), ["independent", "Independent"]].map(([id, n]) => `<label class="check"><input type="checkbox" data-f="labels" value="${id}" ${s.labels.includes(id) ? "checked" : ""}> ${esc(n)}</label>`).join(""), s.labels.length, s.labels.length)}
      ${grp("Artist", "user", BF.EARTISTS.map((a) => `<label class="check"><input type="checkbox" data-f="artists" value="${a.id}" ${s.artists.includes(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join(""), s.artists.length, s.artists.length)}
      ${grp("Release type", "disc", `<div class="chip-wrap">${BF.RELEASE_TYPES.map(([id, n]) => `<button class="chip" data-type="${id}" aria-pressed="${s.types.includes(id)}" style="height:28px;font-size:12px">${n}</button>`).join("")}</div>`, s.types.length, s.types.length)}
      ${grp("Price", "tag", dual("price", 0, 30, 0.5, s.price, (v) => "$" + v), false, s.price[0] !== 0 || s.price[1] !== 30 ? 1 : 0)}`;
  }

  function chipsFor(s) {
    const c = [];
    if (s.collection) c.push(["collection", "", BF.collectionById[s.collection]?.title]);
    if (s.q) c.push(["q", "", `“${esc(s.q)}”`]);
    s.genres.forEach((g) => c.push(["genres", g, BF.egenre(g).name]));
    if (s.bpm[0] !== 60 || s.bpm[1] !== 200) c.push(["bpm", "", `${s.bpm[0]}–${s.bpm[1]} BPM`]);
    s.keys.forEach((k) => c.push(["keys", k, "Key " + k]));
    if (s.compat) c.push(["compat", "", "Mixes with " + s.compat]);
    if (s.energy[0] !== 1 || s.energy[1] !== 10) c.push(["energy", "", `Energy ${s.energy[0]}–${s.energy[1]}`]);
    if (s.date) c.push(["date", "", DATES.find((d) => d[0] === s.date)[1]]);
    s.labels.forEach((l) => c.push(["labels", l, BF.labelById[l]?.name || "Independent"]));
    s.artists.forEach((a) => c.push(["artists", a, BF.eartistById[a].name]));
    s.types.forEach((t) => c.push(["types", t, BF.releaseTypeName(t)]));
    if (s.price[0] !== 0 || s.price[1] !== 30) c.push(["price", "", `$${s.price[0]}–$${s.price[1]}`]);
    return c;
  }

  function storeResults(s, list) {
    if (s.view === "releases") {
      const rels = [...new Set(list.map((t) => t.releaseId))].map((id) => BF.releaseById[id]);
      if (!rels.length) return M.trackList([], { emptyActions: `<button class="btn btn-primary" data-clear>Clear filters</button>` });
      return `<div class="rgrid">${rels.slice(0, s.page * 18).map((r) => M.releaseCard(r)).join("")}</div>`;
    }
    const shown = list.slice(0, s.page * 25);
    return M.trackList(shown, { emptyActions: `<button class="btn btn-primary" data-clear>Clear filters</button>` }) + (list.length > shown.length ? `<div style="display:flex;justify-content:center;margin-top:28px"><button class="btn btn-secondary" data-more>Load more <span class="mono subtle">${list.length - shown.length}</span></button></div>` : list.length ? `<p class="subtle" style="text-align:center;margin-top:24px;font-size:13px">End of results · ${list.length} tracks</p>` : "");
  }

  function bindDual(scope, onChange, onCommit) {
    scope.querySelectorAll("[data-range]").forEach((r) => {
      const [a, b] = r.querySelectorAll("input"); const key = r.dataset.range; const min = +r.dataset.min, max = +r.dataset.max;
      const fill = () => {
        let lo = +a.value, hi = +b.value; if (lo > hi) [lo, hi] = [hi, lo];
        r.querySelector(".fill").style.left = ((lo - min) / (max - min)) * 100 + "%";
        r.querySelector(".fill").style.right = (1 - (hi - min) / (max - min)) * 100 + "%";
        const pre = key === "price" ? "$" : "";
        r.parentElement.querySelector('[data-rv="0"]').textContent = pre + lo;
        r.parentElement.querySelector('[data-rv="1"]').textContent = pre + hi;
        onChange && onChange(key, [lo, hi]);
        return [lo, hi];
      };
      fill();
      [a, b].forEach((inp) => { inp.addEventListener("input", fill); inp.addEventListener("change", () => onCommit(key, fill())); });
    });
  }

  function storePage(title, sub, q, extraTop = "") {
    const s = sFromQuery(q);
    const col = s.collection && BF.collectionById[s.collection];
    return `<div class="container estore">
      ${extraTop}
      <header class="estore-head">
        <div>${col ? `<span class="ed-tag">${I("sparkle", "i-xs")} Curated · ${esc(col.curator)}</span><h1 class="edisplay sm">${esc(col.title)}</h1><p class="muted">${esc(col.blurb)}</p>` : `<span class="ehead-label">${sub}</span><h1 class="edisplay sm">${title}</h1>`}</div>
        <div class="estore-search">${smartSearch("sq", s.q)}</div>
      </header>
      <div class="disc-layout">
        <aside class="filters" aria-label="Filters"><div class="filters-head"><h2 class="h4">Filters</h2><button class="link" style="font-size:13px" data-clear>Clear all</button></div><div data-filters>${storeFilters(s)}</div></aside>
        <section aria-labelledby="erc">
          <div class="toolbar">
            <button class="btn btn-secondary btn-sm filters-toggle" data-open-filters>${I("sliders", "i-sm")} Filters <span data-fcount></span></button>
            <p id="erc" class="res-count" aria-live="polite"></p>
            <div class="toolbar-right">
              <label class="sr-only" for="esort">Sort</label><select class="select input-sm" id="esort" style="width:auto" data-sort>${SORTS.map(([v, l]) => `<option value="${v}" ${s.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
              <div class="segmented" role="group" aria-label="View"><button data-view="tracks" aria-pressed="${s.view === "tracks"}">${I("list", "i-sm")}<span class="hide-sm">Tracks</span></button><button data-view="releases" aria-pressed="${s.view === "releases"}">${I("grid", "i-sm")}<span class="hide-sm">Releases</span></button></div>
            </div>
          </div>
          <div class="active-chips" data-chips></div>
          <div data-results>${ui.skeletonRows(8)}</div>
        </section>
      </div></div>`;
  }

  function mountStore(el, q, fixed = {}) {
    const s = { ...sFromQuery(q), ...fixed };
    const out = el.querySelector("[data-results]");
    let timer;
    const paint = (skeleton) => {
      const list = applyStore(s);
      const rels = new Set(list.map((t) => t.releaseId)).size;
      el.querySelector("#erc").innerHTML = s.view === "releases" ? `<b class="tnum">${rels}</b> release${rels === 1 ? "" : "s"}` : `<b class="tnum">${list.length}</b> track${list.length === 1 ? "" : "s"} · ${rels} release${rels === 1 ? "" : "s"}`;
      const chips = chipsFor(s).filter(([k, v]) => !(fixed.genres && k === "genres" && fixed.genres.includes(v)));
      el.querySelector("[data-chips]").innerHTML = chips.map(([k, v, l]) => `<button class="chip chip-removable" data-rm="${k}" data-v="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)} ${I("x", "i-xs x")}</button>`).join("") + (chips.length > 1 ? `<button class="link" style="font-size:13px" data-clear>Clear all</button>` : "");
      el.querySelector("[data-fcount]").textContent = chips.length ? `(${chips.length})` : "";
      if (!fixed.genres) BF.setQuery(sToQuery(s));
      const go = () => { out.innerHTML = storeResults(s, list); BF.player.sync(); };
      clearTimeout(timer);
      go(); // filtering is local and instant: no artificial skeleton delay
    };
    const refilter = () => { el.querySelector("[data-filters]").innerHTML = storeFilters(s); bindDual(el.querySelector("[data-filters]"), null, commitRange); };
    const commitRange = (k, v) => { s[k] = v; s.page = 1; paint(true); };
    bindDual(el, null, commitRange);
    bindSmartSearch(el);
    // Search box on the store applies parsed filters in place
    el.querySelector("[data-msearch]").addEventListener("submit", (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      const p = BF.parseMusicQuery(el.querySelector("#sq").value);
      s.q = p.text; if (p.bpm) s.bpm = p.bpm; if (p.keys.length) s.keys = p.keys; if (p.genres.length) s.genres = p.genres; if (p.labels.length) s.labels = p.labels; if (p.artists.length) s.artists = p.artists; if (p.types.length) { s.types = p.types; s.view = "releases"; }
      el.querySelector("#sq").value = s.q; el.querySelector("[data-parsed]").innerHTML = "";
      s.page = 1; refilter(); paint(true);
    }, true);

    el.addEventListener("change", (e) => {
      const t = e.target;
      if (t.closest(".drawer")) return;
      if (t.dataset.f) { s[t.dataset.f] = t.checked ? [...s[t.dataset.f], t.value] : s[t.dataset.f].filter((x) => x !== t.value); s.page = 1; paint(true); }
      if (t.matches("[data-date]")) { s.date = t.value; paint(true); }
      if (t.matches("[data-compat]")) { s.compat = t.value; if (t.value) s.keys = []; refilter(); paint(true); }
      if (t.matches("[data-sort]")) { s.sort = t.value; paint(true); }
    });
    el.addEventListener("click", (e) => {
      const t = e.target;
      const key = t.closest("[data-key]"); if (key && !key.closest(".drawer")) { const k = key.dataset.key; s.keys = s.keys.includes(k) ? s.keys.filter((x) => x !== k) : [...s.keys, k]; key.setAttribute("aria-pressed", s.keys.includes(k)); paint(true); }
      const ty = t.closest("[data-type]"); if (ty && !ty.closest(".drawer")) { const k = ty.dataset.type; s.types = s.types.includes(k) ? s.types.filter((x) => x !== k) : [...s.types, k]; ty.setAttribute("aria-pressed", s.types.includes(k)); paint(true); }
      const pre = t.closest("[data-bpm-preset]"); if (pre && !pre.closest(".drawer")) { s.bpm = pre.dataset.bpmPreset.split("-").map(Number); refilter(); paint(true); }
      if (t.closest("[data-more-genres]")) { el.querySelectorAll(".genre-checks .more").forEach((x) => x.classList.remove("more")); t.closest("[data-more-genres]").remove(); }
      const rm = t.closest("[data-rm]");
      if (rm) { const k = rm.dataset.rm, v = rm.dataset.v; if (["q", "compat", "date", "collection"].includes(k)) s[k] = ""; else if (k === "bpm") s.bpm = [60, 200]; else if (k === "energy") s.energy = [1, 10]; else if (k === "price") s.price = [0, 30]; else s[k] = s[k].filter((x) => x !== v); if (k === "q") el.querySelector("#sq").value = ""; refilter(); paint(true); }
      if (t.closest("[data-clear]")) { Object.assign(s, { q: "", genres: fixed.genres || [], keys: [], compat: "", labels: [], artists: [], types: [], bpm: [60, 200], energy: [1, 10], price: [0, 30], date: "", collection: "", page: 1 }); el.querySelector("#sq").value = ""; refilter(); paint(true); }
      const v = t.closest("[data-view]"); if (v) { s.view = v.dataset.view; el.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b === v)); paint(false); }
      if (t.closest("[data-more]")) { s.page++; paint(false); }
      if (t.closest("[data-open-filters]")) {
        ui.drawer({ title: "Filters", side: "left", body: `<p class="hint" style="margin-bottom:10px">Changes apply as you go.</p><div data-dfilters>${storeFilters(s)}</div>`, foot: `<button class="btn btn-primary btn-block" data-close>Show results</button>`,
          onMount(dr) {
            bindDual(dr, null, commitRange);
            dr.addEventListener("change", (ev) => { const x = ev.target; if (x.dataset.f) { s[x.dataset.f] = x.checked ? [...s[x.dataset.f], x.value] : s[x.dataset.f].filter((y) => y !== x.value); } if (x.matches("[data-date]")) s.date = x.value; if (x.matches("[data-compat]")) s.compat = x.value; paint(false); });
            dr.addEventListener("click", (ev) => { const k = ev.target.closest("[data-key]"); if (k) { const c = k.dataset.key; s.keys = s.keys.includes(c) ? s.keys.filter((y) => y !== c) : [...s.keys, c]; k.setAttribute("aria-pressed", s.keys.includes(c)); paint(false); } const ty2 = ev.target.closest("[data-type]"); if (ty2) { const c = ty2.dataset.type; s.types = s.types.includes(c) ? s.types.filter((y) => y !== c) : [...s.types, c]; ty2.setAttribute("aria-pressed", s.types.includes(c)); paint(false); } if (ev.target.closest("[data-close]")) refilter(); });
          } });
      }
    });
    paint(true);
    return () => clearTimeout(timer);
  }

  BF.route("/electronic/discover", { title: "Electronic store", eco: "electronic", ecoActive: "tracks",
    render: (_, q) => storePage("The Store", "Tracks & releases", q), mount: (el, _, q) => mountStore(el, q) });

  /* ---------- Genre page ---------- */
  BF.route("/electronic/genre/:id", { title: (p) => BF.egenre(p.id).name, eco: "electronic", ecoActive: "",
    render({ id }, q) {
      const g = BF.egenre(id);
      const tracks = sellable().filter((t) => t.genre === id);
      const rels = BF.RELEASES.filter((r) => r.genre === id || r.trackIds.some((t) => BF.trackById[t].genre === id));
      const labels = [...new Set(tracks.map((t) => t.labelId).filter(Boolean))].map((l) => BF.labelById[l]);
      const top = `<section class="ghero" style="--img:url('${BF.art("eg-" + g.id, g.style, g.palette).replace(/'/g, "%27")}')">
          <div><span class="ehead-label">Genre · ${g.bpm[0]}–${g.bpm[1]} BPM typical</span><h1 class="edisplay">${esc(g.name)}</h1>
          <p class="muted">${tracks.length} tracks · ${rels.length} releases · ${labels.length} labels${labels.length ? ` including ${labels.slice(0, 2).map((l) => `<a class="link" href="#/electronic/label/${l.id}">${esc(l.name)}</a>`).join(", ")}` : ""}</p></div>
          ${tracks.length ? `<button class="btn btn-primary" data-action="play" data-beat="${chartOf(tracks)[0].id}" data-queue-all="${chartOf(tracks).map((t) => t.id).join(",")}">${I("play", "i-sm")} Play the ${esc(g.name)} Top 10</button>` : ""}
        </section>
        ${tracks.length ? `<section class="esec">${M.sectionHead(`<span class="chart-pill">${I("chart", "i-xs")} Chart</span> ${esc(g.name)}`, "Top 10", `<a class="see-all" href="#/electronic/charts?genre=${g.id}">Genre chart ${I("arrow-right", "i-xs")}</a>`, "ranked")}${M.trackList(chartOf(tracks).slice(0, 10), { rank: true, move: moves(10, g.id.length) })}</section>` : ""}
        ${rels.length ? `<section class="esec">${M.sectionHead("Latest", "New " + esc(g.name) + " releases", "")}<div class="rgrid">${rels.slice(0, 6).map((r) => M.releaseCard(r)).join("")}</div></section>` : ""}`;
      return storePage("All " + esc(g.name), "Browse", { ...q, genre: id }, tracks.length ? top : top + ui.empty({ icon: "music", title: `No ${esc(g.name)} tracks yet`, body: "This genre is live but waiting on its first releases. Follow labels to hear about new drops.", actions: `<a class="btn btn-secondary" href="#/electronic/labels">Browse labels</a>` }));
    },
    mount(el, { id }, q) {
      const qa = el.querySelector("[data-queue-all]"); if (qa) qa.closest("section").setAttribute("data-queue", qa.dataset.queueAll);
      return mountStore(el, { ...q, genre: id }, { genres: [id] });
    },
  });

  /* ======================================================================
     RELEASE PAGE
     ====================================================================== */
  BF.route("/electronic/release/:id", { title: (p) => BF.releaseById[p.id]?.title || "Release", eco: "electronic", ecoActive: "",
    render({ id }, q) {
      const rel = BF.releaseById[id];
      if (!rel) return `<div class="container">${ui.empty({ icon: "disc", title: "Release not found", body: "It may have been taken down by the label.", actions: `<a class="btn btn-primary" href="#/electronic">Back to Electronic</a>` })}</div>`;
      const tracks = rel.trackIds.map((t) => BF.trackById[t]);
      const pack = BF.isPack(rel);
      const fmt = rel.formats.includes(BF.store.get("dlFormat")) ? BF.store.get("dlFormat") : rel.formats[0];
      const total = tracks.reduce((s, t) => s + t.duration, 0);
      const single = tracks.reduce((s, t) => s + BF.trackPrice(t, fmt), 0);
      const label = rel.labelId ? BF.labelById[rel.labelId] : null;
      const more = BF.RELEASES.filter((r) => r.id !== rel.id && (r.labelId === rel.labelId || r.artistIds.some((a) => rel.artistIds.includes(a)))).slice(0, 6);
      const hl = q.t;
      return `<div class="container release">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="#/electronic">Electronic</a>${I("chevron-right", "i-xs")}<a href="#/electronic/genre/${rel.genre}">${esc(BF.egenre(rel.genre).name)}</a>${I("chevron-right", "i-xs")}<span aria-current="page">${esc(rel.title)}</span></nav>
        <div class="rel-grid">
          <aside class="rel-side">
            <div class="rel-cover" data-queue="${rel.trackIds.join(",")}"><img src="${rel.art}" alt="Cover of ${esc(rel.title)}"><div class="rel-cover-play">${ui.playBtn(tracks[0].id, "xl accent")}</div></div>
            <div class="rel-buy">
              <div class="rel-buy-row"><div><span class="ehead-label">${pack ? "Download" : "Full release"} · ${fmt}</span><span class="rel-price">${BF.money(BF.releasePrice(rel, fmt))}</span></div>
                ${!pack && tracks.length > 1 && single - BF.releasePrice(rel, fmt) >= 0.01 ? `<span class="rel-save">Save ${BF.money(single - BF.releasePrice(rel, fmt))} vs. singles</span>` : ""}</div>
              ${M.buyBtn("release", rel.id, { big: true, label: pack ? "Buy pack" : "Buy release" })}
              <div class="rel-buy-alt"><button class="btn btn-ghost btn-sm" data-action="fmt" data-kind="release" data-id="${rel.id}">${I("file-audio", "i-sm")} Change format</button>${ui.favBtn(rel.id, "btn btn-ghost btn-sm")}<button class="btn btn-ghost btn-sm" data-action="share" data-href="#/electronic/release/${rel.id}" aria-label="Share">${I("share", "i-sm")}</button></div>
              <div class="rel-formats">${M.fmtList(rel)}</div>
            </div>
          </aside>
          <div class="rel-main">
            <div class="rel-head">
              ${M.typeBadge(rel)}
              <h1 class="edisplay">${esc(rel.title)}</h1>
              <p class="rel-artists">${M.artistLinks(rel.artistIds)}</p>
              <dl class="rel-meta">
                <div><dt>Label</dt><dd>${label ? `<a href="#/electronic/label/${label.id}">${esc(label.name)}</a> ${label.verified ? BF.verifiedSeal("Verified label") : ""}` : "Independent"}</dd></div>
                <div><dt>Released</dt><dd>${BF.releaseDate(rel.date)}</dd></div>
                <div><dt>Genre</dt><dd><a href="#/electronic/genre/${rel.genre}">${esc(BF.egenre(rel.genre).name)}</a></dd></div>
                <div><dt>Catalog</dt><dd class="mono">${rel.cat}</dd></div>
                <div><dt>${pack ? "Contents" : "Tracks"}</dt><dd>${pack ? esc(rel.pack) : `${tracks.length} · ${BF.time(total)}`}</dd></div>
              </dl>
              <div class="rel-actions"><button class="btn btn-primary" data-action="play-release" data-id="${rel.id}">${I("play", "i-sm")} ${pack ? "Play demo" : "Play all"}</button>${label ? `<button class="btn btn-outline" data-action="mfollow" data-fid="${label.id}" aria-pressed="${BF.store.isFollowing(label.id)}">${BF.store.isFollowing(label.id) ? "Following" : "Follow label"}</button>` : ""}</div>
            </div>

            <section aria-label="Tracklist">
              <h2 class="ehead-label" style="margin:28px 0 10px">${pack ? "Audio demo" : "Tracklist"}</h2>
              <ol class="tracklist" data-queue="${rel.trackIds.join(",")}">
                ${tracks.map((t) => `<li class="tl-row ${hl === t.id ? "is-hl" : ""}" data-beat-card="${t.id}" id="trk-${t.id}">
                  <div class="tl-top">
                    <span class="tl-n mono">${String(t.n).padStart(2, "0")}</span>
                    ${ui.playBtn(t.id, "sm")}
                    <div class="tl-title"><span class="t-title">${esc(t.title)} <span class="t-mix">${esc(t.mix)}</span></span>${M.explicit(t)}<span class="t-artists">${M.artistLinks(t.artistIds)}${t.remixerId ? ` · remix ${M.artistLinks([t.remixerId])}` : ""}</span></div>
                    <span class="tl-bpm mono">${t.bpm}<small>BPM</small></span>
                    ${M.keyBadge(t)}
                    <span class="tl-len mono">${BF.time(t.duration)}</span>
                    <div class="tl-buy">${ui.favBtn(t.id, "icon-btn sm")}<button class="icon-btn sm" data-action="crate" data-id="${t.id}" aria-label="Add ${esc(BF.trackTitle(t))} to playlist">${I("playlist", "i-sm")}</button>${pack ? "" : M.buyBtn("track", t.id)}</div>
                  </div>
                  ${ui.waveform(t, { bars: 160, markers: true, cls: "tl-wave" })}
                  <div class="tl-dj"><span>${I("bolt", "i-xs")} ${M.energy(t.energy)} Energy ${t.energy}/10</span><span>${t.intro}</span><span>${t.outro}</span><span>Drop at <b class="mono">${BF.time(t.dropAt)}</b></span><span>${esc(BF.egenre(t.genre).name)}</span><span class="mono">ISRC ${fakeIsrc(t)}</span>${t.explicit ? `<span class="xtext">Explicit</span>` : `<span>Clean</span>`}</div>
                </li>`).join("")}
              </ol>
            </section>

            <section class="rel-info">
              <div><h2 class="ehead-label">About</h2><p class="muted">${esc(rel.description)}${pack ? " Usage rights for samples are set by the label and included as a license file in the download." : ""}</p></div>
              <div><h2 class="ehead-label">Purchase terms</h2><p class="muted">Downloads are for personal listening and DJ performance. Redistribution, re-uploading or resale of files isn’t permitted. Terms are set by ${label ? esc(label.name) : "the artist"} and included with your receipt.</p></div>
              <div><h2 class="ehead-label">Rights</h2><p class="muted mono" style="font-size:12.5px">℗ ${rel.date.slice(0, 4)} ${esc(BF.labelName(rel.labelId))}<br>© ${rel.date.slice(0, 4)} ${esc(BF.labelName(rel.labelId))}<br>UPC ${fakeUpc(rel)}</p><a class="link" style="font-size:13px" href="#/legal/copyright">Report a rights issue</a></div>
            </section>
          </div>
        </div>
        ${more.length ? `<section class="esec">${M.sectionHead("More", label ? "More from " + esc(label.name) : "More from this artist", "")}<div class="rgrid">${more.map((r) => M.releaseCard(r)).join("")}</div></section>` : ""}
      </div><div style="height:48px"></div>`;
    },
    mount(el, _, q) { if (q.t) setTimeout(() => el.querySelector("#trk-" + q.t)?.scrollIntoView({ block: "center", behavior: BF.reducedMotion() ? "auto" : "smooth" }), 80); },
  });
  const fakeIsrc = (t) => `QZ${BF.hash(t.id).toString(36).toUpperCase().slice(0, 3)}26${String(BF.hash(t.title) % 100000).padStart(5, "0")}`;
  const fakeUpc = (r) => String(BF.hash(r.cat)).padStart(12, "0").slice(0, 12);
  BF.fakeIsrc = fakeIsrc;

  /* ======================================================================
     ARTISTS
     ====================================================================== */
  BF.route("/electronic/artists", { title: "Artists", eco: "electronic", ecoActive: "artists",
    render() {
      const list = [...BF.EARTISTS].sort((a, b) => b.followers - a.followers);
      return `<div class="container" style="padding-top:28px"><span class="ehead-label">Directory</span><h1 class="edisplay sm">Artists</h1>
        <p class="muted" style="max-width:600px;margin:8px 0 24px">Electronic artists releasing music in the ${BF.brand.displayName} Electronic Music Store.</p>
        <div class="agrid">${list.map(M.artistCard).join("")}</div></div>`;
    } });

  BF.route("/electronic/artist/:handle", { title: (p) => BF.eartistByHandle[p.handle]?.name || "Artist", eco: "electronic", ecoActive: "artists",
    render({ handle }, q) {
      const a = BF.eartistByHandle[handle];
      if (!a) return `<div class="container">${ui.empty({ icon: "user", title: "Artist not found", actions: `<a class="btn btn-primary" href="#/electronic/artists">Browse artists</a>` })}</div>`;
      const rels = a.releaseIds.map((id) => BF.releaseById[id]);
      const own = rels.filter((r) => r.artistIds.includes(a.id));
      const remixes = BF.ETRACKS.filter((t) => t.remixerId === a.id);
      const tracks = chartOf(BF.ETRACKS.filter((t) => t.artistIds.includes(a.id) && !BF.isPack(BF.releaseById[t.releaseId]))).slice(0, 6);
      const tabs = [["all", "Releases", own.length], ["single", "Singles", own.filter((r) => r.type === "single").length], ["ep", "EPs", own.filter((r) => r.type === "ep").length], ["album", "Albums", own.filter((r) => r.type === "album").length], ["remix", "Remixes", remixes.length + own.filter((r) => r.type === "remix").length], ["about", "About", ""]];
      const tab = q.tab || "all";
      const panel = (k) => {
        if (k === "about") return `<div class="about-grid"><div><p class="muted" style="max-width:640px">${esc(a.bio)}</p><div class="tag-row">${a.genres.map((g) => `<a class="tag no-hash" href="#/electronic/genre/${g}">${esc(BF.egenre(g).name)}</a>`).join("")}</div></div>
          <aside class="card card-pad"><dl class="kv compact"><div><dt>Based in</dt><dd>${esc(a.city)}</dd></div><div><dt>Followers</dt><dd>${a.followers.toLocaleString()}</dd></div><div><dt>Releases</dt><dd>${own.length}</dd></div><div><dt>Status</dt><dd>${a.verified ? "Verified artist" : "Verification pending"}</dd></div></dl></aside></div>`;
        if (k === "remix") return (remixes.length ? M.trackList(remixes) : "") + (own.some((r) => r.type === "remix") ? `<div class="rgrid" style="margin-top:20px">${own.filter((r) => r.type === "remix").map((r) => M.releaseCard(r)).join("")}</div>` : "") || ui.empty({ icon: "disc", title: "No remixes yet" });
        const list = k === "all" ? own : own.filter((r) => r.type === k);
        return list.length ? `<div class="rgrid">${list.map((r) => M.releaseCard(r)).join("")}</div>` : ui.empty({ icon: "disc", title: `No ${tabs.find((t) => t[0] === k)[1].toLowerCase()} yet` });
      };
      const following = BF.store.isFollowing(a.id);
      return `<div class="ebanner"><img src="${a.banner}" alt=""></div>
        <div class="container">
          <header class="eprofile">
            <div class="eprofile-img"><img src="${a.avatar}" alt="${esc(a.name)}"></div>
            <div class="eprofile-id"><span class="ehead-label">Artist · ${esc(a.city)}</span>
              <h1 class="edisplay">${esc(a.name)} ${a.verified ? BF.verifiedSeal("Verified artist") : `<span class="badge badge-warning">Verification pending</span>`}</h1>
              <div class="tag-row" style="margin-top:8px">${a.genres.map((g) => `<a class="tag no-hash" href="#/electronic/genre/${g}">${esc(BF.egenre(g).name)}</a>`).join("")}</div></div>
            <div class="eprofile-act"><div class="eprofile-count"><b>${BF.num(a.followers)}</b><span>followers</span></div>
              <button class="btn btn-lg ${following ? "btn-secondary" : "btn-primary"} follow-big" data-action="mfollow" data-fid="${a.id}" data-off="btn-primary" aria-pressed="${following}"><span>${following ? "Following" : "Follow"}</span></button></div>
          </header>
          <p class="muted eprofile-bio">${esc(a.bio)}</p>
          ${tracks.length ? `<section class="esec">${M.sectionHead("Most downloaded", "Top tracks", "")}${M.trackList(tracks, { head: false })}</section>` : ""}
          <div class="tabs" role="tablist" aria-label="Artist catalog" style="margin-top:36px">${tabs.map(([k, l, n]) => `<button class="tab" role="tab" id="at-${k}" aria-controls="ap-${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-atab="${k}">${l} ${n !== "" ? `<span class="n">${n}</span>` : ""}</button>`).join("")}</div>
          ${tabs.map(([k]) => `<div class="tab-panel" role="tabpanel" id="ap-${k}" aria-labelledby="at-${k}" ${tab === k ? "" : "hidden"}>${panel(k)}</div>`).join("")}
        </div><div style="height:48px"></div>`;
    },
    mount(el) {
      const tl = el.querySelector('[role="tablist"]'); if (!tl) return;
      tl.addEventListener("click", (e) => { const t = e.target.closest("[data-atab]"); if (t) { BF.selectTab(t); BF.setQuery({ tab: t.dataset.atab === "all" ? "" : t.dataset.atab }); } });
      tl.addEventListener("keydown", BF.tabKeys);
    } });

  /* ======================================================================
     LABELS
     ====================================================================== */
  BF.route("/electronic/labels", { title: "Labels", eco: "electronic", ecoActive: "labels",
    render() {
      return `<div class="container" style="padding-top:28px"><span class="ehead-label">Directory</span><h1 class="edisplay sm">Labels</h1>
        <p class="muted" style="max-width:600px;margin:8px 0 24px">Every label runs its own storefront. The seal means we’ve verified the label’s identity and rights to distribute its catalog.</p>
        <div class="lgrid">${BF.LABELS.map(M.labelCard).join("")}</div></div>`;
    } });

  BF.route("/electronic/label/:id", { title: (p) => BF.labelById[p.id]?.name || "Label", eco: "electronic", ecoActive: "labels",
    render({ id }) {
      const l = BF.labelById[id];
      if (!l) return `<div class="container">${ui.empty({ icon: "store", title: "Label not found", actions: `<a class="btn btn-primary" href="#/electronic/labels">Browse labels</a>` })}</div>`;
      const rels = l.releaseIds.map((r) => BF.releaseById[r]);
      const latest = [...rels].sort((a, b) => b.date.localeCompare(a.date));
      const popular = [...rels].sort((a, b) => b.trackIds.reduce((s, t) => s + BF.trackById[t].downloads, 0) - a.trackIds.reduce((s, t) => s + BF.trackById[t].downloads, 0));
      const artists = [...new Set(rels.flatMap((r) => r.artistIds))].map((a) => BF.eartistById[a]);
      const tracks = chartOf(BF.ETRACKS.filter((t) => t.labelId === l.id && !BF.isPack(BF.releaseById[t.releaseId]))).slice(0, 10);
      const following = BF.store.isFollowing(l.id);
      return `<div class="ebanner label"><img src="${l.banner}" alt=""></div>
        <div class="container">
          <header class="eprofile">
            <div class="eprofile-logo">${M.labelLogo(l, 120)}</div>
            <div class="eprofile-id"><span class="ehead-label">Label · ${esc(l.city)} · est. ${l.founded}</span>
              <h1 class="edisplay">${esc(l.name)} ${l.verified ? BF.verifiedSeal("Verified label") : `<span class="badge badge-warning">Verification pending</span>`}</h1>
              <p class="muted" style="max-width:640px;margin-top:8px">${esc(l.bio)}</p></div>
            <div class="eprofile-act"><div class="eprofile-count"><b>${BF.num(l.followers)}</b><span>followers</span></div>
              <button class="btn btn-lg ${following ? "btn-secondary" : "btn-primary"} follow-big" data-action="mfollow" data-fid="${l.id}" data-off="btn-primary" aria-pressed="${following}"><span>${following ? "Following" : "Follow"}</span></button></div>
          </header>
          <dl class="store-stats four"><div><dt>Releases</dt><dd>${rels.length}</dd></div><div><dt>Artists</dt><dd>${artists.length}</dd></div><div><dt>Catalog prefix</dt><dd class="mono">${l.prefix}</dd></div><div><dt>Genres</dt><dd style="font-size:14px">${l.genres.slice(0, 2).map((g) => BF.egenre(g).name).join(", ")}</dd></div></dl>
          <section class="esec">${M.sectionHead("Out now", "Latest releases", "")}<div class="rgrid">${latest.slice(0, 6).map((r, i) => M.releaseCard(r, { size: i === 0 ? "lead" : "" })).join("")}</div></section>
          <section class="esec">${M.sectionHead(`<span class="chart-pill">${I("chart", "i-xs")} Chart</span> Label chart`, "Popular tracks", "", "ranked")}${M.trackList(tracks, { rank: true, move: moves(tracks.length, l.id.length + 3) })}</section>
          <section class="esec">${M.sectionHead("Catalog", "Popular releases", "")}<div class="rgrid">${popular.slice(0, 6).map((r) => M.releaseCard(r)).join("")}</div></section>
          <section class="esec">${M.sectionHead("Roster", "Artists", "")}<div class="agrid">${artists.map(M.artistCard).join("")}</div></section>
        </div><div style="height:48px"></div>`;
    } });

  /* ======================================================================
     CHARTS
     ====================================================================== */
  const CHART_GENRES = ["house", "tech-house", "techno", "melodic-techno", "trance", "drum-bass", "afro-house", "deep-house", "hard-techno", "garage"];
  BF.route("/electronic/charts", { title: "Charts", eco: "electronic", ecoActive: "charts",
    render(_, q) {
      const tab = q.tab || "top10";
      const g = q.genre || "";
      const pool = sellable().filter((t) => !g || t.genre === g);
      const tabs = [["top10", "Top 10"], ["top100", "Top 100"], ["genres", "Genre Charts"], ["labels", "Label Charts"], ["new", "New & Trending"]];
      let body;
      if (tab === "top10") body = M.trackList(chartOf(pool).slice(0, 10), { rank: true, move: moves(10, 3 + g.length) });
      if (tab === "top100") { const c = chartOf(pool); body = `<p class="subtle" style="font-size:13px;margin-bottom:10px">${c.length < 100 ? `${c.length} tracks are charting in this period.` : ""}</p>` + M.trackList(c.slice(0, 100), { rank: true, move: moves(Math.min(100, c.length), 5) }); }
      if (tab === "new") body = M.trackList(trending(pool.filter((t) => BF.daysSince(t.date) <= 14)).slice(0, 20), { rank: true, move: moves(20, 9).map(() => "new"), emptyTitle: "Nothing new in this genre", emptyBody: "Nothing released in the last 14 days." });
      if (tab === "genres") body = `<div class="minicharts">${CHART_GENRES.map((id) => { const tr = chartOf(sellable().filter((t) => t.genre === id)).slice(0, 5); return `<section class="minichart"><header><a href="#/electronic/charts?genre=${id}"><h3>${esc(BF.egenre(id).name)}</h3></a><span class="chart-pill">${I("chart", "i-xs")} Top 5</span></header>${tr.length ? M.trackList(tr, { rank: true, head: false, move: moves(5, id.length) }) : `<p class="subtle" style="font-size:13px;padding:12px 0">No charting tracks yet.</p>`}</section>`; }).join("")}</div>`;
      if (tab === "labels") {
        const ranked = [...BF.LABELS].map((l) => ({ l, dl: BF.ETRACKS.filter((t) => t.labelId === l.id).reduce((s, t) => s + t.downloads, 0) })).sort((a, b) => b.dl - a.dl);
        body = `<ol class="label-chart">${ranked.map(({ l, dl }, i) => `<li><span class="rank-n">${i + 1}</span>${M.labelLogo(l, 44)}<div style="flex:1;min-width:0"><a class="lcard-name" href="#/electronic/label/${l.id}">${esc(l.name)} ${l.verified ? BF.verifiedSeal() : ""}</a><span class="subtle" style="font-size:12.5px">${l.releaseIds.length} releases · ${esc(l.city)}</span></div><span class="mono subtle">${dl.toLocaleString()} downloads</span></li>`).join("")}</ol>
          <div class="minicharts" style="margin-top:28px">${ranked.slice(0, 4).map(({ l }) => `<section class="minichart"><header><a href="#/electronic/label/${l.id}"><h3>${esc(l.name)}</h3></a><span class="chart-pill">${I("chart", "i-xs")} Top 5</span></header>${M.trackList(chartOf(sellable().filter((t) => t.labelId === l.id)).slice(0, 5), { rank: true, head: false, move: moves(5, l.id.length) })}</section>`).join("")}</div>`;
      }
      return `<div class="container charts">
        <header class="charts-head"><div><span class="chart-pill">${I("chart", "i-xs")} Charts</span><h1 class="edisplay sm">${g ? esc(BF.egenre(g).name) + " Charts" : "Charts"}</h1><p class="subtle" style="font-size:13px">Ranked by paid downloads over the last 7 days. Updated hourly. Editorial picks never appear here.</p></div></header>
        <div class="tabs" role="tablist" aria-label="Chart type">${tabs.map(([k, l]) => `<a class="tab" role="tab" aria-selected="${tab === k}" href="#/electronic/charts?tab=${k}${g ? "&genre=" + g : ""}">${l}</a>`).join("")}</div>
        ${["top10", "top100", "new"].includes(tab) ? `<div class="chart-filter" role="group" aria-label="Filter chart by genre"><a class="chip ${!g ? "is-active" : ""}" href="#/electronic/charts?tab=${tab}">All electronic</a>${CHART_GENRES.map((id) => `<a class="chip ${g === id ? "is-active" : ""}" href="#/electronic/charts?tab=${tab}&genre=${id}">${esc(BF.egenre(id).name)}</a>`).join("")}</div>` : ""}
        <div class="charts-body">${body}</div></div><div style="height:48px"></div>`;
    } });

  /* ======================================================================
     NEW RELEASES · GENRES · STORE SEARCH
     ====================================================================== */
  BF.route("/electronic/new", { title: "New Releases",
    render(_, q) {
      const type = q.type || "";
      const rels = BF.api.catalog("electronic", "release").filter((r) => !type || r.type === type).sort((a, b) => b.date.localeCompare(a.date));
      const buckets = [["This week", (d) => d <= 7], ["Last week", (d) => d > 7 && d <= 14], ["Earlier this month", (d) => d > 14 && d <= 31], ["Before that", (d) => d > 31]];
      return `<div class="container estore">
        <header class="estore-head"><div><span class="ehead-label">Out now</span><h1 class="edisplay sm">New Releases</h1><p class="muted">Every single, EP, album, remix package, compilation and DJ tool — newest first.</p></div></header>
        <div class="chart-filter" role="group" aria-label="Release type"><a class="chip ${!type ? "is-active" : ""}" href="#/electronic/new">All types</a>${BF.RELEASE_TYPES.map(([id, n]) => `<a class="chip ${type === id ? "is-active" : ""}" href="#/electronic/new?type=${id}">${n}</a>`).join("")}</div>
        ${rels.length ? buckets.map(([label, fn]) => { const list = rels.filter((r) => fn(BF.daysSince(r.date))); return list.length ? `<section class="esec" style="padding-top:28px">${M.sectionHead(label, label === "This week" ? "Out this week" : label, "")}<div class="rgrid">${list.map((r, i) => M.releaseCard(r, { size: label === "This week" && i === 0 ? "lead" : "" })).join("")}</div></section>` : ""; }).join("") : ui.empty({ icon: "disc", title: "No releases of this type yet" })}
      </div><div style="height:48px"></div>`;
    } });

  BF.route("/electronic/genres", { title: "Genres",
    render() {
      const gs = visibleGenres();
      const count = (id) => sellable().filter((t) => t.genre === id).length;
      return `<div class="container estore">
        <header class="estore-head"><div><span class="ehead-label">${gs.length} genres</span><h1 class="edisplay sm">Genres</h1><p class="muted">From deep house to hardcore — each genre has its own chart, new releases and typical BPM range.</p></div></header>
        <div class="ggrid" style="margin-top:18px">${gs.map((g) => M.genreTile(g, count(g.id))).join("")}</div>
        <section class="esec">${M.sectionHead("Quick reference", "Tempo guide", "")}
          <div class="table-wrap card"><table class="table"><thead><tr><th scope="col">Genre</th><th scope="col">Typical BPM</th><th scope="col" class="num">Tracks</th><th scope="col"><span class="sr-only">Links</span></th></tr></thead>
          <tbody>${gs.map((g) => `<tr><td class="strong"><a href="#/electronic/genre/${g.id}">${esc(g.name)}</a></td><td class="mono">${g.bpm[0]}–${g.bpm[1]}</td><td class="num mono">${count(g.id)}</td><td class="num"><a class="link" style="font-size:13px" href="#/electronic/charts?genre=${g.id}">Chart</a></td></tr>`).join("")}</tbody></table></div></section>
      </div><div style="height:48px"></div>`;
    } });

  BF.route("/electronic/search", { title: (_, q) => `Search: ${q.q || ""}`,
    load: (_, q) => ((q.q || "").trim() ? BF.api.search((q.q || "").trim().slice(0, 200), { marketplace: "electronic", limit: 99 }) : null),
    render(_, q, r) {
      const term = (q.q || "").trim();
      const m = r?.electronic ?? null;
      const total = m ? m.totalTracks + m.allReleases.length + m.artists.length + m.labels.length : 0;
      return `<div class="container estore">
        <header class="estore-head"><div><span class="ehead-label">Electronic Music Store · search</span><h1 class="edisplay sm">${term ? `“${esc(term)}”` : "Search"}</h1>
          ${m?.parsed.any ? `<div class="parsed">${BF.parsedChips(m.parsed)} <a class="link" style="font-size:13px;margin-left:6px" href="${queryToStore(m.parsed)}">Refine with filters ${I("arrow-right", "i-xs")}</a></div>` : ""}
          <p class="muted" style="font-size:14px">${term ? `${m.totalTracks} tracks · ${m.allReleases.length} releases · ${m.artists.length} artists · ${m.labels.length} labels in the Electronic Music Store.` : "Tracks, releases, artists, labels and catalog numbers."} <a class="link" href="#/search?q=${encodeURIComponent(term)}">Search both marketplaces ${I("arrow-right", "i-xs")}</a></p></div>
          <div class="estore-search">${smartSearch("esq", term)}</div></header>
        ${!term ? "" : !total ? ui.empty({ icon: "search", title: `Nothing in the Electronic Music Store for “${esc(term)}”`, body: "Try a genre, a key like 8A, a BPM, or a catalog number.", actions: `<a class="btn btn-secondary" href="#/beats/search?q=${encodeURIComponent(term)}">Search the Beats Store</a>` }) : `
          ${m.allTracks.length ? `<section class="esec" style="padding-top:24px">${M.sectionHead("Tracks", `${m.totalTracks} tracks`, "")}${M.trackList(m.allTracks.slice(0, 50))}</section>` : ""}
          ${m.allReleases.length ? `<section class="esec">${M.sectionHead("Releases", "Releases", "")}<div class="rgrid">${m.allReleases.map((r) => M.releaseCard(r)).join("")}</div></section>` : ""}
          ${m.artists.length ? `<section class="esec">${M.sectionHead("Artists", "Artists", "")}<div class="agrid">${m.artists.map(M.artistCard).join("")}</div></section>` : ""}
          ${m.labels.length ? `<section class="esec">${M.sectionHead("Labels", "Labels", "")}<div class="lgrid">${m.labels.map(M.labelCard).join("")}</div></section>` : ""}`}
      </div><div style="height:48px"></div>`;
    },
    mount(el) { bindSmartSearch(el); } });
})();
