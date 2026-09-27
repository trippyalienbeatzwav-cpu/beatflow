/* ==========================================================================
   Brand configuration — the ONLY place the product name and identity live.
   Rename the product by editing this object; every template reads from it.
   ========================================================================== */
window.BF = window.BF || {};

BF.brand = {
  name: "TUNIBEAT",
  displayName: "Tunibeat",          // sentence-case usage in body copy
  tagline: "Your Sound. Your Marketplace.",
  domain: "tunibeat.example",
  supportEmail: "support@tunibeat.example",
  legalEntity: "Tunibeat Labs, Inc.",
  orderPrefix: "TB",
  // Brand mark: a rising 4-bar meter that resolves into a flow line.
  mark(size = 28) {
    return `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
      <defs><linearGradient id="bfm" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8d68ff"/><stop offset="1" stop-color="#5fe0f7"/></linearGradient></defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="#15151a" stroke="#2d2d35"/>
      <rect x="7" y="17" width="3" height="7" rx="1" fill="#f5f5f7"/>
      <rect x="12" y="13" width="3" height="11" rx="1" fill="#f5f5f7"/>
      <rect x="17" y="9" width="3" height="15" rx="1" fill="#f5f5f7"/>
      <path d="M6 12.5c4-5 9.5-6.5 13.5-4.3 2.4 1.3 4 1.2 6.5-.7" fill="none" stroke="url(#bfm)" stroke-width="2.4" stroke-linecap="round"/>
      <rect x="22" y="14" width="3" height="10" rx="1" fill="url(#bfm)"/>
    </svg>`;
  },
  logo(size = 28) {
    return `${this.mark(size)}<span class="brand-word">${this.name}</span>`;
  },
};
