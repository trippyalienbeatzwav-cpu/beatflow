/* ==========================================================================
   Beats Store taxonomy and presentation helpers. The catalog itself (genres,
   producers, licenses, beats, packs, playlists) comes from the server:
   GET /api/store/bootstrap → BF.setCatalog() (js/catalog.js). Nothing here is
   a source of truth for prices, stock or statistics.
   ========================================================================== */
(function () {
  BF.MOODS = ["Dark", "Energetic", "Chill", "Melancholic", "Romantic", "Aggressive", "Uplifting", "Dreamy", "Bouncy", "Cinematic"];
  BF.KEYS = ["C maj", "C min", "C♯ min", "D maj", "D min", "E♭ maj", "E min", "F maj", "F min", "F♯ min", "G maj", "G min", "G♯ min", "A maj", "A min", "B♭ min", "B min"];
  BF.PACK_TYPES = { samples: "Sample Pack", loops: "Loop Kit", production: "Production Pack", stems: "Stem Kit" };

  /** Display prices come from the server's quote for each item (cents → dollars). Checkout re-prices server-side. */
  BF.priceFor = (beat, licenseId) => (beat?.prices?.[licenseId] ?? 0) / 100;
  BF.basePrice = (beat) => BF.priceFor(beat, "basic");

  /* ---------- Testimonials (producer quotes; the numbers shown are live stats) ---------- */
  /** Shown until real search traffic exists (the server returns the most searched queries of the last 7 days). */
  BF.SUGGESTED_SEARCHES = ["124 BPM melodic techno", "dark trap", "afro house 8A", "uk drill 144", "void signal", "rnb slow jam", "drum and bass", "lofi piano"];
})();
