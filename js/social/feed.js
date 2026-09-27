/* ==========================================================================
   TUNIBEAT Social — posts, feed, comments, sharing, hashtag and post pages
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const REACTIONS = [["like", "❤️", "Like"], ["love", "😍", "Love"], ["fire", "🔥", "Fire"], ["clap", "👏", "Clap"], ["laugh", "😂", "Haha"], ["wow", "😮", "Wow"], ["sad", "😢", "Sad"]];
  const EMOJI = Object.fromEntries(REACTIONS.map(([k, e]) => [k, e]));
  SX.REACTIONS = REACTIONS;
  const cache = new Map();      // postId → latest post object (for sheets and optimistic updates)
  SX.postCache = cache;

  /* ---------- Rendering ---------- */
  function ratio(m) {
    if (!m?.width || !m?.height) return "4 / 5";
    const r = m.width / m.height;
    return r < 0.8 ? "4 / 5" : r > 1.91 ? "1.91 / 1" : `${m.width} / ${m.height}`;
  }
  function mediaHtml(p) {
    const m = p.media;
    if (!m.length) return "";
    if (p.type === "reel") {
      const v = m[0];
      return `<a class="s-post-media reel" href="#/social/reels/${p.id}" aria-label="Play reel by ${esc(p.author.display_name)}" style="aspect-ratio:4/5">
        <img data-src="${v.poster_url ?? ""}" alt="" decoding="async"><span class="s-reel-badge">${I("reels", "i-xs")} Reel</span><span class="s-play-big">${I("play")}</span>
        ${p.counts.views ? `<span class="s-views">${I("play", "i-xs")} ${SX.count(p.counts.views)}</span>` : ""}</a>`;
    }
    const one = (x, i) => x.kind === "video"
      ? `<div class="s-slide"><video data-src="${x.url}" data-poster="${x.poster_url ?? ""}" muted playsinline loop preload="none" data-autoplay aria-label="${esc(x.alt || "Video")}"></video>
          <button class="s-sound" data-act="sound" aria-label="Turn sound on">${I("volume-x", "i-sm")}</button></div>`
      : `<div class="s-slide"><img data-src="${x.variants?.w480 && innerWidth < 500 ? x.variants.w480 : x.url}" alt="${esc(x.alt || "")}" decoding="async" ${i ? 'loading="lazy"' : ""}></div>`;
    if (m.length === 1) return `<div class="s-post-media" style="aspect-ratio:${ratio(m[0])}" data-dbl>${one(m[0], 0)}</div>`;
    return `<div class="s-post-media carousel" style="aspect-ratio:${ratio(m[0])}" data-dbl>
      <div class="s-track" data-track tabindex="0" aria-roledescription="carousel" aria-label="${m.length} photos and videos">${m.map((x, i) => one(x, i)).join("")}</div>
      <button class="s-car-btn prev" data-act="car-prev" aria-label="Previous" hidden>${I("chevron-left", "i-sm")}</button>
      <button class="s-car-btn next" data-act="car-next" aria-label="Next">${I("chevron-right", "i-sm")}</button>
      <span class="s-car-count" data-count>1/${m.length}</span>
      <div class="s-dots" aria-hidden="true">${m.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div></div>`;
  }
  function likeLine(p) {
    if (p.counts.likes == null) return p.viewer.reaction ? `<span class="s-likes">Liked by you and others</span>` : "";
    return p.counts.likes ? `<button class="s-likes" data-act="likers">${SX.count(p.counts.likes)} ${p.counts.likes === 1 ? "like" : "likes"}</button>` : "";
  }
  SX.actionsHtml = (p) => {
    const r = p.viewer.reaction;
    return `<div class="s-actions" role="group" aria-label="Post actions">
      <button class="s-act like ${r ? "on" : ""}" data-act="like" aria-pressed="${!!r}" aria-label="${r ? "Remove reaction" : "Like"}" title="Hold for more reactions">${r && r !== "like" ? `<span class="s-emoji">${EMOJI[r]}</span>` : I(r ? "heart-fill" : "heart")}</button>
      <button class="s-act" data-act="comment" aria-label="Comment">${I("comment")}${p.counts.comments ? `<span>${SX.count(p.counts.comments)}</span>` : ""}</button>
      <button class="s-act" data-act="share" aria-label="Share">${I("send")}${p.counts.shares ? `<span>${SX.count(p.counts.shares)}</span>` : ""}</button>
      ${p.viewer.can_gift ? `<button class="s-act gift" data-act="gift" aria-label="Send a gift to ${esc(p.author.display_name)}">${I("gift")}</button>` : ""}
      ${p.viewer.can_tip ? `<button class="s-act tip" data-act="tip" aria-label="Tip ${esc(p.author.display_name)}">${I("coin")}</button>` : ""}
      <button class="s-act save ${p.viewer.saved ? "on" : ""}" data-act="save" aria-pressed="${p.viewer.saved}" aria-label="${p.viewer.saved ? "Remove from saved" : "Save"}">${I(p.viewer.saved ? "bookmark-fill" : "bookmark")}</button>
    </div>`;
  };
  SX.postCard = (p, { detail = false, embedded = false } = {}) => {
    cache.set(p.id, p);
    const head = `<header class="s-post-head">${SX.avatar(p.author, "sm")}<div class="s-post-meta">${SX.name(p.author)}
        <span class="s-sub"><a href="#/social/p/${p.id}"><time datetime="${new Date(p.created_at).toISOString()}" title="${SX.when(p.created_at)}">${SX.ago(p.created_at)}</time></a>${p.edited_at ? " · edited" : ""}${p.visibility === "followers" ? ` · ${I("users", "i-xs")} Followers` : ""}${p.audio_title ? ` · ${I("music", "i-xs")} ${esc(p.audio_title)}` : ""}</span></div>
        ${embedded ? "" : `<button class="s-icon-btn sm" data-act="more" aria-label="More options">${I("more")}</button>`}</header>`;
    if (embedded) return `<div class="s-embed">${head}${p.caption ? `<div class="s-caption clamp">${SX.rich(p.caption)}</div>` : ""}${mediaHtml(p)}</div>`;
    const isText = p.type === "text";
    const caption = p.caption ? `<div class="s-caption ${isText && p.caption.length < 140 && !p.shared_post ? "big" : ""} ${detail ? "" : "clamp"}" data-caption>${isText ? "" : `${SX.name(p.author, { link: true })} `}${SX.rich(p.caption)}</div>${!detail && p.caption.length > 180 ? `<button class="s-more-link" data-act="expand">more</button>` : ""}` : "";
    const shared = p.shared_post ? (p.shared_post.unavailable ? `<div class="s-embed unavailable">${I("eye-off", "i-sm")} This post isn’t available</div>` : `<a class="s-embed-link" href="#/social/p/${p.shared_post.id}">${SX.postCard(p.shared_post, { embedded: true })}</a>`) : "";
    return `<article class="s-post" data-post="${p.id}" aria-label="Post by ${esc(p.author.display_name)}">
      ${p.type === "share" ? `<div class="s-reposted">${I("repost", "i-xs")} ${esc(p.author.display_name)} reposted</div>` : ""}
      ${head}
      ${isText ? caption + shared : shared + mediaHtml(p)}
      ${SX.actionsHtml(p)}
      <div class="s-post-foot">${likeLine(p)}
        ${!isText ? caption : ""}
        ${p.tagged?.length ? `<div class="s-tagged">${I("tag", "i-xs")} with ${p.tagged.map((u) => `<a href="#/social/u/${esc(u.username)}">@${esc(u.username)}</a>`).join(", ")}</div>` : ""}
        ${!detail && p.counts.comments ? `<button class="s-view-comments" data-act="comment">View ${p.counts.comments === 1 ? "1 comment" : `all ${SX.count(p.counts.comments)} comments`}</button>` : ""}
      </div></article>`;
  };
  SX.gridCell = (p) => {
    cache.set(p.id, p);
    const m = p.media[0];
    const thumb = m ? (m.kind === "video" ? m.poster_url : m.variants?.w480 ?? m.url) : null;
    const kind = p.type === "reel" ? I("reels", "i-xs") : p.media.length > 1 ? I("layers", "i-xs") : m?.kind === "video" ? I("video", "i-xs") : "";
    const href = p.type === "reel" ? `#/social/reels/${p.id}` : `#/social/p/${p.id}`;
    return `<a class="s-grid-cell ${thumb ? "" : "text"}" href="${href}" aria-label="${esc((p.caption || p.type).slice(0, 80))}">
      ${thumb ? `<img data-src="${thumb}" alt="${esc(m.alt || "")}" decoding="async">` : `<span class="s-grid-text">${esc(p.caption.slice(0, 120))}</span>`}
      ${kind ? `<span class="s-grid-kind">${kind}</span>` : ""}
      <span class="s-grid-stats">${p.counts.likes != null ? `${I("heart-fill", "i-xs")} ${SX.count(p.counts.likes)}` : ""} ${I("comment", "i-xs")} ${SX.count(p.counts.comments)}${p.type === "reel" ? ` ${I("play", "i-xs")} ${SX.count(p.counts.views)}` : ""}</span></a>`;
  };

  /* ---------- Interactions (delegated; one handler per page) ---------- */
  const pending = new Map();   // postId → { want, inflight }: last intent wins, so rapid taps can't desync
  async function setReaction(p, kind, card, onUpdate = () => rerenderActions(p, card)) {
    const st = pending.get(p.id) ?? { inflight: false };
    st.want = kind; pending.set(p.id, st);
    // Optimistic UI
    const had = p.viewer.reaction;
    p.viewer.reaction = kind;
    if (p.counts.likes != null) p.counts.likes += (kind ? 1 : 0) - (had ? 1 : 0);
    onUpdate();
    if (st.inflight) return;
    while (st.want !== st.sent) {
      st.inflight = true; st.sent = st.want;
      try {
        const r = st.sent ? await api.post(`/api/posts/${p.id}/react`, { kind: st.sent }) : await api.del(`/api/posts/${p.id}/react`);
        if (st.want === st.sent && p.counts.likes != null) { p.counts.likes = r.likes; onUpdate(); }
      } catch (err) {
        p.viewer.reaction = had; onUpdate(); SX.fail(err, "Couldn’t react");
        st.want = st.sent = had; break;
      } finally { st.inflight = false; }
    }
    pending.delete(p.id);
  }
  function rerenderActions(p, card) {
    for (const c of card ? [card] : BF.$$(`[data-post="${p.id}"]`)) {
      c.querySelector(".s-actions")?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: SX.actionsHtml(p) }).firstElementChild);
      const ll = c.querySelector(".s-likes");
      const html = likeLine(p);
      if (ll) ll.outerHTML = html || "<span></span>"; else if (html) c.querySelector(".s-post-foot")?.insertAdjacentHTML("afterbegin", html);
    }
  }
  function pickReaction(p, card, anchor, onUpdate) {
    BF.$$(".s-react-pop").forEach((e) => e.remove());
    const pop = document.createElement("div");
    pop.className = "s-react-pop"; pop.setAttribute("role", "menu"); pop.setAttribute("aria-label", "Reactions");
    pop.innerHTML = REACTIONS.map(([k, e, l]) => `<button role="menuitem" data-k="${k}" aria-label="${l}" title="${l}" class="${p.viewer.reaction === k ? "on" : ""}">${e}</button>`).join("");
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left - 10)) + "px";
    pop.style.top = Math.max(8, r.top + scrollY - pop.offsetHeight - 8) + "px";
    pop.querySelector("button").focus();
    const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("pointerdown", off, true); } };
    setTimeout(() => document.addEventListener("pointerdown", off, true));
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { pop.remove(); anchor.focus(); } });
    pop.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; pop.remove(); setReaction(p, p.viewer.reaction === b.dataset.k ? null : b.dataset.k, card, onUpdate); });
  }
  async function toggleSave(p, card, onUpdate = () => rerenderActions(p, card)) {
    const was = p.viewer.saved;
    p.viewer.saved = !was; onUpdate();
    try { was ? await api.del(`/api/posts/${p.id}/save`) : await api.post(`/api/posts/${p.id}/save`); if (!was) SX.toast({ kind: "info", title: "Saved", desc: "Find it in your profile under Saved.", action: { href: `#/social/u/${SX.state.me.username}?tab=saved`, label: "View" } }); }
    catch (err) { p.viewer.saved = was; onUpdate(); SX.fail(err); }
  }
  SX.setReaction = setReaction; SX.toggleSave = toggleSave; SX.pickReaction = (p, anchor, onUpdate) => pickReaction(p, null, anchor, onUpdate);
  function burst(card) {
    const media = card.querySelector(".s-post-media");
    if (!media || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const h = document.createElement("span"); h.className = "s-heart-burst"; h.innerHTML = I("heart-fill");
    media.appendChild(h); setTimeout(() => h.remove(), 800);
  }

  SX.postMenu = (p, card) => postMenu(p, card);
  function postMenu(p, card) {
    const me = SX.state.me;
    const own = p.author.id === me.id;
    const url = SX.absUrl(`#/social/p/${p.id}`);
    SX.menu("Post options", [
      { label: "Copy link", icon: "link", run: () => { SX.copy(url); api.post(`/api/posts/${p.id}/share`, { channel: "link" }).catch(() => {}); } },
      !own && { label: "Go to profile", icon: "user", run: () => (location.hash = `#/social/u/${p.author.username}`) },
      own && p.type !== "share" && { label: "Edit caption", icon: "edit", run: () => editPost(p, card) },
      own && { label: "Delete", icon: "trash", danger: true, run: async () => {
        if (!(await SX.confirm({ title: "Delete this post?", body: "It will be removed from your profile and feeds. This can’t be undone.", confirmLabel: "Delete", danger: true }))) return;
        try { await api.del(`/api/posts/${p.id}`); card.remove(); SX.toast({ title: "Post deleted" }); if (location.hash.includes(`/p/${p.id}`)) history.back(); } catch (err) { SX.fail(err); }
      } },
      !own && { label: "Not interested (hide)", icon: "eye-off", run: async () => {
        try { await api.post(`/api/posts/${p.id}/hide`); card.outerHTML = `<div class="s-hidden-note" data-hidden="${p.id}">${I("eye-off", "i-sm")} Post hidden. You’ll see fewer posts like this. <button class="s-link" data-unhide="${p.id}">Undo</button></div>`; } catch (err) { SX.fail(err); }
      } },
      !own && { label: `Mute @${p.author.username}`, icon: "volume-x", run: async () => { try { await api.post(`/api/users/${p.author.id}/mute`); SX.toast({ kind: "info", title: `Muted @${esc(p.author.username)}`, desc: "Their posts and stories won’t show in your feed." }); } catch (err) { SX.fail(err); } } },
      !own && { label: "Report", icon: "flag", danger: true, run: () => SX.report(p.type === "reel" ? "reel" : "post", p.id, p.type === "reel" ? "reel" : "post") },
    ]);
  }
  function editPost(p, card) {
    SX.sheet({
      title: "Edit post",
      body: `<form class="s-form" data-edit><label class="s-field"><span>Caption</span><textarea name="caption" rows="5" maxlength="2200">${esc(p.caption)}</textarea></label>
        ${p.media.map((m, i) => `<label class="s-field"><span>Alt text, item ${i + 1}</span><input name="alt${i}" maxlength="300" value="${esc(m.alt ?? "")}" placeholder="Describe this for people using screen readers"></label>`).join("")}
        <div class="s-form-actions"><button type="button" class="s-btn ghost" data-close>Cancel</button><button class="s-btn primary">Save</button></div></form>`,
      onMount: (bd, close) => bd.querySelector("[data-edit]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          const r = await api.patch(`/api/posts/${p.id}`, { caption: f.get("caption"), alts: p.media.map((_, i) => f.get(`alt${i}`)) });
          card.outerHTML = SX.postCard(r.post, { detail: location.hash.includes("/p/") });
          SX.lazy(document); close(); SX.toast({ title: "Post updated" });
        } catch (err) { SX.fail(err); }
      }),
    });
  }

  /* ---------- Likers ---------- */
  function likers(p) {
    SX.sheet({
      title: "Reactions", body: `<div class="s-user-list" data-list>${SX.skeletonRows(4)}</div>`,
      onMount: async (bd) => {
        try {
          const r = await api.get(`/api/posts/${p.id}/reactions`);
          bd.querySelector("[data-list]").innerHTML = r.hidden ? `<p class="muted">The author hid reaction counts.</p>` : r.items.map((x) => `<div class="s-user-row">${SX.avatar(x.user, "sm")}<div class="grow">${SX.name(x.user, { handle: true })}</div><span class="s-emoji">${EMOJI[x.kind] ?? "❤️"}</span></div>`).join("") || `<p class="muted">No reactions yet.</p>`;
        } catch (err) { bd.querySelector("[data-list]").innerHTML = SX.errorBox(err, false); }
      },
    });
  }

  /* ---------- Comments ---------- */
  function commentHtml(c, postId) {
    return `<div class="s-comment ${c.parent_id ? "reply" : ""} ${c.restricted ? "restricted" : ""}" data-comment="${c.id}">
      ${SX.avatar(c.author, "xs")}
      <div class="s-comment-body">
        <div>${SX.name(c.author)} <span class="s-comment-text">${c.status === "deleted" ? `<i class="muted">Comment deleted</i>` : SX.rich(c.body)}</span></div>
        <div class="s-comment-meta"><span>${SX.ago(c.created_at)}</span>${c.like_count ? `<span>${c.like_count} like${c.like_count === 1 ? "" : "s"}</span>` : ""}
          ${c.status === "deleted" ? "" : `<button data-c="reply" data-user="${esc(c.author.username)}" data-parent="${c.parent_id ?? c.id}">Reply</button>`}
          ${c.can_delete && c.status !== "deleted" ? `<button data-c="delete">Delete</button>` : ""}
          ${c.author.id !== SX.state.me.id && c.status !== "deleted" ? `<button data-c="report">Report</button>` : ""}
          ${c.restricted ? `<span class="s-pill warn">Only visible to you and the author</span>` : ""}</div>
        ${!c.parent_id && c.reply_count ? `<button class="s-replies-btn" data-c="replies" data-post="${postId}">— View ${c.reply_count} ${c.reply_count === 1 ? "reply" : "replies"}</button><div class="s-replies" data-replies></div>` : `<div class="s-replies" data-replies></div>`}
      </div>
      ${c.status === "deleted" ? "" : `<button class="s-comment-like ${c.liked ? "on" : ""}" data-c="like" aria-pressed="${c.liked}" aria-label="Like comment">${I(c.liked ? "heart-fill" : "heart", "i-xs")}</button>`}
    </div>`;
  }
  SX.comments = (host, p, { autofocus = false } = {}) => {
    host.innerHTML = `<div class="s-comments">
      <div class="s-comment-list" data-clist aria-live="polite"></div>
      ${p.viewer.can_comment ? `<form class="s-comment-form" data-cform>
        <div class="s-replying" data-replying hidden></div>
        <div class="s-emoji-bar" aria-label="Quick emoji">${["❤️", "🔥", "👏", "😍", "😂", "🙌", "💯"].map((e) => `<button type="button" data-emoji="${e}" aria-label="Insert ${e}">${e}</button>`).join("")}</div>
        <div class="s-compose-row">${SX.avatar(SX.state.me, "xs", { link: false })}<label class="sr-only" for="c-${p.id}">Add a comment</label>
          <textarea id="c-${p.id}" name="body" rows="1" maxlength="1000" placeholder="Add a comment…" ${autofocus ? "autofocus" : ""}></textarea>
          <button class="s-btn sm primary" disabled>Post</button></div></form>` : `<p class="s-comments-off">${I("lock", "i-xs")} Comments are limited on this post.</p>`}
    </div>`;
    const list = host.querySelector("[data-clist]");
    const inf = SX.infinite({
      list, load: (c) => api.get(`/api/posts/${p.id}/comments${SX.qs({ cursor: c })}`), render: (items) => items.map((c) => commentHtml(c, p.id)).join(""),
      empty: `<p class="s-end">No comments yet. Start the conversation.</p>`,
    });
    inf.more();
    const form = host.querySelector("[data-cform]");
    let parent = null;
    if (form) {
      const ta = form.querySelector("textarea"), btn = form.querySelector("button.primary");
      const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; btn.disabled = !ta.value.trim(); };
      ta.addEventListener("input", fit);
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener("click", (e) => { const em = e.target.closest("[data-emoji]"); if (em) { ta.setRangeText(em.dataset.emoji, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); fit(); } if (e.target.closest("[data-cancel-reply]")) { parent = null; form.querySelector("[data-replying]").hidden = true; } });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = ta.value.trim(); if (!body) return;
        btn.disabled = true;
        try {
          const r = await api.post(`/api/posts/${p.id}/comments`, { body, parent_id: parent });
          const html = commentHtml(r.comment, p.id);
          if (parent) {
            const pr = list.querySelector(`[data-comment="${parent}"] [data-replies]`);
            (pr ?? list).insertAdjacentHTML("beforeend", html);
          } else list.insertAdjacentHTML("afterbegin", html);
          list.querySelector(".s-end")?.remove(); host.parentElement?.querySelector(".s-end")?.remove();
          ta.value = ""; fit(); parent = null; form.querySelector("[data-replying]").hidden = true;
          if (!r.comment.restricted) { p.counts.comments++; rerenderActions(p); }
        } catch (err) { SX.fail(err, "Couldn’t post comment"); btn.disabled = false; }
      });
    }
    host.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-c]"); if (!b) return;
      const row = b.closest("[data-comment]");
      const cid = row?.dataset.comment;
      if (b.dataset.c === "reply" && form) {
        parent = b.dataset.parent;
        const ta = form.querySelector("textarea");
        const rp = form.querySelector("[data-replying]");
        rp.hidden = false; rp.innerHTML = `Replying to @${esc(b.dataset.user)} <button type="button" class="s-link" data-cancel-reply>Cancel</button>`;
        if (!ta.value.startsWith(`@${b.dataset.user}`)) ta.value = `@${b.dataset.user} ${ta.value}`;
        ta.focus(); ta.dispatchEvent(new Event("input"));
      }
      if (b.dataset.c === "like") {
        const on = b.classList.toggle("on");
        b.innerHTML = I(on ? "heart-fill" : "heart", "i-xs"); b.setAttribute("aria-pressed", on);
        try { on ? await api.post(`/api/comments/${cid}/react`) : await api.del(`/api/comments/${cid}/react`); } catch (err) { SX.fail(err); }
      }
      if (b.dataset.c === "delete") {
        if (!(await SX.confirm({ title: "Delete comment?", body: "This can’t be undone.", confirmLabel: "Delete", danger: true }))) return;
        try { await api.del(`/api/comments/${cid}`); row.querySelector(".s-comment-text").innerHTML = `<i class="muted">Comment deleted</i>`; b.remove(); p.counts.comments = Math.max(0, p.counts.comments - 1); rerenderActions(p); } catch (err) { SX.fail(err); }
      }
      if (b.dataset.c === "report") SX.report("comment", cid, "comment");
      if (b.dataset.c === "replies") {
        b.disabled = true;
        try {
          const r = await api.get(`/api/posts/${p.id}/comments?parent_id=${cid}`);
          row.querySelector("[data-replies]").innerHTML = r.items.map((c) => commentHtml(c, p.id)).join("");
          b.remove();
        } catch (err) { SX.fail(err); b.disabled = false; }
      }
    });
    return () => inf.destroy();
  };
  SX.openComments = (p) => {
    let done = null;
    SX.sheet({ title: `Comments${p.counts.comments ? ` · ${SX.count(p.counts.comments)}` : ""}`, body: `<div data-comments-host></div>`, onMount: (bd) => { done = SX.comments(bd.querySelector("[data-comments-host]"), p, { autofocus: true }); bd.addEventListener("remove", () => done?.()); } });
  };

  /* ---------- Share ---------- */
  SX.share = (p) => {
    const url = SX.absUrl(p.type === "reel" ? `#/social/reels/${p.id}` : `#/social/p/${p.id}`);
    SX.sheet({
      title: "Share",
      body: `<div class="s-share">
        <div class="s-share-quick">
          <button class="s-share-btn" data-s="copy">${I("link")}<span>Copy link</span></button>
          ${navigator.share ? `<button class="s-share-btn" data-s="native">${I("share")}<span>Share via…</span></button>` : ""}
          ${p.author.id !== SX.state.me.id || p.type !== "share" ? `<button class="s-share-btn" data-s="repost">${I("repost")}<span>Repost</span></button>` : ""}
        </div>
        <h3 class="s-h6">Send in a message</h3>
        <input class="s-input" data-s-search placeholder="Search people" aria-label="Search people to send to">
        <div class="s-user-list" data-s-list>${SX.skeletonRows(3)}</div></div>`,
      onMount: async (bd, close) => {
        const listEl = bd.querySelector("[data-s-list]");
        const row = (u, conv) => `<div class="s-user-row">${SX.avatar(u, "sm", { link: false })}<div class="grow">${SX.name(u, { link: false, handle: true })}</div><button class="s-btn sm" data-send-user="${u.id}" ${conv ? `data-conv="${conv}"` : ""}>Send</button></div>`;
        const recent = async () => {
          try {
            const r = await api.get("/api/conversations");
            listEl.innerHTML = r.items.slice(0, 8).map((c) => { const o = c.members.find((m) => m.id !== SX.state.me.id); return o ? row(o, c.id) : ""; }).join("") || `<p class="muted">Search for someone to send this to.</p>`;
          } catch { listEl.innerHTML = ""; }
        };
        recent();
        let t;
        bd.querySelector("[data-s-search]").addEventListener("input", (e) => {
          clearTimeout(t);
          const q = e.target.value.trim();
          t = setTimeout(async () => {
            if (!q) return recent();
            try { const r = await api.get(`/api/search/suggest?q=${encodeURIComponent(q)}`); listEl.innerHTML = r.users.map((u) => row(u)).join("") || `<p class="muted">No people found.</p>`; } catch { /* keep list */ }
          }, 250);
        });
        bd.addEventListener("click", async (e) => {
          const s = e.target.closest("[data-s]")?.dataset.s;
          if (s === "copy") { SX.copy(url); api.post(`/api/posts/${p.id}/share`, { channel: "link" }).catch(() => {}); close(); }
          if (s === "native") { try { await navigator.share({ title: "TUNIBEAT Social", text: p.caption.slice(0, 100), url }); api.post(`/api/posts/${p.id}/share`, { channel: "link" }).catch(() => {}); close(); } catch { /* cancelled */ } }
          if (s === "repost") { close(); repost(p); }
          const send = e.target.closest("[data-send-user]");
          if (send) {
            send.disabled = true; send.textContent = "Sending…";
            try {
              let conv = send.dataset.conv;
              if (!conv) conv = (await api.post("/api/conversations", { user_ids: [send.dataset.sendUser] })).conversation.id;
              await api.post(`/api/conversations/${conv}/messages`, { kind: "post_share", ref: { post_id: p.shared_post?.id ?? p.id }, body: "", client_id: SX.ikey() });
              send.textContent = "Sent"; send.classList.add("done");
            } catch (err) { SX.fail(err, "Couldn’t send"); send.disabled = false; send.textContent = "Send"; }
          }
        });
      },
    });
  };
  function repost(p) {
    SX.sheet({
      title: "Repost", body: `<form class="s-form" data-rp><label class="s-field"><span>Add a thought (optional)</span><textarea name="caption" rows="3" maxlength="2200"></textarea></label>
        <div class="s-embed">${esc(p.author.display_name)}: ${esc((p.caption || "").slice(0, 120))}</div>
        <div class="s-form-actions"><button type="button" class="s-btn ghost" data-close>Cancel</button><button class="s-btn primary">Repost</button></div></form>`,
      onMount: (bd, close) => bd.querySelector("[data-rp]").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await api.post("/api/posts", { shared_post_id: p.shared_post?.id ?? p.id, caption: new FormData(e.target).get("caption"), idempotency_key: SX.ikey() }); close(); SX.toast({ title: "Reposted to your profile" }); }
        catch (err) { SX.fail(err); }
      }),
    });
  }

  /* ---------- Page binding: interactions, carousels, autoplay, view tracking ---------- */
  SX.bindPosts = (root) => {
    const seen = new Set();
    let pressTimer = null, pressed = false;
    const onClick = async (e) => {
      const unhide = e.target.closest("[data-unhide]");
      if (unhide) { await api.del(`/api/posts/${unhide.dataset.unhide}/hide`).catch(() => {}); const p = cache.get(unhide.dataset.unhide); unhide.closest("[data-hidden]").outerHTML = SX.postCard(p); SX.lazy(root); return; }
      const b = e.target.closest("[data-act]"); if (!b) return;
      const card = b.closest("[data-post]"); if (!card) return;
      const p = cache.get(card.dataset.post); if (!p) return;
      const a = b.dataset.act;
      if (a === "like") { if (pressed) { pressed = false; return; } setReaction(p, p.viewer.reaction ? null : "like", card); if (!p.viewer.reaction) return; burst(card); }
      if (a === "comment") { if (location.hash.includes(`/p/${p.id}`)) root.querySelector("[data-comments-host] textarea")?.focus(); else SX.openComments(p); }
      if (a === "share") SX.share(p);
      if (a === "save") toggleSave(p, card);
      if (a === "more") postMenu(p, card);
      if (a === "likers") likers(p);
      if (a === "gift") SX.openGifts?.({ recipient: p.author, contextType: "post", contextId: p.id });
      if (a === "tip") SX.openTip?.({ recipient: p.author, contextType: "post", contextId: p.id });
      if (a === "expand") { card.querySelector("[data-caption]")?.classList.remove("clamp"); b.remove(); }
      if (a === "sound") {
        const v = b.parentElement.querySelector("video");
        v.muted = !v.muted; b.innerHTML = I(v.muted ? "volume-x" : "volume", "i-sm"); b.setAttribute("aria-label", v.muted ? "Turn sound on" : "Turn sound off");
      }
      if (a === "car-prev" || a === "car-next") {
        const tr = card.querySelector("[data-track]");
        tr.scrollBy({ left: (a === "car-next" ? 1 : -1) * tr.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    };
    // Long-press or right-click on like opens the reaction picker
    const down = (e) => { const b = e.target.closest('[data-act="like"]'); if (!b) return; pressTimer = setTimeout(() => { pressed = true; const card = b.closest("[data-post]"); pickReaction(cache.get(card.dataset.post), card, b); }, 450); };
    const up = () => clearTimeout(pressTimer);
    const ctx = (e) => { const b = e.target.closest('[data-act="like"]'); if (!b) return; e.preventDefault(); const card = b.closest("[data-post]"); pickReaction(cache.get(card.dataset.post), card, b); };
    const dbl = (e) => { const m = e.target.closest("[data-dbl]"); if (!m) return; const card = m.closest("[data-post]"); const p = cache.get(card.dataset.post); burst(card); if (!p.viewer.reaction) setReaction(p, "like", card); };
    const scroll = (e) => {
      const tr = e.target.closest?.("[data-track]"); if (!tr) return;
      const i = Math.round(tr.scrollLeft / tr.clientWidth), n = tr.children.length;
      const box = tr.parentElement;
      box.querySelector("[data-count]").textContent = `${i + 1}/${n}`;
      box.querySelectorAll(".s-dots i").forEach((d, j) => d.classList.toggle("on", j === i));
      box.querySelector(".prev").hidden = i === 0; box.querySelector(".next").hidden = i === n - 1;
    };
    root.addEventListener("click", onClick);
    root.addEventListener("pointerdown", down); root.addEventListener("pointerup", up); root.addEventListener("pointerleave", up, true);
    root.addEventListener("contextmenu", ctx); root.addEventListener("dblclick", dbl);
    root.addEventListener("scroll", scroll, true);
    root.addEventListener("keydown", (e) => { const tr = e.target.closest?.("[data-track]"); if (tr && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); tr.scrollBy({ left: (e.key === "ArrowRight" ? 1 : -1) * tr.clientWidth }); } });

    // Autoplay the most visible feed video (muted) and count a view after 1s on screen
    const timers = new Map();
    const vio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const el = e.target;
        if (el.tagName === "VIDEO") {
          if (e.intersectionRatio > 0.6) { if (el.dataset.src) { el.src = el.dataset.src; delete el.dataset.src; } el.play().catch(() => {}); }
          else if (!el.paused) el.pause();
          continue;
        }
        const id = el.dataset.post;
        if (e.isIntersecting && e.intersectionRatio > 0.5 && !seen.has(id)) {
          timers.set(id, setTimeout(() => { seen.add(id); api.post(`/api/posts/${id}/view`, {}).catch(() => {}); }, 1000));
        } else clearTimeout(timers.get(id));
      }
    }, { threshold: [0, 0.5, 0.6, 0.9] });
    const observe = () => { BF.$$("[data-post]:not([data-obs])", root).forEach((c) => { c.dataset.obs = "1"; vio.observe(c); c.querySelectorAll("video[data-autoplay]").forEach((v) => vio.observe(v)); }); };
    const mo = new MutationObserver(observe);
    mo.observe(root, { childList: true, subtree: true });
    observe();
    return () => { vio.disconnect(); mo.disconnect(); timers.forEach(clearTimeout); root.removeEventListener("scroll", scroll, true); BF.$$(".s-react-pop").forEach((e) => e.remove()); };
  };

  /* ---------- Right rail (desktop) ---------- */
  SX.fillRight = async (el) => {
    const host = el.closest(".s-app")?.querySelector("[data-right]");
    if (!host) return;
    try {
      const [sug, live, ex] = await Promise.all([api.get("/api/suggestions/creators?limit=5"), api.get("/api/live?status=live"), api.get("/api/explore")]);
      const me = SX.state.me;
      host.innerHTML = `
        <div class="s-me-card">${SX.avatar(me, "md")}<div>${SX.name(me)}<div class="s-handle">@${esc(me.username)}</div></div>
          <a class="s-wallet-chip" href="#/social/wallet" aria-label="Wallet: ${me.credits} credits">${I("coin", "i-xs")} <span data-credits>${SX.count(me.credits)}</span></a></div>
        ${live.items.filter((l) => l.status === "live").length ? `<section class="s-side"><h2 class="s-side-h"><span class="s-live-dot"></span> Live now</h2>${live.items.filter((l) => l.status === "live").slice(0, 4).map((l) => `<a class="s-side-live" href="#/social/live/${l.id}">${SX.avatar(l.host, "sm", { link: false, live: true })}<div class="grow"><b>${esc(l.host.display_name)}</b><span>${esc(l.title)}</span></div><span class="s-count">${I("eye", "i-xs")} ${SX.count(l.viewers)}</span></a>`).join("")}</section>` : ""}
        <section class="s-side"><h2 class="s-side-h">Suggested creators <a href="#/social/explore">See all</a></h2>
          ${sug.items.map((u) => `<div class="s-user-row">${SX.avatar(u, "sm")}<div class="grow">${SX.name(u)}<div class="s-handle">${u.mutual ? `${u.mutual} mutual` : `${SX.count(u.followers)} followers`}</div></div>${SX.followBtn(u, "none", "sm")}</div>`).join("") || `<p class="muted">You follow everyone we’d suggest.</p>`}</section>
        <section class="s-side"><h2 class="s-side-h">Trending</h2><div class="s-chips">${ex.trending_tags.slice(0, 8).map((t) => `<a class="s-chip" href="#/social/tag/${encodeURIComponent(t.tag)}">#${esc(t.tag)}</a>`).join("")}</div></section>
        <p class="s-legal"><a href="#/legal/terms">Terms</a> · <a href="#/legal/privacy">Privacy</a> · <a href="#/about">About</a> · © 2026 ${esc(BF.brand.legalEntity)}</p>`;
      SX.bindFollow(host);
    } catch { host.innerHTML = ""; }
  };

  /* ---------- Follow button ---------- */
  SX.followBtn = (u, state, size = "") => {
    if (u.id === SX.state.me?.id) return "";
    const label = state === "active" ? "Following" : state === "pending" ? "Requested" : u.relationship?.followed_by ? "Follow back" : "Follow";
    return `<button class="s-btn ${size} ${state === "none" || !state ? "primary" : ""}" data-follow="${u.id}" data-state="${state || "none"}" data-private="${u.is_private ? 1 : 0}" aria-pressed="${state === "active"}">${label}</button>`;
  };
  SX.bindFollow = (root, onChange) => {
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-follow]"); if (!b) return;
      const st = b.dataset.state;
      if (st === "active" && !(await SX.confirm({ title: "Unfollow?", body: "Their posts will stop appearing in your Following feed.", confirmLabel: "Unfollow" }))) return;
      b.disabled = true;
      try {
        const r = st === "none" ? await api.post(`/api/users/${b.dataset.follow}/follow`) : await api.del(`/api/users/${b.dataset.follow}/follow`);
        BF.$$(`[data-follow="${b.dataset.follow}"]`).forEach((x) => {
          x.dataset.state = r.following; x.setAttribute("aria-pressed", r.following === "active");
          x.textContent = r.following === "active" ? "Following" : r.following === "pending" ? "Requested" : "Follow";
          x.classList.toggle("primary", r.following === "none");
        });
        onChange?.(r);
      } catch (err) { SX.fail(err); }
      finally { b.disabled = false; }
    });
  };

  /* ---------- Home ---------- */
  const TABS = [["for_you", "For You"], ["following", "Following"], ["latest", "Latest"], ["trending", "Trending"]];
  SX.route("/social", {
    title: "Home", active: "home", right: `<div class="s-side">${SX.skeletonRows(4)}</div>`,
    render: (p, q) => `<div class="s-home">
      <div class="s-stories" data-stories aria-label="Stories">${Array.from({ length: 6 }, () => `<span class="skeleton s-story-sk"></span>`).join("")}</div>
      <a class="s-composer-entry" href="#/social/create">${SX.state.me ? SX.avatar(SX.state.me, "sm", { link: false }) : ""}<span>Share something from your studio…</span>${I("image", "i-sm")}${I("reels", "i-sm")}</a>
      <div class="s-tabs" role="tablist" aria-label="Feed">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${(q.tab ?? "for_you") === k}">${l}</button>`).join("")}</div>
      <div data-live-strip></div>
      <div class="s-feed" data-feed>${SX.skeletonPosts(3)}</div></div>`,
    async mount(el, p, q) {
      let tab = TABS.some(([k]) => k === q.tab) ? q.tab : "for_you";
      const feed = el.querySelector("[data-feed]");
      const unbind = SX.bindPosts(el);
      SX.renderStoryTray?.(el.querySelector("[data-stories]"));
      SX.fillRight(el);
      el.closest(".s-app").querySelector(".s-top .s-brand")?.setAttribute("href", "#/social");
      let inf = null;
      const start = () => {
        inf?.destroy();
        feed.innerHTML = "";
        el.querySelector("[data-live-strip]").innerHTML = "";
        inf = SX.infinite({
          list: feed,
          load: async (c) => {
            const r = await api.get(`/api/feed${SX.qs({ tab, cursor: c })}`);
            if (!c && r.live?.length) el.querySelector("[data-live-strip]").innerHTML = `<div class="s-live-strip" aria-label="Live now">${r.live.map((l) => `<a class="s-live-card" href="#/social/live/${l.id}">${SX.avatar(l.host, "md", { link: false, live: l.status === "live" })}<span><b>${esc(l.host.display_name)}</b><small>${esc(l.title)}</small></span></a>`).join("")}</div>`;
            return r;
          },
          render: (items) => items.map((x) => SX.postCard(x)).join(""),
          empty: SX.empty(tab === "following"
            ? { icon: "users", title: "Your Following feed is quiet", body: "Follow creators to see their posts here, newest first.", actions: `<a class="s-btn primary" href="#/social/explore">Find people to follow</a>` }
            : { icon: "compass", title: "Nothing here yet", body: "Check back soon, or be the first to post.", actions: `<a class="s-btn primary" href="#/social/create">Create a post</a>` }),
        });
        inf.more();
      };
      start();
      el.querySelector(".s-tabs").addEventListener("click", (e) => {
        const b = e.target.closest("[data-tab]"); if (!b || b.dataset.tab === tab) return;
        tab = b.dataset.tab;
        el.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
        BF.setQuery({ tab: tab === "for_you" ? "" : tab });
        start();
      });
      const ptr = SX.pullToRefresh(el, async () => { start(); SX.renderStoryTray?.(el.querySelector("[data-stories]")); });
      const offStory = SX.ws.on("_open", () => {});
      return () => { inf?.destroy(); unbind(); ptr(); offStory(); };
    },
  });

  /* ---------- Post detail ---------- */
  SX.route("/social/p/:id", {
    title: "Post", active: "home",
    async mount(el, p) {
      const r = await api.get(`/api/posts/${p.id}`);
      el.innerHTML = `<div class="s-detail"><button class="s-back" data-back>${I("arrow-left", "i-sm")} Back</button>${SX.postCard(r.post, { detail: true })}<section class="s-card s-detail-comments" aria-label="Comments"><h2 class="s-h6">Comments</h2><div data-comments-host></div></section></div>`;
      el.querySelector("[data-back]").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/social"));
      SX.lazy(el);
      const unbind = SX.bindPosts(el);
      const unc = SX.comments(el.querySelector("[data-comments-host]"), SX.postCache.get(r.post.id));
      document.title = `${r.post.author.display_name}: “${(r.post.caption || r.post.type).slice(0, 50)}” — TUNIBEAT Social`;
      return () => { unbind(); unc(); };
    },
  });

  /* ---------- Hashtag ---------- */
  SX.route("/social/tag/:tag", {
    title: (p) => `#${p.tag}`, active: "explore",
    render: (p) => `<header class="s-page-head"><span class="s-tag-ic">${I("hash")}</span><div><h1 class="s-h2">#${esc(p.tag)}</h1><p class="muted" data-count>&nbsp;</p></div></header>
      <div class="s-tabs" role="tablist"><button role="tab" data-sort="top" aria-selected="true">Top</button><button role="tab" data-sort="recent" aria-selected="false">Recent</button></div>
      <div class="s-grid" data-grid></div>`,
    async mount(el, p) {
      let sort = "top", inf;
      const grid = el.querySelector("[data-grid]");
      const start = () => {
        inf?.destroy(); grid.innerHTML = "";
        inf = SX.infinite({
          list: grid,
          load: async (c) => { const r = await api.get(`/api/hashtags/${encodeURIComponent(p.tag)}${SX.qs({ sort, cursor: c })}`); el.querySelector("[data-count]").textContent = `${SX.count(r.post_count)} post${r.post_count === 1 ? "" : "s"}`; return r; },
          render: (items) => items.map(SX.gridCell).join(""),
          empty: SX.empty({ icon: "hash", title: `No posts with #${esc(p.tag)} yet`, body: "Use this hashtag in a post to start the collection.", actions: `<a class="s-btn primary" href="#/social/create">Create a post</a>` }),
        });
        inf.more();
      };
      start();
      el.querySelector(".s-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-sort]"); if (!b) return; sort = b.dataset.sort; el.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-selected", x === b)); start(); });
      return () => inf?.destroy();
    },
  });
})();
