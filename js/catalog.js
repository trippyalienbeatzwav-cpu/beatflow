/* ==========================================================================
   Catalog loader. The server owns the catalog; at boot the app fetches
   GET /api/store/bootstrap (ETag-cached) and builds the in-memory indexes the
   pages read synchronously (BF.BEATS, BF.beatById, BF.ETRACKS, …).
   Generative artwork is stored as parameters and rendered here; uploaded
   artwork arrives as a URL.
   ========================================================================== */
(function () {
  const artOf = (a, fallbackSeed) => (typeof a === "string" ? a : a?.seed ? BF.art(a.seed, a.style, a.palette) : BF.art(fallbackSeed, "rings", "graphite"));
  const avatarOf = (a, seed, palette) => (typeof a === "string" ? a : a?.seed ? BF.avatar(a.seed, a.palette) : BF.avatar(seed, palette || "graphite"));
  const bannerOf = (a, seed, palette) => (typeof a === "string" ? a : a?.seed ? BF.banner(a.seed, a.palette) : BF.banner(seed, palette || "graphite"));
  const index = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

  BF.catalogVersion = 0;
  BF.setCatalog = (p) => {
    // Electronic taxonomy (admin-managed on the server)
    BF.EGENRES = p.genres.electronic.map((g) => ({ ...g, bpm: g.bpm ?? [90, 140] }));
    BF.LICENSES = p.licenses;
    BF.licenseById = index(BF.LICENSES);

    BF.BEATS = p.beats.map((b) => ({ ...b, art: artOf(b.art, b.id + b.title) }));
    BF.beatById = index(BF.BEATS);
    BF.PACKS = p.packs.map((k) => ({ ...k, art: artOf(k.art, k.id + k.title) }));
    BF.packById = index(BF.PACKS);
    BF.GENRES = p.genres.beats.filter((g) => g.visible).map((g) => ({ id: g.id, name: g.name, palette: g.palette, style: g.style, count: BF.BEATS.filter((b) => b.genre === g.id).length }));
    BF.genreById = index(BF.GENRES);
    BF.PRODUCERS = p.producers.map((x) => ({ ...x, avatar: avatarOf(x.avatar, x.id + x.name, x.palette), banner: bannerOf(x.banner, x.handle, x.palette) }));
    BF.producerById = index(BF.PRODUCERS);
    BF.producerByHandle = Object.fromEntries(BF.PRODUCERS.map((x) => [x.handle, x]));
    BF.PLAYLISTS = p.playlists.map((pl) => ({ ...pl, art: BF.art(pl.id + pl.title, "rings", BF.producerById[pl.by]?.palette || "violet") }));

    BF.LABELS = p.labels.map((l) => ({ ...l, banner: bannerOf(l.banner, "label-" + l.id, l.palette) }));
    BF.labelById = index(BF.LABELS);
    BF.EARTISTS = p.artists.map((a) => ({ ...a, avatar: avatarOf(a.avatar, "ea" + a.id + a.name, a.palette), banner: bannerOf(a.banner, "ea" + a.handle, a.palette) }));
    BF.eartistById = index(BF.EARTISTS);
    BF.eartistByHandle = Object.fromEntries(BF.EARTISTS.map((a) => [a.handle, a]));
    BF.RELEASES = p.releases.map((r) => ({ ...r, art: artOf(r.art, "rel-" + r.id + r.title) }));
    BF.releaseById = index(BF.RELEASES);
    BF.ETRACKS = p.tracks.map((t) => ({ ...t, art: BF.releaseById[t.releaseId]?.art ?? artOf(t.art, t.id) }));
    BF.trackById = index(BF.ETRACKS);
    BF.sellableTracks = () => BF.ETRACKS;
    BF.TRENDING_SEARCHES = p.trendingSearches?.length ? p.trendingSearches : BF.SUGGESTED_SEARCHES;
    BF.RECENT_SALES = (p.recentSales ?? []).filter((s) => (s.kind === "beat" ? BF.beatById : BF.packById)?.[s.itemId]);
    BF.catalogVersion = p.version;
  };

  /** Everything the app needs before the first render: session, catalog, and the signed-in user's store state. */
  BF.boot = async () => {
    const [me, catalog] = await Promise.all([BF.http.get("/api/me"), BF.http.get("/api/store/bootstrap")]);
    BF.env = me.env;
    BF.setCatalog(catalog);
    await BF.store.hydrate(me.user);
  };
  /** Re-read the catalog (after purchases change availability, or when a seller publishes). */
  BF.refreshCatalog = async () => {
    const catalog = await BF.http.get("/api/store/bootstrap");
    BF.setCatalog(catalog);
  };
})();
