/* ==========================================================================
   TUNIBEAT Social — Create: post · reel · story · live
   Uploads start as soon as a file is picked (chunked, with progress, retry and cancel).
   One idempotency key per compose session: a double tap or retry can't post twice.
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const MODES = [["post", "Post", "image"], ["reel", "Reel", "reels"], ["story", "Story", "sparkle"], ["live", "Live", "live"]];
  const BG = ["#1b1030", "#0d2b2b", "#2b1a0d", "#101a2e", "#2e0f1c", "#1a2e0f", "#c6f432", "#ff5d8f"];
  const STICKER_TYPES = [["mention", "@ Mention", "at"], ["hashtag", "# Hashtag", "hash"], ["emoji", "Emoji", "smile"], ["music", "Music", "music"], ["question", "Question", "comment"], ["text", "Text", "text"]];

  SX.route("/social/create", {
    title: "Create", active: "create",
    render: (p, q) => `<div class="s-create">
      <header class="s-page-head"><h1 class="s-h2">Create</h1></header>
      <div class="s-seg" role="tablist" aria-label="What are you making?">${MODES.map(([k, l, ic]) => `<button role="tab" data-mode="${k}" aria-selected="${(q.mode ?? "post") === k}">${I(ic, "i-sm")} ${l}</button>`).join("")}</div>
      <div data-mode-body></div></div>`,
    mount(el, p, q) {
      let cleanup = null;
      const body = el.querySelector("[data-mode-body]");
      const open = (mode) => {
        cleanup?.();
        el.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-selected", b.dataset.mode === mode));
        BF.setQuery({ mode: mode === "post" ? "" : mode });
        cleanup = { post: postMode, reel: reelMode, story: storyMode, live: liveMode }[mode](body);
      };
      el.querySelector(".s-seg").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) open(b.dataset.mode); });
      open(MODES.some(([k]) => k === q.mode) ? q.mode : "post");
      return () => cleanup?.();
    },
  });

  /* ---------- Upload items (shared by post and reel) ---------- */
  function uploadItem(file, purpose, onChange) {
    const it = { id: SX.ikey(), file, kind: file.type.startsWith("video") ? "video" : "image", status: "processing", progress: 0, alt: "", media: null, error: null, preview: URL.createObjectURL(file), ctrl: new AbortController() };
    it.start = async () => {
      it.status = "processing"; it.error = null; it.ctrl = new AbortController(); onChange();
      try {
        let main = file, meta = {}, variants, poster;
        if (it.kind === "image") {
          const img = await SX.processImage(file);
          main = img.file; meta = { width: img.width, height: img.height };
          if (img.variant) { const v = await SX.upload(img.variant, { purpose: "variant", signal: it.ctrl.signal }); variants = { w480: v.id }; }
        } else {
          const vm = await SX.videoMeta(file);
          if (purpose === "reel" && vm.duration_ms > 180_000) throw new Error("Reels can be up to 3 minutes. Trim the video and try again.");
          meta = { duration_ms: vm.duration_ms, width: vm.width, height: vm.height };
          it.duration = vm.duration_ms; it.vertical = vm.height > vm.width;
          if (vm.poster) poster = (await SX.upload(vm.poster, { purpose: "poster", signal: it.ctrl.signal })).id;
        }
        it.status = "uploading"; onChange();
        it.media = await SX.upload(main, { purpose, meta, signal: it.ctrl.signal, variants, poster_media_id: poster, onProgress: (f) => { it.progress = f; onChange(true); } });
        it.status = "done"; onChange();
      } catch (err) {
        if (err.name === "AbortError") { it.status = "cancelled"; onChange(); return; }
        it.status = "error"; it.error = err.message; onChange();
      }
    };
    it.cancel = () => { it.ctrl.abort(); };
    return it;
  }
  function itemHtml(it, i, n, { reorder = true } = {}) {
    const pct = Math.round(it.progress * 100);
    return `<li class="s-up-item ${it.status}" data-item="${it.id}" draggable="${reorder && n > 1}" aria-label="${it.kind} ${i + 1} of ${n}">
      <div class="s-up-thumb">${it.kind === "video" ? `<video src="${it.preview}" muted playsinline preload="metadata"></video><span class="s-up-kind">${I("video", "i-xs")}${it.duration ? SX.dur(it.duration) : ""}</span>` : `<img src="${it.preview}" alt="">`}
        ${it.status === "uploading" || it.status === "processing" ? `<div class="s-up-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Uploading"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="${it.status === "processing" ? 12 : pct} 100"/></svg><span>${it.status === "processing" ? "…" : pct + "%"}</span></div>` : ""}
        ${it.status === "done" ? `<span class="s-up-ok" aria-label="Uploaded">${I("check", "i-xs")}</span>` : ""}
        ${it.status === "error" || it.status === "cancelled" ? `<div class="s-up-err" role="alert">${I("alert", "i-xs")}<span>${esc(it.error ?? "Cancelled")}</span><button type="button" class="s-btn sm" data-u="retry">Retry</button></div>` : ""}
      </div>
      <div class="s-up-tools">
        ${reorder && n > 1 ? `<button type="button" class="s-icon-btn sm" data-u="left" ${i === 0 ? "disabled" : ""} aria-label="Move earlier">${I("chevron-left", "i-xs")}</button><button type="button" class="s-icon-btn sm" data-u="right" ${i === n - 1 ? "disabled" : ""} aria-label="Move later">${I("chevron-right", "i-xs")}</button>` : ""}
        ${it.status === "uploading" || it.status === "processing" ? `<button type="button" class="s-icon-btn sm" data-u="cancel" aria-label="Cancel upload">${I("x", "i-xs")}</button>` : `<button type="button" class="s-icon-btn sm" data-u="remove" aria-label="Remove">${I("trash", "i-xs")}</button>`}
      </div>
      ${it.kind === "image" ? `<label class="s-up-alt"><span class="sr-only">Alt text for image ${i + 1}</span><input data-u-alt value="${esc(it.alt)}" maxlength="300" placeholder="Alt text (describe the image)"></label>` : ""}
    </li>`;
  }

  /* ---------- Caption with #/@ suggestions ---------- */
  function captionField(name, placeholder, max = 2200) {
    return `<div class="s-caption-field"><label class="s-field"><span>Caption</span><textarea name="${name}" rows="4" maxlength="${max}" placeholder="${placeholder}" data-caption-input></textarea></label>
      <div class="s-suggest" data-suggest role="listbox" hidden></div><span class="s-counter" data-counter>0/${max}</span></div>`;
  }
  function bindCaption(root) {
    const ta = root.querySelector("[data-caption-input]"), box = root.querySelector("[data-suggest]"), counter = root.querySelector("[data-counter]");
    if (!ta) return;
    let t, token = null;
    ta.addEventListener("input", () => {
      counter.textContent = `${ta.value.length}/${ta.maxLength}`;
      const m = /(^|\s)([@#])([\p{L}\p{N}_.]{1,30})$/u.exec(ta.value.slice(0, ta.selectionStart));
      clearTimeout(t);
      if (!m) { box.hidden = true; token = null; return; }
      token = { sym: m[2], text: m[3], at: ta.selectionStart - m[3].length - 1 };
      t = setTimeout(async () => {
        try {
          const r = await api.get(`/api/search/suggest?q=${encodeURIComponent(token.sym === "#" ? "#" + token.text : token.text)}`);
          const opts = token.sym === "@" ? r.users.map((u) => ["@" + u.username, `${SX.avatar(u, "xs", { link: false })} <b>${esc(u.display_name)}</b> <span class="s-handle">@${esc(u.username)}</span>`]) : r.hashtags.map((h) => ["#" + h.tag, `#${esc(h.tag)} <span class="s-handle">${SX.count(h.post_count)} posts</span>`]);
          box.innerHTML = opts.map(([v, h], i) => `<button type="button" role="option" data-v="${esc(v)}" ${i ? "" : 'aria-selected="true"'}>${h}</button>`).join("");
          box.hidden = !opts.length;
        } catch { box.hidden = true; }
      }, 180);
    });
    box.addEventListener("mousedown", (e) => {
      const b = e.target.closest("[data-v]"); if (!b || !token) return;
      e.preventDefault();
      ta.setRangeText(b.dataset.v + " ", token.at, ta.selectionStart, "end");
      box.hidden = true; ta.focus(); ta.dispatchEvent(new Event("input"));
    });
    ta.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 150));
  }

  /* ---------- People tagging ---------- */
  function tagField() {
    return `<div class="s-field"><span>Tag people</span><div class="s-chips" data-tags></div><input class="s-input" data-tag-search placeholder="Search people to tag" aria-label="Search people to tag"><div class="s-suggest inline" data-tag-suggest hidden></div></div>`;
  }
  function bindTags(root, tags) {
    const input = root.querySelector("[data-tag-search]"), box = root.querySelector("[data-tag-suggest]"), chips = root.querySelector("[data-tags]");
    const draw = () => (chips.innerHTML = [...tags.values()].map((u) => `<span class="s-chip">@${esc(u.username)} <button type="button" data-untag="${u.id}" aria-label="Remove @${esc(u.username)}">${I("x", "i-xs")}</button></span>`).join(""));
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (!q) { box.hidden = true; return; }
      t = setTimeout(async () => {
        const r = await api.get(`/api/search/suggest?q=${encodeURIComponent(q)}`).catch(() => ({ users: [] }));
        box.innerHTML = r.users.filter((u) => u.id !== SX.state.me.id).map((u) => `<button type="button" data-tag='${esc(JSON.stringify(u))}'>${SX.avatar(u, "xs", { link: false })} ${esc(u.display_name)} <span class="s-handle">@${esc(u.username)}</span></button>`).join("");
        box.hidden = !r.users.length;
      }, 200);
    });
    root.addEventListener("click", (e) => {
      const add = e.target.closest("[data-tag]");
      if (add) { const u = JSON.parse(add.dataset.tag); tags.set(u.id, u); draw(); input.value = ""; box.hidden = true; }
      const rm = e.target.closest("[data-untag]");
      if (rm) { tags.delete(rm.dataset.untag); draw(); }
    });
  }

  /* ---------- POST ---------- */
  function postMode(host) {
    const items = [];
    const tags = new Map();
    const key = SX.ikey();
    host.innerHTML = `<form class="s-form s-card" data-form>
      <div class="s-drop" data-drop tabindex="0" role="button" aria-label="Add photos or videos. Drop files here or press Enter to browse.">
        ${I("image")}<b>Add photos or videos</b><span>Up to 10 · JPG, PNG, WebP, GIF, MP4, WebM · drag to reorder</span>
        <input type="file" data-file accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple hidden>
      </div>
      <ul class="s-up-list" data-items aria-live="polite"></ul>
      ${captionField("caption", "Write a caption… use #hashtags and @mentions")}
      ${tagField()}
      <div class="s-row wrap">
        <label class="s-field grow"><span>Who can see this</span><select name="visibility" class="s-input"><option value="public">Everyone</option><option value="followers">Followers only</option></select></label>
        <label class="s-toggle"><input type="checkbox" name="allow_tips" checked><span>Allow tips on this post</span></label>
      </div>
      <div class="s-form-actions"><span class="s-hint" data-status></span><button class="s-btn primary lg" data-submit disabled>Share</button></div>
    </form>`;
    const form = host.querySelector("[data-form]");
    const list = host.querySelector("[data-items]");
    const fileIn = host.querySelector("[data-file]");
    const drop = host.querySelector("[data-drop]");
    bindCaption(form); bindTags(form, tags);
    let raf = 0;
    const draw = (progressOnly) => {
      if (progressOnly) { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => draw(false)); return; }
      list.innerHTML = items.map((it, i) => itemHtml(it, i, items.length)).join("");
      const busy = items.some((i) => i.status === "processing" || i.status === "uploading");
      const failed = items.some((i) => i.status === "error" || i.status === "cancelled");
      const caption = form.caption.value.trim();
      form.querySelector("[data-submit]").disabled = busy || failed || (!items.length && !caption);
      form.querySelector("[data-status]").textContent = busy ? "Uploading…" : failed ? "Fix or remove failed uploads to share." : "";
    };
    const add = (files) => {
      for (const f of files) {
        if (items.length >= 10) { SX.toast({ kind: "error", title: "Up to 10 items per post" }); break; }
        if (!/^(image|video)\//.test(f.type)) { SX.toast({ kind: "error", title: "Unsupported file", desc: esc(f.name) }); continue; }
        const it = uploadItem(f, "post", draw);
        items.push(it); it.start();
      }
      draw();
    };
    drop.addEventListener("click", () => fileIn.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileIn.click(); } });
    fileIn.addEventListener("change", () => { add([...fileIn.files]); fileIn.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => { e.preventDefault(); add([...e.dataTransfer.files]); });
    form.caption.addEventListener("input", () => draw());
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-u]"); if (!b) return;
      const i = items.findIndex((x) => x.id === b.closest("[data-item]").dataset.item);
      const it = items[i];
      if (b.dataset.u === "remove") { URL.revokeObjectURL(it.preview); items.splice(i, 1); }
      if (b.dataset.u === "cancel") it.cancel();
      if (b.dataset.u === "retry") it.start();
      if (b.dataset.u === "left" && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
      if (b.dataset.u === "right" && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
      draw();
    });
    list.addEventListener("input", (e) => { if (e.target.matches("[data-u-alt]")) items.find((x) => x.id === e.target.closest("[data-item]").dataset.item).alt = e.target.value; });
    // Drag to reorder
    let dragId = null;
    list.addEventListener("dragstart", (e) => { dragId = e.target.closest("[data-item]")?.dataset.item; e.dataTransfer.effectAllowed = "move"; });
    list.addEventListener("dragover", (e) => { if (dragId) e.preventDefault(); });
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      const over = e.target.closest("[data-item]")?.dataset.item;
      if (!dragId || !over || over === dragId) return;
      const from = items.findIndex((x) => x.id === dragId), to = items.findIndex((x) => x.id === over);
      items.splice(to, 0, items.splice(from, 1)[0]); dragId = null; draw();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[data-submit]");
      btn.disabled = true; btn.textContent = "Sharing…";
      try {
        const r = await api.post("/api/posts", {
          caption: form.caption.value, media_ids: items.map((x) => x.media.id), alts: items.map((x) => x.alt),
          visibility: form.visibility.value, allow_tips: form.allow_tips.checked, tagged_user_ids: [...tags.keys()], idempotency_key: key,
        });
        SX.toast({ title: "Shared", desc: "Your post is live." });
        location.hash = `#/social/p/${r.post.id}`;
      } catch (err) { SX.fail(err, "Couldn’t share"); btn.disabled = false; btn.textContent = "Share"; }
    });
    const beforeUnload = (e) => { if (items.some((i) => i.status === "uploading")) { e.preventDefault(); e.returnValue = ""; } };
    addEventListener("beforeunload", beforeUnload);
    return () => { removeEventListener("beforeunload", beforeUnload); items.forEach((i) => { if (i.status !== "done") i.cancel(); URL.revokeObjectURL(i.preview); }); };
  }

  /* ---------- REEL ---------- */
  function reelMode(host) {
    let it = null;
    const key = SX.ikey();
    host.innerHTML = `<form class="s-form s-card" data-form>
      <div class="s-reel-compose">
        <div class="s-reel-drop" data-drop tabindex="0" role="button" aria-label="Choose a vertical video for your reel">
          ${I("reels")}<b>Choose a video</b><span>Vertical 9:16 works best · up to 3 minutes · MP4 or WebM</span>
          <input type="file" data-file accept="video/mp4,video/webm,video/quicktime" hidden></div>
        <div class="grow">
          ${captionField("caption", "Describe your reel… #hashtags @mentions")}
          <label class="s-field"><span>Audio</span><input class="s-input" name="audio_title" maxlength="80" placeholder="Original sound · ${esc(SX.state.me.display_name)}"></label>
          <label class="s-field"><span>Who can see this</span><select name="visibility" class="s-input"><option value="public">Everyone</option><option value="followers">Followers only</option></select></label>
          <div class="s-form-actions"><span class="s-hint" data-status></span><button class="s-btn primary lg" data-submit disabled>Share reel</button></div>
        </div>
      </div></form>`;
    const form = host.querySelector("[data-form]"), drop = host.querySelector("[data-drop]"), fileIn = host.querySelector("[data-file]");
    bindCaption(form);
    const draw = (progressOnly) => {
      if (!it) return;
      drop.classList.add("has");
      drop.innerHTML = `<ul class="s-up-list single">${itemHtml(it, 0, 1, { reorder: false })}</ul>${it.vertical === false ? `<p class="s-hint warn">${I("info", "i-xs")} This video is horizontal; it will be letterboxed in Reels.</p>` : ""}`;
      form.querySelector("[data-submit]").disabled = it.status !== "done";
      form.querySelector("[data-status]").textContent = it.status === "done" ? "" : it.status === "error" ? "Upload failed" : "Uploading…";
      if (progressOnly) return;
    };
    const pick = (f) => {
      if (!f?.type.startsWith("video/")) { SX.toast({ kind: "error", title: "Choose a video file" }); return; }
      it?.cancel(); it = uploadItem(f, "reel", draw); it.start(); draw();
    };
    drop.addEventListener("click", (e) => { if (e.target.closest("[data-u]")) return; if (!it || it.status !== "uploading") fileIn.click(); });
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter") fileIn.click(); });
    fileIn.addEventListener("change", () => pick(fileIn.files[0]));
    drop.addEventListener("dragover", (e) => e.preventDefault());
    drop.addEventListener("drop", (e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); });
    drop.addEventListener("click", (e) => {
      const b = e.target.closest("[data-u]"); if (!b) return;
      e.stopPropagation();
      if (b.dataset.u === "cancel") it.cancel(); if (b.dataset.u === "retry") it.start(); if (b.dataset.u === "remove") { it = null; reelMode(host); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[data-submit]"); btn.disabled = true; btn.textContent = "Sharing…";
      try {
        const r = await api.post("/api/posts", { type: "reel", caption: form.caption.value, media_ids: [it.media.id], audio_title: form.audio_title.value || undefined, visibility: form.visibility.value, idempotency_key: key });
        SX.toast({ title: "Reel shared" });
        location.hash = `#/social/reels/${r.post.id}`;
      } catch (err) { SX.fail(err, "Couldn’t share reel"); btn.disabled = false; btn.textContent = "Share reel"; }
    });
    return () => { if (it && it.status !== "done") it.cancel(); };
  }

  /* ---------- STORY ---------- */
  function storyMode(host) {
    const st = { file: null, preview: null, kind: null, text: "", bg: BG[0], stickers: [], link: "", audio: "", audience: SX.state.me.privacy?.story_audience ?? "public", ctrl: null };
    host.innerHTML = `<div class="s-story-compose">
      <div class="s-story-canvas" data-canvas style="background:${st.bg}" aria-label="Story preview">
        <div data-media class="s-story-media"></div>
        <p class="s-story-textpv" data-textpv></p>
        <div data-stickers></div>
        <span class="s-story-hint" data-hint>Add a photo or video, or type something</span>
      </div>
      <form class="s-form s-card" data-form>
        <div class="s-row wrap"><button type="button" class="s-btn" data-pick>${I("image", "i-sm")} Photo or video</button><button type="button" class="s-btn ghost" data-clear hidden>${I("trash", "i-sm")} Remove media</button>
          <input type="file" data-file accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden></div>
        <label class="s-field"><span>Text</span><textarea name="text" rows="2" maxlength="300" placeholder="Say something…"></textarea></label>
        <div class="s-field" data-bgrow><span>Background</span><div class="s-swatches" role="radiogroup" aria-label="Background colour">${BG.map((c, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-bg="${c}" style="background:${c}" aria-label="Colour ${i + 1}"></button>`).join("")}</div></div>
        <div class="s-field"><span>Stickers <small class="muted">(drag them on the preview)</small></span><div class="s-chips">${STICKER_TYPES.map(([k, l, ic]) => `<button type="button" class="s-chip btn" data-add-sticker="${k}">${I(ic, "i-xs")} ${l}</button>`).join("")}</div>
          <div class="s-row" data-sticker-entry hidden><label class="sr-only" for="st-val" data-sticker-label>Sticker</label><input class="s-input grow" id="st-val" maxlength="80" data-sticker-val><button type="button" class="s-btn sm primary" data-sticker-ok>Add</button><button type="button" class="s-btn sm ghost" data-sticker-cancel>Cancel</button></div></div>
        <label class="s-field"><span>Link (optional)</span><input class="s-input" name="link" type="url" placeholder="https://"></label>
        <label class="s-field"><span>Audience</span><select class="s-input" name="audience"><option value="public">Everyone who can see your profile</option><option value="followers">Followers</option><option value="close_friends">Close friends ★</option></select></label>
        <p class="s-hint">${I("clock", "i-xs")} Stories disappear after 24 hours.</p>
        <div class="s-form-actions"><span class="s-hint" data-status></span><button class="s-btn primary lg" data-submit disabled>Share to story</button></div>
      </form></div>`;
    const $ = (s) => host.querySelector(s);
    const form = $("[data-form]");
    form.audience.value = st.audience;
    const canvas = $("[data-canvas]");
    const drawStickers = () => {
      $("[data-stickers]").innerHTML = st.stickers.map((s, i) => `<span class="s-sticker ${s.type} editable" data-sticker="${i}" style="left:${s.x * 100}%;top:${s.y * 100}%" tabindex="0" aria-label="${s.type} sticker ${esc(s.value)}. Arrow keys move, Delete removes.">${s.type === "mention" ? "@" : s.type === "hashtag" ? "#" : ""}${esc(s.value)}<button type="button" data-rm-sticker="${i}" aria-label="Remove sticker">×</button></span>`).join("");
    };
    const update = () => {
      $("[data-textpv]").textContent = form.text.value;
      $("[data-textpv]").classList.toggle("over", !!st.file);
      $("[data-hint]").hidden = !!(st.file || form.text.value.trim());
      $("[data-clear]").hidden = !st.file;
      $("[data-bgrow]").hidden = !!st.file;
      $("[data-submit]").disabled = !(st.file || form.text.value.trim()) || st.busy;
    };
    const setFile = (f) => {
      if (!f) return;
      if (!/^(image|video)\//.test(f.type)) return SX.toast({ kind: "error", title: "Choose a photo or video" });
      if (st.preview) URL.revokeObjectURL(st.preview);
      st.file = f; st.kind = f.type.startsWith("video") ? "video" : "image"; st.preview = URL.createObjectURL(f);
      $("[data-media]").innerHTML = st.kind === "video" ? `<video src="${st.preview}" autoplay muted loop playsinline></video>` : `<img src="${st.preview}" alt="">`;
      update();
    };
    $("[data-pick]").onclick = () => $("[data-file]").click();
    $("[data-file]").onchange = (e) => setFile(e.target.files[0]);
    $("[data-clear]").onclick = () => { st.file = null; $("[data-media]").innerHTML = ""; update(); };
    form.text.addEventListener("input", update);
    host.querySelector("[data-sticker-val]").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); host.querySelector("[data-sticker-ok]").click(); } });
    host.addEventListener("click", (e) => {
      const bg = e.target.closest("[data-bg]");
      if (bg) { st.bg = bg.dataset.bg; canvas.style.background = st.bg; host.querySelectorAll("[data-bg]").forEach((b) => b.setAttribute("aria-checked", b === bg)); }
      const add = e.target.closest("[data-add-sticker]");
      if (add) {
        if (st.stickers.length >= 10) return SX.toast({ kind: "error", title: "Up to 10 stickers" });
        const labels = { mention: "Username to mention", hashtag: "Hashtag", emoji: "Emoji", music: "Song or sound name", question: "Your question", text: "Sticker text" };
        st.pending = add.dataset.addSticker;
        const row = $("[data-sticker-entry]"); row.hidden = false;
        $("[data-sticker-label]").textContent = labels[st.pending];
        const inp = $("[data-sticker-val]"); inp.placeholder = labels[st.pending]; inp.value = st.pending === "emoji" ? "🔥" : ""; inp.focus();
      }
      if (e.target.closest("[data-sticker-cancel]")) { $("[data-sticker-entry]").hidden = true; st.pending = null; }
      if (e.target.closest("[data-sticker-ok]")) {
        const value = $("[data-sticker-val]").value.trim().replace(/^[@#]/, "").slice(0, 80);
        if (!value || !st.pending) return;
        st.stickers.push({ type: st.pending, value, x: 0.5, y: 0.3 + st.stickers.length * 0.07 });
        $("[data-sticker-entry]").hidden = true; st.pending = null; drawStickers();
      }
      const rm = e.target.closest("[data-rm-sticker]");
      if (rm) { st.stickers.splice(Number(rm.dataset.rmSticker), 1); drawStickers(); }
    });
    // Drag stickers (pointer) and nudge with arrow keys
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => { const s = e.target.closest("[data-sticker]"); if (!s || e.target.closest("button")) return; drag = Number(s.dataset.sticker); s.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (drag == null) return;
      const r = canvas.getBoundingClientRect();
      st.stickers[drag].x = Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width));
      st.stickers[drag].y = Math.max(0.05, Math.min(0.95, (e.clientY - r.top) / r.height));
      const el = canvas.querySelector(`[data-sticker="${drag}"]`); el.style.left = st.stickers[drag].x * 100 + "%"; el.style.top = st.stickers[drag].y * 100 + "%";
    });
    canvas.addEventListener("pointerup", () => (drag = null));
    canvas.addEventListener("keydown", (e) => {
      const s = e.target.closest("[data-sticker]"); if (!s) return;
      const i = Number(s.dataset.sticker), d = 0.02;
      if (e.key === "Delete" || e.key === "Backspace") { st.stickers.splice(i, 1); drawStickers(); return; }
      const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key]; if (!mv) return;
      e.preventDefault(); st.stickers[i].x = Math.max(0.05, Math.min(0.95, st.stickers[i].x + mv[0])); st.stickers[i].y = Math.max(0.05, Math.min(0.95, st.stickers[i].y + mv[1]));
      drawStickers(); canvas.querySelector(`[data-sticker="${i}"]`).focus();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      st.busy = true; update();
      const status = $("[data-status]");
      st.ctrl = new AbortController();
      try {
        let media_id;
        if (st.file) {
          status.textContent = "Preparing…";
          let file = st.file, meta = {}, poster;
          if (st.kind === "image") { const img = await SX.processImage(file, { max: 1920 }); file = img.file; }
          else {
            const vm = await SX.videoMeta(file);
            if (vm.duration_ms > 60_000) throw new Error("Story videos can be up to 60 seconds.");
            meta = { duration_ms: vm.duration_ms, width: vm.width, height: vm.height };
            if (vm.poster) poster = (await SX.upload(vm.poster, { purpose: "poster", signal: st.ctrl.signal })).id;
          }
          const m = await SX.upload(file, { purpose: "story", meta, poster_media_id: poster, signal: st.ctrl.signal, onProgress: (f) => (status.textContent = `Uploading ${Math.round(f * 100)}%`) });
          media_id = m.id;
        }
        await api.post("/api/stories", { media_id, content: { text: form.text.value, bg: st.file ? null : st.bg, stickers: st.stickers }, link_url: form.link.value.trim() || undefined, audience: form.audience.value });
        SX.toast({ title: "Added to your story", desc: form.audience.value === "close_friends" ? "Only your close friends can see it." : "Visible for 24 hours." });
        location.hash = "#/social";
      } catch (err) { if (err.name !== "AbortError") SX.fail(err, "Couldn’t share story"); status.textContent = ""; st.busy = false; update(); }
    });
    update();
    return () => { st.ctrl?.abort(); if (st.preview) URL.revokeObjectURL(st.preview); };
  }

  /* ---------- LIVE ---------- */
  function liveMode(host) {
    host.innerHTML = `<form class="s-form s-card" data-form>
      <div class="s-live-setup-head">${I("live")}<div><h2 class="s-h4">Go live</h2><p class="muted">Stream from your camera and mic. Viewers can chat, react, send gifts and tip.</p></div></div>
      <label class="s-field"><span>Title</span><input class="s-input" name="title" required maxlength="100" placeholder="What are you streaming?"></label>
      <label class="s-field"><span>Description</span><textarea name="description" rows="2" maxlength="500" placeholder="Optional"></textarea></label>
      <div class="s-row wrap">
        <label class="s-field grow"><span>Category</span><select class="s-input" name="category" data-cats><option>Music performance</option></select></label>
        <label class="s-field grow"><span>Audience</span><select class="s-input" name="audience"><option value="public">Everyone</option><option value="followers">Followers only</option></select></label>
      </div>
      <div class="s-field"><span>Thumbnail (optional)</span><div class="s-row"><button type="button" class="s-btn" data-thumb>${I("image", "i-sm")} Choose image</button><span class="s-hint" data-thumb-status></span><input type="file" accept="image/*" data-thumb-file hidden></div></div>
      <fieldset class="s-radio-row"><legend class="sr-only">When</legend>
        <label class="s-radio"><input type="radio" name="when" value="now" checked><span>Go live now</span></label>
        <label class="s-radio"><input type="radio" name="when" value="later"><span>Schedule</span></label>
        <input class="s-input" type="datetime-local" name="at" hidden aria-label="Scheduled time"></fieldset>
      ${SX.state.env?.live?.transport === "webrtc-mesh" ? `<p class="s-hint">${I("info", "i-xs")} This server streams peer-to-peer (WebRTC) for up to ${SX.state.env.live.max_viewers} viewers at a time. Keep this tab open while live.</p>` : ""}
      <div class="s-form-actions"><button class="s-btn primary lg" data-submit>${I("live", "i-sm")} Continue</button></div></form>`;
    const form = host.querySelector("[data-form]");
    let thumbId = null;
    api.get("/api/live?status=live").then((r) => (form.querySelector("[data-cats]").innerHTML = r.categories.map((c) => `<option>${esc(c)}</option>`).join(""))).catch(() => {});
    form.audience.value = SX.state.me.privacy?.live_audience ?? "public";
    form.querySelector("[data-thumb]").onclick = () => form.querySelector("[data-thumb-file]").click();
    form.querySelector("[data-thumb-file]").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const s = form.querySelector("[data-thumb-status]");
      try { s.textContent = "Uploading…"; const img = await SX.processImage(f, { max: 1280 }); thumbId = (await SX.upload(img.file, { purpose: "live_thumbnail", onProgress: (x) => (s.textContent = `${Math.round(x * 100)}%`) })).id; s.textContent = "Thumbnail ready ✓"; }
      catch (err) { s.textContent = ""; SX.fail(err); }
    };
    form.addEventListener("change", () => { form.at.hidden = form.when.value !== "later"; if (!form.at.hidden && !form.at.value) { const d = new Date(Date.now() + 3600_000); d.setMinutes(0); form.at.value = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const later = form.when.value === "later";
      const btn = form.querySelector("[data-submit]"); btn.disabled = true;
      try {
        const r = await api.post("/api/live", { title: form.title.value, description: form.description.value, category: form.category.value, audience: form.audience.value, thumbnail_media_id: thumbId ?? undefined, scheduled_at: later ? new Date(form.at.value).getTime() : undefined });
        if (later) { SX.toast({ title: "Live scheduled", desc: `Your followers were notified · ${SX.when(r.stream.scheduled_at)}` }); location.hash = "#/social/live"; }
        else location.hash = `#/social/live/${r.stream.id}`;
      } catch (err) { SX.fail(err); btn.disabled = false; }
    });
    return () => {};
  }
})();
