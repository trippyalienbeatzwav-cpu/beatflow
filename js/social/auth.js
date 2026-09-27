/* ==========================================================================
   TUNIBEAT Social — sign in / sign up (server sessions), plus development demo accounts
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;

  SX.route("/social/login", {
    title: "Sign in", active: "", public: true, bare: true,
    render: () => `<div class="s-auth"><div class="s-auth-card s-card">
      <a class="s-brand big" href="#/social">${BF.brand.mark(40)}<span class="s-brand-word">${esc(BF.brand.name)}<em>Social</em></span></a>
      <p class="muted">Share your sound: posts, reels, stories and live sessions with the TUNIBEAT community.</p>
      <div class="s-seg" role="tablist"><button role="tab" data-m="in" aria-selected="true">Sign in</button><button role="tab" data-m="up" aria-selected="false">Create account</button></div>
      <form class="s-form" data-in>
        <label class="s-field"><span>Username or email</span><input class="s-input" name="login" autocomplete="username" required></label>
        <label class="s-field"><span>Password</span><input class="s-input" name="password" type="password" autocomplete="current-password" required></label>
        <p class="s-form-err" data-err role="alert" hidden></p>
        <button class="s-btn primary lg block">Sign in</button></form>
      <form class="s-form" data-up hidden>
        <label class="s-field"><span>Name</span><input class="s-input" name="display_name" maxlength="50" autocomplete="name" required></label>
        <label class="s-field"><span>Username</span><input class="s-input" name="username" maxlength="24" pattern="[A-Za-z0-9_.]{3,24}" autocomplete="username" required><small class="muted">3–24 letters, numbers, dots or underscores</small></label>
        <label class="s-field"><span>Email</span><input class="s-input" name="email" type="email" autocomplete="email" required></label>
        <label class="s-field"><span>Password</span><input class="s-input" name="password" type="password" minlength="10" autocomplete="new-password" required><small class="muted">At least 10 characters</small></label>
        <p class="s-form-err" data-err role="alert" hidden></p>
        <button class="s-btn primary lg block">Create account</button>
        <p class="s-fine">By creating an account you agree to the <a href="#/legal/terms">Terms</a> and <a href="#/legal/privacy">Privacy Policy</a>.</p></form>
      <div data-demo></div>
      <a class="s-exit" href="#/">${I("arrow-left", "i-sm")} Back to the stores</a>
    </div></div>`,
    async mount(el, p, q) {
      const next = q.next && q.next.startsWith("/social") ? "#" + q.next : "#/social";
      if (SX.state.me) { location.replace(next); return; }
      el.addEventListener("click", (e) => {
        const m = e.target.closest("[data-m]"); if (!m) return;
        el.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-selected", b === m));
        el.querySelector("[data-in]").hidden = m.dataset.m !== "in"; el.querySelector("[data-up]").hidden = m.dataset.m !== "up";
      });
      const done = async () => { await Promise.all([SX.boot(true), BF.boot()]); location.replace(next); };
      const bind = (sel, url, fields) => el.querySelector(sel).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target, err = f.querySelector("[data-err]"), btn = f.querySelector("button.primary");
        btn.disabled = true; err.hidden = true;
        try { await api.post(url, Object.fromEntries(fields.map((k) => [k, f[k].value]))); await done(); }
        catch (x) { err.hidden = false; err.textContent = x.message; btn.disabled = false; }
      });
      bind("[data-in]", "/api/auth/login", ["login", "password"]);
      bind("[data-up]", "/api/auth/signup", ["display_name", "username", "email", "password"]);
      try {
        const r = await api.get("/api/auth/demo-accounts");
        const order = ["nova.keys", "rafi.listens", "mira.kaan", "tunibeat.team"];
        const acc = r.accounts.sort((a, b) => (order.indexOf(a.username) + 1 || 99) - (order.indexOf(b.username) + 1 || 99));
        el.querySelector("[data-demo]").innerHTML = `<div class="s-demo"><div class="s-demo-head">${I("info", "i-xs")} <b>Development only:</b> sign in as a seeded demo account (no password).</div>
          <div class="s-demo-grid">${acc.map((a) => `<button class="s-demo-acc" data-demo="${esc(a.username)}">${SX.avatar({ ...a }, "sm", { link: false })}<span><b>${esc(a.display_name)}</b><small>@${esc(a.username)}${a.role === "admin" ? " · admin" : a.is_creator ? " · creator" : a.is_private ? " · private" : " · fan"}</small></span></button>`).join("")}</div></div>`;
        el.querySelector("[data-demo]").addEventListener("click", async (e) => {
          const b = e.target.closest("[data-demo]"); if (!b) return;
          b.disabled = true;
          try { await api.post("/api/auth/demo", { username: b.dataset.demo }); await done(); } catch (x) { SX.fail(x); b.disabled = false; }
        });
      } catch { /* not in development */ }
    },
  });
})();
