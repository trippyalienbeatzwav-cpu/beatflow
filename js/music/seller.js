/* Electronic seller tools inside the shared dashboard:
   Music analytics · Releases · Upload Release (wizard) · Genres (admin).
   Everything is read from and written to the API: analytics come from paid orders and counted plays,
   releases from the seller catalog, genres from the admin taxonomy endpoints. */
(function () {
  const I = BF.icon, ui = BF.ui, C = BF.chart, M = BF.mui, esc = BF.esc;
  const cents = (c) => BF.money((c ?? 0) / 100), cents0 = (c) => BF.money0((c ?? 0) / 100);
  const pct = (a, b) => (b ? `${a >= b ? "+" : "−"}${Math.abs(((a - b) / b) * 100).toFixed(1)}%` : a ? "new" : "—");
  const isAdmin = () => BF.store.get("session").user?.role === "admin";

  Object.assign(BF.dashLoaders, {
    music: async () => { const [dash, cat] = await Promise.all([BF.http.get("/api/seller/dashboard?marketplace=electronic"), BF.http.get("/api/seller/catalog")]); return { dash, cat }; },
    releases: async () => ({ cat: await BF.http.get("/api/seller/catalog") }),
    genres: async () => (isAdmin() ? { genres: (await BF.http.get("/api/store/admin/genres")).genres.filter((g) => g.marketplace === "electronic") } : { forbidden: true }),
  });

  /* ======================= MUSIC ANALYTICS ======================= */
  BF.dashSections.music = (q, { dash, cat }) => {
    if (!cat.releases.length) return BF.dashHead("Music Analytics", "") + ui.empty({ icon: "disc", title: "No releases yet", body: "Analytics are calculated from real orders and preview plays of releases you manage.", actions: `<a class="btn btn-primary" href="#/dashboard/release-upload">Upload a release</a>` });
    const k = dash.kpis, d30 = dash.daily_30;
    const kpis = [
      ["Net revenue", cents0(k.net_cents_30d), pct(k.net_cents_30d, k.net_cents_prev_30d), k.net_cents_30d >= k.net_cents_prev_30d, d30.map((d) => d.net_cents), "vs. previous 30 days"],
      ["Units sold", String(k.units_30d), `${k.orders_30d} orders`, true, d30.map((d) => d.net_cents), "last 30 days"],
      ["Preview plays", BF.num(k.plays_30d), "counted plays", true, d30.map((d) => d.plays), "last 30 days"],
      ["Conversion", k.conversion_pct == null ? "—" : `${k.conversion_pct}%`, "units ÷ plays", true, d30.map((d) => d.plays), "last 30 days"],
      ["Lifetime net", cents0(k.lifetime_net_cents), `${k.lifetime_units} units`, true, [], "all time"],
    ];
    const total12 = dash.revenue_12m.reduce((s, m) => s + m.net_cents, 0);
    return BF.dashHead("Music Analytics", `Electronic Music Store · ${cat.labels.length ? esc(cat.labels.map((l) => l.name).join(", ")) : "your artist releases"}`, `<a class="btn btn-primary btn-sm" href="#/dashboard/release-upload">${I("plus", "i-sm")} New release</a>`) + `
      <div class="kpi-grid">${kpis.map(([l, v, d, up, series, sub]) => `<div class="kpi card"><span class="kpi-label">${l}</span><span class="kpi-value tnum">${v}</span><span class="kpi-delta ${up ? "up" : "down"}">${esc(d)} <span class="subtle">${sub}</span></span>${series.some((x) => x) ? C.spark(series, up ? "var(--accent-text)" : "var(--n-400)") : ""}</div>`).join("")}</div>
      <div class="dash-grid">
        <section class="card span-2"><div class="card-head"><h2>Net revenue · 12 months</h2><button class="btn btn-ghost btn-sm" data-table-toggle="mrev" aria-pressed="false">${I("list", "i-sm")} Table</button></div>
          <div class="card-pad"><div class="chart-big"><span class="display tnum" style="font-size:32px">${cents0(total12)}</span><span class="subtle" style="font-size:13px">${esc(dash.revenue_12m[0].label)} – ${esc(dash.revenue_12m.at(-1).label)}</span></div><div id="mrev-chart"></div><div data-table="mrev" hidden></div></div></section>
        <section class="card"><div class="card-head"><h2>Format mix</h2><span class="subtle" style="font-size:13px">Share of units sold</span></div><div class="card-pad"><div id="mfmt"></div></div></section>
        <section class="card span-2"><div class="card-head"><h2>Top items</h2><span class="subtle" style="font-size:13px">Net revenue · all time</span></div><div class="card-pad"><div id="mtop"></div></div></section>
        <section class="card"><div class="card-head"><h2>Buyer countries</h2><span class="subtle" style="font-size:13px">Share of units</span></div><div class="card-pad"><div id="mgeo"></div></div></section>
        <section class="card span-3"><div class="card-head"><h2>Recent sales</h2></div>${recentTable(dash.recent_orders.slice(0, 8))}</section>
      </div>`;
  };
  function recentTable(rows) {
    if (!rows.length) return ui.empty({ icon: "orders", title: "No sales yet", body: "Sales appear here as soon as a buyer’s payment clears." });
    return `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Order</th><th scope="col">Item</th><th scope="col">Format</th><th scope="col" class="hide-sm">Buyer</th><th scope="col">Status</th><th scope="col" class="num">Paid</th><th scope="col" class="num hide-sm">Your net</th></tr></thead>
      <tbody>${rows.map((o) => `<tr><td class="mono" style="font-size:12.5px">${esc(o.order_id)}</td><td><a class="strong" style="color:var(--text)" href="#/electronic/${o.kind === "track" ? "track" : "release"}/${esc(o.item_id)}">${esc(o.title)}</a></td><td>${esc(o.format ?? "")}</td><td class="hide-sm">${esc(o.buyer)}</td><td>${BF.dashStatus(o.status)}</td><td class="num mono strong">${cents(o.paid_cents)}</td><td class="num mono hide-sm">${cents(o.net_cents)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  BF.dashMounts.music = (el, q, { dash, cat } = {}) => {
    if (!dash || !cat.releases.length) return;
    const none = (node) => (node.innerHTML = `<p class="subtle">No sales yet.</p>`);
    const draw = () => {
      const d = dash.revenue_12m.map((m) => ({ label: m.label, value: m.net_cents / 100 }));
      C.line(el.querySelector("#mrev-chart"), d, { format: (v, s) => (s ? "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v)) : BF.money0(v)), label: "Net music revenue over 12 months" });
      el.querySelector('[data-table="mrev"]').innerHTML = C.table(["Month", "Net revenue", "Units"], dash.revenue_12m.map((m) => [m.label, cents0(m.net_cents), m.units]));
      const fmt = el.querySelector("#mfmt"); dash.format_mix.length ? C.stack(fmt, dash.format_mix.map((m) => [m.key, m.share])) : none(fmt);
      const top = el.querySelector("#mtop"); dash.top_items.length ? C.hbars(top, dash.top_items.slice(0, 6).map((t) => ({ label: t.title, value: t.net_cents / 100, t })), { format: (v) => BF.money0(v), color: "var(--series-1)", tip: (x) => `<b>${esc(x.label)}</b><span class="subtle">${x.t.units} units · ${cents(x.t.net_cents)} net</span>` }) : none(top);
      const geo = el.querySelector("#mgeo"); dash.geo.length ? C.hbars(geo, dash.geo.slice(0, 8).map((g) => ({ label: g.country || "Unknown", value: g.share })), { format: (v) => v + "%", color: "var(--series-1)" }) : none(geo);
    };
    draw();
    let w = el.clientWidth; const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 20) { w = el.clientWidth; draw(); } }); ro.observe(el);
    return () => ro.disconnect();
  };

  /* ======================= RELEASES (catalog) ======================= */
  const audioBadge = (t) => (t.audio?.status === "failed" ? `<span class="badge badge-danger" title="${esc(t.audio.error ?? "")}">Audio failed</span>` : t.audio?.status === "processing" ? `<span class="badge">Processing</span>` : "");
  BF.dashSections.releases = (q, { cat }) => {
    const draft = BF.store.get("releaseDraft");
    const rows = cat.releases;
    return BF.dashHead("Releases", `${rows.length} release${rows.length === 1 ? "" : "s"} you manage`, `<a class="btn btn-primary btn-sm" href="#/dashboard/release-upload">${I("plus", "i-sm")} Upload release</a>`) + `
      ${draft ? `<div class="notice warning" style="margin-bottom:16px">${I("edit", "i-sm")}<div><strong>Draft:</strong> “${esc(draft.title || "Untitled release")}” (${BF.releaseTypeName(draft.type)}) — step ${draft.step} of 5${draft.savedAt ? `, saved ${esc(draft.savedAt)}` : ""}. <a class="link" href="#/dashboard/release-upload">Continue</a></div></div>` : ""}
      ${rows.length ? `<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Release</th><th scope="col">Type</th><th scope="col" class="hide-sm">Catalog</th><th scope="col" class="hide-sm">Date</th><th scope="col">Status</th><th scope="col" class="num">Actions</th></tr></thead>
      <tbody>${rows.map((r) => { const live = BF.releaseById[r.id]; const failed = r.tracks.filter((t) => t.audio?.status === "failed").length; return `<tr data-rel="${r.id}"><td><div class="cell-beat">${live ? `<div class="art sm" style="width:40px;height:40px"><img src="${live.art}" alt=""></div>` : ""}<div>${live ? `<a class="strong" style="color:var(--text);font-weight:600" href="#/electronic/release/${r.id}">${esc(r.title)}</a>` : `<span class="strong">${esc(r.title)}</span>`}
          <div class="subtle" style="font-size:12.5px">${r.tracks.length} track${r.tracks.length === 1 ? "" : "s"}${failed ? ` · <span style="color:var(--danger)">${failed} failed to process</span>` : ""}</div></div></div></td>
        <td>${live ? M.typeBadge(live) : esc(BF.releaseTypeName(r.type))}</td><td class="hide-sm mono" style="font-size:12.5px">${esc(r.cat ?? "—")}</td><td class="hide-sm">${BF.releaseDate(r.release_date)}</td><td>${BF.dashStatus(r.status)} ${r.tracks.map(audioBadge).find(Boolean) ?? ""}</td>
        <td class="num">${r.status === "published" ? `<button class="btn btn-ghost btn-sm" data-rel-status="draft">Unpublish</button>` : r.status === "draft" ? `<button class="btn btn-secondary btn-sm" data-rel-status="published" ${failed ? "disabled" : ""}>Publish</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`
      : ui.empty({ icon: "disc", title: "No releases yet", body: "Upload lossless masters; the server analyses each track (tempo, beat grid, key) and builds the previews.", actions: `<a class="btn btn-primary" href="#/dashboard/release-upload">Upload a release</a>` })}`;
  };
  BF.dashMounts.releases = (el) => {
    const onClick = async (e) => {
      const b = e.target.closest("[data-rel-status]"); if (!b) return;
      const id = b.closest("[data-rel]").dataset.rel, status = b.dataset.relStatus;
      if (status === "draft" && !(await ui.confirm({ title: "Unpublish this release?", body: "It leaves the store and buyers’ carts. Past buyers keep their downloads.", confirmLabel: "Unpublish" }))) return;
      b.disabled = true;
      try { await BF.http.patch(`/api/seller/releases/${id}`, { status }); await BF.refreshCatalog(); ui.toast({ title: status === "published" ? "Release published" : "Release unpublished" }); BF.rerender(); }
      catch (err) { b.disabled = false; ui.toast({ kind: "error", title: "Couldn’t update the release", desc: esc(err.message) }); }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  };

  /* ======================= GENRES (admin) ======================= */
  const FAMILIES = ["four", "techno", "trance", "afro", "minimal", "disco", "dnb", "halftime", "garage", "breaks", "synth", "downtempo", "ambient", "hardcore"];
  BF.dashSections.genres = (q, { forbidden, genres }) => {
    if (forbidden) return BF.dashHead("Genres", "") + ui.empty({ icon: "lock", title: "Admins only", body: "The genre taxonomy is managed by platform admins. Sign in with an admin account to edit it." });
    return BF.dashHead("Genres", "Platform-wide genre taxonomy for the Electronic Music Store. Changes apply to navigation, filters and uploads for everyone.") + `
      <div class="notice info" style="margin-bottom:16px">${I("shield", "i-sm")}<div><strong>Admin only.</strong> Hidden genres keep their tracks — they just disappear from browse and upload menus. Renames keep URLs stable.</div></div>
      <div class="card"><div class="table-wrap"><table class="table gadmin"><thead><tr><th scope="col">Order</th><th scope="col">Name</th><th scope="col">Typical BPM</th><th scope="col">Preview pattern</th><th scope="col" class="num">Tracks</th><th scope="col">Visible</th></tr></thead>
        <tbody>${genres.map((g, i) => `<tr data-gid="${g.id}" class="${g.visible ? "" : "is-hidden"}">
          <td><div style="display:flex;gap:2px"><button class="icon-btn sm" data-g-move="-1" aria-label="Move ${esc(g.name)} up" ${i === 0 ? "disabled" : ""}>${I("chevron-up", "i-sm")}</button><button class="icon-btn sm" data-g-move="1" aria-label="Move ${esc(g.name)} down" ${i === genres.length - 1 ? "disabled" : ""}>${I("chevron-down", "i-sm")}</button></div></td>
          <td><label class="sr-only" for="gn-${g.id}">Name</label><input class="input input-sm" id="gn-${g.id}" data-g-name value="${esc(g.name)}" maxlength="40" style="min-width:170px"></td>
          <td><div style="display:flex;gap:4px;align-items:center"><input class="input input-sm mono" data-g-lo value="${g.bpm?.[0] ?? ""}" inputmode="numeric" style="width:64px" aria-label="Minimum BPM for ${esc(g.name)}"><span class="subtle">–</span><input class="input input-sm mono" data-g-hi value="${g.bpm?.[1] ?? ""}" inputmode="numeric" style="width:64px" aria-label="Maximum BPM for ${esc(g.name)}"></div></td>
          <td><select class="select input-sm" data-g-family style="width:auto" aria-label="Preview pattern for ${esc(g.name)}">${FAMILIES.concat(FAMILIES.includes(g.family) ? [] : [g.family]).map((f) => `<option ${g.family === f ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></td>
          <td class="num mono">${BF.ETRACKS.filter((t) => t.genre === g.id).length}</td>
          <td><label class="switch"><input type="checkbox" data-g-vis ${g.visible ? "checked" : ""} aria-label="Show ${esc(g.name)}"></label></td></tr>`).join("")}</tbody></table></div></div>
      <form class="card card-pad" data-g-add style="margin-top:16px"><h2 class="h4" style="margin-bottom:12px">Add a genre</h2>
        <div class="form-grid" style="grid-template-columns:2fr 1fr 1fr 1fr auto;align-items:end">
          <div class="field"><label class="label" for="ga-name">Name</label><input class="input" id="ga-name" placeholder="e.g. Organic House" maxlength="40" required><div class="field-error">${I("alert-circle", "i-xs")} <span>Enter a name.</span></div></div>
          <div class="field"><label class="label" for="ga-lo">BPM from</label><input class="input mono" id="ga-lo" value="118" inputmode="numeric"></div>
          <div class="field"><label class="label" for="ga-hi">BPM to</label><input class="input mono" id="ga-hi" value="124" inputmode="numeric"></div>
          <div class="field"><label class="label" for="ga-fam">Pattern</label><select class="select" id="ga-fam">${FAMILIES.map((f) => `<option>${f}</option>`).join("")}</select></div>
          <button class="btn btn-primary">${I("plus", "i-sm")} Add</button>
        </div></form>`;
  };
  BF.dashMounts.genres = (el, q, data = {}) => {
    if (data.forbidden) return;
    const patch = async (id, body, okMsg) => {
      try { await BF.http.patch(`/api/store/admin/genres/${id}`, body); await BF.refreshCatalog(); if (okMsg) ui.toast({ title: okMsg, timeout: 1800 }); return true; }
      catch (err) { ui.toast({ kind: "error", title: "Couldn’t save the genre", desc: esc(err.message) }); BF.rerender(); return false; }
    };
    const onChange = (e) => {
      const tr = e.target.closest("tr[data-gid]"); if (!tr) return;
      const id = tr.dataset.gid, g = data.genres.find((x) => x.id === id);
      if (e.target.matches("[data-g-name]")) { const v = e.target.value.trim(); if (!v) { e.target.value = g.name; return; } patch(id, { name: v }, "Genre renamed"); }
      if (e.target.matches("[data-g-lo],[data-g-hi]")) {
        const lo = +tr.querySelector("[data-g-lo]").value, hi = +tr.querySelector("[data-g-hi]").value;
        if (!(lo >= 40 && hi <= 250 && lo <= hi)) { ui.toast({ kind: "error", title: "Invalid BPM range", desc: "Use 40–250 with the first value lower." }); return; }
        patch(id, { bpm_lo: lo, bpm_hi: hi }, "BPM range saved");
      }
      if (e.target.matches("[data-g-family]")) patch(id, { family: e.target.value }, "Preview pattern saved");
      if (e.target.matches("[data-g-vis]")) { tr.classList.toggle("is-hidden", !e.target.checked); patch(id, { visible: e.target.checked }, e.target.checked ? "Genre visible" : "Genre hidden"); }
    };
    const onClick = async (e) => {
      const mv = e.target.closest("[data-g-move]"); if (!mv) return;
      const id = mv.closest("tr").dataset.gid, i = data.genres.findIndex((g) => g.id === id), j = i + +mv.dataset.gMove;
      if (j < 0 || j >= data.genres.length) return;
      const [a, b] = [data.genres[i], data.genres[j]];
      if (await patch(a.id, { position: b.order }) && await patch(b.id, { position: a.order })) { await BF.rerender(); document.querySelector(`tr[data-gid="${id}"] [data-g-move="${mv.dataset.gMove}"]`)?.focus(); }
    };
    const onSubmit = async (e) => {
      if (!e.target.matches("[data-g-add]")) return;
      e.preventDefault();
      const name = el.querySelector("#ga-name").value.trim(), f = el.querySelector("#ga-name").closest(".field");
      f.classList.toggle("has-error", !name); if (!name) return el.querySelector("#ga-name").focus();
      try {
        await BF.http.post("/api/store/admin/genres", { marketplace: "electronic", name, bpm_lo: +el.querySelector("#ga-lo").value, bpm_hi: +el.querySelector("#ga-hi").value, family: el.querySelector("#ga-fam").value });
        await BF.refreshCatalog(); ui.toast({ title: "Genre added", desc: esc(name) + " is now in navigation and filters." }); BF.rerender();
      } catch (err) { f.classList.add("has-error"); f.querySelector(".field-error span").textContent = err.message; }
    };
    el.addEventListener("change", onChange); el.addEventListener("click", onClick); el.addEventListener("submit", onSubmit);
    return () => { el.removeEventListener("change", onChange); el.removeEventListener("click", onClick); el.removeEventListener("submit", onSubmit); };
  };

  /* ======================= UPLOAD RELEASE (wizard) ======================= */
  const STEPS = ["Release details", "Artwork", "Tracks & audio", "Formats & pricing", "Review & submit"];
  const SELL_TYPES = ["single", "ep", "album", "compilation", "remix", "dj-tool"]; // packs/loops/stems are sold in the Beats Store
  const ISRC = /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/i;
  const MAX_MB = 700;
  const today = () => new Date().toISOString().slice(0, 10);
  const newTrack = () => ({ uid: Math.random().toString(36).slice(2, 8), title: "", mix: "Original Mix", bpm: "", key: "", energy: "6", isrc: "", explicit: false, file: null });
  const blank = () => ({ step: 1, type: "ep", title: "", label: "", cat: "", date: today(), genre: BF.egenres().find((g) => g.visible !== false)?.id ?? "", upc: "", description: "",
    art: null, artStyle: "horizon", artPalette: "electric", tracks: [newTrack(), newTrack()], formats: { WAV: true, AIFF: true, MP3: true }, publish: true, attest: false, savedAt: "" });
  let D, CAT;
  const uploads = {}; // track uid → { cancel }

  const stepper = () => `<ol class="stepper" aria-label="Release upload progress">${STEPS.map((l, i) => { const n = i + 1, st = n < D.step ? "done" : n === D.step ? "current" : "todo"; return `<li class="${st}"><button data-goto="${n}" ${st === "todo" ? "disabled" : ""} ${st === "current" ? 'aria-current="step"' : ""}><span class="st-n">${st === "done" ? I("check", "i-xs") : n}</span><span class="st-l">${l}</span></button></li>`; }).join("")}</ol>`;
  const fld = (k, label, input, hint = "") => `<div class="field ${D.errors?.[k] ? "has-error" : ""}"><label class="label" for="ru-${k}">${label}</label>${input}${hint ? `<span class="hint">${hint}</span>` : ""}<div class="field-error">${I("alert-circle", "i-xs")} ${esc(D.errors?.[k] || "")}</div></div>`;
  const artSrc = () => D.art?.url || BF.art("draft-rel" + D.title, D.artStyle, D.artPalette);
  const labelName = () => CAT.labels.find((l) => l.id === D.label)?.name;

  function s1() {
    return `<h2 class="h3">Release details</h2><p class="muted up-lead">This metadata appears on the release page, in search and on receipts. The primary artist is your artist profile${CAT.labels.length ? " (or the label’s roster when released on your label)" : ""}.</p>
      <div class="field"><span class="label">Release type</span><div class="chip-wrap" role="radiogroup" aria-label="Release type">${SELL_TYPES.map((t) => `<button type="button" class="chip" role="radio" data-rtype="${t}" aria-checked="${D.type === t}" aria-pressed="${D.type === t}">${BF.releaseTypeName(t)}</button>`).join("")}</div></div>
      <div class="form-grid" style="margin-top:16px">
        ${fld("title", "Release title", `<input class="input" id="ru-title" data-b="title" value="${esc(D.title)}" placeholder="e.g. NIGHT CIRCUIT" maxlength="100">`)}
        ${fld("label", "Label", `<select class="select" id="ru-label" data-b="label"><option value="" ${!D.label ? "selected" : ""}>Self-release (no label)</option>${CAT.labels.map((l) => `<option value="${esc(l.id)}" ${D.label === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>`, CAT.labels.length ? "" : "You can release on labels you manage.")}
        ${fld("cat", "Catalog number <span class='opt'>Optional</span>", `<input class="input mono" id="ru-cat" data-b="cat" value="${esc(D.cat)}" maxlength="16" placeholder="e.g. ABC001">`, "Letters, numbers and dashes. Must be unique.")}
        ${fld("date", "Release date", `<input class="input" type="date" id="ru-date" data-b="date" value="${esc(D.date)}">`)}
        ${fld("genre", "Primary genre", `<select class="select" id="ru-genre" data-b="genre">${BF.egenres().filter((g) => g.visible !== false).map((g) => `<option value="${g.id}" ${D.genre === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>`)}
        ${fld("upc", "UPC / EAN <span class='opt'>Optional</span>", `<input class="input mono" id="ru-upc" data-b="upc" value="${esc(D.upc)}" inputmode="numeric" placeholder="12 or 13 digits">`)}
        <div class="field span-2"><label class="label" for="ru-desc">Description <span class="opt" data-desc-count>${D.description.length}/1000</span></label><textarea class="textarea" id="ru-desc" data-b="description" maxlength="1000" placeholder="Story, influences, recommended use in a set.">${esc(D.description)}</textarea></div>
      </div>`;
  }
  function s2() {
    const f = D.artFile;
    return `<h2 class="h3">Artwork</h2><p class="muted up-lead">Square, at least 500 × 500 px (3000 × 3000 recommended), JPG, PNG or WebP. No URLs, prices or third-party logos.</p>
      <div class="art-step"><div class="art-preview" style="border-radius:2px"><img src="${artSrc()}" alt="Artwork preview"><span class="badge ${D.art ? "badge-success" : ""}" style="position:absolute;top:10px;left:10px">${D.art ? "Your upload" : "Generated"}</span></div>
        <div class="stack-16" style="flex:1;min-width:0">
          <label class="dropzone" data-rdrop="art"><input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" data-rartfile><span class="dz-icon">${I("image")}</span><span class="dz-main"><b>Upload cover art</b><span class="hint" style="display:block">${f && !f.done ? `Uploading… ${Math.round(f.pct)}%` : "Drag an image here or browse"}</span></span><span class="btn btn-secondary btn-sm dz-btn">Browse</span></label>
          <p class="field-error" style="${D.errors?.art ? "display:flex" : ""}">${I("alert-circle", "i-xs")} ${esc(D.errors?.art || "")}</p>
          <div><span class="label" style="margin-bottom:8px;display:block">Or use generated cover art</span><div class="chip-wrap">${BF.artStyles.map((s) => `<button type="button" class="chip" data-rastyle="${s}" aria-pressed="${!D.art && D.artStyle === s}" style="text-transform:capitalize;height:28px;font-size:12.5px">${s}</button>`).join("")}</div>
            <div class="swatches" style="margin-top:10px" role="radiogroup" aria-label="Artwork palette">${["electric", "graphite", "ultra", "acidnight", "ice", "blood", "gold", "rose"].map((p) => `<label class="swatch"><input type="radio" name="rpal" value="${p}" ${D.artPalette === p ? "checked" : ""}><span style="background:linear-gradient(135deg,${BF.palettes[p][1]},${BF.palettes[p][2]})" aria-hidden="true"></span><span class="sr-only">${p}</span></label>`).join("")}</div></div>
        </div></div>`;
  }
  function s3() {
    const tErr = D.errors?.tracks || {};
    return `<h2 class="h3">Tracks & audio</h2><p class="muted up-lead">Upload a lossless master (WAV or AIFF, max ${MAX_MB} MB) per track. After you submit, the server detects tempo, beat grid and key; values you enter here take priority.</p>
      <ol class="ru-tracks">${D.tracks.map((t, i) => { const e = tErr[t.uid] || {}; const f = t.file; return `<li class="ru-track card" data-uid="${t.uid}">
        <header><span class="tl-n mono">${String(i + 1).padStart(2, "0")}</span><b class="truncate" style="flex:1">${esc(t.title || "Untitled track")}${t.mix ? ` <span class="t-mix">${esc(t.mix)}</span>` : ""}</b>
          <button type="button" class="icon-btn sm" data-tmove="-1" aria-label="Move track up" ${i === 0 ? "disabled" : ""}>${I("chevron-up", "i-sm")}</button><button type="button" class="icon-btn sm" data-tmove="1" aria-label="Move track down" ${i === D.tracks.length - 1 ? "disabled" : ""}>${I("chevron-down", "i-sm")}</button>
          <button type="button" class="icon-btn sm" data-trm aria-label="Remove track ${i + 1}" ${D.tracks.length === 1 ? "disabled" : ""}>${I("trash", "i-sm")}</button></header>
        <div class="slot ${f ? (f.error ? "is-error" : f.done ? "is-done" : "is-uploading") : ""} ${e.file ? "is-error" : ""}">
          <label class="dropzone" data-rdrop="track"><input type="file" accept=".wav,.aif,.aiff" class="sr-only" data-tfile><span class="dz-icon">${I("file-audio")}</span><span class="dz-main"><b>${f ? esc(f.name) : "Master audio"}</b><span class="hint" style="display:block">${f?.done ? `${esc(f.size)} · uploaded` : "WAV / AIFF, 16–32 bit"}</span></span><span class="btn btn-secondary btn-sm dz-btn">${f ? "Replace" : "Browse"}</span></label>
          ${f && !f.done ? `<div class="up-progress"><div class="up-row"><span class="mono subtle" style="font-size:12px;flex:1">${f.error ? "" : "Uploading"}</span><span class="mono subtle" data-pct style="font-size:12px">${f.error ? "" : Math.round(f.pct) + "%"}</span>${f.error ? `<button type="button" class="btn btn-ghost btn-sm" data-tretry>${I("refresh", "i-xs")} Choose again</button>` : ""}</div><div class="progress ${f.error ? "error" : ""}" role="progressbar" aria-label="Track ${i + 1} upload" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f.pct)}"><span style="width:${f.error ? 100 : f.pct}%"></span></div>${f.error ? `<p class="field-error" style="display:flex;margin-top:6px">${I("alert-circle", "i-xs")} ${esc(f.error)}</p>` : ""}</div>` : ""}
          ${e.file ? `<p class="field-error" style="display:flex;padding:0 16px 12px">${I("alert-circle", "i-xs")} ${esc(e.file)}</p>` : ""}
        </div>
        <div class="form-grid ru-grid">
          <div class="field ${e.title ? "has-error" : ""}"><label class="label" for="tt-${t.uid}">Track title</label><input class="input input-sm" id="tt-${t.uid}" data-t="title" value="${esc(t.title)}" maxlength="100"><div class="field-error">${I("alert-circle", "i-xs")} ${esc(e.title || "")}</div></div>
          <div class="field"><label class="label" for="tm-${t.uid}">Mix name</label><input class="input input-sm" id="tm-${t.uid}" data-t="mix" value="${esc(t.mix)}" maxlength="60" placeholder="Original Mix / Extended Mix / Dub"></div>
          <div class="field ${e.bpm ? "has-error" : ""}"><label class="label" for="tb-${t.uid}">BPM <span class="opt">Blank = detect</span></label><input class="input input-sm mono" id="tb-${t.uid}" data-t="bpm" value="${esc(t.bpm)}" inputmode="numeric"><div class="field-error">${I("alert-circle", "i-xs")} ${esc(e.bpm || "")}</div></div>
          <div class="field"><label class="label" for="tk-${t.uid}">Key <span class="opt">Blank = estimate</span></label><select class="select input-sm" id="tk-${t.uid}" data-t="key"><option value="">Detect from audio</option>${BF.KEYS.map((k) => `<option ${t.key === k ? "selected" : ""}>${k}</option>`).join("")}</select>${t.key ? `<span class="hint">Camelot ${BF.camelot(t.key)}</span>` : ""}</div>
          <div class="field"><label class="label" for="te-${t.uid}">Energy (1–10)</label><input class="input input-sm mono" id="te-${t.uid}" data-t="energy" value="${esc(t.energy)}" inputmode="numeric"></div>
          <div class="field ${e.isrc ? "has-error" : ""}"><label class="label" for="ti-${t.uid}">ISRC <span class="opt">Optional</span></label><input class="input input-sm mono" id="ti-${t.uid}" data-t="isrc" value="${esc(t.isrc)}" placeholder="QZ-ABC-26-00001"><div class="field-error">${I("alert-circle", "i-xs")} ${esc(e.isrc || "")}</div></div>
          <div class="field"><span class="label">Content</span><label class="switch" style="height:36px"><input type="checkbox" data-t="explicit" ${t.explicit ? "checked" : ""}> Explicit lyrics</label></div>
        </div>
      </li>`; }).join("")}</ol>
      <button type="button" class="btn btn-secondary" data-tadd ${D.tracks.length >= 40 ? "disabled" : ""}>${I("plus", "i-sm")} Add track</button>`;
  }
  function s4() {
    const n = D.tracks.length, track = (f) => (f === "MP3" ? 149 : 199);
    const rel = (f) => (n > 1 ? Math.ceil(n * track(f) * 0.8) - 1 : track(f));
    return `<h2 class="h3">Formats & pricing</h2><p class="muted up-lead">Choose the formats buyers can download. MP3 (320 kbps) and AIFF files are generated from your lossless masters on demand.</p>
      <fieldset class="card card-pad stack-8" style="margin-bottom:16px"><legend class="h4" style="float:left;margin-bottom:8px">Formats offered</legend><div style="clear:both"></div>
        ${Object.values(BF.FORMATS).map((f) => `<label class="check"><input type="checkbox" data-fmt="${f.id}" ${D.formats[f.id] ? "checked" : ""}> <b style="color:var(--text)">${f.label}</b> <span class="subtle">· ${f.detail}</span></label>`).join("")}
        ${D.errors?.formats ? `<p class="field-error" style="display:flex">${I("alert-circle", "i-xs")} ${esc(D.errors.formats)}</p>` : ""}</fieldset>
      <div class="card card-pad"><h3 class="h4" style="margin-bottom:10px">Store pricing</h3>
        <table class="table"><thead><tr><th scope="col">Format</th><th scope="col" class="num">Per track</th><th scope="col" class="num">Full release (${n} track${n === 1 ? "" : "s"})</th></tr></thead>
        <tbody>${["MP3", "WAV", "AIFF"].filter((f) => D.formats[f]).map((f) => `<tr><td>${f}</td><td class="num mono">${cents(track(f))}</td><td class="num mono">${cents(rel(f))}</td></tr>`).join("")}</tbody></table>
        <p class="hint" style="margin-top:10px">Prices are set by the store so they’re consistent for DJs: lossless adds $0.50 per track, and full releases are 20% below buying every track separately.</p></div>
      <div class="notice" style="margin-top:16px">${I("wallet", "i-sm")}<div>You receive <strong>80%</strong> of each sale (20% platform commission). Earnings become withdrawable after the hold period — see <a class="link" href="#/dashboard/earnings">Earnings</a>.</div></div>`;
  }
  function s5() {
    const fmts = Object.keys(D.formats).filter((f) => D.formats[f]);
    const checks = [["Title and genre", !!(D.title.trim() && D.genre)], ["Artwork", !D.artFile || !!D.art], [`Audio for all ${D.tracks.length} tracks`, D.tracks.every((t) => t.file?.done)], ["At least one format", fmts.length > 0], ["Email verified", !!BF.store.get("session").user?.emailVerified]];
    return `<h2 class="h3">Review & submit</h2><p class="muted up-lead">After you submit, each master is analysed and the previews are built. The release goes live when every track has processed${D.publish ? "" : " — or stays a draft if you choose below"}.</p>
      <div class="publish-grid">
        <div class="pub-card card card-pad"><div class="art" style="border-radius:2px"><img src="${artSrc()}" alt=""></div>
          <div style="margin-top:12px"><span class="rtype">${BF.releaseTypeName(D.type)}</span><div class="h4" style="margin-top:6px">${esc(D.title || "Untitled release")}</div><div class="subtle" style="font-size:13px">${esc(labelName() ?? "Self-release")}${D.cat ? ` · <span class="mono">${esc(D.cat)}</span>` : ""}</div>
          <div class="subtle" style="font-size:13px">${D.date ? BF.releaseDate(D.date) : "No date"} · ${esc(BF.egenre(D.genre)?.name ?? "")}</div></div>
          <ol class="pub-lics">${D.tracks.map((t, i) => `<li><span class="truncate">${i + 1}. ${esc(t.title || "Untitled")} <span class="subtle">${esc(t.mix)}</span></span><span class="mono">${esc(t.bpm || "auto")} · ${t.key ? BF.camelot(t.key) : "auto"}</span></li>`).join("")}</ol>
          <div class="subtle mono" style="font-size:12px;margin-top:8px">${fmts.join(" · ")}</div></div>
        <div class="stack-16">
          <div class="card card-pad"><h3 class="h4" style="margin-bottom:10px">Checklist</h3><ul class="checklist">${checks.map(([l, ok]) => `<li class="${ok ? "ok" : "bad"}">${I(ok ? "check" : "x", "i-sm")} ${l}${l === "Email verified" && !ok ? ` — <a class="link" href="#/verify">verify now</a>` : ""}</li>`).join("")}</ul></div>
          <fieldset class="card card-pad stack-8"><legend class="h4" style="float:left;margin-bottom:10px">After processing</legend><div style="clear:both"></div>
            ${[[true, "Publish", "List it in the store as soon as every track is ready"], [false, "Keep as draft", "Publish later from Releases"]].map(([v, l, d]) => `<label class="check" style="align-items:flex-start"><input type="radio" name="rpub" value="${v}" ${D.publish === v ? "checked" : ""} style="margin-top:3px"><span><b style="color:var(--text)">${l}</b><span class="hint" style="display:block">${d}</span></span></label>`).join("")}</fieldset>
          <div class="field ${D.errors?.attest ? "has-error" : ""}"><label class="check attest"><input type="checkbox" data-rattest ${D.attest ? "checked" : ""}> <span>I control the rights to distribute these recordings and compositions (including samples and remixes), the metadata is accurate, and I accept the seller terms.</span></label><div class="field-error">${I("alert-circle", "i-xs")} Confirm you control the rights to submit.</div></div>
        </div>
      </div>`;
  }
  const BODIES = [s1, s2, s3, s4, s5];

  BF.dashPages["release-upload"] = {
    load: () => BF.http.get("/api/seller/catalog"),
    render(q, cat) {
      CAT = cat ?? { labels: [] };
      const saved = BF.store.get("releaseDraft");
      D = saved ? { ...blank(), ...JSON.parse(JSON.stringify(saved)) } : blank();
      if (D.label && !CAT.labels.some((l) => l.id === D.label)) D.label = "";
      D.errors = {};
      return BF.dashShell("release-upload", `<div class="upload" data-rupload>
        ${BF.dashHead("Upload release", `<span class="save-state" data-save aria-live="polite">${I("cloud-check", "i-xs")} ${D.savedAt ? "Draft saved " + esc(D.savedAt) : "Draft autosaves on this device"}</span>`, `<button class="btn btn-ghost btn-sm" data-discard>Discard</button>`)}
        <div data-stepper>${stepper()}</div>
        <form class="card card-pad up-body" novalidate data-body>${BODIES[D.step - 1]()}</form>
        <div class="up-nav"><button class="btn btn-secondary" data-back ${D.step === 1 ? "disabled" : ""}>${I("arrow-left", "i-sm")} Back</button><span class="subtle mono" style="font-size:12px" data-stepno>Step ${D.step} of 5</span><button class="btn btn-primary" data-next>${D.step === 5 ? `${I("upload", "i-sm")} Submit` : `Continue ${I("arrow-right", "i-sm")}`}</button></div>
      </div>`);
    },
    mount(el) {
      const $ = (s) => el.querySelector(s);
      let saveT, pollT, alive = true;
      const paint = (focus) => {
        if (!alive || !$("[data-body]")) return;
        $("[data-stepper]").innerHTML = stepper(); $("[data-body]").innerHTML = BODIES[D.step - 1]();
        $("[data-back]").disabled = D.step === 1; $("[data-stepno]").textContent = `Step ${D.step} of 5`;
        $("[data-next]").innerHTML = D.step === 5 ? `${I("upload", "i-sm")} Submit` : `Continue ${I("arrow-right", "i-sm")}`;
        if (focus) { const h = $("[data-body] h2"); h.tabIndex = -1; h.focus(); }
      };
      const autosave = () => {
        clearTimeout(saveT);
        saveT = setTimeout(() => {
          D.savedAt = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const { errors: _errors, artFile: _artFile, ...p } = D; p.tracks = D.tracks.map((t) => ({ ...t, file: t.file?.done ? t.file : null }));
          BF.store.set("releaseDraft", p);
          const s = $("[data-save]"); if (s) s.innerHTML = `${I("cloud-check", "i-xs")} Draft saved ${D.savedAt}`;
        }, 500);
      };
      const T = (uid) => D.tracks.find((t) => t.uid === uid);

      function upload(uid, file) {
        const t = T(uid); if (!t) return;
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        if (!["wav", "aif", "aiff"].includes(ext)) { t.file = { name: file.name, error: "Unsupported format. Upload a WAV or AIFF master.", pct: 0 }; paint(); return; }
        if (file.size > MAX_MB * 1048576) { t.file = { name: file.name, error: `This file is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_MB} MB.`, pct: 0 }; paint(); return; }
        uploads[uid]?.cancel();
        const f = (t.file = { name: file.name, size: (file.size / 1048576).toFixed(1) + " MB", pct: 0, done: false });
        if (!t.title) t.title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 100);
        paint();
        const up = BF.uploadFile(file, "master_audio", { onProgress: (p) => {
          f.pct = p * 100;
          const row = el.querySelector(`[data-uid="${uid}"]`);
          if (row && D.step === 3) { const n = row.querySelector("[data-pct]"); if (n) n.textContent = Math.round(f.pct) + "%"; const bar = row.querySelector(".progress"); if (bar) { bar.setAttribute("aria-valuenow", Math.round(f.pct)); bar.firstElementChild.style.width = f.pct + "%"; } }
        } });
        uploads[uid] = up;
        up.promise.then((media) => { if (T(uid)?.file !== f) return; f.done = true; f.mediaId = media.id; paint(); autosave(); })
          .catch((err) => { if (T(uid)?.file !== f || err?.name === "AbortError") return; f.error = err.message || "Upload failed."; paint(); })
          .finally(() => { if (uploads[uid] === up) delete uploads[uid]; });
      }
      function uploadArt(file) {
        if (!/image\/(png|jpe?g|webp)/.test(BF.mimeOf(file))) { D.errors = { art: "Use a JPG, PNG or WebP image." }; paint(); return; }
        const f = (D.artFile = { pct: 0, done: false });
        paint();
        BF.uploadFile(file, "artwork", { onProgress: (p) => { f.pct = p * 100; } }).promise.then((media) => {
          if (media.width < 500 || media.height < 500 || Math.abs(media.width - media.height) > media.width * 0.02) { D.artFile = null; D.errors = { art: `The image is ${media.width}×${media.height}. Artwork must be square and at least 500×500.` }; paint(); return; }
          f.done = true; D.art = { id: media.id, url: media.url }; D.errors = {}; paint(); autosave();
        }).catch((err) => { D.artFile = null; D.errors = { art: err.message }; paint(); });
      }

      function validate(step) {
        D.errors = {};
        if (step === 1) {
          if (!D.title.trim()) D.errors.title = "Add a release title.";
          if (D.cat && !/^[A-Z0-9-]{2,16}$/i.test(D.cat.trim())) D.errors.cat = "2–16 letters, numbers or dashes.";
          if (!D.date) D.errors.date = "Pick a release date.";
          if (!D.genre) D.errors.genre = "Choose a genre.";
          if (D.upc && !/^\d{12,13}$/.test(D.upc.trim())) D.errors.upc = "UPC/EAN is 12 or 13 digits.";
        }
        if (step === 2 && D.artFile && !D.artFile.done) D.errors.art = "Wait for the artwork to finish uploading.";
        if (step === 3) {
          const te = {};
          D.tracks.forEach((t) => {
            const e = {};
            if (!t.title.trim()) e.title = "Add a title.";
            if (!t.file?.done) e.file = t.file && !t.file.error ? "Wait for the upload to finish." : "Upload a master for this track.";
            if (t.bpm && !(+t.bpm >= 40 && +t.bpm <= 250)) e.bpm = "40–250";
            if (t.isrc && !ISRC.test(t.isrc.trim())) e.isrc = "Format: CC-XXX-YY-NNNNN";
            if (Object.keys(e).length) te[t.uid] = e;
          });
          if (Object.keys(te).length) D.errors.tracks = te;
        }
        if (step === 4 && !Object.values(D.formats).some(Boolean)) D.errors.formats = "Offer at least one format.";
        if (step === 5 && !D.attest) D.errors.attest = true;
        const bad = Object.keys(D.errors).length > 0;
        if (bad) { paint(); el.querySelector(".has-error input, .has-error select, .slot.is-error input, [data-rattest]")?.focus(); ui.toast({ kind: "error", title: "A few things need attention", desc: step === 3 ? "Check the highlighted tracks." : "Check the highlighted fields." }); }
        return !bad;
      }

      async function submit(btn) {
        btn.disabled = true; btn.insertAdjacentHTML("beforeend", '<span class="spinner"></span>');
        try {
          const r = await BF.http.post("/api/seller/releases", {
            title: D.title.trim(), type: D.type, genre: D.genre, release_date: D.date, formats: Object.keys(D.formats).filter((f) => D.formats[f]),
            label_id: D.label || null, cat: D.cat.trim() || null, upc: D.upc.trim() || null, description: D.description, publish: D.publish,
            artwork_media_id: D.art?.id ?? null, art: D.art ? null : { style: D.artStyle, palette: D.artPalette },
            tracks: D.tracks.map((t) => ({ title: t.title.trim(), mix: t.mix.trim() || "Original Mix", bpm: t.bpm ? Number(t.bpm) : null, key: t.key || null, energy: t.energy ? Number(t.energy) : null, isrc: t.isrc.trim() || null, explicit: t.explicit, master_media_id: t.file.mediaId })),
          });
          BF.store.set("releaseDraft", null);
          el.querySelector(".up-nav").remove(); $("[data-stepper]").innerHTML = ""; $("[data-save]").textContent = "";
          const body = $("[data-body]");
          body.innerHTML = ui.empty({ icon: "wave", title: "Processing your masters…", body: `Analysing ${r.release.tracks.length} track${r.release.tracks.length === 1 ? "" : "s"} (tempo, beat grid, key) and building previews.` });
          const poll = async () => {
            if (!alive) return;
            const cat = await BF.http.get("/api/seller/catalog").catch(() => null);
            const rel = cat?.releases.find((x) => x.id === r.release.id);
            if (!rel || rel.status === "processing") { pollT = setTimeout(poll, 2500); return; }
            await BF.refreshCatalog();
            const failed = rel.tracks.filter((t) => t.audio?.status === "failed");
            body.innerHTML = ui.empty({ kind: failed.length ? "error" : undefined, icon: failed.length ? "alert" : "check",
              title: failed.length ? `${failed.length} track${failed.length === 1 ? "" : "s"} couldn’t be processed` : rel.status === "published" ? "Your release is live" : "Saved as a draft",
              body: failed.length ? failed.map((t) => `${esc(t.title)}: ${esc(t.audio.error ?? "decode failed")}`).join("<br>") + "<br>The release stays a draft." : rel.tracks.map((t) => `${esc(t.title)} · ${t.bpm} BPM · ${esc(t.key)}`).join("<br>"),
              actions: `${rel.status === "published" ? `<a class="btn btn-primary" href="#/electronic/release/${rel.id}">View release</a>` : ""}<a class="btn btn-secondary" href="#/dashboard/releases">Go to Releases</a>` });
          };
          poll();
        } catch (err) {
          btn.disabled = false; btn.querySelector(".spinner")?.remove();
          ui.toast({ kind: "error", title: "Couldn’t submit the release", desc: esc(err.message) });
        }
      }

      el.addEventListener("click", async (e) => {
        const t = e.target;
        const nx = t.closest("[data-next]");
        if (nx) { e.preventDefault(); if (!validate(D.step)) return; if (D.step < 5) { D.step++; paint(true); autosave(); window.scrollTo({ top: 0 }); } else submit(nx); return; }
        if (t.closest("[data-back]")) { e.preventDefault(); D.step--; paint(true); }
        const go = t.closest("[data-goto]"); if (go && !go.disabled) { e.preventDefault(); D.step = +go.dataset.goto; paint(true); }
        if (t.closest("[data-discard]") && await ui.confirm({ title: "Discard this release?", body: "The draft on this device is cleared. Files you already uploaded stay private and are never published.", confirmLabel: "Discard", danger: true })) {
          Object.values(uploads).forEach((u) => u.cancel()); BF.store.set("releaseDraft", null); D = blank(); D.errors = {}; paint(true); $("[data-save]").innerHTML = `${I("cloud-check", "i-xs")} Draft autosaves on this device`;
        }
        const rt = t.closest("[data-rtype]"); if (rt) { D.type = rt.dataset.rtype; paint(); autosave(); }
        const as = t.closest("[data-rastyle]"); if (as) { D.art = null; D.artFile = null; D.artStyle = as.dataset.rastyle; paint(); autosave(); }
        if (t.closest("[data-tadd]") && D.tracks.length < 40) { D.tracks.push(newTrack()); paint(); el.querySelector(".ru-track:last-child input[data-t=title]")?.focus(); autosave(); }
        const row = t.closest("[data-uid]");
        if (row && t.closest("[data-trm]")) { uploads[row.dataset.uid]?.cancel(); D.tracks = D.tracks.filter((x) => x.uid !== row.dataset.uid); paint(); autosave(); }
        if (row && t.closest("[data-tmove]")) { const i = D.tracks.findIndex((x) => x.uid === row.dataset.uid); const j = i + +t.closest("[data-tmove]").dataset.tmove; [D.tracks[i], D.tracks[j]] = [D.tracks[j], D.tracks[i]]; paint(); autosave(); }
        if (row && t.closest("[data-tretry]")) { e.preventDefault(); row.querySelector("[data-tfile]")?.click(); }
      });
      el.addEventListener("input", (e) => {
        const b = e.target.dataset.b; if (b && e.target.tagName !== "SELECT") { D[b] = e.target.value; e.target.closest(".field")?.classList.remove("has-error"); if (b === "description") el.querySelector("[data-desc-count]").textContent = `${D.description.length}/1000`; autosave(); }
        const tk = e.target.dataset.t; const row = e.target.closest("[data-uid]");
        if (tk && row && e.target.type !== "checkbox" && e.target.tagName !== "SELECT") { T(row.dataset.uid)[tk] = e.target.value; e.target.closest(".field")?.classList.remove("has-error"); if (tk === "title" || tk === "mix") { const tr = T(row.dataset.uid); row.querySelector("header b").innerHTML = `${esc(tr.title || "Untitled track")} <span class="t-mix">${esc(tr.mix)}</span>`; } autosave(); }
      });
      el.addEventListener("change", (e) => {
        const t = e.target; const row = t.closest("[data-uid]");
        if (t.dataset.b && t.tagName === "SELECT") { D[t.dataset.b] = t.value; autosave(); }
        if (t.matches("[data-tfile]") && t.files[0]) { upload(row.dataset.uid, t.files[0]); t.value = ""; }
        if (t.dataset.t === "explicit") { T(row.dataset.uid).explicit = t.checked; autosave(); }
        if (t.dataset.t === "key") { T(row.dataset.uid).key = t.value; paint(); autosave(); }
        if (t.dataset.fmt) { D.formats[t.dataset.fmt] = t.checked; paint(); autosave(); }
        if (t.name === "rpub") { D.publish = t.value === "true"; autosave(); }
        if (t.matches("[data-rattest]")) { D.attest = t.checked; t.closest(".field").classList.remove("has-error"); }
        if (t.name === "rpal") { D.art = null; D.artFile = null; D.artPalette = t.value; paint(); autosave(); }
        if (t.matches("[data-rartfile]") && t.files[0]) { uploadArt(t.files[0]); t.value = ""; }
      });
      el.addEventListener("dragover", (e) => { const dz = e.target.closest("[data-rdrop]"); if (dz) { e.preventDefault(); dz.classList.add("is-over"); } });
      el.addEventListener("dragleave", (e) => e.target.closest("[data-rdrop]")?.classList.remove("is-over"));
      el.addEventListener("drop", (e) => {
        const dz = e.target.closest("[data-rdrop]"); if (!dz) return; e.preventDefault(); dz.classList.remove("is-over");
        const f = e.dataTransfer.files[0]; if (!f) return;
        dz.dataset.rdrop === "track" ? upload(dz.closest("[data-uid]").dataset.uid, f) : uploadArt(f);
      });
      const beforeUnload = (e) => { if (Object.keys(uploads).length) { e.preventDefault(); e.returnValue = ""; } };
      window.addEventListener("beforeunload", beforeUnload);
      return () => { alive = false; clearTimeout(saveT); clearTimeout(pollT); window.removeEventListener("beforeunload", beforeUnload); };
    },
  };
})();
