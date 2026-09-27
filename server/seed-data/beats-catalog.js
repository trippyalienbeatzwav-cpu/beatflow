/* ==========================================================================
   Beats Store seed catalog (fictional): genres, producers, license templates, beats, packs, producer
   playlists and review texts. Evaluated once by server/seed-data/catalog.js to fill the database;
   the front end reads the catalog from the API, never from this file. Deterministic (seeded RNG) so
   IDs and values match the ingested audio assets.
   ========================================================================== */
(function () {
  const r = BF.rng(20260925);

  BF.GENRES = [
    { id: "hip-hop", name: "Hip-Hop", palette: "gold", style: "monolith", count: 18240 },
    { id: "trap", name: "Trap", palette: "blood", style: "shards", count: 24110 },
    { id: "rnb", name: "R&B", palette: "rose", style: "bloom", count: 11385 },
    { id: "drill", name: "Drill", palette: "chrome", style: "stripes", count: 9540 },
    { id: "afrobeats", name: "Afrobeats", palette: "acid", style: "sun", count: 7215 },
    { id: "pop", name: "Pop", palette: "violet", style: "rings", count: 8870 },
    { id: "lo-fi", name: "Lo-Fi", palette: "dusk", style: "waves", count: 6120 },
    { id: "soul", name: "Soul", palette: "ember", style: "sun", count: 4380 },
    { id: "reggaeton", name: "Reggaeton", palette: "jade", style: "grid", count: 5260 },
  ];
  BF.genreById = Object.fromEntries(BF.GENRES.map((g) => [g.id, g]));

  BF.MOODS = ["Dark", "Energetic", "Chill", "Melancholic", "Romantic", "Aggressive", "Uplifting", "Dreamy", "Bouncy", "Cinematic"];
  BF.KEYS = ["C maj", "C min", "C♯ min", "D maj", "D min", "E♭ maj", "E min", "F maj", "F min", "F♯ min", "G maj", "G min", "G♯ min", "A maj", "A min", "B♭ min", "B min"];

  /* ---------- Producers ---------- */
  BF.PRODUCERS = [
    { id: "p1", handle: "kairovance", name: "Kairo Vance", verified: true, location: "Atlanta, GA", palette: "violet", since: 2019,
      bio: "Atlanta-based producer and engineer. Dark, cinematic trap with live-played keys and hard-hitting 808s. Placements across indie and major-label projects. Every beat mixed and tracked out in-house.",
      followers: 48210, sales: 3184, genres: ["trap", "hip-hop"], rating: 4.9, reviews: 412, responseTime: "~2 hrs",
      socials: { instagram: "@kairovance", youtube: "Kairo Vance", site: "kairovance.example" } },
    { id: "p2", handle: "lumenhalls", name: "Lumen Halls", verified: true, location: "London, UK", palette: "ice", since: 2020,
      bio: "South London drill and alt-R&B. Sliding 808s, choir pads, and cold keys. Stems available on every release.",
      followers: 31480, sales: 1920, genres: ["drill", "rnb"], rating: 4.8, reviews: 268, responseTime: "~5 hrs",
      socials: { instagram: "@lumenhalls", youtube: "Lumen Halls", site: "lumenhalls.example" } },
    { id: "p3", handle: "oteri", name: "Oteri", verified: true, location: "Lagos, NG", palette: "acid", since: 2018,
      bio: "Afrobeats, amapiano crossovers and highlife guitar. Log drums, shakers, and melodies built for the dance floor.",
      followers: 52930, sales: 4011, genres: ["afrobeats", "pop"], rating: 4.9, reviews: 530, responseTime: "~3 hrs",
      socials: { instagram: "@oteri.wav", youtube: "Oteri", site: "oteri.example" } },
    { id: "p4", handle: "nadiasol", name: "Nadia Sol", verified: true, location: "Los Angeles, CA", palette: "rose", since: 2021,
      bio: "Warm R&B and neo-soul. Live bass, Rhodes, and vocal chops. Writing-friendly arrangements with space for the topline.",
      followers: 22740, sales: 1288, genres: ["rnb", "soul"], rating: 5.0, reviews: 151, responseTime: "~1 hr",
      socials: { instagram: "@nadiasol", youtube: "Nadia Sol Music", site: "nadiasol.example" } },
    { id: "p5", handle: "greymotel", name: "Grey Motel", verified: true, location: "Chicago, IL", palette: "dusk", since: 2017,
      bio: "Tape-saturated lo-fi and soul loops. Everything runs through a four-track before it reaches you.",
      followers: 19860, sales: 2240, genres: ["lo-fi", "soul"], rating: 4.7, reviews: 204, responseTime: "~1 day",
      socials: { instagram: "@greymotel", youtube: "Grey Motel Tapes", site: "greymotel.example" } },
    { id: "p6", handle: "vesperco", name: "Vesper & Co", verified: true, location: "Toronto, ON", palette: "ocean", since: 2020,
      bio: "Production duo making glossy pop and moody R&B. Radio-ready mixes, clean arrangements, fast custom turnarounds.",
      followers: 27305, sales: 1655, genres: ["pop", "rnb"], rating: 4.8, reviews: 187, responseTime: "~4 hrs",
      socials: { instagram: "@vesper.co", youtube: "Vesper & Co", site: "vesperco.example" } },
    { id: "p7", handle: "santoruido", name: "Santo Ruido", verified: true, location: "San Juan, PR", palette: "jade", since: 2019,
      bio: "Reggaeton, dembow and Latin trap. Perreo drums with modern sound design.",
      followers: 35620, sales: 2410, genres: ["reggaeton", "trap"], rating: 4.8, reviews: 309, responseTime: "~6 hrs",
      socials: { instagram: "@santoruido", youtube: "Santo Ruido", site: "santoruido.example" } },
    { id: "p8", handle: "makobeats", name: "Mako", verified: false, location: "Houston, TX", palette: "ember", since: 2024,
      bio: "Houston hip-hop. Chopped soul samples and screwed textures. Verification in progress.",
      followers: 2140, sales: 96, genres: ["hip-hop", "soul"], rating: 4.6, reviews: 18, responseTime: "~1 day",
      socials: { instagram: "@mako.beats", youtube: "Mako Beats", site: "" } },
  ];
  BF.producerById = Object.fromEntries(BF.PRODUCERS.map((p) => [p.id, p]));
  BF.producerByHandle = Object.fromEntries(BF.PRODUCERS.map((p) => [p.handle, p]));
  BF.PRODUCERS.forEach((p) => { p.avatar = BF.avatar(p.id + p.name, p.palette); p.banner = BF.banner(p.handle, p.palette); });

  /* ---------- License templates (producer-configurable) ----------
     These are sample TERMS a producer has configured, not legal advice or
     platform guarantees. The full agreement is generated per order. */
  BF.LICENSES = [
    { id: "basic", name: "Basic Lease", short: "Basic", files: "MP3", formats: ["MP3"], price: 19.99,
      summary: "Untagged MP3 for demos, streaming releases and socials.",
      terms: [
        ["Files", "MP3 · 320 kbps, untagged"],
        ["Distribution copies", "Up to 5,000"],
        ["Audio streams", "Up to 100,000"],
        ["Music videos", "1 video"],
        ["Live performances", "Non-profit only"],
        ["Radio broadcasting", "Not included"],
        ["Producer credit", "Required — “Prod. by {producer}”"],
        ["Term", "Non-exclusive · 3 years"],
      ] },
    { id: "premium", name: "Premium Lease", short: "Premium", files: "WAV + MP3", formats: ["WAV", "MP3"], price: 49.99, popular: true,
      summary: "Studio-quality WAV for mixing, plus MP3. Higher release caps.",
      terms: [
        ["Files", "WAV 24-bit/48 kHz + MP3, untagged"],
        ["Distribution copies", "Up to 20,000"],
        ["Audio streams", "Up to 500,000"],
        ["Music videos", "Unlimited"],
        ["Live performances", "For-profit allowed"],
        ["Radio broadcasting", "Up to 2 stations"],
        ["Producer credit", "Required — “Prod. by {producer}”"],
        ["Term", "Non-exclusive · 5 years"],
      ] },
    { id: "trackout", name: "Trackout Lease", short: "Trackout", files: "WAV + Stems", formats: ["WAV", "MP3", "STEMS"], price: 99.99,
      summary: "Every instrument on its own track for full mix control.",
      terms: [
        ["Files", "Stems (per-instrument WAVs) + WAV + MP3"],
        ["Distribution copies", "Up to 100,000"],
        ["Audio streams", "Unlimited"],
        ["Music videos", "Unlimited"],
        ["Live performances", "For-profit allowed"],
        ["Radio broadcasting", "Unlimited stations"],
        ["Producer credit", "Required — “Prod. by {producer}”"],
        ["Term", "Non-exclusive · 10 years"],
      ] },
    { id: "exclusive", name: "Exclusive Rights", short: "Exclusive", files: "All files + ownership transfer", formats: ["WAV", "MP3", "STEMS"], price: 499.99, exclusive: true,
      summary: "Beat is removed from sale after purchase. Terms negotiated with the producer.",
      terms: [
        ["Files", "Stems + WAV + MP3 + project notes"],
        ["Distribution & streams", "Unlimited"],
        ["Availability", "Removed from the store after purchase"],
        ["Prior leases", "Existing non-exclusive licenses remain valid"],
        ["Publishing split", "As set in the producer’s agreement"],
        ["Producer credit", "Required — “Prod. by {producer}”"],
        ["Term", "Exclusive · perpetual, per agreement"],
      ] },
  ];
  BF.licenseById = Object.fromEntries(BF.LICENSES.map((l) => [l.id, l]));

  /* ---------- Beats ---------- */
  // [title, producerIdx, genre, bpm, key, moods, tags, durSec, priceMult, style, palette]
  const RAW = [
    ["MIDNIGHT DRIVE", 0, "trap", 142, "F♯ min", ["Dark", "Cinematic"], ["dark trap", "808", "night"], 172, 1, "sun", "violet"],
    ["NO SIGNAL", 1, "drill", 144, "C♯ min", ["Dark", "Aggressive"], ["uk drill", "sliding 808", "choir"], 158, 1, "stripes", "chrome"],
    ["AFTER HOURS", 3, "rnb", 88, "E♭ maj", ["Romantic", "Chill"], ["slow jam", "rhodes", "late night"], 196, 1, "bloom", "rose"],
    ["NEON RAIN", 1, "rnb", 96, "A min", ["Melancholic", "Dreamy"], ["alt r&b", "ambient", "rain"], 184, 1, "rings", "ice"],
    ["LAST CALL", 0, "hip-hop", 90, "D min", ["Dark", "Cinematic"], ["boom bap", "strings", "gritty"], 165, 1, "monolith", "gold"],
    ["DARK ROOM", 0, "trap", 150, "G min", ["Dark", "Aggressive"], ["hard trap", "bells", "808"], 148, 1.2, "shards", "blood"],
    ["GOLDEN HOUR", 2, "afrobeats", 104, "G maj", ["Uplifting", "Bouncy"], ["afro pop", "highlife guitar", "summer"], 188, 1, "sun", "gold"],
    ["LAGOS NIGHTS", 2, "afrobeats", 112, "F min", ["Bouncy", "Romantic"], ["amapiano", "log drum", "groove"], 204, 1, "grid", "acid"],
    ["VELVET TAPE", 4, "lo-fi", 78, "B♭ min", ["Chill", "Melancholic"], ["lofi", "vinyl", "jazz chords"], 142, 0.8, "waves", "dusk"],
    ["SLOW BLOOM", 3, "soul", 72, "F maj", ["Romantic", "Dreamy"], ["neo soul", "live bass", "warm"], 210, 1, "bloom", "ember"],
    ["GLASS HOUSE", 5, "pop", 118, "C maj", ["Uplifting", "Energetic"], ["synth pop", "radio", "bright"], 176, 1.2, "rings", "violet"],
    ["LUNA LLENA", 6, "reggaeton", 94, "A min", ["Bouncy", "Romantic"], ["perreo", "dembow", "latin"], 168, 1, "grid", "jade"],
    ["COLD CASE", 1, "drill", 140, "B min", ["Dark", "Cinematic"], ["ny drill", "piano", "cinematic"], 162, 1, "monolith", "chrome"],
    ["STATIC", 0, "trap", 160, "E min", ["Aggressive", "Energetic"], ["rage", "synth", "distorted"], 136, 1, "stripes", "blood"],
    ["OVERCAST", 4, "lo-fi", 82, "D maj", ["Chill", "Dreamy"], ["study", "tape", "mellow"], 150, 0.8, "waves", "ocean"],
    ["SIDE STREET", 7, "hip-hop", 86, "C min", ["Dark", "Melancholic"], ["soul sample", "chopped", "houston"], 158, 0.8, "shards", "ember"],
    ["HEAT CHECK", 6, "trap", 146, "G♯ min", ["Energetic", "Aggressive"], ["latin trap", "808", "club"], 150, 1, "shards", "dusk"],
    ["HALF MOON", 3, "rnb", 68, "G min", ["Romantic", "Melancholic"], ["ballad", "keys", "vocal chops"], 202, 1, "sun", "rose"],
    ["ORBIT", 5, "pop", 124, "F♯ min", ["Energetic", "Dreamy"], ["dance pop", "pluck", "festival"], 170, 1.2, "rings", "ocean"],
    ["CONCRETE", 1, "drill", 142, "F min", ["Aggressive", "Dark"], ["uk drill", "gritty", "bass"], 154, 1, "grid", "chrome"],
    ["WARM LEATHER", 4, "soul", 84, "E♭ maj", ["Romantic", "Chill"], ["70s soul", "horns", "sample"], 180, 0.8, "sun", "ember"],
    ["BACKSEAT", 5, "rnb", 100, "B♭ min", ["Romantic", "Dreamy"], ["r&b pop", "guitar", "smooth"], 186, 1, "bloom", "violet"],
    ["CALOR", 6, "reggaeton", 96, "D min", ["Bouncy", "Energetic"], ["reggaeton", "summer", "club"], 172, 1, "waves", "jade"],
    ["EASTSIDE", 7, "hip-hop", 92, "A min", ["Dark", "Cinematic"], ["boom bap", "piano", "raw"], 166, 0.8, "monolith", "mono"],
    ["FEVER DREAM", 0, "trap", 138, "C♯ min", ["Dreamy", "Dark"], ["ambient trap", "guitar", "melodic"], 178, 1, "bloom", "violet"],
    ["SUNRISE AVE", 2, "afrobeats", 108, "E min", ["Uplifting", "Romantic"], ["afro r&b", "percussion", "smooth"], 194, 1, "waves", "gold"],
    ["4AM IN SEOUL", 4, "lo-fi", 74, "G maj", ["Chill", "Melancholic"], ["lofi", "piano", "rainy"], 138, 0.8, "rings", "dusk"],
    ["SILVER LINING", 5, "pop", 112, "D maj", ["Uplifting", "Energetic"], ["pop", "piano", "anthem"], 182, 1.2, "sun", "chrome"],
    ["LOW TIDE", 3, "soul", 76, "A maj", ["Chill", "Romantic"], ["soul", "rhodes", "sunday"], 198, 1, "waves", "ocean"],
    ["RED LIGHTS", 6, "trap", 150, "F min", ["Dark", "Energetic"], ["latin trap", "dark", "bells"], 144, 1, "stripes", "blood"],
    ["PAPER MOON", 7, "soul", 80, "F♯ min", ["Melancholic", "Dreamy"], ["soul sample", "lofi", "warm"], 160, 0.8, "bloom", "gold"],
    ["HIGH TIDE", 2, "afrobeats", 116, "C maj", ["Bouncy", "Uplifting"], ["afroswing", "guitar", "vibes"], 176, 1, "grid", "ice"],
  ];

  const DESCS = {
    trap: "Hard-hitting 808s, crisp hats with triplet rolls and a haunting top line. Leaves plenty of room in the mids for vocals.",
    drill: "Sliding 808s, syncopated drill percussion and cold, cinematic textures. Arranged with a clean intro for your hook.",
    rnb: "Lush keys, warm sub and soft percussion built for smooth toplines and stacked harmonies.",
    "hip-hop": "Dusty drums, weighty low end and a looping melodic motif — built for bars.",
    afrobeats: "Log drums, shakers and guitar licks with a rolling groove designed to move a room.",
    pop: "Bright synths, tight drums and a big pre-chorus lift. Mixed loud and radio-ready.",
    "lo-fi": "Tape-warm drums, detuned keys and vinyl texture — mellow, spacious and loopable.",
    soul: "Live-feel bass, Rhodes and horn stabs with an old-soul swing.",
    reggaeton: "Classic dembow pattern, punchy perc and a moody melodic hook.",
  };

  BF.BEATS = RAW.map((b, i) => {
    const producer = BF.PRODUCERS[b[1]];
    const days = Math.floor(r() * 120);
    const plays = Math.floor(2000 + r() * 180000 * (i < 8 ? 1.6 : 1));
    return {
      id: "b" + (i + 1),
      slug: b[0].toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title: b[0],
      producerId: producer.id,
      genre: b[2],
      bpm: b[3],
      key: b[4],
      moods: b[5],
      tags: b[6],
      duration: b[7],
      priceMult: b[8],
      art: BF.art(b[0] + i, b[9], b[10]),
      artStyle: b[9], palette: b[10],
      plays,
      likes: Math.floor(plays * (0.04 + r() * 0.05)),
      sales: Math.floor(plays * (0.002 + r() * 0.004)),
      trendScore: Math.floor(r() * 100) + (days < 30 ? 30 : 0),
      daysAgo: days,
      exclusiveAvailable: i !== 9,
      freeDownload: i % 7 === 3,
      description: DESCS[b[2]],
      credits: [["Produced by", producer.name], ["Mixed by", i % 3 ? producer.name : "Ade Lawson"], ["Instruments", ["Keys, 808, drums", "Guitar, bass, drums", "Synths, strings, drums"][i % 3]]],
      contentId: i % 4 === 0 ? "Registered" : "Not registered",
      stems: ["Kick", "Snare / Clap", "Hi-hats", "808", "Keys", "Melody", "FX"].slice(0, 5 + (i % 3)),
    };
  });
  BF.beatById = Object.fromEntries(BF.BEATS.map((b) => [b.id, b]));

  BF.priceFor = (beat, licenseId) => {
    const l = BF.licenseById[licenseId];
    if (!l) return 0;
    if (l.exclusive) return Math.round((l.price * beat.priceMult) / 10) * 10 - 0.01;
    return Math.round(l.price * beat.priceMult) - 0.01;
  };
  BF.basePrice = (beat) => BF.priceFor(beat, "basic");

  // Producer rollups
  BF.PRODUCERS.forEach((p) => { p.beatIds = BF.BEATS.filter((b) => b.producerId === p.id).map((b) => b.id); p.totalBeats = p.beatIds.length * 23 + 11; });

  /* ---------- Marketplace identity (every entity is tagged; see js/api.js) ---------- */
  BF.BEATS.forEach((b) => { b.marketplace = "beats"; b.kind = "beat"; });
  BF.PRODUCERS.forEach((p) => { p.marketplace = "beats"; p.kind = "producer"; });

  /* ---------- Production packs (Beats Store): samples, loops, production kits ---------- */
  // [id, type, title, producerIdx, genre, bpm, key, contents, size, price, style, palette]
  BF.PACK_TYPES = { samples: "Sample Pack", loops: "Loop Kit", production: "Production Pack", stems: "Stem Kit" };
  BF.PACKS = [
    ["k1", "samples", "808 SCRIPTURE DRUM KIT", 0, "trap", 142, "F♯ min", "120 one-shots · 40 808s · 12 FX", "640 MB", 29.99, "shards", "blood"],
    ["k2", "loops", "LOG DRUM LOOPS VOL. 1", 2, "afrobeats", 112, "F min", "64 loops · 108–116 BPM · labelled by key", "1.2 GB", 24.99, "grid", "acid"],
    ["k3", "samples", "TAPE SOUL CHOPS", 4, "soul", 84, "E♭ maj", "90 royalty-cleared chops · tape-saturated", "780 MB", 19.99, "sun", "dusk"],
    ["k4", "production", "NEO-SOUL KEYS KIT", 3, "rnb", 88, "E♭ maj", "36 Rhodes & organ loops · 48 MIDI files · presets", "1.6 GB", 34.99, "bloom", "rose"],
    ["k5", "production", "DRILL STARTER PACK", 1, "drill", 144, "C♯ min", "Drums, 808 slides, choir pads · project templates", "2.2 GB", 39.99, "stripes", "chrome"],
    ["k6", "stems", "MIDNIGHT DRIVE — STEM KIT", 0, "trap", 142, "F♯ min", "8 stems · 24-bit WAV · for practice & flips (non-commercial)", "520 MB", 9.99, "sun", "violet"],
  ].map(([id, type, title, pi, genre, bpm, key, contents, size, price, style, palette]) => ({
    id, kind: "pack", marketplace: "beats", type, title, producerId: BF.PRODUCERS[pi].id, genre, bpm, key, contents, size, price,
    duration: 75, formats: ["WAV"], art: BF.art("pack-" + id + title, style, palette),
    terms: type === "stems" ? "Non-commercial practice and remix use only." : "Royalty-free for use in your own productions, per the producer’s pack license. Resale of the sounds themselves isn’t permitted.",
  }));
  BF.packById = Object.fromEntries(BF.PACKS.map((k) => [k.id, k]));

  /* ---------- Reviews ---------- */
  BF.REVIEWS = [
    { who: "Tariq M.", role: "Artist · Detroit", stars: 5, beat: "b1", date: "Sep 12, 2026", text: "Mix was clean out the box — the stems made it easy for my engineer. Kairo answered a question about the license within an hour." },
    { who: "Ella Rhodes", role: "Songwriter · Nashville", stars: 5, beat: "b3", date: "Sep 3, 2026", text: "Beautiful arrangement with room to write. Premium WAV sounded great on the first bounce." },
    { who: "KZN", role: "Artist · Johannesburg", stars: 4, beat: "b8", date: "Aug 28, 2026", text: "The log drum pattern is crazy. Would love a version with a shorter intro, but the producer offered to send one." },
    { who: "Marco Villa", role: "Artist · Miami", stars: 5, beat: "b12", date: "Aug 21, 2026", text: "Clear license terms, instant download, license PDF in my inbox. Exactly what I needed for a release on Friday." },
    { who: "Joi Carter", role: "Artist · Atlanta", stars: 5, beat: "b6", date: "Aug 14, 2026", text: "Bought the trackout — every stem labelled and in time. Pro." },
    { who: "Nico B.", role: "Rapper · Berlin", stars: 4, beat: "b2", date: "Aug 2, 2026", text: "Hard beat. Checkout was quick. Wish there were more drill sliding variations but no complaints." },
  ];

  /* ---------- Playlists / albums ---------- */
  BF.PLAYLISTS = [
    { id: "pl1", title: "Late Night Sessions", by: "p1", beatIds: ["b1", "b25", "b6", "b14"], palette: "violet", style: "rings" },
    { id: "pl2", title: "Drill Essentials", by: "p2", beatIds: ["b2", "b13", "b20"], palette: "chrome", style: "stripes" },
    { id: "pl3", title: "Sunday Soul", by: "p4", beatIds: ["b10", "b29", "b18", "b3"], palette: "ember", style: "sun" },
    { id: "pl4", title: "Afro Heat", by: "p3", beatIds: ["b7", "b8", "b26", "b32"], palette: "acid", style: "grid" },
    { id: "pl5", title: "Study Tapes", by: "p5", beatIds: ["b9", "b15", "b27", "b21"], palette: "dusk", style: "waves" },
  ].map((p) => ({ ...p, art: BF.art(p.id + p.title, p.style, p.palette) }));

})();
