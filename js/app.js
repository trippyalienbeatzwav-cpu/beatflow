/* ==========================================================================
   App shell + hash router.
   Pages register with BF.route(pattern, def). def = {
     title, layout: "default" | "dashboard" | "auth" | "focus" | "social",
     render(params, query) → HTML string,
     mount?(el, params, query) → optional cleanup fn
   }
   The shell is marketplace-aware: /beats/* and /electronic/* each get their
   own header, navigation, mobile tab bar and visual identity
   (body[data-eco]). /social/* is TUNIBEAT Social, which draws its own shell
   (js/social/core.js). Everything else is the shared platform.
   ========================================================================== */
(function () {
  const I = BF.icon;
  const routes = [];
  let cleanup = null;

  BF.route = (pattern, def) => {
    const keys = [];
    const re = pattern === "*" ? /(?!)/ : new RegExp("^" + pattern.replace(/\/:(\w+)/g, (_, k) => (keys.push(k), "/([^/]+)")) + "/?$");
    routes.push({ re, keys, def, pattern });
  };

  BF.parseHash = () => {
    const h = location.hash.slice(1) || "/";
    const [path, qs] = h.split("?");
    return { path: path || "/", query: Object.fromEntries(new URLSearchParams(qs || "")) };
  };

  /** Update the query string without re-rendering (filters, tabs). */
  BF.setQuery = (obj) => {
    const { path, query } = BF.parseHash();
    const next = { ...query, ...obj };
    Object.keys(next).forEach((k) => (next[k] === "" || next[k] == null) && delete next[k]);
    const qs = new URLSearchParams(next).toString();
    history.replaceState(null, "", `#${path}${qs ? "?" + qs : ""}`);
  };

  /* ---------- Legacy URLs → store-scoped URLs ---------- */
  const REDIRECTS = [
    [/^\/discover$/, "/beats/catalog"], [/^\/beat\/(.+)$/, "/beats/beat/$1"], [/^\/producer\/(.+)$/, "/beats/producer/$1"], [/^\/producers$/, "/beats/producers"],
    [/^\/library\/music$/, "/electronic/library"], [/^\/library$/, "/beats/library"],
    [/^\/electronic\/tracks$/, "/electronic/discover"], [/^\/release\/(.+)$/, "/electronic/release/$1"], [/^\/artists$/, "/electronic/artists"], [/^\/artist\/(.+)$/, "/electronic/artist/$1"],
    [/^\/labels$/, "/electronic/labels"], [/^\/label\/(.+)$/, "/electronic/label/$1"], [/^\/charts$/, "/electronic/charts"],
  ];

  /* ---------- Store navigation ---------- */
  const STORE_NAV = {
    beats: [["home", "#/beats", "Home"], ["discover", "#/beats/discover", "Discover"], ["beats", "#/beats/catalog", "Beats"], ["producers", "#/beats/producers", "Producers"], ["genres", "#/beats/genres", "Genres"], ["charts", "#/beats/charts", "Charts"], ["library", "#/beats/library", "Library"]],
    electronic: [["home", "#/electronic", "Home"], ["discover", "#/electronic/discover", "Discover"], ["new", "#/electronic/new", "New Releases"], ["genres", "#/electronic/genres", "Genres"], ["artists", "#/electronic/artists", "Artists"], ["labels", "#/electronic/labels", "Labels"], ["charts", "#/electronic/charts", "Charts"], ["library", "#/electronic/library", "Library"]],
  };
  function activeKey(eco, path, query) {
    const seg = path.split("/")[2] || "home";
    if (eco === "beats") return { discover: "discover", pack: "discover", catalog: "beats", beat: "beats", producers: "producers", producer: "producers", genres: "genres", charts: "charts", library: "library", search: "" }[seg] ?? "home";
    if (eco === "electronic") {
      if (seg === "discover" && query.sort === "newest") return "new";
      return { discover: "discover", release: "discover", new: "new", genres: "genres", genre: "genres", artists: "artists", artist: "artists", labels: "labels", label: "labels", charts: "charts", library: "library", search: "" }[seg] ?? "home";
    }
    return { "": "home", about: "about", social: "social" }[path.split("/")[1]] ?? "";
  }

  function account(s) {
    const count = BF.store.get("cart").length;
    return `<a class="icon-btn" href="#/cart" aria-label="Cart, ${count} item${count === 1 ? "" : "s"}" data-cart-link>${I("bag")}${count ? `<span class="count-badge" data-cart-count>${count}</span>` : ""}</a>
      ${s.signedIn ? `<div class="dropdown">
          <button class="avatar-btn" data-dropdown aria-haspopup="menu" aria-expanded="false" aria-label="Account menu"><span class="avatar sm"><img src="${s.user.avatar || BF.avatar(s.user.id + s.user.name, "violet")}" alt=""></span>${I("chevron-down", "i-xs hide-sm")}</button>
          <div class="menu" role="menu">
            <div class="menu-label">${BF.esc(s.user.name)} · @${BF.esc(s.user.handle)}</div>
            <a class="menu-item" role="menuitem" href="#/beats/library">${I("license", "i-sm")} Beats Library</a>
            <a class="menu-item" role="menuitem" href="#/electronic/library">${I("disc", "i-sm")} Electronic Library</a>
            <div class="menu-sep"></div>
            ${BF.store.get("seller")?.producer ? `<a class="menu-item" role="menuitem" href="#/beats/producer/${BF.store.get("seller").producer.handle}">${I("store", "i-sm")} My producer store</a>` : ""}
            <a class="menu-item" role="menuitem" href="#/dashboard">${I("dashboard", "i-sm")} Seller dashboard</a>
            <a class="menu-item" role="menuitem" href="#/dashboard/settings">${I("settings", "i-sm")} Account settings</a>
            <div class="menu-sep"></div>
            <a class="menu-item" role="menuitem" href="#/system">${I("layers", "i-sm")} Design system</a>
            <button class="menu-item" role="menuitem" data-signout>${I("logout", "i-sm")} Sign out</button>
          </div></div>`
        : `<a class="btn btn-ghost btn-sm" href="#/login">Login</a><a class="btn btn-light btn-sm hide-sm" href="#/signup">Sign Up</a>`}`;
  }

  function header(layout, eco, path, query) {
    const s = BF.store.get("session");
    if (layout === "focus") {
      return `<div class="container hdr"><a class="brand" href="#/" aria-label="${BF.brand.name} home">${BF.brand.logo()}</a>
        <span class="subtle" style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:13px">${I("lock", "i-sm")} Secure checkout</span></div>`;
    }
    const key = activeKey(eco, path, query);
    if (eco === "beats" || eco === "electronic") {
      const m = BF.MARKETPLACES[eco];
      return `<div class="container hdr">
          <a class="brand" href="#/" aria-label="${BF.brand.name} — choose a store">${BF.brand.mark(28)}</a>
          <a class="store-id" href="${m.home}" aria-label="${m.name} home"><span class="store-id-name">${eco === "beats" ? "Beats Store" : "Electronic Music Store"}</span><span class="store-id-by">by ${BF.brand.name}</span></a>
          <div class="store-switch" role="group" aria-label="Switch marketplace">
            <a href="#/beats" ${eco === "beats" ? 'aria-current="true"' : ""}>${I("mic", "i-xs")}<span>Beats Store</span></a>
            <a href="#/electronic" ${eco === "electronic" ? 'aria-current="true"' : ""}>${I("headphones", "i-xs")}<span>Electronic Music Store</span></a>
          </div>
          <button class="header-search" data-action="search" aria-label="Search the ${m.name}">${I("search", "i-sm")}<span class="grow">${eco === "beats" ? "Search beats, producers, packs…" : "Search tracks, releases, labels, BPM…"}</span><span class="kbd">Ctrl K</span></button>
          <div class="header-actions"><a class="btn btn-ghost btn-sm hide-sm" href="#/sell">Sell</a>${account(s)}</div>
        </div>
        <nav class="store-nav" aria-label="${m.name}"><div class="container store-nav-inner">
          ${STORE_NAV[eco].map(([k, h, l]) => `<a href="${h}" ${k === key ? 'aria-current="page"' : ""}>${l}</a>`).join("")}
        </div></nav>`;
    }
    const nav = [["home", "#/", "Home"], ["beats", "#/beats", "Beats Store"], ["electronic", "#/electronic", "Electronic Music Store"], ["social", "#/social", "Social"], ["about", "#/about", "About"]];
    return `<div class="container hdr">
      <a class="brand" href="#/" aria-label="${BF.brand.name} home">${BF.brand.logo()}</a>
      <nav class="primary-nav" aria-label="Primary">${nav.map(([k, h, l]) => `<a href="${h}" ${k === key ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      <button class="header-search compact" data-action="search" aria-label="Search both marketplaces">${I("search", "i-sm")}<span class="grow">Search both stores…</span></button>
      <div class="header-actions">${account(s)}</div></div>`;
  }

  function mobileNav(eco) {
    const items = eco === "beats"
      ? [["#/beats", "Home", "home", "home"], ["#/beats/discover", "Discover", "compass", "discover"], ["#/dashboard/upload", "Upload", "plus", "upload"], ["#/beats/library", "Library", "library", "library"], [BF.store.get("seller")?.producer ? "#/beats/producer/" + BF.store.get("seller").producer.handle : BF.store.get("session").signedIn ? "#/dashboard/settings?tab=profile" : "#/login", "Profile", "user", "profile"]]
      : eco === "electronic"
      ? [["#/electronic", "Home", "home", "home"], ["#/electronic/discover", "Discover", "compass", "discover"], ["#/dashboard/release-upload", "Upload", "plus", "upload"], ["#/electronic/library", "Library", "library", "library"], ["#/dashboard/settings?tab=profile", "Profile", "user", "profile"]]
      : [["#/", "Home", "home", "home"], ["#/beats", "Beats", "mic", "beats"], ["#/electronic", "Electronic", "headphones", "electronic"], ["#/social", "Social", "users", "social"], ["#/cart", "Cart", "bag", "cart"]];
    return items.map(([h, l, ic, k]) => `<a href="${h}" data-mnav="${k}">${k === "upload" ? `<span class="upload-fab">${I(ic, "i-sm")}</span>` : I(ic)}<span>${l}</span></a>`).join("");
  }
  function markMobile(eco, path, query) {
    let k = activeKey(eco, path, query);
    if (eco && eco !== "platform") k = { home: "home", discover: "discover", beats: "discover", new: "discover", genres: "discover", charts: "discover", artists: "discover", labels: "discover", producers: "discover", library: "library" }[k] || "";
    if (path.startsWith("/dashboard/upload") || path.startsWith("/dashboard/release-upload")) k = "upload";
    if ((BF.store.get("seller")?.producer && path === "/beats/producer/" + BF.store.get("seller").producer.handle) || path.startsWith("/dashboard/settings")) k = "profile";
    if (path === "/cart") k = "cart";
    BF.$$("[data-mnav]").forEach((a) => (a.dataset.mnav === k ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }

  function footer() {
    const col = (t, links) => `<div><h4>${t}</h4><ul>${links.map(([l, h]) => `<li><a href="${h}">${l}</a></li>`).join("")}</ul></div>`;
    return `<div class="container">
      <div class="footer-grid">
        <div><a class="brand" href="#/">${BF.brand.logo(30)}</a><p class="muted" style="margin:16px 0 20px;max-width:300px;font-size:14px">One platform, two music worlds: a Beats Store for artists and creators, and an Electronic Music Store for DJs, listeners and collectors.</p>
          <div style="display:flex;gap:6px">${["at", "video", "globe"].map((i, n) => `<a class="icon-btn" href="#/about" aria-label="${["Instagram", "YouTube", "Blog"][n]}">${I(i, "i-sm")}</a>`).join("")}</div></div>
        ${col("Beats Store", [["Discover", "#/beats/discover"], ["All beats", "#/beats/catalog"], ["Producers", "#/beats/producers"], ["Charts", "#/beats/charts"], ["License guide", "#/legal/licenses"]])}
        ${col("Electronic Music Store", [["Discover", "#/electronic/discover"], ["New releases", "#/electronic/new"], ["Labels", "#/electronic/labels"], ["Charts", "#/electronic/charts"]])}
        ${col("Sell", [["Sell beats & packs", "#/dashboard/upload"], ["Release music", "#/dashboard/release-upload"], ["Seller dashboard", "#/dashboard"], ["Get verified", "#/verification"]])}
        ${col("Social", [["TUNIBEAT Social", "#/social"], ["Reels", "#/social/reels"], ["Live", "#/social/live"], ["Creator Studio", "#/social/studio"]])}
        ${col("Company", [["About", "#/about"], ["Help center", "#/legal/help"], ["Terms", "#/legal/terms"], ["Privacy", "#/legal/privacy"], ["Copyright & takedowns", "#/legal/copyright"]])}
      </div>
      <div class="footer-base"><span>© 2026 ${BF.brand.legalEntity} All sample content is fictional.</span><span>Prices in USD · Beat licenses are set by each producer · Music purchase terms are set by each label.</span></div>
    </div>`;
  }

  function paintShell(layout, eco, path, query) {
    const h = BF.$("#header"), f = BF.$("#footer");
    if (layout === "social") {
      // TUNIBEAT Social renders its own navigation inside the page
      h.hidden = true; h.innerHTML = ""; f.hidden = true; BF.$("#mobile-nav").hidden = true;
      document.body.dataset.layout = layout; document.body.dataset.eco = eco;
      // The store player bar is hidden in Social, so don’t leave a preview playing without controls
      if (BF.transport?.playing) { BF.transport.pause(); BF.player.sync(); }
      return;
    }
    h.className = "site-header" + (eco === "beats" || eco === "electronic" ? " is-store" : "");
    h.hidden = layout === "auth";
    h.innerHTML = layout === "auth" ? "" : header(layout, eco, path, query);
    f.hidden = layout !== "default";
    f.className = "site-footer";
    if (layout === "default" && !f.dataset.done) { f.innerHTML = footer(); f.dataset.done = "1"; }
    const mn = BF.$("#mobile-nav");
    mn.hidden = layout === "auth" || layout === "focus";
    if (mn.dataset.eco !== eco) { mn.innerHTML = mobileNav(eco); mn.dataset.eco = eco; }
    markMobile(eco, path, query);
    document.body.dataset.layout = layout;
    document.body.dataset.eco = eco;
  }

  /* ---------- Router ---------- */
  function resolve() {
    let { path, query } = BF.parseHash();
    for (const [re, to] of REDIRECTS) {
      if (re.test(path)) { const qs = location.hash.split("?")[1]; history.replaceState(null, "", "#" + path.replace(re, to) + (qs ? "?" + qs : "")); ({ path, query } = BF.parseHash()); break; }
    }
    let match = null;
    const params = {};
    for (const r of routes) {
      const m = r.re.exec(path);
      if (m) { match = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; }
    }
    if (!match) match = routes.find((r) => r.pattern === "*");
    const def = match.def;
    const layout = def.layout || "default";
    // Marketplace comes from the URL, never from the content being shown
    const eco = path.startsWith("/beats") ? "beats" : path.startsWith("/electronic") ? "electronic" : path.startsWith("/social") ? "social" : "platform";

    cleanup && cleanup(); cleanup = null;
    BF.$$(".modal-backdrop, .drawer, .drawer-backdrop, .player-sheet, .search-overlay").forEach((e) => e.remove());
    document.body.style.overflow = "";

    paintShell(layout, eco, path, query);

    const main = BF.$("#main");
    const title = typeof def.title === "function" ? def.title(params, query) : def.title;
    const storeName = eco === "beats" ? "Beats Store" : eco === "electronic" ? "Electronic Music Store" : eco === "social" ? "Social" : "";
    document.title = title ? `${title} — ${storeName ? storeName + " · " : ""}${BF.brand.name}` : storeName ? `${storeName} — ${BF.brand.name}` : `${BF.brand.name} — One Platform. Two Music Worlds.`;
    BF.$("#live").textContent = (storeName ? storeName + ": " : "") + (title || "Home");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    const seq = ++navSeq;
    const paint = (data) => {
      if (seq !== navSeq) return;   // the user navigated away while this page was loading
      let html;
      try { html = def.render(params, query, data); }
      catch (err) { console.error(err); html = errorPage(eco); }
      main.innerHTML = `<div class="page page-${eco}">${html}</div>`;
      main.focus({ preventScroll: true });
      try { const c = def.mount && def.mount(main.querySelector(":scope > .page"), params, query, data); if (typeof c === "function") cleanup = c; }
      catch (err) { console.error(err); main.innerHTML = errorPage(eco); }
      BF.player.sync();
    };
    // Routes with load() fetch their data from the API first (search results, dashboards, …)
    if (def.load) {
      main.innerHTML = `<div class="page page-${eco}"><div class="container boot-loading" aria-busy="true"><span class="spinner"></span><span class="subtle">Loading…</span></div></div>`;
      Promise.resolve().then(() => def.load(params, query)).then(paint).catch((err) => {
        if (seq !== navSeq) return;
        console.error(err);
        main.innerHTML = `<div class="page page-${eco}">${err?.status === 401 ? `<div class="container">${BF.ui.empty({ icon: "lock", title: "Sign in to continue", actions: `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent(path)}">Sign in</a>` })}</div>` : errorPage(eco, err)}</div>`;
      });
    } else paint();
  }
  let navSeq = 0;

  function errorPage(eco, err) {
    const home = eco === "electronic" ? "#/electronic" : eco === "beats" ? "#/beats" : eco === "social" ? "#/social" : "#/";
    const body = err?.status === 0 ? BF.esc(err.message) : err?.status === 404 ? "This page doesn’t exist (or was removed)." : "It’s on us. Try again — your cart and libraries are safe.";
    return `<div class="container">${BF.ui.empty({ kind: "error", icon: "alert", title: err?.status === 404 ? "Not found" : "Something went wrong loading this page", body, actions: `<button class="btn btn-primary" data-reload>${I("refresh", "i-sm")} Try again</button><a class="btn btn-secondary" href="${home}">Back to store home</a>` })}</div>`;
  }

  /* ---------- Boot ---------- */
  function bootError(err) {
    // Opened straight from disk (file://): there is no server behind the page, so explain how to run it
    const fromDisk = location.protocol === "file:";
    BF.$("#main").innerHTML = `<div class="container" style="padding-top:64px">${BF.ui.empty({ kind: "error", icon: "alert",
      title: fromDisk ? "Open TUNIBEAT through its server" : "The store can’t be reached",
      body: fromDisk
        ? "This page was opened as a file, so it can’t reach the TUNIBEAT server. In the project folder run <code>npm start</code>, then open <a class=\"link\" href=\"http://localhost:5173\">http://localhost:5173</a>."
        : BF.esc(err.message || "The server didn’t answer."),
      actions: fromDisk ? "" : `<button class="btn btn-primary" data-boot-retry>${I("refresh", "i-sm")} Try again</button>` })}</div>`;
    BF.$("[data-boot-retry]").onclick = () => start();
  }
  async function start() {
    BF.$("#main").innerHTML = `<div class="container boot-loading" aria-busy="true" aria-live="polite"><span class="spinner"></span><span class="subtle">Loading the stores…</span></div>`;
    try { await BF.boot(); }
    catch (err) { console.error(err); bootError(err); return; }
    resolve();
  }
  BF.onSignedOut = () => { if (!BF.store.get("session").signedIn) return; BF.store.hydrate(null).then(resolve); };
  BF.rerender = () => resolve();
  function boot() {
    BF.player.init();
    BF.bindGlobalActions();

    BF.$(".skip-link").addEventListener("click", (e) => { e.preventDefault(); BF.$("#main").focus(); });

    // Cart badge live update
    BF.store.on("cart", (cart) => {
      const link = BF.$("[data-cart-link]"); if (!link) return;
      link.setAttribute("aria-label", `Cart, ${cart.length} item${cart.length === 1 ? "" : "s"}`);
      let badge = link.querySelector("[data-cart-count]");
      if (!cart.length) { badge && badge.remove(); }
      else {
        if (!badge) { link.insertAdjacentHTML("beforeend", `<span class="count-badge" data-cart-count></span>`); badge = link.querySelector("[data-cart-count]"); }
        badge.textContent = cart.length; badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump");
      }
      BF.$$(".price-btn[data-beat]").forEach((b) => { const tmp = document.createElement("div"); tmp.innerHTML = BF.ui.priceBtn(BF.beatById[b.dataset.beat]); b.replaceWith(tmp.firstElementChild); });
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-reload]")) setTimeout(() => location.reload(), 0);   // after any link navigation
      if (e.target.closest("[data-signout]")) {
        BF.store.signOut().then(() => {
          BF.social?.onSignedOut?.();
          BF.ui.toast({ kind: "info", title: "Signed out", desc: "Signed-out carts stay on this device." });
          location.hash = "#/login";
        });
      }
    });

    window.addEventListener("hashchange", () => { if (BF.catalogVersion) resolve(); });
    start();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
