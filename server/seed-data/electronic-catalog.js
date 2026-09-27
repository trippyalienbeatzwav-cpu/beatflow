/* ==========================================================================
   Electronic Music Store seed catalog (fictional): genres, labels, artists, releases, tracks.
   Evaluated once by server/seed-data/catalog.js to fill the database; the front end reads the
   catalog from the API. Deterministic so track IDs match assets/audio/analysis/<id>.* .
   ========================================================================== */
(function () {
  const r = BF.rng(4242);

  /* ---------- Genre system ----------
     `family` drives the preview synth pattern. Admins can add, rename, hide
     and reorder genres from Dashboard → Genres (stored as overrides). */
  const BASE_GENRES = [
    ["house", "House", 118, 128, "four", "ocean", "bars"],
    ["tech-house", "Tech House", 124, 128, "four", "graphite", "grid"],
    ["deep-house", "Deep House", 118, 124, "four", "ultra", "bloom"],
    ["progressive-house", "Progressive House", 122, 128, "trance", "electric", "horizon"],
    ["afro-house", "Afro House", 118, 124, "afro", "gold", "sun"],
    ["melodic-house", "Melodic House", 118, 124, "four", "ultra", "rings"],
    ["minimal-deep-tech", "Minimal / Deep Tech", 124, 128, "minimal", "graphite", "bars"],
    ["techno", "Techno", 128, 138, "techno", "graphite", "stripes"],
    ["melodic-techno", "Melodic Techno", 120, 126, "techno", "electric", "horizon"],
    ["trance", "Trance", 134, 140, "trance", "ice", "rings"],
    ["drum-bass", "Drum & Bass", 170, 176, "dnb", "acidnight", "shards"],
    ["dubstep", "Dubstep", 138, 142, "halftime", "acidnight", "shards"],
    ["garage", "Garage", 130, 136, "garage", "dusk", "grid"],
    ["breakbeat", "Breakbeat", 125, 135, "breaks", "ember", "stripes"],
    ["electro", "Electro", 120, 135, "breaks", "electric", "grid"],
    ["disco", "Disco / Nu-Disco", 110, 124, "disco", "rose", "sun"],
    ["electronica", "Electronica", 90, 130, "breaks", "jade", "waves"],
    ["downtempo", "Downtempo", 80, 110, "downtempo", "dusk", "waves"],
    ["ambient", "Ambient", 60, 100, "ambient", "ice", "bloom"],
    ["hardcore", "Hardcore", 160, 200, "hardcore", "blood", "shards"],
    ["hard-techno", "Hard Techno", 145, 160, "techno", "blood", "bars"],
    ["industrial", "Industrial", 130, 145, "techno", "chrome", "stripes"],
    ["uk-bass", "UK Bass", 130, 140, "breaks", "acidnight", "grid"],
    ["future-bass", "Future Bass", 140, 160, "halftime", "violet", "bloom"],
    ["synthwave", "Synthwave", 80, 118, "synth", "rose", "horizon"],
    ["other-electronic", "Other Electronic", 90, 140, "four", "graphite", "rings"],
  ];
  BF.EGENRES_BASE = BASE_GENRES.map(([id, name, lo, hi, family, palette, style], i) => ({ id, name, bpm: [lo, hi], family, palette, style, order: i, visible: true }));

  /** Live genre list = base + admin overrides (renames, hides, additions, order). */
  BF.egenres = () => {
    const ov = (BF.store && BF.store.get("genreAdmin")) || { edits: {}, added: [] };
    return [...BF.EGENRES_BASE, ...ov.added]
      .map((g) => ({ ...g, ...(ov.edits[g.id] || {}) }))
      .sort((a, b) => a.order - b.order);
  };
  BF.egenre = (id) => BF.egenres().find((g) => g.id === id) || { id, name: id, bpm: [100, 140], family: "four", palette: "graphite", style: "rings" };

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
    MP3: { id: "MP3", label: "MP3", detail: "320 kbps", add: 0, mb: 0.0024 },
    WAV: { id: "WAV", label: "WAV", detail: "24-bit / 44.1 kHz", add: 0.5, mb: 0.0158 },
    AIFF: { id: "AIFF", label: "AIFF", detail: "24-bit · tags preserved", add: 0.5, mb: 0.0159 },
  };
  BF.RELEASE_TYPES = [
    ["single", "Single"], ["ep", "EP"], ["album", "Album"], ["remix", "Remixes"], ["compilation", "Compilation"],
    ["dj-tool", "DJ Tools"],
  ];
  BF.releaseTypeName = (t) => (BF.RELEASE_TYPES.find((x) => x[0] === t) || [null, t])[1];
  const PACKS = ["sample-pack", "loops", "stems"];
  BF.isPack = (rel) => PACKS.includes(rel.type);

  /* ---------- Labels ---------- */
  BF.LABELS = [
    { id: "bfr", name: `${BF.brand.name} RECORDS`, mono: "BF", prefix: "BFR", city: "Berlin", founded: 2021, palette: "electric", verified: true, followers: 84210,
      genres: ["melodic-techno", "melodic-house", "progressive-house", "synthwave"],
      bio: `The platform’s in-house imprint. Melodic, patient club music from new and established artists — every release mastered for large systems and available in lossless.` },
    { id: "nightwave", name: "NIGHTWAVE MUSIC", mono: "NW", prefix: "NWV", city: "London", founded: 2014, palette: "ultra", verified: true, followers: 61880,
      genres: ["deep-house", "tech-house", "minimal-deep-tech"],
      bio: "Deep and tech house for the hours after midnight. Rolling grooves, warm subs, and records built to be mixed long." },
    { id: "voidsignal", name: "VOID SIGNAL", mono: "VS", prefix: "VS", city: "Rotterdam", founded: 2017, palette: "graphite", verified: true, followers: 72540,
      genres: ["techno", "hard-techno", "industrial", "electro"],
      bio: "Warehouse techno, stripped to function. Dark, relentless and engineered for peak time." },
    { id: "afterdark", name: "AFTERDARK RECORDINGS", mono: "AD", prefix: "ADR", city: "Bristol", founded: 2012, palette: "acidnight", verified: true, followers: 49320,
      genres: ["drum-bass", "garage", "uk-bass", "dubstep", "breakbeat"],
      bio: "Bass music from the South West: drum & bass, garage and everything that swings in between." },
    { id: "solstice", name: "SOLSTICE TAPES", mono: "ST", prefix: "SLT", city: "Reykjavík", founded: 2019, palette: "ice", verified: true, followers: 18990,
      genres: ["ambient", "downtempo", "electronica"],
      bio: "Slow music for long nights. Ambient, downtempo and electronica on a small-batch label." },
    { id: "kiln", name: "KILN AUDIO", mono: "KA", prefix: "KLN", city: "Johannesburg", founded: 2018, palette: "gold", verified: false, followers: 12470,
      genres: ["afro-house", "disco"],
      bio: "Afro house and disco edits from Johannesburg’s independent scene. Verification in progress." },
  ];
  BF.labelById = Object.fromEntries(BF.LABELS.map((l) => [l.id, l]));
  BF.LABELS.forEach((l) => (l.banner = BF.banner("label-" + l.id, l.palette)));

  /* ---------- Artists ---------- */
  BF.EARTISTS = [
    ["a1", "Mira Kaan", "mirakaan", "Berlin", "electric", ["melodic-techno", "melodic-house"], true, 142300, "Melodic techno producer and live performer. Analog synths, long builds, and emotional breakdowns that land in the dark."],
    ["a2", "Oskar Veil", "oskarveil", "Rotterdam", "graphite", ["techno", "electro"], true, 98700, "Resident of warehouse nights across the Low Countries. Functional, hypnotic techno cut for four-hour sets."],
    ["a3", "Nightjar", "nightjar", "London", "ultra", ["deep-house", "melodic-house"], true, 64200, "Deep house built from late-night field recordings, warm pads and patient grooves."],
    ["a4", "Akin Sol", "akinsol", "Johannesburg", "gold", ["afro-house"], true, 57100, "Afro house producer blending live percussion with spiritual, chant-led toplines."],
    ["a5", "Vanta Loop", "vantaloop", "Leeds", "blood", ["hard-techno", "industrial", "hardcore"], true, 44800, "Hard techno and industrial. Distortion as texture, rhythm as weight."],
    ["a6", "Rhea Kova", "rheakova", "Amsterdam", "ice", ["trance", "progressive-house"], true, 71900, "Modern trance: big melodies, restrained sound design, and a lot of space."],
    ["a7", "Dune Theory", "dunetheory", "Bristol", "acidnight", ["drum-bass", "dubstep", "breakbeat"], true, 53600, "Drum & bass duo with a taste for rolling liquid and heavy halftime."],
    ["a8", "Echo Lane", "echolane", "Manchester", "dusk", ["garage", "uk-bass"], true, 38200, "Two-step garage and UK bass with a vocal-chop habit."],
    ["a9", "Petra Vos", "petravos", "Reykjavík", "ice", ["ambient", "downtempo", "electronica"], true, 29500, "Ambient composer working with tape loops, field recordings and modular synthesis."],
    ["a10", "Coda Black", "codablack", "Barcelona", "graphite", ["tech-house", "minimal-deep-tech"], true, 81400, "Tech house and minimal for sunrise terraces. Groove first, always."],
    ["a11", "Lune", "lune", "Montréal", "rose", ["synthwave", "future-bass", "electronica"], true, 46300, "Synthwave and future bass. Chrome melodies and nostalgic drums."],
    ["a12", "Marlo Fenn", "marlofenn", "Paris", "rose", ["disco"], false, 8900, "Nu-disco edits and originals. Self-released, verification pending."],
  ].map(([id, name, handle, city, palette, genres, verified, followers, bio]) => ({ id, name, handle, city, palette, genres, verified, followers, bio, avatar: BF.avatar("ea" + id + name, palette), banner: BF.banner("ea" + handle, palette) }));
  BF.eartistById = Object.fromEntries(BF.EARTISTS.map((a) => [a.id, a]));
  BF.eartistByHandle = Object.fromEntries(BF.EARTISTS.map((a) => [a.handle, a]));

  /* ---------- Releases + tracks ----------
     [id, type, title, artistIds, labelId|null, catNo, date, genre, style, palette, formats, tracks[, extra]]
     track: [title, mix, bpm, key, "m:ss", energy, genre?, remixerId?, explicit?] */
  const ALL = ["WAV", "AIFF", "MP3"];
  const RAW = [
    ["r1", "ep", "NIGHT CIRCUIT", ["a2"], "voidsignal", "VS042", "2026-09-19", "techno", "stripes", "graphite", ALL, [
      ["Night Circuit", "Original Mix", 132, "A min", "7:12", 8], ["Electric Motion", "Original Mix", 131, "F min", "6:48", 7],
      ["After Dark", "Original Mix", 130, "D min", "7:05", 6], ["Neon Pulse", "Original Mix", 133, "G min", "6:31", 9]]],
    ["r2", "single", "NEON HORIZON", ["a1"], "bfr", "BFR021", "2026-09-22", "melodic-techno", "horizon", "electric", ALL, [
      ["Neon Horizon", "Original Mix", 124, "F min", "7:24", 7], ["Neon Horizon", "Extended Mix", 124, "F min", "8:40", 7]]],
    ["r3", "remix", "NEON HORIZON (THE REMIXES)", ["a1"], "bfr", "BFR023", "2026-09-24", "melodic-techno", "rings", "ultra", ALL, [
      ["Neon Horizon", "Rhea Kova Remix", 138, "F min", "7:02", 8, "trance", "a6"], ["Neon Horizon", "Vanta Loop Remix", 150, "F min", "6:15", 10, "hard-techno", "a5"]]],
    ["r4", "album", "SOFT MACHINES", ["a9"], "solstice", "SLT009", "2026-08-29", "ambient", "bloom", "ice", ALL, [
      ["First Light", "", 72, "D maj", "5:40", 2], ["Glass Weather", "", 84, "A min", "6:12", 3, "downtempo"], ["Harbor", "", 70, "E min", "7:30", 2],
      ["Low Orbit", "", 96, "C maj", "5:05", 4, "electronica"], ["Soft Machines", "", 90, "G maj", "6:48", 3], ["Snowfield", "", 64, "B min", "8:20", 1]]],
    ["r5", "ep", "DEEP END", ["a3"], "nightwave", "NWV118", "2026-09-12", "deep-house", "bloom", "ultra", ALL, [
      ["Deep End", "Original Mix", 121, "C min", "6:55", 5], ["Velvet Room", "Original Mix", 120, "E♭ maj", "7:10", 4], ["3AM Walk", "Original Mix", 119, "G min", "6:40", 4]]],
    ["r6", "ep", "UMOYA", ["a4"], "kiln", "KLN033", "2026-09-05", "afro-house", "sun", "gold", ALL, [
      ["Umoya", "Original Mix", 122, "A min", "7:48", 6], ["Red Earth", "Original Mix", 121, "D min", "7:20", 7], ["Ember Drum", "Original Mix", 123, "F♯ min", "6:58", 8]]],
    ["r7", "single", "PRESSURE SYSTEM", ["a5"], "voidsignal", "VS043", "2026-09-23", "hard-techno", "bars", "blood", ALL, [
      ["Pressure System", "Original Mix", 152, "C♯ min", "5:48", 10], ["Pressure System", "Dub", 152, "C♯ min", "6:02", 9]]],
    ["r8", "single", "HALCYON DRIFT", ["a6"], "bfr", "BFR022", "2026-09-15", "trance", "rings", "ice", ALL, [
      ["Halcyon Drift", "Original Mix", 138, "B♭ min", "7:36", 8], ["Halcyon Drift", "Extended Mix", 138, "B♭ min", "9:05", 8]]],
    ["r9", "ep", "UNDERTOW", ["a7"], "afterdark", "ADR077", "2026-09-17", "drum-bass", "shards", "acidnight", ALL, [
      ["Undertow", "Original Mix", 174, "F min", "5:30", 8], ["Night Bus", "Original Mix", 174, "A min", "5:12", 7], ["Glass Cannon", "Original Mix", 175, "E min", "4:58", 9]]],
    ["r10", "single", "LATE SHIFT", ["a8"], "afterdark", "ADR078", "2026-09-20", "garage", "grid", "dusk", ["WAV", "MP3"], [
      ["Late Shift", "Original Mix", 132, "G min", "5:20", 6, null, null, true], ["Late Shift", "Dub Mix", 132, "G min", "5:44", 6]]],
    ["r11", "ep", "WORK THE ROOM", ["a10"], "nightwave", "NWV119", "2026-09-21", "tech-house", "grid", "graphite", ALL, [
      ["Work The Room", "Original Mix", 126, "A min", "6:32", 8, null, null, true], ["Groove Tax", "Original Mix", 127, "E min", "6:18", 7], ["Late Checkout", "Original Mix", 126, "D min", "6:44", 7]]],
    ["r12", "album", "CHROMATIC CITY", ["a11"], "bfr", "BFR020", "2026-08-15", "synthwave", "horizon", "rose", ALL, [
      ["Chromatic City", "", 104, "A min", "4:40", 6], ["Night Drive ’86", "", 98, "D min", "5:02", 5], ["Arcade Rain", "", 110, "E min", "4:22", 6],
      ["Paper Lantern", "", 150, "F maj", "3:58", 7, "future-bass"], ["Coastline", "", 92, "C maj", "5:30", 4, "electronica"]]],
    ["r13", "compilation", "AFTERDARK SESSIONS VOL. 3", ["a7", "a8"], "afterdark", "ADRCOMP03", "2026-09-10", "drum-bass", "shards", "acidnight", ALL, [
      ["Signal Fire", "Original Mix", 174, "D min", "5:05", 8], ["Two Step Home", "Original Mix", 134, "B♭ min", "5:18", 6, "garage"],
      ["Fault Lines", "Original Mix", 140, "G min", "4:48", 9, "dubstep"], ["Breakline", "Original Mix", 130, "E min", "5:36", 7, "breakbeat"]], { artistsPerTrack: ["a7", "a8", "a7", "a7"] }],
    ["r14", "dj-tool", "TECHNO TOOLS VOL. 1", ["a2"], "voidsignal", "VSTOOL01", "2026-09-01", "techno", "bars", "graphite", ["WAV", "MP3"], [
      ["Tool 1", "Kick Loop", 130, "A min", "4:00", 6], ["Tool 2", "Rumble", 130, "A min", "4:00", 7], ["Tool 3", "Percussion", 130, "A min", "4:00", 5]]],
    ["r15", "sample-pack", "MELODIC TECHNO ESSENTIALS", ["a1"], "bfr", "BFRS01", "2026-09-08", "melodic-techno", "horizon", "electric", ["WAV"], [
      ["Pack Demo", "Preview", 124, "F min", "1:30", 6]], { pack: "412 samples · 38 MIDI files · 2.1 GB", packPrice: 24.99 }],
    ["r16", "loops", "AFRO HOUSE PERCUSSION", ["a4"], "kiln", "KLNS02", "2026-08-26", "afro-house", "sun", "gold", ["WAV"], [
      ["Loops Demo", "Preview", 122, "A min", "1:20", 6]], { pack: "180 loops · 120–124 BPM · 860 MB", packPrice: 14.99 }],
    ["r17", "stems", "NEON HORIZON — STEMS", ["a1"], "bfr", "BFR021S", "2026-09-22", "melodic-techno", "horizon", "electric", ["WAV"], [
      ["Stems Demo", "Preview", 124, "F min", "1:30", 7]], { pack: "8 stems · 24-bit WAV · 1.1 GB · remix contest terms included", packPrice: 9.99 }],
    ["r18", "single", "MIRRORBALL MOTEL", ["a12"], null, "MF001", "2026-09-24", "disco", "sun", "rose", ["WAV", "MP3"], [
      ["Mirrorball Motel", "Original Mix", 118, "F♯ min", "6:05", 7], ["Mirrorball Motel", "Edit", 118, "F♯ min", "3:48", 7]]],
    ["r19", "single", "SLOW BURN", ["a6"], "bfr", "BFR024", "2026-09-25", "progressive-house", "horizon", "electric", ALL, [
      ["Slow Burn", "Original Mix", 126, "G♯ min", "7:40", 6]]],
    ["r20", "single", "MICRO / MACRO", ["a10"], "nightwave", "NWV120", "2026-09-25", "minimal-deep-tech", "bars", "graphite", ALL, [
      ["Micro / Macro", "Original Mix", 127, "C min", "7:02", 6]]],
    ["r21", "single", "RUST BELT", ["a5"], "voidsignal", "VS044", "2026-08-20", "industrial", "stripes", "chrome", ALL, [
      ["Rust Belt", "Original Mix", 138, "E min", "6:10", 9], ["Rust Belt", "Signal Remix", 136, "E min", "6:44", 8, "electro", "a2"]]],
    ["r22", "single", "GOLDEN MILE", ["a3"], "bfr", "BFR019", "2026-08-08", "melodic-house", "sun", "ultra", ALL, [
      ["Golden Mile", "Original Mix", 122, "D♭ maj", "6:50", 5]]],
    ["r23", "single", "OVERDRIVE 180", ["a5"], null, "VL001", "2026-07-30", "hardcore", "shards", "blood", ["WAV", "MP3"], [
      ["Overdrive 180", "Original Mix", 180, "A min", "4:40", 10, null, null, true]]],
    ["r24", "single", "TIDEPOOL", ["a9"], "solstice", "SLT010", "2026-09-18", "electronica", "waves", "jade", ALL, [
      ["Tidepool", "Original Mix", 108, "E maj", "5:24", 4]]],
    ["r25", "single", "HOUSE OF GLASS", ["a3"], "nightwave", "NWV117", "2026-07-18", "house", "bars", "ocean", ALL, [
      ["House of Glass", "Original Mix", 124, "E♭ min", "6:28", 7], ["House of Glass", "Nightjar Dub", 124, "E♭ min", "6:50", 6]]],
    ["r26", "single", "WIRE & WOOL", ["a2"], "voidsignal", "VS041", "2026-08-02", "electro", "grid", "electric", ALL, [
      ["Wire & Wool", "Original Mix", 128, "B min", "5:54", 7]]],
    ["r27", "single", "SIGNAL LOST", ["a11"], "bfr", "BFR025", "2026-09-25", "other-electronic", "rings", "graphite", ALL, [
      ["Signal Lost", "Original Mix", 112, "C♯ min", "4:50", 5]]],
  ];

  const toSec = (s) => { const [m, x] = s.split(":").map(Number); return m * 60 + x; };
  const bars = (sec, bpm) => Math.max(8, Math.round(((sec * 0.12) / 60) * bpm / 4 / 8) * 8);

  BF.RELEASES = [];
  BF.ETRACKS = [];
  RAW.forEach(([id, type, title, artistIds, labelId, cat, date, genre, style, palette, formats, tracks, extra = {}], ri) => {
    const art = BF.art("rel-" + id + title, style, palette);
    const rel = { id, type, title, artistIds, labelId, cat, date, genre, art, palette, formats, trackIds: [], ...extra,
      description: `${BF.releaseTypeName(type)} on ${labelId ? BF.labelById[labelId].name : "an independent release"}. Mastered for club systems; ${formats.join(" / ")} available.` };
    tracks.forEach(([tt, mix, bpm, key, dur, energy, g, remixerId, explicit], i) => {
      const tid = `t${BF.ETRACKS.length + 1}`;
      const duration = toSec(dur);
      const tg = g || genre;
      const plays = Math.floor(3000 + r() * 90000 * (ri < 10 ? 1.8 : 1));
      BF.ETRACKS.push({
        id: tid, kind: "track", releaseId: id, n: i + 1, title: tt, mix, artistIds: extra.artistsPerTrack ? [extra.artistsPerTrack[i]] : artistIds,
        remixerId: remixerId || null, genre: tg, family: BF.egenre(tg).family, bpm, key, camelot: BF.camelot(key), duration, energy,
        intro: BF.isPack(rel) ? "—" : `${bars(duration, bpm)}-bar intro`, outro: BF.isPack(rel) ? "—" : `${bars(duration, bpm)}-bar outro`,
        dropAt: Math.round(duration * (0.28 + r() * 0.08)), explicit: !!explicit, labelId, date, art,
        plays, downloads: Math.floor(plays * (0.01 + r() * 0.02)), trendScore: Math.floor(r() * 100) + (Date.parse(date) > Date.parse("2026-09-14") ? 30 : 0),
      });
      rel.trackIds.push(tid);
    });
    BF.RELEASES.push(rel);
  });
  // Sample packs, loops and stems are production material: they live in the Beats Store (BF.PACKS), never here.
  BF.RELEASES = BF.RELEASES.filter((x) => !BF.isPack(x));
  const keepTracks = new Set(BF.RELEASES.flatMap((x) => x.trackIds));
  BF.ETRACKS = BF.ETRACKS.filter((t) => keepTracks.has(t.id));
  BF.RELEASES.forEach((x) => { x.marketplace = "electronic"; x.kind = "release"; });
  BF.ETRACKS.forEach((t) => (t.marketplace = "electronic"));
  BF.LABELS.forEach((l) => { l.marketplace = "electronic"; l.kind = "label"; });
  BF.EARTISTS.forEach((a) => { a.marketplace = "electronic"; a.kind = "artist"; });
  BF.releaseById = Object.fromEntries(BF.RELEASES.map((x) => [x.id, x]));
  BF.trackById = Object.fromEntries(BF.ETRACKS.map((t) => [t.id, t]));
  // Sellable tracks exclude pack previews (packs are bought as a whole)
  BF.sellableTracks = () => BF.ETRACKS.filter((t) => !BF.isPack(BF.releaseById[t.releaseId]));

  BF.EARTISTS.forEach((a) => {
    a.releaseIds = BF.RELEASES.filter((x) => x.artistIds.includes(a.id) || x.trackIds.some((id) => BF.trackById[id].remixerId === a.id || BF.trackById[id].artistIds.includes(a.id))).map((x) => x.id);
  });
  BF.LABELS.forEach((l) => (l.releaseIds = BF.RELEASES.filter((x) => x.labelId === l.id).map((x) => x.id)));

  /* ---------- Display helpers ---------- */
  BF.trackTitle = (t) => t.title + (t.mix ? ` (${t.mix})` : "");
  BF.artistNames = (ids) => ids.map((id) => BF.eartistById[id]?.name).filter(Boolean).join(", ");
  BF.labelName = (id) => (id ? BF.labelById[id].name : "Independent");
  BF.releaseDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  BF.daysSince = (d) => Math.floor((Date.parse("2026-09-25") - Date.parse(d)) / 864e5);
  BF.estSize = (t, fmt) => (t.duration * 60 * BF.FORMATS[fmt].mb).toFixed(1) + " MB";

})();
