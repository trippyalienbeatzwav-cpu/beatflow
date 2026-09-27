/* ==========================================================================
   TUNIBEAT Social — client core
   API client (CSRF header, typed errors), real-time socket with reconnect,
   app shell (rail / top bar / tab bar), shared UI helpers, chunked uploader.
   Every social page lives under #/social and uses layout "social".
   ========================================================================== */
(function () {
  const SX = (BF.social = {});
  const esc = BF.esc;
  SX.esc = esc;

  /* ---------- Icons: extend the shared set with social glyphs ---------- */
  const EXTRA = {
    bookmark: '<path d="M6.5 4.5h11v15.5L12 16l-5.5 4z"/>',
    "bookmark-fill": '<path class="f" d="M6.5 4.5h11v15.5L12 16l-5.5 4z"/>',
    comment: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
    send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0"/><circle class="f" cx="9" cy="10" r="1"/><circle class="f" cx="15" cy="10" r="1"/>',
    paperclip: '<path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
    reply: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/>',
    live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
    reels: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M4 8h16M9 3.5 11 8M14 3.5 16 8"/><path class="f" d="M10.5 11.5v5l4-2.5z"/>',
    crown: '<path d="M4 18h16M5 16 4 7l5 4 3-6 3 6 5-4-1 9z"/>',
    rocket: '<path d="M12 15c-1.5 0-3-1.5-3-3 0-4 3-8 3-8s3 4 3 8c0 1.5-1.5 3-3 3z"/><path d="M9 12.5 6 15l1 3 3-1M15 12.5l3 2.5-1 3-3-1M10.5 18.5l1.5 2 1.5-2"/>',
    flower: '<path d="M12 7a3 3 0 1 1 3 3 3 3 0 1 1-3 3 3 3 0 1 1-3-3 3 3 0 1 1 3-3zM12 13v7M12 17.5c-2 0-3.5-1-4-3M12 18.5c2 0 3.5-1 4-3"/>',
    clap: '<path d="M9 11 6.5 8.5a1.4 1.4 0 0 1 2-2L13 11M11 9 8 6a1.4 1.4 0 0 1 2-2l5 5M7 13l-1.5-1.5a1.4 1.4 0 0 1 2-2M16 7.5l1-1.5a1.4 1.4 0 0 1 2.2 1.6L17 12c-.6 4-3.6 7-7.5 6.5a5 5 0 0 1-3.2-1.9L5 15"/>',
    vinyl: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><circle class="f" cx="12" cy="12" r=".9"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.3c-.5-.8-1.4-1.3-2.5-1.3-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.5-2.5-1.3M12 6.5v11"/>',
    hash: '<path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16"/>',
    repost: '<path d="M17 3l3 3-3 3M20 6H9a5 5 0 0 0-5 5v1M7 21l-3-3 3-3M4 18h11a5 5 0 0 0 5-5v-1"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    text: '<path d="M4 18 8.5 6h1L14 18M5.8 14h6.4M21 18v-4.7c0-1.7-1.1-2.8-2.8-2.8-1 0-1.9.3-2.7 1M21 14.5c-3.5 0-5.5.5-5.5 2 0 1 .8 1.6 1.9 1.6 1.6 0 3.6-1 3.6-3.6"/>',
    stop: '<rect class="f" x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    record: '<circle class="f" cx="12" cy="12" r="6"/>',
    studio: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    sticker: '<path d="M20 12.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6.5z"/><path d="M20 12.5 12.5 20V14.5a2 2 0 0 1 2-2z"/>',
    "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
    "star-outline": '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z"/>',
  };
  const svg = (inner, cls) => `<svg class="i ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner.replace(/class="f"/g, 'fill="currentColor" stroke="none"')}</svg>`;
  const I = (name, cls = "") => (EXTRA[name] ? svg(EXTRA[name], cls) : BF.icon(name, cls));
  SX.icon = I;
  const GIFT_ICONS = { heart: "heart-fill", clap: "clap", star: "star-fill", fire: "fire", flower: "flower", vinyl: "vinyl", rocket: "rocket", crown: "crown", mic: "mic" };
  SX.giftIcon = (key, cls) => I(GIFT_ICONS[key] ?? key, cls);
  SX.verified = () => `<svg class="verified" viewBox="0 0 24 24" aria-label="Verified" role="img"><path fill="currentColor" d="m12 2.8 2.3 1.7 2.9-.1.9 2.7 2.3 1.8-.9 2.7.9 2.8-2.3 1.7-.9 2.8-2.9-.1L12 21.2l-2.3-1.7-2.9.1-.9-2.8-2.3-1.7.9-2.8-.9-2.7 2.3-1.8.9-2.7 2.9.1z"/><path d="m8.8 12.2 2.2 2.2 4.3-4.6" fill="none" stroke="var(--s-on-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /* ---------- API client ---------- */
  class ApiError extends Error {
    constructor(status, body) { super(body?.error?.message ?? `Request failed (${status})`); this.status = status; this.code = body?.error?.code ?? "error"; this.extra = body?.error ?? {}; }
  }
  SX.ApiError = ApiError;
  async function request(method, url, body, { signal, raw, headers = {} } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method, signal, credentials: "same-origin",
        headers: { "x-tunibeat-csrf": "1", ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new ApiError(0, { error: { code: "network", message: "You're offline or the server can't be reached." } });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const e = new ApiError(res.status, data);
      if (res.status === 401 && !url.startsWith("/api/auth")) SX.onSignedOut();
      throw e;
    }
    return data;
  }
  SX.api = {
    get: (u, o) => request("GET", u, undefined, o), post: (u, b = {}, o) => request("POST", u, b, o), patch: (u, b = {}, o) => request("PATCH", u, b, o),
    put: (u, raw, o) => request("PUT", u, undefined, { ...o, raw }), del: (u, o) => request("DELETE", u, undefined, o),
  };
  SX.ikey = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
  SX.qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v != null && v !== "" && p.set(k, v)); const s = p.toString(); return s ? "?" + s : ""; };

  /* ---------- Session ---------- */
  SX.state = { me: null, env: null, booted: false, reelsMuted: true, unread: { notifications: 0, messages: 0, message_requests: 0, follow_requests: 0 } };
  let bootP = null;
  SX.boot = (force = false) => {
    if (bootP && !force) return bootP;
    bootP = SX.api.get("/api/me").then((r) => {
      SX.state.me = r.user; SX.state.env = r.env; SX.state.booted = true;
      if (r.user) { SX.state.unread = { ...SX.state.unread, ...r.user.unread }; SX.ws.connect(); }
      else SX.ws.disconnect();
      return r.user;
    }).catch((err) => { bootP = null; throw err; });
    return bootP;
  };
  SX.onSignedOut = () => {
    if (!SX.state.me) return;
    SX.state.me = null; bootP = null; SX.ws.disconnect();
    BF.onSignedOut?.();
    const here = location.hash;
    if (here.startsWith("#/social") && !here.startsWith("#/social/login")) location.hash = `#/social/login?next=${encodeURIComponent(here.slice(1))}`;
  };
  SX.isStaff = () => ["admin", "moderator"].includes(SX.state.me?.role);

  /* ---------- Real-time socket ---------- */
  SX.ws = (() => {
    let sock = null, want = false, attempt = 0, timer = null, ping = null;
    const handlers = new Map();
    const subs = new Map();   // channel → refcount
    const emit = (t, m) => (handlers.get(t) ?? []).forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
    function open() {
      clearTimeout(timer);
      if (!want || sock) return;
      sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      sock.onopen = () => {
        attempt = 0;
        for (const ch of subs.keys()) sock.send(JSON.stringify({ t: "sub", ch }));
        clearInterval(ping); ping = setInterval(() => send({ t: "ping" }), 20_000);
        emit("_open", {});
      };
      sock.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } emit(m.t, m); emit("*", m); };
      sock.onclose = () => {
        clearInterval(ping); sock = null; emit("_close", {});
        if (!want) return;
        const delay = Math.min(15_000, 500 * 2 ** attempt++) * (0.7 + Math.random() * 0.6);
        timer = setTimeout(open, delay);
      };
      sock.onerror = () => {};
    }
    function send(m) { if (sock?.readyState === 1) { sock.send(JSON.stringify(m)); return true; } return false; }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && want && !sock) open(); });
    window.addEventListener("online", () => { if (want && !sock) { attempt = 0; open(); } });
    return {
      connect() { want = true; open(); },
      disconnect() { want = false; clearTimeout(timer); sock?.close(); sock = null; },
      on(t, fn) { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t).add(fn); return () => handlers.get(t).delete(fn); },
      send,
      sub(ch) { subs.set(ch, (subs.get(ch) ?? 0) + 1); if (subs.get(ch) === 1) send({ t: "sub", ch }); return () => { const n = (subs.get(ch) ?? 1) - 1; if (n <= 0) { subs.delete(ch); send({ t: "unsub", ch }); } else subs.set(ch, n); }; },
      get connected() { return sock?.readyState === 1; },
    };
  })();

  /* ---------- Formatting ---------- */
  SX.count = (n) => (n == null ? "" : n < 1000 ? String(n) : n < 1e6 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K" : (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M");
  SX.ago = (ts) => {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "now"; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  };
  SX.when = (ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  SX.money = (cents, cur = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format((cents ?? 0) / 100);
  SX.dur = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  /** Escape, then link #hashtags, @mentions and URLs. */
  SX.rich = (text) => esc(text ?? "")
    .replace(/(https?:\/\/[^\s<]{3,200})/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow ugc" class="s-link">${u.replace(/^https?:\/\//, "").slice(0, 40)}${u.length > 48 ? "…" : ""}</a>`)
    .replace(/(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{1,50})/gu, (_, pre, tag) => `${pre}<a href="#/social/tag/${encodeURIComponent(tag.toLowerCase())}" class="s-tag">#${tag}</a>`)
    .replace(/(^|[^\w@/])@([a-z0-9_.]{3,24})/gi, (_, pre, u) => `${pre}<a href="#/social/u/${u}" class="s-mention">@${u}</a>`)
    .replace(/\n/g, "<br>");

  SX.avatar = (u, size = "md", { ring = false, live = false, link = true, story = null } = {}) => {
    if (!u) return `<span class="s-av ${size}"></span>`;
    const inner = u.avatar_url ? `<img src="${u.avatar_url}" alt="" loading="lazy" decoding="async">` : `<span>${esc((u.display_name || u.username || "?")[0].toUpperCase())}</span>`;
    const cls = `s-av ${size}${ring ? " ring" : ""}${story === "seen" ? " ring seen" : ""}${live ? " live" : ""}`;
    const body = `<span class="${cls}">${inner}${live ? `<b class="s-av-live">LIVE</b>` : ""}</span>`;
    return link ? `<a href="#/social/u/${esc(u.username)}" class="s-av-link" aria-label="${esc(u.display_name)} (@${esc(u.username)})">${body}</a>` : body;
  };
  SX.name = (u, { link = true, handle = false } = {}) => {
    if (!u) return "";
    const n = `<span class="s-name">${esc(u.display_name)}</span>${u.is_verified ? SX.verified() : ""}${handle ? ` <span class="s-handle">@${esc(u.username)}</span>` : ""}`;
    return link ? `<a href="#/social/u/${esc(u.username)}" class="s-name-link">${n}</a>` : `<span class="s-name-link">${n}</span>`;
  };

  /* ---------- Shell ---------- */
  const NAV = [
    ["home", "#/social", "Home", "home"], ["explore", "#/social/explore", "Explore", "compass"], ["reels", "#/social/reels", "Reels", "reels"],
    ["live", "#/social/live", "Live", "live"], ["messages", "#/social/messages", "Messages", "send", "messages"], ["notifications", "#/social/notifications", "Notifications", "bell", "notifications"],
    ["create", "#/social/create", "Create", "plus"], ["profile", null, "Profile", "user"],
  ];
  const MORE = [["studio", "#/social/studio", "Creator Studio", "studio"], ["wallet", "#/social/wallet", "Wallet", "wallet"], ["settings", "#/social/settings", "Settings", "settings"]];
  function badge(key) {
    const n = key === "messages" ? SX.state.unread.messages + SX.state.unread.message_requests : key === "notifications" ? SX.state.unread.notifications : 0;
    return `<span class="s-badge" data-badge="${key}" ${n ? "" : "hidden"}>${n > 99 ? "99+" : n || ""}</span>`;
  }
  SX.updateBadges = () => BF.$$("[data-badge]").forEach((b) => {
    const k = b.dataset.badge;
    const n = k === "messages" ? SX.state.unread.messages + SX.state.unread.message_requests : k === "notifications" ? SX.state.unread.notifications : 0;
    b.hidden = !n; b.textContent = n > 99 ? "99+" : n;
  });

  /**
   * Wrap page content in the social shell. opts: { wide, bare (no side rails, e.g. reels), right: html, title }
   */
  SX.shell = (active, content, opts = {}) => {
    const me = SX.state.me;
    const prof = me ? `#/social/u/${me.username}` : "#/social/login";
    const item = ([k, h, label, ic, b]) => `<a class="s-nav-item" href="${k === "profile" ? prof : h}" ${k === active ? 'aria-current="page"' : ""} data-nav="${k}">
      <span class="s-nav-ic">${k === "profile" && me ? SX.avatar(me, "xs", { link: false }) : I(ic)}${b ? badge(b) : ""}</span><span class="s-nav-label">${label}</span></a>`;
    const rail = `<aside class="s-rail" aria-label="TUNIBEAT Social">
        <a class="s-brand" href="#/social" aria-label="TUNIBEAT Social home">${BF.brand.mark(30)}<span class="s-brand-word">${esc(BF.brand.name)}<em>Social</em></span></a>
        <nav class="s-nav" aria-label="Social">${NAV.map(item).join("")}</nav>
        <div class="s-nav-sep"></div>
        <nav class="s-nav s-nav-more" aria-label="Creator and account">${MORE.map(item).join("")}${SX.isStaff() ? item(["admin", "#/social/admin", "Moderation", "shield"]) : ""}</nav>
        <a class="s-exit" href="#/">${I("arrow-left", "i-sm")}<span>Back to stores</span></a>
      </aside>`;
    const top = `<header class="s-top">
        <a class="s-brand" href="#/social" aria-label="TUNIBEAT Social home">${BF.brand.mark(26)}<span class="s-brand-word">${esc(BF.brand.name)}<em>Social</em></span></a>
        <div class="s-top-actions">
          <a class="s-icon-btn" href="#/social/explore" aria-label="Search">${I("search")}</a>
          <a class="s-icon-btn" href="#/social/notifications" aria-label="Notifications">${I("bell")}${badge("notifications")}</a>
          <a class="s-icon-btn" href="#/social/messages" aria-label="Messages">${I("send")}${badge("messages")}</a>
        </div></header>`;
    const tabs = [["home", "#/social", "Home", "home"], ["explore", "#/social/explore", "Explore", "compass"], ["create", "#/social/create", "Create", "plus"], ["reels", "#/social/reels", "Reels", "reels"], ["profile", prof, "Profile", "user"]];
    const tabbar = `<nav class="s-tabbar" aria-label="Social tabs">${tabs.map(([k, h, l, ic]) => `<a href="${h}" ${k === active ? 'aria-current="page"' : ""} class="${k === "create" ? "s-tab-create" : ""}">${k === "profile" && me ? SX.avatar(me, "xs", { link: false }) : I(ic)}<span>${l}</span></a>`).join("")}</nav>`;
    const testBanner = SX.state.env?.payments?.test_mode && ["wallet", "studio"].includes(active)
      ? `<div class="s-testmode" role="note">${I("info", "i-xs")} <b>Test mode:</b> payments and payouts run in a sandbox; no real money moves.</div>` : "";
    return `<div class="s-app ${opts.bare ? "bare" : ""} ${opts.wide ? "wide" : ""}" data-active="${active}">
      ${rail}${opts.bare ? "" : top}
      <div class="s-main">${testBanner}${content}</div>
      ${opts.right && !opts.bare ? `<aside class="s-right" aria-label="Suggestions">${opts.right}</aside>` : ""}
      ${tabbar}
    </div>`;
  };

  /* ---------- States ---------- */
  SX.skeletonPosts = (n = 3) => `<div class="s-skel-list" aria-busy="true" aria-label="Loading posts">${Array.from({ length: n }, () => `<div class="s-card s-skel-post">
      <div class="s-row"><span class="skeleton s-sk-av"></span><span class="skeleton sk-line" style="width:30%;margin:0"></span></div>
      <div class="skeleton s-sk-media"></div><div class="skeleton sk-line" style="width:80%"></div><div class="skeleton sk-line" style="width:50%"></div></div>`).join("")}</div>`;
  SX.skeletonGrid = (n = 9) => `<div class="s-grid" aria-busy="true" aria-label="Loading">${Array.from({ length: n }, () => `<div class="skeleton s-grid-cell"></div>`).join("")}</div>`;
  SX.skeletonRows = (n = 6) => BF.ui.skeletonRows(n);
  SX.empty = (o) => BF.ui.empty(o);
  SX.errorBox = (err, retry = true) => BF.ui.empty({
    kind: "error", icon: err?.code === "network" ? "globe" : "alert",
    title: err?.status === 404 ? "Not available" : err?.code === "network" ? "You’re offline" : "Something went wrong",
    body: esc(err?.message ?? "Please try again."),
    actions: retry ? `<button class="s-btn" data-retry>${I("refresh", "i-sm")} Try again</button>` : `<a class="s-btn" href="#/social">Go home</a>`,
  });
  SX.toast = (o) => BF.ui.toast(o);
  SX.fail = (err, title = "That didn’t work") => { if (err?.name === "AbortError") return; SX.toast({ kind: "error", title, desc: esc(err?.message ?? "Please try again.") }); };

  /* ---------- Lazy media ---------- */
  const lazyIO = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target; lazyIO.unobserve(el);
      if (el.dataset.src) { el.src = el.dataset.src; delete el.dataset.src; }
      if (el.dataset.poster) { el.poster = el.dataset.poster; delete el.dataset.poster; }
    }
  }, { rootMargin: "600px 0px" }) : null;
  SX.lazy = (root) => BF.$$("[data-src],[data-poster]", root).forEach((el) => (lazyIO ? lazyIO.observe(el) : (el.src = el.dataset.src ?? el.src)));

  /**
   * Infinite list with cursor pagination.
   * load(cursor) → { items, next_cursor }; render(items) → html. Handles loading, error-with-retry, end and empty states.
   */
  SX.infinite = ({ list, load, render, empty, after }) => {
    let cursor = null, done = false, busy = false, gen = 0, count = 0;
    const foot = document.createElement("div");
    foot.className = "s-list-foot";
    list.after(foot);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), { rootMargin: "900px 0px" });
    io.observe(foot);
    async function more() {
      if (busy || done) return;
      busy = true;
      const my = gen;
      foot.innerHTML = `<div class="s-spinner" role="status" aria-label="Loading more"></div>`;
      try {
        const r = await load(cursor);
        if (my !== gen) return;
        const items = r.items ?? [];
        count += items.length;
        if (items.length) { list.insertAdjacentHTML("beforeend", render(items)); SX.lazy(list); after?.(items); }
        cursor = r.next_cursor ?? null;
        done = !cursor;
        foot.innerHTML = done ? (count ? `<p class="s-end">You’re all caught up</p>` : empty ?? "") : "";
      } catch (err) {
        if (my !== gen) return;
        foot.innerHTML = `<div class="s-list-error" role="alert"><span>${esc(err.message)}</span><button class="s-btn sm" data-more>${I("refresh", "i-xs")} Retry</button></div>`;
        foot.querySelector("[data-more]").onclick = () => more();
      } finally { if (my === gen) busy = false; }
      // Keep filling while the sentinel is still on screen
      if (!done && my === gen) requestAnimationFrame(() => { const r = foot.getBoundingClientRect(); if (r.top < innerHeight + 900) more(); });
    }
    return {
      reset() { gen++; cursor = null; done = false; busy = false; count = 0; list.innerHTML = ""; foot.innerHTML = ""; more(); },
      more,
      destroy() { gen++; io.disconnect(); foot.remove(); },
    };
  };

  /** Pull-to-refresh for touch devices (the document is the scroller). */
  SX.pullToRefresh = (host, onRefresh) => {
    if (!("ontouchstart" in window)) return () => {};
    let y0 = null, dy = 0;
    const ind = document.createElement("div");
    ind.className = "s-ptr"; ind.innerHTML = I("arrow-down", "i-sm"); ind.setAttribute("aria-hidden", "true");
    host.prepend(ind);
    const start = (e) => { if (scrollY <= 0) y0 = e.touches[0].clientY; };
    const move = (e) => { if (y0 == null) return; dy = Math.max(0, Math.min(120, e.touches[0].clientY - y0)); ind.style.height = dy * 0.6 + "px"; ind.classList.toggle("armed", dy > 80); };
    const end = async () => {
      if (y0 == null) return;
      const go = dy > 80; y0 = null; dy = 0;
      if (go) { ind.classList.add("busy"); try { await onRefresh(); } finally { ind.classList.remove("busy", "armed"); ind.style.height = "0px"; } }
      else ind.style.height = "0px";
    };
    host.addEventListener("touchstart", start, { passive: true });
    host.addEventListener("touchmove", move, { passive: true });
    host.addEventListener("touchend", end);
    return () => { host.removeEventListener("touchstart", start); host.removeEventListener("touchmove", move); host.removeEventListener("touchend", end); ind.remove(); };
  };

  /* ---------- Sheets & menus ---------- */
  SX.sheet = ({ title, body, foot = "", onMount, wide = false }) => BF.ui.modal({ title, body, foot, wide, onMount: (bd, close) => { bd.classList.add("s-sheet"); onMount?.(bd, close); } });
  /** Action menu: items [{ label, icon, danger, run }] */
  SX.menu = (title, items) => SX.sheet({
    title, body: `<div class="s-menu" role="menu">${items.filter(Boolean).map((it, i) => `<button class="s-menu-item ${it.danger ? "danger" : ""}" role="menuitem" data-i="${i}">${it.icon ? I(it.icon, "i-sm") : ""}<span>${esc(it.label)}</span></button>`).join("")}</div>`,
    onMount: (bd, close) => bd.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (!b) return; const it = items.filter(Boolean)[b.dataset.i]; close(); it.run(); }),
  });
  SX.confirm = (o) => BF.ui.confirm(o);

  SX.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); SX.toast({ kind: "info", title: "Link copied" }); }
    catch { SX.toast({ kind: "info", title: "Copy this link", desc: esc(text), timeout: 8000 }); }
  };
  SX.absUrl = (hash) => `${location.origin}${location.pathname}${hash.startsWith("#") ? hash : "#" + hash}`;

  const REASONS = [["spam", "Spam or scam"], ["harassment", "Harassment or bullying"], ["hate", "Hate speech"], ["nudity", "Nudity or sexual content"], ["violence", "Violence or dangerous acts"], ["self_harm", "Self-harm"], ["scam", "Fraud or payment scam"], ["ip", "Intellectual property"], ["impersonation", "Impersonation"], ["minor_safety", "Child safety"], ["other", "Something else"]];
  SX.report = (targetType, targetId, label = "content") => SX.sheet({
    title: `Report ${label}`,
    body: `<form class="s-form" data-report><p class="muted" style="margin:0 0 12px">Reports are confidential. The person won’t know who reported them.</p>
      <fieldset class="s-radio-list"><legend class="sr-only">Reason</legend>${REASONS.map(([v, l]) => `<label class="s-radio"><input type="radio" name="reason" value="${v}" required><span>${l}</span></label>`).join("")}</fieldset>
      <label class="s-field"><span>Details (optional)</span><textarea name="details" maxlength="1000" rows="3" placeholder="Anything that helps our team review this"></textarea></label>
      <div class="s-form-actions"><button type="button" class="s-btn ghost" data-close>Cancel</button><button class="s-btn primary">Submit report</button></div></form>`,
    onMount: (bd, close) => bd.querySelector("[data-report]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const r = await SX.api.post("/api/reports", { target_type: targetType, target_id: targetId, reason: f.get("reason"), details: f.get("details") });
        close();
        SX.toast({ kind: "info", title: r.already_reported ? "Already reported" : "Report received", desc: "Our Trust & Safety team will review it. You can also block or mute this account." });
      } catch (err) { SX.fail(err, "Couldn’t send report"); }
    }),
  });

  /* ---------- Uploads: chunked, resumable, cancellable ---------- */
  SX.upload = async (file, { purpose, meta = {}, onProgress, signal, poster_media_id, variants } = {}) => {
    const init = await SX.api.post("/api/media/uploads", { purpose, filename: file.name || "upload", mime: file.type, bytes: file.size, ...meta }, { signal });
    const { id, chunk_size: cs, chunks } = init.upload;
    let sent = 0;
    const abort = () => SX.api.del(`/api/media/uploads/${id}`).catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for (let i = 0; i < chunks; i++) {
        const part = file.slice(i * cs, Math.min(file.size, (i + 1) * cs));
        for (let attempt = 0; ; attempt++) {
          try { await SX.api.put(`/api/media/uploads/${id}/chunks/${i}`, part, { signal, headers: { "content-type": "application/octet-stream" } }); break; }
          catch (err) {
            if (err.name === "AbortError" || attempt >= 3 || (err.status && err.status < 500 && err.status !== 429)) throw err;
            await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
          }
        }
        sent += part.size;
        onProgress?.(sent / file.size);
      }
      const hash = file.size < 64 * 1024 * 1024 && crypto.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("") : undefined;
      const done = await SX.api.post(`/api/media/uploads/${id}/complete`, { sha256: hash, poster_media_id, variants }, { signal });
      return done.media;
    } catch (err) {
      if (err.name !== "AbortError") abort();
      throw err;
    }
  };

  /** Downscale an image in the browser and re-encode to WebP (plus a small variant). */
  SX.processImage = async (file, { max = 2048, variant = 480 } = {}) => {
    if (file.type === "image/gif") return { file, width: 0, height: 0 };
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) throw new Error("That image couldn’t be read.");
    const draw = async (limit) => {
      const s = Math.min(1, limit / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
      const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      c.getContext("2d").drawImage(bmp, 0, 0, w, h);
      const blob = c.convertToBlob ? await c.convertToBlob({ type: "image/webp", quality: 0.84 }) : await new Promise((r) => c.toBlob(r, "image/webp", 0.84));
      return { blob: new File([blob], (file.name || "image").replace(/\.\w+$/, "") + ".webp", { type: blob.type }), w, h };
    };
    const main = await draw(max);
    const small = Math.max(bmp.width, bmp.height) > variant * 1.5 ? await draw(variant) : null;
    return { file: main.blob, width: main.w, height: main.h, variant: small?.blob ?? null };
  };

  /** Read duration/size and grab a poster frame from a video file. */
  SX.videoMeta = (file) => new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.playsInline = true;
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    v.onerror = () => { cleanup(); reject(new Error("That video couldn’t be read. Try MP4 or WebM.")); };
    v.onloadedmetadata = () => {
      // WebM from MediaRecorder can report Infinity until seeked
      if (!isFinite(v.duration)) { v.currentTime = 1e9; v.ontimeupdate = () => { v.ontimeupdate = null; v.currentTime = Math.min(0.5, v.duration / 2); }; }
      else v.currentTime = Math.min(0.5, v.duration / 2);
    };
    v.onseeked = () => {
      if (!isFinite(v.duration)) return;
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0);
      c.toBlob((b) => { cleanup(); resolve({ duration_ms: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight, poster: b ? new File([b], "poster.webp", { type: "image/webp" }) : null }); }, "image/webp", 0.8);
    };
    v.src = url;
  });

  /* ---------- Route helper: auth gate + async mount with error recovery ---------- */
  SX.route = (pattern, { title, active, render, mount, public: isPublic = false, bare = false, wide = false, right }) => {
    BF.route(pattern, {
      title: (p, q) => (typeof title === "function" ? title(p, q) : title),
      layout: "social",
      render: (p, q) => SX.shell(typeof active === "function" ? active(p, q) : active, `<div class="s-page" data-page>${render ? render(p, q) : SX.skeletonPosts(2)}</div>`, { bare, wide, right: right ? `<div data-right>${right}</div>` : "" }),
      mount(el, p, q) {
        const page = el.querySelector("[data-page]");
        let cleanup = null, dead = false;
        const run = async () => {
          try {
            const me = await SX.boot();
            if (dead) return;
            if (!me && !isPublic) { location.replace(`#/social/login?next=${encodeURIComponent(location.hash.slice(1))}`); return; }
            // The shell was drawn before the session loaded: refresh it once we know who's signed in
            if (me && !el.querySelector(".s-rail .s-av")) {
              const tmp = document.createElement("div");
              tmp.innerHTML = SX.shell(typeof active === "function" ? active(p, q) : active, "", { bare, wide, right: right ? `<div data-right>${right}</div>` : "" });
              el.querySelector(".s-rail")?.replaceWith(tmp.querySelector(".s-rail"));
              el.querySelector(".s-tabbar")?.replaceWith(tmp.querySelector(".s-tabbar"));
              const nt = tmp.querySelector(".s-top"); if (nt) el.querySelector(".s-top")?.replaceWith(nt);
            }
            SX.updateBadges();
            cleanup = await mount?.(page, p, q, el);
          } catch (err) {
            if (dead) return;
            console.error(err);
            page.innerHTML = SX.errorBox(err);
            page.querySelector("[data-retry]")?.addEventListener("click", () => { page.innerHTML = SX.skeletonPosts(2); run(); });
          }
        };
        run();
        return () => { dead = true; typeof cleanup === "function" && cleanup(); };
      },
    });
  };

  /* ---------- Global live updates (badges, toasts for incoming events) ---------- */
  SX.ws.on("notification", (m) => {
    SX.state.unread.notifications = m.unread;
    SX.updateBadges();
    if (document.hidden && m.push && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("TUNIBEAT Social", { body: SX.notificationText(m.item).replace(/<[^>]+>/g, ""), tag: m.item.group_key }); } catch { /* ignore */ }
    }
  });
  SX.ws.on("notifications_read", (m) => { SX.state.unread.notifications = m.unread; SX.updateBadges(); });
  SX.ws.on("message", (m) => {
    if (m.message.sender?.id === SX.state.me?.id) return;
    if (!location.hash.includes(`/social/messages/${m.conversation_id}`)) {
      if (m.request) SX.state.unread.message_requests++; else SX.state.unread.messages++;
      SX.updateBadges();
      if (!location.hash.startsWith("#/social/messages")) SX.toast({ kind: "info", title: esc(m.message.sender?.display_name ?? "New message"), desc: esc(m.message.body || "Sent an attachment").slice(0, 90), action: { href: `#/social/messages/${m.conversation_id}`, label: "Open" } });
    }
  });
  SX.ws.on("wallet", (m) => { if (SX.state.me) SX.state.me.credits = m.credits; BF.$$("[data-credits]").forEach((e) => (e.textContent = SX.count(m.credits))); });

  SX.notificationText = (n) => {
    const who = n.actors?.length ? `<b>${esc(n.actors[0].display_name)}</b>${n.actors.length > 1 ? ` and ${n.actors.length - 1} other${n.actors.length > 2 ? "s" : ""}` : ""}` : n.actor ? `<b>${esc(n.actor.display_name)}</b>` : "";
    const d = n.data ?? {};
    const test = d.test_mode ? " (test mode)" : "";
    switch (n.type) {
      case "like": return `${who} ${d.reaction && d.reaction !== "like" ? "reacted to" : "liked"} your ${d.post_type === "reel" ? "reel" : "post"}`;
      case "comment": return `${who} commented: “${esc(d.excerpt ?? "")}”`;
      case "reply": return `${who} replied: “${esc(d.excerpt ?? "")}”`;
      case "comment_like": return `${who} liked your comment “${esc(d.excerpt ?? "")}”`;
      case "follow": return `${who} started following you`;
      case "follow_request": return `${who} requested to follow you`;
      case "follow_accepted": return `${who} accepted your follow request`;
      case "mention": return `${who} mentioned you in a ${esc(d.source ?? "post")}: “${esc(d.excerpt ?? "")}”`;
      case "tag": return `${who} tagged you in a post`;
      case "message_request": return `${who} wants to send you a message`;
      case "story_reaction": return `${who} reacted to your story`;
      case "story_reply": return `${who} replied to your story: “${esc(d.excerpt ?? "")}”`;
      case "live_started": return `${who} is live now: ${esc(d.title ?? "")}`;
      case "live_scheduled": return `${who} scheduled a live: ${esc(d.title ?? "")} · ${SX.when(d.scheduled_at)}`;
      case "gift_received": return `${who} sent you ${esc(d.gift ?? "a gift")} · +${SX.money(d.net_cents)} pending${test}`;
      case "donation_received": return `${who} tipped you ${SX.money(d.amount_cents)}${d.message ? `: “${esc(d.message)}”` : ""}${test}`;
      case "donation_refunded": return `A tip of ${SX.money(d.amount_cents)} was refunded`;
      case "earnings_available": return `Earnings cleared. ${SX.money(d.balances?.available_cents)} is available to withdraw`;
      case "withdrawal_update": return `Withdrawal of ${SX.money(d.amount_cents)} ${esc(d.status)}${d.reason ? `: ${esc(d.reason)}` : ""}${test}`;
      case "credits_added": return `${SX.count(d.credits)} credits added to your wallet${test}`;
      case "report_update": return d.outcome === "action_taken" ? "Thanks for your report. We took action." : "Thanks for your report. We reviewed it and found no violation.";
      case "content_removed": return `Your ${esc(n.target_type ?? "content")} was removed for violating our guidelines (${esc(d.reason ?? "")})`;
      default: return esc(d.text ?? "Account update");
    }
  };
  SX.notificationHref = (n) => {
    if (n.type.startsWith("follow")) return n.type === "follow_request" ? "#/social/notifications?tab=requests" : `#/social/u/${n.actors?.[0]?.username ?? n.actor?.username}`;
    if (n.target_type === "post") return `#/social/p/${n.target_id}`;
    if (n.target_type === "live") return `#/social/live/${n.target_id}`;
    if (n.target_type === "conversation") return `#/social/messages/${n.target_id}`;
    if (n.target_type === "story") return `#/social/stories/${SX.state.me?.id}`;
    if (["gift_received", "donation_received", "earnings_available", "withdrawal_update", "donation_refunded"].includes(n.type)) return "#/social/studio";
    if (n.type === "credits_added") return "#/social/wallet";
    return "#/social/notifications";
  };
})();
