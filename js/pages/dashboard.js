/* Seller dashboard (shared by both stores). Every number comes from the server:
   /api/seller/dashboard (orders, revenue, plays, customers, balances), /api/seller/catalog,
   /api/creator/* (withdrawals, payout methods), /api/conversations, /api/auth/*.
   Sections register renderers in BF.dashSections, data loaders in BF.dashLoaders,
   and behaviour in BF.dashMounts; full-page flows (uploads) register in BF.dashPages. */
(function () {
  const I = BF.icon, ui = BF.ui, C = BF.chart, esc = BF.esc;

  const NAV = [
    ["_", "Beats Store"],
    ["overview", "Overview", "dashboard"], ["beats", "My Beats", "music"], ["upload", "Upload Beat", "cloud-upload"],
    ["orders", "Orders", "orders"], ["customers", "Customers", "users"], ["licenses", "Licenses", "license"],
    ["analytics", "Analytics", "chart"],
    ["_", "Electronic Music Store"],
    ["music", "Music Analytics", "trend-up"], ["releases", "Releases", "disc"], ["release-upload", "Upload Release", "cloud-upload"], ["genres", "Genres (admin)", "tag"],
    ["_", "Account"],
    ["earnings", "Earnings", "wallet"], ["storefront", "Storefront", "store"],
    ["messages", "Messages", "message"], ["settings", "Settings", "settings"],
  ];
  BF.dashSections = BF.dashSections || {};
  BF.dashPages = BF.dashPages || {};
  BF.dashMounts = BF.dashMounts || {};
  BF.dashLoaders = BF.dashLoaders || {};
  BF.DASH_NAV = NAV;
  const cents = (c) => BF.money((c ?? 0) / 100);
  const cents0 = (c) => BF.money0((c ?? 0) / 100);
  const short = (c) => { const v = (c ?? 0) / 100; return "$" + (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : Math.round(v)); };
  const pct = (a, b) => (b ? `${a >= b ? "+" : "−"}${Math.abs(((a - b) / b) * 100).toFixed(1)}%` : a ? "new" : "—");
  const day = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const seller = () => BF.store.get("seller") ?? {};
  const me = () => BF.store.get("session").user;
  const statusBadge = (s) => `<span class="badge ${s === "refunded" || s === "failed" || s === "removed" ? "badge-danger" : s === "draft" || s === "processing" ? "" : s === "sold_exclusive" ? "badge-cyan" : "badge-success"}"><span class="dot"></span>${esc({ paid: "Paid", refunded: "Refunded", published: "Published", draft: "Draft", processing: "Processing", removed: "Removed", sold_exclusive: "Sold exclusively" }[s] ?? s)}</span>`;
  BF.dashStatus = statusBadge;
  BF.dashCents = cents;

  BF.dashShell = (section, body) => {
    const u = me(), p = seller().producer ? BF.producerById[seller().producer.id] : null;
    return `<div class="dash">
      <aside class="dash-side" aria-label="Dashboard">
        <div class="dash-me"><div class="avatar sm"><img src="${p?.avatar ?? u?.avatar ?? BF.avatar((u?.id ?? "") + (u?.name ?? ""), "violet")}" alt=""></div><div style="min-width:0"><div class="truncate" style="font-weight:650;font-size:14px;display:flex;gap:4px;align-items:center">${esc(p?.name ?? u?.name ?? "")}${p?.verified ? BF.verifiedSeal() : ""}</div>${p ? `<a class="subtle" style="font-size:12.5px" href="#/beats/producer/${p.handle}">View storefront ↗</a>` : `<span class="subtle" style="font-size:12.5px">@${esc(u?.handle ?? "")}</span>`}</div></div>
        <nav class="dash-nav">${NAV.map(([k, l, ic]) => k === "_" ? `<span class="dash-nav-label">${l}</span>` : `<a href="#/dashboard${k === "overview" ? "" : "/" + k}" ${k === section ? 'aria-current="page"' : ""}>${I(ic, "i-sm")}<span>${l}</span></a>`).join("")}</nav>
      </aside>
      <div class="dash-main">${body}</div>
    </div>`;
  };
  const head = (title, sub, actions = "") => `<header class="dash-head"><div><h1 class="h2">${title}</h1>${sub ? `<p class="muted" style="font-size:14px;margin-top:4px">${sub}</p>` : ""}</div><div class="dash-head-actions">${actions}</div></header>`;
  BF.dashHead = head;
  const noStore = (what, href, label) => ui.empty({ icon: "store", title: `No ${what} yet`, body: "Your storefront is created with your first upload. Everything here is calculated from real orders and plays.", actions: `<a class="btn btn-primary" href="${href}">${label}</a>` });

  /* ---------- Data ---------- */
  const load = {
    beatsDash: () => BF.http.get("/api/seller/dashboard?marketplace=beats"),
    catalog: () => BF.http.get("/api/seller/catalog"),
  };
  Object.assign(BF.dashLoaders, {
    overview: async () => { const [dash, cat] = await Promise.all([load.beatsDash(), load.catalog()]); return { dash, cat }; },
    beats: async () => ({ cat: await load.catalog() }),
    orders: async () => ({ dash: await load.beatsDash() }),
    customers: async () => ({ dash: await load.beatsDash() }),
    analytics: async () => { const [dash, cat] = await Promise.all([load.beatsDash(), load.catalog()]); return { dash, cat }; },
    earnings: async () => { const [beats, music, wd] = await Promise.all([load.beatsDash(), BF.http.get("/api/seller/dashboard?marketplace=electronic"), BF.http.get("/api/creator/withdrawals")]); return { beats, music, withdrawals: wd.items }; },
    storefront: async () => ({ cat: await load.catalog() }),
    messages: async () => ({ conv: await BF.http.get("/api/conversations") }),
    settings: async (q) => {
      const tab = q.tab || "profile";
      if (tab === "notifications") return { prefs: await BF.http.get("/api/me/notification-prefs") };
      if (tab === "security") return { sessions: await BF.http.get("/api/auth/sessions") };
      if (tab === "payouts") return { methods: await BF.http.get("/api/creator/payout-methods") };
      return { me: (await BF.http.get("/api/me")).user };
    },
  });

  /* ---------- OVERVIEW ---------- */
  function kpiCards(dash, extra = []) {
    const k = dash.kpis, d30 = dash.daily_30;
    const cards = [
      ["Net revenue", cents0(k.net_cents_30d), pct(k.net_cents_30d, k.net_cents_prev_30d), k.net_cents_30d >= k.net_cents_prev_30d, d30.map((d) => d.net_cents), "vs. previous 30 days"],
      ["Units sold", String(k.units_30d), `${k.orders_30d} orders`, true, d30.map((d) => d.net_cents), "last 30 days"],
      ["Preview plays", BF.num(k.plays_30d), "counted plays", true, d30.map((d) => d.plays), "last 30 days"],
      ["Conversion", k.conversion_pct == null ? "—" : `${k.conversion_pct}%`, "units ÷ plays", true, d30.map((d) => d.plays), "last 30 days"],
      ...extra,
    ];
    return `<div class="kpi-grid">${cards.map(([l, v, d, up, series, sub]) => `<div class="kpi card"><span class="kpi-label">${l}</span><span class="kpi-value tnum">${v}</span>
      <span class="kpi-delta ${up ? "up" : "down"}">${esc(d)} <span class="subtle">${sub}</span></span>${series.some((x) => x) ? C.spark(series, up ? "var(--accent-text)" : "var(--n-400)") : ""}</div>`).join("")}</div>`;
  }
  function overview(q, { dash, cat }) {
    if (!cat.producer) return head("Overview", "") + noStore("beats", "#/dashboard/upload", "Upload your first beat");
    const top = dash.top_items[0];
    const topBeat = top && BF.beatById[top.item_id];
    return head("Overview", `Beats Store · last 30 days · ${new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })}`, `<a class="btn btn-primary btn-sm" href="#/dashboard/upload">${I("plus", "i-sm")} Upload beat</a>`) + `
      ${kpiCards(dash)}
      <div class="dash-grid">
        <section class="card span-2">
          <div class="card-head"><h2>Net revenue</h2><div style="display:flex;gap:8px;align-items:center"><div class="segmented" role="group" aria-label="Revenue range"><button data-rev="30" aria-pressed="true">30 days</button><button data-rev="12" aria-pressed="false">12 months</button></div><button class="btn btn-ghost btn-sm" data-table-toggle="rev" aria-pressed="false">${I("list", "i-sm")}<span class="hide-sm">Table</span></button></div></div>
          <div class="card-pad" style="padding-top:12px"><div class="chart-big"><span class="display tnum" data-rev-total style="font-size:32px"></span><span class="subtle" data-rev-sub style="font-size:13px"></span></div><div id="rev-chart"></div><div data-table="rev" hidden></div></div>
        </section>
        <section class="card top-beat" ${topBeat ? `data-queue="${topBeat.id}" data-beat-card="${topBeat.id}"` : ""}>
          <div class="card-head"><h2>Top seller</h2>${top ? `<span class="badge badge-accent">${I("fire", "i-xs")} #1</span>` : ""}</div>
          <div class="card-pad">${top ? `
            ${topBeat ? `<div class="tb-art"><img src="${topBeat.art}" alt=""><div class="tb-play">${ui.playBtn(topBeat.id, "accent")}</div></div>` : ""}
            <a class="h3" href="#/beats/${top.kind}/${top.item_id}" style="display:block;margin-top:14px">${esc(top.title)}</a>
            <dl class="mini-stats"><div><dt>Units</dt><dd class="tnum">${top.units}</dd></div><div><dt>Net</dt><dd class="tnum">${cents0(top.net_cents)}</dd></div><div><dt>Plays</dt><dd class="tnum">${topBeat ? BF.num(topBeat.plays) : "—"}</dd></div></dl>` : `<p class="muted">No sales yet.</p>`}
          </div>
        </section>
        <section class="card span-2"><div class="card-head"><h2>Beat performance</h2><span class="subtle" style="font-size:13px">Preview plays (all time)</span></div><div class="card-pad"><div id="perf-chart"></div></div></section>
        <section class="card"><div class="card-head"><h2>License mix</h2><span class="subtle" style="font-size:13px">Share of licenses sold</span></div><div class="card-pad"><div id="mix-chart"></div></div></section>
        <section class="card span-3"><div class="card-head"><h2>Recent orders</h2><a class="link" style="font-size:13px" href="#/dashboard/orders">View all</a></div>${ordersTable(dash.recent_orders.slice(0, 6), true)}</section>
      </div>`;
  }

  function ordersTable(orders, compact) {
    if (!orders.length) return ui.empty({ icon: "orders", title: "No orders yet", body: "Sales appear here as soon as a buyer’s payment clears." });
    return `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Order</th><th scope="col">Item</th><th scope="col">${compact ? "" : "License / format"}</th><th scope="col" class="${compact ? "hide-sm" : ""}">Buyer</th><th scope="col" class="hide-sm">Date</th><th scope="col">Status</th><th scope="col" class="num">Paid</th><th scope="col" class="num hide-sm">Your net</th></tr></thead>
      <tbody>${orders.map((o) => { const it = BF.item(o.item_id); return `<tr><td class="mono" style="font-size:12.5px">${esc(o.order_id)}</td>
        <td><div class="cell-beat" style="min-width:160px">${it ? `<div class="art sm" style="width:32px;height:32px"><img src="${it.art}" alt=""></div>` : ""}<span class="strong" style="color:var(--text)">${esc(o.title.split(" — ")[0].split(" · ")[0])}</span></div></td>
        <td>${o.license_id ? esc(BF.licenseById[o.license_id]?.short ?? o.license_id) : esc(o.format ?? "")}</td><td class="${compact ? "hide-sm" : ""}">${esc(o.buyer)}</td><td class="hide-sm">${o.date ? day(o.date) : "—"}</td>
        <td>${statusBadge(o.status)}</td><td class="num mono strong">${cents(o.paid_cents)}</td><td class="num mono hide-sm">${cents(o.net_cents)}</td></tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ---------- MY BEATS ---------- */
  function beatsSection(q, { cat }) {
    const draft = BF.store.get("uploadDraft");
    const rows = cat.beats;
    return head("My Beats", `${rows.length} beat${rows.length === 1 ? "" : "s"} in your catalog`, `<a class="btn btn-primary btn-sm" href="#/dashboard/upload">${I("plus", "i-sm")} Upload beat</a>`) + `
      ${draft ? `<div class="notice warning" style="margin-bottom:16px">${I("edit", "i-sm")}<div><strong>Draft in progress:</strong> “${esc(draft.title || "Untitled beat")}” — step ${draft.step} of 5. <a class="link" href="#/dashboard/upload">Continue</a></div></div>` : ""}
      ${!rows.length ? noStore("beats", "#/dashboard/upload", "Upload your first beat") : `
      <div class="filter-row"><div class="segmented" role="group" aria-label="Status filter">${[["", "All"], ["published", "Published"], ["draft", "Drafts"], ["processing", "Processing"], ["sold_exclusive", "Sold exclusively"], ["removed", "Removed"]].map(([v, l], i) => `<button data-bstatus="${v}" aria-pressed="${i === 0}">${l}</button>`).join("")}</div>
        <div class="input-group" style="max-width:280px;flex:1">${I("search", "i-sm")}<label class="sr-only" for="mb-q">Search your beats</label><input class="input input-sm" id="mb-q" placeholder="Search your beats"></div></div>
      <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Beat</th><th scope="col">Status</th><th scope="col">Audio</th><th scope="col" class="num">Plays</th><th scope="col" class="num">Sales</th><th scope="col" class="num hide-sm">From</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody data-mb-body>${rows.map((r) => { const b = BF.beatById[r.id]; const a = r.audio; return `<tr data-status="${r.status}" data-title="${esc(r.title.toLowerCase())}" ${b ? `data-beat-card="${b.id}"` : ""}>
          <td><div class="cell-beat">${b ? ui.playBtn(b.id, "sm") : ""}${b ? `<div class="art sm"><img src="${b.art}" alt=""></div>` : ""}<div><a class="strong" style="color:var(--text);font-weight:600" href="#/beats/beat/${r.id}">${esc(r.title)}</a><div class="subtle mono" style="font-size:12px">${r.bpm} BPM · ${esc(r.key)} · ${esc(BF.genreById[r.genre]?.name ?? r.genre)}</div></div></div></td>
          <td>${statusBadge(r.status)}</td>
          <td>${!a ? "—" : a.status === "ready" ? `<span class="subtle mono" style="font-size:12px">${a.analysis?.bpm ? `${a.analysis.bpm} BPM detected` : "Analysed"}${a.duration_ms ? ` · ${BF.time(a.duration_ms / 1000)}` : ""}</span>` : a.status === "failed" ? `<span class="badge badge-danger" title="${esc(a.error ?? "")}">Failed</span>` : `<span class="badge">Analysing…</span>`}</td>
          <td class="num mono">${b ? BF.num(b.plays) : "—"}</td><td class="num mono">${b ? b.sales : "—"}</td><td class="num mono hide-sm">${b ? BF.money(BF.basePrice(b)) : "—"}</td>
          <td class="num"><div class="dropdown" style="display:inline-block"><button class="icon-btn sm" data-dropdown aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${esc(r.title)}">${I("more", "i-sm")}</button><div class="menu" role="menu">
            ${r.status === "published" ? `<button class="menu-item" role="menuitem" data-beat-status="draft" data-id="${r.id}">${I("eye-off", "i-sm")} Unpublish (draft)</button>` : r.status === "draft" && a?.status === "ready" ? `<button class="menu-item" role="menuitem" data-beat-status="published" data-id="${r.id}">${I("eye", "i-sm")} Publish</button>` : ""}
            <button class="menu-item" role="menuitem" data-beat-price="${r.id}" data-mult="${r.price_mult}">${I("tag", "i-sm")} Change price</button>
            <div class="menu-sep"></div>${r.status !== "removed" && r.status !== "sold_exclusive" ? `<button class="menu-item danger" role="menuitem" data-beat-status="removed" data-id="${r.id}">${I("trash", "i-sm")} Remove from store</button>` : ""}</div></div></td></tr>`; }).join("")}</tbody></table></div></div>`}`;
  }

  /* ---------- ORDERS ---------- */
  function ordersSection(q, { dash }) {
    return head("Orders", `${dash.kpis.lifetime_units} license${dash.kpis.lifetime_units === 1 ? "" : "s"} sold · ${cents0(dash.kpis.lifetime_net_cents)} net lifetime`, `<button class="btn btn-secondary btn-sm" data-export="orders">${I("download", "i-sm")} Export CSV</button>`) + `
      <div class="filter-row"><select class="select input-sm" style="width:auto" aria-label="License filter" data-olic><option value="">All licenses</option>${BF.LICENSES.map((l) => `<option value="${l.id}">${l.name}</option>`).join("")}</select></div>
      <div class="card" data-orders>${ordersTable(dash.recent_orders)}</div>
      <p class="hint" style="margin-top:10px">Shows your 25 most recent sales. Net = paid − platform commission. Sales clear to your available balance after the hold period.</p>`;
  }

  /* ---------- CUSTOMERS ---------- */
  function customersSection(q, { dash }) {
    return head("Customers", "Artists who’ve licensed your beats") + (dash.customers.length ? `
      <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Buyer</th><th scope="col" class="num">Orders</th><th scope="col" class="num">Spent with you</th><th scope="col" class="hide-sm">Last purchase</th></tr></thead>
      <tbody>${dash.customers.map((c) => `<tr><td><div class="cell-beat"><div class="avatar sm"><img src="${BF.avatar(c.name, "violet")}" alt=""></div><span class="strong" style="color:var(--text)">${esc(c.name)}</span>${c.username ? `<span class="subtle">@${esc(c.username)}</span>` : ""}</div></td><td class="num mono">${c.orders}</td><td class="num mono">${cents(c.spent_cents)}</td><td class="hide-sm">${day(c.last)}</td></tr>`).join("")}</tbody></table></div></div>`
      : ui.empty({ icon: "users", title: "No customers yet", body: "Buyers appear here after their first purchase." }));
  }

  /* ---------- LICENSES (platform templates; your price is set per beat) ---------- */
  function licensesSection() {
    return head("License packages", "The license tiers buyers choose from. Your price for each tier = the tier’s base price × the beat’s price multiplier.") + `
      <div class="notice info" style="margin-bottom:20px">${I("info", "i-sm")}<div>License templates are managed by the platform so every agreement is consistent and reviewed. ${BF.brand.displayName} generates a license agreement from them for each order. Change a beat’s price multiplier from <a class="link" href="#/dashboard/beats">My Beats</a>.</div></div>
      <div class="lic-editor">${BF.LICENSES.map((l) => `<section class="card lic-edit"><div class="card-head"><div><h2>${esc(l.name)}</h2><span class="subtle" style="font-size:12.5px">${esc(l.files)}</span></div><span class="mono">${BF.money(l.price)} base</span></div>
        <div class="card-pad"><dl class="kv compact">${(l.terms ?? []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v).replace("{producer}", "you"))}</dd></div>`).join("")}</dl></div></section>`).join("")}</div>`;
  }

  /* ---------- EARNINGS ---------- */
  function earningsSection(q, { beats, music, withdrawals }) {
    const b = beats.balances ?? {};
    return head("Earnings", "Store sales, tips and gifts share one balance. Earnings clear after the hold period, then you can withdraw them.", `<a class="btn btn-primary btn-sm" href="#/social/studio">${I("wallet", "i-sm")} Withdraw in Creator Studio</a>`) + `
      <div class="earn-grid">
        <div class="card card-pad balance"><span class="kpi-label">Available</span><span class="display tnum" style="font-size:44px">${cents(b.available_cents)}</span><span class="subtle" style="font-size:13px">Ready to withdraw${BF.env?.payouts?.test_mode ? " · payouts run in the sandbox" : ""}</span></div>
        <div class="card card-pad"><span class="kpi-label">Pending (clearing)</span><span class="display tnum" style="font-size:32px">${cents(b.pending_cents)}</span><p class="hint" style="margin-top:6px">New earnings are held for refunds and chargebacks first.</p></div>
        <div class="card card-pad"><span class="kpi-label">Lifetime earnings</span><span class="display tnum" style="font-size:32px">${cents(b.lifetime_cents)}</span><p class="hint" style="margin-top:6px">${beats.kpis.lifetime_units} beat licenses · ${music.kpis.lifetime_units} music downloads</p></div>
      </div>
      <div class="dash-grid" style="margin-top:20px">
        <section class="card span-3"><div class="card-head"><h2>Monthly net revenue</h2><span class="subtle" style="font-size:13px">Both stores · last 12 months</span></div><div class="card-pad"><div id="earn-cols"></div></div></section>
        <section class="card span-3"><div class="card-head"><h2>Withdrawals</h2></div>
          ${withdrawals.length ? `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Requested</th><th scope="col">Status</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${withdrawals.map((w) => `<tr><td>${day(w.created_at)}</td><td>${statusBadge(w.status)}</td><td class="num mono strong">${cents(w.amount_cents)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card-pad">${ui.empty({ icon: "wallet", title: "No withdrawals yet", body: "Withdraw available earnings from Creator Studio (email confirmation required)." })}</div>`}</section>
      </div>
      <script type="application/json" id="earn-data">${JSON.stringify(beats.revenue_12m.map((m, i) => ({ label: m.label, value: m.net_cents + (music.revenue_12m[i]?.net_cents ?? 0) })))}</script>`;
  }

  /* ---------- ANALYTICS ---------- */
  function analyticsSection(q, { dash }) {
    return head("Analytics", "Measured from counted preview plays and paid orders") + `
      ${kpiCards(dash)}
      <div class="dash-grid">
        <section class="card span-3"><div class="card-head"><h2>Daily preview plays</h2><button class="btn btn-ghost btn-sm" data-table-toggle="plays" aria-pressed="false">${I("list", "i-sm")} Table</button></div><div class="card-pad"><div id="plays-chart"></div><div data-table="plays" hidden></div></div></section>
        <section class="card span-2"><div class="card-head"><h2>Top items by net revenue</h2></div><div class="card-pad"><div id="top-chart"></div></div></section>
        <section class="card"><div class="card-head"><h2>Buyer countries</h2><span class="subtle" style="font-size:13px">From checkout</span></div><div class="card-pad"><div id="countries"></div></div></section>
      </div>`;
  }

  /* ---------- STOREFRONT ---------- */
  function storefrontSection(q, { cat }) {
    if (!cat.producer) return head("Storefront", "") + noStore("storefront", "#/dashboard/upload", "Upload your first beat");
    const p = BF.producerById[cat.producer.id] ?? { ...cat.producer, bio: "", socials: {}, palette: "violet" };
    const pals = ["violet", "ice", "gold", "blood", "rose", "chrome", "acid", "dusk", "ember", "jade", "ocean", "mono"].filter((x) => BF.palettes[x]);
    return head("Storefront", "How artists see your store", `<a class="btn btn-secondary btn-sm" href="#/beats/producer/${p.handle}">${I("eye", "i-sm")} View</a><button class="btn btn-primary btn-sm" data-save-store>Publish changes</button>`) + `
      <div class="store-edit">
        <form class="card card-pad stack-16" data-store-form>
          <div class="field"><label class="label" for="sf-name">Display name</label><input class="input" id="sf-name" value="${esc(p.name)}" maxlength="60"></div>
          <div class="field"><span class="label">Store URL</span><p class="mono subtle">${BF.brand.domain}/beats/producer/${esc(p.handle)}</p><span class="hint">Your handle is permanent so links to your beats never break.</span></div>
          <div class="field"><label class="label" for="sf-loc">Location</label><input class="input" id="sf-loc" value="${esc(p.location ?? "")}" maxlength="60"></div>
          <div class="field"><label class="label" for="sf-bio">Bio <span class="opt" data-bio-count>${(p.bio ?? "").length}/400</span></label><textarea class="textarea" id="sf-bio" maxlength="400">${esc(p.bio ?? "")}</textarea></div>
          <div class="field"><span class="label">Theme color</span><div class="swatches" role="radiogroup" aria-label="Theme color">${pals.map((x) => `<label class="swatch"><input type="radio" name="sf-pal" value="${x}" ${x === p.palette ? "checked" : ""}><span style="background:${BF.palettes[x][2]}" aria-hidden="true"></span><span class="sr-only">${x}</span></label>`).join("")}</div></div>
          <div class="form-grid"><div class="field"><label class="label" for="sf-ig">Instagram</label><input class="input" id="sf-ig" value="${esc(p.socials?.instagram ?? "")}" maxlength="60"></div><div class="field"><label class="label" for="sf-yt">YouTube</label><input class="input" id="sf-yt" value="${esc(p.socials?.youtube ?? "")}" maxlength="60"></div><div class="field span-2"><label class="label" for="sf-site">Website</label><input class="input" id="sf-site" value="${esc(p.socials?.site ?? "")}" maxlength="100" placeholder="example.com"></div></div>
        </form>
        <div class="store-preview card" aria-label="Preview"><img class="sp-banner" src="${p.banner}" alt="" data-sp-banner><div class="sp-body"><div class="avatar lg" style="margin-top:-40px;border:3px solid var(--surface-1)"><img src="${p.avatar}" alt=""></div><div class="h3" data-sp-name style="margin-top:10px;display:flex;gap:5px;align-items:center">${esc(p.name)}${p.verified ? BF.verifiedSeal() : ""}</div><p class="muted" data-sp-bio style="font-size:13px;margin-top:6px">${esc(p.bio ?? "")}</p><div class="mini-arts" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:14px">${(p.beatIds ?? []).slice(0, 3).map((id) => `<div class="art"><img src="${BF.beatById[id]?.art}" alt=""></div>`).join("")}</div></div></div>
      </div>`;
  }

  /* ---------- MESSAGES (TUNIBEAT Messages: DMs with buyers and sellers) ---------- */
  function messagesSection(q, { conv }) {
    const items = conv.items ?? conv.conversations ?? [];
    return head("Messages", "Offers, custom requests and license questions from buyers", `<a class="btn btn-secondary btn-sm" href="#/social/messages">${I("message", "i-sm")} Open Messages</a>`) + (items.length ? `
      <div class="card"><ul class="inbox-list" role="list">${items.slice(0, 20).map((c) => { const other = c.members?.find((m) => m.id !== me()?.id) ?? c.members?.[0]; const unread = c.unread_count ?? (c.unread ? 1 : 0); return `<li><a class="inbox-item ${unread ? "unread" : ""}" href="#/social/messages/${c.id}"><div class="avatar sm"><img src="${other?.avatar_url || BF.avatar((other?.id ?? c.id) + (other?.display_name ?? ""), "violet")}" alt=""></div><div style="min-width:0;flex:1;text-align:left"><div style="display:flex;justify-content:space-between;gap:8px"><b class="truncate">${esc(c.title || other?.display_name || "Conversation")}</b><span class="subtle mono" style="font-size:11px">${c.last_message_at ? day(c.last_message_at) : ""}</span></div><div class="subtle truncate" style="font-size:13px">${esc(c.last_message?.body ?? c.preview ?? "")}</div></div></a></li>`; }).join("")}</ul></div>`
      : ui.empty({ icon: "message", title: "No messages yet", body: "When buyers message you about a beat or a custom request, conversations appear here." }));
  }

  /* ---------- SETTINGS ---------- */
  function settingsSection(q, data) {
    const tab = q.tab || "profile";
    const tabs = [["profile", "Account"], ["security", "Security"], ["notifications", "Notifications"], ["payouts", "Payouts"], ["verification", "Verification"]];
    const u = data.me ?? me();
    const producer = seller().producer ? BF.producerById[seller().producer.id] : null;
    const panels = {
      profile: () => `<form class="form-grid" style="max-width:640px" data-account-form>
          <div class="field"><label class="label" for="st-n">Display name</label><input class="input" id="st-n" value="${esc(u.display_name ?? u.name)}" maxlength="50"></div>
          <div class="field"><label class="label" for="st-e">Email</label><input class="input" id="st-e" value="${esc(u.email ?? "")}" disabled><span class="hint">${u.email_verified ?? u.emailVerified ? `${I("check", "i-xs")} Verified` : `Not verified · <a class="link" href="#/verify">Verify now</a>`}</span></div>
          <div class="span-2"><button class="btn btn-primary btn-sm">Save</button></div></form>`,
      security: () => `<div class="stack-16" style="max-width:620px">
          <form class="card card-pad stack-16" data-pw-form><b>Change password</b>
            <div class="field"><label class="label" for="pw-cur">Current password</label><input class="input" id="pw-cur" type="password" autocomplete="current-password" maxlength="200"></div>
            <div class="field"><label class="label" for="pw-new">New password</label><input class="input" id="pw-new" type="password" autocomplete="new-password" minlength="10" maxlength="200"><span class="hint">At least 10 characters. Other devices are signed out.</span></div>
            <div><button class="btn btn-primary btn-sm">Change password</button></div></form>
          <div class="card"><div class="card-head"><h2>Signed-in devices</h2><button class="btn btn-ghost btn-sm" data-logout-others>Sign out other devices</button></div>
            <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Device</th><th scope="col">Last active</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${(data.sessions?.sessions ?? []).map((s) => `<tr><td style="white-space:normal">${esc((s.user_agent || "Unknown device").slice(0, 80))}${s.current ? ` <span class="badge badge-success">This device</span>` : ""}</td><td>${new Date(s.last_seen).toLocaleString()}</td><td class="num">${s.current ? "" : `<button class="btn btn-ghost btn-sm" data-revoke="${s.id}">Sign out</button>`}</td></tr>`).join("")}</tbody></table></div></div>
        </div>`,
      notifications: () => `<form class="stack-16" style="max-width:560px" data-prefs>${(data.prefs?.items ?? []).map((p) => `<label class="switch" style="justify-content:space-between;width:100%"><span>${esc(p.label)}${p.locked ? ` <span class="subtle" style="font-size:12px">(always on)</span>` : ""}</span><input type="checkbox" data-cat="${p.category}" ${p.in_app ? "checked" : ""} ${p.locked ? "disabled" : ""}></label>`).join("")}</form>`,
      payouts: () => { const m = data.methods ?? { items: [], provider: {} }; return `<div class="stack-16" style="max-width:560px">${m.items.length ? m.items.map((x) => `<div class="card card-pad" style="display:flex;gap:14px;align-items:center">${I("wallet", "i-lg")}<div style="flex:1"><b>${esc(x.label)}</b><div class="subtle" style="font-size:13px">${esc(x.provider)} · ${esc(x.status)}${x.test_mode ? " · test mode" : ""}</div></div></div>`).join("") : ui.empty({ icon: "wallet", title: "No payout method", body: m.provider.available ? "Add one in Creator Studio to withdraw earnings." : "Payouts aren’t configured on this server." })}<a class="btn btn-secondary btn-sm" href="#/social/studio" style="align-self:flex-start">Manage in Creator Studio</a></div>`; },
      verification: () => producer?.verified ? `<div class="notice success">${BF.verifiedSeal()}<div><strong>Your producer storefront is verified.</strong> The badge appears on your storefront, beats and in search.</div></div>`
        : `<div class="notice">${I("shield", "i-sm")}<div><strong>Not verified.</strong> Verification is granted by the ${BF.brand.displayName} team after identity and catalog review. Verify your email and keep a clean record to be eligible.</div></div>`,
    };
    return head("Settings", "") + `<div class="tabs" role="tablist" style="margin-bottom:24px">${tabs.map(([k, l]) => `<a class="tab" role="tab" aria-selected="${tab === k}" href="#/dashboard/settings?tab=${k}">${l}</a>`).join("")}</div>${(panels[tab] ?? panels.profile)()}`;
  }

  const SECTIONS = { overview, beats: beatsSection, orders: ordersSection, customers: customersSection, licenses: licensesSection, earnings: earningsSection, analytics: analyticsSection, storefront: storefrontSection, messages: messagesSection, settings: settingsSection };

  /* ---------- Charts ---------- */
  function mountCharts(el, section, data) {
    const dash = data?.dash;
    const draw = () => {
      const rev = el.querySelector("#rev-chart");
      if (rev && dash) {
        const mode = el.querySelector("[data-rev][aria-pressed=true]")?.dataset.rev || "30";
        const pts = mode === "30" ? dash.daily_30.map((d) => ({ label: day(d.day + "T12:00:00"), value: d.net_cents / 100 })) : dash.revenue_12m.map((m) => ({ label: m.label, value: m.net_cents / 100 }));
        C.line(rev, pts, { format: (v, s) => (s ? short(v * 100) : BF.money0(v)), label: "Net revenue over time" });
        el.querySelector('[data-table="rev"]').innerHTML = C.table(["Period", "Net revenue"], pts.map((d) => [d.label, BF.money(d.value)]));
        el.querySelector("[data-rev-total]").textContent = BF.money0(pts.reduce((s, d) => s + d.value, 0));
        el.querySelector("[data-rev-sub]").textContent = mode === "30" ? "Last 30 days" : "Last 12 months";
      }
      const perf = el.querySelector("#perf-chart");
      if (perf && data?.cat) {
        const d = data.cat.beats.map((r) => BF.beatById[r.id]).filter(Boolean).sort((a, b) => b.plays - a.plays).slice(0, 6).map((b) => ({ label: b.title, value: b.plays, b }));
        if (d.length) C.hbars(perf, d, { format: BF.num, tip: (x) => `<b>${esc(x.label)}</b><span class="subtle">${x.value.toLocaleString()} plays · ${x.b.sales} sales</span>` });
        else perf.innerHTML = `<p class="subtle">No published beats yet.</p>`;
      }
      const mix = el.querySelector("#mix-chart");
      if (mix && dash) dash.license_mix.length ? C.stack(mix, dash.license_mix.map((m) => [BF.licenseById[m.key]?.short ?? m.key, m.share])) : (mix.innerHTML = `<p class="subtle">No sales yet.</p>`);
      const earn = el.querySelector("#earn-data"), cols = el.querySelector("#earn-cols");
      if (earn && cols) C.columns(cols, JSON.parse(earn.textContent).map((m) => ({ label: m.label, value: m.value / 100 })), { format: (v, s) => (s ? short(v * 100) : BF.money0(v)), height: 240, label: "Monthly net revenue" });
      const plays = el.querySelector("#plays-chart");
      if (plays && dash) {
        const d = dash.daily_30.map((x) => ({ label: day(x.day + "T12:00:00"), value: x.plays }));
        C.columns(plays, d, { format: (v) => Math.round(v).toLocaleString(), label: "Daily preview plays" });
        el.querySelector('[data-table="plays"]').innerHTML = C.table(["Day", "Plays"], d.map((x) => [x.label, x.value.toLocaleString()]));
      }
      const top = el.querySelector("#top-chart");
      if (top && dash) dash.top_items.length ? C.hbars(top, dash.top_items.slice(0, 8).map((t) => ({ label: t.title, value: t.net_cents / 100 })), { format: (v) => BF.money0(v), color: "var(--series-1)" }) : (top.innerHTML = `<p class="subtle">No sales yet.</p>`);
      const countries = el.querySelector("#countries");
      if (countries && dash) dash.geo.length ? C.hbars(countries, dash.geo.slice(0, 8).map((g) => ({ label: g.country, value: g.share })), { format: (v) => v + "%", color: "var(--series-1)" }) : (countries.innerHTML = `<p class="subtle">No sales yet.</p>`);
    };
    draw();
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 20) { w = el.clientWidth; draw(); } });
    ro.observe(el);
    el.addEventListener("click", (e) => {
      const r = e.target.closest("[data-rev]");
      if (r) { el.querySelectorAll("[data-rev]").forEach((b) => b.setAttribute("aria-pressed", b === r)); draw(); }
      const tt = e.target.closest("[data-table-toggle]");
      if (tt) { const on = tt.getAttribute("aria-pressed") !== "true"; tt.setAttribute("aria-pressed", on); el.querySelector(`[data-table="${tt.dataset.tableToggle}"]`).hidden = !on; }
    });
    return () => ro.disconnect();
  }

  /* ---------- Routes ---------- */
  const needSignIn = () => (BF.store.get("session").signedIn ? null : Object.assign(new Error("Sign in"), { status: 401 }));
  const loadSection = async (section, q) => { const e = needSignIn(); if (e) throw e; return BF.dashLoaders[section] ? BF.dashLoaders[section](q) : {}; };
  BF.route("/dashboard", { title: "Dashboard", layout: "dashboard", load: (_, q) => loadSection("overview", q), render: (_, q, data) => BF.dashShell("overview", overview(q, data)), mount: (el, _, q, data) => bindSection(el, "overview", q, data) });
  BF.route("/dashboard/:section", {
    title: (p) => (NAV.find((n) => n[0] === p.section) || [null, "Dashboard"])[1],
    layout: "dashboard",
    load: ({ section }, q) => (section === "upload" || BF.dashPages[section] ? (needSignIn() ? Promise.reject(needSignIn()) : BF.dashPages[section]?.load?.(q) ?? null) : loadSection(section, q)),
    render: ({ section }, q, data) => {
      if (section === "upload") return BF.renderUpload(q, data);
      if (BF.dashPages[section]) return BF.dashPages[section].render(q, data);
      const fn = SECTIONS[section] || BF.dashSections[section];
      if (!fn) return BF.dashShell("overview", ui.empty({ icon: "alert", title: "Unknown section", actions: `<a class="btn btn-primary" href="#/dashboard">Back to overview</a>` }));
      return BF.dashShell(section, fn(q, data ?? {}));
    },
    mount: (el, { section }, q, data) => {
      if (section === "upload") return BF.mountUpload(el, q, data);
      if (BF.dashPages[section]) return BF.dashPages[section].mount(el, q, data);
      const off = bindSection(el, section, q, data);
      const off2 = BF.dashMounts[section] && BF.dashMounts[section](el, q, data);
      return () => { off && off(); off2 && off2(); };
    },
  });

  function toCsv(rows) { return rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"); }
  function bindSection(el, section, q, data) {
    const off = mountCharts(el, section, data);
    const reload = () => BF.rerender();
    el.addEventListener("click", async (e) => {
      const t = e.target;
      const ex = t.closest("[data-export]");
      if (ex && data?.dash) {
        const rows = [["Order", "Item", "License", "Format", "Buyer", "Date", "Status", "Paid", "Net"], ...data.dash.recent_orders.map((o) => [o.order_id, o.title, o.license_id ?? "", o.format ?? "", o.buyer, o.date ? new Date(o.date).toISOString() : "", o.status, (o.paid_cents / 100).toFixed(2), (o.net_cents / 100).toFixed(2)])];
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" })); a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
      }
      const bs = t.closest("[data-beat-status]");
      if (bs) {
        const s = bs.dataset.beatStatus;
        if (s === "removed" && !(await ui.confirm({ title: "Remove this beat from the store?", body: "It disappears from the store, search and carts. Buyers keep their licenses and files.", confirmLabel: "Remove", danger: true }))) return;
        try { await BF.http.patch(`/api/seller/beats/${bs.dataset.id}`, { status: s }); await BF.refreshCatalog(); ui.toast({ title: "Beat updated" }); reload(); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t update it", desc: esc(err.message) }); }
      }
      const bp = t.closest("[data-beat-price]");
      if (bp) {
        ui.modal({ title: "Change price", body: `<div class="field"><label class="label" for="pm">Price multiplier</label><input class="input mono" id="pm" type="number" min="0.5" max="5" step="0.05" value="${bp.dataset.mult}"><span class="hint">Each license tier’s base price × this multiplier (0.5–5). Exclusive prices round to the nearest $10.</span></div>`,
          foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`,
          onMount(m, close) { m.querySelector("[data-ok]").onclick = async () => { try { await BF.http.patch(`/api/seller/beats/${bp.dataset.beatPrice}`, { price_mult: Number(m.querySelector("#pm").value) }); close(); await BF.refreshCatalog(); ui.toast({ title: "Price updated" }); reload(); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t change the price", desc: esc(err.message) }); } }; } });
      }
      if (t.closest("[data-save-store]")) {
        const v = (s) => el.querySelector(s)?.value ?? "";
        try {
          await BF.http.patch("/api/seller/producer", { name: v("#sf-name"), bio: v("#sf-bio"), location: v("#sf-loc"), palette: el.querySelector("[name=sf-pal]:checked")?.value, socials: { instagram: v("#sf-ig"), youtube: v("#sf-yt"), site: v("#sf-site") } });
          await BF.refreshCatalog(); ui.toast({ title: "Storefront published", desc: "Changes are live." });
        } catch (err) { ui.toast({ kind: "error", title: "Couldn’t save", desc: esc(err.message) }); }
      }
      const rv = t.closest("[data-revoke]");
      if (rv) { try { await BF.http.del(`/api/auth/sessions/${rv.dataset.revoke}`); ui.toast({ title: "Device signed out" }); reload(); } catch (err) { ui.toast({ kind: "error", title: "Couldn’t sign it out", desc: esc(err.message) }); } }
      if (t.closest("[data-logout-others]")) { try { const r = await BF.http.post("/api/auth/logout-others"); ui.toast({ title: `Signed out ${r.signed_out} other device${r.signed_out === 1 ? "" : "s"}` }); reload(); } catch (err) { ui.toast({ kind: "error", title: "That didn’t work", desc: esc(err.message) }); } }
    });
    el.querySelector("[data-olic]")?.addEventListener("change", (e) => { const lic = e.target.value; el.querySelector("[data-orders]").innerHTML = ordersTable(data.dash.recent_orders.filter((o) => !lic || o.license_id === lic)); });
    const filterBeats = () => {
      const st = el.querySelector("[data-bstatus][aria-pressed=true]")?.dataset.bstatus || "";
      const q2 = (el.querySelector("#mb-q")?.value || "").toLowerCase();
      el.querySelectorAll("[data-mb-body] tr").forEach((tr) => (tr.hidden = !((!st || tr.dataset.status === st) && tr.dataset.title.includes(q2))));
    };
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-bstatus]"); if (b) { b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); filterBeats(); } });
    el.querySelector("#mb-q")?.addEventListener("input", filterBeats);
    const bio = el.querySelector("#sf-bio");
    if (bio) {
      bio.addEventListener("input", () => { el.querySelector("[data-bio-count]").textContent = `${bio.value.length}/400`; el.querySelector("[data-sp-bio]").textContent = bio.value; });
      el.querySelector("#sf-name").addEventListener("input", (e) => (el.querySelector("[data-sp-name]").firstChild.textContent = e.target.value));
      el.addEventListener("change", (e) => { if (e.target.name === "sf-pal") el.querySelector("[data-sp-banner]").src = BF.banner(seller().producer?.handle ?? "store", e.target.value); });
    }
    el.querySelector("[data-account-form]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const r = await BF.http.patch("/api/me/profile", { display_name: el.querySelector("#st-n").value.trim() }); await BF.store.hydrate(r.user ?? (await BF.http.get("/api/me")).user); ui.toast({ title: "Saved" }); reload(); }
      catch (err) { ui.toast({ kind: "error", title: "Couldn’t save", desc: esc(err.message) }); }
    });
    el.querySelector("[data-pw-form]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await BF.http.post("/api/auth/password/change", { current_password: el.querySelector("#pw-cur").value, new_password: el.querySelector("#pw-new").value }); e.target.reset(); ui.toast({ title: "Password changed", desc: "Other devices were signed out." }); reload(); }
      catch (err) { ui.toast({ kind: "error", title: "Password not changed", desc: esc(err.message) }); }
    });
    el.querySelector("[data-prefs]")?.addEventListener("change", async (e) => {
      const cb = e.target.closest("[data-cat]"); if (!cb) return;
      try { await BF.http.patch("/api/me/notification-prefs", { [cb.dataset.cat]: { in_app: cb.checked } }); ui.toast({ title: "Preference saved" }); }
      catch (err) { cb.checked = !cb.checked; ui.toast({ kind: "error", title: "Couldn’t save", desc: esc(err.message) }); }
    });
    return off;
  }
})();
