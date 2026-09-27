/* Producer storefront */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;
  const reviewDate = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  function tabBeats(p) {
    const beats = p.beatIds.map((id) => BF.beatById[id]).filter(Boolean);
    if (!beats.length) return ui.empty({ icon: "music", title: "No beats yet", body: `${esc(p.name)} hasn’t published any beats.` });
    return `<div class="store-tools"><div class="input-group" style="flex:1;max-width:360px">${I("search", "i-sm")}<label class="sr-only" for="st-q">Search this store</label><input class="input input-sm" id="st-q" placeholder="Search ${BF.esc(p.name)}’s beats"></div>
      <select class="select input-sm" style="width:auto" aria-label="Sort catalog" data-st-sort><option value="newest">Newest</option><option value="popular">Most played</option><option value="price">Price</option><option value="bpm">BPM</option></select></div>
      <div class="beat-list" role="list" data-store-list data-queue="${beats.map((b) => b.id).join(",")}">${ui.beatListHead()}${beats.map((b, i) => ui.beatRow(b, i)).join("")}</div>
      `;
  }
  function tabPlaylists(p) {
    const pls = BF.PLAYLISTS.filter((x) => x.by === p.id);
    if (!pls.length) return ui.empty({ icon: "playlist", title: "No public playlists", body: "Playlists this producer curates will show up here." });
    return `<div class="playlist-grid">${pls.map((pl) => `<article class="playlist-card" data-queue="${pl.beatIds.join(",")}">
      <div class="art"><img src="${pl.art}" alt=""><div class="art-overlay" style="opacity:1;background:linear-gradient(transparent 40%,rgba(0,0,0,.7));place-items:end start;padding:14px">${ui.playBtn(pl.beatIds[0], "accent")}</div></div>
      <div><h3 class="h4">${esc(pl.title)}</h3><p class="subtle" style="font-size:13px">${pl.beatIds.length} beats · ${BF.time(pl.beatIds.reduce((s, id) => s + BF.beatById[id].duration, 0))}</p>
      <ol class="pl-mini">${pl.beatIds.map((id) => `<li><a href="#/beats/beat/${id}">${BF.beatById[id].title}</a><span class="mono subtle">${BF.beatById[id].bpm}</span></li>`).join("")}</ol></div></article>`).join("")}</div>`;
  }
  function tabAbout(p, reviews) {
    const dist = [5, 4, 3, 2, 1].map((s) => reviews.filter((r) => r.rating === s).length);
    return `<div class="about-grid">
      <div>
        <h2 class="h3">About</h2><p class="muted" style="margin:10px 0 24px;max-width:640px">${esc(p.bio || "No bio yet.")}</p>
        <h3 class="eyebrow no-rule" style="margin-bottom:10px">Genres</h3><div class="tag-row" style="margin-top:0">${p.genres.filter((g) => BF.genreById[g]).map((g) => `<a class="tag no-hash" href="#/beats/catalog?genre=${g}">${esc(BF.genreById[g].name)}</a>`).join("") || `<span class="subtle">—</span>`}</div>
        <h3 class="h3" style="margin:32px 0 12px">Reviews <span class="subtle" style="font-weight:400">· ${p.reviews}</span></h3>
        ${p.rating != null ? `<div class="review-summary"><span class="display" style="font-size:44px">${p.rating.toFixed(1)}</span><div>${ui.stars(p.rating)}${reviews.length ? `<div class="rating-bars" aria-label="Rating distribution of the ${reviews.length} most recent reviews">${[5, 4, 3, 2, 1].map((s, i) => `<div><span class="mono">${s}</span><span class="progress"><span style="width:${Math.round((dist[i] / reviews.length) * 100)}%;background:var(--amber-400)"></span></span></div>`).join("")}</div>` : ""}</div></div>` : `<p class="muted">No reviews yet.</p>`}
        <ul class="review-list">${reviews.map((r) => `<li class="review"><div class="review-head"><b>${esc(r.display_name)}</b>${ui.stars(r.rating)}<span class="badge badge-success">${I("check", "i-xs")} Verified purchase</span><span class="subtle" style="font-size:12.5px;margin-left:auto">${reviewDate(r.created_at)}</span></div><p>${esc(r.body)}</p>${BF.beatById[r.beat_id] ? `<span class="subtle" style="font-size:12.5px">on <a class="link" href="#/beats/beat/${r.beat_id}">${esc(BF.beatById[r.beat_id].title)}</a></span>` : ""}</li>`).join("")}</ul>${p.reviews > reviews.length ? `<p class="hint">Showing the ${reviews.length} most recent of ${p.reviews} reviews (the rest were imported from the catalog’s history).</p>` : ""}
      </div>
      <aside>
        <div class="card card-pad">
          <h3 class="h4" style="display:flex;gap:6px;align-items:center">${p.verified ? BF.verifiedSeal() + " Verified producer" : I("clock", "i-sm") + " Verification pending"}</h3>
          <ul class="verify-list">
            <li class="${p.verified ? "ok" : "pending"}">${I(p.verified ? "check" : "clock", "i-sm")} Identity confirmed</li>
            <li class="${p.verified ? "ok" : "pending"}">${I(p.verified ? "check" : "clock", "i-sm")} Payout account verified</li>
            <li class="${p.verified ? "ok" : "pending"}">${I(p.verified ? "check" : "clock", "i-sm")} Catalog ownership reviewed</li>
            ${p.since ? `<li class="ok">${I("check", "i-sm")} Member since ${esc(p.since)}</li>` : ""}
          </ul>
          <a class="link" href="#/verification" style="font-size:13px">How verification works</a>
        </div>
        <div class="card card-pad" style="margin-top:16px"><h3 class="h4" style="margin-bottom:12px">Links</h3>
          <ul class="link-list">${p.socials.instagram ? `<li>${I("at", "i-sm")} ${esc(p.socials.instagram)}</li>` : ""}${p.socials.youtube ? `<li>${I("video", "i-sm")} ${esc(p.socials.youtube)}</li>` : ""}${p.socials.site ? `<li>${I("globe", "i-sm")} ${esc(p.socials.site)}</li>` : ""}${!p.socials.instagram && !p.socials.youtube && !p.socials.site ? `<li class="subtle">No links yet.</li>` : ""}</ul></div>
      </aside></div>`;
  }

  BF.route("/beats/producer/:handle", {
    title: (p) => BF.producerByHandle[p.handle]?.name || "Producer",
    load: ({ handle }) => (BF.producerByHandle[handle] ? BF.http.get(`/api/store/producers/${encodeURIComponent(handle)}`) : null),
    render({ handle }, q, data) {
      const reviews = data?.reviews ?? [];
      const p = BF.producerByHandle[handle];
      if (!p) return `<div class="container">${ui.empty({ icon: "user", title: "Producer not found", body: "This storefront doesn’t exist or has been deactivated.", actions: `<a class="btn btn-primary" href="#/beats/producers">Browse producers</a>` })}</div>`;
      const own = !!p.userId && BF.store.get("session").user?.id === p.userId;
      const feat = BF.beatById[p.beatIds.find((id) => BF.beatById[id])];
      const tab = ["beats", "playlists", "about"].includes(q.tab) ? q.tab : "beats";
      const following = BF.store.isFollowing(p.id);
      const tabs = [["beats", "Beats", p.totalBeats], ["playlists", "Playlists", BF.PLAYLISTS.filter((x) => x.by === p.id).length], ["about", "About", ""]];
      return `
      <div class="store-banner"><img src="${p.banner}" alt=""></div>
      <div class="container">
        ${own ? `<div class="notice info" style="margin-top:16px">${I("eye", "i-sm")}<div><strong>This is your storefront.</strong> You’re seeing it as visitors do. <a class="link" href="#/dashboard/storefront">Edit storefront</a></div></div>` : ""}
        <header class="store-head">
          <div class="avatar xl store-avatar"><img src="${p.avatar}" alt="${BF.esc(p.name)}"></div>
          <div class="store-id">
            <h1 class="display store-name">${esc(p.name)} ${p.verified ? BF.verifiedSeal("Verified producer") : `<span class="badge badge-warning">Verification pending</span>`}</h1>
            <div class="store-sub"><span>@${esc(p.handle)}</span>${p.location ? `<span>${I("pin", "i-xs")} ${esc(p.location)}</span>` : ""}${p.since ? `<span>${I("calendar", "i-xs")} Since ${esc(p.since)}</span>` : ""}</div>
            <p class="muted store-bio">${esc(p.bio)}</p>
            <div class="store-social">${p.socials.instagram ? `<a class="chip" href="#/beats/producer/${p.handle}" aria-label="Instagram ${p.socials.instagram}">${I("at", "i-xs")} Instagram</a>` : ""}${p.socials.youtube ? `<a class="chip" href="#/beats/producer/${p.handle}">${I("video", "i-xs")} YouTube</a>` : ""}${p.socials.site ? `<a class="chip" href="#/beats/producer/${p.handle}">${I("globe", "i-xs")} Website</a>` : ""}</div>
          </div>
          <div class="store-actions">
            ${own ? `<a class="btn btn-primary" href="#/dashboard/storefront">${I("edit", "i-sm")} Edit storefront</a>` : `<button class="btn ${following ? "btn-secondary" : "btn-primary"}" data-action="follow" data-producer="${p.id}" data-off="btn-primary" aria-pressed="${following}"><span>${following ? "Following" : "Follow"}</span></button>
            <button class="btn btn-secondary" data-action="message" data-producer="${p.id}">${I("message", "i-sm")} Message</button>`}
            <button class="btn btn-secondary btn-icon" data-action="share" data-href="#/beats/producer/${p.handle}" aria-label="Share storefront">${I("share", "i-sm")}</button>
          </div>
        </header>
        <dl class="store-stats">
          <div><dt>Followers</dt><dd>${BF.num(p.followers)}</dd></div>
          <div><dt>Beats</dt><dd>${p.totalBeats}</dd></div>
          <div><dt>Sales</dt><dd>${BF.num(p.sales)}</dd></div>
          <div><dt>Rating</dt><dd>${p.rating != null ? `${p.rating.toFixed(1)} <span class="subtle" style="font-size:13px;font-weight:400">(${p.reviews})</span>` : "—"}</dd></div>
        </dl>

        ${feat ? `<section class="store-feature card" data-queue="${p.beatIds.join(",")}" data-beat-card="${feat.id}">
          <div class="art"><img src="${feat.art}" alt=""></div>
          <div class="sf-body">
            <span class="eyebrow"><span class="idx">★</span>Featured beat</span>
            <a class="h2" href="#/beats/beat/${feat.id}">${esc(feat.title)}</a>
            <div>${ui.spec(feat, { genre: true })}</div>
            <div class="sf-player">${ui.playBtn(feat.id, "accent")}<div style="flex:1;min-width:0">${ui.waveform(feat, { bars: 110, cls: "sm" })}</div></div>
          </div>
          <div class="sf-buy"><span class="subtle" style="font-size:13px">Licenses from</span><span class="display" style="font-size:30px">${BF.money(BF.basePrice(feat))}</span><button class="btn btn-primary" data-action="license" data-beat="${feat.id}">${I("bag-plus", "i-sm")} Choose license</button>${ui.favBtn(feat.id, "btn btn-ghost btn-sm")}</div>
        </section>` : ""}

        <div class="tabs" role="tablist" aria-label="Storefront sections" style="margin-top:40px">${tabs.map(([k, l, n]) => `<button class="tab" role="tab" id="pt-${k}" aria-controls="pp-${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-ptab="${k}">${l} ${n !== "" ? `<span class="n">${n}</span>` : ""}</button>`).join("")}</div>
        ${tabs.map(([k]) => `<div class="tab-panel" role="tabpanel" id="pp-${k}" aria-labelledby="pt-${k}" ${tab === k ? "" : "hidden"}>${{ beats: tabBeats, playlists: tabPlaylists, about: tabAbout }[k](p, reviews)}</div>`).join("")}
      </div><div style="height:48px"></div>`;
    },
    mount(el, { handle }) {
      const p = BF.producerByHandle[handle]; if (!p) return;
      const tl = el.querySelector('[role="tablist"]');
      tl.addEventListener("click", (e) => { const t = e.target.closest("[data-ptab]"); if (t) { BF.selectTab(t); BF.setQuery({ tab: t.dataset.ptab === "beats" ? "" : t.dataset.ptab }); } });
      tl.addEventListener("keydown", BF.tabKeys);
      const list = el.querySelector("[data-store-list]");
      const q = el.querySelector("#st-q"), sort = el.querySelector("[data-st-sort]");
      const repaint = () => {
        let beats = p.beatIds.map((id) => BF.beatById[id]).filter(Boolean);
        const term = q.value.trim().toLowerCase();
        if (term) beats = beats.filter((b) => (b.title + " " + b.tags.join(" ") + " " + b.genre).toLowerCase().includes(term));
        const s = sort.value;
        beats.sort(s === "popular" ? (a, b) => b.plays - a.plays : s === "price" ? (a, b) => BF.basePrice(a) - BF.basePrice(b) : s === "bpm" ? (a, b) => a.bpm - b.bpm : (a, b) => a.daysAgo - b.daysAgo);
        list.dataset.queue = beats.map((b) => b.id).join(",");
        list.innerHTML = beats.length ? ui.beatListHead() + beats.map((b, i) => ui.beatRow(b, i)).join("") : ui.empty({ icon: "search", title: "No beats match", body: `Nothing in this store matches “${BF.esc(q.value)}”.` });
        BF.player.sync();
      };
      if (!list) return;
      q?.addEventListener("input", repaint); sort?.addEventListener("change", repaint);
    },
  });
})();
