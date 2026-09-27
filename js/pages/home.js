/* Landing page */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;
  const trendingBeats = () => [...BF.BEATS].sort((a, b) => b.trendScore - a.trendScore);
  const since = (t) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

  function hero() {
    const [f, s1, s2] = trendingBeats(), p = f && BF.producerOf(f);
    if (!f) return "";
    return `<section class="hero">
      <svg class="hero-wave" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true">
        ${Array.from({ length: 5 }, (_, l) => `<path d="${Array.from({ length: 121 }, (_, i) => `${i ? "L" : "M"}${i * 10} ${100 + Math.sin(i / 7 + l * 0.6) * (30 + l * 10) * Math.sin((i / 120) * Math.PI)}`).join(" ")}" fill="none" stroke="${l === 2 ? "url(#hw)" : "rgba(255,255,255,.05)"}" stroke-width="${l === 2 ? 1.5 : 1}"/>`).join("")}
        <defs><linearGradient id="hw"><stop offset="0" stop-color="#8d68ff" stop-opacity="0"/><stop offset=".5" stop-color="#8d68ff"/><stop offset="1" stop-color="#5fe0f7" stop-opacity="0"/></linearGradient></defs>
      </svg>
      <div class="container hero-grid">
        <div class="hero-copy">
          <span class="eyebrow"><span class="idx">●</span>Beats Store · Licensing · Producer stores</span>
          <h1 class="display hero-title">Your Sound.<br><span class="accent">Your Marketplace.</span></h1>
          <p class="body-lg hero-sub">Artists discover and license beats from independent producers — with clear terms on every track. Producers build a storefront, set their own licenses, and get paid for their sound.</p>
          <div class="hero-ctas">
            <a class="btn btn-primary btn-xl" href="#/beats/catalog">${I("compass", "i-sm")} Explore Beats</a>
            <a class="btn btn-outline btn-xl" href="#/signup?role=producer">Sell Your Beats ${I("arrow-right", "i-sm")}</a>
          </div>
          <form class="hero-search" role="search" data-hero-search>
            ${I("search", "i-sm")}<label class="sr-only" for="hs">Search beats</label>
            <input id="hs" class="input" placeholder="Try “dark trap 140” or “afrobeats”" autocomplete="off">
            <button class="btn btn-sm btn-secondary">Search</button>
          </form>
          <div class="hero-quick">${[...BF.GENRES].sort((a, b) => b.count - a.count).slice(0, 5).map((g) => `<a class="chip" href="#/beats/catalog?genre=${g.id}">${esc(g.name)}</a>`).join("")}</div>
        </div>

        <div class="hero-feature" data-queue="${trendingBeats().slice(0, 5).map((b) => b.id).join(",")}">
          <div class="hf-card" data-beat-card="${f.id}">
            <div class="hf-top"><span class="badge badge-solid">${I("fire", "i-xs")} #1 this week</span><span class="mono subtle" style="font-size:12px">Featured drop</span></div>
            <div class="hf-art"><img src="${f.art}" alt="Artwork for ${esc(f.title)}"><div class="hf-art-play">${ui.playBtn(f.id, "xl accent")}</div></div>
            <div class="hf-meta">
              <div style="min-width:0"><a class="h2 hf-title" href="#/beats/beat/${f.id}">${esc(f.title)}</a>
                <div class="hf-prod">${ui.producerLink(p)}<span class="subtle">· ${esc(BF.genreById[f.genre]?.name ?? "")}</span></div></div>
              ${ui.favBtn(f.id)}
            </div>
            ${ui.waveform(f, { bars: 96 })}
            <div class="hf-foot">${ui.spec(f, { genre: false })}<button class="btn btn-sm btn-light" data-action="license" data-beat="${f.id}">${I("bag-plus", "i-xs")} From ${BF.money(BF.basePrice(f))}</button></div>
          </div>
          ${s1 && s2 ? `<div class="hf-stack" aria-hidden="true"><img src="${s1.art}" alt=""><img src="${s2.art}" alt=""></div>` : ""}
        </div>
      </div>
    </section>`;
  }

  function ticker() {
    // Real, anonymous recent sales (item · tier · time); hidden until there are some
    if (BF.RECENT_SALES.length < 3) return "";
    const items = BF.RECENT_SALES.map((s) => { const it = s.kind === "beat" ? BF.beatById[s.itemId] : BF.packById[s.itemId]; return `<span class="tk-item"><span class="tk-dot"></span><b>${esc(it.title)}</b> <span class="subtle">${s.licenseId ? esc(BF.licenseById[s.licenseId]?.name ?? "") : "Pack"} · ${since(s.paidAt)}</span></span>`; }).join("");
    return `<div class="ticker" aria-label="Recently licensed beats"><div class="ticker-label mono">Just licensed</div><div class="ticker-track"><div class="ticker-inner">${items}${items}</div></div></div>`;
  }

  function packsRow() {
    const ks = BF.api.catalog("beats", "pack").slice(0, 6);
    return `<section class="section container">
      ${ui.sectionHead("04", "Production material", "Samples, Loops &amp; Packs", `<a class="see-all" href="#/beats/discover">All packs ${I("arrow-right", "i-xs")}</a>`)}
      <div class="rail cols-6" data-queue="${ks.map((k) => k.id).join(",")}">${ks.map(BF.beatsUI.packCard).join("")}</div>
    </section>`;
  }


  function trending() {
    const top = [...BF.BEATS].sort((a, b) => b.trendScore - a.trendScore).slice(0, 10);
    const moves = [2, 0, 5, -1, 1, "new", -2, 3, 0, "new"];
    const ids = top.map((b) => b.id).join(",");
    const row = (b, i) => {
      const m = moves[i];
      const mv = m === "new" ? `<span class="mv new">NEW</span>` : m > 0 ? `<span class="mv up" aria-label="Up ${m}">${I("chevron-up", "i-xs")}${m}</span>` : m < 0 ? `<span class="mv down" aria-label="Down ${-m}">${I("chevron-down", "i-xs")}${-m}</span>` : `<span class="mv" aria-label="No change">–</span>`;
      return `<li class="chart-row" data-beat-card="${b.id}">
        <span class="rank mono">${String(i + 1).padStart(2, "0")}</span>${mv}
        <div class="art sm"><img src="${b.art}" alt="" loading="lazy"><button class="chart-play" data-action="play" data-beat="${b.id}" aria-label="Play ${b.title}">${I("play", "i-sm ic-play")}${I("pause", "i-sm ic-pause")}</button></div>
        <div class="cr-main"><a class="title truncate" href="#/beats/beat/${b.id}">${b.title}</a><span class="subtle truncate" style="font-size:13px">${BF.esc(BF.producerOf(b).name)} · ${BF.genreById[b.genre].name}</span></div>
        <span class="mono subtle cr-plays hide-sm">${I("headphones", "i-xs")} ${BF.num(b.plays)}</span>
        ${ui.priceBtn(b)}
      </li>`;
    };
    return `<section class="section container">
      ${ui.sectionHead("01", "Charts · updated hourly", "Trending Beats", `<a class="see-all" href="#/beats/charts">Full chart ${I("arrow-right", "i-xs")}</a>`)}
      <ol class="chart-list" data-queue="${ids}">${top.map(row).join("")}</ol>
    </section>`;
  }

  function featuredProducers() {
    const list = [BF.producerById.p1, BF.producerById.p3, BF.producerById.p2, BF.producerById.p4];
    return `<section class="section container">
      ${ui.sectionHead("02", "Verified storefronts", "Featured Producers", `<a class="see-all" href="#/beats/producers">All producers ${I("arrow-right", "i-xs")}</a>`)}
      <div class="producer-grid">${list.map(ui.producerCard).join("")}</div>
    </section>`;
  }

  function newReleases() {
    const list = [...BF.BEATS].sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 12);
    return `<section class="section container">
      ${ui.sectionHead("03", "Fresh this week", "Fresh Beats", `<div style="display:flex;gap:12px;align-items:center"><div class="rail-nav"><button class="icon-btn sm" data-rail="-1" aria-label="Scroll left">${I("chevron-left", "i-sm")}</button><button class="icon-btn sm" data-rail="1" aria-label="Scroll right">${I("chevron-right", "i-sm")}</button></div><a class="see-all" href="#/beats/catalog?sort=newest">See all ${I("arrow-right", "i-xs")}</a></div>`)}
      <div class="rail cols-6" data-queue="${list.map((b) => b.id).join(",")}" tabindex="0" aria-label="Fresh beats, scroll horizontally">${list.map((b) => ui.beatCard(b)).join("")}</div>
    </section>`;
  }

  function genres() {
    return `<section class="section container">
      ${ui.sectionHead("05", "Browse by sound", "Popular Genres", `<a class="see-all" href="#/beats/genres">Explore all ${I("arrow-right", "i-xs")}</a>`)}
      <div class="genre-grid">${BF.GENRES.map((g, i) => `<a class="genre-tile ${i === 0 ? "big" : ""}" href="#/beats/catalog?genre=${g.id}"><img src="${BF.art(g.id + "tile", g.style, g.palette)}" alt="" loading="lazy"><span class="gt-name">${g.name}</span><span class="gt-count mono">${g.count.toLocaleString()} beats</span></a>`).join("")}</div>
    </section>`;
  }

  function howItWorks() {
    const artist = [
      ["headphones", "Preview everything", "Stream full tagged previews, filter by BPM, key, mood and genre, and save favorites to playlists."],
      ["license", "Pick the right license", "Compare Basic, Premium, Trackout and Exclusive terms side-by-side. Every limit is written in plain language."],
      ["download", "Download & release", "Files and your license agreement arrive instantly — stored in your library with the order ID."],
    ];
    const producer = [
      ["cloud-upload", "Upload your catalog", "WAV, MP3 and stems with artwork, BPM, key, mood and tags. Drafts autosave as you go."],
      ["sliders", "Set your terms", "Configure license tiers, pricing, stream caps and exclusive availability — your store, your rules."],
      ["chart", "Grow & get paid", "Track plays, conversion and revenue per beat. Payouts land on your schedule."],
    ];
    const steps = (list) => list.map(([ic, t, d], i) => `<li class="hiw-step"><span class="hiw-n mono">0${i + 1}</span><span class="hiw-icon">${I(ic)}</span><h3 class="h3">${t}</h3><p class="muted">${d}</p></li>`).join("");
    return `<section class="section container">
      ${ui.sectionHead("06", "Artists &amp; producers", "How It Works", "")}
      <div class="tabs" role="tablist" aria-label="How it works for" style="margin-bottom:28px">
        <button class="tab" role="tab" aria-selected="true" aria-controls="hiw-a" id="hiw-ta" data-hiw="a">${I("mic", "i-sm")} For artists</button>
        <button class="tab" role="tab" aria-selected="false" aria-controls="hiw-p" id="hiw-tp" data-hiw="p" tabindex="-1">${I("disc", "i-sm")} For producers</button>
      </div>
      <ol class="hiw" id="hiw-a" role="tabpanel" aria-labelledby="hiw-ta">${steps(artist)}</ol>
      <ol class="hiw" id="hiw-p" role="tabpanel" aria-labelledby="hiw-tp" hidden>${steps(producer)}</ol>
    </section>`;
  }

  function topSellers() {
    const ps = [...BF.PRODUCERS].filter((p) => p.sales > 0).sort((a, b) => b.sales - a.sales).slice(0, 3);
    if (!ps.length) return "";
    return `<section class="section container">
      ${ui.sectionHead("07", "Producer success", "Top-selling producers", `<a class="see-all" href="#/beats/producers">All producers ${I("arrow-right", "i-xs")}</a>`)}
      <div class="testi-grid">${ps.map((p) => { const top = p.beatIds.map((id) => BF.beatById[id]).filter(Boolean).sort((a, b) => b.sales - a.sales)[0]; return `<figure class="testi">
        <div class="testi-stat"><span class="display">${BF.num(p.sales)}</span><span class="mono subtle">licenses sold</span></div>
        <blockquote>${top ? `Best seller: <a class="link" href="#/beats/beat/${top.id}">${esc(top.title)}</a> · ${BF.num(top.sales)} sales` : esc(p.bio)}</blockquote>
        <figcaption><span class="avatar sm"><img src="${p.avatar}" alt=""></span><span><a href="#/beats/producer/${p.handle}" style="font-weight:600;display:inline-flex;gap:4px;align-items:center">${esc(p.name)}${p.verified ? BF.verifiedSeal() : ""}</a><span class="subtle" style="display:block;font-size:13px">${BF.num(p.followers)} followers${p.rating != null ? ` · ${p.rating.toFixed(1)}★` : ""}</span></span></figcaption>
      </figure>`; }).join("")}</div>
    </section>`;
  }

  function producerCta() {
    const top = trendingBeats()[0], last = BF.RECENT_SALES[0], lastItem = last && (last.kind === "beat" ? BF.beatById[last.itemId] : BF.packById[last.itemId]);
    return `<section class="section container">
      <div class="cta-block">
        <div class="cta-copy">
          <span class="eyebrow"><span class="idx">08</span>For producers</span>
          <h2 class="h1">Turn your beats into a business.</h2>
          <p class="body-lg">A storefront that looks like your brand, licenses you control, and analytics that show what’s actually converting.</p>
          <ul class="cta-list">${["Keep 85% of every beat sale", "Upload WAV/AIFF masters and stems — tempo, key and previews are generated for you", "Four license tiers priced with one multiplier", "Withdraw earnings once the refund hold clears"].map((x) => `<li>${I("check", "i-sm")}${x}</li>`).join("")}</ul>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-primary btn-lg" href="#/signup?role=producer">Start selling — it’s free</a><a class="btn btn-ghost btn-lg" href="#/dashboard">View a live dashboard</a></div>
        </div>
        <div class="cta-visual" aria-hidden="true">
          ${top ? `<div class="cv-card">
            <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="mono subtle" style="font-size:12px">TRENDING NOW</span><span class="badge badge-success">${I("headphones", "i-xs")} ${BF.num(top.plays)} plays</span></div>
            <div class="h3" style="margin:8px 0 10px">${esc(top.title)}</div>
            ${ui.waveform(top, { bars: 64, cls: "sm" })}
          </div>` : ""}
          ${lastItem ? `<div class="cv-card cv-order"><div class="art sm"><img src="${lastItem.art}" alt=""></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px">Latest sale · ${esc(lastItem.title)}</div><div class="subtle" style="font-size:12.5px">${last.licenseId ? esc(BF.licenseById[last.licenseId]?.name ?? "") : "Pack"} · ${since(last.paidAt)}</div></div></div>` : ""}
        </div>
      </div>
    </section>`;
  }

  BF.route("/beats", {
    title: "",
    render: () => hero() + ticker() + trending() + featuredProducers() + newReleases() + packsRow() + genres() + howItWorks() + topSellers() + producerCta() + `<div style="height:64px"></div>`,
    mount(el) {
      el.querySelector("[data-hero-search]").addEventListener("submit", (e) => {
        e.preventDefault(); const q = el.querySelector("#hs").value.trim();
        if (q) { BF.store.pushRecentSearch(q); location.hash = `#/search?q=${encodeURIComponent(q)}`; } else location.hash = "#/beats/catalog";
      });
      el.addEventListener("click", (e) => {
        const r = e.target.closest("[data-rail]");
        if (r) { const rail = r.closest("section").querySelector(".rail"); rail.scrollBy({ left: rail.clientWidth * 0.9 * +r.dataset.rail, behavior: BF.reducedMotion() ? "auto" : "smooth" }); }
        const t = e.target.closest("[data-hiw]");
        if (t) BF.selectTab(t);
      });
      el.querySelector('[role="tablist"]').addEventListener("keydown", BF.tabKeys);
    },
  });

  /* Shared ARIA tab helpers */
  BF.selectTab = (tab) => {
    const list = tab.closest('[role="tablist"]');
    BF.$$('[role="tab"]', list).forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute("aria-controls")); if (panel) panel.hidden = !on;
    });
  };
  BF.tabKeys = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = BF.$$('[role="tab"]', e.currentTarget); const i = tabs.indexOf(document.activeElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault(); tabs[n].focus(); tabs[n].click();
  };
})();
