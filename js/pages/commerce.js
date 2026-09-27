/* Cart → Checkout → Success — one shared purchase flow for both marketplaces
   (beat licenses, electronic tracks and full releases can sit in one order). */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;

  /* ---------- Helpers ---------- */
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function countLabel(t) {
    const parts = [];
    const tr = t.counts.tracks; if (tr) parts.push(plural(tr, "Track", "Tracks"));
    const rels = t.lines.filter((l) => l.kind === "release");
    const byType = {}; rels.forEach((l) => { const n = BF.releaseTypeName(l.rel.type); byType[n] = (byType[n] || 0) + 1; });
    Object.entries(byType).forEach(([n, c]) => parts.push(`${c} ${c > 1 && !/s$/.test(n) ? n + "s" : n}`));
    if (t.counts.beats) parts.push(plural(t.counts.beats, "Beat license", "Beat licenses"));
    if (t.counts.packs) parts.push(plural(t.counts.packs, "Pack", "Packs"));
    return parts.join(" · ");
  }
  const lineTitle = (l) => (l.kind === "beat" ? l.beat.title : l.kind === "pack" ? l.pack.title : l.kind === "track" ? BF.trackTitle(l.track) : l.rel.title);
  const lineArt = (l) => (l.kind === "beat" ? l.beat.art : l.kind === "pack" ? l.pack.art : l.kind === "track" ? l.track.art : l.rel.art);
  const lineSub = (l) => (l.kind === "beat" ? `${BF.licenseById[l.licenseId].name} · ${BF.licenseById[l.licenseId].files}` : l.kind === "pack" ? `${BF.PACK_TYPES[l.pack.type]} · ${l.pack.size} · WAV` : l.kind === "track" ? `${BF.artistNames(l.track.artistIds)} · ${l.format}` : `${BF.releaseTypeName(l.rel.type)} · ${BF.artistNames(l.rel.artistIds)} · ${l.format}`);

  /** Totals always come from the server's quote; `pending` means the quote for this cart hasn't arrived yet. */
  function summaryRows(t, opts = {}) {
    const problems = (t.problems ?? []).length ? `<div class="notice warning" style="margin-bottom:10px" role="alert">${I("alert", "i-sm")}<div>${t.problems.map((p) => `${esc(p.message)} <button class="link" style="font-size:12px" data-remove="${esc(p.key)}">Remove</button>`).join("<br>")}</div></div>` : "";
    return `${problems}<dl class="sum-rows" ${t.pending ? 'aria-busy="true"' : ""}>
      <div><dt>Subtotal <span class="subtle">· ${countLabel(t)}</span></dt><dd class="mono">${BF.money(t.subtotal)}</dd></div>
      ${t.bundle ? `<div class="pos"><dt>${I("layers", "i-xs")} Producer bundle −20%</dt><dd class="mono">−${BF.money(t.bundle)}</dd></div>` : ""}
      ${t.promo ? `<div class="pos"><dt>${I("tag", "i-xs")} ${esc(t.promo.code)} −${Math.round(t.promo.pct * 100)}%${opts.removable ? ` <button class="link" style="font-size:12px" data-rm-promo>Remove</button>` : ""}</dt><dd class="mono">−${BF.money(t.promoAmt)}</dd></div>` : `<div><dt>Discount</dt><dd class="mono subtle">$0.00</dd></div>`}
      ${t.serviceFee ? `<div><dt>Service fee <button class="info-tip" data-tip="Beat licensing: agreement generation & stem hosting" aria-label="About the service fee">${I("info", "i-xs")}</button></dt><dd class="mono">${BF.money(t.serviceFee)}</dd></div>` : ""}
      <div><dt>Taxes</dt><dd class="subtle" style="font-size:13px">${opts.taxLabel || "Calculated at checkout"}</dd></div>
      <div class="total"><dt>Total</dt><dd class="mono">${t.pending ? `<span class="spinner" aria-label="Updating total"></span>` : BF.money(t.total)}</dd></div>
    </dl>`;
  }
  const promoForm = (t) => t.promo ? "" : `<form class="promo" data-promo><label class="sr-only" for="promo">Promo code</label><input class="input input-sm" id="promo" placeholder="Promo code" autocomplete="off" maxlength="24"><button class="btn btn-secondary btn-sm">Apply</button></form><p class="hint promo-msg" aria-live="polite"></p>`;

  function bindPromo(el, rerender) {
    el.addEventListener("submit", async (e) => {
      if (!e.target.matches("[data-promo]")) return;
      e.preventDefault();
      const inp = e.target.querySelector("input"); const btn = e.target.querySelector("button");
      if (!inp.value.trim()) return inp.focus();
      btn.classList.add("is-loading"); btn.insertAdjacentHTML("beforeend", '<span class="spinner"></span>');
      const r = await BF.store.applyPromo(inp.value.trim());
      if (r.ok) { ui.toast({ title: "Promo applied", desc: `${esc(inp.value.trim().toUpperCase())} applied.` }); rerender(); }
      else { btn.classList.remove("is-loading"); btn.querySelector(".spinner")?.remove(); inp.closest("form").nextElementSibling.innerHTML = `<span style="color:var(--danger)">${I("alert-circle", "i-xs")} ${esc(r.message)}</span>`; inp.focus(); }
    });
    el.addEventListener("click", (e) => { if (e.target.closest("[data-rm-promo]")) { BF.store.removePromo(); rerender(); } });
  }

  /* ================= CART ================= */
  function beatLine(l) {
    const b = l.beat, p = BF.producerOf(b), lic = BF.licenseById[l.licenseId];
    return `<li class="cart-item" data-beat-card="${b.id}">
      <div class="art md"><img src="${b.art}" alt=""><div class="ci-play">${ui.playBtn(b.id, "sm")}</div></div>
      <div class="ci-main">
        <span class="ci-kind">Beat license</span>
        <a class="h4" href="#/beats/beat/${b.id}">${b.title}</a>
        <div class="subtle" style="font-size:13px;display:flex;gap:4px;align-items:center">${ui.producerLink(p)} · ${b.bpm} BPM · ${b.key}</div>
        <div class="ci-lic">
          <label class="sr-only" for="lic-${b.id}">License for ${b.title}</label>
          <select class="select input-sm" id="lic-${b.id}" data-change-lic="${b.id}">${BF.LICENSES.map((x) => `<option value="${x.id}" ${x.id === l.licenseId ? "selected" : ""} ${x.exclusive && !b.exclusiveAvailable ? "disabled" : ""}>${x.name} — ${BF.money(BF.priceFor(b, x.id))}</option>`).join("")}</select>
          <span class="fmt-row">${lic.formats.map((f) => `<span class="badge">${f}</span>`).join("")}</span>
        </div>
      </div>
      <div class="ci-right"><span class="mono ci-price">${BF.money(l.price)}</span><button class="btn btn-ghost btn-sm" data-remove="${l.key}">${I("trash", "i-sm")}<span class="hide-sm">Remove</span></button></div>
    </li>`;
  }
  function packLine(l) {
    const k = l.pack, p = BF.producerById[k.producerId];
    return `<li class="cart-item" data-beat-card="${k.id}">
      <div class="art md"><img src="${k.art}" alt=""><div class="ci-play">${ui.playBtn(k.id, "sm")}</div></div>
      <div class="ci-main">
        <span class="ci-kind">${BF.PACK_TYPES[k.type]}</span>
        <a class="h4" href="#/beats/pack/${k.id}">${esc(k.title)}</a>
        <div class="subtle" style="font-size:13px;display:flex;gap:4px;align-items:center">${ui.producerLink(p)} · ${esc(k.contents)}</div>
        <div class="ci-lic"><span class="badge">WAV</span><span class="badge">${k.size}</span></div>
      </div>
      <div class="ci-right"><span class="mono ci-price">${BF.money(l.price)}</span><button class="btn btn-ghost btn-sm" data-remove="${l.key}">${I("trash", "i-sm")}<span class="hide-sm">Remove</span></button></div>
    </li>`;
  }
  function musicLine(l) {
    const rel = l.rel, t = l.track, first = t ? t.id : rel.trackIds[0];
    const fmtSel = `<label class="sr-only" for="fmt-${l.key}">Download format for ${esc(lineTitle(l))}</label><select class="select input-sm" id="fmt-${l.key.replace(":", "-")}" data-change-fmt="${l.key}">${rel.formats.map((f) => `<option value="${f}" ${f === l.format ? "selected" : ""}>${f} · ${BF.FORMATS[f].detail} — ${BF.money(t ? BF.trackPrice(t, f) : BF.releasePrice(rel, f))}</option>`).join("")}</select>`;
    return `<li class="cart-item music" data-beat-card="${first}">
      <div class="art md"><img src="${lineArt(l)}" alt=""><div class="ci-play">${ui.playBtn(first, "sm")}</div></div>
      <div class="ci-main">
        <span class="ci-kind">${t ? "Track" : BF.releaseTypeName(rel.type)}</span>
        <a class="h4" href="#/electronic/release/${rel.id}${t ? "?t=" + t.id : ""}">${esc(lineTitle(l))}</a>
        <div class="subtle" style="font-size:13px">${esc(BF.artistNames(t ? t.artistIds : rel.artistIds))} · ${esc(BF.labelName(rel.labelId))}${t ? ` · ${t.bpm} BPM · ${t.camelot}` : ` · ${BF.isPack(rel) ? esc(rel.pack) : rel.trackIds.length + " tracks"}`}</div>
        <div class="ci-lic">${BF.isPack(rel) ? `<span class="fmt">${rel.formats.join(" · ")}</span>` : fmtSel}</div>
      </div>
      <div class="ci-right"><span class="mono ci-price">${BF.money(l.price)}</span><button class="btn btn-ghost btn-sm" data-remove="${l.key}">${I("trash", "i-sm")}<span class="hide-sm">Remove</span></button></div>
    </li>`;
  }

  function cartHTML() {
    const t = BF.store.cartTotals();
    if (!t.lines.length) {
      const favs = BF.store.get("favorites").map((id) => BF.item(id)).filter((x) => x && x.kind !== "track" && x.producerId).slice(0, 6);
      return `<div class="container" style="padding-top:32px"><h1 class="h1">Cart</h1>
        ${ui.empty({ icon: "bag", title: "Your cart is empty", body: "One account, one checkout — each store keeps its own orders.", actions: `<a class="btn btn-primary" href="#/beats">${I("mic", "i-sm")} Beats Store</a><a class="btn btn-secondary" href="#/electronic">${I("headphones", "i-sm")} Electronic Music Store</a>` })}
        ${favs.length ? `<section class="section" style="padding-top:16px">${ui.sectionHead("", "From your favorites", "Ready when you are", "")}<div class="rail cols-6" data-queue="${favs.map((b) => b.id).join(",")}">${favs.map((b) => ui.beatCard(b)).join("")}</div></section>` : ""}</div>`;
    }
    const beats = t.lines.filter((l) => l.kind === "beat"), packs = t.lines.filter((l) => l.kind === "pack"), music = t.lines.filter((l) => l.marketplace === "electronic");
    const byProducer = {};
    beats.forEach((l) => (byProducer[l.beat.producerId] = (byProducer[l.beat.producerId] || 0) + 1));
    const nearBundle = Object.entries(byProducer).find(([, n]) => n === 1);
    const hasExclusive = beats.some((l) => l.licenseId === "exclusive");
    const releaseHint = (() => { // suggest buying the whole release when 2+ tracks from it are in the cart
      const c = {}; music.filter((l) => l.kind === "track").forEach((l) => (c[l.rel.id] = (c[l.rel.id] || 0) + 1));
      const hit = Object.entries(c).find(([id, n]) => n >= 2 && BF.releaseById[id].trackIds.length > n - 0 && !BF.isPack(BF.releaseById[id]));
      if (!hit) return "";
      const rel = BF.releaseById[hit[0]]; const fmt = BF.store.get("dlFormat");
      return `<div class="notice info" style="margin-bottom:12px">${I("disc", "i-sm")}<div><strong>Get the whole ${BF.releaseTypeName(rel.type)}.</strong> ${hit[1]} of ${rel.trackIds.length} tracks from ${esc(rel.title)} are in your cart. The full release is ${BF.money(BF.releasePrice(rel, fmt))}. <button class="link" data-action="add-music" data-kind="release" data-id="${rel.id}">Swap for full release</button></div></div>`;
    })();
    return `<div class="container cart-page">
      <div class="cart-head"><div><h1 class="h1">Cart</h1><p class="muted" style="font-size:14px;margin-top:4px">${countLabel(t)}</p></div></div>
      <div class="cart-layout">
        <section aria-label="Cart items">
          ${beats.length || packs.length ? `<div class="cart-store" data-eco="beats">
            <header class="cart-store-head"><span class="from-kicker">${I("mic", "i-xs")} Beats Store</span><span class="subtle" style="font-size:12.5px">Separate order · TBB-</span><a class="link" href="#/beats" style="font-size:13px;margin-left:auto">Keep shopping beats</a></header>
            ${beats.length ? `<h3 class="cart-group">${I("license", "i-sm")} Beat licenses</h3>
            ${nearBundle && !t.bundle ? `<div class="notice info" style="margin-bottom:12px">${I("gift", "i-sm")}<div><strong>Bundle & save 20%.</strong> Add one more lease from ${esc(BF.producerById[nearBundle[0]].name)} to unlock their bundle discount. <a class="link" href="#/beats/producer/${BF.producerById[nearBundle[0]].handle}">Browse their beats</a></div></div>` : ""}
            ${t.bundle ? `<div class="notice success" style="margin-bottom:12px">${I("check", "i-sm")}<div><strong>Bundle discount applied.</strong> You’re saving ${BF.money(t.bundle)} on multi-lease orders.</div></div>` : ""}
            <ul class="cart-list" data-queue="${beats.map((l) => l.beatId).join(",")}">${beats.map(beatLine).join("")}</ul>
            ${hasExclusive ? `<div class="notice warning" style="margin-top:12px">${I("alert", "i-sm")}<div><strong>Exclusive rights in cart.</strong> After payment the beat is removed from sale. Existing non-exclusive licenses stay valid. The producer countersigns the exclusive agreement within 48 hours.</div></div>` : ""}` : ""}
            ${packs.length ? `<h3 class="cart-group" style="margin-top:${beats.length ? 20 : 0}px">${I("folder", "i-sm")} Packs</h3><ul class="cart-list" data-queue="${packs.map((l) => l.id).join(",")}">${packs.map(packLine).join("")}</ul>` : ""}
          </div>` : ""}
          ${music.length ? `<div class="cart-store" data-eco="electronic">
            <header class="cart-store-head"><span class="from-kicker">${I("headphones", "i-xs")} Electronic Music Store</span><span class="subtle" style="font-size:12.5px">Separate order · TBE-</span><a class="link" href="#/electronic" style="font-size:13px;margin-left:auto">Keep shopping music</a></header>
            <h3 class="cart-group">${I("disc", "i-sm")} Tracks &amp; releases <span class="subtle">· downloads</span></h3>${releaseHint}<ul class="cart-list" data-queue="${music.map((l) => (l.track ? l.track.id : l.rel.trackIds[0])).join(",")}">${music.map(musicLine).join("")}</ul>
          </div>` : ""}
          ${(beats.length || packs.length) && music.length ? `<p class="hint" style="margin-top:12px">${I("info", "i-xs")} You’ll pay once. Each store issues its own order ID, receipt and library entry.</p>` : ""}
        </section>
        <aside class="cart-sum card card-pad" aria-label="Order summary">
          <h2 class="h3" style="margin-bottom:14px">Summary</h2>
          ${summaryRows(t, { removable: true })}
          ${promoForm(t)}
          <a class="btn btn-primary btn-lg btn-block" href="#/checkout" style="margin-top:16px">${music.length && !beats.length ? "Checkout" : "Continue to Checkout"} ${I("arrow-right", "i-sm")}</a>
          <ul class="trust-list">${[["lock", "Secure, encrypted payment"], ["download", "Instant downloads, re-download any time"], ["license", beats.length ? "License agreement for every beat" : "Purchase terms with every receipt"], ["shield", "Purchase protection on every order"]].map(([i, x]) => `<li>${I(i, "i-sm")} ${x}</li>`).join("")}</ul>
        </aside>
      </div></div>`;
  }

  BF.route("/cart", {
    title: "Cart",
    render: cartHTML,
    mount(el) {
      const rerender = () => { el.innerHTML = cartHTML(); BF.player.sync(); };
      const off = BF.store.on("cart", rerender);
      el.addEventListener("change", (e) => {
        const id = e.target.dataset.changeLic;
        if (id) {
          BF.store.addToCart(id, e.target.value);
          ui.toast({ kind: "info", title: "License changed", desc: `${BF.beatById[id].title} → ${BF.licenseById[e.target.value].name}`, timeout: 2200 });
          requestAnimationFrame(() => el.querySelector(`#lic-${id}`)?.focus());
        }
        const key = e.target.dataset.changeFmt;
        if (key) {
          const [kind, mid] = key.split(":");
          BF.store.set("cart", BF.store.get("cart").map((c) => (c.kind === kind && c.id === mid ? { ...c, format: e.target.value } : c)));
          ui.toast({ kind: "info", title: "Format changed", desc: e.target.value, timeout: 2000 });
          requestAnimationFrame(() => el.querySelector(`#fmt-${kind}-${mid}`)?.focus());
        }
      });
      el.addEventListener("click", (e) => {
        const r = e.target.closest("[data-remove]"); if (!r) return;
        const [kind, id] = r.dataset.remove.split(":");
        const prev = kind === "beat" ? BF.store.cartItem(id) : kind === "pack" ? BF.store.packItem(id) : BF.store.musicItem(kind, id);
        const li = r.closest(".cart-item"); li?.classList.add("removing");
        setTimeout(() => {
          const it = kind === "beat" ? BF.beatById[id] : BF.item(id);
          const name = !it ? "Item" : kind === "track" ? BF.trackTitle(it) : it.title;
          kind === "beat" ? BF.store.removeFromCart(id) : BF.store.removeMusic(kind, id);
          ui.toast({ kind: "info", title: "Removed from cart", desc: esc(name), action: { href: "#/cart", label: "Undo" }, timeout: 5000 });
          const undo = BF.$(".toast:last-child a"); if (undo && prev && it) undo.onclick = () => BF.store.set("cart", [...BF.store.get("cart"), prev]);
        }, BF.reducedMotion() ? 0 : 180);
      });
      bindPromo(el, rerender);
      return off;
    },
  });

  /* ================= CHECKOUT ================= */
  const COUNTRIES = [["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany"], ["NL", "Netherlands"], ["CA", "Canada"], ["FR", "France"], ["NG", "Nigeria"], ["BR", "Brazil"], ["JP", "Japan"], ["ZA", "South Africa"], ["AU", "Australia"], ["ES", "Spain"], ["IT", "Italy"], ["SE", "Sweden"], ["IE", "Ireland"]];

  /** The payment provider's page. In development this is the sandbox (no card data, nothing charged). */
  function payWithProvider(checkout, amount) {
    return new Promise((resolve) => {
      const c = checkout.checkout;
      if (!c) return resolve("failed");
      if (c.type === "redirect") { location.href = c.url; return; }
      let settled = false;
      ui.modal({
        title: "Sandbox checkout",
        body: `<div class="notice info" role="note">${I("shield", "i-sm")}<div><strong>Test mode — no real money moves.</strong> This stands in for the payment provider’s secure page. No card details are collected and nothing is charged.</div></div>
          <dl class="kv" style="margin:16px 0"><div><dt>Amount</dt><dd class="mono">${esc(amount)}</dd></div><div><dt>Orders</dt><dd class="mono">${checkout.orders.map((o) => o.id).join(" · ")}</dd></div></dl>`,
        foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-secondary" data-pay="decline">Simulate a declined card</button><button class="btn btn-primary" data-pay="succeed">${I("check", "i-sm")} Approve test payment</button>`,
        onMount(m, close) {
          m.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-pay]"); if (!b) return;
            m.querySelectorAll("[data-pay]").forEach((x) => (x.disabled = true));
            b.insertAdjacentHTML("beforeend", '<span class="spinner"></span>');
            try {
              const r = await BF.http.post(`/api/payments/sandbox/${c.session}/complete`, { outcome: b.dataset.pay });
              settled = true; close(); resolve(r.status === "succeeded" || r.already ? "succeeded" : "failed");
            } catch (err) { settled = true; close(); ui.toast({ kind: "error", title: "Payment failed", desc: esc(err.message) }); resolve("failed"); }
          });
          const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!settled) resolve("cancelled"); } });
          obs.observe(document.body, { childList: true });
        },
      });
    });
  }

  function checkoutHTML(_, q) {
    const s = BF.store.get("session");
    if (!s.signedIn) return `<div class="container">${ui.empty({ icon: "lock", title: "Sign in to check out", body: "Purchases, licenses and downloads are tied to your account. Your cart comes with you.", actions: `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent("/checkout")}">Sign in</a><a class="btn btn-secondary" href="#/signup">Create an account</a>` })}</div>`;
    const t = BF.store.cartTotals();
    if (!t.lines.length) return `<div class="container">${ui.empty({ icon: "bag", title: "Nothing to check out", body: "Your cart is empty.", actions: `<a class="btn btn-primary" href="#/electronic">Electronic music</a><a class="btn btn-secondary" href="#/beats/catalog">Beats</a>` })}</div>`;
    const hasBeats = t.counts.beats > 0, music = t.lines.filter((l) => l.marketplace === "electronic");
    const test = BF.env?.payments?.test_mode;
    let n = 0; const step = () => String(++n).padStart(2, "0");
    return `<div class="container checkout">
      <a class="link" href="#/cart" style="display:inline-flex;gap:6px;align-items:center;font-size:14px;margin:24px 0 8px">${I("arrow-left", "i-sm")} Back to cart</a>
      <h1 class="h1" style="margin-bottom:24px">Checkout</h1>
      ${q.cancelled ? `<div class="notice warning" style="margin-bottom:16px">${I("alert", "i-sm")}<div>Payment was cancelled. Nothing was charged — you can try again.</div></div>` : ""}
      <div class="co-layout">
        <form class="co-form" novalidate data-co>
          <div class="notice error" data-co-error hidden role="alert">${I("alert-circle", "i-sm")}<div data-co-error-msg></div></div>

          <section class="co-step"><h2 class="co-step-title"><span class="mono">${step()}</span> ${hasBeats ? "Licensee details" : "Your details"}</h2>
            ${hasBeats ? `<p class="hint" style="margin:-4px 0 14px">This name appears on your license agreements.</p>` : ""}
            <div class="form-grid">
              <div class="field"><label class="label" for="co-email">Email for receipt & downloads</label><input class="input" id="co-email" type="email" autocomplete="email" value="${esc(s.user.email ?? "")}" required maxlength="254"><div class="field-error">${I("alert-circle", "i-xs")} <span>Enter a valid email address.</span></div></div>
              <div class="field"><label class="label" for="co-legal">${hasBeats ? "Full legal name" : "Name on receipt"}</label><input class="input" id="co-legal" autocomplete="name" value="${esc(s.user.name ?? "")}" required maxlength="100"><div class="field-error">${I("alert-circle", "i-xs")} <span>${hasBeats ? "Your legal name is required on the license." : "Add a name for your receipt."}</span></div></div>
              ${hasBeats ? `<div class="field span-2"><label class="label" for="co-alias">Artist name <span class="opt">Optional</span></label><input class="input" id="co-alias" placeholder="e.g. KZN, Lil Orbit" autocomplete="nickname" maxlength="60"><span class="hint">Listed as “p/k/a” on your license so it matches your release credits.</span></div>` : ""}
            </div>
          </section>

          ${music.length ? `<section class="co-step"><h2 class="co-step-title"><span class="mono">${step()}</span> Download format</h2>
            <p class="hint" style="margin:-4px 0 14px">Applies to every track and release in this order. You can download any offered format later from your library.</p>
            <div class="pay-methods" role="radiogroup" aria-label="Download format">${Object.values(BF.FORMATS).map((f) => `<label class="pay-method"><input type="radio" name="dlfmt" value="${f.id}" ${music.every((l) => l.format === f.id) ? "checked" : ""}><span><b>${f.label}</b>&nbsp;<span class="subtle" style="font-weight:400;font-size:12px">${f.detail}</span></span></label>`).join("")}</div>
            <p class="hint" style="margin-top:8px">${music.some((l) => !l.rel.formats.includes("AIFF")) ? `${I("info", "i-xs")} Some labels don’t offer AIFF — those items fall back to WAV.` : ""}</p>
          </section>` : ""}

          <section class="co-step"><h2 class="co-step-title"><span class="mono">${step()}</span> Billing</h2>
            <div class="form-grid">
              <div class="field"><label class="label" for="co-country">Country / region</label><select class="select" id="co-country" autocomplete="country">${COUNTRIES.map(([c, nm]) => `<option value="${c}">${nm}</option>`).join("")}</select><div class="field-error">${I("alert-circle", "i-xs")} <span>Choose a supported country.</span></div></div>
              <div class="field"><label class="label" for="co-zip">ZIP / postal code</label><input class="input" id="co-zip" autocomplete="postal-code" required maxlength="12"><div class="field-error">${I("alert-circle", "i-xs")} <span>Enter a valid postal code.</span></div></div>
            </div>
          </section>

          <section class="co-step"><h2 class="co-step-title"><span class="mono">${step()}</span> Payment</h2>
            <div class="notice" style="margin-top:4px">${I("lock", "i-sm")}<div>You’ll confirm payment on the payment provider’s secure page. ${BF.brand.displayName} never sees or stores your card details.${test ? ` <b>Test mode:</b> the sandbox provider moves no real money.` : ""}</div></div>
          </section>

          <section class="co-step">
            <label class="check agree"><input type="checkbox" id="co-agree" required> <span>${hasBeats ? "I’ve reviewed the license terms for each beat" : "I understand music downloads are for personal listening and DJ performance, not redistribution"}${hasBeats && music.length ? " and the purchase terms for music downloads" : ""}, and agree to the <a class="link" href="#/legal/terms">Terms of Service</a>.</span></label>
            <div class="field-error" data-agree-err>${I("alert-circle", "i-xs")} Please confirm the terms to continue.</div>
          </section>

          <button class="btn btn-primary btn-xl btn-block co-pay" type="submit" ${t.pending ? "disabled" : ""}>${I("lock", "i-sm")} ${t.pending ? "Updating total…" : `Pay ${BF.money(t.total)}`}</button>
        </form>

        <aside class="co-sum">
          <details class="co-sum-inner card" open>
            <summary class="co-sum-head"><h2 class="h3">Order summary</h2><span class="mono" data-sum-total>${BF.money(t.total)}</span>${I("chevron-down", "i-sm chev")}</summary>
            <ul class="co-items">${t.lines.map((l) => `<li><div class="art sm"><img src="${lineArt(l)}" alt=""></div><div style="flex:1;min-width:0"><div class="truncate" style="font-weight:600;font-size:14px">${esc(lineTitle(l))}</div><div class="subtle truncate" style="font-size:12.5px">${esc(lineSub(l))}</div></div><span class="mono" style="font-size:13.5px">${BF.money(l.price)}</span></li>`).join("")}</ul>
            <a class="link" href="#/cart" style="font-size:13px;display:inline-block;margin:0 20px 8px">Edit cart</a>
            <div style="padding:0 20px 20px" data-sum>${summaryRows(t, { taxLabel: "$0.00 · digital goods", removable: true })}${promoForm(t)}</div>
          </details>
        </aside>
      </div></div>`;
  }

  BF.route("/checkout", {
    title: "Checkout", layout: "focus",
    render: checkoutHTML,
    mount(el, _, q) {
      const $ = (s) => el.querySelector(s);
      let key = BF.ikey();                        // one idempotency key per attempt: double-clicks can't create two orders
      let working = false;
      const saved = { email: null, legal: null, alias: null, country: null, zip: null, agree: false };
      const remember = () => { if (!$("#co-email")) return; saved.email = $("#co-email").value; saved.legal = $("#co-legal").value; saved.alias = $("#co-alias")?.value ?? null; saved.country = $("#co-country").value; saved.zip = $("#co-zip").value; saved.agree = $("#co-agree").checked; };
      const restore = () => { if (!$("#co-email") || saved.email == null) return; $("#co-email").value = saved.email; $("#co-legal").value = saved.legal; if ($("#co-alias") && saved.alias != null) $("#co-alias").value = saved.alias; $("#co-country").value = saved.country; $("#co-zip").value = saved.zip; $("#co-agree").checked = saved.agree; };
      const rerender = () => { if (working) return; remember(); el.innerHTML = checkoutHTML(_, q); restore(); if (window.matchMedia("(max-width: 960px)").matches) el.querySelector(".co-sum-inner")?.removeAttribute("open"); };
      const off = BF.store.on("cart", rerender);
      bindPromo(el, rerender);
      if (window.matchMedia("(max-width: 960px)").matches) el.querySelector(".co-sum-inner")?.removeAttribute("open");
      const showError = (html) => { $("[data-co-error]").hidden = !html; if (html) { $("[data-co-error-msg]").innerHTML = html; $("[data-co-error]").scrollIntoView({ behavior: "smooth", block: "center" }); } };

      el.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("has-error"));
      el.addEventListener("change", (e) => {
        if (e.target.id === "co-agree") $("[data-agree-err]").style.display = "none";
        if (e.target.name === "dlfmt") {
          const f = e.target.value;
          BF.store.set("dlFormat", f);
          BF.store.set("cart", BF.store.get("cart").map((c) => { if (!c.kind || c.kind === "pack") return c; const rel = c.kind === "release" ? BF.releaseById[c.id] : BF.releaseById[BF.trackById[c.id].releaseId]; return { ...c, format: rel.formats.includes(f) ? f : rel.formats.includes("WAV") ? "WAV" : rel.formats[0] }; }));
        }
      });
      const fieldOf = { email: "#co-email", legal_name: "#co-legal", country: "#co-country", postal_code: "#co-zip" };
      el.addEventListener("submit", async (e) => {
        if (!e.target.matches("[data-co]")) return;
        e.preventDefault();
        if (working) return;
        const t = BF.store.cartTotals();
        if (t.pending) return;
        const v = { email: $("#co-email").value.trim(), legal: $("#co-legal").value.trim(), zip: $("#co-zip").value.trim(), agree: $("#co-agree").checked };
        const bad = [["#co-email", /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)], ["#co-legal", v.legal.length >= 2], ["#co-zip", /^[A-Za-z0-9 -]{2,12}$/.test(v.zip)]].filter(([, ok]) => !ok).map(([s]) => $(s));
        bad.forEach((i) => i.closest(".field").classList.add("has-error"));
        $("[data-agree-err]").style.display = v.agree ? "none" : "flex";
        if (bad.length || !v.agree) { (bad[0] || $("#co-agree")).focus(); return; }
        if (t.problems?.length) { showError(`Some items can’t be bought: ${t.problems.map((p) => esc(p.message)).join(" ")} <a class="link" href="#/cart">Review your cart</a>`); return; }
        const btn = $(".co-pay");
        working = true; btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.insertAdjacentHTML("beforeend", '<span class="spinner"></span>');
        showError("");
        const done = () => { working = false; btn.disabled = false; btn.removeAttribute("aria-busy"); btn.querySelector(".spinner")?.remove(); };
        try {
          // The server re-prices the cart; expected_total_cents catches a price change since this page rendered
          await BF.http.put("/api/store/cart", { items: BF.store.get("cart").map((c) => (c.beatId ? { kind: "beat", id: c.beatId, license_id: c.licenseId } : { kind: c.kind, id: c.id, format: c.format ?? null })) });
          const r = await BF.http.post("/api/store/checkout", { idempotency_key: key, promo_code: BF.store.get("promo")?.code ?? null, email: v.email, legal_name: v.legal, alias: $("#co-alias")?.value.trim() || null,
            country: $("#co-country").value, postal_code: v.zip, agree: true, expected_total_cents: t.totalCents });
          const outcome = await payWithProvider(r.checkout, BF.money(r.checkout.total_cents / 100));
          if (outcome === "succeeded") {
            BF.store.set("lastCheckout", r.checkout.id);
            location.hash = `#/checkout/success?c=${r.checkout.id}`;
            return;
          }
          done();
          key = BF.ikey();   // the next attempt is a new checkout (the old one is superseded server-side)
          showError(outcome === "failed" ? "<strong>Payment declined.</strong> You have not been charged. Try again or use another payment method." : "Payment cancelled. Nothing was charged.");
        } catch (err) {
          done();
          if (err.code === "invalid_checkout" && err.fields) {
            Object.entries(err.fields).forEach(([k, msg]) => { const inp = fieldOf[k] && $(fieldOf[k]); if (inp) { const f = inp.closest(".field"); f.classList.add("has-error"); const s = f.querySelector(".field-error span"); if (s) s.textContent = msg; } });
            showError(esc(err.message));
          } else if (err.code === "price_changed") { await BF.store.refreshQuote(); key = BF.ikey(); showError("Prices changed since you opened checkout. Review the new total and pay again."); }
          else if (err.code === "cart_invalid") { await BF.store.refreshQuote(); showError(`${esc(err.message)} ${(err.extra.problems ?? []).map((p) => esc(p.message)).join(" ")} <a class="link" href="#/cart">Review your cart</a>`); }
          else showError(esc(err.message));
        }
      });
      return off;
    },
  });

  /* ================= SUCCESS ================= */
  // One payment may settle two orders — each is shown in its own store section with its own ID.
  const fileBtn = (entId, f, primary) => `<button class="btn ${primary ? "btn-primary" : "btn-secondary"} btn-sm" data-dl-ent="${entId}" data-dl-file="${f.file}" data-dl-format="${f.format}">${I("download", "i-sm")} ${esc(f.label)}</button>`;
  function orderSection(c, o, lib) {
    const beats = o.marketplace === "beats";
    return `<section class="success-order" data-eco="${o.marketplace}" aria-labelledby="so-${o.id}">
      <header class="so-head"><div><span class="from-kicker">${I(beats ? "mic" : "headphones", "i-xs")} ${beats ? "Beats Store" : "Electronic Music Store"}</span><h2 id="so-${o.id}" class="h3">Order <span class="mono">${o.id}</span></h2></div>
        <div class="so-actions"><a class="btn btn-secondary btn-sm" href="${BF.MARKETPLACES[o.marketplace].library}">${I("library", "i-sm")} ${beats ? "Beats" : "Electronic"} Library</a><a class="btn btn-ghost btn-sm" href="/api/store/orders/${o.id}/receipt" download>${I("receipt", "i-sm")} Receipt</a></div></header>
      <ul class="success-list">${o.items.map((it) => {
        const item = BF.item(it.item_id) ?? BF.beatById[it.item_id];
        const ent = lib.find((e) => e.id === it.entitlement_id);
        const art = item?.art ?? BF.art(it.item_id, "rings", "graphite");
        const play = it.kind === "release" ? item?.trackIds?.[0] : it.item_id;
        return `<li class="success-item card">
          <div class="si-top"><div class="art md"><img src="${art}" alt=""></div>
            <div style="flex:1;min-width:0"><span class="ci-kind">${{ beat: "Beat license", pack: "Pack", track: "Track", release: "Release" }[it.kind]}</span><div class="h4">${esc(it.title)}</div><div class="subtle" style="font-size:13px">${BF.money(it.paid_cents / 100)}${it.discount_cents ? ` <span class="pos">(−${BF.money(it.discount_cents / 100)})</span>` : ""}</div></div>${play && BF.item(play) ? ui.playBtn(play, "sm") : ""}</div>
          <div class="si-files">${ent ? ent.files.map((f, i) => fileBtn(ent.id, f, i === 0)).join("") : `<span class="subtle">${c.status === "paid" ? "Preparing your files…" : ""}</span>`}
            ${it.kind === "beat" && ent ? `<a class="btn btn-ghost btn-sm" href="/api/store/library/${ent.id}/license" download>${I("license", "i-sm")} License agreement</a>` : ""}</div>
          ${it.kind === "beat" && item ? `<p class="hint">Credit on release: <span class="mono" style="color:var(--text-2)">Prod. by ${esc(BF.producerById[item.producerId]?.name ?? "")}</span>${it.license_id === "exclusive" ? " · Exclusive: the beat has been removed from sale." : ""}</p>` : ""}
        </li>`; }).join("")}</ul></section>`;
  }

  BF.route("/checkout/success", {
    title: "Purchase complete", layout: "focus",
    render: () => `<div class="container success" data-success><div class="boot-loading"><span class="spinner"></span><span class="subtle">Confirming your payment…</span></div></div>`,
    mount(el, _, q) {
      const id = q.c || BF.store.get("lastCheckout");
      const host = el.querySelector("[data-success]") || el;
      let alive = true, tries = 0;
      const draw = (c, lib) => {
        const paid = c.status === "paid";
        host.innerHTML = `<div class="success-hero">
            <div class="success-mark" aria-hidden="true">${I(paid ? "check" : "clock", "i-lg")}</div>
            <span class="eyebrow no-rule">Payment ${esc(c.payment?.id ?? "")} · ${c.orders.length} order${c.orders.length > 1 ? "s" : ""}${c.payment?.test_mode ? " · TEST MODE" : ""}</span>
            <h1 class="display success-title">${paid ? "Purchase complete." : c.status === "requires_payment" ? "Waiting for payment…" : "Payment not completed."}</h1>
            <p class="body-lg">${paid ? `Your files are below and saved to your libraries. Receipts are available for each order${c.payment?.test_mode ? " (test mode: no money moved)" : ""}.` : c.status === "requires_payment" ? "This usually takes a few seconds." : "Nothing was charged. Your cart is unchanged."}</p>
          </div>
          ${paid ? c.orders.map((o) => orderSection(c, o, lib)).join("") : ""}
          <div class="receipt card card-pad">
            <h2 class="h4" style="margin-bottom:12px">${I("receipt", "i-sm")} Payment summary</h2>
            <dl class="kv">
              ${c.orders.map((o) => `<div><dt>${BF.MARKETPLACES[o.marketplace].name} order</dt><dd class="mono">${o.id} · ${BF.money(o.total_cents / 100)} · ${esc(o.status)}</dd></div>`).join("")}
              <div><dt>Date</dt><dd>${new Date(c.created_at).toLocaleString()}</dd></div>
              <div><dt>${c.orders.some((o) => o.marketplace === "beats") ? "Licensee" : "Customer"}</dt><dd>${esc(c.legal_name)}${c.alias ? ` p/k/a ${esc(c.alias)}` : ""}</dd></div>
              ${c.discount_cents ? `<div><dt>Discounts</dt><dd class="mono">−${BF.money(c.discount_cents / 100)}${c.promo_code ? ` (${esc(c.promo_code)})` : ""}</dd></div>` : ""}
              <div><dt>Total ${paid ? "paid" : "due"}</dt><dd class="mono" style="font-weight:700;color:var(--text)">${BF.money(c.total_cents / 100)}</dd></div>
            </dl>
          </div>
          <div class="success-ctas">${c.orders.map((o, i) => `<a class="btn ${i === 0 ? "btn-primary" : "btn-secondary"} btn-lg" href="${BF.MARKETPLACES[o.marketplace].library}">${I("library", "i-sm")} View ${o.marketplace === "beats" ? "Beats" : "Electronic"} Library</a>`).join("")}</div>`;
      };
      const load = async () => {
        if (!id) { host.innerHTML = ui.empty({ icon: "receipt", title: "No recent order", body: "Your purchases are always in your libraries.", actions: `<a class="btn btn-primary" href="#/beats/library">Beats Library</a><a class="btn btn-secondary" href="#/electronic/library">Electronic Library</a>` }); return; }
        try {
          const { checkout: c } = await BF.http.get(`/api/store/checkouts/${encodeURIComponent(id)}`);
          if (!alive) return;
          if (c.status === "requires_payment" && tries++ < 20) { draw(c, []); setTimeout(load, 1000); return; }
          if (c.status === "paid") { await Promise.all([BF.store.refreshLibrary(), BF.refreshCatalog()]); BF.store.set("cart", BF.store.get("cart")); }
          if (alive) draw(c, BF.store.get("library"));
        } catch (err) { if (alive) host.innerHTML = ui.empty({ kind: "error", icon: "alert", title: "We couldn’t load this order", body: esc(err.message), actions: `<button class="btn btn-primary" data-reload>Try again</button>` }); }
      };
      host.addEventListener("click", (e) => { const b = e.target.closest("[data-dl-ent]"); if (b) BF.downloads.start(b); });
      load();
      return () => { alive = false; };
    },
  });
})();
