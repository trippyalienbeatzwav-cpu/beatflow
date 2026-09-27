/* Beat detail page */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;
  const reviewDate = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const COMPARE_ROWS = ["Files", "Distribution copies", "Audio streams", "Music videos", "Radio broadcasting", "Live performances", "Producer credit", "Term"];
  const cell = (beat, l, row) => {
    const hit = l.terms.find(([k]) => k === row);
    if (hit) return BF.esc(BF.fillProducer(hit[1], beat));
    if (l.exclusive) return row === "Term" ? "Per agreement" : "Unlimited";
    return "—";
  };

  function licensePanel(beat, sel) {
    const l = BF.licenseById[sel];
    const p = BF.producerOf(beat);
    return `<div class="lic-panel card" id="licenses">
      <div class="lic-panel-head"><h2 class="h3">License this beat</h2><a class="link" href="#compare" style="font-size:13px">Compare all</a></div>
      <fieldset class="lic-list" data-lic-list><legend class="sr-only">Choose a license</legend>${BF.LICENSES.map((x) => ui.licenseOption(beat, x, x.id === sel, "detail-lic")).join("")}</fieldset>
      <div class="lic-selected" aria-live="polite">
        <p class="muted" style="font-size:13px;margin-bottom:10px">${l.summary}</p>
        ${ui.licenseTerms(beat, l)}
      </div>
      <div class="lic-cta">
        <div class="lic-total"><span class="subtle" style="font-size:13px">Total</span><span class="display" style="font-size:28px">${BF.money(BF.priceFor(beat, sel))}</span></div>
        <button class="btn btn-primary btn-lg btn-block" data-add-lic>${I("bag-plus", "i-sm")} ${BF.store.cartItem(beat.id) ? "Update cart" : "Add to cart"}</button>
        <button class="btn btn-secondary btn-lg btn-block" data-buy-now>Buy now</button>
        ${l.exclusive ? `<button class="btn btn-ghost btn-block" data-action="message" data-producer="${p.id}">${I("handshake", "i-sm")} Negotiate exclusive terms</button>` : ""}
      </div>
      <ul class="trust-list">
        <li>${I("lock", "i-sm")} Payment handled by the payment provider</li>
        <li>${I("download", "i-sm")} Download from your library once payment clears</li>
        <li>${I("license", "i-sm")} License agreement with your order ID</li>
      </ul>
      <p class="hint" style="margin-top:12px">Terms are set by ${BF.esc(p.name)} and summarized here. Read the full agreement before purchase. Not legal advice.</p>
    </div>`;
  }

  BF.route("/beats/beat/:id", {
    title: (p) => BF.beatById[p.id]?.title || "Beat not found",
    load: ({ id }) => (BF.beatById[id] ? BF.http.get(`/api/store/beats/${encodeURIComponent(id)}`).catch(() => null) : null),
    render({ id }, q, data) {
      const b = BF.beatById[id];
      if (!b) return `<div class="container">${ui.empty({ icon: "music", title: "This beat isn’t available", body: "It may have been sold exclusively or removed by the producer.", actions: `<a class="btn btn-primary" href="#/beats/catalog">Discover beats</a>` })}</div>`;
      const p = BF.producerOf(b);
      const g = BF.genreById[b.genre];
      const sel = BF.store.cartItem(b.id)?.licenseId || BF.defaultLic(b);
      const related = BF.BEATS.filter((x) => x.id !== b.id && (x.genre === b.genre || x.producerId === b.producerId)).slice(0, 6);
      const moreFrom = BF.BEATS.filter((x) => x.producerId === p.id && x.id !== b.id);
      const reviews = (data?.reviews ?? []).slice(0, 3);
      const following = BF.store.isFollowing(p.id);
      return `
      <div class="bd-hero" style="--art:url('${b.art.replace(/'/g, "%27")}')">
        <div class="container">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="#/beats/catalog">Discover</a>${I("chevron-right", "i-xs")}<a href="#/beats/catalog?genre=${g.id}">${g.name}</a>${I("chevron-right", "i-xs")}<span aria-current="page">${esc(b.title)}</span></nav>
          <div class="bd-top" data-queue="${[b.id, ...related.map((x) => x.id)].join(",")}">
            <div class="bd-art" data-beat-card="${b.id}"><img src="${b.art}" alt="Artwork for ${esc(b.title)}" width="480" height="480"></div>
            <div class="bd-info">
              <div style="display:flex;gap:8px;flex-wrap:wrap">${ui.badgeForBeat(b)}<span class="badge">${g.name}</span>${b.moods.map((m) => `<span class="badge">${esc(m)}</span>`).join("")}</div>
              <h1 class="display bd-title">${esc(b.title)}</h1>
              <div class="bd-producer">
                <a href="#/beats/producer/${p.handle}" class="avatar md"><img src="${p.avatar}" alt=""></a>
                <div style="min-width:0"><a href="#/beats/producer/${p.handle}" style="font-weight:650;display:inline-flex;align-items:center;gap:5px">${esc(p.name)}${p.verified ? BF.verifiedSeal() : ""}</a>
                  <div class="subtle" style="font-size:13px">${BF.num(p.followers)} followers · ${p.rating != null ? `${I("star-fill", "i-xs")} ${p.rating} (${p.reviews})` : "No reviews yet"}</div></div>
                <button class="btn btn-sm ${following ? "btn-secondary" : "btn-outline"}" data-action="follow" data-producer="${p.id}" aria-pressed="${following}">${following ? "Following" : "Follow"}</button>
              </div>
              <dl class="meta-grid">
                <div><dt>BPM</dt><dd class="mono">${b.bpm}</dd></div>
                <div><dt>Key</dt><dd class="mono">${b.key}</dd></div>
                <div><dt>Length</dt><dd class="mono">${BF.time(b.duration)}</dd></div>
                <div><dt>Released</dt><dd>${BF.ago(b.daysAgo)}</dd></div>
              </dl>
              <div class="bd-player">
                ${ui.playBtn(b.id, "lg accent")}
                <div style="flex:1;min-width:0">${ui.waveform(b, { bars: 140 })}<div class="bd-times mono"><span>Tagged preview</span><span>${BF.time(b.duration)}</span></div></div>
              </div>
              <div class="bd-actions">
                <span class="bd-stat">${I("headphones", "i-sm")} ${BF.num(b.plays)} plays</span>
                <span class="bd-stat">${I("heart", "i-sm")} ${BF.num(b.likes)}</span>
                <span style="flex:1"></span>
                ${b.freeDownload ? `<button class="btn btn-secondary btn-sm" data-free-dl title="Free MP3 for non-commercial use">${I("download", "i-sm")}<span class="hide-sm">Free MP3</span></button>` : ""}
                ${ui.favBtn(b.id, "btn btn-secondary btn-sm")}
                <button class="btn btn-secondary btn-sm" data-action="playlist" data-beat="${b.id}">${I("playlist", "i-sm")}<span class="hide-sm">Save</span></button>
                <button class="btn btn-secondary btn-sm" data-action="share" data-href="#/beats/beat/${b.id}">${I("share", "i-sm")}<span class="hide-sm">Share</span></button>
                <button class="btn btn-ghost btn-sm" data-action="report" data-beat="${b.id}" aria-label="Report this beat">${I("flag", "i-sm")}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="container bd-body">
        <div class="bd-main">
          <section class="bd-section"><h2 class="h3">About this beat</h2>
            <p class="muted" style="margin-top:10px;max-width:680px">${esc(b.description || "No description yet.")} Previews are compressed and streamed; purchased files are the full-quality masters.</p>
            <div class="tag-row">${b.tags.map((t) => `<a class="tag" href="#/beats/catalog?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>
          </section>

          <section class="bd-section two-col">
            <div><h2 class="eyebrow no-rule">Credits</h2><dl class="kv">${b.credits.map(([k, v]) => `<div><dt>${k}</dt><dd>${BF.esc(v)}</dd></div>`).join("")}</dl></div>
            <div><h2 class="eyebrow no-rule">Stems in Trackout</h2>${b.stems.length ? `<ul class="stem-list">${b.stems.map((s) => `<li>${I("file-audio", "i-sm")} ${esc(s)}<span class="mono subtle">WAV</span></li>`).join("")}</ul>` : BF.licAvailable(b, "trackout") ? `<p class="muted" style="font-size:13.5px">The producer’s stems archive is delivered as uploaded.</p>` : `<p class="muted" style="font-size:13.5px">No stems uploaded — Trackout and Exclusive aren’t offered.</p>`}</div>
          </section>

          <section class="bd-section" id="compare"><h2 class="h3">Compare licenses</h2>
            <p class="muted" style="font-size:14px;margin:6px 0 16px">Configured by ${BF.esc(p.name)}. Limits apply per release.</p>
            <div class="table-wrap card"><table class="table compare"><thead><tr><th scope="col">Term</th>${BF.LICENSES.map((l) => `<th scope="col">${l.short}<div class="mono" style="color:var(--text);font-size:13px;text-transform:none;letter-spacing:0;margin-top:2px">${BF.licAvailable(b, l.id) ? BF.money(BF.priceFor(b, l.id)) : BF.licUnavailableLabel(b, l)}</div></th>`).join("")}</tr></thead>
              <tbody>${COMPARE_ROWS.map((r) => `<tr><th scope="row">${r}</th>${BF.LICENSES.map((l) => `<td>${cell(b, l, r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          </section>

          <section class="bd-section"><h2 class="h3">Ownership &amp; rights</h2>
            <div class="rights-grid">
              <div class="rights-item">${I("shield")}<div><b>Producer attestation</b><p>${BF.esc(p.name)} has confirmed they own or control the rights to this composition and recording.</p></div></div>
              <div class="rights-item">${I("disc")}<div><b>Samples</b><p>Declared as an original composition. No third-party samples listed by the producer.</p></div></div>
              <div class="rights-item">${I("key")}<div><b>Content ID</b><p>${b.contentId}. ${b.contentId === "Registered" ? "Licensees can request a whitelist from their library." : "No fingerprinting claims expected."}</p></div></div>
              <div class="rights-item">${I("flag")}<div><b>See a problem?</b><p>If this beat uses your work, <button class="link" data-action="report" data-beat="${b.id}">file a report</button> — we review every claim.</p></div></div>
            </div>
          </section>

          <section class="bd-section"><div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px"><h2 class="h3">Reviews</h2><a class="link" href="#/beats/producer/${p.handle}?tab=about" style="font-size:13px">All ${p.reviews} reviews</a></div>
            ${p.rating != null ? `<div class="review-summary"><span class="display" style="font-size:44px">${p.rating.toFixed(1)}</span><div>${ui.stars(p.rating)}<div class="subtle" style="font-size:13px">${p.reviews} verified-purchase reviews for ${esc(p.name)}</div></div></div>` : `<p class="muted">No reviews yet. Buyers can review a producer from their library after a purchase.</p>`}
            <ul class="review-list">${reviews.map((r) => `<li class="review"><div class="review-head"><b>${esc(r.display_name)}</b>${ui.stars(r.rating)}<span class="badge badge-success">${I("check", "i-xs")} Verified purchase</span><span class="subtle" style="font-size:12.5px;margin-left:auto">${reviewDate(r.created_at)}</span></div><p>${esc(r.body)}</p></li>`).join("")}</ul>
          </section>
        </div>

        <aside class="bd-side" data-lic-host>${licensePanel(b, sel)}
          <div class="card card-pad" style="margin-top:16px">
            <div style="display:flex;gap:12px;align-items:center"><div class="avatar md"><img src="${p.avatar}" alt=""></div><div style="min-width:0"><a href="#/beats/producer/${p.handle}" style="font-weight:650;display:inline-flex;gap:5px;align-items:center">${esc(p.name)}${p.verified ? BF.verifiedSeal() : ""}</a><div class="subtle" style="font-size:13px">${[p.location, p.since && `since ${p.since}`].filter(Boolean).map(esc).join(" · ")}</div></div></div>
            <p class="muted" style="font-size:13.5px;margin:12px 0">${esc(p.bio)}</p>
            <div class="stat-row"><div><b>${BF.num(p.followers)}</b><span>Followers</span></div><div><b>${BF.num(p.sales)}</b><span>Sales</span></div></div>
            <button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="message" data-producer="${p.id}">${I("message", "i-sm")} Contact producer</button>
          </div>
        </aside>
      </div>

      ${moreFrom.length ? `<section class="section container">${ui.sectionHead("", `By ${BF.esc(p.name)}`, "More from this producer", `<a class="see-all" href="#/beats/producer/${p.handle}">Storefront ${I("arrow-right", "i-xs")}</a>`)}<div class="rail cols-6" data-queue="${moreFrom.map((x) => x.id).join(",")}">${moreFrom.map((x) => ui.beatCard(x)).join("")}</div></section>` : ""}
      <section class="section container">${ui.sectionHead("", "Similar sound", "Related beats", "")}<div class="rail cols-6" data-queue="${related.map((x) => x.id).join(",")}">${related.map((x) => ui.beatCard(x)).join("")}</div></section>
      <div style="height:48px"></div>`;
    },
    mount(el, { id }) {
      const b = BF.beatById[id]; if (!b) return;
      const host = el.querySelector("[data-lic-host]");
      el.querySelector("[data-free-dl]")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        if (!BF.store.get("session").signedIn) { location.hash = `#/login?next=${encodeURIComponent(`/beats/beat/${b.id}`)}`; return; }
        btn.disabled = true;
        try {
          const { entitlement } = await BF.http.post(`/api/store/beats/${b.id}/free-download`);
          const f = entitlement.files[0];
          btn.dataset.dlEnt = entitlement.id; btn.dataset.dlFile = f.file; btn.dataset.dlFormat = f.format;
          btn.disabled = false;
          await BF.downloads.start(btn);
        } catch (err) { btn.disabled = false; ui.toast({ kind: "error", title: "Couldn’t start the download", desc: esc(err.message) }); }
      });
      let sel = BF.store.cartItem(b.id)?.licenseId || BF.defaultLic(b);
      const repaint = () => { host.querySelector(".lic-panel").outerHTML = licensePanel(b, sel); };
      host.addEventListener("change", (e) => { if (e.target.name === "detail-lic") { sel = e.target.value; repaint(); host.querySelector(`input[value="${sel}"]`).focus(); } });
      host.addEventListener("click", (e) => {
        const add = e.target.closest("[data-add-lic]"), buy = e.target.closest("[data-buy-now]");
        if (!add && !buy) return;
                let res;
        try { res = BF.store.addToCart(b.id, sel); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t add to cart", desc: esc(err.message) }); return; }
        if (buy) { location.hash = "#/checkout"; return; }
        repaint();
        ui.toast({ title: res === "added" ? "Added to cart" : "License updated", desc: `${esc(b.title)} · ${BF.licenseById[sel].name}`, art: b.art, action: { href: "#/cart", label: "View cart" } });
      });
    },
  });
})();
