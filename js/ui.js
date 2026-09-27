/* ==========================================================================
   UI kit — formatting helpers + reusable component renderers + overlays.
   Components are pure functions returning HTML strings; behaviour is wired
   through delegated [data-action] handlers (see bindGlobalActions).
   ========================================================================== */
(function () {
  const I = BF.icon;

  /* ---------- Helpers ---------- */
  BF.$ = (s, el = document) => el.querySelector(s);
  BF.$$ = (s, el = document) => [...el.querySelectorAll(s)];
  BF.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  BF.money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  BF.money0 = (n) => "$" + Math.round(n).toLocaleString("en-US");
  BF.num = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n));
  BF.time = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  BF.ago = (d) => (d === 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? `${d}d ago` : d < 30 ? `${Math.floor(d / 7)}w ago` : `${Math.floor(d / 30)}mo ago`);
  BF.date = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  BF.producerOf = (beat) => BF.producerById[beat.producerId];
  BF.fillProducer = (text, beat) => text.replace("{producer}", BF.producerOf(beat).name);
  BF.reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Atoms ---------- */
  BF.ui = {};
  const ui = BF.ui;

  ui.playBtn = (beatId, cls = "") =>
    `<button class="play-btn ${cls}" data-action="play" data-beat="${beatId}" aria-label="Play ${BF.esc(BF.item(beatId) ? (BF.item(beatId).kind === "track" ? BF.trackTitle(BF.item(beatId)) : BF.item(beatId).title) : "")}" aria-pressed="false">${I("play", "ic-play")}${I("pause", "ic-pause")}</button>`;

  ui.favBtn = (beatId, cls = "icon-btn") => {
    const on = BF.store.isFav(beatId);
    return `<button class="${cls} fav-btn" data-action="fav" data-beat="${beatId}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} favorites">${I("heart", "ic-heart")}${I("heart-fill", "ic-heart-fill")}</button>`;
  };

  ui.priceBtn = (beat) => {
    const inCart = BF.store.cartItem(beat.id);
    return `<button class="price-btn ${inCart ? "in-cart" : ""}" data-action="license" data-beat="${beat.id}" aria-label="${inCart ? "In cart — change license for" : "Choose a license for"} ${BF.esc(beat.title)}, from ${BF.money(BF.basePrice(beat))}">
      ${inCart ? I("check", "i-xs") : I("bag-plus", "i-xs")}${inCart ? "In cart" : BF.money(BF.basePrice(beat))}</button>`;
  };

  ui.producerLink = (p, cls = "") =>
    `<a href="#/beats/producer/${p.handle}" class="${cls}"><span class="truncate">${BF.esc(p.name)}</span>${p.verified ? BF.verifiedSeal() : ""}</a>`;

  ui.stars = (n) => `<span class="stars" role="img" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => I("star-fill", i <= Math.round(n) ? "" : "off")).join("")}</span>`;

  ui.spec = (b, opts = {}) =>
    `<span class="spec"><span class="hl">${b.bpm} BPM</span><span>${b.key}</span>${opts.genre ? `<span>${BF.genreById[b.genre].name}</span>` : ""}${opts.dur !== false ? `<span>${BF.time(b.duration)}</span>` : ""}</span>`;

  ui.badgeForBeat = (b) => {
    if (b.freeDownload) return `<span class="badge badge-success">Free DL</span>`;
    if (b.daysAgo < 10) return `<span class="badge badge-accent">New</span>`;
    if (b.trendScore > 95) return `<span class="badge badge-cyan">${I("fire", "i-xs")} Hot</span>`;
    return "";
  };

  /* ---------- Beat card (grid) ---------- */
  ui.beatCard = (b, opts = {}) => {
    const p = BF.producerOf(b);
    return `<article class="beat-card" data-beat-card="${b.id}">
      <div class="art">
        <img src="${b.art}" alt="" loading="lazy" width="300" height="300">
        <div class="art-overlay">${ui.playBtn(b.id, "lg")}</div>
        <div class="art-top">${ui.badgeForBeat(b) || "<span></span>"}${ui.favBtn(b.id, "art-fav")}</div>
      </div>
      <div class="body">
        <div class="title-row"><a class="title truncate" href="#/beats/beat/${b.id}">${BF.esc(b.title)}</a></div>
        ${ui.producerLink(p, "producer")}
        <div class="card-spec">${ui.spec(b, { dur: opts.dur ?? false })}</div>
        <div class="foot"><span class="subtle card-genre">${BF.genreById[b.genre].name}</span>${ui.priceBtn(b)}</div>
      </div>
    </article>`;
  };

  /* ---------- Beat row (compact list) ---------- */
  ui.beatListHead = () => `<div class="beat-list-head" aria-hidden="true"><span>#</span><span></span><span>Title</span><span class="c-genre">Genre</span><span class="c-bpm">BPM</span><span class="c-key">Key</span><span class="c-dur">Time</span><span class="c-tags">Tags</span><span></span></div>`;
  ui.beatRow = (b, i) => {
    const p = BF.producerOf(b);
    return `<div class="beat-row" role="listitem" data-beat-card="${b.id}">
      <div class="num"><span class="n">${i + 1}</span><button class="row-play" data-action="play" data-beat="${b.id}" aria-label="Play ${BF.esc(b.title)}">${I("play", "i-sm ic-play")}${I("pause", "i-sm ic-pause")}</button></div>
      <div class="art sm"><img src="${b.art}" alt="" loading="lazy"></div>
      <div class="cell-main"><a class="title truncate" href="#/beats/beat/${b.id}">${BF.esc(b.title)}</a><span class="cell truncate">${ui.producerLink(p, "producer")}</span></div>
      <span class="cell c-genre">${BF.genreById[b.genre].name}</span>
      <span class="cell mono c-bpm">${b.bpm}</span>
      <span class="cell mono c-key">${b.key}</span>
      <span class="cell mono c-dur">${BF.time(b.duration)}</span>
      <div class="tags c-tags">${b.tags.slice(0, 2).map((t) => `<a class="tag" href="#/beats/catalog?q=${encodeURIComponent(t)}">${BF.esc(t)}</a>`).join("")}</div>
      <div class="actions">${ui.favBtn(b.id, "icon-btn sm")}<button class="icon-btn sm more" data-action="more" data-beat="${b.id}" aria-label="More actions for ${BF.esc(b.title)}">${I("more", "i-sm")}</button>${ui.priceBtn(b)}</div>
    </div>`;
  };

  /* ---------- Producer card ---------- */
  ui.producerCard = (p) => {
    const beats = p.beatIds.slice(0, 3).map((id) => BF.beatById[id]);
    const following = BF.store.isFollowing(p.id);
    return `<article class="producer-card">
      <div class="top">
        <a href="#/beats/producer/${p.handle}" class="avatar md" aria-hidden="true" tabindex="-1"><img src="${p.avatar}" alt=""></a>
        <div style="min-width:0;flex:1">
          <a href="#/beats/producer/${p.handle}" class="name"><span class="truncate">${BF.esc(p.name)}</span>${p.verified ? BF.verifiedSeal() : ""}</a>
          <div class="subtle" style="font-size:13px;display:flex;align-items:center;gap:4px">${I("pin", "i-xs")}${BF.esc(p.location)}</div>
        </div>
        <button class="btn btn-sm ${following ? "btn-secondary" : "btn-outline"}" data-action="follow" data-producer="${p.id}" aria-pressed="${following}">${following ? "Following" : "Follow"}</button>
      </div>
      <div class="mini-arts">${beats.map((b) => `<a class="art" href="#/beats/beat/${b.id}" aria-label="${BF.esc(b.title)}"><img src="${b.art}" alt="" loading="lazy"></a>`).join("")}</div>
      <div class="stats"><span><b>${BF.num(p.followers)}</b> followers</span><span><b>${BF.num(p.sales)}</b> sales</span><span>${I("star-fill", "i-xs")} <b>${p.rating}</b></span></div>
    </article>`;
  };

  /* ---------- Waveform: defined in js/music/deck.js (canvas, drawn from each item's analysed audio) ---------- */

  /* ---------- States ---------- */
  ui.empty = ({ icon = "music", title, body, actions = "", kind = "" }) =>
    `<div class="state ${kind}" role="${kind === "error" ? "alert" : "status"}"><div class="state-icon">${I(icon)}</div><h3>${title}</h3>${body ? `<p>${body}</p>` : ""}${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;

  ui.skeletonCards = (n = 8) =>
    `<div class="grid-beats" aria-busy="true" aria-label="Loading beats">${Array.from({ length: n }, () => `<div><div class="skeleton sk-art"></div><div class="skeleton sk-line" style="width:70%;margin-top:14px"></div><div class="skeleton sk-line" style="width:45%"></div><div class="skeleton sk-line" style="width:85%;margin-top:10px"></div></div>`).join("")}</div>`;

  ui.skeletonRows = (n = 8) =>
    `<div aria-busy="true" aria-label="Loading">${Array.from({ length: n }, () => `<div style="display:flex;gap:14px;align-items:center;padding:10px 12px"><div class="skeleton" style="width:44px;height:44px"></div><div style="flex:1"><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton sk-line" style="width:24%;margin:0"></div></div><div class="skeleton" style="width:80px;height:30px"></div></div>`).join("")}</div>`;

  ui.sectionHead = (idx, eyebrow, title, link) =>
    `<div class="section-head"><div class="left"><span class="eyebrow"><span class="idx">${idx}</span>${eyebrow}</span><h2 class="h2">${title}</h2></div>${link || ""}</div>`;

  /* ==========================================================================
     Overlays
     ========================================================================== */

  /* ---------- Toasts ---------- */
  ui.toast = ({ title, desc = "", kind = "success", art = "", action = null, timeout = 3600 }) => {
    const region = BF.$("#toasts");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.innerHTML = `${art ? `<div class="t-art"><img src="${art}" alt=""></div>` : `<div class="t-icon">${I(kind === "error" ? "alert-circle" : kind === "info" ? "info" : "check", "i-sm")}</div>`}
      <div class="t-body"><div class="t-title">${title}</div>${desc ? `<div class="t-desc">${desc}</div>` : ""}</div>
      ${action ? `<a class="btn btn-sm btn-ghost" href="${action.href}">${action.label}</a>` : ""}
      <button class="icon-btn sm" aria-label="Dismiss notification">${I("x", "i-sm")}</button>`;
    const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 200); };
    el.querySelector("button[aria-label^=Dismiss]").onclick = close;
    el.querySelector("a")?.addEventListener("click", close);
    region.appendChild(el);
    while (region.children.length > 3) region.firstElementChild.remove();
    if (timeout) setTimeout(close, timeout);
  };

  /* ---------- Focus trap shared by modal/drawer/sheet ---------- */
  function trap(container, onClose) {
    const prev = document.activeElement;
    const focusables = () => BF.$$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', container).filter((e) => e.offsetParent !== null);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    container.addEventListener("keydown", onKey);
    requestAnimationFrame(() => (container.querySelector("[autofocus]") || focusables()[0])?.focus());
    return () => { container.removeEventListener("keydown", onKey); prev && prev.focus && prev.focus(); };
  }
  BF.trap = trap;

  /* ---------- Modal ---------- */
  ui.modal = ({ title, body, foot = "", wide = false, onMount, labelId = "m" + Date.now() }) => {
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${labelId}">
      <div class="modal-head"><h2 id="${labelId}">${title}</h2><button class="icon-btn sm" data-close aria-label="Close dialog">${I("x", "i-sm")}</button></div>
      <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div>`;
    document.body.appendChild(bd);
    document.body.style.overflow = "hidden";
    let release;
    const close = () => { release && release(); bd.remove(); if (!BF.$(".modal-backdrop, .drawer, .player-sheet")) document.body.style.overflow = ""; };
    bd.addEventListener("click", (e) => { if (e.target === bd || e.target.closest("[data-close]")) close(); });
    release = trap(bd, close);
    onMount && onMount(bd, close);
    return close;
  };

  ui.confirm = ({ title, body, confirmLabel = "Confirm", danger = false }) =>
    new Promise((resolve) => {
      let done = false;
      ui.modal({
        title, body: `<p class="muted">${body}</p>`,
        foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${confirmLabel}</button>`,
        onMount(el, c) {
          el.querySelector("[data-ok]").onclick = () => { done = true; c(); resolve(true); };
          el.addEventListener("click", (e) => { if (!done && (e.target === el || e.target.closest("[data-close]"))) resolve(false); });
        },
      });
    });

  /* ---------- Drawer ---------- */
  ui.drawer = ({ title, body, foot = "", side = "right", onMount }) => {
    const bd = document.createElement("div"); bd.className = "drawer-backdrop";
    const dr = document.createElement("aside"); dr.className = `drawer ${side}`; dr.setAttribute("role", "dialog"); dr.setAttribute("aria-modal", "true"); dr.setAttribute("aria-label", title.replace(/<[^>]+>/g, ""));
    dr.innerHTML = `<div class="drawer-head"><h2 class="h3">${title}</h2><button class="icon-btn sm" data-close aria-label="Close panel">${I("x", "i-sm")}</button></div><div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ""}`;
    document.body.append(bd, dr);
    document.body.style.overflow = "hidden";
    let release;
    const close = () => { release && release(); bd.remove(); dr.remove(); if (!BF.$(".modal-backdrop, .drawer, .player-sheet")) document.body.style.overflow = ""; };
    bd.onclick = close;
    dr.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    release = trap(dr, close);
    onMount && onMount(dr, close);
    return close;
  };

  /* ==========================================================================
     License selection flow (modal) — used from every "price" button
     ========================================================================== */
  // A tier can be bought when exclusive rights are still available (for exclusives) and the beat can deliver its files
  // (tiers with stems need the producer to have uploaded stems — the server enforces the same rule at checkout).
  BF.licAvailable = (beat, id) => { const l = BF.licenseById[id]; return !!l && (!l.exclusive || beat.exclusiveAvailable) && (!beat.licensesAvailable || beat.licensesAvailable.includes(id)); };
  BF.licUnavailableLabel = (beat, l) => (l.exclusive && !beat.exclusiveAvailable ? (beat.status === "sold_exclusive" ? "Sold" : "Not offered") : "No stems");
  BF.defaultLic = (beat, prefer = "premium") => (BF.licAvailable(beat, prefer) ? prefer : BF.LICENSES.find((l) => BF.licAvailable(beat, l.id))?.id ?? "basic");
  ui.licenseOption = (beat, l, selected, name = "lic") => {
    const price = BF.priceFor(beat, l.id);
    const disabled = !BF.licAvailable(beat, l.id);
    return `<label class="lic-option ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}">
      <input type="radio" name="${name}" value="${l.id}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span class="lic-radio" aria-hidden="true"></span>
      <span class="lic-main">
        <span class="lic-name">${l.name}${l.popular ? ` <span class="badge badge-accent">Most chosen</span>` : ""}</span>
        <span class="lic-files">${l.files}</span>
      </span>
      <span class="lic-price mono">${disabled ? BF.licUnavailableLabel(beat, l) : BF.money(price)}</span>
    </label>`;
  };

  ui.licenseTerms = (beat, l) =>
    `<dl class="terms">${l.terms.map(([k, v]) => `<div><dt>${k}</dt><dd>${BF.esc(BF.fillProducer(v, beat))}</dd></div>`).join("")}</dl>`;

  ui.openLicensePicker = (beatId) => {
    const beat = BF.beatById[beatId];
    const p = BF.producerOf(beat);
    const current = BF.store.cartItem(beatId)?.licenseId || BF.defaultLic(beat);
    ui.modal({
      title: "Choose a license",
      wide: true,
      body: `<div class="lp-beat"><div class="art md"><img src="${beat.art}" alt=""></div><div style="min-width:0"><div class="h4">${BF.esc(beat.title)}</div><div class="muted" style="font-size:13px">${BF.esc(p.name)} · ${ui.spec(beat)}</div></div>${ui.playBtn(beat.id, "sm")}</div>
        <div class="lp-grid">
          <fieldset class="lic-list"><legend class="sr-only">License type</legend>${BF.LICENSES.map((l) => ui.licenseOption(beat, l, l.id === current)).join("")}</fieldset>
          <div class="lp-terms" aria-live="polite"></div>
        </div>
        <p class="hint" style="margin-top:14px">${I("info", "i-xs")} Terms are configured by ${BF.esc(p.name)}. A full license agreement is generated with your order — review it before use. This is not legal advice.</p>`,
      foot: `<a class="btn btn-ghost" href="#/beats/beat/${beat.id}" data-close>View beat</a><button class="btn btn-primary" data-add>${I("bag-plus", "i-sm")}<span>Add to cart</span></button>`,
      onMount(el, close) {
        const termsEl = el.querySelector(".lp-terms");
        const addBtn = el.querySelector("[data-add]");
        const render = () => {
          const id = el.querySelector("input[name=lic]:checked").value;
          const l = BF.licenseById[id];
          el.querySelectorAll(".lic-option").forEach((o) => o.classList.toggle("is-selected", o.querySelector("input").checked));
          termsEl.innerHTML = `<div class="lp-terms-head"><span class="eyebrow no-rule">What’s included</span><span class="mono" style="font-weight:700">${BF.money(BF.priceFor(beat, id))}</span></div><p class="muted" style="font-size:13px;margin:4px 0 12px">${l.summary}</p>${ui.licenseTerms(beat, l)}
            ${l.exclusive ? `<button class="btn btn-sm btn-outline" style="margin-top:12px" data-action="message" data-producer="${p.id}">${I("message", "i-sm")} Make an offer instead</button>` : ""}`;
          addBtn.querySelector("span").textContent = l.exclusive ? "Add exclusive to cart" : BF.store.cartItem(beat.id) ? "Update license" : "Add to cart";
        };
        el.addEventListener("change", render);
        render();
        addBtn.onclick = () => {
          const id = el.querySelector("input[name=lic]:checked").value;
          addBtn.classList.add("is-loading"); addBtn.insertAdjacentHTML("beforeend", '<span class="spinner"></span>');
          setTimeout(() => {
            const res = BF.store.addToCart(beat.id, id);
            close();
            ui.toast({ title: res === "added" ? "Added to cart" : "License updated", desc: `${BF.esc(beat.title)} · ${BF.licenseById[id].name}`, art: beat.art, action: { href: "#/cart", label: "View cart" } });
          }, 380);
        };
      },
    });
  };

  /* ---------- Report content workflow ---------- */
  ui.openReport = (beatId) => {
    const beat = BF.beatById[beatId];
    ui.modal({
      title: "Report this beat",
      body: `<p class="muted" style="margin-bottom:16px">Reports go to our Trust &amp; Safety team and are reviewed within 2 business days. The producer isn’t told who reported.</p>
        <form class="stack-16" id="reportForm" novalidate>
          <fieldset class="stack-8"><legend class="label" style="margin-bottom:6px">What’s the issue?</legend>
            ${[["ip", "Uses my copyrighted work (sample, melody or recording)"], ["ip", "Uncleared sample"], ["impersonation", "Impersonation of another producer"], ["scam", "Misleading license terms"], ["hate", "Offensive or inappropriate content"], ["other", "Other"]]
              .map(([v, r], i) => `<label class="check"><input type="radio" name="reason" value="${v}" data-i="${i}"> ${r}</label>`).join("")}
          </fieldset>
          <div class="field"><label class="label" for="rp-detail">Details <span class="opt">Required</span></label><textarea class="textarea" id="rp-detail" placeholder="Include links to original work, timestamps, or registration numbers."></textarea><div class="field-error">${I("alert-circle", "i-xs")} Add a short description so we can review this.</div></div>
          <div class="notice info">${I("info", "i-sm")}<div>Rights holders filing a formal copyright notice can also use our <a class="link" href="#/legal/copyright">copyright claim process</a>.</div></div>
        </form>`,
      foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" data-send>${I("flag", "i-sm")} Submit report</button>`,
      onMount(el, close) {
        el.querySelector("[data-send]").onclick = () => {
          const reason = el.querySelector("input[name=reason]:checked");
          const detail = el.querySelector("#rp-detail");
          const f = detail.closest(".field");
          f.classList.toggle("has-error", detail.value.trim().length < 10);
          if (!reason) { ui.toast({ kind: "error", title: "Choose a reason", desc: "Select what best describes the issue." }); return; }
          if (detail.value.trim().length < 10) { detail.focus(); return; }
          if (!BF.store.get("session").signedIn) { close(); location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`; return; }
          const label = reason.closest("label").textContent.trim();
          BF.http.post("/api/reports", { target_type: "beat", target_id: beat.id, reason: reason.value, details: `[${label}] ${detail.value.trim()}`.slice(0, 1000) })
            .then((r) => { close(); ui.toast({ kind: "info", title: r.already_reported ? "You already reported this beat" : "Report received", desc: `Trust & Safety will review “${BF.esc(beat.title)}”.` }); })
            .catch((err) => ui.toast({ kind: "error", title: "Report not sent", desc: BF.esc(err.message) }));
        };
      },
    });
  };

  /* ---------- Contact producer ---------- */
  ui.openMessage = (producerId) => {
    const p = BF.producerById[producerId];
    ui.modal({
      title: `Message ${BF.esc(p.name)}`,
      body: `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px"><div class="avatar md"><img src="${p.avatar}" alt=""></div><div><div class="h4" style="display:flex;gap:5px;align-items:center">${BF.esc(p.name)}${p.verified ? BF.verifiedSeal() : ""}</div><div class="subtle" style="font-size:13px">Usually replies in ${p.responseTime}</div></div></div>
        <div class="stack-16"><div class="field"><label class="label" for="msg-topic">Topic</label><select class="select" id="msg-topic"><option>Exclusive rights offer</option><option>Custom beat request</option><option>License question</option><option>Collaboration</option><option>Other</option></select></div>
        <div class="field"><label class="label" for="msg-body">Message</label><textarea class="textarea" id="msg-body" placeholder="Share your budget, timeline and references."></textarea><div class="field-error">${I("alert-circle", "i-xs")} Write a message before sending.</div></div>
        <p class="hint">${I("shield", "i-xs")} Keep payments on ${BF.brand.displayName}. Off-platform deals aren’t covered by purchase protection.</p></div>`,
      foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-send>${I("message", "i-sm")} Send message</button>`,
      onMount(el, close) {
        el.querySelector("[data-send]").onclick = () => {
          const t = el.querySelector("#msg-body");
          t.closest(".field").classList.toggle("has-error", !t.value.trim());
          if (!t.value.trim()) return t.focus();
          if (!BF.store.get("session").signedIn) { close(); location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`; return; }
          if (!p.userId) { ui.toast({ kind: "error", title: "This producer can’t receive messages" }); return; }
          const topic = el.querySelector("#msg-topic")?.value;
          const btn = el.querySelector("[data-send]"); btn.disabled = true;
          BF.http.post("/api/conversations", { user_ids: [p.userId] })
            .then((r) => BF.http.post(`/api/conversations/${r.conversation.id}/messages`, { kind: "text", body: `${topic ? `[${topic}] ` : ""}${t.value.trim()}`, client_id: BF.ikey() }).then(() => r.conversation.id))
            .then((cid) => { close(); ui.toast({ title: "Message sent", desc: `Continue the conversation in Messages.`, action: { href: `#/social/messages/${cid}`, label: "Open" } }); })
            .catch((err) => { btn.disabled = false; ui.toast({ kind: "error", title: "Message not sent", desc: BF.esc(err.message) }); });
        };
      },
    });
  };

  /* ---------- Row "more" menu (as a sheet-style modal on all sizes) ---------- */
  ui.openMore = (beatId) => {
    const b = BF.beatById[beatId]; const p = BF.producerOf(b);
    ui.modal({
      title: BF.esc(b.title),
      body: `<div class="menu-list">
        <button class="menu-item" data-a="queue">${I("queue", "i-sm")} Add to queue</button>
        <button class="menu-item" data-a="playlist">${I("playlist", "i-sm")} Add to playlist</button>
        <a class="menu-item" href="#/beats/producer/${p.handle}" data-close>${I("user", "i-sm")} Go to producer</a>
        <button class="menu-item" data-a="share">${I("share", "i-sm")} Copy link</button>
        <div class="menu-sep"></div>
        <button class="menu-item danger" data-a="report">${I("flag", "i-sm")} Report</button></div>`,
      onMount(el, close) {
        el.addEventListener("click", (e) => {
          const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
          close();
          if (a === "queue") { BF.player.enqueue(b.id); ui.toast({ title: "Added to queue", desc: BF.esc(b.title), art: b.art }); }
          if (a === "playlist") ui.openAddToPlaylist(b.id);
          if (a === "share") ui.copyLink(`#/beats/beat/${b.id}`);
          if (a === "report") ui.openReport(b.id);
        });
      },
    });
  };

  ui.openAddToPlaylist = (beatId) => {
    if (!BF.store.get("session").signedIn) { location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`; return; }
    const lists = BF.store.get("playlists");
    ui.modal({
      title: "Add to playlist",
      body: `<div class="menu-list">${lists.map((l) => `<button class="menu-item" data-pl="${l.id}">${I("playlist", "i-sm")} ${BF.esc(l.title)} <span class="subtle mono" style="margin-left:auto;font-size:12px">${l.beatIds.includes(beatId) ? "added" : l.beatIds.length}</span></button>`).join("")}
        <div class="menu-sep"></div>
        <form class="field" data-new style="margin-top:8px"><label class="label" for="npl">New playlist</label><div style="display:flex;gap:8px"><input class="input" id="npl" placeholder="e.g. Summer EP ideas" maxlength="60"><button class="btn btn-secondary">Create</button></div></form></div>`,
      onMount(el, close) {
        el.addEventListener("click", async (e) => {
          const id = e.target.closest("[data-pl]")?.dataset.pl; if (!id) return;
          try { const added = await BF.store.addToPlaylistId(id, beatId); close(); ui.toast({ kind: added ? "success" : "info", title: added ? "Saved to playlist" : "Already in playlist", desc: BF.esc(lists.find((l) => l.id === id).title) }); }
          catch (err) { ui.toast({ kind: "error", title: "Couldn’t save", desc: BF.esc(err.message) }); }
        });
        el.querySelector("[data-new]").onsubmit = async (e) => {
          e.preventDefault(); const v = el.querySelector("#npl").value.trim(); if (!v) return;
          try { await BF.store.createPlaylist("beats", v, [beatId]); close(); ui.toast({ title: "Playlist created", desc: BF.esc(v) }); }
          catch (err) { ui.toast({ kind: "error", title: "Couldn’t create it", desc: BF.esc(err.message) }); }
        };
      },
    });
  };

  ui.copyLink = (hash) => {
    const url = location.href.split("#")[0] + hash;
    (navigator.clipboard?.writeText(url) || Promise.reject()).then(
      () => ui.toast({ kind: "info", title: "Link copied" }),
      () => ui.toast({ kind: "info", title: "Share link", desc: BF.esc(url), timeout: 6000 })
    );
  };

  /* ---------- License document viewer ---------- */
  ui.openLicenseDoc = (purchase) => {
    const beat = BF.beatById[purchase.beatId]; const p = BF.producerOf(beat); const l = BF.licenseById[purchase.license];
    const buyer = BF.store.get("session").user?.name || "Licensee";
    ui.modal({
      title: "License agreement",
      wide: true,
      body: `<article class="license-doc">
        <header><div>${BF.brand.mark(24)}</div><div class="mono subtle" style="font-size:12px;text-align:right">Order ${purchase.orderId}<br>Issued ${BF.date(purchase.date)}</div></header>
        <h3 class="h2" style="margin:18px 0 4px">${l.name}</h3>
        <p class="muted">Non-transferable license for “${BF.esc(beat.title)}” (${beat.bpm} BPM, ${beat.key}).</p>
        <div class="doc-parties"><div><span class="eyebrow no-rule">Licensor</span><strong>${BF.esc(p.name)}</strong><span class="subtle">@${p.handle}</span></div><div><span class="eyebrow no-rule">Licensee</span><strong>${BF.esc(buyer)}</strong><span class="subtle">${purchase.orderId}</span></div></div>
        ${ui.licenseTerms(beat, l)}
        <p class="hint" style="margin-top:16px">Summary of terms configured by the licensor at time of purchase. The licensor represents they hold the rights needed to grant this license. ${BF.brand.displayName} facilitates the transaction and is not a party to the license. Keep this document with your release records.</p>
      </article>`,
      foot: `<button class="btn btn-ghost" data-close>Close</button>${purchase.entitlementId ? `<a class="btn btn-secondary" href="/api/store/library/${purchase.entitlementId}/license" download>${I("download", "i-sm")} Download agreement (.txt)</a>` : ""}`,
    });
  };

  /* ==========================================================================
     Delegated actions
     ========================================================================== */
  BF.bindGlobalActions = function () {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const a = el.dataset.action;
      const beatId = el.dataset.beat;
      switch (a) {
        case "play": {
          e.preventDefault();
          const qEl = el.closest("[data-queue]");
          const queue = qEl ? qEl.dataset.queue.split(",") : null;
          BF.player.playBeat(beatId, queue);
          break;
        }
        case "fav": {
          e.preventDefault();
          const on = BF.store.toggleFav(beatId);
          BF.$$(`.fav-btn[data-beat="${beatId}"]`).forEach((b) => {
            b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", `${on ? "Remove from" : "Add to"} favorites`);
            b.classList.remove("pop"); void b.offsetWidth; if (on && !BF.reducedMotion()) b.classList.add("pop");
          });
          ui.toast({ kind: "info", title: on ? "Saved to favorites" : "Removed from favorites", desc: BF.esc(BF.item(beatId).kind === "track" ? BF.trackTitle(BF.item(beatId)) : BF.item(beatId).title), timeout: 2200 });
          break;
        }
        case "license": e.preventDefault(); ui.openLicensePicker(beatId); break;
        case "follow": {
          e.preventDefault();
          const pid = el.dataset.producer;
          const on = BF.store.toggleFollow(pid);
          BF.$$(`[data-action="follow"][data-producer="${pid}"]`).forEach((b) => {
            b.setAttribute("aria-pressed", on);
            const off = b.dataset.off || "btn-outline";
            b.classList.toggle("btn-secondary", on); b.classList.toggle(off, !on);
            const label = b.querySelector("span") || b; label.textContent = on ? "Following" : "Follow";
          });
          ui.toast({ kind: "info", title: on ? `Following ${BF.producerById[pid].name}` : `Unfollowed ${BF.producerById[pid].name}`, desc: on ? "New drops will show in your feed." : "", timeout: 2400 });
          break;
        }
        case "more": e.preventDefault(); ui.openMore(beatId); break;
        case "report": e.preventDefault(); ui.openReport(beatId); break;
        case "playlist": e.preventDefault(); ui.openAddToPlaylist(beatId); break;
        case "toast": e.preventDefault(); ui.toast({ kind: "info", title: BF.esc(el.dataset.title ?? ""), desc: BF.esc(el.dataset.desc ?? "") }); break;
        case "message": e.preventDefault(); BF.$(".modal-backdrop [data-close]")?.click(); ui.openMessage(el.dataset.producer); break;
        case "share": e.preventDefault(); ui.copyLink(el.dataset.href || location.hash); break;
        case "search": e.preventDefault(); BF.search.open(el.dataset.q || ""); break;
        case "license-doc": {
          e.preventDefault();
          const pur = BF.store.get("purchases").find((x) => x.orderId === el.dataset.order && x.beatId === beatId);
          if (pur) ui.openLicenseDoc(pur);
          break;
        }
        case "download": e.preventDefault(); location.hash = beatId && BF.packById[beatId] ? "#/beats/library?tab=packs" : "#/beats/library"; break;
      }
    });

    // Dropdown menus
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-dropdown]");
      BF.$$(".dropdown.open").forEach((d) => { if (!trigger || d !== trigger.closest(".dropdown")) { d.classList.remove("open"); d.querySelector("[data-dropdown]")?.setAttribute("aria-expanded", "false"); } });
      if (trigger) {
        const d = trigger.closest(".dropdown"); const open = !d.classList.contains("open");
        d.classList.toggle("open", open); trigger.setAttribute("aria-expanded", open);
        if (open) d.querySelector(".menu .menu-item")?.focus();
      }
    });
    document.addEventListener("keydown", (e) => {
      const menu = e.target.closest?.(".dropdown.open .menu");
      if (e.key === "Escape") BF.$$(".dropdown.open").forEach((d) => { d.classList.remove("open"); d.querySelector("[data-dropdown]")?.focus(); });
      if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const items = BF.$$(".menu-item", menu); const i = items.indexOf(document.activeElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
      }
    });
  };
})();
