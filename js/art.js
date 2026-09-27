/* ==========================================================================
   Generative artwork — original, deterministic cover art & avatars.
   Every image is an SVG built from a seed so sample content never relies on
   third-party or copyrighted imagery. In production these are replaced by
   producer-uploaded artwork (same <img> slot, same aspect ratio).
   ========================================================================== */
(function () {
  function rng(seed) {
    let a = typeof seed === "number" ? seed : hash(String(seed));
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  BF.rng = rng;
  BF.hash = hash;

  // Palettes: [deep, mid, pop, ink]
  const PALETTES = {
    ember:   ["#140a08", "#5a1a10", "#ff6a3d", "#ffd6b8"],
    violet:  ["#0d0a1a", "#3a2380", "#a98bff", "#e9e1ff"],
    ice:     ["#060f14", "#12414f", "#5fe0f7", "#dff8ff"],
    acid:    ["#0b0f06", "#2f4410", "#c7f25a", "#f1ffd1"],
    rose:    ["#150810", "#5b1838", "#ff6fa8", "#ffe0ee"],
    gold:    ["#120e05", "#4e3a0e", "#f5b441", "#fff1cf"],
    mono:    ["#0b0b0c", "#2b2b30", "#e8e8ec", "#ffffff"],
    ocean:   ["#050a17", "#15306e", "#4d8bff", "#dbe7ff"],
    jade:    ["#04110d", "#0f4a3a", "#3ddc9e", "#d4fff0"],
    blood:   ["#0f0506", "#4a0d12", "#ff4a4a", "#ffd9d9"],
    dusk:    ["#0e0914", "#48204d", "#ff8f5a", "#ffe3cf"],
    chrome:  ["#0a0c10", "#3a4150", "#c3ccdc", "#f7f9ff"],
    electric:["#05070f", "#16255e", "#3d7bff", "#dbe6ff"],
    graphite:["#0b0b0d", "#26272c", "#8c93a3", "#eef0f4"],
    ultra:   ["#0c0716", "#34195f", "#8b5cf6", "#ece4ff"],
    acidnight:["#070a07", "#1b2a14", "#b8f23a", "#eaffc9"],
  };
  BF.palettes = PALETTES;

  const grain = (id, amt = 0.55) => `
    <filter id="g${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${amt * 0.22} 0"/>
    </filter>`;

  const STYLES = {
    rings(r, [d, m, p, ink], id) {
      const cx = 30 + r() * 40, cy = 30 + r() * 40;
      let s = `<rect width="100" height="100" fill="${d}"/><radialGradient id="rg${id}" cx="${cx}%" cy="${cy}%" r="70%"><stop offset="0" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></radialGradient><rect width="100" height="100" fill="url(#rg${id})"/>`;
      const n = 9 + Math.floor(r() * 6);
      for (let i = n; i > 0; i--) s += `<circle cx="${cx}" cy="${cy}" r="${i * (7 + r() * 1.5)}" fill="none" stroke="${i % 3 === 0 ? p : ink}" stroke-opacity="${i % 3 === 0 ? 0.9 : 0.13}" stroke-width="${i % 3 === 0 ? 1.2 : 0.5}"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="${4 + r() * 5}" fill="${p}"/>`;
      return s;
    },
    bloom(r, [d, m, p, ink], id) {
      let s = `<rect width="100" height="100" fill="${d}"/><filter id="bl${id}"><feGaussianBlur stdDeviation="11"/></filter><g filter="url(#bl${id})">`;
      for (let i = 0; i < 4; i++) s += `<circle cx="${r() * 100}" cy="${r() * 100}" r="${18 + r() * 26}" fill="${[m, p, m, ink][i]}" opacity="${[0.9, 0.85, 0.7, 0.35][i]}"/>`;
      s += `</g>`;
      return s;
    },
    stripes(r, [d, m, p, ink]) {
      let s = `<rect width="100" height="100" fill="${d}"/>`;
      const amp = 4 + r() * 10, f = 0.04 + r() * 0.05, ph = r() * 6;
      for (let y = -6; y < 110; y += 3.2) {
        let dpath = `M -2 ${y}`;
        for (let x = 0; x <= 104; x += 4) {
          const bulge = Math.exp(-((x - 50) ** 2 + (y - 50) ** 2) / 900) * amp;
          dpath += ` L ${x} ${(y + Math.sin(x * f + ph + y * 0.05) * bulge * 1.4).toFixed(2)}`;
        }
        const hot = Math.abs(y - 50) < 12;
        s += `<path d="${dpath}" fill="none" stroke="${hot ? p : ink}" stroke-opacity="${hot ? 0.95 : 0.28}" stroke-width="1.1"/>`;
      }
      return s;
    },
    sun(r, [d, m, p, ink], id) {
      const cy = 46 + r() * 10, rad = 20 + r() * 8;
      let s = `<linearGradient id="sk${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d}"/><stop offset="1" stop-color="${m}"/></linearGradient><rect width="100" height="100" fill="url(#sk${id})"/>`;
      s += `<clipPath id="sc${id}"><circle cx="50" cy="${cy}" r="${rad}"/></clipPath><g clip-path="url(#sc${id})"><rect width="100" height="100" fill="${p}"/>`;
      for (let i = 0; i < 7; i++) s += `<rect x="0" y="${cy + 2 + i * i * 0.9 + i * 2}" width="100" height="${0.8 + i * 0.55}" fill="${m}"/>`;
      s += `</g><rect x="0" y="${cy + rad * 0.55}" width="100" height="100" fill="${d}" opacity=".92"/>`;
      for (let i = 0; i < 9; i++) s += `<line x1="50" y1="${cy + rad * 0.55}" x2="${-60 + i * 27.5}" y2="100" stroke="${ink}" stroke-opacity=".14" stroke-width=".4"/>`;
      for (let i = 1; i < 6; i++) s += `<line x1="0" x2="100" y1="${cy + rad * 0.55 + i * i * 1.6}" y2="${cy + rad * 0.55 + i * i * 1.6}" stroke="${ink}" stroke-opacity=".12" stroke-width=".4"/>`;
      return s;
    },
    grid(r, [d, m, p, ink]) {
      let s = `<rect width="100" height="100" fill="${d}"/>`;
      const step = 7.5;
      const hx = 20 + r() * 60, hy = 20 + r() * 60;
      for (let x = step / 2; x < 100; x += step) for (let y = step / 2; y < 100; y += step) {
        const dist = Math.hypot(x - hx, y - hy);
        const rr = Math.max(0.35, 3.2 - dist / 14);
        s += `<circle cx="${x}" cy="${y}" r="${rr.toFixed(2)}" fill="${dist < 16 ? p : ink}" opacity="${dist < 16 ? 1 : 0.35}"/>`;
      }
      return s;
    },
    monolith(r, [d, m, p, ink], id) {
      const w = 26 + r() * 14, x = 50 - w / 2, top = 18 + r() * 12;
      let s = `<rect width="100" height="100" fill="${m}"/><rect y="62" width="100" height="38" fill="${d}"/>`;
      s += `<linearGradient id="mo${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ink}" stop-opacity=".9"/><stop offset="1" stop-color="${p}"/></linearGradient>`;
      s += `<path d="M ${x} 76 V ${top + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x + w} ${top + w / 2} V 76 Z" fill="url(#mo${id})"/>`;
      s += `<ellipse cx="50" cy="77" rx="${w * 1.2}" ry="2.5" fill="#000" opacity=".5"/>`;
      s += `<path d="M ${x + w} 76 L 100 ${86 + r() * 8} L 100 100 L ${x + w * 0.4} 100 Z" fill="#000" opacity=".25"/>`;
      return s;
    },
    waves(r, [d, m, p, ink]) {
      let s = `<rect width="100" height="100" fill="${d}"/>`;
      const layers = 6;
      for (let l = 0; l < layers; l++) {
        const base = 30 + l * 11, amp = 4 + r() * 6, f = 0.05 + r() * 0.05, ph = r() * 6;
        let dpath = `M 0 100 L 0 ${base}`;
        for (let x = 0; x <= 100; x += 2.5) dpath += ` L ${x} ${(base + Math.sin(x * f + ph) * amp).toFixed(2)}`;
        dpath += ` L 100 100 Z`;
        const col = l === 2 ? p : l % 2 ? m : d;
        s += `<path d="${dpath}" fill="${col}" stroke="${ink}" stroke-opacity=".18" stroke-width=".4" opacity="${l === 2 ? 1 : 0.92}"/>`;
      }
      return s;
    },
    bars(r, [d, m, p, ink]) {
      let s = `<rect width="100" height="100" fill="${d}"/>`;
      let x = 6; const hot = 2 + Math.floor(r() * 8);
      for (let i = 0; x < 94; i++) {
        const w = 0.6 + r() * 2.6, h = 18 + r() * 58, y = 50 - h / 2;
        s += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${i === hot ? p : ink}" opacity="${i === hot ? 1 : (0.18 + r() * 0.3).toFixed(2)}"/>`;
        x += w + 1 + r() * 2.4;
      }
      s += `<rect x="6" y="84" width="${(20 + r() * 30).toFixed(1)}" height="1.2" fill="${p}"/>`;
      return s;
    },
    horizon(r, [d, m, p, ink], id) {
      const hy = 55 + r() * 12;
      let s = `<linearGradient id="hz${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d}"/><stop offset=".75" stop-color="${m}"/><stop offset="1" stop-color="${p}" stop-opacity=".55"/></linearGradient><rect width="100" height="100" fill="url(#hz${id})"/>`;
      s += `<rect y="${hy}" width="100" height="${100 - hy}" fill="${d}"/>`;
      s += `<line x1="0" x2="100" y1="${hy}" y2="${hy}" stroke="${p}" stroke-width=".6"/>`;
      for (let i = 1; i < 9; i++) s += `<line x1="0" x2="100" y1="${hy + i * i * 0.55}" y2="${hy + i * i * 0.55}" stroke="${ink}" stroke-opacity="${(0.16 - i * 0.012).toFixed(3)}" stroke-width=".35"/>`;
      s += `<circle cx="${25 + r() * 50}" cy="${hy - 12 - r() * 16}" r="${1.2 + r() * 1.6}" fill="${ink}"/>`;
      return s;
    },
    shards(r, [d, m, p, ink]) {
      let s = `<rect width="100" height="100" fill="${d}"/>`;
      for (let i = 0; i < 9; i++) {
        const x = r() * 100, y = r() * 100, a = r() * Math.PI, len = 30 + r() * 60, w = 2 + r() * 14;
        const dx = Math.cos(a) * len, dy = Math.sin(a) * len, nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
        s += `<polygon points="${x},${y} ${x + dx},${y + dy} ${x + dx + nx},${y + dy + ny}" fill="${[m, p, ink][i % 3]}" opacity="${i % 3 === 1 ? 0.95 : 0.55}"/>`;
      }
      return s;
    },
  };
  BF.artStyles = Object.keys(STYLES);

  const cache = new Map();
  let uid = 0;

  /** Cover art as a data URI. */
  BF.art = function (seed, style, palette) {
    const key = `${seed}|${style}|${palette}`;
    if (cache.has(key)) return cache.get(key);
    const r = rng(seed);
    const pal = PALETTES[palette] || PALETTES.violet;
    const st = STYLES[style] || STYLES.rings;
    const id = ++uid;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs>${grain(id)}</defs>${st(r, pal, id)}<rect width="100" height="100" filter="url(#g${id})"/></svg>`;
    const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    cache.set(key, uri);
    return uri;
  };

  /** Wide banner for storefront headers. */
  BF.banner = function (seed, palette) {
    const key = `banner|${seed}|${palette}`;
    if (cache.has(key)) return cache.get(key);
    const r = rng(seed);
    const [d, m, p, ink] = PALETTES[palette] || PALETTES.violet;
    const id = ++uid;
    let body = `<rect width="400" height="100" fill="${d}"/>`;
    for (let l = 0; l < 26; l++) {
      const y = 50, amp = 6 + l * 1.3, f = 0.018 + r() * 0.004, ph = l * 0.18;
      let dp = `M 0 ${y}`;
      for (let x = 0; x <= 400; x += 5) dp += ` L ${x} ${(y + Math.sin(x * f + ph) * amp * Math.sin(x / 400 * Math.PI)).toFixed(2)}`;
      body += `<path d="${dp}" fill="none" stroke="${l % 6 === 0 ? p : ink}" stroke-opacity="${l % 6 === 0 ? 0.7 : 0.08}" stroke-width="${l % 6 === 0 ? 0.8 : 0.5}"/>`;
    }
    body += `<radialGradient id="bg${id}" cx="80%" cy="10%" r="60%"><stop offset="0" stop-color="${m}" stop-opacity=".9"/><stop offset="1" stop-color="${d}" stop-opacity="0"/></radialGradient><rect width="400" height="100" fill="url(#bg${id})"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" preserveAspectRatio="xMidYMid slice"><defs>${grain(id, 0.4)}</defs>${body}<rect width="400" height="100" filter="url(#g${id})"/></svg>`;
    const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    cache.set(key, uri);
    return uri;
  };

  /** Abstract portrait avatar: silhouette over a duotone field. */
  BF.avatar = function (seed, palette) {
    const key = `av|${seed}|${palette}`;
    if (cache.has(key)) return cache.get(key);
    const r = rng(seed);
    const [d, m, p, ink] = PALETTES[palette] || PALETTES.violet;
    const id = ++uid;
    const hx = 46 + r() * 8, hr = 15 + r() * 3;
    const hat = r() > 0.6;
    let body = `<radialGradient id="av${id}" cx="${30 + r() * 40}%" cy="30%" r="80%"><stop offset="0" stop-color="${p}"/><stop offset=".55" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></radialGradient><rect width="100" height="100" fill="url(#av${id})"/>`;
    body += `<circle cx="${hx}" cy="40" r="${hr}" fill="${d}"/>`;
    if (hat) body += `<path d="M ${hx - hr - 2} ${40 - hr * 0.35} Q ${hx} ${40 - hr * 1.7} ${hx + hr + 2} ${40 - hr * 0.35} Z" fill="${d}"/><rect x="${hx - hr - 6}" y="${40 - hr * 0.45}" width="${hr * 1.2}" height="3" rx="1.5" fill="${d}"/>`;
    body += `<path d="M ${hx - 34} 104 Q ${hx - 30} 62 ${hx} 60 Q ${hx + 30} 62 ${hx + 34} 104 Z" fill="${d}"/>`;
    body += `<path d="M ${hx - hr * 0.3} ${40 - hr * 0.2} a ${hr} ${hr} 0 0 1 ${hr * 0.9} ${hr * 0.6}" stroke="${ink}" stroke-opacity=".25" stroke-width="1" fill="none"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${grain(id, 0.5)}</defs>${body}<rect width="100" height="100" filter="url(#g${id})"/></svg>`;
    const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    cache.set(key, uri);
    return uri;
  };

  /** Deterministic waveform peaks (0–1) for a beat. Real builds decode audio server-side. */
})();
