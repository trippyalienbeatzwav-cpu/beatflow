/* ==========================================================================
   TUNIBEAT Social — Messages (DMs, groups, requests)
   Real-time over the user socket. Sends are optimistic with a client_id, so a retry
   never duplicates. Typing, read receipts and presence respect activity-status settings.
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const QUICK = [["love", "❤️"], ["laugh", "😂"], ["wow", "😮"], ["sad", "😢"], ["fire", "🔥"], ["clap", "👏"]];
  const EMO = Object.fromEntries(QUICK.concat([["like", "👍"]]));
  const FILE_TYPES = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/pdf,text/plain,application/zip";

  SX.refreshUnread = async () => { try { const r = await api.get("/api/me"); if (r.user) { SX.state.unread = r.user.unread; SX.updateBadges(); } } catch { /* ignore */ } };

  const other = (c) => c.members.filter((m) => m.id !== SX.state.me.id);
  const convTitle = (c) => c.title || other(c).map((m) => m.display_name).join(", ") || "Just you";
  function convAvatar(c) {
    const o = other(c);
    if (c.kind === "group") return `<span class="s-av-stack">${o.slice(0, 2).map((m) => SX.avatar(m, "sm", { link: false })).join("")}</span>`;
    return `<span class="s-av-wrap">${SX.avatar(o[0], "md", { link: false })}${o[0]?.online ? `<i class="s-online" title="Active now"></i>` : ""}</span>`;
  }
  function convRow(c, activeId) {
    const lm = c.last_message;
    const mine = lm?.sender_id === SX.state.me.id;
    const preview = !lm ? "Say hi 👋" : lm.deleted ? "Message unsent" : lm.kind === "text" || lm.kind === "story_reply" ? esc(lm.body) : { image: "📷 Photo", video: "🎬 Video", voice: "🎙️ Voice message", file: "📎 File", post_share: "↗ Shared a post", system: esc(lm.body) }[lm.kind] ?? esc(lm.body);
    return `<a class="s-conv ${c.unread ? "unread" : ""} ${c.id === activeId ? "active" : ""}" href="#/social/messages/${c.id}" data-conv="${c.id}" ${c.id === activeId ? 'aria-current="page"' : ""}>
      ${convAvatar(c)}<div class="grow"><div class="s-conv-top"><b>${esc(convTitle(c))}</b>${c.muted ? I("volume-x", "i-xs") : ""}<time>${lm ? SX.ago(lm.created_at) : ""}</time></div>
      <div class="s-conv-prev">${mine ? "You: " : ""}${preview}</div></div>${c.unread ? `<i class="s-unread-dot" aria-label="Unread"></i>` : ""}</a>`;
  }

  function inboxHtml() {
    return `<aside class="s-inbox" data-inbox>
      <header class="s-inbox-head"><h1 class="s-h4">Messages</h1><button class="s-icon-btn" data-new aria-label="New message">${I("edit")}</button></header>
      <label class="s-search-field"><span class="sr-only">Search messages</span>${I("search", "i-sm")}<input data-msearch placeholder="Search messages" autocomplete="off"></label>
      <div class="s-tabs sm" role="tablist"><button role="tab" data-folder="inbox" aria-selected="true">Primary</button><button role="tab" data-folder="requests" aria-selected="false">Requests <span class="s-badge inline" data-req-count hidden></span></button></div>
      <nav class="s-conv-list" data-convs aria-label="Conversations">${SX.skeletonRows(5)}</nav></aside>`;
  }

  function bindInbox(root, activeId) {
    let folder = "inbox";
    const list = root.querySelector("[data-convs]");
    const draw = async () => {
      try {
        const r = await api.get(`/api/conversations${folder === "requests" ? "?folder=requests" : ""}`);
        list.innerHTML = r.items.map((c) => convRow(c, activeId)).join("") || `<div class="s-inbox-empty">${folder === "requests" ? "No message requests. Messages from people you don’t follow land here." : "No conversations yet."}</div>`;
        const rc = root.querySelector("[data-req-count]");
        rc.hidden = !SX.state.unread.message_requests; rc.textContent = SX.state.unread.message_requests;
      } catch (err) { list.innerHTML = SX.errorBox(err); list.querySelector("[data-retry]")?.addEventListener("click", draw); }
    };
    draw();
    root.querySelector(".s-tabs").addEventListener("click", (e) => { const t = e.target.closest("[data-folder]"); if (!t) return; folder = t.dataset.folder; root.querySelectorAll("[data-folder]").forEach((x) => x.setAttribute("aria-selected", x === t)); draw(); });
    root.querySelector("[data-new]").addEventListener("click", newMessage);
    let st;
    root.querySelector("[data-msearch]").addEventListener("input", (e) => {
      clearTimeout(st);
      const q = e.target.value.trim();
      st = setTimeout(async () => {
        if (q.length < 2) return draw();
        try {
          const r = await api.get(`/api/messages/search?q=${encodeURIComponent(q)}`);
          list.innerHTML = r.items.map((m) => `<a class="s-conv" href="#/social/messages/${m.conversation_id}?m=${m.id}">${SX.avatar(m.sender, "sm", { link: false })}<div class="grow"><div class="s-conv-top"><b>${esc(m.sender.display_name)}</b><time>${SX.ago(m.created_at)}</time></div><div class="s-conv-prev">${esc(m.body).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), (x) => `<mark>${x}</mark>`)}</div></div></a>`).join("") || `<div class="s-inbox-empty">No messages match “${esc(q)}”.</div>`;
        } catch { /* keep list */ }
      }, 250);
    });
    const offs = [
      SX.ws.on("message", () => draw()), SX.ws.on("read", () => {}),
      SX.ws.on("presence", (m) => root.querySelectorAll(`[data-conv]`).forEach(() => {})),
    ];
    return { draw, destroy: () => offs.forEach((f) => f()) };
  }

  function newMessage() {
    const picked = new Map();
    SX.sheet({
      title: "New message",
      body: `<div class="s-newmsg"><div class="s-chips" data-picked></div><input class="s-input" data-q placeholder="Search people" aria-label="Search people" autofocus>
        <div class="s-user-list" data-results></div>
        <label class="s-field" data-group hidden><span>Group name (optional)</span><input class="s-input" data-title maxlength="60"></label>
        <div class="s-form-actions"><button class="s-btn primary" data-start disabled>Chat</button></div></div>`,
      onMount: (bd, close) => {
        const draw = () => {
          bd.querySelector("[data-picked]").innerHTML = [...picked.values()].map((u) => `<span class="s-chip">${esc(u.display_name)} <button data-unpick="${u.id}" aria-label="Remove ${esc(u.display_name)}">${I("x", "i-xs")}</button></span>`).join("");
          bd.querySelector("[data-group]").hidden = picked.size < 2;
          bd.querySelector("[data-start]").disabled = !picked.size;
          bd.querySelector("[data-start]").textContent = picked.size > 1 ? "Create group" : "Chat";
        };
        let t;
        bd.querySelector("[data-q]").addEventListener("input", (e) => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const q = e.target.value.trim(); if (!q) { bd.querySelector("[data-results]").innerHTML = ""; return; }
            const r = await api.get(`/api/search/suggest?q=${encodeURIComponent(q)}`).catch(() => ({ users: [] }));
            bd.querySelector("[data-results]").innerHTML = r.users.filter((u) => u.id !== SX.state.me.id).map((u) => `<button class="s-user-row btn" data-pick='${esc(JSON.stringify(u))}'>${SX.avatar(u, "sm", { link: false })}<div class="grow">${SX.name(u, { link: false, handle: true })}</div>${picked.has(u.id) ? I("check", "i-sm") : ""}</button>`).join("") || `<p class="muted">No people found.</p>`;
          }, 200);
        });
        bd.addEventListener("click", async (e) => {
          const p = e.target.closest("[data-pick]"); if (p) { const u = JSON.parse(p.dataset.pick); picked.has(u.id) ? picked.delete(u.id) : picked.set(u.id, u); draw(); }
          const u = e.target.closest("[data-unpick]"); if (u) { picked.delete(u.dataset.unpick); draw(); }
          if (e.target.closest("[data-start]")) {
            try {
              const r = await api.post("/api/conversations", { user_ids: [...picked.keys()], title: picked.size > 1 ? bd.querySelector("[data-title]").value || undefined : undefined });
              close(); location.hash = `#/social/messages/${r.conversation.id}`;
            } catch (err) { SX.fail(err, "Can’t start that conversation"); }
          }
        });
      },
    });
  }

  /* ---------- Inbox route ---------- */
  SX.route("/social/messages", {
    title: "Messages", active: "messages", wide: true,
    render: () => `<div class="s-dm">${inboxHtml()}<section class="s-thread empty"><div class="s-thread-empty">${I("send")}<h2 class="s-h4">Your messages</h2><p class="muted">Send private messages, photos, voice notes and posts to friends and groups.</p><button class="s-btn primary" data-new2>Send a message</button></div></section></div>`,
    mount(el) {
      const ib = bindInbox(el, null);
      el.querySelector("[data-new2]").onclick = newMessage;
      SX.refreshUnread();
      return () => ib.destroy();
    },
  });

  /* ---------- Conversation ---------- */
  SX.route("/social/messages/:id", {
    title: "Messages", active: "messages", wide: true,
    render: (p) => `<div class="s-dm open">${inboxHtml()}<section class="s-thread" data-thread>${SX.skeletonRows(6)}</section></div>`,
    async mount(el, p, q) {
      const ib = bindInbox(el, p.id);
      const box = el.querySelector("[data-thread]");
      const [cr, mr] = await Promise.all([api.get(`/api/conversations/${p.id}`), api.get(`/api/conversations/${p.id}/messages`)]);
      const c = cr.conversation;
      const me = SX.state.me;
      let msgs = mr.items, hasMore = mr.has_more, replyTo = null, editing = null;
      const pending = new Map();   // client_id → { payload }
      const others = other(c);
      const isDm = c.kind === "dm";
      box.innerHTML = `<header class="s-thread-head">
          <a class="s-icon-btn back" href="#/social/messages" aria-label="Back to inbox">${I("arrow-left")}</a>
          ${convAvatar(c)}<div class="grow"><b>${esc(convTitle(c))}</b><span class="s-presence" data-presence>${isDm ? "" : `${c.members.length} members`}</span></div>
          <button class="s-icon-btn" data-info aria-label="Conversation details">${I("info")}</button></header>
        ${c.state === "request" ? `<div class="s-request-bar"><p><b>${esc(convTitle(c))}</b> wants to send you a message. They won’t know you’ve seen it until you accept.</p><div class="s-row"><button class="s-btn primary" data-accept>Accept</button><button class="s-btn" data-decline>Delete</button>${isDm ? `<button class="s-btn ghost danger" data-block>Block</button>` : ""}</div></div>` : ""}
        ${c.blocked ? `<div class="s-request-bar muted">${I("ban", "i-sm")} You can’t message this account.</div>` : ""}
        <div class="s-msgs" data-msgs role="log" aria-live="polite" aria-label="Messages">${hasMore ? `<button class="s-btn sm ghost s-older" data-older>Load older messages</button>` : ""}<div data-list></div><div class="s-typing" data-typing hidden></div></div>
        <form class="s-msg-form" data-form ${c.blocked ? "hidden" : ""}>
          <div class="s-replying" data-replying hidden></div>
          <div class="s-attach-progress" data-att hidden></div>
          <div class="s-msg-row">
            <button type="button" class="s-icon-btn" data-attach aria-label="Attach photo, video or file">${I("paperclip")}</button><input type="file" data-file accept="${FILE_TYPES}" hidden>
            <button type="button" class="s-icon-btn" data-emoji-btn aria-label="Emoji">${I("smile")}</button>
            <label class="sr-only" for="msg-in">Message</label><textarea id="msg-in" rows="1" maxlength="4000" placeholder="Message…" autocomplete="off"></textarea>
            <button type="button" class="s-icon-btn" data-voice aria-label="Record voice message">${I("mic")}</button>
            <button class="s-icon-btn send" data-send aria-label="Send" hidden>${I("send")}</button>
          </div>
          <div class="s-emoji-panel" data-emoji-panel hidden>${"😀 😂 🥹 😍 🥰 😎 🤔 😮 😢 😡 👍 👏 🙌 🙏 💯 🔥 ❤️ 💜 🎧 🎹 🥁 🎤 🎶 🎛️".split(" ").map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</div>
        </form>`;
      const list = box.querySelector("[data-list]");
      const scroller = box.querySelector("[data-msgs]");
      const ta = box.querySelector("#msg-in");

      const dayKey = (t) => new Date(t).toDateString();
      function bubble(m, prev) {
        const mine = m.sender?.id === me.id;
        const grouped = prev && prev.sender?.id === m.sender?.id && m.created_at - prev.created_at < 5 * 60_000 && dayKey(prev.created_at) === dayKey(m.created_at);
        if (m.kind === "system") return `<div class="s-msg-system" data-mid="${m.id}">${esc(m.body)}</div>`;
        let content;
        if (m.deleted) content = `<span class="s-unsent">${I("ban", "i-xs")} Message unsent</span>`;
        else if (m.kind === "image") content = `<a href="${m.media.url}" target="_blank" rel="noopener" class="s-msg-media"><img src="${m.media.variants?.w480 ?? m.media.url}" alt="${esc(m.body || "Photo")}" loading="lazy"></a>${m.body ? `<p>${SX.rich(m.body)}</p>` : ""}`;
        else if (m.kind === "video") content = `<video class="s-msg-media" src="${m.media.url}" poster="${m.media.poster_url ?? ""}" controls preload="metadata" playsinline></video>`;
        else if (m.kind === "voice") content = `<div class="s-voice">${I("mic", "i-xs")}<audio src="${m.media.url}" controls preload="metadata" aria-label="Voice message"></audio></div>`;
        else if (m.kind === "file") content = `<a class="s-file" href="${m.media.url}" download>${I("file", "i-sm")}<span>${esc(m.body || "Attachment")}</span><small>${Math.ceil((m.media.bytes ?? 0) / 1024)} KB</small></a>`;
        else if (m.kind === "post_share") content = `${m.ref?.unavailable ? `<div class="s-embed unavailable">${I("eye-off", "i-xs")} Post unavailable</div>` : `<a class="s-msg-post" href="#/social/${m.ref.post.type === "reel" ? "reels" : "p"}/${m.ref.post.id}">${m.ref.post.media[0] ? `<img src="${m.ref.post.media[0].kind === "video" ? m.ref.post.media[0].poster_url : m.ref.post.media[0].variants?.w480 ?? m.ref.post.media[0].url}" alt="">` : ""}<div><b>${esc(m.ref.post.author.display_name)}</b><span>${esc(m.ref.post.caption.slice(0, 80))}</span></div></a>`}${m.body ? `<p>${SX.rich(m.body)}</p>` : ""}`;
        else if (m.kind === "story_reply") content = `<div class="s-story-ref">${m.ref?.unavailable ? `<span>${I("clock", "i-xs")} Story expired</span>` : `${m.ref?.preview_url ? `<img src="${m.ref.preview_url}" alt="">` : `<span class="s-story-txt">${esc(m.ref?.text ?? "")}</span>`}`}<small>${mine ? "You replied to their story" : "Replied to your story"}</small></div><p>${SX.rich(m.body)}</p>`;
        else content = `<p>${SX.rich(m.body)}</p>`;
        const reply = m.reply_to ? `<div class="s-msg-quote">${I("reply", "i-xs")} ${m.reply_to.deleted ? "Unsent message" : esc(m.reply_to.body || "Attachment")}</div>` : "";
        return `${!prev || dayKey(prev.created_at) !== dayKey(m.created_at) ? `<div class="s-day">${new Date(m.created_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>` : ""}
          <div class="s-msg ${mine ? "me" : "them"} ${grouped ? "grouped" : ""} ${m.pending ? "pending" : ""} ${m.failed ? "failed" : ""}" data-mid="${m.id}" ${m.client_id ? `data-cid="${m.client_id}"` : ""}>
            ${!mine && !grouped ? SX.avatar(m.sender, "xs") : `<span class="s-av-spacer"></span>`}
            <div class="s-msg-col">${!mine && !grouped && !isDm ? `<span class="s-msg-name">${esc(m.sender.display_name)}</span>` : ""}
              <div class="s-bubble" tabindex="0">${reply}${content}</div>
              ${m.reactions?.length ? `<div class="s-msg-reacts">${m.reactions.map((r) => `<button class="${r.mine ? "on" : ""}" data-react="${r.kind}" aria-label="${r.count} ${r.kind}">${EMO[r.kind] ?? "❤️"}${r.count > 1 ? r.count : ""}</button>`).join("")}</div>` : ""}
              <div class="s-msg-meta">${m.edited_at && !m.deleted ? "Edited · " : ""}${m.failed ? `<button class="s-link" data-resend="${m.client_id}">Failed · Retry</button>` : m.pending ? "Sending…" : `<time>${new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>`}</div>
            </div>
            ${m.deleted || m.pending ? "" : `<div class="s-msg-actions"><button data-mact="react" aria-label="React">${I("smile", "i-xs")}</button><button data-mact="reply" aria-label="Reply">${I("reply", "i-xs")}</button><button data-mact="more" aria-label="More">${I("more", "i-xs")}</button></div>`}
          </div>`;
      }
      function seenLabel() {
        const lastMine = [...msgs].reverse().find((m) => m.sender?.id === me.id && !m.pending);
        if (!lastMine) return "";
        const readers = c.members.filter((mm) => mm.id !== me.id && mm.last_read_id && mm.last_read_id >= lastMine.id);
        if (!readers.length) return "";
        return isDm ? "Seen" : `Seen by ${readers.map((r) => r.display_name).slice(0, 3).join(", ")}${readers.length > 3 ? ` +${readers.length - 3}` : ""}`;
      }
      function render(stick = true) {
        const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
        list.innerHTML = msgs.map((m, i) => bubble(m, msgs[i - 1])).join("") + `<div class="s-seen" data-seen>${seenLabel()}</div>`;
        if (stick || atBottom) scroller.scrollTop = scroller.scrollHeight;
      }
      render();
      if (q.m) { const hit = list.querySelector(`[data-mid="${q.m}"]`); hit?.scrollIntoView({ block: "center" }); hit?.classList.add("flash"); }

      const markRead = () => {
        const last = [...msgs].reverse().find((m) => !m.pending);
        if (last && c.state !== "request" && !document.hidden) api.post(`/api/conversations/${c.id}/read`, { message_id: last.id }).then(SX.refreshUnread).catch(() => {});
      };
      markRead();

      // Presence (DMs, respects activity status on both sides)
      const presence = async () => {
        if (!isDm || !others[0]) return;
        const r = await api.get(`/api/presence?ids=${others[0].id}`).catch(() => null);
        const on = r?.items?.[others[0].id];
        box.querySelector("[data-presence]").textContent = on === true ? "Active now" : on === false ? "Offline" : "";
      };
      presence();

      // Composer
      const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; const has = !!ta.value.trim(); box.querySelector("[data-send]").hidden = !has; box.querySelector("[data-voice]").hidden = has; };
      let typingSent = 0, typingStop;
      ta.addEventListener("input", () => {
        fit();
        if (Date.now() - typingSent > 2500) { SX.ws.send({ t: "typing", conversation_id: c.id, typing: true }); typingSent = Date.now(); }
        clearTimeout(typingStop); typingStop = setTimeout(() => { SX.ws.send({ t: "typing", conversation_id: c.id, typing: false }); typingSent = 0; }, 3500);
      });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); box.querySelector("[data-form]").requestSubmit(); }
        if (e.key === "Escape" && (replyTo || editing)) { replyTo = editing = null; box.querySelector("[data-replying]").hidden = true; ta.value = ""; fit(); }
        if (e.key === "ArrowUp" && !ta.value) { const last = [...msgs].reverse().find((m) => m.sender?.id === me.id && m.kind === "text" && !m.deleted && Date.now() - m.created_at < 15 * 60_000); if (last) startEdit(last); }
      });
      const setReplying = (html) => { const r = box.querySelector("[data-replying]"); r.hidden = !html; r.innerHTML = html ? `${html} <button type="button" class="s-link" data-cancel-reply>Cancel</button>` : ""; };
      function startEdit(m) { editing = m; replyTo = null; ta.value = m.body; fit(); ta.focus(); setReplying(`${I("edit", "i-xs")} Editing message`); }

      async function send(payload) {
        const cid = payload.client_id ?? SX.ikey();
        const temp = { id: `tmp_${cid}`, client_id: cid, sender: me, kind: payload.kind ?? "text", body: payload.body ?? "", created_at: Date.now(), pending: true, reactions: [], reply_to: replyTo ? { id: replyTo.id, body: replyTo.body, kind: replyTo.kind } : null, media: payload._media ?? null };
        pending.set(cid, { ...payload, client_id: cid });
        msgs = msgs.filter((m) => m.client_id !== cid).concat(temp);
        render(true);
        try {
          const { _media, ...body } = { ...payload, client_id: cid };
          const r = await api.post(`/api/conversations/${c.id}/messages`, body);
          pending.delete(cid);
          msgs = msgs.filter((m) => m.client_id !== cid && m.id !== r.message.id).concat(r.message).sort((a, b) => (a.id < b.id ? -1 : 1));
          if (c.state === "request") c.state = "active";
          render(true);
        } catch (err) {
          const t = msgs.find((m) => m.client_id === cid); if (t) { t.pending = false; t.failed = true; }
          render(); SX.fail(err, "Message not sent");
        }
      }
      box.querySelector("[data-form]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = ta.value.trim(); if (!body) return;
        if (editing) {
          const m = editing; editing = null; setReplying(null); ta.value = ""; fit();
          try { const r = await api.patch(`/api/messages/${m.id}`, { body }); Object.assign(msgs.find((x) => x.id === m.id), r.message); render(false); } catch (err) { SX.fail(err, "Couldn’t edit"); }
          return;
        }
        const payload = { kind: "text", body, reply_to_id: replyTo?.id };
        replyTo = null; setReplying(null); ta.value = ""; fit();
        SX.ws.send({ t: "typing", conversation_id: c.id, typing: false });
        send(payload);
      });

      // Attachments
      const fileIn = box.querySelector("[data-file]");
      box.querySelector("[data-attach]").onclick = () => fileIn.click();
      fileIn.onchange = async () => {
        const f = fileIn.files[0]; fileIn.value = ""; if (!f) return;
        const kind = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "file";
        await uploadAndSend(f, kind);
      };
      async function uploadAndSend(f, kind, extra = {}) {
        const att = box.querySelector("[data-att]");
        const ctrl = new AbortController();
        att.hidden = false; att.innerHTML = `<span>${esc(f.name || kind)}</span><progress max="1" value="0"></progress><button type="button" class="s-link" data-att-cancel>Cancel</button>`;
        att.querySelector("[data-att-cancel]").onclick = () => ctrl.abort();
        try {
          let file = f, meta = {}, poster, variants;
          if (kind === "image" && f.type !== "image/gif") { const img = await SX.processImage(f); file = img.file; if (img.variant) variants = { w480: (await SX.upload(img.variant, { purpose: "variant", signal: ctrl.signal })).id }; }
          if (kind === "video") { const vm = await SX.videoMeta(f); meta = { duration_ms: vm.duration_ms, width: vm.width, height: vm.height }; if (vm.poster) poster = (await SX.upload(vm.poster, { purpose: "poster", signal: ctrl.signal })).id; }
          if (kind === "voice") meta = { duration_ms: extra.duration_ms };
          const media = await SX.upload(file, { purpose: "message", meta, poster_media_id: poster, variants, signal: ctrl.signal, onProgress: (x) => (att.querySelector("progress").value = x) });
          att.hidden = true;
          send({ kind, media_id: media.id, body: kind === "file" ? f.name.slice(0, 200) : "", _media: media });
        } catch (err) { att.hidden = true; if (err.name !== "AbortError") SX.fail(err, "Upload failed"); }
      }

      // Voice messages (MediaRecorder)
      let rec = null, recStart = 0, recT = null;
      box.querySelector("[data-voice]").onclick = async (e) => {
        const btn = e.currentTarget;
        if (rec) { rec.stop(); return; }
        if (!window.MediaRecorder) return SX.toast({ kind: "error", title: "Voice messages aren’t supported in this browser" });
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
          rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
          const chunks = [];
          rec.ondataavailable = (x) => x.data.size && chunks.push(x.data);
          rec.onstop = () => {
            stream.getTracks().forEach((t) => t.stop()); clearInterval(recT);
            const dur = Date.now() - recStart; btn.classList.remove("rec"); btn.innerHTML = I("mic"); btn.setAttribute("aria-label", "Record voice message");
            box.querySelector("[data-att]").hidden = true; rec = null;
            if (dur < 700) return SX.toast({ kind: "info", title: "Hold on a little longer to record" });
            const type = (mime || "audio/webm").split(";")[0];
            uploadAndSend(new File([new Blob(chunks, { type })], `voice.${type.split("/")[1]}`, { type }), "voice", { duration_ms: dur });
          };
          rec.start(); recStart = Date.now();
          btn.classList.add("rec"); btn.innerHTML = I("stop"); btn.setAttribute("aria-label", "Stop recording and send");
          const att = box.querySelector("[data-att]"); att.hidden = false;
          recT = setInterval(() => (att.innerHTML = `<span class="s-rec-dot"></span> Recording ${SX.dur(Date.now() - recStart)} · tap stop to send`), 250);
          setTimeout(() => rec?.state === "recording" && rec.stop(), 120_000);
        } catch { SX.toast({ kind: "error", title: "Microphone unavailable", desc: "Allow microphone access to send voice messages." }); }
      };

      // Message actions
      box.addEventListener("click", async (e) => {
        const t = e.target;
        if (t.closest("[data-cancel-reply]")) { replyTo = editing = null; setReplying(null); ta.value = ""; fit(); return; }
        if (t.closest("[data-emoji-btn]")) { const pnl = box.querySelector("[data-emoji-panel]"); pnl.hidden = !pnl.hidden; return; }
        const em = t.closest("[data-emoji]"); if (em) { ta.setRangeText(em.dataset.emoji, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); fit(); return; }
        if (t.closest("[data-older]")) {
          const b = t.closest("[data-older]"); b.disabled = true;
          const h0 = scroller.scrollHeight;
          const r = await api.get(`/api/conversations/${c.id}/messages?before=${msgs[0].id}`).catch(() => null);
          if (r) { msgs = r.items.concat(msgs); hasMore = r.has_more; render(false); scroller.scrollTop = scroller.scrollHeight - h0; if (!hasMore) b.remove(); else b.disabled = false; }
          return;
        }
        const rs = t.closest("[data-resend]"); if (rs) { const pl = pending.get(rs.dataset.resend); if (pl) send(pl); return; }
        if (t.closest("[data-accept]")) { await api.post(`/api/conversations/${c.id}/accept`).catch(SX.fail); c.state = "active"; box.querySelector(".s-request-bar")?.remove(); markRead(); ib.draw(); return; }
        if (t.closest("[data-decline]")) { await api.post(`/api/conversations/${c.id}/decline`).catch(SX.fail); location.hash = "#/social/messages"; return; }
        if (t.closest("[data-block]")) { if (await SX.confirm({ title: `Block ${esc(convTitle(c))}?`, body: "They won’t be able to message you, see your profile or find you in search.", confirmLabel: "Block", danger: true })) { await api.post(`/api/users/${others[0].id}/block`).catch(SX.fail); location.hash = "#/social/messages"; } return; }
        if (t.closest("[data-info]")) return info();
        const react = t.closest("[data-react]");
        if (react) { const mid = react.closest("[data-mid]").dataset.mid; const on = react.classList.contains("on"); on ? await api.del(`/api/messages/${mid}/react`).catch(SX.fail) : await api.post(`/api/messages/${mid}/react`, { kind: react.dataset.react }).catch(SX.fail); return; }
        const act = t.closest("[data-mact]"); if (!act) return;
        const m = msgs.find((x) => x.id === act.closest("[data-mid]").dataset.mid); if (!m) return;
        if (act.dataset.mact === "reply") { replyTo = m; editing = null; setReplying(`${I("reply", "i-xs")} Replying to ${m.sender.id === me.id ? "yourself" : esc(m.sender.display_name)}: “${esc((m.body || m.kind).slice(0, 60))}”`); ta.focus(); }
        if (act.dataset.mact === "react") {
          SX.menu("React", QUICK.map(([k, e2]) => ({ label: `${e2}  ${k}`, run: () => api.post(`/api/messages/${m.id}/react`, { kind: k }).catch(SX.fail) })));
        }
        if (act.dataset.mact === "more") {
          const mine = m.sender.id === me.id;
          SX.menu("Message", [
            m.body && { label: "Copy text", icon: "copy", run: () => navigator.clipboard?.writeText(m.body).then(() => SX.toast({ kind: "info", title: "Copied" })) },
            mine && ["text", "story_reply"].includes(m.kind) && Date.now() - m.created_at < 15 * 60_000 && { label: "Edit", icon: "edit", run: () => startEdit(m) },
            mine && { label: "Unsend", icon: "trash", danger: true, run: async () => { try { await api.del(`/api/messages/${m.id}`); Object.assign(m, { deleted: true, body: "", media: null }); render(false); } catch (err) { SX.fail(err); } } },
            !mine && { label: "Report", icon: "flag", danger: true, run: () => SX.report("message", m.id, "message") },
          ]);
        }
      });
      function info() {
        SX.sheet({
          title: convTitle(c),
          body: `<div class="s-user-list">${c.members.map((u) => `<div class="s-user-row">${SX.avatar(u, "sm")}<div class="grow">${SX.name(u, { handle: true })}${u.state === "request" ? ` <span class="s-pill">invited</span>` : ""}</div>${u.role === "owner" ? `<span class="s-pill">Admin</span>` : ""}</div>`).join("")}</div>
            <div class="s-menu">${`<button class="s-menu-item" data-i="mute">${I(c.muted ? "volume" : "volume-x", "i-sm")} ${c.muted ? "Unmute" : "Mute"} conversation</button>`}
            ${isDm ? `<a class="s-menu-item" href="#/social/u/${esc(others[0]?.username)}">${I("user", "i-sm")} View profile</a><button class="s-menu-item danger" data-i="block">${I("ban", "i-sm")} Block</button><button class="s-menu-item danger" data-i="report">${I("flag", "i-sm")} Report</button>`
              : `<button class="s-menu-item danger" data-i="leave">${I("logout", "i-sm")} Leave group</button>`}</div>`,
          onMount: (bd, close) => bd.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-i]"); if (!b) return;
            close();
            if (b.dataset.i === "mute") { const r = await api.post(`/api/conversations/${c.id}/mute`, { muted: !c.muted }).catch(SX.fail); if (r) c.muted = r.conversation.muted; }
            if (b.dataset.i === "leave") { await api.post(`/api/conversations/${c.id}/leave`).catch(SX.fail); location.hash = "#/social/messages"; }
            if (b.dataset.i === "block") box.querySelector("[data-block]") ? box.querySelector("[data-block]").click() : (await api.post(`/api/users/${others[0].id}/block`).catch(SX.fail), (location.hash = "#/social/messages"));
            if (b.dataset.i === "report") SX.report("user", others[0].id, "account");
          }),
        });
      }

      // Real-time events for this conversation
      let typingT;
      const offs = [
        SX.ws.on("message", (e) => {
          if (e.conversation_id !== c.id) return;
          if (e.message.sender?.id === me.id && msgs.some((m) => m.id === e.message.id || (m.client_id && m.client_id === e.message.client_id))) return;
          if (msgs.some((m) => m.id === e.message.id)) return;
          msgs.push(e.message); msgs.sort((a, b) => (a.id < b.id ? -1 : 1));
          box.querySelector("[data-typing]").hidden = true;
          render(false); markRead();
        }),
        SX.ws.on("message_updated", (e) => { if (e.conversation_id !== c.id) return; const m = msgs.find((x) => x.id === e.message.id); if (m) { Object.assign(m, { body: e.message.body, edited_at: e.message.edited_at }); render(false); } }),
        SX.ws.on("message_deleted", (e) => { if (e.conversation_id !== c.id) return; const m = msgs.find((x) => x.id === e.message_id); if (m) { Object.assign(m, { deleted: true, body: "", media: null }); render(false); } }),
        SX.ws.on("message_reactions", async (e) => {
          if (e.conversation_id !== c.id) return;
          const r = await api.get(`/api/conversations/${c.id}/messages`).catch(() => null);
          const fresh = r?.items.find((x) => x.id === e.message_id); const m = msgs.find((x) => x.id === e.message_id);
          if (fresh && m) { m.reactions = fresh.reactions; render(false); }
        }),
        SX.ws.on("read", (e) => { if (e.conversation_id !== c.id) return; const mm = c.members.find((x) => x.id === e.user_id); if (mm) mm.last_read_id = e.message_id; const s = box.querySelector("[data-seen]"); if (s) s.textContent = seenLabel(); }),
        SX.ws.on("typing", (e) => {
          if (e.conversation_id !== c.id) return;
          const who = c.members.find((x) => x.id === e.user_id);
          const tEl = box.querySelector("[data-typing]");
          tEl.hidden = !e.typing; tEl.innerHTML = `<span class="s-dots-anim"><i></i><i></i><i></i></span> ${esc(who?.display_name ?? "Someone")} is typing…`;
          clearTimeout(typingT); typingT = setTimeout(() => (tEl.hidden = true), 5000);
          if (e.typing && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80) scroller.scrollTop = scroller.scrollHeight;
        }),
        SX.ws.on("presence", (e) => { if (isDm && e.user_id === others[0]?.id) box.querySelector("[data-presence]").textContent = e.online ? "Active now" : "Offline"; }),
      ];
      const vis = () => !document.hidden && markRead();
      document.addEventListener("visibilitychange", vis);
      if (!c.blocked && c.state !== "request") ta.focus({ preventScroll: true });
      return () => { offs.forEach((f) => f()); ib.destroy(); document.removeEventListener("visibilitychange", vis); clearTimeout(typingStop); rec?.stop(); };
    },
  });
})();
