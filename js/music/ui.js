/* ==========================================================================
   Electronic marketplace — component kit (BF.mui).
   Visual rules: sharp corners, hairline rules, mono metadata, large covers.
   Ranked content (charts) always shows a numeral + movement; editorial
   content always shows a curator byline and never a number.
   ========================================================================== */
(function () {
  const I = BF.icon, ui = BF.ui;
  const M = (BF.mui = {});
  const esc = BF.esc;

  /* ---------- Atoms ---------- */
  // Camelot codes get a hue per wheel position so harmonically adjacent keys look adjacent
  M.camHue = (code) => ((parseInt(code, 10) - 1) * 30 + 200) % 360;
  M.keyBadge = (t) => `<span class="kbadge" style="--h:${M.camHue(t.camelot)}" title="${esc(t.key)} · Camelot ${t.camelot}"><b>${t.camelot}</b><span>${esc(t.key.replace(" min", "m").replace(" maj", ""))}</span></span>`;
  M.energy = (e) => `<span class="energy" role="img" aria-label="Energy ${e} of 10">${[2, 4, 6, 8, 10].map((v) => `<i class="${e >= v ? "on" : e >= v - 1 ? "half" : ""}"></i>`).join("")}</span>`;
  M.typeBadge = (rel) => `<span class="rtype rtype-${rel.type}">${BF.releaseTypeName(rel.type)}</span>`;
  M.artistLinks = (ids) => ids.map((id) => { const a = BF.eartistById[id]; return `<a href="#/electronic/artist/${a.handle}">${esc(a.name)}</a>`; }).join(", ");
  M.labelLink = (id) => (id ? `<a href="#/electronic/label/${id}">${esc(BF.labelById[id].name)}</a>` : `<span class="subtle">Independent</span>`);
  M.labelLogo = (l, size = 48) => `<span class="label-logo" style="--s:${size}px;--c:${BF.palettes[l.palette][2]};--d:${BF.palettes[l.palette][0]}" aria-hidden="true"><span>${l.mono}</span></span>`;
  M.explicit = (t) => (t.explicit ? `<span class="xbadge" title="Explicit lyrics" aria-label="Explicit">E</span>` : "");
  M.fmtList = (rel) => rel.formats.map((f) => `<span class="fmt">${f}</span>`).join("");

  M.buyBtn = (kind, id, opts = {}) => {
    const inCart = BF.store.musicItem(kind, id);
    const owned = BF.store.ownsMusic(kind, id);
    const rel = kind === "release" ? BF.releaseById[id] : BF.releaseById[BF.trackById[id].releaseId];
    const fmt = rel.formats.includes(BF.store.get("dlFormat")) ? BF.store.get("dlFormat") : rel.formats[0];
    const price = kind === "release" ? BF.releasePrice(rel, fmt) : BF.trackPrice(BF.trackById[id], fmt);
    const label = kind === "release" ? (opts.label || "Buy release") : "";
    if (owned) return `<a class="mbuy owned" href="#/electronic/library" aria-label="Owned — open your Electronic Library">${I("check", "i-xs")}<span>Owned</span></a>`;
    return `<button class="mbuy ${inCart ? "in-cart" : ""} ${opts.big ? "big" : ""}" data-action="add-music" data-kind="${kind}" data-id="${id}" aria-label="${inCart ? "In cart" : `${kind === "release" ? "Buy release" : "Buy track"}, ${BF.money(price)} ${fmt}`}" title="${kind === "release" ? "Buy release" : "Buy track"}">
      ${inCart ? I("check", "i-xs") : I("bag-plus", "i-xs")}<span>${inCart ? "In cart" : `${label ? label + " · " : ""}${BF.money(price)}`}</span>${!inCart && opts.big ? `<span class="mbuy-fmt">${fmt}</span>` : ""}</button>`;
  };

  /* ---------- Track table ---------- */
  M.trackHead = (opts = {}) => `<div class="trow trow-head ${opts.rank ? "ranked" : ""}" aria-hidden="true">
    <span>${opts.rank ? "Pos" : "#"}</span><span></span><span>Title / Artists</span><span class="c-label">Label</span><span class="c-genre">Genre</span><span class="c-bpm">BPM</span><span class="c-key">Key</span><span class="c-energy">Energy</span><span class="c-len">Length</span><span class="c-date">Released</span><span></span></div>`;

  M.trackRow = (t, i, opts = {}) => {
    const rel = BF.releaseById[t.releaseId];
    const g = BF.egenre(t.genre);
    const rank = opts.rank ? `<span class="rank-n">${i + 1}</span>${M.movement(opts.move?.[i])}` : `<span class="n">${i + 1}</span>`;
    return `<div class="trow ${opts.rank ? "ranked" : ""}" role="listitem" data-beat-card="${t.id}">
      <div class="c-num">${rank}<button class="trow-play" data-action="play" data-beat="${t.id}" aria-label="Play ${esc(BF.trackTitle(t))}">${I("play", "i-sm ic-play")}${I("pause", "i-sm ic-pause")}</button></div>
      <a class="art sm" href="#/electronic/release/${rel.id}?t=${t.id}" tabindex="-1" aria-hidden="true"><img src="${t.art}" alt="" loading="lazy"></a>
      <div class="c-title"><a class="t-title truncate" href="#/electronic/release/${rel.id}?t=${t.id}">${esc(t.title)} <span class="t-mix">${esc(t.mix)}</span></a>${M.explicit(t)}
        <span class="t-artists truncate">${M.artistLinks(t.artistIds)}${t.remixerId ? `, ${M.artistLinks([t.remixerId])}` : ""}</span></div>
      <span class="c-label truncate">${M.labelLink(t.labelId)}</span>
      <a class="c-genre truncate" href="#/electronic/genre/${g.id}">${esc(g.name)}</a>
      <span class="c-bpm mono">${t.bpm}</span>
      <span class="c-key">${M.keyBadge(t)}</span>
      <span class="c-energy">${M.energy(t.energy)}</span>
      <span class="c-len mono">${BF.time(t.duration)}</span>
      <span class="c-date mono">${new Date(t.date + "T12:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
      <div class="c-act">${ui.favBtn(t.id, "icon-btn sm")}<button class="icon-btn sm" data-action="tmore" data-id="${t.id}" aria-label="More actions for ${esc(BF.trackTitle(t))}">${I("more", "i-sm")}</button>${BF.isPack(rel) ? M.buyBtn("release", rel.id) : M.buyBtn("track", t.id)}</div>
    </div>`;
  };
  M.trackList = (tracks, opts = {}) => tracks.length
    ? `<div class="tlist" role="list" data-queue="${tracks.map((t) => t.id).join(",")}">${opts.head === false ? "" : M.trackHead(opts)}${tracks.map((t, i) => M.trackRow(t, i, opts)).join("")}</div>`
    : ui.empty({ icon: "search", title: opts.emptyTitle || "No tracks match", body: opts.emptyBody || "Widen the BPM range or remove a filter." , actions: opts.emptyActions || "" });

  M.movement = (m) => (m === "new" ? `<span class="mv new">NEW</span>` : m > 0 ? `<span class="mv up" aria-label="Up ${m}">${I("chevron-up", "i-xs")}${m}</span>` : m < 0 ? `<span class="mv down" aria-label="Down ${-m}">${I("chevron-down", "i-xs")}${-m}</span>` : `<span class="mv" aria-label="No change">–</span>`);

  /* ---------- Release card ---------- */
  M.releaseCard = (rel, opts = {}) => {
    const first = rel.trackIds[0];
    return `<article class="rcard ${opts.size || ""}" data-queue="${rel.trackIds.join(",")}" data-beat-card="${first}">
      <div class="rcard-art">
        <a href="#/electronic/release/${rel.id}" tabindex="-1" aria-hidden="true"><img src="${rel.art}" alt="" loading="lazy"></a>
        <div class="rcard-play">${ui.playBtn(first, "accent")}</div>
        ${opts.noType ? "" : M.typeBadge(rel)}
      </div>
      <div class="rcard-body">
        <a class="rcard-title truncate" href="#/electronic/release/${rel.id}">${esc(rel.title)}</a>
        <span class="rcard-artist truncate">${M.artistLinks(rel.artistIds)}</span>
        <span class="rcard-meta"><span class="truncate">${rel.labelId ? esc(BF.labelById[rel.labelId].name) : "Independent"}</span><span class="mono">${rel.cat}</span></span>
      </div>
    </article>`;
  };

  /* ---------- Editorial (curated) card — no rank, always a byline ---------- */
  M.editorialCard = (c) => {
    const tracks = BF.sellableTracks().concat(BF.ETRACKS.filter((t) => BF.releaseById[t.releaseId].type === "dj-tool")).filter(c.filter);
    const uniq = [...new Set(tracks.map((t) => t.id))].slice(0, 8);
    return `<article class="edcard" data-queue="${uniq.join(",")}">
      <div class="edcard-art"><img src="${BF.art(c.id, c.style, c.palette)}" alt="">${uniq[0] ? `<div class="edcard-play">${ui.playBtn(uniq[0], "accent")}</div>` : ""}</div>
      <div class="edcard-body">
        <span class="ed-tag">${I("sparkle", "i-xs")} Curated · ${esc(c.curator)}</span>
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.blurb)}</p>
        <a class="link" href="#/electronic/discover?collection=${c.id}">${uniq.length} tracks ${I("arrow-right", "i-xs")}</a>
      </div>
    </article>`;
  };

  M.labelCard = (l) => {
    const following = BF.store.isFollowing(l.id);
    const covers = l.releaseIds.slice(0, 3).map((id) => BF.releaseById[id]);
    return `<article class="lcard">
      <a class="lcard-banner" href="#/electronic/label/${l.id}" tabindex="-1" aria-hidden="true"><img src="${l.banner}" alt=""></a>
      <div class="lcard-body">
        ${M.labelLogo(l, 52)}
        <div style="min-width:0;flex:1"><a class="lcard-name" href="#/electronic/label/${l.id}">${esc(l.name)} ${l.verified ? BF.verifiedSeal("Verified label") : ""}</a>
          <span class="subtle" style="font-size:12.5px">${esc(l.city)} · est. ${l.founded} · ${BF.num(l.followers)} followers</span></div>
        <button class="btn btn-sm ${following ? "btn-secondary" : "btn-outline"}" data-action="mfollow" data-fid="${l.id}" aria-pressed="${following}">${following ? "Following" : "Follow"}</button>
      </div>
      <div class="lcard-covers">${covers.map((r) => `<a href="#/electronic/release/${r.id}" aria-label="${esc(r.title)}"><img src="${r.art}" alt="" loading="lazy"></a>`).join("")}</div>
    </article>`;
  };

  M.artistCard = (a) => `<article class="acard">
      <a href="#/electronic/artist/${a.handle}" class="acard-img" tabindex="-1" aria-hidden="true"><img src="${a.avatar}" alt="" loading="lazy"></a>
      <a class="acard-name" href="#/electronic/artist/${a.handle}">${esc(a.name)} ${a.verified ? BF.verifiedSeal("Verified artist") : ""}</a>
      <span class="subtle" style="font-size:12.5px">${a.genres.map((g) => BF.egenre(g).name).slice(0, 2).join(" · ")}</span>
      <span class="subtle mono" style="font-size:11.5px">${BF.num(a.followers)} followers</span>
    </article>`;

  M.genreTile = (g, n) => `<a class="gtile" href="#/electronic/genre/${g.id}"><img src="${BF.art("eg-" + g.id, g.style, g.palette)}" alt="" loading="lazy"><span class="gtile-name">${esc(g.name)}</span><span class="gtile-bpm mono">${g.bpm[0]}–${g.bpm[1]} BPM${n != null ? ` · ${n} tracks` : ""}</span></a>`;

  M.sectionHead = (label, title, link = "", kind = "") => `<div class="ehead ${kind}"><div><span class="ehead-label">${label}</span><h2>${title}</h2></div>${link}</div>`;

  /* ---------- Actions ---------- */
  M.addMusic = (kind, id, format) => {
    if (BF.store.ownsMusic(kind, id)) { ui.toast({ kind: "info", title: "Already in your collection", desc: "Download it any time from My Music.", action: { href: "#/electronic/library", label: "My Music" } }); return; }
    const res = BF.store.addMusic(kind, id, format);
    const item = kind === "track" ? BF.trackById[id] : BF.releaseById[id];
    const title = kind === "track" ? BF.trackTitle(item) : item.title;
    if (res.status === "covered") { ui.toast({ kind: "info", title: "Included in your cart", desc: `${esc(res.rel.title)} is already in your cart as a full release.` }); return; }
    ui.toast({
      title: res.status === "added" ? "Added to cart" : "Format updated",
      desc: `${esc(title)} · ${res.format}${res.replaced ? ` · replaced ${res.replaced} single track${res.replaced > 1 ? "s" : ""}` : ""}`,
      art: item.art, action: { href: "#/cart", label: "View cart" },
    });
  };

  M.openFormat = (kind, id) => {
    const rel = kind === "release" ? BF.releaseById[id] : BF.releaseById[BF.trackById[id].releaseId];
    const t = kind === "track" ? BF.trackById[id] : null;
    const cur = BF.store.musicItem(kind, id)?.format || (rel.formats.includes(BF.store.get("dlFormat")) ? BF.store.get("dlFormat") : rel.formats[0]);
    ui.modal({
      title: "Choose a download format",
      body: `<fieldset class="fmt-pick"><legend class="sr-only">Format</legend>${Object.values(BF.FORMATS).map((f) => {
        const off = !rel.formats.includes(f.id);
        const price = kind === "release" ? BF.releasePrice(rel, f.id) : BF.trackPrice(t, f.id);
        return `<label class="lic-option ${f.id === cur ? "is-selected" : ""} ${off ? "is-disabled" : ""}"><input type="radio" name="fmt" value="${f.id}" ${f.id === cur ? "checked" : ""} ${off ? "disabled" : ""}><span class="lic-radio"></span>
          <span class="lic-main"><span class="lic-name">${f.label}</span><span class="lic-files">${f.detail}${t ? ` · ~${BF.estSize(t, f.id)}` : ""}${off ? " · not offered by this label" : ""}</span></span><span class="lic-price mono">${BF.money(price)}</span></label>`;
      }).join("")}</fieldset>
      <label class="check" style="margin-top:12px"><input type="checkbox" data-remember checked> Remember as my default format</label>`,
      foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>${I("bag-plus", "i-sm")} Add to cart</button>`,
      onMount(el, close) {
        el.addEventListener("change", () => el.querySelectorAll(".lic-option").forEach((o) => o.classList.toggle("is-selected", o.querySelector("input").checked)));
        el.querySelector("[data-ok]").onclick = () => {
          const f = el.querySelector("input[name=fmt]:checked").value;
          if (el.querySelector("[data-remember]").checked) BF.store.set("dlFormat", f);
          close(); M.addMusic(kind, id, f);
        };
      },
    });
  };

  M.openAddToCrate = (trackId) => {
    const t = BF.trackById[trackId]; if (!t) return;
    if (!BF.store.get("session").signedIn) { location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`; return; }
    const crates = BF.store.get("crates");
    const unused = BF.CRATE_TEMPLATES.filter((n) => !crates.some((c) => c.title === n));
    ui.modal({
      title: "Add to playlist",
      body: `<div class="menu-list">${crates.map((c) => `<button class="menu-item" data-crate="${c.id}">${I("playlist", "i-sm")} ${esc(c.title)} <span class="subtle mono" style="margin-left:auto;font-size:12px">${c.trackIds.includes(trackId) ? "added" : c.trackIds.length}</span></button>`).join("")}</div>
        <div class="menu-sep"></div>
        <form class="field" data-new style="margin-top:8px"><label class="label" for="ncrate">New DJ playlist</label><div style="display:flex;gap:8px"><input class="input" id="ncrate" placeholder="e.g. Closing Set" maxlength="40"><button class="btn btn-secondary">Create</button></div>
          ${unused.length ? `<div class="chip-wrap" style="margin-top:8px">${unused.map((n) => `<button type="button" class="chip" data-tpl="${esc(n)}" style="height:28px;font-size:12px">${esc(n)}</button>`).join("")}</div>` : ""}</form>`,
      onMount(el, close) {
        el.addEventListener("click", (e) => {
          const c = e.target.closest("[data-crate]"); const tpl = e.target.closest("[data-tpl]");
          if (c) BF.store.addToCrate(c.dataset.crate, trackId).then((ok) => { close(); ui.toast({ kind: ok ? "success" : "info", title: ok ? "Added to playlist" : "Already in playlist", desc: esc(crates.find((x) => x.id === c.dataset.crate).title) }); }).catch((err) => ui.toast({ kind: "error", title: "Couldn’t add it", desc: esc(err.message) }));
          if (tpl) el.querySelector("#ncrate").value = tpl.dataset.tpl;
        });
        el.querySelector("[data-new]").onsubmit = (e) => {
          e.preventDefault(); const v = el.querySelector("#ncrate").value.trim(); if (!v) return el.querySelector("#ncrate").focus();
          BF.store.createPlaylist("crate", v, [trackId]).then(() => { close(); ui.toast({ title: "Playlist created", desc: esc(v) }); }).catch((err) => ui.toast({ kind: "error", title: "Couldn’t create it", desc: esc(err.message) }));
        };
      },
    });
  };

  M.openTrackMore = (id) => {
    const t = BF.trackById[id], rel = BF.releaseById[t.releaseId];
    ui.modal({
      title: esc(BF.trackTitle(t)),
      body: `<dl class="kv compact" style="margin-bottom:12px"><div><dt>DJ info</dt><dd>${t.intro} · ${t.outro}</dd></div><div><dt>Drop</dt><dd class="mono">${BF.time(t.dropAt)}</dd></div><div><dt>Formats</dt><dd>${rel.formats.join(" · ")}</dd></div><div><dt>Catalog</dt><dd class="mono">${rel.cat}</dd></div></dl>
        <div class="menu-list">
        <button class="menu-item" data-a="queue">${I("queue", "i-sm")} Add to queue</button>
        <button class="menu-item" data-a="crate">${I("playlist", "i-sm")} Add to playlist</button>
        ${BF.isPack(rel) ? "" : `<button class="menu-item" data-a="fmt">${I("file-audio", "i-sm")} Choose format &amp; buy</button>`}
        <a class="menu-item" href="#/electronic/release/${rel.id}" data-close>${I("disc", "i-sm")} Go to release</a>
        ${t.labelId ? `<a class="menu-item" href="#/electronic/label/${t.labelId}" data-close>${I("store", "i-sm")} Go to label</a>` : ""}
        <button class="menu-item" data-a="share">${I("share", "i-sm")} Copy link</button>
        <div class="menu-sep"></div>
        <button class="menu-item danger" data-a="report">${I("flag", "i-sm")} Report</button></div>`,
      onMount(el, close) {
        el.addEventListener("click", (e) => {
          const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
          close();
          if (a === "queue") { BF.player.enqueue(t.id); ui.toast({ title: "Added to queue", desc: esc(BF.trackTitle(t)), art: t.art }); }
          if (a === "crate") M.openAddToCrate(t.id);
          if (a === "fmt") M.openFormat("track", t.id);
          if (a === "share") ui.copyLink(`#/electronic/release/${rel.id}?t=${t.id}`);
          if (a === "report") ui.toast({ kind: "info", title: "Report started", desc: "Use the rights form on the release page for copyright claims." });
        });
      },
    });
  };

  /* ---------- Delegated actions for the electronic marketplace ---------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]"); if (!el) return;
    const a = el.dataset.action;
    if (a === "add-music") { e.preventDefault(); M.addMusic(el.dataset.kind, el.dataset.id, el.dataset.format); }
    if (a === "fmt") { e.preventDefault(); M.openFormat(el.dataset.kind, el.dataset.id); }
    if (a === "crate") { e.preventDefault(); M.openAddToCrate(el.dataset.id); }
    if (a === "tmore") { e.preventDefault(); M.openTrackMore(el.dataset.id); }
    if (a === "play-release") { e.preventDefault(); const rel = BF.releaseById[el.dataset.id]; BF.player.playBeat(rel.trackIds[0], rel.trackIds); }
    if (a === "mfollow") {
      e.preventDefault();
      const id = el.dataset.fid; const on = BF.store.toggleFollow(id);
      const name = (BF.labelById[id] || BF.eartistById[id]).name;
      BF.$$(`[data-action="mfollow"][data-fid="${id}"]`).forEach((b) => {
        const off = b.dataset.off || "btn-outline";
        b.setAttribute("aria-pressed", on); b.classList.toggle("btn-secondary", on); b.classList.toggle(off, !on);
        (b.querySelector("span") || b).textContent = on ? "Following" : "Follow";
      });
      ui.toast({ kind: "info", title: on ? `Following ${name}` : `Unfollowed ${name}`, desc: on ? "New releases will appear in Recommended." : "", timeout: 2400 });
    }
  });

  // Keep buy buttons in sync with the cart everywhere
  BF.store.on("cart", () => {
    BF.$$(".mbuy[data-kind]").forEach((b) => { const tmp = document.createElement("div"); tmp.innerHTML = M.buyBtn(b.dataset.kind, b.dataset.id, { big: b.classList.contains("big"), label: b.dataset.label }); b.replaceWith(tmp.firstElementChild); });
  });
})();
