/* ==========================================================================
   Charts — dependency-free SVG. Rules applied (dataviz method):
   one y-axis only · 2px lines · 4px rounded bar ends anchored to baseline ·
   recessive grid · crosshair/hover tooltips · single series → no legend box,
   multi-series → legend + direct labels · text wears text tokens, not series
   color · every chart has a table alternative.
   ========================================================================== */
(function () {
  const esc = (s) => BF.esc(s);
  const nice = (max) => { const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };

  function tooltip(host) {
    let t = host.querySelector(".chart-tip");
    if (!t) { t = document.createElement("div"); t.className = "chart-tip"; t.setAttribute("role", "status"); host.appendChild(t); }
    return t;
  }

  /** Area/line chart, single series. data: [{label, value}] */
  function line(host, data, { format = (v) => v, height = 240, color = "var(--accent-text)", label = "" } = {}) {
    const W = Math.max(300, host.clientWidth || 720), H = height, pad = { l: 52, r: 16, t: 16, b: 30 };
    const max = nice(Math.max(...data.map((d) => d.value)) * 1.1) || 1;   // all-zero series: keep a unit axis instead of dividing by zero
    const x = (i) => pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const pts = data.map((d, i) => [x(i), y(d.value)]);
    const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    const every = Math.ceil(data.length / 8);
    host.classList.add("chart");
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(label)}">
      <defs><linearGradient id="lg-${host.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a98bff" stop-opacity=".22"/><stop offset="1" stop-color="#a98bff" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--chart-grid)" stroke-width="1"/><text x="${pad.l - 10}" y="${y(t) + 4}" text-anchor="end" class="ax">${format(t, true)}</text>`).join("")}
      ${data.map((d, i) => (i % every === 0 || i === data.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(d.label)}</text>` : "")).join("")}
      <path d="${path} L${x(data.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="url(#lg-${host.id})"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <line class="xh" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--n-500)" stroke-width="1" stroke-dasharray="3 3" opacity="0" vector-effect="non-scaling-stroke"/>
      <circle class="dot" r="5" fill="${color}" stroke="var(--surface-1)" stroke-width="2" opacity="0"/>
      <circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="4.5" fill="${color}" stroke="var(--surface-1)" stroke-width="2"/>
      <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" class="hit"/>
    </svg>`;
    const svg = host.querySelector("svg"), tip = tooltip(host), xh = svg.querySelector(".xh"), dot = svg.querySelector(".dot");
    const show = (clientX) => {
      const r = svg.getBoundingClientRect();
      const sx = ((clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(data.length - 1, Math.round(((sx - pad.l) / (W - pad.l - pad.r)) * (data.length - 1))));
      const [px, py] = pts[i];
      xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("opacity", 1);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("opacity", 1);
      tip.innerHTML = `<span class="subtle">${esc(data[i].label)}</span><b class="mono">${format(data[i].value)}</b>`;
      tip.style.opacity = 1;
      const left = (px / W) * r.width, top = (py / H) * r.height;
      tip.style.transform = `translate(${Math.min(Math.max(left - 50, 0), r.width - 110)}px, ${Math.max(top - 58, 0)}px)`;
    };
    svg.addEventListener("pointermove", (e) => show(e.clientX));
    svg.addEventListener("pointerleave", () => { tip.style.opacity = 0; xh.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); });
  }

  /** Horizontal bar chart, single series. data: [{label, value, sub}] */
  function hbars(host, data, { format = (v) => v, tip: tipFn, color = "var(--accent)" } = {}) {
    const max = Math.max(...data.map((d) => d.value)) || 1;
    host.classList.add("chart");
    host.innerHTML = `<ul class="hbars">${data.map((d, i) => `<li tabindex="0" data-i="${i}">
      <span class="hb-label truncate">${esc(d.label)}</span>
      <span class="hb-track"><span class="hb-bar" style="width:${(d.value / max) * 100}%;background:${d.color || color}"></span></span>
      <span class="hb-val mono">${format(d.value)}</span></li>`).join("")}</ul>`;
    if (!tipFn) return;
    const tip = tooltip(host);
    host.querySelectorAll("li").forEach((li) => {
      const on = () => { const d = data[+li.dataset.i]; tip.innerHTML = tipFn(d); tip.style.opacity = 1; tip.style.transform = `translate(${li.querySelector(".hb-bar").offsetWidth * 0.5 + 120}px, ${li.offsetTop - 56}px)`; };
      li.addEventListener("pointerenter", on); li.addEventListener("focus", on);
      li.addEventListener("pointerleave", () => (tip.style.opacity = 0)); li.addEventListener("blur", () => (tip.style.opacity = 0));
    });
  }

  /** 100% stacked bar with legend + direct labels. data: [[label, pct]] */
  function stack(host, data) {
    const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
    host.classList.add("chart");
    host.innerHTML = `<div class="stack" role="img" aria-label="${data.map(([l, v]) => `${l} ${v}%`).join(", ")}">${data.map(([l, v], i) => `<span style="width:${v}%;background:${colors[i]}" title="${l}: ${v}%"></span>`).join("")}</div>
      <ul class="legend">${data.map(([l, v], i) => `<li><span class="sw" style="background:${colors[i]}"></span><span>${l}</span><b class="mono">${v}%</b></li>`).join("")}</ul>`;
  }

  /** Column chart (vertical bars), single series with hover tooltip. */
  function columns(host, data, { format = (v) => v, height = 200, label = "" } = {}) {
    const W = Math.max(300, host.clientWidth || 720), H = height, pad = { l: 44, r: 8, t: 12, b: 26 };
    const max = nice(Math.max(...data.map((d) => d.value)) * 1.05) || 1;
    const bw = (W - pad.l - pad.r) / data.length;
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const every = Math.ceil(data.length / 10);
    host.classList.add("chart");
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(label)}">
      ${[0, 0.5, 1].map((f) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(f * max)}" y2="${y(f * max)}" stroke="var(--chart-grid)"/><text x="${pad.l - 8}" y="${y(f * max) + 4}" text-anchor="end" class="ax">${format(f * max, true)}</text>`).join("")}
      ${data.map((d, i) => { const x = pad.l + i * bw + 1, w = Math.max(2, bw - 2), top = y(d.value), h = y(0) - top; return `<path data-i="${i}" class="col" d="M${x} ${y(0)} V${top + Math.min(4, h)} Q${x} ${top} ${x + Math.min(4, w / 2)} ${top} H${x + w - Math.min(4, w / 2)} Q${x + w} ${top} ${x + w} ${top + Math.min(4, h)} V${y(0)} Z" fill="var(--series-1)"/>`; }).join("")}
      ${data.map((d, i) => (i % every === 0 ? `<text x="${pad.l + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" class="ax">${esc(d.label)}</text>` : "")).join("")}
    </svg>`;
    const tip = tooltip(host), svg = host.querySelector("svg");
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(); const i = Math.floor((((e.clientX - r.left) / r.width) * W - pad.l) / bw);
      if (i < 0 || i >= data.length) return;
      svg.querySelectorAll(".col").forEach((c) => c.setAttribute("opacity", +c.dataset.i === i ? 1 : 0.55));
      tip.innerHTML = `<span class="subtle">${esc(data[i].label)}</span><b class="mono">${format(data[i].value)}</b>`; tip.style.opacity = 1;
      tip.style.transform = `translate(${Math.min(((pad.l + i * bw) / W) * r.width, r.width - 110)}px, 0px)`;
    });
    svg.addEventListener("pointerleave", () => { tip.style.opacity = 0; svg.querySelectorAll(".col").forEach((c) => c.setAttribute("opacity", 1)); });
  }

  const table = (headers, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "num" : "strong"}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

  const spark = (values, color = "var(--accent-text)") => {
    const max = Math.max(...values), min = Math.min(...values);
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`).join(" ");
    return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  };

  BF.chart = { line, hbars, stack, columns, table, spark };
})();
