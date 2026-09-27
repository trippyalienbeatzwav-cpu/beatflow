/* Upload beat — 5 steps: audio → info → artwork → pricing → publish.
   Files go through the chunked upload API (js/uploads.js); the server stores the master privately,
   analyses it (waveform, BPM grid, key, structure), cuts the preview and only then lists the beat.
   The draft (metadata + ids of finished uploads) autosaves on this device. */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;
  const STEPS = [["audio", "Audio files"], ["info", "Beat info"], ["art", "Artwork"], ["licensing", "Pricing"], ["publish", "Review & publish"]];
  const SLOTS = [
    ["master", "Master (WAV or AIFF)", "Required · lossless, 44.1–192 kHz. Buyers get WAV/MP3 made from it; your preview and waveform come from it.", ".wav,.aif,.aiff", true, "master_audio", 700],
    ["stems", "Stems (.zip)", "Optional · per-instrument WAV/AIFF files. Required to offer Trackout and Exclusive (they include stems).", ".zip", false, "stems_archive", 1500],
  ];
  const blank = () => ({ step: 1, files: {}, title: "", genre: "", bpm: "", key: "", moods: [], tags: [], description: "", art: null, artStyle: "rings", artPalette: "violet", priceMult: 1, exclusive: true, freeDl: false, visibility: "public", attest: false, savedAt: "" });
  let D;
  const uploads = {};   // slot → { cancel }

  const stepper = () => `<ol class="stepper" aria-label="Upload progress">${STEPS.map(([k, l], i) => {
    const n = i + 1, st = n < D.step ? "done" : n === D.step ? "current" : "todo";
    return `<li class="${st}"><button data-goto="${n}" ${st === "todo" ? "disabled" : ""} ${st === "current" ? 'aria-current="step"' : ""}><span class="st-n">${st === "done" ? I("check", "i-xs") : n}</span><span class="st-l">${l}</span></button></li>`;
  }).join("")}</ol>`;

  function stepAudio() {
    return `<h2 class="h3">Upload audio</h2><p class="muted up-lead">Uploads continue while you fill in the next steps.</p>
      <div class="slots">${SLOTS.map(([k, l, hint, accept, req, , maxMb]) => { const f = D.files[k]; return `<div class="slot ${f ? (f.error ? "is-error" : f.done ? "is-done" : "is-uploading") : ""}" data-slot="${k}">
        <label class="dropzone" data-drop="${k}">
          <input type="file" accept="${accept}" data-file="${k}" class="sr-only" aria-describedby="hint-${k}">
          <span class="dz-icon">${I(k === "stems" ? "folder" : "file-audio")}</span>
          <span class="dz-main"><b>${l}</b>${req ? ` <span class="badge badge-accent">Required</span>` : ""}<span class="hint" id="hint-${k}" style="display:block">${hint} Max ${maxMb >= 1000 ? maxMb / 1000 + " GB" : maxMb + " MB"}.</span></span>
          <span class="btn btn-secondary btn-sm dz-btn">${f ? "Replace" : "Browse"}</span>
        </label>
        ${f ? `<div class="up-progress"><div class="up-row"><span class="truncate mono" style="font-size:12.5px">${esc(f.name)}</span><span class="mono subtle" data-pct style="font-size:12px">${f.error ? "" : f.done ? f.size : Math.round(f.pct) + "%"}</span>
          ${f.error ? `<button class="btn btn-ghost btn-sm" data-retry="${k}">${I("refresh", "i-xs")} Choose again</button>` : ""}<button class="icon-btn sm" data-rmfile="${k}" aria-label="Remove ${l}">${I("x", "i-sm")}</button></div>
          <div class="progress ${f.error ? "error" : f.done ? "success" : ""}" role="progressbar" aria-label="${l} upload" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f.done ? 100 : f.pct)}"><span style="width:${f.done || f.error ? 100 : f.pct}%"></span></div>
          ${f.error ? `<p class="field-error" style="display:flex;margin-top:6px">${I("alert-circle", "i-xs")} ${esc(f.error)}</p>` : ""}</div>` : ""}
      </div>`; }).join("")}</div>
      <div class="notice" style="margin-top:12px">${I("info", "i-sm")}<div>After you publish, the server analyses the master (tempo, beat grid, key, structure) and builds the preview and waveform. BPM and key you enter take priority; blank ones are filled from the analysis.</div></div>`;
  }
  function stepInfo() {
    const err = D.errors || {};
    const f = (k, content) => `<div class="field ${err[k] ? "has-error" : ""}">${content}<div class="field-error">${I("alert-circle", "i-xs")} ${esc(err[k] || "")}</div></div>`;
    return `<h2 class="h3">Beat information</h2><p class="muted up-lead">BPM, key and mood power the store’s search filters.</p>
      <div class="form-grid">
        ${f("title", `<label class="label" for="u-title">Title</label><input class="input" id="u-title" data-bind="title" value="${esc(D.title)}" placeholder="e.g. MIDNIGHT DRIVE" maxlength="80" required>`)}
        ${f("genre", `<label class="label" for="u-genre">Genre</label><select class="select" id="u-genre" data-bind="genre" required><option value="">Choose a genre</option>${BF.GENRES.map((g) => `<option value="${g.id}" ${D.genre === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>`)}
        ${f("bpm", `<label class="label" for="u-bpm">BPM <span class="opt">Optional — detected if blank</span></label><div class="input-group"><input class="input mono" id="u-bpm" data-bind="bpm" value="${esc(D.bpm)}" inputmode="numeric" placeholder="140"><span class="input-affix">BPM</span></div>`)}
        ${f("key", `<label class="label" for="u-key">Key <span class="opt">Optional — estimated if blank</span></label><select class="select" id="u-key" data-bind="key"><option value="">Detect from audio</option>${BF.KEYS.map((k) => `<option ${D.key === k ? "selected" : ""}>${k}</option>`).join("")}</select>`)}
        <div class="field span-2"><span class="label">Mood <span class="opt">Up to 3</span></span><div class="chip-wrap" role="group" aria-label="Mood">${BF.MOODS.map((m) => `<button type="button" class="chip" data-mood="${m}" aria-pressed="${D.moods.includes(m)}">${m}</button>`).join("")}</div></div>
        <div class="field span-2 ${err.tags ? "has-error" : ""}"><label class="label" for="u-tag">Tags <span class="opt">${D.tags.length}/10 · press Enter</span></label>
          <div class="tag-input">${D.tags.map((t) => `<span class="chip chip-removable">${esc(t)} <button type="button" data-rmtag="${esc(t)}" aria-label="Remove tag ${esc(t)}">${I("x", "i-xs")}</button></span>`).join("")}<input id="u-tag" maxlength="30" placeholder="${D.tags.length >= 10 ? "Tag limit reached" : "dark trap, 808, night drive"}" ${D.tags.length >= 10 ? "disabled" : ""}></div>
          <div class="field-error">${I("alert-circle", "i-xs")} ${esc(err.tags || "")}</div></div>
        <div class="field span-2"><label class="label" for="u-desc">Description <span class="opt" data-desc-count>${D.description.length}/1000</span></label><textarea class="textarea" id="u-desc" data-bind="description" maxlength="1000" placeholder="Describe the vibe, instruments, and what kind of artist it suits.">${esc(D.description)}</textarea></div>
      </div>`;
  }
  function artSrc() { return D.art?.url || BF.art(D.title + "draft", D.artStyle, D.artPalette); }
  function stepArt() {
    const f = D.files.art;
    return `<h2 class="h3">Artwork</h2><p class="muted up-lead">Square, at least 500 × 500 px (3000 × 3000 recommended), JPG, PNG or WebP. Only use artwork you have rights to.</p>
      <div class="art-step ${D.errors?.art ? "has-error" : ""}">
        <div class="art-preview"><img src="${artSrc()}" alt="Artwork preview"><span class="badge ${D.art ? "badge-success" : ""}" style="position:absolute;top:10px;left:10px">${D.art ? "Your upload" : "Generated"}</span></div>
        <div class="stack-16" style="flex:1;min-width:0">
          <label class="dropzone" data-drop="art"><input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" data-artfile><span class="dz-icon">${I("image")}</span><span class="dz-main"><b>Upload artwork</b><span class="hint" style="display:block">${f && !f.done && !f.error ? `Uploading… ${Math.round(f.pct)}%` : "Drag an image here or browse"}</span></span><span class="btn btn-secondary btn-sm dz-btn">Browse</span></label>
          <p class="field-error" style="${D.errors?.art ? "display:flex" : ""}">${I("alert-circle", "i-xs")} ${esc(D.errors?.art || "")}</p>
          <div><span class="label" style="margin-bottom:8px;display:block">Or use generated cover art</span>
            <div class="chip-wrap" role="group" aria-label="Artwork style">${BF.artStyles.map((s) => `<button type="button" class="chip" data-astyle="${s}" aria-pressed="${!D.art && D.artStyle === s}">${s}</button>`).join("")}</div>
            <div class="swatches" style="margin-top:10px" role="radiogroup" aria-label="Artwork palette">${Object.keys(BF.palettes).map((p) => `<label class="swatch"><input type="radio" name="apal" value="${p}" ${D.artPalette === p ? "checked" : ""}><span style="background:linear-gradient(135deg,${BF.palettes[p][1]},${BF.palettes[p][2]})" aria-hidden="true"></span><span class="sr-only">${p}</span></label>`).join("")}</div></div>
        </div>
      </div>`;
  }
  const hasStems = () => !!D.files.stems?.done;
  function priceFor(l) { const d = (l.price_cents / 100) * D.priceMult; return l.exclusive ? Math.round(d / 10) * 10 - 0.01 : Math.round(d) - 0.01; }
  function stepLicensing() {
    return `<h2 class="h3">Pricing</h2><p class="muted up-lead">Every license tier is priced from its base price × your multiplier. Terms come from the platform’s <a class="link" href="#/dashboard/licenses">license templates</a>.</p>
      <div class="field" style="max-width:420px"><label class="label" for="u-mult">Price multiplier <span class="mono" data-mult-label>${D.priceMult.toFixed(2)}×</span></label><input type="range" id="u-mult" min="0.5" max="5" step="0.05" value="${D.priceMult}" data-mult></div>
      <div class="lic-config">${BF.LICENSES.map((l) => { const needsStems = l.formats.includes("STEMS"); const off = needsStems && !hasStems(); return `<div class="lc-row card ${off ? "is-off" : ""}">
        <div class="lc-main"><b>${esc(l.name)}</b><span class="subtle" style="font-size:13px">${esc(l.files)}</span>
          ${off ? `<span class="lc-warn">${I("alert", "i-xs")} Needs a stems .zip — <button class="link" data-goto="1">add stems in step 1</button></span>` : ""}</div>
        <div class="lc-price mono">${off ? "Not offered" : BF.money(priceFor(l))}</div></div>`; }).join("")}</div>
      <label class="switch" style="margin-top:16px"><input type="checkbox" data-excl ${D.exclusive ? "checked" : ""} ${hasStems() ? "" : "disabled"}> Offer exclusive rights (the beat leaves the store once sold)</label>
      <label class="switch" style="margin-top:10px"><input type="checkbox" data-freedl ${D.freeDl ? "checked" : ""}> Offer a free MP3 download (non-commercial use only)</label>`;
  }
  function stepPublish() {
    const g = BF.genreById[D.genre];
    const checks = [["Master uploaded", !!D.files.master?.done], ["Title and genre", !!(D.title.trim() && D.genre)], ["Artwork", !D.files.art || !!D.art], ["Email verified", !!BF.store.get("session").user?.emailVerified]];
    return `<h2 class="h3">Review & publish</h2><p class="muted up-lead">This is how the beat appears in the store once the audio is processed.</p>
      <div class="publish-grid">
        <div class="pub-card card card-pad">
          <div class="art"><img src="${artSrc()}" alt=""></div>
          <div style="margin-top:12px"><div class="h4">${esc(D.title || "Untitled beat")}</div><div class="subtle" style="font-size:13px">${esc(BF.store.get("session").user?.name ?? "")} · ${g ? esc(g.name) : "No genre"}${D.bpm ? ` · ${esc(D.bpm)} BPM` : ""}${D.key ? ` · ${esc(D.key)}` : ""}</div>
          <div class="tag-row" style="margin-top:10px">${D.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div></div>
          <ul class="pub-lics">${BF.LICENSES.filter((l) => !l.formats.includes("STEMS") || hasStems()).filter((l) => !l.exclusive || D.exclusive).map((l) => `<li><span>${esc(l.name)}</span><span class="mono">${BF.money(priceFor(l))}</span></li>`).join("")}</ul>
        </div>
        <div class="stack-16">
          <div class="card card-pad"><h3 class="h4" style="margin-bottom:10px">Checklist</h3><ul class="checklist">${checks.map(([l, ok]) => `<li class="${ok ? "ok" : "bad"}">${I(ok ? "check" : "x", "i-sm")} ${l}${l === "Email verified" && !ok ? ` — <a class="link" href="#/verify">verify now</a>` : ""}</li>`).join("")}</ul></div>
          <fieldset class="card card-pad stack-8"><legend class="h4" style="float:left;margin-bottom:10px">After processing</legend><div style="clear:both"></div>
            ${[["public", "Publish", "List it in the store as soon as the audio is ready"], ["draft", "Keep as draft", "Publish later from My Beats"]].map(([v, l, d]) => `<label class="check" style="align-items:flex-start"><input type="radio" name="vis" value="${v}" ${D.visibility === v ? "checked" : ""} style="margin-top:3px"><span><b style="color:var(--text)">${l}</b><span class="hint" style="display:block">${d}</span></span></label>`).join("")}
          </fieldset>
          <div class="field ${D.errors?.attest ? "has-error" : ""}"><label class="check attest"><input type="checkbox" data-attest ${D.attest ? "checked" : ""}> <span>I own or control all rights in this beat, including any samples, and it doesn’t infringe anyone else’s work. False claims can lead to removal and account suspension.</span></label><div class="field-error">${I("alert-circle", "i-xs")} Confirm rights ownership to publish.</div></div>
        </div>
      </div>`;
  }
  const BODIES = [stepAudio, stepInfo, stepArt, stepLicensing, stepPublish];

  BF.renderUpload = () => {
    if (!BF.store.get("session").signedIn) return BF.dashShell("upload", ui.empty({ icon: "lock", title: "Sign in to upload", actions: `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent("/dashboard/upload")}">Sign in</a>` }));
    const saved = BF.store.get("uploadDraft");
    D = saved ? { ...blank(), ...JSON.parse(JSON.stringify(saved)) } : blank();
    D.errors = {};
    return BF.dashShell("upload", `<div class="upload" data-upload>
      <header class="dash-head"><div><h1 class="h2">Upload beat</h1><p class="save-state" data-save aria-live="polite">${I("cloud-check", "i-xs")} ${D.savedAt ? `Draft saved ${esc(D.savedAt)}` : "Draft autosaves on this device"}</p></div>
        <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-discard>Discard</button></div></header>
      <div data-stepper>${stepper()}</div>
      <form class="card card-pad up-body" novalidate data-body>${BODIES[D.step - 1]()}</form>
      <div class="up-nav"><button class="btn btn-secondary" data-back ${D.step === 1 ? "disabled" : ""}>${I("arrow-left", "i-sm")} Back</button><span class="subtle mono" style="font-size:12px">Step ${D.step} of 5</span><button class="btn btn-primary" data-next>${D.step === 5 ? `${I("upload", "i-sm")} Submit` : `Continue ${I("arrow-right", "i-sm")}`}</button></div>
    </div>`);
  };

  BF.mountUpload = (el) => {
    if (!el.querySelector("[data-upload]")) return;
    const $ = (s) => el.querySelector(s);
    let saveT, pollT, alive = true;
    const paint = (focusHeading) => {
      if (!alive || !$("[data-body]")) return;
      $("[data-stepper]").innerHTML = stepper();
      $("[data-body]").innerHTML = BODIES[D.step - 1]();
      $("[data-back]").disabled = D.step === 1;
      $("[data-next]").innerHTML = D.step === 5 ? `${I("upload", "i-sm")} Submit` : `Continue ${I("arrow-right", "i-sm")}`;
      el.querySelector(".up-nav .mono").textContent = `Step ${D.step} of 5`;
      if (focusHeading) { const h = $("[data-body] h2"); h.tabIndex = -1; h.focus(); }
    };
    const autosave = () => {
      clearTimeout(saveT);
      saveT = setTimeout(() => {
        D.savedAt = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        const { errors: _errors, ...persist } = D;
        persist.files = Object.fromEntries(Object.entries(D.files).filter(([, f]) => f.done));   // only finished uploads survive a reload
        BF.store.set("uploadDraft", persist);
        const s = $("[data-save]"); if (s) s.innerHTML = `${I("cloud-check", "i-xs")} Draft saved ${D.savedAt}`;
      }, 500);
    };

    function startUpload(k, file) {
      const slot = SLOTS.find((s) => s[0] === k);
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (!slot[3].split(",").includes(ext)) { D.files[k] = { name: file.name, error: `Unsupported file. Use ${slot[3].replace(/,/g, ", ")}.`, pct: 0 }; paint(); return; }
      if (file.size > slot[6] * 1024 * 1024) { D.files[k] = { name: file.name, error: `This file is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${slot[6]} MB.`, pct: 0 }; paint(); return; }
      uploads[k]?.cancel();
      const f = (D.files[k] = { name: file.name, size: `${(file.size / 1048576).toFixed(1)} MB`, pct: 0, done: false });
      paint();
      const up = BF.uploadFile(file, slot[5], { onProgress: (p) => {
        f.pct = p * 100;
        const s = el.querySelector(`[data-slot="${k}"]`);
        if (s && D.step === 1) { s.querySelector("[data-pct]").textContent = Math.round(f.pct) + "%"; const bar = s.querySelector(".progress"); bar.setAttribute("aria-valuenow", Math.round(f.pct)); bar.firstElementChild.style.width = f.pct + "%"; }
      } });
      uploads[k] = up;
      up.promise.then((media) => { if (D.files[k] !== f) return; f.done = true; f.mediaId = media.id; paint(); autosave(); ui.toast({ title: `${slot[1]} uploaded`, desc: esc(file.name), timeout: 2200 }); })
        .catch((err) => { if (D.files[k] !== f || err?.name === "AbortError") return; f.error = err.message || "Upload failed."; paint(); })
        .finally(() => { if (uploads[k] === up) delete uploads[k]; });
    }
    function uploadArt(file) {
      if (!/image\/(png|jpe?g|webp)/.test(BF.mimeOf(file))) { D.errors = { art: "Use a JPG, PNG or WebP image." }; paint(); return; }
      const f = (D.files.art = { name: file.name, pct: 0, done: false });
      paint();
      const up = BF.uploadFile(file, "artwork", { onProgress: (p) => { f.pct = p * 100; } });
      up.promise.then((media) => {
        if (media.width < 500 || media.height < 500 || Math.abs(media.width - media.height) > media.width * 0.02) { D.files.art = null; D.errors = { art: `The image is ${media.width}×${media.height}. Artwork must be square and at least 500×500.` }; paint(); return; }
        f.done = true; D.art = { id: media.id, url: media.url }; D.errors = {}; paint(); autosave();
      }).catch((err) => { D.files.art = null; D.errors = { art: err.message }; paint(); });
    }

    function validate(step) {
      D.errors = {};
      if (step === 1) {
        if (!D.files.master?.done) { ui.toast({ kind: "error", title: D.files.master && !D.files.master.error ? "The master is still uploading" : "A master is required", desc: D.files.master && !D.files.master.error ? "Wait for it to finish, then continue." : "Upload the WAV or AIFF master." }); return false; }
        if (D.files.stems && !D.files.stems.done && !D.files.stems.error) { ui.toast({ kind: "error", title: "Stems are still uploading" }); return false; }
      }
      if (step === 2) {
        if (!D.title.trim()) D.errors.title = "Add a title.";
        if (!D.genre) D.errors.genre = "Choose a genre so artists can find it.";
        if (D.bpm && !(+D.bpm >= 40 && +D.bpm <= 250)) D.errors.bpm = "BPM must be between 40 and 250.";
        if (Object.keys(D.errors).length) { paint(); el.querySelector(".field.has-error input, .field.has-error select")?.focus(); return false; }
      }
      if (step === 3 && D.files.art && !D.files.art.done) { ui.toast({ kind: "error", title: "Artwork is still uploading" }); return false; }
      if (step === 5 && !D.attest) { D.errors.attest = true; paint(); el.querySelector("[data-attest]").focus(); return false; }
      return true;
    }

    async function submit(btn) {
      btn.disabled = true; btn.insertAdjacentHTML("beforeend", '<span class="spinner"></span>');
      try {
        const r = await BF.http.post("/api/seller/beats", {
          title: D.title.trim(), genre: D.genre, bpm: D.bpm ? Number(D.bpm) : null, key: D.key || null, moods: D.moods, tags: D.tags, description: D.description,
          price_mult: D.priceMult, exclusive_available: D.exclusive && hasStems(), free_download: D.freeDl, publish: D.visibility === "public",
          master_media_id: D.files.master.mediaId, stems_media_id: D.files.stems?.done ? D.files.stems.mediaId : null,
          artwork_media_id: D.art?.id ?? null, art: D.art ? null : { style: D.artStyle, palette: D.artPalette },
        });
        BF.store.set("uploadDraft", null);
        el.querySelector(".up-nav").remove(); el.querySelector("[data-stepper]").innerHTML = ""; $("[data-save]").textContent = "";
        const body = $("[data-body]");
        body.innerHTML = `<div data-processing>${ui.empty({ icon: "wave", title: "Processing your master…", body: "Analysing tempo, beat grid, key and structure, and building the preview. This usually takes under a minute." })}</div>`;
        const poll = async () => {
          if (!alive) return;
          const cat = await BF.http.get("/api/seller/catalog").catch(() => null);
          const b = cat?.beats.find((x) => x.id === r.beat.id);
          if (!b || b.audio?.status === "processing" || b.status === "processing") { pollT = setTimeout(poll, 2000); return; }
          if (b.audio?.status === "failed") { body.innerHTML = ui.empty({ kind: "error", icon: "alert", title: "We couldn’t process that audio", body: esc(b.audio.error || "The file couldn’t be decoded."), actions: `<a class="btn btn-primary" href="#/dashboard/upload" data-reload>Try another file</a>` }); return; }
          await BF.refreshCatalog();
          const a = b.audio.analysis ?? {};
          body.innerHTML = ui.empty({ icon: "check", title: b.status === "published" ? "Your beat is live" : "Saved as a draft",
            body: `“${esc(b.title)}” · ${b.bpm} BPM · ${esc(b.key)}${a.bpm ? ` (detected ${Math.round(a.bpm * 10) / 10} BPM${a.key?.name ? `, key estimate ${esc(a.key.name)}` : ""})` : ""}.`,
            actions: `${b.status === "published" ? `<a class="btn btn-primary" href="#/beats/beat/${b.id}">View beat</a>` : ""}<a class="btn btn-secondary" href="#/dashboard/beats">Go to My Beats</a><a class="btn btn-ghost" href="#/dashboard/upload" data-reload>Upload another</a>` });
        };
        poll();
      } catch (err) {
        btn.disabled = false; btn.querySelector(".spinner")?.remove();
        ui.toast({ kind: "error", title: "Couldn’t submit the beat", desc: esc(err.message) });
      }
    }

    el.addEventListener("click", async (e) => {
      const t = e.target;
      const nx = t.closest("[data-next]");
      if (nx) { e.preventDefault(); if (!validate(D.step)) return; if (D.step < 5) { D.step++; paint(true); autosave(); window.scrollTo({ top: 0 }); } else submit(nx); }
      if (t.closest("[data-back]")) { e.preventDefault(); D.step--; paint(true); }
      const go = t.closest("[data-goto]"); if (go && !go.disabled) { e.preventDefault(); D.step = +go.dataset.goto; paint(true); }
      if (t.closest("[data-discard]") && await ui.confirm({ title: "Discard this upload?", body: "The draft on this device is cleared. Files you already uploaded stay private and are never published.", confirmLabel: "Discard draft", danger: true })) {
        Object.values(uploads).forEach((u) => u.cancel()); BF.store.set("uploadDraft", null); D = blank(); paint(true);
      }
      const rm = t.closest("[data-rmfile]"); if (rm) { e.preventDefault(); uploads[rm.dataset.rmfile]?.cancel(); delete D.files[rm.dataset.rmfile]; if (rm.dataset.rmfile === "stems") D.exclusive = false; paint(); autosave(); }
      const rt = t.closest("[data-retry]"); if (rt) { e.preventDefault(); el.querySelector(`[data-file="${rt.dataset.retry}"]`)?.click(); }
      const mood = t.closest("[data-mood]"); if (mood) { const m = mood.dataset.mood; if (D.moods.includes(m)) D.moods = D.moods.filter((x) => x !== m); else if (D.moods.length < 3) D.moods.push(m); else ui.toast({ kind: "info", title: "Up to 3 moods", timeout: 1800 }); paint(); autosave(); }
      const rt2 = t.closest("[data-rmtag]"); if (rt2) { D.tags = D.tags.filter((x) => x !== rt2.dataset.rmtag); paint(); el.querySelector("#u-tag")?.focus(); autosave(); }
      const as = t.closest("[data-astyle]"); if (as) { D.art = null; D.files.art = null; D.artStyle = as.dataset.astyle; paint(); autosave(); }
    });
    el.addEventListener("input", (e) => {
      const b = e.target.dataset.bind;
      if (b) { D[b] = e.target.value; e.target.closest(".field")?.classList.remove("has-error"); if (b === "description") el.querySelector("[data-desc-count]").textContent = `${D.description.length}/1000`; autosave(); }
      if (e.target.matches("[data-mult]")) { D.priceMult = Number(e.target.value); el.querySelector("[data-mult-label]").textContent = `${D.priceMult.toFixed(2)}×`; el.querySelectorAll(".lc-price").forEach((p, i) => { const l = BF.LICENSES[i]; if (!(l.formats.includes("STEMS") && !hasStems())) p.textContent = BF.money(priceFor(l)); }); autosave(); }
    });
    el.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.file) { const f = t.files[0]; if (f) startUpload(t.dataset.file, f); t.value = ""; }
      if (t.matches("[data-artfile]")) { const f = t.files[0]; if (f) uploadArt(f); t.value = ""; }
      if (t.name === "apal") { D.art = null; D.files.art = null; D.artPalette = t.value; paint(); autosave(); }
      if (t.matches("[data-excl]")) { D.exclusive = t.checked; autosave(); }
      if (t.matches("[data-freedl]")) { D.freeDl = t.checked; autosave(); }
      if (t.name === "vis") { D.visibility = t.value; autosave(); }
      if (t.matches("[data-attest]")) { D.attest = t.checked; t.closest(".field").classList.remove("has-error"); }
    });
    el.addEventListener("keydown", (e) => {
      if (e.target.id === "u-tag" && (e.key === "Enter" || e.key === ",")) {
        e.preventDefault();
        const v = e.target.value.trim().toLowerCase().replace(/^#/, "");
        if (!v) return;
        if (D.tags.includes(v)) { D.errors = { tags: "You already added that tag." }; paint(); el.querySelector("#u-tag").focus(); return; }
        D.errors = {}; D.tags.push(v.slice(0, 30)); paint(); el.querySelector("#u-tag")?.focus(); autosave();
      }
      if (e.key === "Enter" && e.target.matches("[data-body] input:not(#u-tag)")) e.preventDefault();
    });
    el.addEventListener("dragover", (e) => { const dz = e.target.closest("[data-drop]"); if (dz) { e.preventDefault(); dz.classList.add("is-over"); } });
    el.addEventListener("dragleave", (e) => e.target.closest("[data-drop]")?.classList.remove("is-over"));
    el.addEventListener("drop", (e) => {
      const dz = e.target.closest("[data-drop]"); if (!dz) return; e.preventDefault(); dz.classList.remove("is-over");
      const f = e.dataTransfer.files[0]; if (!f) return;
      dz.dataset.drop === "art" ? uploadArt(f) : startUpload(dz.dataset.drop, f);
    });
    const beforeUnload = (e) => { if (Object.keys(uploads).length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { alive = false; clearTimeout(saveT); clearTimeout(pollT); window.removeEventListener("beforeunload", beforeUnload); };
  };
})();
