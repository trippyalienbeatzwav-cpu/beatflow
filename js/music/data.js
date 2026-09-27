/* ==========================================================================
   Electronic Music Store helpers: genre lookup, keys and Camelot notation,
   formats, release types, display helpers, editorial collections and the smart
   query parser. The catalog (genres, labels, artists, releases, tracks) comes
   from the server via BF.setCatalog() (js/catalog.js).
   ========================================================================== */
(function () {
  /* ---------- Genres (server taxonomy; admins edit it through /api/store/admin/genres) ---------- */
  BF.EGENRES = [];
  BF.egenres = () => BF.EGENRES;
  BF.egenre = (id) => BF.EGENRES.find((g) => g.id === id) || { id, name: id, bpm: [100, 140], family: "four", palette: "graphite", style: "rings" };

  /* ---------- Musical keys & Camelot notation (harmonic mixing) ---------- */
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const CAM_MIN = { 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7, 9: 8, 4: 9, 11: 10, 6: 11, 1: 12 };
  const CAM_MAJ = { 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7, 0: 8, 7: 9, 2: 10, 9: 11, 4: 12 };
  BF.camelot = (key) => {
    const m = /^([A-G])([♯#♭b]?)\s*(maj|min)/.exec(key || ""); if (!m) return "";
    let s = NOTE[m[1]] + (m[2] === "♯" || m[2] === "#" ? 1 : m[2] === "♭" || m[2] === "b" ? -1 : 0);
    s = (s + 12) % 12;
    return m[3] === "min" ? CAM_MIN[s] + "A" : CAM_MAJ[s] + "B";
  };
  /** Keys that mix harmonically with a Camelot code: same, ±1, relative major/minor. */
  BF.compatibleCamelot = (code) => {
    const n = parseInt(code, 10), l = code.slice(-1);
    if (!n) return [];
    const wrap = (x) => ((x + 11) % 12) + 1;
    return [code, wrap(n - 1) + l, wrap(n + 1) + l, n + (l === "A" ? "B" : "A")];
  };
  BF.CAMELOT_WHEEL = Array.from({ length: 12 }, (_, i) => [i + 1 + "A", i + 1 + "B"]).flat();

  /* ---------- Formats & pricing ---------- */
  BF.FORMATS = {
    // mbps: megabytes per second of audio (MP3 320 kb/s; 24-bit stereo PCM at 48 kHz)
    MP3: { id: "MP3", label: "MP3", detail: "320 kbps", add: 0, mbps: 0.04 },
    WAV: { id: "WAV", label: "WAV", detail: "24-bit · master sample rate", add: 0.5, mbps: 0.288 },
    AIFF: { id: "AIFF", label: "AIFF", detail: "24-bit · for CDJs & Mac DJ apps", add: 0.5, mbps: 0.288 },
  };
  BF.RELEASE_TYPES = [
    ["single", "Single"], ["ep", "EP"], ["album", "Album"], ["remix", "Remixes"], ["compilation", "Compilation"],
    ["dj-tool", "DJ Tools"],
  ];
  BF.releaseTypeName = (t) => (BF.RELEASE_TYPES.find((x) => x[0] === t) || [null, t])[1];
  const PACKS = ["sample-pack", "loops", "stems"];
  BF.isPack = (rel) => PACKS.includes(rel.type);

  /* ---------- Prices: quoted by the server per item (cents); checkout re-prices server-side ---------- */
  BF.trackPrice = (t, fmt = "MP3") => (t?.prices?.[fmt] ?? 0) / 100;
  BF.releasePrice = (rel, fmt = "MP3") => (rel?.prices?.[fmt] ?? rel?.prices?.[rel.formats?.[0]] ?? 0) / 100;

  /* ---------- Display helpers ---------- */
  BF.trackTitle = (t) => t.title + (t.mix ? ` (${t.mix})` : "");
  BF.artistNames = (ids) => ids.map((id) => BF.eartistById[id]?.name).filter(Boolean).join(", ");
  BF.labelName = (id) => (id ? BF.labelById[id]?.name ?? "Unknown label" : "Independent");
  BF.releaseDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  BF.daysSince = (d) => Math.max(0, Math.floor((Date.now() - Date.parse(d + "T12:00:00")) / 864e5));
  BF.estSize = (t, fmt) => "≈" + (t.duration * BF.FORMATS[fmt].mbps).toFixed(0) + " MB";

  /** Unified lookup for anything playable/favoritable across both marketplaces. */
  BF.item = (id) => BF.beatById[id] || BF.packById[id] || BF.trackById[id] || BF.releaseById[id] || null;
  BF.isTrack = (id) => !!BF.trackById[id];

  /* ---------- Editorial collections (curated — NOT ranked) ---------- */
  BF.CRATE_TEMPLATES = ["Friday Night", "Warm Up", "Peak Time", "After Hours", "Driving", "Summer Set", "Closing Set", "Radio Show"];
  BF.COLLECTIONS = [
    { id: "essentials-warmup", title: "Warm-Up Essentials", curator: "Editors", blurb: "Low-energy, long-intro records that set a room without stealing it.", filter: (t) => t.energy <= 5 && t.duration > 330, palette: "ultra", style: "bloom" },
    { id: "essentials-peak", title: "Peak-Time Weapons", curator: "Editors", blurb: "Energy 8+, clean intros, built for the moment the lights drop.", filter: (t) => t.energy >= 8, palette: "graphite", style: "stripes" },
    { id: "essentials-tools", title: "Transition Tools", curator: "Oskar Veil", blurb: "Loops, rumbles and percussion to glue two records together.", filter: (t) => BF.releaseById[t.releaseId].type === "dj-tool", palette: "electric", style: "bars" },
    { id: "essentials-harmonic", title: "In the Key of F Minor", curator: "Editors", blurb: "Everything that mixes cleanly around 4A on the Camelot wheel.", filter: (t) => ["4A", "3A", "5A", "4B"].includes(t.camelot), palette: "acidnight", style: "rings" },
  ];
  BF.collectionById = Object.fromEntries(BF.COLLECTIONS.map((c) => [c.id, c]));

  /* ---------- Smart query parser: "124 BPM melodic techno", "8A deep house nightwave" ---------- */
  const ALIASES = { dnb: "drum-bass", "d&b": "drum-bass", "drum and bass": "drum-bass", jungle: "drum-bass", "nu disco": "disco", "nu-disco": "disco", "deep tech": "minimal-deep-tech", minimal: "minimal-deep-tech", ukg: "garage", "2 step": "garage", "2-step": "garage", idm: "electronica", "hard tech": "hard-techno", prog: "progressive-house" };
  BF.parseMusicQuery = (raw) => {
    let q = " " + String(raw || "").toLowerCase() + " ";
    const out = { bpm: null, genres: [], keys: [], labels: [], artists: [], types: [], cat: null, text: "" };
    let m;
    if ((m = /(\d{2,3})\s*(?:-|–|to)\s*(\d{2,3})\s*(?:bpm)?/.exec(q))) { out.bpm = [+m[1], +m[2]].sort((a, b) => a - b); q = q.replace(m[0], " "); }
    else if ((m = /(\d{2,3})\s*bpm|\bbpm\s*(\d{2,3})/.exec(q))) { const n = +(m[1] || m[2]); out.bpm = [n - 1, n + 1]; q = q.replace(m[0], " "); }
    else if ((m = /\s(\d{2,3})\s/.exec(q)) && +m[1] >= 60 && +m[1] <= 200) { out.bpm = [+m[1] - 1, +m[1] + 1]; q = q.replace(m[0], " "); }
    if ((m = /\s(1[0-2]|[1-9])([ab])\s/.exec(q))) { out.keys.push(m[1] + m[2].toUpperCase()); q = q.replace(m[0], " "); }
    const km = /\s([a-g])\s?(#|♯|b|♭)?\s?(m|min|minor|maj|major)\s/.exec(q);
    if (km) {
      const acc = km[2] === "#" || km[2] === "♯" ? "♯" : km[2] === "b" || km[2] === "♭" ? "♭" : "";
      const code = BF.camelot(`${km[1].toUpperCase()}${acc} ${km[3].startsWith("maj") ? "maj" : "min"}`);
      if (code) { out.keys.push(code); q = q.replace(km[0], " "); }
    }
    const names = [...BF.egenres().map((g) => [g.name.toLowerCase(), g.id]), ...Object.entries(ALIASES), ...BF.egenres().map((g) => [g.id.replace(/-/g, " "), g.id])].sort((a, b) => b[0].length - a[0].length);
    names.forEach(([n, id]) => { if (q.includes(" " + n + " ") || q.includes(" " + n + "s ")) { if (!out.genres.includes(id)) out.genres.push(id); q = q.replace(n, " "); } });
    BF.LABELS.forEach((l) => { const n = l.name.toLowerCase(); const short = n.split(" ")[0]; if (q.includes(n)) { out.labels.push(l.id); q = q.replace(n, " "); } else if (short.length > 4 && q.includes(" " + short + " ")) { out.labels.push(l.id); q = q.replace(short, " "); } });
    BF.EARTISTS.forEach((a) => { const n = a.name.toLowerCase(); if (q.includes(n)) { out.artists.push(a.id); q = q.replace(n, " "); } });
    [["dj tools", "dj-tool"], ["dj tool", "dj-tool"], ["sample pack", "sample-pack"], ["remixes", "remix"], ["remix", "remix"], ["albums", "album"], ["album", "album"], ["eps", "ep"], ["ep", "ep"], ["singles", "single"], ["single", "single"], ["loops", "loops"], ["stems", "stems"], ["compilation", "compilation"]]
      .forEach(([w, t]) => { if (q.includes(" " + w + " ")) { if (!out.types.includes(t)) out.types.push(t); q = q.replace(" " + w + " ", " "); } });
    const cm = BF.RELEASES.find((x) => q.includes(" " + x.cat.toLowerCase() + " "));
    if (cm) { out.cat = cm.id; q = q.replace(cm.cat.toLowerCase(), " "); }
    out.text = q.replace(/\s+/g, " ").trim();
    out.any = !!(out.bpm || out.genres.length || out.keys.length || out.labels.length || out.artists.length || out.types.length || out.cat);
    return out;
  };
})();
