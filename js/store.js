/* ==========================================================================
   Client state. Signed-in state lives on the server (favourites, follows,
   playlists, crates, cart, purchases, downloads, listening history); this
   module mirrors it, applies changes optimistically and rolls back if the API
   refuses. A signed-out shopper's cart stays on this device and is merged
   into their account when they sign in. Prices and totals always come from
   the server's quote. Device preferences (volume, formats, drafts) stay local.
   ========================================================================== */
(function () {
  const NS = "tb:v3:";
  const mem = {};
  const read = (k, fallback) => {
    try { const v = localStorage.getItem(NS + k); return v == null ? fallback : JSON.parse(v); }
    catch { return k in mem ? mem[k] : fallback; }
  };
  const write = (k, v) => {
    mem[k] = v;
    try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch { /* memory only */ }
  };
  const LOCAL = new Set(["dlFormat", "previewMode", "view", "volume", "recentSearches", "uploadDraft", "releaseDraft", "lastCheckout", "promo"]);

  const listeners = {};
  const state = {
    session: { signedIn: false, user: null },
    cart: read("guestCart", []),
    quote: null, cartProblems: [],
    favorites: [], favoriteKinds: {}, following: [], playlists: [], crates: [], recent: [],
    purchases: [], packPurchases: [], musicPurchases: [], downloads: [], musicDownloads: [], library: [],
    owned: { beats: {}, packs: [], tracks: [], releases: [] }, seller: null,
    recentSearches: read("recentSearches", []), promo: read("promo", null), lastCheckout: read("lastCheckout", null),
    uploadDraft: read("uploadDraft", null), releaseDraft: read("releaseDraft", null),
    dlFormat: read("dlFormat", "WAV"), previewMode: read("previewMode", "drop"), view: read("view", "grid"), volume: read("volume", 0.8),
  };
  const emit = (k, v) => { (listeners[k] || []).forEach((fn) => fn(v)); (listeners["*"] || []).forEach((fn) => fn(k, v)); };
  const signedIn = () => state.session.signedIn;
  const needSignIn = (what) => {
    BF.ui.toast({ kind: "info", title: "Sign in to continue", desc: what, action: { href: `#/login?next=${encodeURIComponent(location.hash.slice(1))}`, label: "Sign in" } });
    return false;
  };
  const failToast = (err, title) => BF.ui.toast({ kind: "error", title: title || "That didn’t work", desc: BF.esc(err.message || "Try again.") });
  const kindOf = (id) => (BF.beatById[id] ? "beat" : BF.packById[id] ? "pack" : BF.trackById[id] ? "track" : BF.releaseById[id] ? "release" : null);

  /* ---------- Cart ↔ API line mapping ---------- */
  const toApi = (c) => (c.beatId ? { kind: "beat", id: c.beatId, license_id: c.licenseId } : { kind: c.kind, id: c.id, format: c.format ?? null });
  const fromApi = (i) => (i.kind === "beat" ? { beatId: i.id, licenseId: i.license_id } : i.kind === "pack" ? { kind: "pack", id: i.id } : { kind: i.kind, id: i.id, format: i.format });
  const lineKeyOf = (c) => (c.beatId ? `beat:${c.beatId}` : `${c.kind}:${c.id}`);
  const cartSig = () => JSON.stringify(state.cart.map(toApi)) + "|" + (state.promo?.code ?? "");

  let quoteSeq = 0, syncTimer = null;
  async function refreshQuote() {
    const seq = ++quoteSeq, sig = cartSig();
    try {
      const q = await BF.http.post("/api/store/quote", { items: state.cart.map(toApi), promo_code: state.promo?.code ?? null });
      if (seq !== quoteSeq) return;
      state.quote = { ...q, sig }; state.cartProblems = q.problems ?? [];
      emit("cart", state.cart);
    } catch (err) {
      if (seq !== quoteSeq) return;
      if (err.code === "invalid_promo" || err.code === "promo_used") { state.promo = null; write("promo", null); BF.ui.toast({ kind: "info", title: "Promo removed", desc: BF.esc(err.message) }); refreshQuote(); }
    }
  }
  function persistCart() {
    if (!signedIn()) write("guestCart", state.cart);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      if (signedIn()) { try { await BF.http.put("/api/store/cart", { items: state.cart.map(toApi) }); } catch (err) { if (err.status !== 401) failToast(err, "Your cart couldn’t be saved"); } }
      refreshQuote();
    }, 120);
  }
  function setCart(next) { state.cart = next; state.quote = null; emit("cart", next); persistCart(); }

  /* ---------- Derived collections from the server's store state + library ---------- */
  function applyStoreState(s) {
    state.favorites = s.favorites.map((f) => f.id);
    state.favoriteKinds = Object.fromEntries(s.favorites.map((f) => [f.id, f.kind]));
    state.following = s.follows.map((f) => f.id);
    state.playlists = s.playlists.filter((p) => p.kind === "beats").map((p) => ({ id: p.id, title: p.title, beatIds: p.item_ids, updated: new Date(p.updated_at).toISOString().slice(0, 10), isPublic: p.is_public }));
    state.crates = s.playlists.filter((p) => p.kind === "crate").map((p) => ({ id: p.id, title: p.title, trackIds: p.item_ids }));
    state.recent = s.recent;
    state.owned = s.owned;
    state.seller = s.seller;
    ["favorites", "following", "playlists", "crates", "recent"].forEach((k) => emit(k, state[k]));
  }
  function applyLibrary(lib) {
    state.library = lib.items;
    const date = (t) => new Date(t).toISOString().slice(0, 10);
    state.purchases = lib.items.filter((e) => e.kind === "beat").map((e) => ({ entitlementId: e.id, orderItemId: e.order_item_id, reviewed: e.reviewed, title: e.title, beatId: e.item_id, license: e.license_id ?? "free", orderId: e.order_id, date: date(e.purchased_at), amount: (e.paid_cents ?? 0) / 100, files: e.files }));
    state.packPurchases = lib.items.filter((e) => e.kind === "pack").map((e) => ({ entitlementId: e.id, orderItemId: e.order_item_id, reviewed: e.reviewed, id: e.item_id, orderId: e.order_id, date: date(e.purchased_at), amount: (e.paid_cents ?? 0) / 100, files: e.files, marketplace: "beats" }));
    state.musicPurchases = lib.items.filter((e) => e.kind === "track" || e.kind === "release").map((e) => ({ entitlementId: e.id, title: e.title, kind: e.kind, id: e.item_id, format: e.format, orderId: e.order_id, date: date(e.purchased_at), amount: (e.paid_cents ?? 0) / 100, files: e.files }));
    const dl = (d) => { const e = lib.items.find((x) => x.id === d.entitlement_id); return { ...d, kind: e?.kind, itemId: e?.item_id, beatId: e?.kind === "beat" ? e.item_id : undefined, file: d.filename, size: d.bytes ? `${(d.bytes / 1048576).toFixed(1)} MB` : "—", date: new Date(d.created_at).toISOString().slice(0, 16).replace("T", " "), orderId: e?.order_id }; };
    state.downloads = lib.downloads.map(dl).filter((d) => d.kind === "beat" || d.kind === "pack");
    state.musicDownloads = lib.downloads.map(dl).filter((d) => d.kind === "track" || d.kind === "release");
    ["purchases", "packPurchases", "musicPurchases", "downloads", "musicDownloads"].forEach((k) => emit(k, state[k]));
  }

  BF.store = {
    get: (k) => state[k],
    set(k, v) {
      if (k === "cart") return setCart(v);
      state[k] = v;
      if (LOCAL.has(k)) write(k, v);
      emit(k, v);
    },
    on(k, fn) { (listeners[k] = listeners[k] || []).push(fn); return () => { listeners[k] = listeners[k].filter((f) => f !== fn); }; },

    /** Load the signed-in user's store state (or reset to a signed-out shopper). */
    async hydrate(user) {
      if (!user) {
        state.session = { signedIn: false, user: null };
        applyStoreState({ favorites: [], follows: [], playlists: [], recent: [], owned: { beats: {}, packs: [], tracks: [], releases: [] }, seller: null });
        applyLibrary({ items: [], downloads: [] });
        state.cart = read("guestCart", []);
        emit("session", state.session); emit("cart", state.cart); refreshQuote();
        return;
      }
      state.session = { signedIn: true, user: { id: user.id, name: user.display_name, handle: user.username, email: user.email, role: user.role, emailVerified: user.email_verified, avatar: user.avatar_url } };
      const guest = read("guestCart", []);
      const [s, lib, cart] = await Promise.all([BF.http.get("/api/store/me"), BF.http.get("/api/store/library"), BF.http.get("/api/store/cart")]);
      applyStoreState(s); applyLibrary(lib);
      let items = cart.items.map(fromApi);
      if (guest.length) {
        // Merge the device cart into the account (server rules apply: owned or unavailable items are reported, not added)
        const keys = new Set(items.map(lineKeyOf));
        items = [...items, ...guest.filter((c) => !keys.has(lineKeyOf(c)))];
        try { const r = await BF.http.put("/api/store/cart", { items: items.map(toApi) }); items = r.items.map(fromApi); } catch { /* keep server cart */ }
        write("guestCart", []);
      }
      state.cart = items;
      emit("session", state.session); emit("cart", state.cart);
      refreshQuote();
    },
    async refreshLibrary() { if (signedIn()) { const [s, lib] = await Promise.all([BF.http.get("/api/store/me"), BF.http.get("/api/store/library")]); applyStoreState(s); applyLibrary(lib); } },
    async signOut() {
      try { await BF.http.post("/api/auth/logout"); } catch { /* signed out locally regardless */ }
      await this.hydrate(null);
    },

    // ---- Favourites (server) ----
    isFav: (id) => state.favorites.includes(id),
    toggleFav(id) {
      if (!signedIn()) return needSignIn("Favourites are saved to your account.");
      const kind = kindOf(id); if (!kind) return false;
      const on = !this.isFav(id);
      this.set("favorites", on ? [id, ...state.favorites] : state.favorites.filter((x) => x !== id));
      BF.http[on ? "put" : "del"](`/api/store/favorites/${kind}/${id}`).catch((err) => { this.set("favorites", on ? state.favorites.filter((x) => x !== id) : [id, ...state.favorites]); failToast(err); });
      return on;
    },

    // ---- Following storefronts (server) ----
    isFollowing: (id) => state.following.includes(id),
    toggleFollow(id) {
      if (!signedIn()) return needSignIn("Follow producers, artists and labels from your account.");
      const kind = BF.producerById[id] ? "producer" : BF.labelById[id] ? "label" : BF.eartistById[id] ? "artist" : null;
      if (!kind) return false;
      const on = !this.isFollowing(id);
      this.set("following", on ? [...state.following, id] : state.following.filter((x) => x !== id));
      BF.http[on ? "put" : "del"](`/api/store/follows/${kind}/${id}`).catch((err) => { this.set("following", on ? state.following.filter((x) => x !== id) : [...state.following, id]); failToast(err); });
      return on;
    },

    // ---- Cart (device for guests, account when signed in; priced by the server) ----
    cartItem: (beatId) => state.cart.find((c) => c.beatId === beatId),
    addToCart(beatId, licenseId = "basic") {
      const b = BF.beatById[beatId];
      if (!b) throw new BF.api.MarketplaceError("That beat isn’t available.");
      if (!BF.licenseById[licenseId]) throw new BF.api.MarketplaceError("Choose a license tier.");
      if (BF.licenseById[licenseId].exclusive && !b.exclusiveAvailable) throw new BF.api.MarketplaceError("Exclusive rights are no longer available for this beat");
      if (!BF.licAvailable(b, licenseId)) throw new BF.api.MarketplaceError(`The ${BF.licenseById[licenseId].name} includes stems, and this producer hasn’t uploaded them.`);
      const existing = this.cartItem(beatId);
      setCart(existing ? state.cart.map((c) => (c.beatId === beatId ? { ...c, licenseId } : c)) : [...state.cart, { beatId, licenseId }]);
      return existing ? "updated" : "added";
    },
    removeFromCart(beatId) { setCart(state.cart.filter((c) => c.beatId !== beatId)); },
    clearCart() { setCart([]); },
    musicItem: (kind, id) => state.cart.find((c) => c.kind === kind && c.id === id),
    ownsMusic: (kind, id) => (kind === "track" ? state.owned.tracks.includes(id) : state.owned.releases.includes(id)),
    ownsBeat: (id, licenseId) => (licenseId ? (state.owned.beats[id] ?? []).includes(licenseId) : !!state.owned.beats[id]),
    addMusic(kind, id, format) {
      const rel = kind === "release" ? BF.releaseById[id] : BF.releaseById[BF.trackById[id]?.releaseId];
      if (!rel) throw new BF.api.MarketplaceError("That item isn’t available.");
      format = rel.formats.includes(format) ? format : rel.formats.includes(state.dlFormat) ? state.dlFormat : rel.formats[0];
      let cart = state.cart, replaced = 0;
      if (kind === "release") { const before = cart.length; cart = cart.filter((c) => !(c.kind === "track" && rel.trackIds.includes(c.id))); replaced = before - cart.length; }
      if (kind === "track" && this.musicItem("release", rel.id)) return { status: "covered", rel };
      const existing = cart.find((c) => c.kind === kind && c.id === id);
      setCart(existing ? cart.map((c) => (c === existing ? { ...c, format } : c)) : [...cart, { kind, id, format }]);
      return { status: existing ? "updated" : "added", replaced, format, rel };
    },
    removeMusic(kind, id) { setCart(state.cart.filter((c) => !(c.kind === kind && c.id === id))); },
    packItem: (id) => state.cart.find((c) => c.kind === "pack" && c.id === id),
    ownsPack: (id) => state.owned.packs.includes(id),
    addPack(id) {
      if (!BF.packById[id]) throw new BF.api.MarketplaceError("That pack isn’t available.");
      if (this.packItem(id)) return "exists";
      setCart([...state.cart, { kind: "pack", id }]);
      return "added";
    },

    /** Normalised cart line for display, priced from the server quote when it's current. */
    cartLine(c) {
      const key = lineKeyOf(c);
      const q = state.quote?.sig === cartSig() ? state.quote.lines.find((l) => l.key === key) : null;
      if (c.beatId) { const beat = BF.beatById[c.beatId]; return { ...c, kind: "beat", marketplace: "beats", key, beat, price: q ? q.unit_cents / 100 : BF.priceFor(beat, c.licenseId) }; }
      if (c.kind === "pack") { const pack = BF.packById[c.id]; return { ...c, marketplace: "beats", key, pack, price: q ? q.unit_cents / 100 : pack.price }; }
      if (c.kind === "track") { const t = BF.trackById[c.id]; return { ...c, marketplace: "electronic", key, track: t, rel: BF.releaseById[t.releaseId], price: q ? q.unit_cents / 100 : BF.trackPrice(t, c.format) }; }
      const rel = BF.releaseById[c.id]; return { ...c, marketplace: "electronic", key, rel, price: q ? q.unit_cents / 100 : BF.releasePrice(rel, c.format) };
    },
    /** Totals from the server quote (pending: true until the quote for this exact cart has arrived). */
    cartTotals() {
      const lines = state.cart.filter((c) => (c.beatId ? BF.beatById[c.beatId] : BF.item(c.id))).map((c) => this.cartLine(c));
      const counts = { beats: lines.filter((l) => l.kind === "beat").length, packs: lines.filter((l) => l.kind === "pack").length, tracks: lines.filter((l) => l.kind === "track").length, releases: lines.filter((l) => l.kind === "release").length };
      const q = state.quote?.sig === cartSig() ? state.quote : null;
      if (!q) {
        const subtotal = lines.reduce((s, l) => s + l.price, 0);
        return { lines, counts, subtotal, bundle: 0, promo: state.promo, promoAmt: 0, discount: 0, serviceFee: counts.beats ? 1.49 : 0, tax: 0, total: subtotal + (counts.beats ? 1.49 : 0), pending: true, problems: [] };
      }
      return { lines, counts, subtotal: q.subtotal_cents / 100, bundle: q.bundle_cents / 100, promo: q.promo ? { code: q.promo.code, pct: q.promo.percent / 100 } : null, promoAmt: q.promo_cents / 100,
        discount: q.discount_cents / 100, serviceFee: q.service_fee_cents / 100, tax: q.tax_cents / 100, total: q.total_cents / 100, totalCents: q.total_cents, pending: false, problems: q.problems ?? [] };
    },
    /** Validate a promo code with the server; resolves true/false. */
    async applyPromo(code) {
      try {
        const r = await BF.http.post("/api/store/promo", { code });
        this.set("promo", { code: r.promo.code, pct: r.promo.percent / 100 });
        state.quote = null; refreshQuote();
        return { ok: true };
      } catch (err) { return { ok: false, message: err.message }; }
    },
    removePromo() { this.set("promo", null); state.quote = null; refreshQuote(); },
    refreshQuote,

    // ---- Playlists (beats) and DJ crates (tracks) on the server ----
    async createPlaylist(kind, title, itemIds = []) {
      if (!signedIn()) return needSignIn("Playlists are saved to your account.");
      const r = await BF.http.post("/api/store/playlists", { kind, title, item_ids: itemIds });
      await this.refreshCollections();
      return r.playlist;
    },
    async addToPlaylistId(playlistId, itemId) {
      if (!signedIn()) return needSignIn("Playlists are saved to your account.");
      const r = await BF.http.post(`/api/store/playlists/${playlistId}/items`, { item_id: itemId });
      await this.refreshCollections();
      return r.added;
    },
    async removeFromPlaylist(playlistId, itemId) { await BF.http.del(`/api/store/playlists/${playlistId}/items/${encodeURIComponent(itemId)}`); await this.refreshCollections(); },
    async renamePlaylist(playlistId, title) { await BF.http.patch(`/api/store/playlists/${playlistId}`, { title }); await this.refreshCollections(); },
    async deletePlaylist(playlistId) { await BF.http.del(`/api/store/playlists/${playlistId}`); await this.refreshCollections(); },
    async refreshCollections() { if (signedIn()) applyStoreState(await BF.http.get("/api/store/me")); },
    addToCrate(crateId, trackId) { return this.addToPlaylistId(crateId, trackId); },

    // ---- Listening history (the preview engine reports counted plays to the server) ----
    pushRecent(id) { if (BF.trackById[id]) this.set("recent", [id, ...state.recent.filter((x) => x !== id)].slice(0, 30)); },
    pushRecentSearch(q) {
      q = q.trim(); if (!q) return;
      this.set("recentSearches", [q, ...state.recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6));
    },
  };
})();
