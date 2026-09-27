/* Platform-level pages that span both marketplaces:
   - /search : the explicit "search both marketplaces" results, grouped by store (never interleaved)
   - /sell   : one seller account, two stores */
(function () {
  const I = BF.icon, ui = BF.ui, M = BF.mui, esc = BF.esc;

  BF.route("/search", {
    title: (_, q) => `Search both stores: ${q.q || ""}`,
    load: (_, q) => ((q.q || "").trim() ? BF.api.search((q.q || "").trim().slice(0, 200), { limit: 99 }) : null),
    render(_, q, r) {
      const term = (q.q || "").trim();
      if (!term) return `<div class="container" style="padding-top:40px">${ui.empty({ icon: "search", title: "Search both marketplaces", body: "Beats, producers and packs from the Beats Store — tracks, releases, artists and labels from the Electronic Music Store.", actions: `<button class="btn btn-primary" data-action="search">${I("search", "i-sm")} Open search</button>` })}</div>`;
      const b = r.beats, m = r.electronic, ks = r.packs;
      const bCount = (b.totalBeats || 0) + b.producers.length + ks.length;
      const eCount = m.totalTracks + m.allReleases.length + m.artists.length + m.labels.length;
      const beatsSec = `<section class="sr-store" data-eco="beats" aria-labelledby="sr-b">
          <header class="sr-store-head"><div><span class="from-kicker">${I("mic", "i-xs")} Beats Store</span><h2 id="sr-b" class="h2">${bCount} result${bCount === 1 ? "" : "s"}</h2></div><a class="btn btn-secondary btn-sm" href="#/beats/search?q=${encodeURIComponent(term)}">Open in Beats Store ${I("arrow-right", "i-xs")}</a></header>
          ${!bCount ? `<p class="muted">Nothing in the Beats Store for “${esc(term)}”.</p>` : `
          ${b.allBeats.length ? `<h3 class="sr-sub">Beats</h3><div class="beat-list" role="list" data-queue="${b.allBeats.map((x) => x.id).join(",")}">${ui.beatListHead()}${b.allBeats.slice(0, 6).map((x, i) => ui.beatRow(x, i)).join("")}</div>` : ""}
          ${ks.length ? `<h3 class="sr-sub">Packs</h3><div class="grid-beats">${ks.map(BF.beatsUI.packCard).join("")}</div>` : ""}
          ${b.producers.length ? `<h3 class="sr-sub">Producers</h3><div class="producer-grid">${b.producers.map(ui.producerCard).join("")}</div>` : ""}`}
        </section>`;
      const elSec = `<section class="sr-store" data-eco="electronic" aria-labelledby="sr-e">
          <header class="sr-store-head"><div><span class="from-kicker">${I("headphones", "i-xs")} Electronic Music Store</span><h2 id="sr-e" class="edisplay sm">${eCount} result${eCount === 1 ? "" : "s"}</h2></div><a class="btn btn-secondary btn-sm" href="#/electronic/search?q=${encodeURIComponent(term)}">Open in Electronic Music Store ${I("arrow-right", "i-xs")}</a></header>
          ${m.parsed.any ? `<div class="parsed" style="margin-bottom:12px">${BF.parsedChips(m.parsed)}</div>` : ""}
          ${!eCount ? `<p class="muted">Nothing in the Electronic Music Store for “${esc(term)}”.</p>` : `
          ${m.allTracks.length ? `<h3 class="sr-sub">Tracks</h3>${M.trackList(m.allTracks.slice(0, 8))}` : ""}
          ${m.allReleases.length ? `<h3 class="sr-sub">Releases</h3><div class="rgrid">${m.allReleases.slice(0, 6).map((x) => M.releaseCard(x)).join("")}</div>` : ""}
          ${m.artists.length ? `<h3 class="sr-sub">Artists</h3><div class="agrid">${m.artists.map(M.artistCard).join("")}</div>` : ""}
          ${m.labels.length ? `<h3 class="sr-sub">Labels</h3><div class="lgrid">${m.labels.map(M.labelCard).join("")}</div>` : ""}`}
        </section>`;
      const electronicFirst = m.parsed.any || eCount > bCount;
      return `<div class="container" style="padding-top:32px">
        <span class="eyebrow">Search · both marketplaces</span><h1 class="h1" style="margin:8px 0 6px">“${esc(term)}”</h1>
        <p class="muted" style="font-size:14px;margin-bottom:8px">Results stay grouped by store: the two catalogues are never mixed.</p>
        ${!bCount && !eCount ? ui.empty({ icon: "search", title: `No results for “${esc(term)}”`, body: "Try a genre, a key like 8A, or a BPM." }) : electronicFirst ? elSec + beatsSec : beatsSec + elSec}
      </div><div style="height:48px"></div>`;
    },
  });

  BF.route("/sell", {
    title: "Sell on " + BF.brand.displayName,
    render: () => `<div class="container narrow" style="padding-top:40px;max-width:980px">
      <span class="eyebrow">Sell</span><h1 class="h1" style="margin:8px 0 8px">Which store are you selling in?</h1>
      <p class="muted" style="max-width:600px">One seller account covers both stores — the same payouts, verification and messages. Your products stay in the store they belong to.</p>
      <div class="sell-grid">
        <a class="sell-card" data-eco="beats" href="#/dashboard/upload"><span class="sell-ic">${I("mic", "i-lg")}</span><span class="from-kicker">Beats Store</span><h2 class="h3">Beats, stems &amp; packs</h2><p class="muted">License beats with Basic, Premium, Trackout and Exclusive terms you control. Sell sample packs, loops and production kits.</p><span class="link">Upload a beat ${I("arrow-right", "i-xs")}</span></a>
        <a class="sell-card eco" data-eco="electronic" href="#/dashboard/release-upload"><span class="sell-ic">${I("headphones", "i-lg")}</span><span class="from-kicker">Electronic Music Store</span><h2 class="h3">Finished electronic music</h2><p class="muted">Release singles, EPs, albums, remixes, compilations and DJ tools as WAV, AIFF and MP3 downloads, as an artist or a label.</p><span class="link">Upload a release ${I("arrow-right", "i-xs")}</span></a>
      </div></div>`,
  });
})();
