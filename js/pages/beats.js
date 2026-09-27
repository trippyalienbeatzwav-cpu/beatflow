/* Beats Store — discovery feed, genres, charts, store-scoped search, production packs.
   Everything here reads only Beats Store products (beats, packs, producers). */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;
  const beats = () => BF.api.catalog("beats", "beat");
  const packs = () => BF.api.catalog("beats", "pack");
  const producers = () => BF.api.catalog("beats", "producer");

  /* ---------- Pack components ---------- */
  const B = (BF.beatsUI = {});
  B.packBtn = (k) => {
    if (BF.store.ownsPack(k.id)) return `<a class="price-btn owned" href="#/beats/library?tab=packs">${I("check", "i-xs")} Owned</a>`;
    const inCart = BF.store.packItem(k.id);
    return `<button class="price-btn ${inCart ? "in-cart" : ""}" data-action="add-pack" data-id="${k.id}" aria-label="${inCart ? "In cart" : `Buy pack ${esc(k.title)}, ${BF.money(k.price)}`}">${inCart ? I("check", "i-xs") + "In cart" : I("bag-plus", "i-xs") + BF.money(k.price)}</button>`;
  };
  B.packCard = (k) => {
    const p = BF.producerById[k.producerId];
    return `<article class="beat-card pack-card" data-beat-card="${k.id}">
      <div class="art"><img src="${k.art}" alt="" loading="lazy"><div class="art-overlay">${ui.playBtn(k.id, "lg")}</div>
        <div class="art-top"><span class="badge badge-solid">${BF.PACK_TYPES[k.type]}</span>${ui.favBtn(k.id, "art-fav")}</div></div>
      <div class="body">
        <a class="title truncate" href="#/beats/pack/${k.id}">${esc(k.title)}</a>
        ${ui.producerLink(p, "producer")}
        <div class="card-spec"><span class="spec"><span class="hl">${k.bpm} BPM</span><span>${k.key}</span><span>${k.size}</span></span></div>
        <div class="foot"><span class="subtle card-genre">${BF.genreById[k.genre].name}</span>${B.packBtn(k)}</div>
      </div></article>`;
  };
  B.addPack = (id) => {
    const k = BF.packById[id];
    if (BF.store.ownsPack(id)) return ui.toast({ kind: "info", title: "Already in your Beats Library", desc: esc(k.title), action: { href: "#/beats/library?tab=packs", label: "Open" } });
    try {
      const r = BF.store.addPack(id);
      ui.toast({ title: r === "added" ? "Pack added to cart" : "Already in cart", desc: esc(k.title), art: k.art, action: { href: "#/cart", label: "View cart" } });
    } catch (err) { ui.toast({ kind: "error", title: "Couldn’t add pack", desc: esc(err.message) }); }
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest('[data-action="add-pack"]'); if (!b) return;
    e.preventDefault(); B.addPack(b.dataset.id);
  });
  BF.store.on("cart", () => BF.$$('.price-btn[data-action="add-pack"], .price-btn.in-cart').forEach((b) => { const id = b.dataset.id; if (!id || !BF.packById[id]) return; const t = document.createElement("div"); t.innerHTML = B.packBtn(BF.packById[id]); b.replaceWith(t.firstElementChild); }));

  const head = (label, title, link = "") => ui.sectionHead("", label, title, link);
  const rail = (items, card) => `<div class="rail cols-6" data-queue="${items.map((x) => x.id).join(",")}">${items.map(card).join("")}</div>`;

  /* ---------- Discover (feed) ---------- */
  BF.route("/beats/discover", {
    title: "Discover beats",
    render() {
      const all = beats();
      const trending = [...all].sort((a, b) => b.trendScore - a.trendScore).slice(0, 12);
      const fresh = [...all].sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 12);
      const free = all.filter((b) => b.freeDownload);
      const bands = [["Slow & soulful", "60-89", "Lo-fi, R&B, soul"], ["Mid-tempo bounce", "90-119", "Hip-hop, afrobeats, reggaeton"], ["Up-tempo", "120-139", "Pop, dance"], ["Half-time heat", "140-180", "Trap, drill"]];
      return `<div class="container bs-page">
        <header class="bs-head"><div><span class="eyebrow"><span class="idx">▶</span>Beats Store</span><h1 class="h1" style="margin-top:8px">Discover</h1><p class="muted">Hand-picked beats, packs and producers — updated daily.</p></div>
          <a class="btn btn-secondary" href="#/beats/catalog">${I("sliders", "i-sm")} Browse all beats with filters</a></header>
        <div class="mood-row">${BF.MOODS.map((m, i) => `<a class="mood-tile" href="#/beats/catalog?mood=${m}" style="--m:${["#6d3cff", "#ff6a3d", "#2fb5a0", "#4b6bff", "#ff4f8b", "#e33b3b", "#f2a33a", "#9b7bff", "#ff8a3d", "#7a5cff"][i]}">${m}</a>`).join("")}</div>
        <section class="section">${head("Moving fast", "Trending this week", `<a class="see-all" href="#/beats/charts">Beat charts ${I("arrow-right", "i-xs")}</a>`)}${rail(trending, (b) => ui.beatCard(b))}</section>
        <section class="section">${head("Just uploaded", "Fresh drops", `<a class="see-all" href="#/beats/catalog?sort=newest">All new beats ${I("arrow-right", "i-xs")}</a>`)}${rail(fresh, (b) => ui.beatCard(b))}</section>
        <section class="section">${head("Find your tempo", "Browse by BPM", "")}<div class="bpm-bands">${bands.map(([t, r, d]) => `<a class="bpm-band" href="#/beats/catalog?bpm=${r}"><span class="mono">${r.replace("-180", "+")} BPM</span><b>${t}</b><span class="subtle">${d}</span></a>`).join("")}</div></section>
        <section class="section">${head("Production material", "Samples, loops & packs", "")}<div class="grid-beats" data-queue="${packs().map((k) => k.id).join(",")}">${packs().map(B.packCard).join("")}</div></section>
        <section class="section">${head("Verified storefronts", "Producers to follow", `<a class="see-all" href="#/beats/producers">All producers ${I("arrow-right", "i-xs")}</a>`)}<div class="producer-grid">${producers().filter((p) => p.verified).slice(0, 4).map(ui.producerCard).join("")}</div></section>
        ${free.length ? `<section class="section">${head("Try before you license", "Free tagged downloads", "")}${rail(free, (b) => ui.beatCard(b))}</section>` : ""}
      </div><div style="height:48px"></div>`;
    },
  });

  /* ---------- Genres ---------- */
  BF.route("/beats/genres", {
    title: "Beat genres",
    render() {
      const all = beats();
      return `<div class="container bs-page"><header class="bs-head"><div><span class="eyebrow">Beats Store</span><h1 class="h1" style="margin-top:8px">Genres</h1><p class="muted">Every beat is tagged by genre, mood, BPM and key.</p></div></header>
        <div class="genre-grid">${BF.GENRES.map((g, i) => `<a class="genre-tile ${i === 0 ? "big" : ""}" href="#/beats/catalog?genre=${g.id}"><img src="${BF.art(g.id + "tile", g.style, g.palette)}" alt="" loading="lazy"><span class="gt-name">${g.name}</span><span class="gt-count mono">${g.count.toLocaleString()} beats · ${all.filter((b) => b.genre === g.id).length} featured</span></a>`).join("")}</div>
        <section class="section">${head("By feel", "Moods", "")}<div class="mood-row wrap">${BF.MOODS.map((m) => `<a class="chip" href="#/beats/catalog?mood=${m}">${m} <span class="mono subtle">${all.filter((b) => b.moods.includes(m)).length}</span></a>`).join("")}</div></section>
      </div><div style="height:48px"></div>`;
    },
  });

  /* ---------- Charts (ranked by licenses sold) ---------- */
  BF.route("/beats/charts", {
    title: "Beat charts",
    render(_, q) {
      const g = q.genre || "", tab = q.tab || "beats";
      const moves = [2, 0, 5, -1, 1, "new", -2, 3, 0, "new", 1, -3, 0, 2, "new", -1, 4, 0, -2, 1];
      const mv = (m) => (m === "new" ? `<span class="mv new">NEW</span>` : m > 0 ? `<span class="mv up" aria-label="Up ${m}">${I("chevron-up", "i-xs")}${m}</span>` : m < 0 ? `<span class="mv down" aria-label="Down ${-m}">${I("chevron-down", "i-xs")}${-m}</span>` : `<span class="mv" aria-label="No change">–</span>`);
      let body;
      if (tab === "beats") {
        const list = beats().filter((b) => !g || b.genre === g).sort((a, b) => b.sales - a.sales).slice(0, 20);
        body = list.length ? `<ol class="chart-list single" data-queue="${list.map((b) => b.id).join(",")}">${list.map((b, i) => `<li class="chart-row" data-beat-card="${b.id}"><span class="rank mono">${String(i + 1).padStart(2, "0")}</span>${mv(moves[i])}
            <div class="art sm"><img src="${b.art}" alt="" loading="lazy"><button class="chart-play" data-action="play" data-beat="${b.id}" aria-label="Play ${esc(b.title)}">${I("play", "i-sm ic-play")}${I("pause", "i-sm ic-pause")}</button></div>
            <div class="cr-main"><a class="title truncate" href="#/beats/beat/${b.id}">${b.title}</a><span class="subtle truncate" style="font-size:13px">${esc(BF.producerOf(b).name)} · ${BF.genreById[b.genre].name} · ${b.bpm} BPM</span></div>
            <span class="mono subtle cr-plays hide-sm">${b.sales} licenses</span>${ui.priceBtn(b)}</li>`).join("")}</ol>` : ui.empty({ icon: "chart", title: "No charting beats in this genre yet" });
      }
      if (tab === "producers") body = `<ol class="label-chart">${[...producers()].sort((a, b) => b.sales - a.sales).map((p, i) => `<li><span class="rank-n bs">${i + 1}</span><span class="avatar md"><img src="${p.avatar}" alt=""></span><div style="flex:1;min-width:0"><a style="font-weight:650;display:inline-flex;gap:4px;align-items:center" href="#/beats/producer/${p.handle}">${esc(p.name)}${p.verified ? BF.verifiedSeal() : ""}</a><span class="subtle" style="display:block;font-size:12.5px">${p.genres.map((x) => BF.genreById[x].name).join(" · ")}</span></div><span class="mono subtle">${p.sales.toLocaleString()} licenses</span></li>`).join("")}</ol>`;
      if (tab === "packs") body = `<div class="grid-beats" data-queue="${packs().map((k) => k.id).join(",")}">${packs().map(B.packCard).join("")}</div>`;
      return `<div class="container bs-page">
        <header class="bs-head"><div><span class="bs-chart-pill">${I("chart", "i-xs")} Beat charts</span><h1 class="h1" style="margin-top:10px">Charts</h1><p class="subtle" style="font-size:13px">Ranked by licenses sold in the last 7 days. Sponsored placements never appear here.</p></div></header>
        <div class="tabs" role="tablist" style="margin:8px 0 12px">${[["beats", "Top Beats"], ["producers", "Top Producers"], ["packs", "Packs"]].map(([k, l]) => `<a class="tab" role="tab" aria-selected="${tab === k}" href="#/beats/charts?tab=${k}">${l}</a>`).join("")}</div>
        ${tab === "beats" ? `<div class="chart-filter"><a class="chip ${!g ? "is-active" : ""}" href="#/beats/charts">All genres</a>${BF.GENRES.map((x) => `<a class="chip ${g === x.id ? "is-active" : ""}" href="#/beats/charts?genre=${x.id}">${x.name}</a>`).join("")}</div>` : ""}
        <div style="margin-top:12px">${body}</div></div><div style="height:48px"></div>`;
    },
  });

  /* ---------- Pack detail ---------- */
  BF.route("/beats/pack/:id", {
    title: (p) => BF.packById[p.id]?.title || "Pack",
    render({ id }) {
      const k = BF.packById[id];
      if (!k) return `<div class="container">${ui.empty({ icon: "folder", title: "Pack not found", actions: `<a class="btn btn-primary" href="#/beats/discover">Back to Discover</a>` })}</div>`;
      const p = BF.producerById[k.producerId];
      const more = packs().filter((x) => x.id !== k.id).slice(0, 4);
      return `<div class="container bs-page">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="#/beats">Beats Store</a>${I("chevron-right", "i-xs")}<a href="#/beats/discover">Packs</a>${I("chevron-right", "i-xs")}<span aria-current="page">${esc(k.title)}</span></nav>
        <div class="pack-top" data-queue="${k.id}">
          <div class="bd-art" data-beat-card="${k.id}"><img src="${k.art}" alt="Artwork for ${esc(k.title)}"></div>
          <div class="bd-info">
            <span class="badge badge-solid">${BF.PACK_TYPES[k.type]}</span>
            <h1 class="display bd-title">${esc(k.title)}</h1>
            <div class="bd-producer"><a href="#/beats/producer/${p.handle}" class="avatar md"><img src="${p.avatar}" alt=""></a><div><a href="#/beats/producer/${p.handle}" style="font-weight:650;display:inline-flex;gap:5px;align-items:center">${esc(p.name)}${p.verified ? BF.verifiedSeal() : ""}</a><div class="subtle" style="font-size:13px">${BF.genreById[k.genre].name} producer</div></div></div>
            <dl class="meta-grid"><div><dt>Contents</dt><dd style="font-size:14px">${esc(k.contents)}</dd></div><div><dt>Size</dt><dd class="mono">${k.size}</dd></div><div><dt>Tempo / key</dt><dd class="mono">${k.bpm} · ${k.key}</dd></div><div><dt>Format</dt><dd class="mono">${k.formats.join(" · ")}</dd></div></dl>
            <div class="bd-player">${ui.playBtn(k.id, "lg accent")}<div style="flex:1;min-width:0">${ui.waveform(k, { bars: 120 })}<div class="bd-times mono"><span>Demo preview</span><span>${BF.time(k.duration)}</span></div></div></div>
            <div class="pack-buy card card-pad"><div><span class="subtle" style="font-size:13px">One-time purchase</span><span class="display" style="font-size:32px">${BF.money(k.price)}</span></div>${BF.store.ownsPack(k.id) ? `<a class="btn btn-secondary btn-lg" href="#/beats/library?tab=packs">${I("check", "i-sm")} Owned — open library</a>` : `<button class="btn btn-primary btn-lg" data-action="add-pack" data-id="${k.id}">${I("bag-plus", "i-sm")} Buy pack</button>`}</div>
            <div class="notice info">${I("license", "i-sm")}<div><strong>Usage terms.</strong> ${esc(k.terms)} Terms are set by ${esc(p.name)}; the full pack license is included in the download.</div></div>
          </div>
        </div>
        <section class="section">${head("From the Beats Store", "More packs", "")}<div class="grid-beats" data-queue="${more.map((x) => x.id).join(",")}">${more.map(B.packCard).join("")}</div></section>
      </div><div style="height:48px"></div>`;
    },
  });

  /* ---------- Store-scoped search ---------- */
  BF.route("/beats/search", {
    title: (_, q) => `Beats search: ${q.q || ""}`,
    load: (_, q) => ((q.q || "").trim() ? BF.api.search((q.q || "").trim().slice(0, 200), { marketplace: "beats", limit: 99 }) : null),
    render(_, q, r) {
      const term = (q.q || "").trim();
      const bs = r?.beats.allBeats || [], ps = r?.beats.producers || [], ks = r?.packs || [];
      const total = bs.length + ps.length + ks.length;
      return `<div class="container bs-page">
        <header class="bs-head"><div><span class="eyebrow">Beats Store · search</span><h1 class="h1" style="margin-top:8px">${term ? `“${esc(term)}”` : "Search beats"}</h1>
          <p class="muted" style="font-size:14px">${term ? `${bs.length} beats · ${ps.length} producers · ${ks.length} packs in the Beats Store.` : "Search beats, producers and packs."} <a class="link" href="#/search?q=${encodeURIComponent(term)}">Search both marketplaces ${I("arrow-right", "i-xs")}</a></p></div></header>
        ${!term ? "" : !total ? ui.empty({ icon: "search", title: `No beats match “${esc(term)}”`, body: "Try a genre, mood or BPM — or search the Electronic Music Store instead.", actions: `<a class="btn btn-secondary" href="#/electronic/search?q=${encodeURIComponent(term)}">Search Electronic Music Store</a>` }) : `
          ${bs.length ? `<section class="sr-sec"><h2 class="h3" style="margin-bottom:12px">Beats</h2><div class="beat-list" role="list" data-queue="${bs.map((b) => b.id).join(",")}">${ui.beatListHead()}${bs.map((b, i) => ui.beatRow(b, i)).join("")}</div></section>` : ""}
          ${ps.length ? `<section class="sr-sec"><h2 class="h3" style="margin-bottom:12px">Producers</h2><div class="producer-grid">${ps.map(ui.producerCard).join("")}</div></section>` : ""}
          ${ks.length ? `<section class="sr-sec"><h2 class="h3" style="margin-bottom:12px">Packs</h2><div class="grid-beats">${ks.map(B.packCard).join("")}</div></section>` : ""}`}
      </div><div style="height:48px"></div>`;
    },
  });
})();
