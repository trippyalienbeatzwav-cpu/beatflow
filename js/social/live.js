/* ==========================================================================
   TUNIBEAT Social — Live
   Media is WebRTC: the host's browser sends straight to each viewer (webrtc-mesh), and the
   server only relays offers, answers and ICE candidates over the WebSocket. Chat, reactions,
   gifts, tips, moderation and viewer counts all come through the same real-time channel.
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const REACT = [["love", "❤️"], ["fire", "🔥"], ["clap", "👏"], ["laugh", "😂"], ["wow", "😮"]];
  const EMO = Object.fromEntries(REACT);

  /* ---------- Directory ---------- */
  SX.route("/social/live", {
    title: "Live", active: "live",
    render: () => `<header class="s-page-head row"><div><h1 class="s-h2">Live</h1><p class="muted">Watch creators live, chat in real time, and support them with gifts and tips.</p></div>
        <a class="s-btn primary" href="#/social/create?mode=live">${I("live", "i-sm")} Go live</a></header>
      <div class="s-chips" data-cats></div>
      <section aria-labelledby="ln"><h2 class="s-h5" id="ln"><span class="s-live-dot"></span> Live now</h2><div class="s-live-grid" data-now>${SX.skeletonGrid(3)}</div></section>
      <section aria-labelledby="ls"><h2 class="s-h5" id="ls">${I("calendar", "i-sm")} Scheduled</h2><div class="s-sched" data-sched></div></section>
      <section aria-labelledby="lp"><h2 class="s-h5" id="lp">${I("clock", "i-sm")} Your past lives</h2><div class="s-sched" data-past></div></section>`,
    async mount(el) {
      let cat = null;
      const draw = async () => {
        const r = await api.get("/api/live");
        el.querySelector("[data-cats]").innerHTML = [null, ...r.categories].map((c) => `<button class="s-chip btn ${c === cat ? "on" : ""}" data-cat="${esc(c ?? "")}">${esc(c ?? "All")}</button>`).join("");
        const items = r.items.filter((l) => !cat || l.category === cat);
        const now = items.filter((l) => l.status === "live");
        el.querySelector("[data-now]").innerHTML = now.length ? now.map((l) => `<a class="s-live-tile" href="#/social/live/${l.id}">
            <div class="s-live-thumb">${l.thumbnail_url ? `<img src="${l.thumbnail_url}" alt="">` : `<div class="s-live-ph">${SX.avatar(l.host, "lg", { link: false })}</div>`}
              <span class="s-live-badge">LIVE</span><span class="s-live-viewers">${I("eye", "i-xs")} ${SX.count(l.viewers)}</span>${l.reconnecting ? `<span class="s-live-recon">Reconnecting…</span>` : ""}</div>
            <div class="s-live-info">${SX.avatar(l.host, "sm", { link: false })}<div><b>${esc(l.title)}</b><span>${esc(l.host.display_name)} · ${esc(l.category)}</span></div></div></a>`).join("")
          : SX.empty({ icon: "live", title: "Nobody’s live right now", body: "When creators you follow go live, you’ll get a notification. Or start your own.", actions: `<a class="s-btn primary" href="#/social/create?mode=live">Go live</a>` });
        const sched = items.filter((l) => l.status === "scheduled");
        el.querySelector("[data-sched]").innerHTML = sched.map((l) => `<div class="s-sched-row">${SX.avatar(l.host, "sm")}<div class="grow"><b>${esc(l.title)}</b><span class="muted">${esc(l.host.display_name)} · ${esc(l.category)}</span></div><span class="s-pill">${I("calendar", "i-xs")} ${l.scheduled_at ? SX.when(l.scheduled_at) : "Ready"}</span>${l.host.id === SX.state.me.id ? `<a class="s-btn sm primary" href="#/social/live/${l.id}">Open studio</a>` : ""}</div>`).join("") || `<p class="muted">No scheduled lives.</p>`;
        const past = await api.get("/api/live?status=ended");
        el.querySelector("[data-past]").innerHTML = past.items.map((l) => `<div class="s-sched-row"><div class="grow"><b>${esc(l.title)}</b><span class="muted">${SX.when(l.started_at)} · ${SX.dur((l.ended_at ?? l.started_at) - l.started_at)}</span></div><span class="s-pill">${I("eye", "i-xs")} peak ${l.peak_viewers}</span><span class="s-pill">${l.unique_viewers} viewers</span></div>`).join("") || `<p class="muted">You haven’t gone live yet.</p>`;
      };
      await draw();
      el.querySelector("[data-cats]").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (!b) return; cat = b.dataset.cat || null; draw(); });
      const t = setInterval(() => !document.hidden && draw().catch(() => {}), 20_000);
      return () => clearInterval(t);
    },
  });

  /* ---------- Stream page (host or viewer) ---------- */
  SX.route("/social/live/:id", {
    title: "Live", active: "live", bare: true,
    async mount(el, p) {
      const r = await api.get(`/api/live/${p.id}`);
      const st = r.stream;
      document.title = `${st.host.display_name} · ${st.title} — TUNIBEAT Live`;
      return st.viewer.is_host ? hostRoom(el, st, r.messages) : viewerRoom(el, st, r.messages);
    },
  });

  function roomHtml(st, host) {
    return `<div class="s-room ${host ? "host" : ""}" data-room>
      <div class="s-stage">
        <video data-video playsinline autoplay ${host ? "muted" : "muted"} aria-label="${host ? "Your camera preview" : `Live video from ${esc(st.host.display_name)}`}"></video>
        <div class="s-stage-top">
          <button class="s-stage-btn" data-leave aria-label="Leave">${I("arrow-left", "i-sm")}</button>
          <div class="s-stage-host">${SX.avatar(st.host, "sm", { link: !host })}<div><b>${esc(st.host.display_name)}</b>${st.host.is_verified ? SX.verified() : ""}<span data-title>${esc(st.title)}</span></div>
            ${!host && !st.viewer.following ? `<button class="s-btn sm primary" data-follow="${st.host.id}" data-state="none">Follow</button>` : ""}</div>
          <div class="s-stage-stats"><span class="s-live-badge" data-badge>${st.status === "live" ? "LIVE" : st.status.toUpperCase()}</span><span class="s-pill dark" data-viewers aria-live="polite">${I("eye", "i-xs")} ${SX.count(st.viewers)}</span><span class="s-pill dark" data-elapsed></span></div>
        </div>
        <div class="s-stage-overlay" data-overlay hidden></div>
        <div class="s-fx" data-fx aria-hidden="true"></div>
        <div class="s-gift-banner" data-gift-banner aria-live="polite"></div>
        ${host ? "" : `<button class="s-unmute" data-unmute hidden>${I("volume-x", "i-sm")} Tap to unmute</button>`}
        <div class="s-stage-bottom">
          ${host ? `<div class="s-host-controls" role="group" aria-label="Broadcast controls">
              <button class="s-round" data-mic aria-pressed="true" aria-label="Mute microphone">${I("mic")}</button>
              <button class="s-round" data-cam aria-pressed="true" aria-label="Turn camera off">${I("video")}</button>
              <button class="s-round" data-flip aria-label="Switch camera">${I("refresh")}</button>
              <button class="s-btn danger" data-end>${I("stop", "i-sm")} End live</button>
              <span class="s-health" data-health title="Stream health">—</span></div>`
            : `<div class="s-react-bar" role="group" aria-label="React">${REACT.map(([k, e]) => `<button data-react="${k}" aria-label="React ${k}">${e}</button>`).join("")}</div>`}
        </div>
      </div>
      <aside class="s-chat" aria-label="Live chat">
        <header class="s-chat-head"><b>Live chat</b><span class="s-chat-mode" data-slow></span>
          <div class="s-chat-tools">${host || st.viewer.is_moderator ? `<label class="sr-only" for="slow">Slow mode</label><select id="slow" class="s-input sm" data-slow-select>${[0, 3, 5, 10, 30, 60, 120].map((s) => `<option value="${s}" ${s === st.slow_mode_seconds ? "selected" : ""}>${s ? `Slow ${s}s` : "Slow mode off"}</option>`).join("")}</select>` : ""}
            <button class="s-icon-btn sm" data-room-more aria-label="Live options">${I("more", "i-sm")}</button></div></header>
        <div class="s-pinned" data-pinned hidden></div>
        <ol class="s-chat-list" data-chat aria-live="polite" aria-relevant="additions"></ol>
        <form class="s-chat-form" data-chat-form>
          <label class="sr-only" for="chat-in">Say something</label>
          <input id="chat-in" maxlength="200" placeholder="${st.status === "live" ? "Say something…" : "Chat opens when the live starts"}" autocomplete="off" ${st.status === "live" ? "" : "disabled"}>
          ${host ? "" : `${st.viewer.can_gift ? `<button type="button" class="s-icon-btn gift" data-gift aria-label="Send a gift">${I("gift")}</button>` : ""}${st.viewer.can_tip ? `<button type="button" class="s-icon-btn tip" data-tip aria-label="Send a tip">${I("coin")}</button>` : ""}`}
          <button class="s-icon-btn" aria-label="Send">${I("send")}</button>
        </form>
        <p class="s-chat-note" data-chat-note hidden></p>
      </aside>
    </div>`;
  }

  /* Shared room behaviour: chat, pins, reactions, gifts, moderation, viewer counts, state */
  function room(el, st, messages, { host }) {
    el.innerHTML = roomHtml(st, host);
    document.body.classList.add("s-live-on");
    const $ = (s) => el.querySelector(s);
    const chat = $("[data-chat]");
    const me = SX.state.me;
    const offs = [];
    const on = (t, fn) => offs.push(SX.ws.on(t, (m) => m.stream === st.id && fn(m)));
    let lastSent = 0, mutedUntil = st.viewer.muted_until;

    const msgHtml = (m) => {
      if (m.kind === "system") return `<li class="s-chat-msg system" data-m="${m.id}">${esc(m.body)}</li>`;
      if (m.kind === "gift") return `<li class="s-chat-msg gift" data-m="${m.id}">${SX.giftIcon(m.data.icon, "i-sm")}<span><b>${esc(m.user.display_name)}</b> sent ${esc(m.body.replace(/^sent /, ""))}</span></li>`;
      if (m.kind === "donation") return `<li class="s-chat-msg tip" data-m="${m.id}">${I("coin", "i-sm")}<span><b>${esc(m.user.display_name)}</b> tipped ${SX.money(m.data.amount_cents, m.data.currency)}${m.data.test_mode ? ` <small>(test)</small>` : ""}${m.body && m.body !== "Sent a tip" ? `: ${esc(m.body)}` : ""}</span></li>`;
      const badge = m.data?.host ? `<span class="s-chat-badge host">Host</span>` : m.data?.mod ? `<span class="s-chat-badge mod">Mod</span>` : m.data?.supporter ? `<span class="s-chat-badge sup" title="Has sent gifts">★</span>` : "";
      return `<li class="s-chat-msg" data-m="${m.id}" data-uid="${m.user.id}"><button class="s-chat-user" data-user="${m.user.id}" data-name="${esc(m.user.username)}">${esc(m.user.display_name)}</button>${badge} <span class="s-chat-text">${SX.rich(m.body)}</span></li>`;
    };
    const add = (m) => {
      const stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
      chat.insertAdjacentHTML("beforeend", msgHtml(m));
      while (chat.children.length > 200) chat.firstElementChild.remove();   // bounded DOM for long lives
      if (stick) chat.scrollTop = chat.scrollHeight;
    };
    messages.forEach(add);
    chat.scrollTop = chat.scrollHeight;
    const setPinned = (m) => {
      const box = $("[data-pinned]");
      box.hidden = !m;
      if (m) box.innerHTML = `${I("pin", "i-xs")}<div><b>${esc(m.user.display_name)}</b> ${SX.rich(m.body)}</div>${host || st.viewer.is_moderator ? `<button class="s-icon-btn sm" data-unpin aria-label="Unpin">${I("x", "i-xs")}</button>` : ""}`;
    };
    setPinned(st.pinned);
    const setSlow = (s) => { st.slow_mode_seconds = s; $("[data-slow]").textContent = s ? `Slow mode ${s}s` : ""; };
    setSlow(st.slow_mode_seconds);
    const started = st.started_at ?? Date.now();
    const clock = setInterval(() => { $("[data-elapsed]").textContent = st.status === "live" ? SX.dur(Date.now() - started) : ""; }, 1000);

    // Floating reactions, capped so a flood can't hurt performance
    let floating = 0;
    const floatEmoji = (emoji) => {
      if (reduce() || floating > 24) return;
      floating++;
      const s = document.createElement("span");
      s.className = "s-float"; s.textContent = emoji;
      s.style.setProperty("--x", `${Math.random() * 40 - 20}px`); s.style.setProperty("--d", `${2.2 + Math.random()}s`);
      $("[data-fx]").appendChild(s);
      setTimeout(() => { s.remove(); floating--; }, 3400);
    };
    // Gift animations queue (max 3 at once) + combo banner
    const gq = []; let gActive = 0; const combos = new Map();
    const playGift = (g, user) => {
      const key = `${user.id}:${g.id}`;
      const c = combos.get(key) ?? { n: 0, t: 0 };
      c.n++; clearTimeout(c.t); c.t = setTimeout(() => combos.delete(key), 3000); combos.set(key, c);
      const banner = $("[data-gift-banner]");
      banner.innerHTML = `<div class="s-gift-pill">${SX.avatar(user, "xs", { link: false })}<span><b>${esc(user.display_name)}</b> sent <b>${esc(g.name)}</b>${c.n > 1 ? ` <em>×${c.n}</em>` : ""}</span>${SX.giftIcon(g.icon, "i-sm")}</div>`;
      banner.classList.remove("show"); void banner.offsetWidth; banner.classList.add("show");
      gq.push(g); pump();
    };
    const pump = () => {
      if (gActive >= 3 || !gq.length) return;
      const g = gq.shift(); gActive++;
      const fx = document.createElement("div");
      fx.className = `s-gift-fx ${reduce() ? "still" : g.animation}`;
      const n = g.animation === "rain" && !reduce() ? 8 : 1;
      fx.innerHTML = Array.from({ length: n }, (_, i) => `<span style="--i:${i}">${SX.giftIcon(g.icon)}</span>`).join("");
      $("[data-fx]").appendChild(fx);
      setTimeout(() => { fx.remove(); gActive--; pump(); }, reduce() ? 1200 : 2600);
    };

    const overlay = (html) => { const o = $("[data-overlay]"); o.hidden = !html; o.innerHTML = html || ""; };
    on("live:chat", (m) => add(m.message));
    on("live:chat_deleted", (m) => { chat.querySelector(`[data-m="${m.message_id}"]`)?.remove(); if ($("[data-pinned]").innerHTML.includes(m.message_id)) setPinned(null); });
    on("live:pinned", (m) => setPinned(m.message));
    on("live:viewers", (m) => { st.viewers = m.count; $("[data-viewers]").innerHTML = `${I("eye", "i-xs")} ${SX.count(m.count)}`; });
    on("live:reaction", (m) => floatEmoji(EMO[m.kind] ?? "❤️"));
    on("live:gift", (m) => { add({ id: m.message_id, kind: "gift", user: m.user, body: `sent ${m.gift.name}`, data: { icon: m.gift.icon } }); playGift(m.gift, m.user); });
    on("live:donation", (m) => { add({ id: m.message_id, kind: "donation", user: m.user, body: m.message || "Sent a tip", data: { amount_cents: m.amount_cents, currency: m.currency, test_mode: m.test_mode } }); if (!reduce()) { for (let i = 0; i < 6; i++) setTimeout(() => floatEmoji("💸"), i * 90); } });
    on("live:settings", (m) => { setSlow(m.slow_mode_seconds); const s = $("[data-slow-select]"); if (s) s.value = m.slow_mode_seconds; });
    on("live:muted", (m) => { mutedUntil = m.until; note(m.until ? `You’re timed out until ${new Date(m.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "You can chat again."); });
    on("live:moderator", () => { st.viewer.is_moderator = true; SX.toast({ kind: "info", title: "You’re now a moderator in this live" }); });
    const note = (t) => { const n = $("[data-chat-note]"); n.hidden = !t; n.textContent = t || ""; if (t) setTimeout(() => (n.hidden = true), 6000); };

    // Chat send
    $("[data-chat-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const inp = $("#chat-in"); const body = inp.value.trim(); if (!body) return;
      // The server enforces timeouts; this just saves a round trip and explains why
      if (mutedUntil && new Date(mutedUntil) > new Date()) return note(`You’re timed out until ${new Date(mutedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
      if (st.slow_mode_seconds && !host && !st.viewer.is_moderator) {
        const wait = st.slow_mode_seconds * 1000 - (Date.now() - lastSent);
        if (wait > 0) return note(`Slow mode: wait ${Math.ceil(wait / 1000)}s.`);
      }
      inp.value = "";
      try { await api.post(`/api/live/${st.id}/messages`, { body }); lastSent = Date.now(); }
      catch (err) { inp.value = body; note(err.message); }
    });
    // Moderation / message actions
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-leave]")) return history.length > 1 ? history.back() : (location.hash = "#/social/live");
      const react = e.target.closest("[data-react]");
      if (react) { floatEmoji(EMO[react.dataset.react]); api.post(`/api/live/${st.id}/react`, { kind: react.dataset.react }).catch(() => {}); return; }
      if (e.target.closest("[data-gift]")) return SX.openGifts({ recipient: st.host, contextType: "live", contextId: st.id });
      if (e.target.closest("[data-tip]")) return SX.openTip({ recipient: st.host, contextType: "live", contextId: st.id });
      if (e.target.closest("[data-unpin]")) { api.post(`/api/live/${st.id}/pin`, { message_id: null }).catch(SX.fail); return; }
      if (e.target.closest("[data-room-more]")) {
        return SX.menu("Live", [
          { label: "Copy link", icon: "link", run: () => SX.copy(SX.absUrl(`#/social/live/${st.id}`)) },
          host && { label: "Moderators", icon: "shield", run: () => moderators(st) },
          !host && { label: "Report live", icon: "flag", danger: true, run: () => SX.report("live", st.id, "live video") },
          !host && { label: `Go to ${st.host.display_name}’s profile`, icon: "user", run: () => (location.hash = `#/social/u/${st.host.username}`) },
        ]);
      }
      const u = e.target.closest("[data-user]");
      if (u) {
        const li = u.closest("[data-m]"); const mid = li.dataset.m; const uid = u.dataset.user; const name = u.dataset.name;
        const canMod = (host || st.viewer.is_moderator) && uid !== st.host.id && uid !== me.id;
        const act = (action, extra = {}) => api.post(`/api/live/${st.id}/moderation`, { action, user_id: uid, ...extra }).then(() => SX.toast({ kind: "info", title: "Done", desc: `${action} · @${esc(name)}` })).catch((err) => SX.fail(err));
        SX.menu(`@${name}`, [
          { label: "View profile", icon: "user", run: () => (location.hash = `#/social/u/${name}`) },
          canMod && { label: "Pin message", icon: "pin", run: () => api.post(`/api/live/${st.id}/pin`, { message_id: mid }).catch(SX.fail) },
          (canMod || uid === me.id) && { label: "Delete message", icon: "trash", run: () => api.del(`/api/live/${st.id}/messages/${mid}`).catch(SX.fail) },
          canMod && { label: "Time out 1 minute", icon: "clock", run: () => act("mute", { minutes: 1 }) },
          canMod && { label: "Time out 10 minutes", icon: "clock", run: () => act("mute", { minutes: 10 }) },
          canMod && { label: "Ban from my lives", icon: "ban", danger: true, run: () => act("ban") },
          host && uid !== me.id && { label: "Block", icon: "ban", danger: true, run: () => act("block") },
          host && uid !== me.id && { label: "Make moderator", icon: "shield", run: () => api.post(`/api/live/${st.id}/moderators`, { user_id: uid }).then(() => SX.toast({ title: `@${esc(name)} is now a moderator` })).catch(SX.fail) },
          uid !== me.id && { label: "Report message", icon: "flag", danger: true, run: () => SX.report("live_message", mid, "message") },
        ]);
      }
    });
    $("[data-slow-select]")?.addEventListener("change", (e) => api.patch(`/api/live/${st.id}`, { slow_mode_seconds: Number(e.target.value) }).catch(SX.fail));
    SX.bindFollow(el);

    return {
      $, overlay, on, note, st,
      destroy() { offs.forEach((f) => f()); clearInterval(clock); document.body.classList.remove("s-live-on"); },
    };
  }

  function moderators(st) {
    SX.sheet({
      title: "Moderators", body: `<p class="muted">Moderators can pin, delete, time out and ban in your lives.</p><div data-mods>${SX.skeletonRows(2)}</div>`,
      onMount: async (bd) => {
        const draw = async () => {
          const r = await api.get(`/api/live/${st.id}/moderators`);
          bd.querySelector("[data-mods]").innerHTML = r.items.map((u) => `<div class="s-user-row">${SX.avatar(u, "sm")}<div class="grow">${SX.name(u, { handle: true })}</div><button class="s-btn sm" data-rm="${u.id}">Remove</button></div>`).join("") || `<p class="muted">No moderators yet. Tap a name in chat to add one.</p>`;
        };
        await draw();
        bd.addEventListener("click", async (e) => { const b = e.target.closest("[data-rm]"); if (b) { await api.del(`/api/live/${st.id}/moderators/${b.dataset.rm}`).catch(SX.fail); draw(); } });
      },
    });
  }

  /* ---------- Viewer ---------- */
  function viewerRoom(el, st, messages) {
    const R = room(el, st, messages, { host: false });
    const video = R.$("[data-video]");
    let pc = null, hostConn = null, pendingIce = [], retryT = null;
    const ice = st.rtc.ice_servers;
    const ch = `live:${st.id}`;

    const ended = (reason) => {
      st.status = "ended";
      R.$("[data-badge]").textContent = "ENDED";
      R.$("#chat-in").disabled = true;
      R.overlay(`<div class="s-ov-card">${I("live")}<h2>This live has ended</h2><p>${reason === "host_disconnected" ? "The host lost their connection." : "Thanks for watching."}</p>
        <div class="s-row center">${!st.viewer.following ? `<button class="s-btn primary" data-follow="${st.host.id}" data-state="none">Follow ${esc(st.host.display_name)}</button>` : ""}<a class="s-btn" href="#/social/live">More lives</a></div></div>`);
      closePc();
    };
    const closePc = () => { pc?.close(); pc = null; pendingIce = []; };
    function newPc() {
      closePc();
      pc = new RTCPeerConnection({ iceServers: ice });
      pc.ontrack = (e) => {
        if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0];
        video.play().then(() => { R.$("[data-unmute]").hidden = !video.muted; }).catch(() => { R.$("[data-unmute]").hidden = false; });
        R.overlay(null);
      };
      pc.onicecandidate = (e) => e.candidate && hostConn && SX.ws.send({ t: "live:signal", stream: st.id, to: hostConn, data: { candidate: e.candidate } });
      pc.onconnectionstatechange = () => {
        if (["failed", "disconnected"].includes(pc?.connectionState)) {
          clearTimeout(retryT);
          retryT = setTimeout(() => { if (pc && ["failed", "disconnected"].includes(pc.connectionState) && st.status === "live") { R.overlay(`<div class="s-ov-card"><div class="s-spinner light"></div><p>Reconnecting video…</p></div>`); SX.ws.send({ t: "live:ready", stream: st.id }); } }, 2500);
        }
      };
      return pc;
    }
    R.on("live:signal", async (m) => {
      hostConn = m.from;
      try {
        if (m.data.sdp?.type === "offer") {
          const c = newPc();
          await c.setRemoteDescription(m.data.sdp);
          for (const cand of pendingIce.splice(0)) await c.addIceCandidate(cand).catch(() => {});
          await c.setLocalDescription(await c.createAnswer());
          SX.ws.send({ t: "live:signal", stream: st.id, to: m.from, data: { sdp: c.localDescription } });
        } else if (m.data.candidate) {
          if (pc?.remoteDescription) await pc.addIceCandidate(m.data.candidate).catch(() => {});
          else pendingIce.push(m.data.candidate);
        }
      } catch (err) { console.error("webrtc", err); }
    });
    R.on("live:state", (m) => {
      if (m.status === "ended") return ended(m.reason);
      if (m.status === "reconnecting") { st.status = "live"; R.overlay(`<div class="s-ov-card"><div class="s-spinner light"></div><h2>Host is reconnecting</h2><p>Hang tight. The stream will resume automatically.</p></div>`); }
      if (m.status === "live") { st.status = "live"; R.$("[data-badge]").textContent = "LIVE"; R.$("#chat-in").disabled = false; R.$("#chat-in").placeholder = "Say something…"; if (!video.srcObject || !pc) R.overlay(`<div class="s-ov-card"><div class="s-spinner light"></div><p>Connecting…</p></div>`); }
    });
    R.on("live:full", (m) => R.overlay(`<div class="s-ov-card">${I("users")}<h2>This live is full</h2><p>Peer-to-peer lives on this server hold up to ${m.max} viewers. Try again in a bit.</p><button class="s-btn primary" data-rejoin>Try again</button></div>`));
    R.on("live:removed", (m) => { closePc(); R.overlay(`<div class="s-ov-card">${I("ban")}<h2>You can’t watch this live</h2><p>${m.reason === "banned" ? "The host removed you from their lives." : "This live isn’t available to you."}</p><a class="s-btn" href="#/social/live">Back to Live</a></div>`); });
    R.on("live:health", (m) => { if (m.quality === "poor") R.note("The host’s connection is unstable."); });
    const offDenied = SX.ws.on("sub_denied", (m) => m.ch === ch && R.overlay(`<div class="s-ov-card">${I("lock")}<h2>Not available</h2><p>This live is followers-only, full, or you were removed.</p><a class="s-btn" href="#/social/live">Back to Live</a></div>`));
    // After a socket reconnect the hub re-subscribes; ask the host for a fresh offer
    let firstSub = true;   // the first join already makes the host send an offer
    const offOpen = SX.ws.on("subscribed", (m) => { if (m.ch !== ch) return; if (firstSub) { firstSub = false; return; } if (st.status === "live") SX.ws.send({ t: "live:ready", stream: st.id }); });
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-unmute]")) { video.muted = false; video.play().catch(() => {}); e.target.closest("[data-unmute]").hidden = true; }
      if (e.target.closest("[data-rejoin]")) { unsub(); firstSub = true; unsub = SX.ws.sub(ch); R.overlay(`<div class="s-ov-card"><div class="s-spinner light"></div><p>Joining…</p></div>`); }
    });

    if (st.status === "ended") ended();
    else if (st.status === "scheduled") R.overlay(`<div class="s-ov-card">${I("calendar")}<h2>Starts ${st.scheduled_at ? SX.when(st.scheduled_at) : "soon"}</h2><p>${esc(st.description || "You’ll be notified when it starts.")}</p></div>`);
    else R.overlay(`<div class="s-ov-card"><div class="s-spinner light"></div><p>${st.reconnecting ? "Host is reconnecting…" : "Connecting to the live…"}</p></div>`);
    let unsub = SX.ws.sub(ch);
    if (!SX.ws.connected) SX.ws.connect();
    return () => { unsub(); offDenied(); offOpen(); closePc(); clearTimeout(retryT); R.destroy(); if (video.srcObject) video.srcObject = null; };
  }

  /* ---------- Host ---------- */
  function hostRoom(el, st, messages) {
    const R = room(el, st, messages, { host: true });
    const video = R.$("[data-video]");
    const pcs = new Map();   // viewer connection id → RTCPeerConnection
    let stream = null, healthT = null, unsub = null, facing = "user";
    const lastBytes = new Map();
    const ice = st.rtc.ice_servers;
    const ch = `live:${st.id}`;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: facing }, audio: { echoCancellation: true, noiseSuppression: true } });
        video.srcObject = stream; video.play().catch(() => {});
        return true;
      } catch (err) {
        R.overlay(`<div class="s-ov-card">${I("video")}<h2>Camera or microphone unavailable</h2><p>${esc(err.name === "NotAllowedError" ? "Allow camera and microphone access in your browser, then try again." : err.message)}</p><button class="s-btn primary" data-retry-cam>Try again</button></div>`);
        return false;
      }
    }
    async function offerTo(conn) {
      pcs.get(conn)?.close();
      const pc = new RTCPeerConnection({ iceServers: ice });
      pcs.set(conn, pc);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => e.candidate && SX.ws.send({ t: "live:signal", stream: st.id, to: conn, data: { candidate: e.candidate } });
      pc.onconnectionstatechange = () => { if (pc.connectionState === "closed" || pc.connectionState === "failed") { if (pcs.get(conn) === pc) pcs.delete(conn); } };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      SX.ws.send({ t: "live:signal", stream: st.id, to: conn, data: { sdp: pc.localDescription } });
    }
    R.on("live:viewers_list", (m) => { pcs.forEach((pc) => pc.close()); pcs.clear(); m.viewers.forEach((v) => offerTo(v.conn).catch(console.error)); });
    R.on("live:viewer_joined", (m) => { if (stream) offerTo(m.conn).catch(console.error); });
    R.on("live:viewer_left", (m) => { pcs.get(m.conn)?.close(); pcs.delete(m.conn); });
    R.on("live:signal", async (m) => {
      const pc = pcs.get(m.from); if (!pc) return;
      try {
        if (m.data.sdp?.type === "answer") await pc.setRemoteDescription(m.data.sdp);
        else if (m.data.candidate) await pc.addIceCandidate(m.data.candidate).catch(() => {});
      } catch (err) { console.error("webrtc", err); }
    });
    R.on("live:state", (m) => { if (m.status === "ended") finish(m.reason); });
    // Register as publisher on every (re)subscription, e.g. after a network drop
    const offSub = SX.ws.on("subscribed", (m) => { if (m.ch === ch && st.status === "live") SX.ws.send({ t: "live:host", stream: st.id }); });
    const offErr = SX.ws.on("error", (m) => m.code === "not_host" && R.note("This live is no longer running."));

    async function health() {
      let kbps = 0, fps = 0, lost = 0, sent = 0, w = 0, h = 0;
      for (const [conn, pc] of pcs) {
        const stats = await pc.getStats().catch(() => null); if (!stats) continue;
        stats.forEach((s) => {
          if (s.type === "outbound-rtp" && s.kind === "video") {
            const prev = lastBytes.get(conn) ?? { b: s.bytesSent, t: s.timestamp };
            if (s.timestamp > prev.t) kbps += ((s.bytesSent - prev.b) * 8) / (s.timestamp - prev.t);
            lastBytes.set(conn, { b: s.bytesSent, t: s.timestamp });
            fps = Math.max(fps, s.framesPerSecond ?? 0); w = s.frameWidth ?? w; h = s.frameHeight ?? h; sent += s.packetsSent ?? 0;
          }
          if (s.type === "remote-inbound-rtp" && s.kind === "video") lost += s.packetsLost ?? 0;
        });
      }
      const loss = sent ? lost / (sent + lost) : 0;
      const q = !pcs.size ? "idle" : fps >= 20 && loss < 0.05 ? "good" : fps >= 10 ? "fair" : "poor";
      R.$("[data-health]").innerHTML = `<i class="q-${q}"></i>${pcs.size ? `${Math.round(kbps)} kbps · ${Math.round(fps)} fps · ${pcs.size} peer${pcs.size === 1 ? "" : "s"}` : "Waiting for viewers"}`;
      SX.ws.send({ t: "live:health", stream: st.id, stats: { bitrate_kbps: Math.round(kbps), fps: Math.round(fps), width: w, height: h, peers: pcs.size, packet_loss: loss } });
    }

    async function goLive() {
      if (!(await startCamera())) return;
      if (st.status === "scheduled") {
        R.overlay(`<div class="s-ov-card"><h2>Ready?</h2><p>Your camera is on. Followers are notified when you go live.</p><button class="s-btn primary lg" data-start>${I("live", "i-sm")} Go live now</button></div>`);
        return;
      }
      begin();
    }
    function begin() {
      R.overlay(null);
      R.$("[data-badge]").textContent = "LIVE";
      R.$("#chat-in").disabled = false; R.$("#chat-in").placeholder = "Say something…";
      unsub = SX.ws.sub(ch);
      if (SX.ws.connected) SX.ws.send({ t: "live:host", stream: st.id });
      healthT = setInterval(health, 3000);
    }
    function stopMedia() { clearInterval(healthT); pcs.forEach((pc) => pc.close()); pcs.clear(); stream?.getTracks().forEach((t) => t.stop()); stream = null; }
    function finish(reason, summary) {
      st.status = "ended"; stopMedia();
      R.$("[data-badge]").textContent = "ENDED";
      R.overlay(`<div class="s-ov-card wide"><h2>Live ended</h2>${reason === "host_disconnected" ? `<p>You were disconnected for too long, so the live ended automatically.</p>` : ""}
        ${summary ? `<dl class="s-summary"><div><dt>Peak viewers</dt><dd>${summary.peak_viewers}</dd></div><div><dt>Unique viewers</dt><dd>${summary.unique_viewers}</dd></div><div><dt>Duration</dt><dd>${SX.dur(summary.ended_at - summary.started_at)}</dd></div>
          <div><dt>Chat messages</dt><dd>${summary.chat_messages}</dd></div><div><dt>Gift earnings</dt><dd>${SX.money(summary.gift_cents)}</dd></div><div><dt>Tips</dt><dd>${SX.money(summary.donation_cents)}</dd></div><div><dt>New followers</dt><dd>${summary.new_followers}</dd></div></dl>` : ""}
        <div class="s-row center"><a class="s-btn primary" href="#/social/studio">Creator Studio</a><a class="s-btn" href="#/social">Done</a></div></div>`);
    }
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-retry-cam]")) return goLive();
      if (e.target.closest("[data-start]")) {
        const b = e.target.closest("[data-start]"); b.disabled = true;
        try { const r = await api.post(`/api/live/${st.id}/start`); Object.assign(st, r.stream); begin(); SX.toast({ title: "You’re live", desc: "Followers were notified." }); }
        catch (err) { SX.fail(err, "Couldn’t go live"); b.disabled = false; }
        return;
      }
      if (e.target.closest("[data-end]")) {
        if (!(await SX.confirm({ title: "End this live?", body: "Viewers will see that the live has ended.", confirmLabel: "End live", danger: true }))) return;
        try { const r = await api.post(`/api/live/${st.id}/end`); finish("host_ended", r.summary); } catch (err) { SX.fail(err); }
        return;
      }
      const mic = e.target.closest("[data-mic]");
      if (mic && stream) { const t = stream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; mic.setAttribute("aria-pressed", t.enabled); mic.innerHTML = I(t.enabled ? "mic" : "volume-x"); mic.setAttribute("aria-label", t.enabled ? "Mute microphone" : "Unmute microphone"); } }
      const cam = e.target.closest("[data-cam]");
      if (cam && stream) { const t = stream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; cam.setAttribute("aria-pressed", t.enabled); cam.classList.toggle("off", !t.enabled); cam.setAttribute("aria-label", t.enabled ? "Turn camera off" : "Turn camera on"); } }
      if (e.target.closest("[data-flip]") && stream) {
        facing = facing === "user" ? "environment" : "user";
        try {
          const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } });
          const nt = ns.getVideoTracks()[0], old = stream.getVideoTracks()[0];
          for (const pc of pcs.values()) pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(nt);
          stream.removeTrack(old); old.stop(); stream.addTrack(nt); video.srcObject = stream;
        } catch { SX.toast({ kind: "info", title: "Only one camera available" }); }
      }
    });
    const warn = (e) => { if (st.status === "live") { e.preventDefault(); e.returnValue = ""; } };
    addEventListener("beforeunload", warn);
    if (st.status === "ended") finish();
    else goLive();
    return () => { removeEventListener("beforeunload", warn); offSub(); offErr(); unsub?.(); stopMedia(); R.destroy(); };
  }
})();
