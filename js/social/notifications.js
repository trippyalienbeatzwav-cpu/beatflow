/* ==========================================================================
   TUNIBEAT Social — Notifications (grouped, real-time, with follow requests)
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, api = SX.api;
  const TABS = [["all", "All"], ["mentions", "Mentions"], ["follows", "Follows"], ["money", "Gifts & tips"], ["requests", "Requests"]];
  const ICON = { like: "heart-fill", comment_like: "heart-fill", story_reaction: "heart-fill", comment: "comment", reply: "reply", follow: "user-plus", follow_request: "user-plus", follow_accepted: "check", mention: "at", tag: "tag",
    message_request: "send", story_reply: "reply", live_started: "live", live_scheduled: "calendar", gift_received: "gift", donation_received: "coin", donation_refunded: "refresh", earnings_available: "wallet", withdrawal_update: "wallet", credits_added: "coin", report_update: "shield", content_removed: "shield", system: "info" };

  function row(n) {
    const actors = n.actors?.length ? n.actors : n.actor ? [n.actor] : [];
    return `<li class="s-notif ${n.read ? "" : "unread"}" data-ids="${(n.ids ?? [n.id]).join(",")}">
      <a class="s-notif-link" href="${SX.notificationHref(n)}">
        <span class="s-notif-avs">${actors.length ? actors.slice(0, 2).map((a) => SX.avatar(a, "sm", { link: false })).join("") : `<span class="s-notif-sys">${I(ICON[n.type] ?? "bell", "i-sm")}</span>`}<i class="s-notif-type t-${n.category}">${I(ICON[n.type] ?? "bell", "i-xs")}</i></span>
        <span class="s-notif-text">${SX.notificationText(n)} <time>${SX.ago(n.created_at)}</time></span>
        ${n.preview ? `<img class="s-notif-thumb" src="${n.preview}" alt="" loading="lazy">` : ""}
      </a>
      ${n.type === "follow" && actors[0] ? SX.followBtn(actors[0], "none", "sm") : ""}
    </li>`;
  }

  SX.route("/social/notifications", {
    title: "Notifications", active: "notifications",
    render: (p, q) => `<header class="s-page-head row"><h1 class="s-h2">Notifications</h1><div class="s-row"><button class="s-btn sm" data-readall>${I("check", "i-sm")} Mark all read</button><a class="s-icon-btn" href="#/social/settings?tab=notifications" aria-label="Notification settings">${I("settings")}</a></div></header>
      <div data-push></div>
      <div class="s-tabs scroll" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${(q.tab ?? "all") === k}">${l}${k === "requests" ? ` <span class="s-badge inline" data-freq hidden></span>` : ""}</button>`).join("")}</div>
      <ul class="s-notif-list" data-list></ul>`,
    async mount(el, p, q) {
      let tab = TABS.some(([k]) => k === q.tab) ? q.tab : "all", inf;
      const list = el.querySelector("[data-list]");
      const freq = el.querySelector("[data-freq]");
      if (SX.state.unread.follow_requests) { freq.hidden = false; freq.textContent = SX.state.unread.follow_requests; }
      if ("Notification" in window && Notification.permission === "default") {
        el.querySelector("[data-push]").innerHTML = `<div class="s-card s-push-cta">${I("bell", "i-sm")}<div class="grow"><b>Get notified while this tab is in the background</b><p class="muted">Browser notifications work while TUNIBEAT is open in a tab. Push to closed browsers needs Web Push, which this server doesn’t have configured.</p></div><button class="s-btn sm primary" data-perm>Turn on</button></div>`;
        el.querySelector("[data-perm]").onclick = async () => { const r = await Notification.requestPermission(); el.querySelector("[data-push]").innerHTML = ""; SX.toast({ kind: "info", title: r === "granted" ? "Browser notifications on" : "Notifications stay off" }); };
      }
      const markSeen = (items) => {
        const ids = items.filter((n) => !n.read).flatMap((n) => n.ids ?? [n.id]);
        if (!ids.length) return;
        setTimeout(() => api.post("/api/notifications/read", { ids }).then((r) => { SX.state.unread.notifications = r.unread; SX.updateBadges(); }).catch(() => {}), 1500);
      };
      const start = () => {
        inf?.destroy(); list.innerHTML = "";
        if (tab === "requests") { inf = null; return requests(); }
        inf = SX.infinite({
          list, load: (c) => api.get(`/api/notifications${SX.qs({ filter: tab, cursor: c })}`),
          render: (items) => items.map(row).join(""), after: markSeen,
          empty: SX.empty({ icon: "bell", title: "No notifications yet", body: tab === "money" ? "Gifts, tips and payout updates will show up here." : "When people interact with you, you’ll see it here." }),
        });
        inf.more();
      };
      async function requests() {
        const r = await api.get("/api/me/follow-requests");
        list.innerHTML = r.items.map((u) => `<li class="s-notif" data-req="${u.id}"><div class="s-notif-link">${SX.avatar(u, "sm")}<span class="s-notif-text">${SX.name(u, { handle: true })} wants to follow you <time>${SX.ago(u.requested_at)}</time></span></div>
          <div class="s-row"><button class="s-btn sm primary" data-decide="accept">Confirm</button><button class="s-btn sm" data-decide="decline">Delete</button></div></li>`).join("") || `<li>${SX.empty({ icon: "user-plus", title: "No follow requests", body: SX.state.me.is_private ? "When someone asks to follow your private account, it shows up here." : "Your account is public, so people can follow you without a request." })}</li>`;
      }
      start();
      el.addEventListener("click", async (e) => {
        const t = e.target.closest("[data-tab]");
        if (t) { tab = t.dataset.tab; el.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === t)); BF.setQuery({ tab: tab === "all" ? "" : tab }); start(); }
        if (e.target.closest("[data-readall]")) { const r = await api.post("/api/notifications/read", { all: true }).catch(SX.fail); if (r) { SX.state.unread.notifications = 0; SX.updateBadges(); list.querySelectorAll(".unread").forEach((x) => x.classList.remove("unread")); } }
        const d = e.target.closest("[data-decide]");
        if (d) {
          const li = d.closest("[data-req]");
          try { await api.post(`/api/me/follow-requests/${li.dataset.req}/${d.dataset.decide}`); li.innerHTML = `<p class="muted">${d.dataset.decide === "accept" ? "Request confirmed." : "Request removed."}</p>`; SX.refreshUnread?.(); } catch (err) { SX.fail(err); }
        }
      });
      SX.bindFollow(el);
      const off = SX.ws.on("notification", (m) => { if (tab === "all" || (tab === "money" && ["gifts", "donations", "earnings"].includes(m.item.category)) || (tab === "follows" && m.item.category === "follows") || (tab === "mentions" && ["mentions", "comments"].includes(m.item.category))) { list.insertAdjacentHTML("afterbegin", row({ ...m.item, actors: m.item.actor ? [m.item.actor] : [] })); markSeen([m.item]); } });
      return () => { inf?.destroy(); off(); };
    },
  });
})();
