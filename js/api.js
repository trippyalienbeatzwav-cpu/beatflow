/* ==========================================================================
   Client for the TUNIBEAT API.

   BF.http        fetch wrapper: same-origin cookie session, CSRF header, JSON
                  errors → BF.ApiError { status, code, message, fields }.
   BF.MARKETPLACES store definitions (names, routes, order prefixes).
   BF.api         catalog reads scoped to one marketplace, and search. Every
                  rule that matters (prices, ownership, availability,
                  marketplace separation) is enforced by the server; checks
                  here only give fast feedback in the UI.

     Marketplace
     ├── beats        products: beat, pack      entities: producer, license
     └── electronic   products: track, release  entities: artist, label
   ========================================================================== */
(function () {
  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? `Request failed (${status})`);
      this.status = status; this.code = body?.error?.code ?? "error"; this.fields = body?.error?.fields ?? null; this.extra = body?.error ?? {};
    }
  }
  BF.ApiError = ApiError;
  async function request(method, url, body, { signal, timeout = 20000 } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), timeout);
    signal?.addEventListener("abort", () => ctl.abort(signal.reason));
    let res;
    try {
      res = await fetch(url, { method, credentials: "same-origin", signal: ctl.signal,
        headers: { "x-tunibeat-csrf": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new ApiError(0, { error: { code: ctl.signal.aborted ? "timeout" : "network", message: ctl.signal.aborted ? "The server took too long to answer. Try again." : "You’re offline or the server can’t be reached." } });
    } finally { clearTimeout(timer); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      if (res.status === 401 && !url.startsWith("/api/auth")) BF.onSignedOut?.();
      throw new ApiError(res.status, data);
    }
    return data;
  }
  BF.http = {
    get: (u, o) => request("GET", u, undefined, o), post: (u, b = {}, o) => request("POST", u, b, o), put: (u, b = {}, o) => request("PUT", u, b, o),
    patch: (u, b = {}, o) => request("PATCH", u, b, o), del: (u, o) => request("DELETE", u, undefined, o),
  };
  BF.ikey = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

  const MARKETPLACES = {
    beats: {
      id: "beats", name: "Beats Store", short: "Beats", home: "#/beats", library: "#/beats/library", search: "#/beats/search", orderPrefix: "TBB",
      products: ["beat", "pack"], entities: ["producer", "license"],
      verbs: { buy: "Buy Beat", license: "License", pack: "Buy Pack" },
    },
    electronic: {
      id: "electronic", name: "Electronic Music Store", short: "Electronic", home: "#/electronic", library: "#/electronic/library", search: "#/electronic/search", orderPrefix: "TBE",
      products: ["track", "release"], entities: ["artist", "label"],
      verbs: { track: "Buy Track", release: "Buy Release" },
    },
  };
  BF.MARKETPLACES = MARKETPLACES;

  class MarketplaceError extends Error {}
  const fail = (msg) => { throw new MarketplaceError(msg); };
  const collections = {
    beats: { beat: () => BF.BEATS, pack: () => BF.PACKS, producer: () => BF.PRODUCERS },
    electronic: { track: () => BF.ETRACKS, release: () => BF.RELEASES, artist: () => BF.EARTISTS, label: () => BF.LABELS },
  };

  /** Search result shapes used by the pages (ids from the server resolved against the loaded catalog). */
  const resolve = (ids, map) => (ids ?? []).map((x) => map[x]).filter(Boolean);
  async function searchBeats(q, limit) {
    const r = await BF.http.get(`/api/store/search?marketplace=beats&limit=50&q=${encodeURIComponent(q)}`);
    const all = resolve(r.groups.beat, BF.beatById);
    const ql = q.trim().toLowerCase();
    const genres = BF.GENRES.filter((g) => ql.length > 1 && g.name.toLowerCase().includes(ql));
    return { beats: { allBeats: all, totalBeats: all.length, beats: all.slice(0, limit), producers: resolve(r.groups.producer, BF.producerById), genres }, packs: resolve(r.groups.pack, BF.packById) };
  }
  async function searchMusic(q, limit) {
    const parsed = BF.parseMusicQuery(q);
    const text = parsed.text;
    let tracks;
    if (parsed.any) {
      // Structured DJ filters (BPM range, Camelot key, genre, label, type) run as a server-side track query
      const p = new URLSearchParams({ limit: "100", sort: "trending" });
      if (parsed.bpm) { p.set("bpm_min", parsed.bpm[0]); p.set("bpm_max", parsed.bpm[1]); }
      if (parsed.keys[0]) p.set("camelot", parsed.keys[0]);
      if (parsed.genres.length) p.set("genre", parsed.genres.join(","));
      if (parsed.labels[0]) p.set("label", parsed.labels[0]);
      if (parsed.types[0] && parsed.types[0] !== "sample-pack" && parsed.types[0] !== "loops" && parsed.types[0] !== "stems") p.set("type", parsed.types[0]);
      if (text) p.set("q", text);
      const r = await BF.http.get(`/api/store/tracks?${p}`);
      tracks = r.items.map((t) => BF.trackById[t.id]).filter(Boolean);
      if (parsed.artists.length) tracks = tracks.filter((t) => t.artistIds.some((a) => parsed.artists.includes(a)) || parsed.artists.includes(t.remixerId));
      if (parsed.cat) tracks = tracks.filter((t) => t.releaseId === parsed.cat);
    }
    const r = await BF.http.get(`/api/store/search?marketplace=electronic&limit=50&q=${encodeURIComponent(parsed.any ? text || q : q)}`);
    if (!parsed.any) tracks = resolve(r.groups.track, BF.trackById);
    const releases = parsed.cat ? [BF.releaseById[parsed.cat]] : resolve(r.groups.release, BF.releaseById);
    return { parsed, allTracks: tracks, tracks: tracks.slice(0, limit), totalTracks: tracks.length, allReleases: releases.filter(Boolean), releases: releases.slice(0, limit),
      artists: [...new Set([...resolve(r.groups.artist, BF.eartistById), ...parsed.artists.map((a) => BF.eartistById[a])])].filter(Boolean),
      labels: [...new Set([...resolve(r.groups.label, BF.labelById), ...parsed.labels.map((l) => BF.labelById[l])])].filter(Boolean) };
  }

  BF.api = {
    MarketplaceError,
    marketplaceOf(entity) {
      if (!entity || !MARKETPLACES[entity.marketplace]) fail(`Entity ${entity?.id ?? "?"} has no marketplace tag`);
      return entity.marketplace;
    },
    /** Catalog read scoped to one marketplace + type (loaded from the server at boot). */
    catalog(marketplace, kind) {
      const m = MARKETPLACES[marketplace] || fail(`Unknown marketplace "${marketplace}"`);
      if (![...m.products, ...m.entities].includes(kind)) fail(`"${kind}" is not sold in the ${m.name}`);
      return (collections[marketplace][kind]?.() || []).filter((x) => x.marketplace === marketplace);
    },
    /** Server search, scoped to one marketplace unless the caller explicitly asks for both. */
    async search(q, { marketplace, limit = 5 } = {}) {
      if (marketplace && !MARKETPLACES[marketplace]) fail(`Unknown marketplace "${marketplace}"`);
      const [b, e] = await Promise.all([
        !marketplace || marketplace === "beats" ? searchBeats(q, limit) : null,
        !marketplace || marketplace === "electronic" ? searchMusic(q, limit) : null,
      ]);
      return { beats: b?.beats ?? null, packs: b?.packs ?? [], electronic: e };
    },
  };

  /** Current marketplace from the URL (null on platform pages). */
  BF.currentMarketplace = () => {
    const p = (location.hash.slice(1) || "/").split("?")[0];
    return p.startsWith("/beats") ? "beats" : p.startsWith("/electronic") ? "electronic" : null;
  };
})();
