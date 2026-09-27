/* Design system reference + information architecture + misc routes */
(function () {
  // Illustrative data for the component gallery only (labelled as examples on the page; not store data)
  const EXAMPLE_ORDERS = [{ id: "EX-1001", license: "premium", status: "Paid", amount: 49.99 }, { id: "EX-1002", license: "basic", status: "Paid", amount: 29.99 }, { id: "EX-1003", license: "trackout", status: "Paid", amount: 99.99 }];
  const EXAMPLE_REVENUE = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"].map((m, i) => [m, 4000 + i * 650 + (i % 3) * 400]);
  const EXAMPLE_MIX = [["Basic", 38], ["Premium", 34], ["Trackout", 22], ["Exclusive", 6]];
  const I = BF.icon, ui = BF.ui;

  const sec = (id, n, title, body, lead = "") => `<section class="ds-sec" id="ds-${id}"><div class="ds-sec-head"><span class="eyebrow"><span class="idx">${n}</span>${title}</span>${lead ? `<p class="muted" style="font-size:14px;max-width:640px">${lead}</p>` : ""}</div>${body}</section>`;
  const sw = (name, v, note = "") => `<div class="swatch-card"><span style="background:var(${v})"></span><b>${name}</b><code>${v}</code>${note ? `<span class="subtle">${note}</span>` : ""}</div>`;

  function electronic() {
    const t = BF.trackById.t5, rel = BF.releaseById.r1;
    const M = BF.mui;
    const sw2 = (name, hex, note) => `<div class="swatch-card"><span style="background:${hex}"></span><b>${name}</b><code>${hex}</code><span class="subtle">${note}</span></div>`;
    return `<div class="ds-row" style="margin-bottom:16px">
        <div class="card card-pad" style="flex:1;min-width:280px"><b>Beats voice</b><p class="display" style="font-size:34px;margin-top:8px">Midnight Drive</p><p class="muted" style="font-size:13px">Archivo wide (118%), violet accent, 8–12px radii.</p></div>
        <div class="card card-pad" style="flex:1;min-width:280px;background:#0b0c10;border-radius:2px"><b>Electronic voice</b><p class="edisplay" style="font-size:44px;margin-top:8px">Night Circuit</p><p class="muted" style="font-size:13px">Archivo condensed (72%), electric blue, 2–4px radii, hairline rules.</p></div>
      </div>
      <div class="swatch-grid">${sw2("Deep black", "#07080b", "--bg")}${sw2("Graphite", "#0e0f13", "--surface-1")}${sw2("Dark purple", "#2a1650", "depth gradients")}${sw2("Electric blue", "#2f5bff", "actions · 5.2:1 w/ white")}${sw2("Blue text", "#8aa6ff", "links · 7.9:1")}${sw2("Cyan", "#3ad7f0", "played waveform, energy")}${sw2("Acid green", "#b8f23a", "sparingly: NEW, drop cue, owned")}</div>
      <h3 class="h4" style="margin:24px 0 10px">Ranked vs. curated — never confused</h3>
      <div class="ds-row" style="align-items:flex-start">
        <div style="flex:1;min-width:300px"><div class="ehead ranked"><div><span class="ehead-label"><span class="chart-pill">${I("chart", "i-xs")} Chart</span> Data-driven</span><h2>Ranked</h2></div></div><p class="muted" style="font-size:13px">Solid 2px rule, black-on-white CHART pill, condensed numerals and movement arrows. Ordered by downloads only.</p></div>
        <div style="flex:1;min-width:300px"><div class="ehead editorial"><div><span class="ehead-label"><span class="ed-pill">${I("sparkle", "i-xs")} Curated</span> Editorial</span><h2>Curated</h2></div></div><p class="muted" style="font-size:13px">Dashed rule, italic cyan byline, cyan left edge on cards, no numbers. Always names the curator.</p></div>
      </div>
      <h3 class="h4" style="margin:24px 0 10px">DJ metadata components</h3>
      <div class="ds-demo">${M.keyBadge(t)} ${M.keyBadge(BF.trackById.t15)} ${M.keyBadge(BF.trackById.t25)} ${M.energy(3)} ${M.energy(7)} ${M.energy(10)} ${M.typeBadge(rel)} <span class="fmt">WAV</span><span class="fmt">AIFF</span><span class="fmt">MP3</span> ${M.explicit({ explicit: true })} ${M.buyBtn("track", "t30")}</div>
      <div class="card card-pad" style="background:#0b0c10;border-radius:2px" data-queue="${t.id}"><p class="hint" style="margin-bottom:8px">Waveform with DJ markers: shaded intro/outro (from bar counts) and the drop cue. With “DJ preview: From drop” on, previews start at the cue.</p>${BF.ui.waveform(t, { bars: 140, markers: true, cls: "big" })}</div>
      <p class="hint" style="margin-top:10px">Camelot key colors follow the wheel — adjacent (harmonically compatible) keys get adjacent hues, so compatible tracks are visible at a glance.</p>`;
  }

  function ia() {
    const tree = [
      ["Platform home", "/", ["“What are you looking for?” chooser", "Beats Store card · Electronic Music card", "From the Beats Store (separate band)", "From the Electronic Music Store (separate band)", "One account · two libraries"]],
      ["About", "/about", ["Two stores, one platform", "Shared: account · payments · orders", "Separate: catalog · discovery · terminology"]],
      ["Beats Store home", "/beats", ["Hero + featured player", "Trending beats", "Featured producers", "Fresh beats · packs", "Genres · how licensing works"]],
      ["Beats · Discover", "/beats/discover · /beats/catalog", ["Moods · BPM bands · free downloads", "Catalog filters: genre · BPM · key · mood · price · license", "Grid ⇄ list, deep-linkable"]],
      ["Beat · Pack", "/beats/beat/:id · /beats/pack/:id", ["License panel + compare table", "Stems · trackout · exclusive", "Pack contents · size · terms"]],
      ["Producers · Genres · Charts", "/beats/producers · /beats/producer/:handle · /beats/genres · /beats/charts", ["Verification · reviews · contact", "Charts: beats · producers · packs"]],
      ["Beats Library", "/beats/library?tab=", ["Beat licenses · Packs", "Favorites · Playlists", "Downloads · License documents"]],
      ["Electronic Music Store home", "/electronic", ["Smart search (BPM · key · genre · label)", "New releases · Trending (ranked)", "DJ Essentials (curated)", "Labels · Artists · Genre collections"]],
      ["Electronic · Discover", "/electronic/discover · /electronic/new · /electronic/genres · /electronic/genre/:id", ["Filters: genre · BPM · Camelot key · harmonic mix · energy · label · type · price", "Tracks ⇄ Releases view"]],
      ["Release", "/electronic/release/:id?t=", ["Tracklist with waveforms + DJ markers", "Buy track / Buy release · WAV · AIFF · MP3", "Credits, ℗/©, ISRC, UPC"]],
      ["Artists · Labels · Charts", "/electronic/artists · /electronic/artist/:handle · /electronic/labels · /electronic/label/:id · /electronic/charts", ["Follow · catalog by type", "Charts ranked by downloads only"]],
      ["Electronic Library", "/electronic/library?tab=", ["Purchased tracks & releases", "DJ crates", "Favorites · Downloads · Recently played"]],
      ["Search", "/beats/search · /electronic/search · /search", ["Scoped to the current store by default", "“Search both marketplaces” → grouped by store, never interleaved"]],
      ["Shared commerce", "/cart · /checkout · /checkout/success", ["One cart, grouped by store", "One payment → one order per store (TBB- / TBE-)", "Success shows each order separately"]],
      ["Seller", "/sell · /dashboard/:section", ["Beats: upload (5 steps) · orders · licenses · earnings", "Electronic: release-upload (ISRC, formats) · releases · music analytics · genres admin", "One seller account"]],
      ["Auth", "/login · /signup · /forgot · /verify · /onboarding", ["Role: artist · producer · DJ · both", "Personalized first store"]],
    ];
    const flow = (steps) => `<ol class="flow">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>`;
    return `<div class="ia-grid">${tree.map(([t, path, kids]) => `<div class="ia-node card"><div class="ia-top"><b>${t}</b><code>${path}</code></div><ul>${kids.map((k) => `<li>${k}</li>`).join("")}</ul></div>`).join("")}</div>
      <h3 class="h4" style="margin:32px 0 12px">Key flows</h3>
      <div class="stack-16">
        <div><span class="subtle mono" style="font-size:12px">PURCHASE</span>${flow(["Beats Store: preview (any list)", "Price button → license picker", "Compare terms", "Add to cart", "Cart: change license / promo", "Checkout: licensee + payment", "Success: order TBB-… · files + license PDF", "Beats Library"])}</div>
        <div><span class="subtle mono" style="font-size:12px">UPLOAD</span>${flow(["Audio (MP3 / WAV / stems)", "Beat info (auto BPM/key)", "Artwork", "Licensing (price + file checks)", "Preview + rights attestation", "Publish / private / scheduled"])}</div>
        <div><span class="subtle mono" style="font-size:12px">MUSIC PURCHASE</span>${flow(["Smart search “124 BPM melodic techno”", "Store filtered by BPM / key / genre", "DJ preview from the drop", "Buy track or whole release (replaces singles)", "Choose WAV / AIFF / MP3", "Purchase complete: order TBE-… · downloads + receipt", "Electronic Library · crates"])}</div>
        <div><span class="subtle mono" style="font-size:12px">RELEASE UPLOAD</span>${flow(["Type & metadata (cat no., ℗/©)", "Artwork", "Tracks: audio, mix, remixer, BPM, key, ISRC", "Formats & pricing", "Rights attestation → review"])}</div>
        <div><span class="subtle mono" style="font-size:12px">TRUST</span>${flow(["Producer verification (ID, payout, catalog)", "Seal on every surface", "Clear terms + agreement per order", "Report → Trust & Safety case", "Reviews from verified purchases"])}</div>
      </div>`;
  }

  BF.route("/system", {
    title: "Design system",
    render() {
      const b = BF.beatById.b1, b2 = BF.beatById.b3;
      return `<div class="container ds">
        <header style="padding:40px 0 8px"><span class="eyebrow"><span class="idx">DS</span>${BF.brand.name} design system · v1.0</span><h1 class="display" style="font-size:clamp(2.4rem,6vw,4.5rem);margin-top:12px">Signal &amp; Flow</h1>
          <p class="body-lg" style="max-width:720px;margin-top:12px">A dark-first system for a music marketplace. Wide display type for voice, mono for musical metadata, a single violet→cyan “signal” gradient reserved for audio progress. Tight radii, borders over shadows, and motion that stays under 320ms.</p>
          <nav class="ds-toc" aria-label="Design system sections">${["brand", "color", "type", "space", "buttons", "inputs", "labels", "nav", "cards", "player", "overlays", "data", "states", "a11y", "electronic", "ia"].map((s) => `<a class="chip" href="#/system" data-jump="ds-${s}">${s}</a>`).join("")}</nav></header>

        ${sec("brand", "01", "Brand", `<div class="ds-row"><div class="card card-pad" style="display:flex;align-items:center;gap:14px">${BF.brand.logo(40)}</div><div class="card card-pad" style="display:flex;gap:16px;align-items:center">${BF.brand.mark(56)}${BF.brand.mark(32)}${BF.brand.mark(20)}</div>
          <div class="card card-pad" style="flex:1;min-width:260px"><b>Renaming the product</b><p class="muted" style="font-size:14px;margin-top:6px">Every surface reads <code>BF.brand</code> in <code>js/brand.js</code> — name, display name, domain, legal entity, order prefix and the mark SVG. Change it once; nothing else hard-codes the name.</p></div></div>`,
          "The mark: a rising 4-bar meter resolving into a flow line — level, then movement.")}

        ${sec("color", "02", "Color", `<div class="swatch-grid">
          ${sw("bg", "--bg", "#0a0a0c")}${sw("surface-1", "--surface-1", "cards")}${sw("surface-2", "--surface-2", "inputs / raised")}${sw("surface-3", "--surface-3", "menus")}${sw("border", "--border")}${sw("border-strong", "--border-strong")}
          ${sw("text", "--text", "18.2:1")}${sw("text-2", "--text-2", "8.3:1")}${sw("text-3", "--text-3", "5.3:1 min")}
          ${sw("accent", "--accent", "white text 4.8:1")}${sw("accent-text", "--accent-text", "links 7.1:1")}${sw("accent-2", "--accent-2", "verified / info")}
          ${sw("success", "--success")}${sw("warning", "--warning")}${sw("danger", "--danger")}
          ${sw("series-1", "--series-1", "chart slot 1")}${sw("series-2", "--series-2")}${sw("series-3", "--series-3")}${sw("series-4", "--series-4")}
        </div><div class="flow-bar" aria-hidden="true"></div><p class="hint">The signal gradient (<code>--flow</code>) appears only on playback progress, upload progress and the brand mark.</p>`, "Tokens are layered primitive → semantic → component. Components never reference raw hex.")}

        ${sec("type", "03", "Typography", `<div class="type-specimen">
          <div><span class="subtle mono">Display · Archivo 800 · wdth 118 · uppercase</span><p class="display" style="font-size:56px">Midnight Drive</p></div>
          <div><span class="subtle mono">H1 · Archivo 800</span><p class="h1">Discover</p></div>
          <div><span class="subtle mono">H2 · Archivo 750</span><p class="h2">Trending Beats</p></div>
          <div><span class="subtle mono">H3 · Inter 650 · 18</span><p class="h3">License this beat</p></div>
          <div><span class="subtle mono">Body · Inter 400 · 15 / 1.55</span><p>Artists discover and license beats from independent producers — with clear terms on every track.</p></div>
          <div><span class="subtle mono">Metadata · JetBrains Mono 12</span><p>${ui.spec(b, { genre: true })}</p></div>
          <div><span class="subtle mono">Price · Mono 600 / Display for totals</span><p class="mono" style="font-weight:600">$49.99</p><p class="display" style="font-size:28px">$149.97</p></div>
        </div>`, "Three voices: wide display for headlines (poster energy), Inter for reading, mono for BPM, key, durations, prices and order IDs.")}

        ${sec("space", "04", "Space, radius, elevation, motion", `<div class="ds-row">
          <div class="card card-pad" style="flex:1;min-width:260px"><b>Spacing · 4px base</b><div class="space-scale">${[4, 8, 12, 16, 24, 32, 48, 64].map((s) => `<div><span style="width:${s}px;height:${s}px"></span><code>${s}</code></div>`).join("")}</div></div>
          <div class="card card-pad" style="flex:1;min-width:260px"><b>Radius</b><div class="radius-row">${[["xs", 3], ["sm", 5], ["md", 8], ["lg", 12], ["full", 999]].map(([n, r]) => `<div><span style="border-radius:${Math.min(r, 28)}px"></span><code>${n}</code></div>`).join("")}</div></div>
          <div class="card card-pad" style="flex:1;min-width:260px"><b>Motion</b><dl class="kv compact" style="margin-top:8px"><div><dt>fast</dt><dd class="mono">120ms · hovers, presses</dd></div><div><dt>base</dt><dd class="mono">180ms · menus, fades</dd></div><div><dt>slow</dt><dd class="mono">320ms · pages, modals, sheets</dd></div><div><dt>reduced</dt><dd class="mono">0ms · respects OS setting</dd></div></dl></div>
        </div>`)}

        ${sec("buttons", "05", "Buttons", `<div class="ds-demo">
          <button class="btn btn-primary">${I("bag-plus", "i-sm")} Primary</button><button class="btn btn-secondary">Secondary</button><button class="btn btn-outline">Outline</button><button class="btn btn-ghost">Ghost</button><button class="btn btn-light">Light</button><button class="btn btn-danger">Danger</button>
        </div><div class="ds-demo">
          <button class="btn btn-primary btn-sm">Small</button><button class="btn btn-primary">Default</button><button class="btn btn-primary btn-lg">Large</button><button class="btn btn-primary btn-xl">XL</button>
          <button class="btn btn-primary is-loading" aria-busy="true">Loading<span class="spinner"></span></button><button class="btn btn-primary" disabled>Disabled</button><button class="btn btn-secondary btn-icon" aria-label="Share">${I("share", "i-sm")}</button>
        </div><div class="ds-demo">${ui.playBtn(b.id, "sm")}${ui.playBtn(b.id)}${ui.playBtn(b.id, "lg accent")}${ui.playBtn(b.id, "xl")} ${ui.favBtn(b.id)} ${ui.priceBtn(b)} <button class="icon-btn" aria-label="Queue" data-tip="Tooltip">${I("queue")}</button></div>`, "Minimum hit area 40px (44px on touch). Loading keeps width stable; icon-only buttons always carry aria-label.")}

        ${sec("inputs", "06", "Inputs & form controls", `<div class="form-grid" style="max-width:820px">
          <div class="field"><label class="label" for="ds1">Default</label><input class="input" id="ds1" placeholder="Beat title"></div>
          <div class="field has-error"><label class="label" for="ds2">Error</label><input class="input" id="ds2" value="300" aria-invalid="true"><div class="field-error">${I("alert-circle", "i-xs")} Enter a BPM between 40 and 220.</div></div>
          <div class="field is-valid"><label class="label" for="ds3">Valid</label><input class="input" id="ds3" value="kairo@kairovance.example"></div>
          <div class="field"><label class="label" for="ds4">Select</label><select class="select" id="ds4"><option>F♯ min</option></select></div>
          <div class="field"><label class="label" for="ds5">Search</label><div class="input-group">${I("search", "i-sm")}<input class="input" id="ds5" placeholder="Search"></div></div>
          <div class="field"><label class="label" for="ds6">With affix</label><div class="input-group"><input class="input mono" id="ds6" value="142"><span class="input-affix">BPM</span></div></div>
          <div class="field span-2"><label class="label" for="ds7">Textarea <span class="opt">0/500</span></label><textarea class="textarea" id="ds7" placeholder="Describe the vibe…"></textarea><span class="hint">Helper text sits below the field.</span></div>
          <div class="stack-8"><label class="check"><input type="checkbox" checked> Checkbox</label><label class="check"><input type="radio" name="dsr" checked> Radio</label><label class="switch"><input type="checkbox" checked> Switch</label></div>
          <div><span class="label">Range</span><input type="range" class="range" style="--val:60%" value="60" aria-label="Volume demo"><div class="dual-range" style="margin-top:12px"><div class="track"></div><div class="fill" style="left:25%;right:30%"></div><input type="range" value="25" aria-label="Min demo"><input type="range" value="70" aria-label="Max demo"></div></div>
        </div>`, "Labels are always visible. Errors sit under the field, name the fix, and pair color with an icon.")}

        ${sec("labels", "07", "Chips, tags & badges", `<div class="ds-demo"><button class="chip">Trap</button><button class="chip" aria-pressed="true">Selected</button><button class="chip chip-removable">140–150 BPM ${I("x", "i-xs x")}</button><span class="tag">dark trap</span><span class="tag">808</span></div>
          <div class="ds-demo"><span class="badge">Default</span><span class="badge badge-accent">New</span><span class="badge badge-cyan">${I("fire", "i-xs")} Hot</span><span class="badge badge-success"><span class="dot"></span>Delivered</span><span class="badge badge-warning">Pending</span><span class="badge badge-danger">Refunded</span><span class="badge badge-solid">#1</span>${BF.verifiedSeal()}<span class="eq"><span></span><span></span><span></span></span></div>
          <div class="ds-demo">${ui.spec(b, { genre: true })}</div>`)}

        ${sec("nav", "08", "Tabs, segmented, menus", `<div class="tabs" role="tablist" style="max-width:520px"><button class="tab" role="tab" aria-selected="true">Beats <span class="n">288</span></button><button class="tab" role="tab" aria-selected="false">Albums <span class="n">3</span></button><button class="tab" role="tab" aria-selected="false">About</button></div>
          <div class="ds-demo" style="margin-top:16px"><div class="segmented"><button aria-pressed="true">${I("grid", "i-sm")}</button><button aria-pressed="false">${I("list", "i-sm")}</button></div>
          <div class="dropdown"><button class="btn btn-secondary btn-sm" data-dropdown aria-haspopup="menu" aria-expanded="false">Dropdown ${I("chevron-down", "i-xs")}</button><div class="menu left" role="menu"><div class="menu-label">Sort</div><button class="menu-item" role="menuitemradio" aria-checked="true">Trending</button><button class="menu-item" role="menuitemradio" aria-checked="false">Newest</button><div class="menu-sep"></div><button class="menu-item danger" role="menuitem">${I("flag", "i-sm")} Report</button></div></div></div>`)}

        ${sec("cards", "09", "Cards: beats, producers, licenses", `<div class="ds-cards" data-queue="b1,b3">${ui.beatCard(b, { dur: true })}${ui.beatCard(b2)}<div style="min-width:260px">${ui.producerCard(BF.producerById.p1)}</div></div>
          <div class="beat-list card" role="list" style="margin-top:20px;padding:8px 0" data-queue="b1,b3">${ui.beatListHead()}${ui.beatRow(b, 0)}${ui.beatRow(b2, 1)}</div>
          <div class="ds-row" style="margin-top:20px;align-items:flex-start"><fieldset class="lic-list" style="flex:1;min-width:280px"><legend class="label" style="margin-bottom:8px">License options</legend>${BF.LICENSES.map((l, i) => ui.licenseOption(b, l, i === 1, "ds-lic")).join("")}</fieldset><div class="card card-pad" style="flex:1;min-width:280px"><b>License terms</b>${ui.licenseTerms(b, BF.licenseById.premium)}</div></div>`)}

        ${sec("player", "10", "Audio player & waveform", `<div class="card card-pad" data-queue="b1"><div class="bd-player">${ui.playBtn(b.id, "lg accent")}<div style="flex:1;min-width:0">${ui.waveform(b, { bars: 140 })}</div></div></div>
          <p class="hint" style="margin-top:10px">Waveforms are seekable by pointer and keyboard (←/→ 5s, PgUp/PgDn 15s, Home/End). The global player persists across routes, exposes Media Session controls, and collapses to a mini-player above the mobile tab bar.</p>`)}

        ${sec("overlays", "11", "Modals, dialogs, drawers, toasts", `<div class="ds-demo">
          <button class="btn btn-secondary" data-action="license" data-beat="b1">License picker modal</button>
          <button class="btn btn-secondary" data-ds="confirm">Confirmation dialog</button>
          <button class="btn btn-secondary" data-ds="drawer">Drawer</button>
          <button class="btn btn-secondary" data-ds="t-success">Toast · success</button><button class="btn btn-secondary" data-ds="t-error">Toast · error</button><button class="btn btn-secondary" data-ds="t-info">Toast · info</button>
          <button class="btn btn-secondary" data-action="report" data-beat="b1">Report workflow</button>
        </div>`, "All overlays trap focus, close on Esc, restore focus on close, and become bottom sheets under 640px.")}

        ${sec("data", "12", "Tables & charts", `<p class="hint" style="margin-bottom:10px">Example data for the component gallery.</p><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>License</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${EXAMPLE_ORDERS.map((o) => `<tr><td class="mono" style="font-size:12.5px">${o.id}</td><td>${BF.licenseById[o.license]?.short ?? o.license}</td><td><span class="badge badge-success"><span class="dot"></span>${o.status}</span></td><td class="num mono strong">${BF.money(o.amount)}</td></tr>`).join("")}</tbody></table></div></div>
          <div class="ds-row" style="margin-top:16px"><div class="card card-pad" style="flex:2;min-width:300px"><b>Line · single series (no legend; title names it)</b><div id="ds-line" style="margin-top:12px"></div></div><div class="card card-pad" style="flex:1;min-width:260px"><b>Part-to-whole · legend + labels</b><div id="ds-stack" style="margin-top:16px"></div></div></div>`, "One axis per chart. 2px lines, 4px rounded bar ends, recessive grid, hover tooltips, and a table view for every chart.")}

        ${sec("states", "13", "Empty, loading & error states", `<div class="ds-row" style="align-items:stretch">
          <div class="card" style="flex:1;min-width:260px">${ui.empty({ icon: "heart", title: "No favorites yet", body: "Tap the heart on any beat to save it.", actions: `<button class="btn btn-primary btn-sm">Discover</button>` })}</div>
          <div class="card" style="flex:1;min-width:260px">${ui.empty({ kind: "error", icon: "alert", title: "Couldn’t load beats", body: "Your filters are saved — try again.", actions: `<button class="btn btn-secondary btn-sm">${I("refresh", "i-sm")} Retry</button>` })}</div>
          <div class="card card-pad" style="flex:1;min-width:260px">${ui.skeletonRows(3)}<div class="grid-beats" style="grid-template-columns:repeat(2,1fr);margin-top:12px"><div class="skeleton sk-art"></div><div class="skeleton sk-art"></div></div></div>
        </div><div class="stack-8" style="margin-top:16px">
          <div class="notice info">${I("info", "i-sm")}<div><strong>Info.</strong> Terms are set by the producer.</div></div>
          <div class="notice success">${I("check", "i-sm")}<div><strong>Success.</strong> Bundle discount applied.</div></div>
          <div class="notice warning">${I("alert", "i-sm")}<div><strong>Warning.</strong> Exclusive purchase removes the beat from sale.</div></div>
          <div class="notice error">${I("alert-circle", "i-sm")}<div><strong>Error.</strong> Payment declined — you have not been charged.</div></div>
          <div style="max-width:420px"><div class="progress"><span style="width:62%"></span></div><p class="hint" style="margin-top:6px">Upload progress · 62%</p></div></div>
          <p class="hint" style="margin-top:12px">Live examples: <a class="link" href="#/beats/catalog?q=zzzz">no results</a> · <a class="link" href="#/beats/beat/nope">missing beat</a> · <a class="link" href="#/nowhere">404</a></p>`)}

        ${sec("a11y", "14", "Accessibility checklist", `<ul class="a11y-list">${[
          ["Contrast", "Body text ≥ 8:1, metadata ≥ 5.3:1, accent buttons 4.8:1 on dark."],
          ["Keyboard", "Every control reachable; visible 2px violet focus ring; skip link; ⌘K search; Space play/pause; Shift+←/→ prev/next."],
          ["Semantics", "Landmarks, headings in order, lists for rows, real tables, ARIA tabs / menus / dialogs / sliders."],
          ["Screen readers", "Play buttons announce title + state; waveforms expose value text; route changes announced via live region."],
          ["Motion", "All animation ≤ 320ms and disabled under prefers-reduced-motion."],
          ["Touch", "44px minimum targets on mobile, hover-only affordances made persistent on touch, swipe-to-dismiss player sheet."],
          ["Color independence", "Status always pairs color with an icon or label; charts include legends/labels and a table view."],
        ].map(([t, d]) => `<li>${I("check", "i-sm")}<div><b>${t}</b><p class="muted">${d}</p></div></li>`).join("")}</ul>`)}

        ${sec("electronic", "15", "Electronic identity", electronic(), "The electronic marketplace re-skins the same components through semantic tokens scoped to body[data-eco=electronic]. Same system, different voice.")}
        ${sec("ia", "16", "Information architecture", ia(), "Hash routes map 1:1 to future server routes; every filter and tab is deep-linkable via the query string.")}
        <div style="height:48px"></div>
      </div>`;
    },
    mount(el) {
      BF.chart.line(el.querySelector("#ds-line"), EXAMPLE_REVENUE.map(([m, v]) => ({ label: m, value: v })), { format: (v, s) => (s ? "$" + Math.round(v / 1000) + "k" : BF.money0(v)), height: 200, label: "Example revenue (illustrative data)" });
      BF.chart.stack(el.querySelector("#ds-stack"), EXAMPLE_MIX);
      el.addEventListener("click", async (e) => {
        const j = e.target.closest("[data-jump]"); if (j) { e.preventDefault(); document.getElementById(j.dataset.jump).scrollIntoView({ behavior: BF.reducedMotion() ? "auto" : "smooth" }); }
        const d = e.target.closest("[data-ds]")?.dataset.ds; if (!d) return;
        if (d === "confirm") { const ok = await ui.confirm({ title: "Delete playlist?", body: "This can’t be undone. Beats stay in your library.", confirmLabel: "Delete", danger: true }); ui.toast({ kind: "info", title: ok ? "Confirmed" : "Cancelled" }); }
        if (d === "drawer") ui.drawer({ title: "Drawer", body: `<p class="muted">Used for mobile filters and the play queue.</p>`, foot: `<button class="btn btn-primary btn-block" data-close>Done</button>` });
        if (d === "t-success") ui.toast({ title: "Added to cart", desc: "MIDNIGHT DRIVE · Premium Lease", art: BF.beatById.b1.art, action: { href: "#/cart", label: "View cart" } });
        if (d === "t-error") ui.toast({ kind: "error", title: "Upload failed", desc: "Connection lost. Retry from the upload step." });
        if (d === "t-info") ui.toast({ kind: "info", title: "Link copied" });
      });
    },
  });

  /* ---------- Verification explainer ---------- */
  BF.route("/verification", {
    title: "Producer verification",
    render: () => `<div class="container narrow" style="padding-top:40px">
      <span class="eyebrow">Trust</span><h1 class="h1" style="margin:8px 0 12px;display:flex;gap:12px;align-items:center">Verified producers ${BF.verifiedSeal()}</h1>
      <p class="body-lg">The seal means platform staff have reviewed a producer’s account and catalog and found it in good standing. Here’s what that review covers today.</p>
      <ol class="verify-steps" style="margin-top:32px">${[["Account review", "A staff member reviews the producer’s profile, sales history and support record. (Automated ID checks aren’t integrated yet.)"], ["Catalog review", "Staff sample uploads for uncleared samples, duplicates and re-uploads of others’ work."], ["Rights attestation", "Every upload requires the producer to confirm they own or control all rights, including samples."], ["Ongoing standing", "Upheld copyright reports remove the seal and can remove the catalog."]].map(([t, d]) => `<li class="done"><span class="vs-n">${I("check", "i-sm")}</span><div><b>${t}</b><p class="muted">${d}</p></div></li>`).join("")}</ol>
      <div class="notice info" style="margin-top:24px">${I("info", "i-sm")}<div>Verification isn’t a legal guarantee that every upload is free of third-party rights. If something looks wrong, report it from the beat page — every report gets a case number and a human review.</div></div>
      <div style="display:flex;gap:10px;margin-top:24px"><a class="btn btn-primary" href="mailto:${BF.brand.supportEmail}?subject=Producer%20verification">Request a review</a><a class="btn btn-secondary" href="#/beats/producers">See verified producers</a></div></div>`,
  });

  /* ---------- Legal / help stubs ---------- */
  const LEGAL = {
    licenses: ["License guide", "Leases are non-exclusive: the producer can keep selling the beat. Exclusive rights remove it from sale. Every license’s limits — copies, streams, videos, radio — are set by the producer and shown before you buy. Your agreement is generated per order and stored in your library."],
    protection: ["Purchase protection", `If files are missing, corrupt, or don’t match the preview, contact ${BF.brand.supportEmail} with your order ID. Refunds are issued to the original payment method; refunded items are removed from your library and the producer’s earnings for the sale are reversed.`],
    fees: ["Fees & payouts", "Beats Store: producers keep 85% of each sale (15% platform commission); buyers pay a $1.49 service fee per beat order. Electronic Music Store: sellers keep 80%. Earnings stay pending for 7 days (the refund window), then can be withdrawn from your dashboard."],
    copyright: ["Copyright & takedowns", "Rights holders can file a notice with the work, the infringing beat URL, and a statement of good faith. We respond to valid notices promptly and notify the producer, who may counter-notify."],
    terms: ["Terms of service", "Sample content. In production this page hosts the full terms of service."],
    privacy: ["Privacy policy", "Sample content. In production this page hosts the privacy policy."],
    help: ["Help center", `Questions? Reach us at ${BF.brand.supportEmail}.`],
  };
  BF.route("/legal/:page", {
    title: (p) => (LEGAL[p.page] || ["Help"])[0],
    render: ({ page }) => { const [t, body] = LEGAL[page] || LEGAL.help; return `<div class="container narrow" style="padding-top:40px"><span class="eyebrow">${BF.brand.name} · Support</span><h1 class="h1" style="margin:8px 0 16px">${t}</h1><p class="body-lg">${body}</p><p class="hint" style="margin-top:24px">This is prototype content and not legal advice.</p></div>`; },
  });

  /* ---------- 404 ---------- */
  BF.route("*", {
    title: "Page not found",
    render: () => `<div class="container" style="padding-top:40px">${ui.empty({ icon: "wave", title: "Dead air.", body: "This page doesn’t exist — it may have moved or the link is wrong.", actions: `<a class="btn btn-primary" href="#/">Go home</a><button class="btn btn-secondary" data-action="search">${I("search", "i-sm")} Search</button>` })}</div>`,
  });
})();
