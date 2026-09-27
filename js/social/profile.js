/* ==========================================================================
   TUNIBEAT Social — profiles, follower lists, edit profile and settings
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;

  SX.route("/social/u/:username", {
    title: (p) => `@${p.username}`, active: (p) => (p.username === SX.state.me?.username ? "profile" : "explore"),
    async mount(el, p, q) {
      const u = await api.get(`/api/users/${encodeURIComponent(p.username)}`);
      const own = u.relationship.self;
      document.title = `${u.display_name} (@${u.username}) — TUNIBEAT Social`;
      const tabs = [["posts", "Posts", "grid"], ["reels", "Reels", "reels"], ["tagged", "Tagged", "tag"], ...(own ? [["saved", "Saved", "bookmark"]] : [])];
      let tab = tabs.some(([k]) => k === q.tab) ? q.tab : "posts";
      const tray = await api.get(`/api/stories/user/${u.id}`).catch(() => ({ items: [] }));
      const hasStory = tray.items.length > 0;
      const unseen = tray.items.some((s) => !s.seen && !s.is_author);
      const rel = u.relationship;
      el.innerHTML = `<div class="s-profile">
        <div class="s-cover">${u.cover_url ? `<img src="${u.cover_url}" alt="">` : ""}</div>
        <div class="s-prof-head">
          <button class="s-prof-av ${hasStory ? "has-story" : ""}" data-story ${hasStory ? "" : "disabled"} aria-label="${hasStory ? `View ${esc(u.display_name)}’s story` : esc(u.display_name)}">${SX.avatar(u, "xl", { link: false, ring: hasStory, story: hasStory ? (unseen ? "new" : "seen") : null, live: !!u.live })}</button>
          <div class="s-prof-id">
            <h1 class="s-h3">${esc(u.display_name)}${u.is_verified ? SX.verified() : ""}${u.is_private ? ` <span class="s-lock" title="Private account">${I("lock", "i-xs")}</span>` : ""}</h1>
            <p class="s-handle">@${esc(u.username)}${u.is_creator ? ` · <span class="s-pill">Creator</span>` : ""}${rel.followed_by ? ` · <span class="s-pill">Follows you</span>` : ""}</p>
          </div>
          <div class="s-prof-actions">${own
            ? `<button class="s-btn" data-edit>${I("edit", "i-sm")} Edit profile</button><a class="s-btn" href="#/social/studio">${I("studio", "i-sm")} Studio</a><a class="s-icon-btn" href="#/social/settings" aria-label="Settings">${I("settings")}</a>`
            : rel.blocking ? `<button class="s-btn" data-unblock>Unblock</button>`
            : `${SX.followBtn({ ...u, relationship: rel }, rel.following, "")}${u.can_message ? `<button class="s-btn" data-message>${I("send", "i-sm")} Message</button>` : ""}
               ${u.supports.gifts ? `<button class="s-btn" data-gift aria-label="Send a gift">${I("gift", "i-sm")}</button>` : ""}${u.supports.tips ? `<button class="s-btn" data-tip aria-label="Send a tip">${I("coin", "i-sm")} Tip</button>` : ""}
               <button class="s-icon-btn" data-more aria-label="More options">${I("more")}</button>`}
          </div>
        </div>
        ${u.live ? `<a class="s-live-banner" href="#/social/live/${u.live.id}"><span class="s-live-badge">LIVE</span> ${esc(u.live.title)} <span>Watch now ${I("arrow-right", "i-xs")}</span></a>` : ""}
        ${u.bio ? `<p class="s-bio">${SX.rich(u.bio)}</p>` : ""}
        ${u.links?.length ? `<div class="s-links">${u.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow ugc">${I("link", "i-xs")} ${esc(l.label || l.url.replace(/^https?:\/\//, ""))}</a>`).join("")}</div>` : ""}
        <dl class="s-prof-stats">
          <div><dt>Posts</dt><dd>${SX.count(u.counts.posts + u.counts.reels)}</dd></div>
          <div><button data-list="followers" ${u.content_visible ? "" : "disabled"}><dt>Followers</dt><dd data-followers>${SX.count(u.counts.followers)}</dd></button></div>
          <div><button data-list="following" ${u.content_visible ? "" : "disabled"}><dt>Following</dt><dd>${SX.count(u.counts.following)}</dd></button></div>
          ${u.is_creator ? `<div><dt>Likes</dt><dd>${SX.count(u.counts.likes)}</dd></div>` : ""}
        </dl>
        ${u.content_visible ? `<div class="s-tabs icons" role="tablist" aria-label="Profile content">${tabs.map(([k, l, ic]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${I(ic, "i-sm")} <span>${l}</span></button>`).join("")}</div><div class="s-grid" data-grid></div>`
          : rel.blocking ? `<div class="s-private">${I("ban")}<h2 class="s-h5">You blocked @${esc(u.username)}</h2><p class="muted">Unblock to see their posts and let them find you again.</p></div>`
          : `<div class="s-private">${I("lock")}<h2 class="s-h5">This account is private</h2><p class="muted">${rel.following === "pending" ? "Your follow request is pending." : "Follow this account to see their posts, reels and stories."}</p></div>`}
      </div>`;

      let inf;
      const grid = el.querySelector("[data-grid]");
      const load = () => {
        if (!grid) return;
        inf?.destroy(); grid.innerHTML = "";
        inf = SX.infinite({
          list: grid, load: (c) => api.get(`/api/users/${u.id}/posts${SX.qs({ tab, cursor: c })}`), render: (items) => items.map(SX.gridCell).join(""),
          empty: SX.empty({ icon: tab === "reels" ? "reels" : tab === "saved" ? "bookmark" : tab === "tagged" ? "tag" : "image", title: tab === "saved" ? "Nothing saved yet" : tab === "tagged" ? "No tagged posts" : own ? "Share your first post" : "No posts yet", body: tab === "saved" ? "Only you can see what you’ve saved." : "", actions: own && tab === "posts" ? `<a class="s-btn primary" href="#/social/create">Create</a>` : "" }),
        });
        inf.more();
      };
      load();
      SX.bindFollow(el, (r) => { const f = el.querySelector("[data-followers]"); if (f && r.counts) f.textContent = SX.count(r.counts.followers); });
      el.addEventListener("click", async (e) => {
        const t = e.target.closest("[data-tab]");
        if (t) { tab = t.dataset.tab; el.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === t)); BF.setQuery({ tab: tab === "posts" ? "" : tab }); load(); }
        if (e.target.closest("[data-story]") && hasStory) SX.openStories([u.id], 0);
        if (e.target.closest("[data-edit]")) editProfile();
        if (e.target.closest("[data-message]")) {
          try { const r = await api.post("/api/conversations", { user_ids: [u.id] }); location.hash = `#/social/messages/${r.conversation.id}`; } catch (err) { SX.fail(err, "Can’t message this account"); }
        }
        if (e.target.closest("[data-gift]")) SX.openGifts({ recipient: u, contextType: "profile" });
        if (e.target.closest("[data-tip]")) SX.openTip({ recipient: u, contextType: "profile" });
        if (e.target.closest("[data-unblock]")) { await api.del(`/api/users/${u.id}/block`).catch(SX.fail); dispatchEvent(new HashChangeEvent("hashchange")); }
        const l = e.target.closest("[data-list]"); if (l) userList(u, l.dataset.list, own);
        if (e.target.closest("[data-more]")) {
          const toggle = async (kind, on, msg) => { try { on ? await api.del(`/api/users/${u.id}/${kind}`) : await api.post(`/api/users/${u.id}/${kind}`); SX.toast({ kind: "info", title: msg }); dispatchEvent(new HashChangeEvent("hashchange")); } catch (err) { SX.fail(err); } };
          SX.menu(`@${u.username}`, [
            { label: "Share profile", icon: "share", run: () => SX.copy(SX.absUrl(`#/social/u/${u.username}`)) },
            { label: rel.close_friend ? "Remove from close friends" : "Add to close friends", icon: "star-outline", run: () => (rel.close_friend ? api.del(`/api/me/close-friends/${u.id}`) : api.post(`/api/me/close-friends/${u.id}`)).then(() => { rel.close_friend = !rel.close_friend; SX.toast({ kind: "info", title: rel.close_friend ? "Added to close friends" : "Removed from close friends" }); }).catch(SX.fail) },
            { label: rel.muted ? "Unmute" : "Mute", icon: "volume-x", run: () => toggle("mute", rel.muted, rel.muted ? "Unmuted" : "Muted. Their posts and stories are hidden from your feeds.") },
            { label: rel.restricted ? "Unrestrict" : "Restrict", icon: "shield", run: () => toggle("restrict", rel.restricted, rel.restricted ? "Unrestricted" : "Restricted. Their new comments on your posts are only visible to them.") },
            { label: "Block", icon: "ban", danger: true, run: async () => { if (await SX.confirm({ title: `Block @${esc(u.username)}?`, body: "They won’t be able to find your profile, posts or stories, or message you. They won’t be notified.", confirmLabel: "Block", danger: true })) toggle("block", false, "Blocked"); } },
            { label: "Report account", icon: "flag", danger: true, run: () => SX.report("user", u.id, "account") },
          ]);
        }
      });
      return () => inf?.destroy();
    },
  });

  function userList(u, kind, own) {
    SX.sheet({
      title: kind === "followers" ? "Followers" : "Following", body: `<div class="s-user-list" data-ul></div>`,
      onMount: (bd) => {
        const list = bd.querySelector("[data-ul]");
        const inf = SX.infinite({
          list, load: (c) => api.get(`/api/users/${u.id}/${kind}${SX.qs({ cursor: c })}`),
          render: (items) => items.map((x) => `<div class="s-user-row" data-row="${x.id}">${SX.avatar(x, "sm")}<div class="grow">${SX.name(x, { handle: true })}</div>
            ${own && kind === "followers" ? `<button class="s-btn sm ghost" data-remove="${x.id}">Remove</button>` : ""}${x.relationship?.self ? "" : SX.followBtn(x, x.relationship?.following ?? "none", "sm")}</div>`).join(""),
          empty: `<p class="muted">Nobody here yet.</p>`,
        });
        inf.more();
        SX.bindFollow(bd);
        bd.addEventListener("click", async (e) => {
          const r = e.target.closest("[data-remove]"); if (!r) return;
          if (!(await SX.confirm({ title: "Remove follower?", body: "They won’t be notified. They can follow you again unless your account is private.", confirmLabel: "Remove" }))) return;
          try { await api.del(`/api/me/followers/${r.dataset.remove}`); r.closest("[data-row]").remove(); } catch (err) { SX.fail(err); }
        });
      },
    });
  }

  function editProfile() {
    const me = SX.state.me;
    SX.sheet({
      title: "Edit profile", wide: true,
      body: `<form class="s-form" data-ep>
        <div class="s-edit-media"><div class="s-cover sm" data-cover-pv>${me.cover_url ? `<img src="${me.cover_url}" alt="">` : ""}<button type="button" class="s-btn sm" data-pick="cover">${I("image", "i-xs")} Cover</button></div>
          <div class="s-edit-av">${SX.avatar(me, "lg", { link: false })}<button type="button" class="s-btn sm" data-pick="avatar">${I("camera", "i-xs")} Photo</button></div>
          <input type="file" accept="image/*" data-file hidden><span class="s-hint" data-up></span></div>
        <div class="s-row wrap"><label class="s-field grow"><span>Name</span><input class="s-input" name="display_name" maxlength="50" required value="${esc(me.display_name)}"></label>
          <label class="s-field grow"><span>Username</span><input class="s-input" name="username" maxlength="24" pattern="[A-Za-z0-9_.]{3,24}" required value="${esc(me.username)}"></label></div>
        <label class="s-field"><span>Bio</span><textarea name="bio" rows="3" maxlength="300">${esc(me.bio)}</textarea></label>
        <div class="s-field"><span>Links (up to 5)</span><div data-links>${[...me.links, {}].slice(0, 5).map((l, i) => linkRow(l, i)).join("")}</div><button type="button" class="s-btn sm ghost" data-add-link>${I("plus", "i-xs")} Add link</button></div>
        <label class="s-toggle"><input type="checkbox" name="is_private" ${me.is_private ? "checked" : ""}><span><b>Private account</b><small>Only approved followers see your posts, reels and followers list.</small></span></label>
        <label class="s-toggle"><input type="checkbox" name="is_creator" ${me.is_creator ? "checked" : ""}><span><b>Creator tools</b><small>Receive gifts and tips, see analytics, withdraw earnings.</small></span></label>
        <div class="s-form-actions"><button type="button" class="s-btn ghost" data-close>Cancel</button><button class="s-btn primary">Save</button></div></form>`,
      onMount: (bd, close) => {
        const form = bd.querySelector("[data-ep]");
        let target = null; const media = {};
        bd.addEventListener("click", (e) => {
          const pick = e.target.closest("[data-pick]"); if (pick) { target = pick.dataset.pick; bd.querySelector("[data-file]").click(); }
          if (e.target.closest("[data-add-link]")) { const box = bd.querySelector("[data-links]"); if (box.children.length < 5) box.insertAdjacentHTML("beforeend", linkRow({}, box.children.length)); }
          const rm = e.target.closest("[data-rm-link]"); if (rm) rm.closest(".s-link-row").remove();
        });
        bd.querySelector("[data-file]").addEventListener("change", async (e) => {
          const f = e.target.files[0]; e.target.value = ""; if (!f) return;
          const s = bd.querySelector("[data-up]");
          try {
            s.textContent = "Uploading…";
            const img = await SX.processImage(f, { max: target === "cover" ? 1800 : 800 });
            const m = await SX.upload(img.file, { purpose: target, onProgress: (x) => (s.textContent = `Uploading ${Math.round(x * 100)}%`) });
            media[`${target}_media_id`] = m.id;
            if (target === "cover") bd.querySelector("[data-cover-pv]").querySelector("img")?.remove(), bd.querySelector("[data-cover-pv]").insertAdjacentHTML("afterbegin", `<img src="${m.url}" alt="">`);
            else bd.querySelector(".s-edit-av .s-av").innerHTML = `<img src="${m.url}" alt="">`;
            s.textContent = "Ready. Save to apply.";
          } catch (err) { s.textContent = ""; SX.fail(err, "Upload failed"); }
        });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const links = [...bd.querySelectorAll(".s-link-row")].map((r) => ({ label: r.querySelector("[name=label]").value, url: r.querySelector("[name=url]").value.trim() })).filter((l) => l.url);
          try {
            const r = await api.patch("/api/me/profile", { display_name: form.display_name.value, username: form.username.value, bio: form.bio.value, links, is_private: form.is_private.checked, is_creator: form.is_creator.checked, ...media });
            SX.state.me = { ...SX.state.me, ...r.user };
            close(); SX.toast({ title: "Profile saved" });
            location.hash = `#/social/u/${r.user.username}`;
            dispatchEvent(new HashChangeEvent("hashchange"));
          } catch (err) { SX.fail(err, "Couldn’t save"); }
        });
      },
    });
  }
  const linkRow = (l, i) => `<div class="s-link-row"><input class="s-input" name="label" maxlength="40" placeholder="Label" value="${esc(l.label ?? "")}" aria-label="Link ${i + 1} label"><input class="s-input grow" name="url" type="url" placeholder="https://" value="${esc(l.url ?? "")}" aria-label="Link ${i + 1} URL"><button type="button" class="s-icon-btn sm" data-rm-link aria-label="Remove link">${I("x", "i-xs")}</button></div>`;

  /* ---------- Settings ---------- */
  const SET_TABS = [["privacy", "Privacy", "lock"], ["notifications", "Notifications", "bell"], ["safety", "Blocked & muted", "shield"], ["friends", "Close friends", "star-outline"], ["account", "Account", "user"]];
  SX.route("/social/settings", {
    title: "Settings", active: "settings",
    render: (p, q) => `<header class="s-page-head"><h1 class="s-h2">Settings</h1></header>
      <div class="s-settings"><nav class="s-set-nav" aria-label="Settings sections">${SET_TABS.map(([k, l, ic]) => `<a href="#/social/settings?tab=${k}" data-st="${k}" ${(q.tab ?? "privacy") === k ? 'aria-current="page"' : ""}>${I(ic, "i-sm")} ${l}</a>`).join("")}${SX.state.env?.dev_tools ? `<a href="#/social/settings?tab=dev" data-st="dev" ${q.tab === "dev" ? 'aria-current="page"' : ""}>${I("mail", "i-sm")} Developer outbox</a>` : ""}</nav>
      <section class="s-set-body s-card" data-body>${SX.skeletonRows(4)}</section></div>`,
    async mount(el, p, q) {
      const tab = q.tab ?? "privacy";
      const body = el.querySelector("[data-body]");
      const sel = (name, label, help, opts, val) => `<label class="s-set-row"><span><b>${label}</b><small>${help}</small></span><select class="s-input" name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
      const tog = (name, label, help, on, disabled = false) => `<label class="s-set-row"><span><b>${label}</b><small>${help}</small></span><input type="checkbox" class="s-switch" name="${name}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}></label>`;
      if (tab === "privacy") {
        const [pv, me] = [await api.get("/api/me/privacy"), SX.state.me];
        body.innerHTML = `<form data-pv><h2 class="s-h5">Privacy</h2>
          ${tog("is_private", "Private account", "Only people you approve can see your posts, reels and followers.", me.is_private)}
          ${sel("messages", "Who can message you", "Others’ messages go to Requests (or are blocked).", [["everyone", "Everyone"], ["following", "People you follow"], ["nobody", "No one"]], pv.messages)}
          ${sel("comments", "Who can comment", "Applies to all your posts.", [["everyone", "Everyone"], ["followers", "Your followers"], ["off", "Off"]], pv.comments)}
          ${sel("mentions", "Who can @mention you", "Blocked mentions don’t link or notify you.", [["everyone", "Everyone"], ["following", "People you follow"], ["nobody", "No one"]], pv.mentions)}
          ${sel("tags", "Who can tag you in posts", "", [["everyone", "Everyone"], ["following", "People you follow"], ["nobody", "No one"]], pv.tags)}
          ${sel("story_audience", "Default story audience", "You can change it per story.", [["public", "Everyone who can see your profile"], ["followers", "Followers"], ["close_friends", "Close friends"]], pv.story_audience)}
          ${sel("live_audience", "Default live audience", "", [["public", "Everyone"], ["followers", "Followers"]], pv.live_audience)}
          ${tog("activity_status", "Show activity status", "When off, others can’t see when you’re active, and you can’t see theirs.", pv.activity_status)}
          ${tog("show_like_counts", "Show like counts on your posts", "", pv.show_like_counts)}
          ${tog("allow_tips", "Accept tips", "Creators only. Turn off to pause tips everywhere.", pv.allow_tips, !me.is_creator)}
          <p class="s-hint" data-saved></p></form>`;
        body.querySelector("[data-pv]").addEventListener("change", async (e) => {
          const t = e.target;
          try {
            if (t.name === "is_private") { const r = await api.patch("/api/me/profile", { is_private: t.checked }); SX.state.me = { ...SX.state.me, ...r.user }; }
            else await api.patch("/api/me/privacy", { [t.name]: t.type === "checkbox" ? t.checked : t.value });
            body.querySelector("[data-saved]").textContent = "Saved ✓";
          } catch (err) { SX.fail(err); }
        });
      }
      if (tab === "notifications") {
        const r = await api.get("/api/me/notification-prefs");
        body.innerHTML = `<h2 class="s-h5">Notifications</h2><p class="muted">In-app notifications appear in your inbox. Browser notifications show while TUNIBEAT is open in a background tab (permission: <b>${"Notification" in window ? Notification.permission : "unsupported"}</b>).</p>
          <table class="s-table prefs"><thead><tr><th scope="col">Category</th><th scope="col">In app</th><th scope="col">Browser</th></tr></thead><tbody>
          ${r.items.map((x) => `<tr><th scope="row">${esc(x.label)}${x.locked ? `<small class="muted"> · always on</small>` : ""}</th><td><input type="checkbox" class="s-switch" data-cat="${x.category}" data-k="in_app" ${x.in_app ? "checked" : ""} ${x.locked ? "disabled" : ""} aria-label="${esc(x.label)} in app"></td><td><input type="checkbox" class="s-switch" data-cat="${x.category}" data-k="push" ${x.push ? "checked" : ""} aria-label="${esc(x.label)} browser"></td></tr>`).join("")}</tbody></table>`;
        body.addEventListener("change", async (e) => {
          const c = e.target.dataset.cat; if (!c) return;
          const row = body.querySelectorAll(`[data-cat="${c}"]`);
          try { await api.patch("/api/me/notification-prefs", { [c]: { in_app: row[0].checked, push: row[1].checked } }); SX.toast({ kind: "info", title: "Saved" }); } catch (err) { SX.fail(err); }
        });
      }
      if (tab === "safety") {
        const [b, m, r] = await Promise.all(["blocked", "muted", "restricted"].map((k) => api.get(`/api/me/relationships/${k}`)));
        const sec = (title, help, items, kind) => `<h3 class="s-h6">${title}</h3><p class="muted">${help}</p><div class="s-user-list">${items.map((u) => `<div class="s-user-row">${SX.avatar(u, "sm")}<div class="grow">${SX.name(u, { handle: true })}</div><button class="s-btn sm" data-undo="${kind}" data-uid="${u.id}">${kind === "block" ? "Unblock" : kind === "mute" ? "Unmute" : "Unrestrict"}</button></div>`).join("") || `<p class="s-fine">No one.</p>`}</div>`;
        body.innerHTML = `<h2 class="s-h5">Blocked & muted</h2>${sec("Blocked", "Blocked accounts can’t find you, see your content or message you.", b.items, "block")}${sec("Muted", "You won’t see their posts or stories in your feeds. They aren’t told.", m.items, "mute")}${sec("Restricted", "Their new comments on your posts are visible only to them. They aren’t told.", r.items, "restrict")}`;
        body.addEventListener("click", async (e) => { const u = e.target.closest("[data-undo]"); if (!u) return; await api.del(`/api/users/${u.dataset.uid}/${u.dataset.undo}`).catch(SX.fail); u.closest(".s-user-row").remove(); });
      }
      if (tab === "friends") {
        const draw = async () => {
          const r = await api.get("/api/me/relationships/close_friends");
          body.innerHTML = `<h2 class="s-h5">Close friends</h2><p class="muted">Share stories with just these people. They aren’t notified when you add or remove them.</p>
            <input class="s-input" data-cfq placeholder="Search people to add" aria-label="Search people to add"><div class="s-user-list" data-cfs></div>
            <div class="s-user-list">${r.items.map((u) => `<div class="s-user-row">${SX.avatar(u, "sm")}<div class="grow">${SX.name(u, { handle: true })}</div><button class="s-btn sm" data-cf-rm="${u.id}">Remove</button></div>`).join("") || `<p class="s-fine">No close friends yet.</p>`}</div>`;
          let t;
          body.querySelector("[data-cfq]").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(async () => { const q2 = e.target.value.trim(); if (!q2) return (body.querySelector("[data-cfs]").innerHTML = ""); const s = await api.get(`/api/search/suggest?q=${encodeURIComponent(q2)}`).catch(() => ({ users: [] })); body.querySelector("[data-cfs]").innerHTML = s.users.filter((u) => u.id !== SX.state.me.id).map((u) => `<div class="s-user-row">${SX.avatar(u, "sm", { link: false })}<div class="grow">${SX.name(u, { link: false, handle: true })}</div><button class="s-btn sm primary" data-cf-add="${u.id}">Add</button></div>`).join(""); }, 200); });
        };
        await draw();
        body.addEventListener("click", async (e) => {
          const a = e.target.closest("[data-cf-add]"); if (a) { await api.post(`/api/me/close-friends/${a.dataset.cfAdd}`).catch(SX.fail); draw(); }
          const r = e.target.closest("[data-cf-rm]"); if (r) { await api.del(`/api/me/close-friends/${r.dataset.cfRm}`).catch(SX.fail); draw(); }
        });
      }
      if (tab === "account") {
        const me = SX.state.me;
        body.innerHTML = `<h2 class="s-h5">Account</h2><dl class="s-dl"><div><dt>Username</dt><dd>@${esc(me.username)}</dd></div><div><dt>Email</dt><dd>${esc(me.email ?? "—")}</dd></div><div><dt>Role</dt><dd>${esc(me.role)}</dd></div><div><dt>Joined</dt><dd>${new Date(me.created_at).toLocaleDateString()}</dd></div></dl>
          <div class="s-row wrap"><button class="s-btn" data-edit-p>${I("edit", "i-sm")} Edit profile</button><a class="s-btn" href="#/">${I("arrow-left", "i-sm")} Back to the stores</a><button class="s-btn danger" data-signout-s>${I("logout", "i-sm")} Sign out</button></div>`;
        body.querySelector("[data-edit-p]").onclick = editProfile;
        body.querySelector("[data-signout-s]").onclick = async () => { await api.post("/api/auth/logout").catch(() => {}); SX.state.me = null; SX.ws.disconnect(); SX.boot(true).catch(() => {}); location.hash = "#/social/login"; };
      }
      if (tab === "dev") {
        const r = await api.get("/api/dev/outbox");
        body.innerHTML = `<h2 class="s-h5">Developer outbox</h2><p class="muted">Development only. Emails that would be sent (such as withdrawal codes) are stored here because no email provider is configured.</p>
          ${r.items.map((m) => `<article class="s-mail"><header><b>${esc(m.subject)}</b><time>${SX.when(m.created_at)}</time></header><pre>${esc(m.body)}</pre></article>`).join("") || `<p class="s-fine">Empty.</p>`}`;
      }
    },
  });
})();
