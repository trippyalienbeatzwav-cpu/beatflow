/* ==========================================================================
   Downloads of purchased files. The server prepares the file (renders/encodes
   it in the audio worker pool on first request, then caches it) and returns a
   short-lived signed link bound to this account. Buttons carry
   data-dl-ent (entitlement id), data-dl-file and data-dl-format.
   ========================================================================== */
(function () {
  const I = BF.icon;
  const busy = new Set();
  const label = (btn, html) => { if (!btn.dataset.label) btn.dataset.label = btn.innerHTML; btn.innerHTML = html; };
  const reset = (btn) => { if (btn.dataset.label) btn.innerHTML = btn.dataset.label; btn.disabled = false; btn.removeAttribute("aria-busy"); };

  function save(url, filename) {
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }

  BF.downloads = {
    /** Prepare and download the file described by a button's data attributes. */
    async start(btn) {
      const key = `${btn.dataset.dlEnt}:${btn.dataset.dlFile}:${btn.dataset.dlFormat}`;
      if (busy.has(key)) return;
      busy.add(key);
      btn.disabled = true; btn.setAttribute("aria-busy", "true");
      label(btn, `<span class="spinner"></span> Preparing…`);
      try {
        let { download: d } = await BF.http.post(`/api/store/library/${btn.dataset.dlEnt}/downloads`, { file: btn.dataset.dlFile, format: btn.dataset.dlFormat });
        const started = Date.now();
        while (d.status === "preparing") {
          if (Date.now() - started > 10 * 60_000) throw new Error("Preparing this file is taking too long. Try again in a few minutes.");
          await new Promise((r) => setTimeout(r, Date.now() - started < 10_000 ? 800 : 2000));
          ({ download: d } = await BF.http.get(`/api/store/downloads/${d.id}`));
          if (d.status === "preparing") label(btn, `<span class="spinner"></span> Preparing… ${Math.round((Date.now() - started) / 1000)}s`);
        }
        if (d.status === "failed") throw new Error("This file couldn’t be prepared. Try again, or contact support if it keeps failing.");
        save(d.url, d.filename);
        BF.ui.toast({ title: "Download started", desc: `${BF.esc(d.filename)} · ${(d.bytes / 1048576).toFixed(1)} MB` });
        BF.store.refreshLibrary().catch(() => {});
      } catch (err) {
        BF.ui.toast({ kind: "error", title: "Download failed", desc: BF.esc(err.message) });
      } finally {
        busy.delete(key);
        reset(btn);
      }
    },
    /** Button HTML for one file of an entitlement. */
    button(entId, f, primary = false, extra = "") {
      return `<button class="btn ${primary ? "btn-primary" : "btn-secondary"} btn-sm" data-dl-ent="${entId}" data-dl-file="${f.file}" data-dl-format="${f.format}" ${extra}>${I("download", "i-sm")} ${BF.esc(f.label)}</button>`;
    },
  };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-dl-ent]"); if (b && !b.closest("[data-success]")) { e.preventDefault(); BF.downloads.start(b); } });
})();
