/* My Music — the DJ collection (shared library, electronic side) */
(function () {
  const I = BF.icon, ui = BF.ui, M = BF.mui, esc = BF.esc;

  /* ---------- Downloads (prepared server-side, signed links; see js/downloads.js) ---------- */
  M.dlButtons = (p) => (p.files ?? []).map((f, i) => BF.downloads.button(p.entitlementId, f, i === 0)).join("");
  document.addEventListener("click", (e) => {
    const b = e.target.closest('[data-action="receipt"]'); if (!b) return;
    e.preventDefault(); BF.downloadReceipt(b.dataset.order);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest('[data-action="terms"]'); if (!b) return;
    e.preventDefault(); openTerms(b.dataset.kind, b.dataset.id, b.dataset.order);
  });
  /** The server issues receipts (only for the signed-in buyer's own orders). */
  BF.downloadReceipt = (orderId) => {
    if (!orderId) return;
    const a = document.createElement("a"); a.href = "/api/store/orders/" + encodeURIComponent(orderId) + "/receipt"; a.download = orderId + "-receipt.txt";
    document.body.appendChild(a); a.click(); a.remove();
  };

  function openTerms(kind, id, orderId) {
    const it = kind === "track" ? BF.trackById[id] : BF.releaseById[id];
    const rel = kind === "track" ? BF.releaseById[it.releaseId] : it;
    const p = BF.store.get("musicPurchases").find((x) => x.kind === kind && x.id === id);
    ui.modal({ title: "Purchase terms",
      body: `<div class="license-doc"><header><div>${BF.brand.mark(24)}</div><div class="mono subtle" style="font-size:12px;text-align:right">Order ${orderId}<br>${p ? BF.date(p.date) : ""}</div></header>
        <h3 class="h3" style="margin:14px 0 4px">${esc(kind === "track" ? BF.trackTitle(it) : it.title)}</h3><p class="muted" style="font-size:14px">${esc(BF.artistNames(rel.artistIds))} · ${esc(BF.labelName(rel.labelId))} · ${rel.cat}</p>
        <dl class="terms" style="margin-top:14px">${[["Format", p ? p.format : "—"], ["Personal listening", "Yes"], ["DJ performance (clubs, streams, radio shows)", "Yes — subject to venue/broadcaster licensing"], ["Redistribution / re-upload", "Not permitted"], ["Use in your own productions", BF.isPack(rel) ? "Yes, per the pack license included" : "Not included — contact the label"], ["Re-downloads", "Unlimited, any offered format"]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
        <p class="hint" style="margin-top:12px">Terms set by ${esc(BF.labelName(rel.labelId))}. Summary only; not legal advice.</p></div>`,
      foot: `<button class="btn btn-ghost" data-close>Close</button><button class="btn btn-secondary" data-action="receipt" data-order="${orderId}">${I("receipt", "i-sm")} Download receipt</button>` });
  }

  /* ---------- Panels ---------- */
  const purchases = () => BF.store.get("musicPurchases");
  function tracksPanel() {
    const ps = purchases().filter((p) => p.kind === "track");
    const fromReleases = purchases().filter((p) => p.kind === "release" && BF.releaseById[p.id]).flatMap((p) => BF.releaseById[p.id].trackIds.map((t) => ({ ...p, kind: "track", id: t, viaRelease: p.id })));
    const all = [...ps, ...fromReleases];
    if (!all.length) return ui.empty({ icon: "music", title: "No tracks yet", body: "Tracks you buy — on their own or as part of a release — land here.", actions: `<a class="btn btn-primary" href="#/electronic">Explore electronic</a>` });
    return `<div class="dl-list" data-queue="${all.map((p) => p.id).join(",")}">${all.filter((p) => BF.trackById[p.id]).map((p) => { const t = BF.trackById[p.id], rel = BF.releaseById[t.releaseId]; return `<article class="dl-row" data-beat-card="${t.id}">
      <div class="art sm"><img src="${t.art}" alt=""></div>${ui.playBtn(t.id, "sm")}
      <div class="dl-main"><a class="t-title" href="#/electronic/release/${rel.id}?t=${t.id}">${esc(t.title)} <span class="t-mix">${esc(t.mix)}</span></a><span class="t-artists">${M.artistLinks(t.artistIds)} · ${esc(BF.labelName(t.labelId))}</span>
        <span class="dl-meta mono">${t.bpm} BPM · ${t.camelot} · ${BF.time(t.duration)} · Order ${p.orderId} · ${BF.date(p.date)}${p.viaRelease ? ` · via ${esc(rel.title)}` : ""}</span></div>
      <div class="dl-actions">${p.viaRelease ? `<a class="btn btn-ghost btn-sm" href="#/electronic/library?tab=albums">${I("disc", "i-sm")} Download with the release</a>` : M.dlButtons(p)}<button class="btn btn-ghost btn-sm" data-action="terms" data-kind="track" data-id="${p.viaRelease ? rel.id : t.id}" data-order="${p.orderId}">${I("license", "i-sm")} Terms</button></div>
    </article>`; }).join("")}</div>`;
  }
  function albumsPanel() {
    const ps = purchases().filter((p) => p.kind === "release");
    if (!ps.length) return ui.empty({ icon: "disc", title: "No releases yet", body: "EPs, albums and packs you buy in full appear here." });
    return `<div class="dl-list">${ps.filter((p) => BF.releaseById[p.id]).map((p) => { const r = BF.releaseById[p.id]; return `<article class="dl-row release" data-queue="${r.trackIds.join(",")}">
      <a class="art md" href="#/electronic/release/${r.id}"><img src="${r.art}" alt=""></a>
      <div class="dl-main">${M.typeBadge(r)}<a class="t-title" href="#/electronic/release/${r.id}">${esc(r.title)}</a><span class="t-artists">${M.artistLinks(r.artistIds)} · ${esc(BF.labelName(r.labelId))} · ${r.cat}</span>
        <span class="dl-meta mono">${BF.isPack(r) ? esc(r.pack) : r.trackIds.length + " tracks"} · Order ${p.orderId} · ${BF.date(p.date)} · Bought as ${p.format}</span></div>
      <div class="dl-actions">${M.dlButtons(p)}<button class="btn btn-ghost btn-sm" data-action="terms" data-kind="release" data-id="${r.id}" data-order="${p.orderId}">${I("license", "i-sm")} Terms</button><button class="btn btn-ghost btn-sm" data-action="receipt" data-order="${p.orderId}">${I("receipt", "i-sm")} Receipt</button></div>
    </article>`; }).join("")}</div>`;
  }
  function cratesPanel() {
    const crates = BF.store.get("crates");
    const unused = BF.CRATE_TEMPLATES.filter((n) => !crates.some((c) => c.title === n));
    return `<div class="crate-toolbar"><span class="subtle" style="font-size:13px">Build sets by mood and moment. Tip: sort a playlist by BPM to plan your transitions.</span><div style="display:flex;gap:6px;flex-wrap:wrap">${unused.slice(0, 3).map((n) => `<button class="chip" data-new-crate="${esc(n)}">${I("plus", "i-xs")} ${esc(n)}</button>`).join("")}<button class="btn btn-primary btn-sm" data-new-crate="">${I("plus", "i-sm")} New playlist</button></div></div>
      <div class="crates">${crates.map((c) => { const ts = c.trackIds.map((id) => BF.trackById[id]).filter(Boolean); const bpms = ts.map((t) => t.bpm); return `<article class="crate" data-queue="${c.trackIds.join(",")}">
        <header><div class="crate-covers">${ts.slice(0, 4).map((t) => `<img src="${t.art}" alt="">`).join("") || "<span></span>"}</div>
          <div style="flex:1;min-width:0"><h3>${esc(c.title)}</h3><span class="subtle mono" style="font-size:12px">${ts.length} tracks${bpms.length ? ` · ${Math.min(...bpms)}–${Math.max(...bpms)} BPM · ${BF.time(ts.reduce((s, t) => s + t.duration, 0))}` : ""}</span></div>
          ${ts.length ? ui.playBtn(ts[0].id, "sm accent") : ""}
          <div class="dropdown"><button class="icon-btn sm" data-dropdown aria-haspopup="menu" aria-expanded="false" aria-label="Playlist options for ${esc(c.title)}">${I("more", "i-sm")}</button><div class="menu" role="menu"><button class="menu-item" role="menuitem" data-sort-crate="${c.id}">${I("sort", "i-sm")} Sort by BPM</button><button class="menu-item" role="menuitem" data-rename-crate="${c.id}">${I("edit", "i-sm")} Rename</button><div class="menu-sep"></div><button class="menu-item danger" role="menuitem" data-del-crate="${c.id}">${I("trash", "i-sm")} Delete</button></div></div></header>
        ${ts.length ? `<ol class="crate-list">${ts.map((t) => `<li data-beat-card="${t.id}"><button class="icon-btn sm" data-action="play" data-beat="${t.id}" aria-label="Play ${esc(BF.trackTitle(t))}">${I("play", "i-xs ic-play")}${I("pause", "i-xs ic-pause")}</button><span class="truncate"><b>${esc(t.title)}</b> <span class="subtle">${esc(t.mix)} · ${esc(BF.artistNames(t.artistIds))}</span></span><span class="mono subtle">${t.bpm}</span>${M.keyBadge(t)}<button class="icon-btn sm" data-crate-rm="${c.id}|${t.id}" aria-label="Remove ${esc(t.title)} from ${esc(c.title)}">${I("x", "i-xs")}</button></li>`).join("")}</ol>` : `<p class="subtle" style="font-size:13px;padding:10px 0">Empty — add tracks from any list with ${I("playlist", "i-xs")}.</p>`}
      </article>`; }).join("")}</div>`;
  }
  function favoritesPanel() {
    const favs = BF.store.get("favorites");
    const tracks = favs.map((id) => BF.trackById[id]).filter(Boolean);
    const rels = favs.map((id) => BF.releaseById[id]).filter(Boolean);
    if (!tracks.length && !rels.length) return ui.empty({ icon: "heart", title: "No favorites yet", body: "Heart tracks and releases while you dig — they’ll wait here.", actions: `<a class="btn btn-primary" href="#/electronic/discover">Open the store</a>` });
    return `${rels.length ? `<h3 class="ehead-label" style="margin-bottom:10px">Releases</h3><div class="rgrid" style="margin-bottom:28px">${rels.map((r) => M.releaseCard(r)).join("")}</div>` : ""}${tracks.length ? `<h3 class="ehead-label" style="margin-bottom:10px">Tracks</h3>${M.trackList(tracks)}` : ""}`;
  }
  function downloadsPanel() {
    const d = BF.store.get("musicDownloads");
    if (!d.length) return ui.empty({ icon: "download", title: "No downloads yet", body: "Every file you download is logged here with its order ID. Download again from Purchased Tracks or Albums." });
    return `<div class="table-wrap card"><table class="table"><thead><tr><th scope="col">File</th><th scope="col">Format</th><th scope="col" class="hide-sm">Size</th><th scope="col" class="hide-sm">Order</th><th scope="col" class="hide-sm">Requested</th><th scope="col">Status</th></tr></thead>
      <tbody>${d.map((x) => `<tr><td class="strong" style="white-space:normal;min-width:220px">${esc(x.file)}</td><td><span class="fmt">${esc(x.format)}</span></td><td class="hide-sm mono">${x.size}</td><td class="hide-sm mono" style="font-size:12px">${x.orderId || "—"}</td><td class="hide-sm mono" style="font-size:12px">${x.date}</td><td><span class="badge ${x.status === "failed" ? "badge-danger" : x.status === "completed" ? "badge-success" : ""}">${esc(x.status)}</span></td></tr>`).join("")}</tbody></table></div>`;
  }
  function recentPanel() {
    const r = BF.store.get("recent").map((id) => BF.trackById[id]).filter(Boolean);
    return r.length ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-ghost btn-sm" data-clear-recent>Clear history</button></div>${M.trackList(r)}` : ui.empty({ icon: "clock", title: "Nothing played yet", body: "Tracks you preview show up here." });
  }

  const TABS = [
    ["tracks", "Purchased Tracks", () => purchases().filter((p) => p.kind === "track").length + purchases().filter((p) => p.kind === "release" && BF.releaseById[p.id]).reduce((s, p) => s + BF.releaseById[p.id].trackIds.length, 0), tracksPanel],
    ["albums", "Purchased Albums", () => purchases().filter((p) => p.kind === "release").length, albumsPanel],
    ["playlists", "Playlists", () => BF.store.get("crates").length, cratesPanel],
    ["favorites", "Favorites", () => BF.store.get("favorites").filter((id) => BF.trackById[id] || BF.releaseById[id]).length, favoritesPanel],
    ["downloads", "Downloads", () => BF.store.get("musicDownloads").length, downloadsPanel],
    ["recent", "Recently Played", () => BF.store.get("recent").length, recentPanel],
  ];

  BF.librarySwitch = (active) => `<div class="lib-switch" role="group" aria-label="Your libraries (one account)"><a href="#/beats/library" ${active === "beats" ? 'aria-current="page"' : ""}>${I("mic", "i-sm")} Beats Library</a><a href="#/electronic/library" ${active === "music" ? 'aria-current="page"' : ""}>${I("headphones", "i-sm")} Electronic Library</a></div>`;

  BF.route("/electronic/library", {
    title: "Electronic Library",
    render(_, q) {
      if (!BF.store.get("session").signedIn) return `<div class="container">${ui.empty({ icon: "lock", title: "Sign in to see My Music", body: "Purchases, playlists and downloads are tied to your account.", actions: `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent("/electronic/library")}">Sign in</a>` })}</div>`;
      const tab = q.tab || "tracks";
      const orders = [...new Set(purchases().map((p) => p.orderId))];
      return `<div class="container" style="padding-top:24px">
        ${BF.librarySwitch("music")}
        <header class="mm-head"><div><span class="ehead-label">My Music · your DJ collection</span><h1 class="edisplay sm">Electronic Library</h1></div>
          <dl class="lib-stats"><div><dt>Tracks</dt><dd>${TABS[0][2]()}</dd></div><div><dt>Releases</dt><dd>${TABS[1][2]()}</dd></div><div><dt>Orders</dt><dd>${orders.length}</dd></div></dl>
          <label class="mm-fmt"><span class="subtle" style="font-size:12.5px">Default format</span><select class="select input-sm" data-default-fmt>${Object.keys(BF.FORMATS).map((f) => `<option ${BF.store.get("dlFormat") === f ? "selected" : ""}>${f}</option>`).join("")}</select></label></header>
        <div class="tabs" role="tablist" aria-label="My Music" style="margin:20px 0 22px">${TABS.map(([k, l, n]) => `<button class="tab" role="tab" id="mt-${k}" aria-controls="mp-${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-mtab="${k}">${l} <span class="n">${n()}</span></button>`).join("")}</div>
        ${TABS.map(([k, , , fn]) => `<div role="tabpanel" id="mp-${k}" aria-labelledby="mt-${k}" data-mpanel="${k}" ${tab === k ? "" : "hidden"}>${fn()}</div>`).join("")}
      </div><div style="height:48px"></div>`;
    },
    mount(el) {
      const tl = el.querySelector('[role="tablist"]'); if (!tl) return;
      tl.addEventListener("click", (e) => { const t = e.target.closest("[data-mtab]"); if (t) { BF.selectTab(t); BF.setQuery({ tab: t.dataset.mtab === "tracks" ? "" : t.dataset.mtab }); } });
      tl.addEventListener("keydown", BF.tabKeys);
      const repaint = (k) => { const p = el.querySelector(`[data-mpanel="${k}"]`); const d = TABS.find((x) => x[0] === k); p.innerHTML = d[3](); el.querySelector(`#mt-${k} .n`).textContent = d[2](); BF.player.sync(); };
      BF.store.refreshLibrary().catch(() => {});
      const offs = [BF.store.on("musicPurchases", () => { repaint("tracks"); repaint("albums"); }), BF.store.on("crates", () => repaint("playlists")), BF.store.on("favorites", () => repaint("favorites")), BF.store.on("musicDownloads", () => repaint("downloads")), BF.store.on("recent", () => repaint("recent"))];
      el.querySelector("[data-default-fmt]").addEventListener("change", (e) => { BF.store.set("dlFormat", e.target.value); ui.toast({ kind: "info", title: "Default format: " + e.target.value, desc: "Used for new purchases when the label offers it." }); });
      el.addEventListener("click", async (e) => {
        const nc = e.target.closest("[data-new-crate]");
        if (nc) {
          const preset = nc.dataset.newCrate;
          if (preset) { try { await BF.store.createPlaylist("crate", preset); ui.toast({ title: "Playlist created", desc: esc(preset) }); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t create it", desc: esc(err.message) }); } return; }
          ui.modal({ title: "New DJ playlist", body: `<div class="field"><label class="label" for="cn">Name</label><input class="input" id="cn" maxlength="40" placeholder="e.g. Closing Set" autofocus><div class="field-error">${I("alert-circle", "i-xs")} Name your playlist.</div></div><div class="chip-wrap" style="margin-top:10px">${BF.CRATE_TEMPLATES.map((n) => `<button class="chip" data-tpl="${esc(n)}" style="height:28px;font-size:12px">${esc(n)}</button>`).join("")}</div>`,
            foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Create</button>`,
            onMount(m, close) { m.addEventListener("click", (ev) => { const t = ev.target.closest("[data-tpl]"); if (t) m.querySelector("#cn").value = t.dataset.tpl; }); m.querySelector("[data-ok]").onclick = async () => { const v = m.querySelector("#cn").value.trim(); m.querySelector(".field").classList.toggle("has-error", !v); if (!v) return; try { await BF.store.createPlaylist("crate", v); close(); ui.toast({ title: "Playlist created", desc: esc(v) }); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t create it", desc: esc(err.message) }); } }; } });
        }
        const rm = e.target.closest("[data-crate-rm]");
        if (rm) { const [cid, tid] = rm.dataset.crateRm.split("|"); BF.store.removeFromPlaylist(cid, tid).catch((err) => ui.toast({ kind: "error", title: "Couldn’t remove it", desc: esc(err.message) })); }
        const so = e.target.closest("[data-sort-crate]");
        if (so) {
          const c = BF.store.get("crates").find((x) => x.id === so.dataset.sortCrate);
          const order = [...c.trackIds].sort((a, b) => (BF.trackById[a]?.bpm ?? 999) - (BF.trackById[b]?.bpm ?? 999));
          try { await BF.http.patch("/api/store/playlists/" + c.id, { item_ids: order }); await BF.store.refreshCollections(); ui.toast({ kind: "info", title: "Sorted by BPM" }); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t sort", desc: esc(err.message) }); }
        }
        const rn = e.target.closest("[data-rename-crate]");
        if (rn) { const c = BF.store.get("crates").find((x) => x.id === rn.dataset.renameCrate); ui.modal({ title: "Rename playlist", body: `<div class="field"><label class="label" for="rn">Name</label><input class="input" id="rn" value="${esc(c.title)}" maxlength="40" autofocus></div>`, foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`, onMount(m, close) { m.querySelector("[data-ok]").onclick = async () => { const v = m.querySelector("#rn").value.trim(); if (!v) return; try { await BF.store.renamePlaylist(c.id, v); close(); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t rename", desc: esc(err.message) }); } }; } }); }
        const dc = e.target.closest("[data-del-crate]");
        if (dc) { const c = BF.store.get("crates").find((x) => x.id === dc.dataset.delCrate); if (await ui.confirm({ title: `Delete “${esc(c.title)}”?`, body: "The playlist is removed. Tracks you own stay in your collection.", confirmLabel: "Delete playlist", danger: true })) BF.store.deletePlaylist(c.id).catch((err) => ui.toast({ kind: "error", title: "Couldn’t delete it", desc: esc(err.message) })); }
        if (e.target.closest("[data-clear-recent]")) { try { await BF.http.del("/api/store/recent"); BF.store.set("recent", []); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t clear history", desc: esc(err.message) }); } }
      });
      return () => offs.forEach((o) => o());
    },
  });
})();
