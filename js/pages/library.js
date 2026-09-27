/* Beats Library — licensed beats, packs, favourites, playlists, downloads and license agreements.
   Everything is the signed-in account's server state; files download through BF.downloads. */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;

  const fileButtons = (p) => (p.files ?? []).map((f, i) => BF.downloads.button(p.entitlementId, f, i === 0)).join("");
  const licenseLink = (p) => (p.license && p.license !== "free" ? `<a class="btn btn-ghost btn-sm" href="/api/store/library/${p.entitlementId}/license" download>${I("license", "i-sm")} License</a>` : "");
  const reviewBtn = (p, producerId) => (p.orderItemId && producerId ? (p.reviewed ? `<span class="subtle" style="font-size:12.5px">${I("check", "i-xs")} Reviewed</span>` : `<button class="btn btn-ghost btn-sm" data-review="${p.orderItemId}" data-review-producer="${producerId}">${I("star", "i-sm")} Rate producer</button>`) : "");
  const beatOf = (id) => BF.beatById[id];
  /** Owned beats can leave the store (sold exclusively, unpublished); the purchase record still shows. */
  const beatInfo = (p) => beatOf(p.beatId) ?? { id: p.beatId, title: p.title?.split(" — ")[0] ?? p.beatId, art: BF.art(p.beatId, "rings", "graphite"), bpm: "—", key: "", producerId: null };

  function purchased() {
    const ps = BF.store.get("purchases");
    if (!ps.length) return ui.empty({ icon: "bag", title: "No purchases yet", body: "Beats you license show up here with their files and license agreements.", actions: `<a class="btn btn-primary" href="#/beats/catalog">Find your next beat</a>` });
    return `<div class="table-wrap card"><table class="table lib-table" data-queue="${ps.map((p) => p.beatId).filter((id) => BF.beatById[id]).join(",")}">
      <thead><tr><th scope="col">Beat</th><th scope="col">License</th><th scope="col" class="hide-sm">Purchased</th><th scope="col" class="hide-sm">Order</th><th scope="col"><span class="sr-only">Files</span></th></tr></thead>
      <tbody>${ps.map((p) => { const b = beatInfo(p), pr = BF.producerById[b.producerId], L = BF.licenseById[p.license]; return `<tr data-beat-card="${b.id}">
        <td><div class="cell-beat"><div class="art sm" style="position:relative"><img src="${b.art}" alt=""></div>${BF.beatById[b.id] ? ui.playBtn(b.id, "sm") : ""}<div style="min-width:0"><a class="strong truncate" style="display:block;color:var(--text);font-weight:600" href="#/beats/beat/${b.id}">${esc(b.title)}</a><span class="subtle" style="font-size:12.5px">${esc(pr?.name ?? "")}${b.bpm !== "—" ? ` · ${b.bpm} BPM · ${esc(b.key)}` : ""}</span></div></div></td>
        <td><span class="badge ${p.license === "exclusive" ? "badge-cyan" : p.license === "trackout" ? "badge-accent" : ""}">${L ? L.short : "Free download"}</span><div class="subtle" style="font-size:12px;margin-top:3px">${L ? esc(L.files) : "MP3 · non-commercial"}</div></td>
        <td class="hide-sm">${BF.date(p.date)}</td>
        <td class="hide-sm mono" style="font-size:12.5px">${p.orderId ?? "—"}</td>
        <td class="num"><div class="lib-files">${fileButtons(p)}${licenseLink(p)}${reviewBtn(p, b.producerId)}</div></td>
      </tr>`; }).join("")}</tbody></table></div>`;
  }

  function favorites() {
    const f = BF.store.get("favorites").map((id) => BF.beatById[id]).filter(Boolean);
    if (!f.length) return ui.empty({ icon: "heart", title: "No favourites yet", body: "Tap the heart on any beat to save it here.", actions: `<a class="btn btn-primary" href="#/beats/catalog">Discover beats</a>` });
    return `<div class="grid-beats" data-queue="${f.map((b) => b.id).join(",")}">${f.map((b) => ui.beatCard(b, { dur: true })).join("")}</div>`;
  }

  function playlists() {
    const pls = BF.store.get("playlists");
    const mosaic = (ids) => { const arts = ids.map((id) => beatOf(id)?.art).filter(Boolean).slice(0, 4); while (arts.length < 4) arts.push(""); return `<div class="mosaic">${arts.map((a) => (a ? `<img src="${a}" alt="">` : `<span></span>`)).join("")}</div>`; };
    return `<div class="playlist-toolbar"><button class="btn btn-primary btn-sm" data-new-pl>${I("plus", "i-sm")} New playlist</button></div>
      ${pls.length ? `<div class="grid-beats">${pls.map((pl) => { const live = pl.beatIds.filter((id) => beatOf(id)); return `<article class="beat-card lib-pl" data-queue="${live.join(",")}">
        <div class="art">${mosaic(pl.beatIds)}${live.length ? `<div class="art-overlay">${ui.playBtn(live[0], "lg")}</div>` : ""}</div>
        <div class="body"><div class="title-row"><span class="title truncate">${esc(pl.title)}</span><button class="icon-btn sm" data-del-pl="${pl.id}" aria-label="Delete playlist ${esc(pl.title)}" style="margin-left:auto">${I("trash", "i-sm")}</button></div><span class="subtle" style="font-size:13px">${pl.beatIds.length} beats · ${pl.isPublic ? "Public" : "Private"}</span></div></article>`; }).join("")}</div>`
        : ui.empty({ icon: "playlist", title: "No playlists", body: "Group beats for a project: an EP shortlist, references for a session, ideas for a feature." })}`;
  }

  function downloads() {
    const d = BF.store.get("downloads");
    if (!d.length) return ui.empty({ icon: "download", title: "No downloads yet", body: "Every file you download is logged here. Download again any time from Beat licenses or Packs." });
    return `<div class="table-wrap card"><table class="table"><thead><tr><th scope="col">File</th><th scope="col" class="hide-sm">Item</th><th scope="col">Size</th><th scope="col" class="hide-sm">Requested</th><th scope="col">Status</th></tr></thead>
      <tbody>${d.map((x) => { const it = x.itemId && (BF.beatById[x.itemId] ?? BF.packById[x.itemId]); return `<tr><td class="strong"><span style="display:inline-flex;gap:8px;align-items:center">${I(x.file.endsWith(".zip") ? "folder" : "file-audio", "i-sm")}${esc(x.file)}</span></td>
        <td class="hide-sm">${it ? `<a href="#/beats/${it.kind === "pack" ? "pack" : "beat"}/${it.id}">${esc(it.title)}</a>` : "—"}</td><td class="mono">${x.size}</td><td class="hide-sm mono" style="font-size:12.5px">${x.date}</td>
        <td><span class="badge ${x.status === "failed" ? "badge-danger" : x.status === "completed" ? "badge-success" : ""}">${esc(x.status)}</span></td></tr>`; }).join("")}</tbody></table></div>`;
  }

  function licenses() {
    const ps = BF.store.get("purchases").filter((p) => p.license !== "free");
    if (!ps.length) return ui.empty({ icon: "license", title: "No licenses yet", body: "Your license agreements appear here after your first purchase." });
    return `<div class="lic-docs">${ps.map((p) => { const b = beatInfo(p), L = BF.licenseById[p.license], pr = BF.producerById[b.producerId]; const streams = L.terms?.find(([k]) => k.toLowerCase().includes("stream"))?.[1] || "Unlimited"; return `<article class="lic-doc-card card">
      <div class="ldc-head"><span class="badge ${p.license === "exclusive" ? "badge-cyan" : "badge-accent"}">${esc(L.name)}</span><span class="badge badge-success"><span class="dot"></span> Active</span></div>
      <div style="display:flex;gap:12px;align-items:center;margin:14px 0"><div class="art sm"><img src="${b.art}" alt=""></div><div style="min-width:0"><div class="h4 truncate">${esc(b.title)}</div><div class="subtle" style="font-size:12.5px">Licensor: ${esc(pr?.name ?? "")}</div></div></div>
      <dl class="kv compact"><div><dt>Order</dt><dd class="mono">${p.orderId}</dd></div><div><dt>Issued</dt><dd>${BF.date(p.date)}</dd></div><div><dt>Stream cap</dt><dd>${esc(streams)}</dd></div><div><dt>Credit</dt><dd class="mono" style="font-size:12px">Prod. by ${esc(pr?.name ?? "")}</dd></div></dl>
      <div style="display:flex;gap:8px;margin-top:14px"><a class="btn btn-secondary btn-sm" href="/api/store/library/${p.entitlementId}/license" download>${I("download", "i-sm")} License agreement (.txt)</a></div>
    </article>`; }).join("")}</div>`;
  }

  function packsTab() {
    const ps = BF.store.get("packPurchases");
    if (!ps.length) return ui.empty({ icon: "folder", title: "No packs yet", body: "Sample packs, loop kits and production packs you buy land here.", actions: `<a class="btn btn-primary" href="#/beats/discover">Browse packs</a>` });
    return `<div class="table-wrap card"><table class="table" data-queue="${ps.map((p) => p.id).filter((id) => BF.packById[id]).join(",")}"><thead><tr><th scope="col">Pack</th><th scope="col">Type</th><th scope="col" class="hide-sm">Purchased</th><th scope="col" class="hide-sm">Order</th><th scope="col"><span class="sr-only">Files</span></th></tr></thead>
      <tbody>${ps.map((p) => { const k = BF.packById[p.id]; if (!k) return ""; return `<tr data-beat-card="${k.id}"><td><div class="cell-beat"><div class="art sm"><img src="${k.art}" alt=""></div>${ui.playBtn(k.id, "sm")}<div style="min-width:0"><a class="strong" style="color:var(--text);font-weight:600" href="#/beats/pack/${k.id}">${esc(k.title)}</a><div class="subtle" style="font-size:12.5px">${esc(BF.producerById[k.producerId]?.name ?? "")} · ${esc(k.contents)}</div></div></div></td>
        <td><span class="badge">${BF.PACK_TYPES[k.type]}</span></td><td class="hide-sm">${BF.date(p.date)}</td><td class="hide-sm mono" style="font-size:12.5px">${p.orderId}</td>
        <td class="num"><div class="lib-files">${fileButtons(p)}${reviewBtn(p, k.producerId)}</div></td></tr>`; }).join("")}</tbody></table></div>`;
  }

  /** Verified-purchase review of the producer (one per purchased item). */
  function openReview(orderItemId, producerId) {
    const p = BF.producerById[producerId];
    ui.modal({
      title: `Rate ${esc(p?.name ?? "this producer")}`,
      body: `<form data-rv-form><fieldset class="field"><legend class="label">Rating</legend><div class="chip-wrap" role="radiogroup">${[5, 4, 3, 2, 1].map((n) => `<label class="chip"><input type="radio" name="rv-rating" value="${n}" class="sr-only" ${n === 5 ? "checked" : ""}> ${"★".repeat(n)}</label>`).join("")}</div></fieldset>
        <div class="field"><label class="label" for="rv-body">Review</label><textarea class="textarea" id="rv-body" maxlength="1000" required placeholder="How were the files, the mix and the license terms?"></textarea><div class="field-error">${I("alert-circle", "i-xs")} <span></span></div></div></form>`,
      foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-rv-send>Post review</button>`,
      onMount(el, close) {
        el.querySelector("[data-rv-send]").addEventListener("click", async (e) => {
          const body = el.querySelector("#rv-body"), f = body.closest(".field");
          if (!body.value.trim()) { f.classList.add("has-error"); f.querySelector(".field-error span").textContent = "Write a few words."; body.focus(); return; }
          const btn = e.currentTarget; btn.disabled = true;
          try {
            await BF.http.post("/api/store/reviews", { order_item_id: orderItemId, rating: Number(el.querySelector("[name=rv-rating]:checked").value), body: body.value.trim() });
            close(); ui.toast({ title: "Review posted", desc: "Thanks — it appears on the producer’s storefront." });
            await Promise.all([BF.store.refreshLibrary(), BF.refreshCatalog()]); BF.rerender();
          } catch (err) { btn.disabled = false; f.classList.add("has-error"); f.querySelector(".field-error span").textContent = err.message; }
        });
      },
    });
  }

  const TABS = [["purchased", "Beat licenses", () => BF.store.get("purchases").length, purchased], ["packs", "Packs", () => BF.store.get("packPurchases").length, packsTab], ["favorites", "Favourites", () => BF.store.get("favorites").filter((id) => BF.beatById[id]).length, favorites], ["playlists", "Playlists", () => BF.store.get("playlists").length, playlists], ["downloads", "Downloads", () => BF.store.get("downloads").length, downloads], ["licenses", "Licenses", () => BF.store.get("purchases").filter((p) => p.license !== "free").length, licenses]];

  BF.route("/beats/library", {
    title: "My library",
    render(_, q) {
      const s = BF.store.get("session");
      if (!s.signedIn) return `<div class="container">${ui.empty({ icon: "lock", title: "Sign in to see your library", body: "Your purchases, licenses and downloads are tied to your account.", actions: `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent("/beats/library")}">Sign in</a><a class="btn btn-secondary" href="#/signup">Create account</a>` })}</div>`;
      const tab = TABS.some((t) => t[0] === q.tab) ? q.tab : "purchased";
      const spent = [...BF.store.get("purchases"), ...BF.store.get("packPurchases")].reduce((a, p) => a + p.amount, 0);
      return `<div class="container" style="padding-top:24px">${BF.librarySwitch ? BF.librarySwitch("beats") : ""}
        <header class="lib-head">
          <div class="avatar lg"><img src="${s.user.avatar || BF.avatar(s.user.id + s.user.name, "violet")}" alt=""></div>
          <div style="flex:1;min-width:0"><span class="eyebrow no-rule">Beats Library</span><h1 class="h1" style="margin-top:4px">${esc(s.user.name)}</h1><p class="muted" style="font-size:14px">@${esc(s.user.handle)}</p></div>
          <dl class="lib-stats"><div><dt>Licenses</dt><dd>${BF.store.get("purchases").length}</dd></div><div><dt>Following</dt><dd>${BF.store.get("following").length}</dd></div><div><dt>Spent</dt><dd>${BF.money0(spent)}</dd></div></dl>
          <button class="btn btn-secondary btn-sm" data-edit-profile>${I("edit", "i-sm")} Edit name</button>
        </header>
        <div class="tabs" role="tablist" aria-label="Library sections" style="margin:28px 0 24px">${TABS.map(([k, l, n]) => `<button class="tab" role="tab" id="lt-${k}" aria-controls="lp-${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-ltab="${k}">${l} <span class="n">${n()}</span></button>`).join("")}</div>
        ${TABS.map(([k, , , fn]) => `<div role="tabpanel" id="lp-${k}" aria-labelledby="lt-${k}" ${tab === k ? "" : "hidden"} data-lpanel="${k}">${fn()}</div>`).join("")}
      </div><div style="height:48px"></div>`;
    },
    mount(el) {
      const tl = el.querySelector('[role="tablist"]'); if (!tl) return;
      tl.addEventListener("click", (e) => { const t = e.target.closest("[data-ltab]"); if (t) { BF.selectTab(t); BF.setQuery({ tab: t.dataset.ltab === "purchased" ? "" : t.dataset.ltab }); } });
      tl.addEventListener("keydown", BF.tabKeys);
      const repaint = (k) => { const panel = el.querySelector(`[data-lpanel="${k}"]`); if (!panel) return; panel.innerHTML = TABS.find((t) => t[0] === k)[3](); el.querySelector(`#lt-${k} .n`).textContent = TABS.find((t) => t[0] === k)[2](); BF.player.sync(); };
      const offs = [BF.store.on("favorites", () => repaint("favorites")), BF.store.on("playlists", () => repaint("playlists")), BF.store.on("downloads", () => repaint("downloads")),
        BF.store.on("purchases", () => { repaint("purchased"); repaint("licenses"); }), BF.store.on("packPurchases", () => repaint("packs"))];
      BF.store.refreshLibrary().catch(() => {});
      el.addEventListener("click", async (e) => {
        const rv = e.target.closest("[data-review]"); if (rv) { openReview(rv.dataset.review, rv.dataset.reviewProducer); return; }
        if (e.target.closest("[data-new-pl]")) {
          ui.modal({ title: "New playlist", body: `<form class="stack-16" data-f><div class="field"><label class="label" for="pl-name">Name</label><input class="input" id="pl-name" maxlength="60" placeholder="e.g. Summer EP ideas" autofocus><div class="field-error">${I("alert-circle", "i-xs")} Give your playlist a name.</div></div></form>`,
            foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Create</button>`,
            onMount(m, close) {
              const go = async (ev) => {
                ev && ev.preventDefault(); const v = m.querySelector("#pl-name").value.trim(); m.querySelector(".field").classList.toggle("has-error", !v); if (!v) return;
                try { await BF.store.createPlaylist("beats", v); close(); ui.toast({ title: "Playlist created", desc: esc(v) }); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t create the playlist", desc: esc(err.message) }); }
              };
              m.querySelector("[data-ok]").onclick = go; m.querySelector("[data-f]").onsubmit = go;
            } });
        }
        const del = e.target.closest("[data-del-pl]");
        if (del) {
          const pl = BF.store.get("playlists").find((x) => x.id === del.dataset.delPl);
          if (pl && await ui.confirm({ title: "Delete playlist?", body: `“${esc(pl.title)}” will be removed. The beats stay in your favourites and purchases.`, confirmLabel: "Delete playlist", danger: true })) {
            try { await BF.store.deletePlaylist(pl.id); ui.toast({ kind: "info", title: "Playlist deleted" }); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t delete it", desc: esc(err.message) }); }
          }
        }
        if (e.target.closest("[data-edit-profile]")) {
          const u = BF.store.get("session").user;
          ui.modal({ title: "Edit display name", body: `<div class="field"><label class="label" for="pf-n">Display name</label><input class="input" id="pf-n" value="${esc(u.name)}" maxlength="50"><span class="hint">Shown on your profile, reviews and messages across TUNIBEAT.</span></div>`,
            foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`,
            onMount(m, close) { m.querySelector("[data-ok]").onclick = async () => {
              try { const r = await BF.http.patch("/api/me/profile", { display_name: m.querySelector("#pf-n").value.trim() }); await BF.store.hydrate(r.user ?? (await BF.http.get("/api/me")).user); close(); ui.toast({ title: "Saved" }); BF.rerender(); }
              catch (err) { ui.toast({ kind: "error", title: "Couldn’t save", desc: esc(err.message) }); }
            }; } });
        }
      });
      return () => offs.forEach((o) => o());
    },
  });
})();
