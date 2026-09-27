/* Platform pages (outside both stores): the marketplace chooser home and About.
   Store content appears here only in clearly separated, store-scoped sections. */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;

  /* ---------- Store visuals ---------- */
  function beatsVisual() {
    const [b, b2] = [...BF.BEATS].sort((x, y) => y.trendScore - x.trendScore);
    if (!b || !b2) return "";
    const pads = [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0];
    return `<div class="mk-visual beats" aria-hidden="true">
      <div class="studio">
        <div class="studio-cover"><img src="${b.art}" alt=""><img class="back" src="${b2.art}" alt=""></div>
        <div class="studio-pads">${pads.map((on, i) => `<span class="${on ? "on" : ""}" style="--d:${(i % 4) * 80 + Math.floor(i / 4) * 40}ms"></span>`).join("")}</div>
        <div class="studio-rack">
          <div class="knobs">${[35, 70, 52, 88].map((v) => `<span class="knob" style="--v:${v}"></span>`).join("")}</div>
          <div class="studio-wave">${BF.ui.waveform(b, { cls: "sm" })}</div>
          <div class="studio-meta mono"><span>${b.bpm} BPM</span><span>${esc(b.key.toUpperCase())}</span><span>${esc(b.title)}</span></div>
        </div>
      </div>
    </div>`;
  }
  function electronicVisual() {
    const r = [...BF.RELEASES].sort((x, y) => y.date.localeCompare(x.date))[0], t = r && BF.trackById[r.trackIds[0]];
    if (!r || !t) return "";
    return `<div class="mk-visual electronic" aria-hidden="true">
      <div class="record">
        <div class="record-sleeve"><img src="${r.art}" alt=""><span class="record-cat mono">${esc(r.cat ?? "")}</span></div>
        <div class="record-disc"><span class="record-label" style="background-image:url('${r.art.replace(/'/g, "%27")}')"></span></div>
      </div>
      <div class="record-wave">${BF.ui.waveform(t, { cls: "sm" })}</div>
      <div class="record-meta mono"><span>${t.bpm} BPM</span><span>${esc(t.camelot ?? "")}</span><span>${r.formats.join(" · ")}</span><span>${esc(r.title.toUpperCase())}</span></div>
    </div>`;
  }

  const feat = (icon, label) => `<li>${I(icon, "i-sm")}<span>${label}</span></li>`;

  function chooser() {
    return `<section class="choose" aria-labelledby="choose-h">
      <div class="container">
        <h2 id="choose-h" class="choose-q">What are you looking for?</h2>
        <div class="mk-grid">
          <article class="mk-card" data-eco="beats">
            ${beatsVisual()}
            <div class="mk-body">
              <span class="mk-kicker">${I("mic", "i-sm")} For artists &amp; creators</span>
              <h3 class="mk-title">Beats Store</h3>
              <p class="mk-desc">Find beats, instrumentals, samples, and production-ready music from independent producers.</p>
              <div class="mk-genres">${["Hip-hop", "Trap", "R&B", "Drill", "Afrobeats", "Pop", "Lo-Fi", "Rap"].map((g) => `<span>${esc(g)}</span>`).join("")}</div>
              <ul class="mk-feats">${[["bag-plus", "Buy Beats"], ["license", "License Beats"], ["store", "Producer Stores"], ["layers", "Stems"], ["file-audio", "WAV / MP3"], ["key", "Exclusive Rights"], ["folder", "Samples"]].map(([i, l]) => feat(i, l)).join("")}</ul>
              <a class="btn btn-lg mk-cta" href="#/beats">Enter Beats Store ${I("arrow-right", "i-sm")}</a>
            </div>
          </article>
          <article class="mk-card" data-eco="electronic">
            ${electronicVisual()}
            <div class="mk-body">
              <span class="mk-kicker">${I("headphones", "i-sm")} For DJs, listeners &amp; collectors</span>
              <h3 class="mk-title">Electronic Music</h3>
              <p class="mk-desc">Discover and buy electronic music from independent artists, producers, and labels.</p>
              <div class="mk-genres">${["House", "Techno", "Trance", "Drum & Bass", "Progressive", "Afro House", "Melodic Techno", "Electronica"].map((g) => `<span>${esc(g)}</span>`).join("")}</div>
              <ul class="mk-feats">${[["music", "Singles"], ["disc", "EPs"], ["library", "Albums"], ["sliders", "DJ Tools"], ["refresh", "Remixes"], ["store", "Labels"], ["file-audio", "WAV / AIFF / MP3"], ["headphones", "DJ-ready music"]].map(([i, l]) => feat(i, l)).join("")}</ul>
              <a class="btn btn-lg mk-cta" href="#/electronic">Enter Electronic Music Store ${I("arrow-right", "i-sm")}</a>
            </div>
          </article>
        </div>
        <p class="mk-note">${I("user", "i-xs")} One account, one checkout — two separate libraries.</p>
      </div>
    </section>`;
  }

  function fromBeats() {
    const bs = BF.api.catalog("beats", "beat").sort((a, b) => b.trendScore - a.trendScore).slice(0, 6);
    const ps = BF.api.catalog("beats", "producer").filter((p) => p.verified).slice(0, 4);
    return `<section class="from" data-eco="beats" aria-labelledby="from-beats">
      <div class="container">
        <header class="from-head"><div><span class="from-kicker">${I("mic", "i-xs")} From the Beats Store</span><h2 id="from-beats" class="h2">Featured Beats</h2></div><a class="btn btn-secondary btn-sm" href="#/beats">Enter Beats Store ${I("arrow-right", "i-xs")}</a></header>
        <div class="rail cols-6" data-queue="${bs.map((b) => b.id).join(",")}">${bs.map((b) => ui.beatCard(b)).join("")}</div>
        <h3 class="from-sub">Featured Producers</h3>
        <div class="producer-grid">${ps.map(ui.producerCard).join("")}</div>
      </div>
    </section>`;
  }

  function fromElectronic() {
    const M = BF.mui;
    const rs = BF.api.catalog("electronic", "release").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    const as = BF.api.catalog("electronic", "artist").slice(0, 6);
    const ls = BF.api.catalog("electronic", "label").slice(0, 4);
    return `<section class="from" data-eco="electronic" aria-labelledby="from-el">
      <div class="container">
        <header class="from-head"><div><span class="from-kicker">${I("headphones", "i-xs")} From the Electronic Music Store</span><h2 id="from-el" class="edisplay sm">Featured Releases</h2></div><a class="btn btn-secondary btn-sm" href="#/electronic">Enter Electronic Music Store ${I("arrow-right", "i-xs")}</a></header>
        <div class="rgrid">${rs.map((r) => M.releaseCard(r)).join("")}</div>
        <h3 class="from-sub e">Featured Artists</h3>
        <div class="agrid">${as.map(M.artistCard).join("")}</div>
        <h3 class="from-sub e">Featured Labels</h3>
        <div class="lgrid">${ls.map(M.labelCard).join("")}</div>
      </div>
    </section>`;
  }

  function account() {
    return `<section class="container one-account">
      <div class="oa-card">
        <div><span class="eyebrow no-rule">Shared account</span><h2 class="h2" style="margin-top:6px">One account. Two libraries.</h2>
          <p class="muted" style="margin-top:8px;max-width:520px">Sign in once and pay once. Beat licenses stay in your Beats Library, and tracks and releases stay in your Electronic Library. Every order carries its store’s ID so you always know where a purchase came from.</p></div>
        <div class="oa-libs">
          <a class="oa-lib" data-eco="beats" href="#/beats/library"><span class="mono">TBB-····</span><b>Beats Library</b><span class="subtle">Licenses, stems, packs</span></a>
          <a class="oa-lib" data-eco="electronic" href="#/electronic/library"><span class="mono">TBE-····</span><b>Electronic Library</b><span class="subtle">Tracks, releases, DJ playlists</span></a>
        </div>
      </div>
    </section>`;
  }

  function social() {
    return `<section class="container social-band" aria-labelledby="sb-h">
      <a class="social-band-card" href="#/social">
        <div><span class="social-band-kicker">${BF.brand.name} Social</span>
          <h2 id="sb-h">Where the music gets made in public.</h2>
          <p>Follow producers, DJs and artists. Watch reels and live sessions, chat in real time, and support creators with gifts and tips.</p>
          <div class="social-band-feats"><span>Reels</span><span>Stories</span><span>Live</span><span>Messages</span><span>Creator Studio</span></div>
          <span class="social-band-cta">Open Social ${I("arrow-right", "i-sm")}</span></div>
        <div class="social-band-phones" data-social-phones aria-hidden="true"><div class="social-band-phone"></div><div class="social-band-phone"></div><div class="social-band-phone"></div></div>
      </a></section>`;
  }

  BF.route("/", {
    title: "",
    mount(el) {
      // Public highlights only (public accounts, public reels); the section still works without the server
      fetch("/api/public/highlights").then((r) => (r.ok ? r.json() : null)).then((d) => {
        const box = el.querySelector("[data-social-phones]"); if (!d || !box) return;
        box.innerHTML = d.items.slice(0, 3).map((x) => `<div class="social-band-phone"><img src="${x.poster_url}" alt="" loading="lazy">${x.live ? "<b>LIVE</b>" : ""}</div>`).join("");
      }).catch(() => {});
    },
    render: () => `<section class="plat-hero">
        <div class="container">
          <span class="eyebrow no-rule plat-kicker">${BF.brand.name}</span>
          <h1 class="display plat-title">One Platform.<br><span>Two Music Worlds.</span></h1>
          <p class="body-lg plat-sub">Discover beats for your next track or explore electronic music from independent artists and labels.</p>
        </div>
      </section>
      ${chooser()}${fromBeats()}${fromElectronic()}${social()}${account()}<div style="height:48px"></div>`,
  });

  BF.route("/about", {
    title: "About",
    render: () => `<div class="container narrow" style="padding-top:44px;max-width:900px">
      <span class="eyebrow">About ${BF.brand.name}</span>
      <h1 class="display" style="font-size:clamp(2.4rem,6vw,4.4rem);margin:12px 0 16px">Two stores.<br>One music company.</h1>
      <p class="body-lg">${BF.brand.displayName} runs two specialised marketplaces under one roof. Each has its own catalogue, its own discovery and its own language, because a producer licensing a beat and a DJ buying a finished record need different things.</p>
      <div class="about-stores">
        <a class="about-store" data-eco="beats" href="#/beats"><span class="from-kicker">${I("mic", "i-xs")} Beats Store</span><h2 class="h3">Production material for artists &amp; creators</h2><p class="muted">Beats, instrumentals, stems, samples, loops and production packs. Sold as <b>licenses</b> with terms you can read before you buy, from verified <b>producers</b>.</p></a>
        <a class="about-store" data-eco="electronic" href="#/electronic"><span class="from-kicker">${I("headphones", "i-xs")} Electronic Music Store</span><h2 class="h3">Finished music for DJs, listeners &amp; collectors</h2><p class="muted">Singles, EPs, albums, remixes, compilations and DJ tools. Sold as <b>downloads</b> in WAV, AIFF or MP3, from <b>artists</b> and <b>labels</b>, with catalogue numbers, keys and charts.</p></a>
      </div>
      <h2 class="h3" style="margin:36px 0 12px">How it fits together</h2>
      <pre class="arch mono" aria-label="Platform architecture">Platform (shared): accounts · payments · orders · notifications · downloads · payouts
├── Beats Store        marketplace = "beats"
│   ├── Beat           sold under a License (Basic · Premium · Trackout · Exclusive)
│   ├── Pack           samples · loops · production packs · stem kits
│   └── Producer       storefronts, verification, reviews
└── Electronic Music Store   marketplace = "electronic"
    ├── Track          sold as a download (WAV · AIFF · MP3)
    ├── Release        single · EP · album · remixes · compilation · DJ tools
    ├── Artist
    └── Label          storefronts, catalogue numbers, charts</pre>
      <p class="muted" style="margin-top:14px">Every product carries a marketplace tag, and the service layer enforces it. A beat can’t be sold as a download, a track can’t carry a license, and search and discovery stay inside the store you’re in unless you choose to search both.</p>
      <div style="display:flex;gap:10px;margin-top:28px;flex-wrap:wrap"><a class="btn btn-primary" href="#/beats">Enter Beats Store</a><a class="btn btn-secondary" href="#/electronic">Enter Electronic Music Store</a></div>
    </div><div style="height:48px"></div>`,
  });
})();
