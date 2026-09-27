/* Authentication — sign in, sign up, email verification, forgot/reset password, onboarding.
   Everything goes through the server (/api/auth/*); sessions are HttpOnly cookies. */
(function () {
  const I = BF.icon, ui = BF.ui, esc = BF.esc;

  const shell = (body, { quote = true } = {}) => {
    const arts = BF.BEATS.slice(0, 9).map((b) => b.art);
    return `<div class="auth">
      <aside class="auth-art" aria-hidden="true">
        <a class="brand" href="#/" tabindex="-1">${BF.brand.logo(30)}</a>
        <div class="auth-wall">${arts.map((a) => `<img src="${a}" alt="">`).join("")}</div>
        ${quote ? `<figure class="auth-quote"><blockquote>${BF.brand.tagline}</blockquote><figcaption>${BF.BEATS.length} beats · ${BF.PRODUCERS.length} producers · ${BF.RELEASES.length} releases in the stores</figcaption></figure>` : ""}
      </aside>
      <div class="auth-main"><a class="brand auth-mobile-brand" href="#/">${BF.brand.logo(28)}</a><div class="auth-card">${body}</div>
        <p class="auth-foot subtle">© ${new Date().getFullYear()} ${BF.brand.legalEntity} · <a href="#/legal/privacy">Privacy</a> · <a href="#/legal/terms">Terms</a></p></div>
    </div>`;
  };
  const errBox = `<div class="notice error" data-err hidden role="alert">${I("alert-circle", "i-sm")}<div data-err-msg></div></div>`;
  const pwField = (id, label, auto, extra = "") => `<div class="field"><label class="label" for="${id}">${label}${extra}</label><div class="input-group"><input class="input" id="${id}" type="password" autocomplete="${auto}" required maxlength="200" style="padding-right:48px"><button type="button" class="icon-btn sm input-suffix" data-reveal="${id}" aria-label="Show password" aria-pressed="false">${I("eye", "i-sm")}</button></div><div class="field-error">${I("alert-circle", "i-xs")} <span></span></div></div>`;
  const setErr = (inp, msg) => { const f = inp.closest(".field"); f.classList.toggle("has-error", !!msg); inp.setAttribute("aria-invalid", !!msg); const s = f.querySelector(".field-error span"); if (s) s.textContent = msg || ""; return !msg; };
  const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle("is-loading", on); if (on && !btn.querySelector(".spinner")) btn.insertAdjacentHTML("beforeend", '<span class="spinner"></span>'); if (!on) btn.querySelector(".spinner")?.remove(); };
  const showErr = (el, msg) => { const b = el.querySelector("[data-err]"); b.hidden = !msg; if (msg) { b.querySelector("[data-err-msg]").innerHTML = msg; b.scrollIntoView({ block: "nearest" }); } };
  const nextFrom = (q) => (q.next && /^\/[\w/?=&.-]*$/.test(q.next) && !q.next.startsWith("//") ? "#" + q.next : "#/");
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function common(el) {
    el.addEventListener("click", (e) => {
      const r = e.target.closest("[data-reveal]");
      if (r) { const inp = el.querySelector("#" + r.dataset.reveal); const show = inp.type === "password"; inp.type = show ? "text" : "password"; r.setAttribute("aria-pressed", show); r.setAttribute("aria-label", show ? "Hide password" : "Show password"); r.innerHTML = I(show ? "eye-off" : "eye", "i-sm"); }
    });
    el.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("has-error"));
  }
  async function signedIn(user) {
    await BF.store.hydrate(user);
    BF.social?.boot?.(true).catch(() => {});
  }

  /* ---------- SIGN IN ---------- */
  BF.route("/login", {
    title: "Sign in", layout: "auth",
    render: () => shell(`<h1 class="h2">Welcome back</h1><p class="muted" style="margin:6px 0 24px">Sign in to your libraries, cart and storefront. One account for both stores and Social.</p>
      ${errBox}
      <form class="stack-16" novalidate data-f>
        <div class="field"><label class="label" for="li-login">Email or username</label><input class="input" id="li-login" autocomplete="username" required maxlength="254"><div class="field-error">${I("alert-circle", "i-xs")} <span></span></div></div>
        ${pwField("li-pw", "Password", "current-password", `<a class="link" href="#/forgot" style="font-weight:500">Forgot?</a>`)}
        <button class="btn btn-primary btn-lg btn-block">Sign in</button>
      </form>
      <div data-demo></div>
      <p class="muted" style="margin-top:24px;text-align:center;font-size:14px">New to ${BF.brand.displayName}? <a class="link" href="#/signup">Create an account</a></p>`),
    mount(el, _, q) {
      common(el);
      if (BF.store.get("session").signedIn) { location.replace(nextFrom(q)); return; }
      el.querySelector("[data-f]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const lg = el.querySelector("#li-login"), pw = el.querySelector("#li-pw"), btn = e.target.querySelector(".btn-primary");
        const ok = [setErr(lg, lg.value.trim() ? "" : "Enter your email or username."), setErr(pw, pw.value ? "" : "Enter your password.")].every(Boolean);
        if (!ok) return el.querySelector(".has-error input").focus();
        busy(btn, true); showErr(el, "");
        try {
          const r = await BF.http.post("/api/auth/login", { login: lg.value.trim(), password: pw.value });
          await signedIn(r.user);
          ui.toast({ title: `Welcome back, ${esc(r.user.display_name.split(" ")[0])}` });
          location.hash = nextFrom(q);
        } catch (err) {
          busy(btn, false);
          showErr(el, err.code === "invalid_credentials" ? `${esc(err.message)} <a class="link" href="#/forgot">Reset your password</a>?` : esc(err.message));
          pw.select();
        }
      });
      // Development only: seeded demo accounts have no passwords
      if (BF.env?.dev_tools) BF.http.get("/api/auth/demo-accounts").then((r) => {
        const order = ["kairovance", "rafi.listens", "mira.kaan", "nova.keys", "tunibeat.team"];
        const acc = r.accounts.filter((a) => order.includes(a.username)).sort((a, b) => order.indexOf(a.username) - order.indexOf(b.username));
        const box = el.querySelector("[data-demo]"); if (!box) return;
        box.innerHTML = `<div class="demo-accounts"><div class="demo-head">${I("info", "i-xs")} <b>Development only:</b> sign in as a seeded account.</div>
          <div class="demo-grid">${acc.map((a) => `<button class="btn btn-secondary btn-sm" data-demo-user="${esc(a.username)}">@${esc(a.username)}<span class="subtle">${a.username === "kairovance" ? "producer & label" : a.role === "admin" ? "admin" : a.is_creator ? "creator" : "buyer"}</span></button>`).join("")}</div></div>`;
        box.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-demo-user]"); if (!b) return;
          busy(b, true);
          try { const r2 = await BF.http.post("/api/auth/demo", { username: b.dataset.demoUser }); await signedIn(r2.user); location.hash = nextFrom(q); }
          catch (err) { busy(b, false); showErr(el, esc(err.message)); }
        });
      }).catch(() => {});
    },
  });

  /* ---------- SIGN UP ---------- */
  BF.route("/signup", {
    title: "Create account", layout: "auth",
    render: (_, q) => shell(`<h1 class="h2">${q.role === "producer" ? "Start selling your beats" : "Create your account"}</h1><p class="muted" style="margin:6px 0 24px">${q.role === "producer" ? "Free to start. Your storefront is created with your first upload." : "Save favourites, follow producers and labels, and buy music."}</p>
      ${errBox}
      <form class="stack-16" novalidate data-f>
        <div class="field"><label class="label" for="su-name">Name</label><input class="input" id="su-name" autocomplete="name" required maxlength="50"><div class="field-error">${I("alert-circle", "i-xs")} <span></span></div></div>
        <div class="field"><label class="label" for="su-user">Username</label><input class="input" id="su-user" autocomplete="username" required maxlength="24" pattern="[A-Za-z0-9_.]{3,24}"><span class="hint">3–24 letters, numbers, dots or underscores. Also your store address.</span><div class="field-error">${I("alert-circle", "i-xs")} <span></span></div></div>
        <div class="field"><label class="label" for="su-email">Email</label><input class="input" id="su-email" type="email" autocomplete="email" required maxlength="254"><div class="field-error">${I("alert-circle", "i-xs")} <span></span></div></div>
        ${pwField("su-pw", "Password", "new-password")}
        <div class="pw-meter" aria-live="polite"><div class="pw-bars"><span></span><span></span><span></span><span></span></div><ul class="pw-rules"><li data-r="len">10+ characters</li><li data-r="num">A number</li><li data-r="case">Upper & lower case</li></ul></div>
        <label class="check" style="align-items:flex-start"><input type="checkbox" id="su-terms" style="margin-top:3px"> <span>I agree to the <a class="link" href="#/legal/terms">Terms</a> and <a class="link" href="#/legal/privacy">Privacy Policy</a>.</span></label>
        <p class="field-error" data-terms-err>${I("alert-circle", "i-xs")} Please accept the terms to continue.</p>
        <button class="btn btn-primary btn-lg btn-block">Create account</button>
      </form>
      <p class="muted" style="margin-top:24px;text-align:center;font-size:14px">Already have an account? <a class="link" href="#/login">Sign in</a></p>`),
    mount(el, _, q) {
      common(el);
      const pw = el.querySelector("#su-pw");
      const score = (v) => { const r = { len: v.length >= 10, num: /\d/.test(v), case: /[a-z]/.test(v) && /[A-Z]/.test(v) }; return { r, n: Object.values(r).filter(Boolean).length + (v.length >= 14 ? 1 : 0) }; };
      pw.addEventListener("input", () => {
        const { r, n } = score(pw.value);
        el.querySelectorAll(".pw-bars span").forEach((b, i) => (b.dataset.on = i < n ? ["weak", "ok", "good", "strong"][n - 1] : ""));
        Object.entries(r).forEach(([k, ok]) => el.querySelector(`[data-r="${k}"]`).classList.toggle("ok", ok));
      });
      el.querySelector("[data-f]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const n = el.querySelector("#su-name"), un = el.querySelector("#su-user"), em = el.querySelector("#su-email"), terms = el.querySelector("#su-terms");
        const ok = [setErr(n, n.value.trim() ? "" : "Tell us your name."), setErr(un, /^[A-Za-z0-9_.]{3,24}$/.test(un.value.trim()) ? "" : "3–24 letters, numbers, dots or underscores."),
          setErr(em, EMAIL.test(em.value.trim()) ? "" : "Enter a valid email."), setErr(pw, pw.value.length >= 10 ? "" : "Use at least 10 characters.")].every(Boolean);
        el.querySelector("[data-terms-err]").style.display = terms.checked ? "none" : "flex";
        if (!ok || !terms.checked) return (el.querySelector(".has-error input") || terms).focus();
        const btn = e.target.querySelector(".btn-primary"); busy(btn, true); showErr(el, "");
        try {
          const r = await BF.http.post("/api/auth/signup", { display_name: n.value.trim(), username: un.value.trim(), email: em.value.trim(), password: pw.value });
          await signedIn(r.user);
          location.hash = "#/verify" + (q.role ? "?role=" + encodeURIComponent(q.role) : "");
        } catch (err) {
          busy(btn, false);
          const field = { username_taken: un, invalid_username: un, email_taken: em, invalid_email: em, weak_password: pw, invalid_name: n }[err.code];
          if (field) { setErr(field, err.message); field.focus(); } else showErr(el, esc(err.message));
        }
      });
    },
  });

  /* ---------- EMAIL VERIFICATION ---------- */
  BF.route("/verify", {
    title: "Verify your email", layout: "auth",
    render(_, q) {
      const s = BF.store.get("session");
      if (!s.signedIn) return shell(ui.empty({ icon: "mail", title: "Sign in to verify your email", actions: `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent("/verify")}">Sign in</a>` }), { quote: false });
      if (s.user.emailVerified) return shell(ui.empty({ icon: "check", title: "Your email is verified", actions: `<a class="btn btn-primary" href="#/onboarding${q.role ? "?role=" + encodeURIComponent(q.role) : ""}">Continue</a>` }), { quote: false });
      return shell(`<div class="state-icon" style="width:56px;height:56px;border-radius:14px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-text);margin-bottom:20px">${I("mail")}</div>
        <h1 class="h2">Verify your email</h1><p class="muted" style="margin:6px 0 24px">We sent a 6-digit code to <b style="color:var(--text)">${esc(s.user.email)}</b>. It expires in 30 minutes.</p>
        <form novalidate data-f><fieldset class="otp" aria-label="Verification code">${Array.from({ length: 6 }, (_, i) => `<input class="input mono" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" autocomplete="${i === 0 ? "one-time-code" : "off"}">`).join("")}</fieldset>
          <p class="field-error" data-otp-err style="margin-top:10px">${I("alert-circle", "i-xs")} <span></span></p>
          <button class="btn btn-primary btn-lg btn-block" style="margin-top:20px">Verify email</button></form>
        <p class="muted" style="margin-top:20px;font-size:14px;text-align:center">Didn’t get it? <button class="link" data-resend disabled>Resend in <span data-count>30</span>s</button></p>
        ${BF.env?.dev_tools ? `<p class="hint" style="text-align:center;margin-top:8px">${I("info", "i-xs")} Development: no email provider is configured, so mail goes to the <button class="link" data-outbox>developer outbox</button>.</p><pre class="dev-outbox" data-outbox-body hidden></pre>` : ""}
        <p style="text-align:center;margin-top:12px"><a class="link" href="#/onboarding${q.role ? "?role=" + encodeURIComponent(q.role) : ""}" style="font-size:13px">Skip for now</a></p>`, { quote: false });
    },
    mount(el, _, q) {
      const inputs = [...el.querySelectorAll(".otp input")];
      if (!inputs.length) return;
      const err = (msg) => { const x = el.querySelector("[data-otp-err]"); x.style.display = msg ? "flex" : "none"; x.querySelector("span").textContent = msg || ""; };
      inputs.forEach((inp, i) => {
        inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, ""); if (inp.value && inputs[i + 1]) inputs[i + 1].focus(); err(""); if (inputs.every((x) => x.value)) el.querySelector("[data-f]").requestSubmit(); });
        inp.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !inp.value && inputs[i - 1]) inputs[i - 1].focus(); if (e.key === "ArrowLeft" && inputs[i - 1]) inputs[i - 1].focus(); if (e.key === "ArrowRight" && inputs[i + 1]) inputs[i + 1].focus(); });
        inp.addEventListener("paste", (e) => { const d = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (!d) return; e.preventDefault(); d.split("").forEach((c, j) => inputs[j] && (inputs[j].value = c)); inputs[Math.min(d.length, 5)].focus(); if (d.length === 6) el.querySelector("[data-f]").requestSubmit(); });
      });
      inputs[0].focus();
      let n = 30, t = null;
      const countdown = () => { clearInterval(t); n = 30; const b = el.querySelector("[data-resend]"); b.disabled = true; b.innerHTML = `Resend in <span data-count>${n}</span>s`; t = setInterval(() => { n--; const c = el.querySelector("[data-count]"); if (c) c.textContent = n; if (n <= 0) { clearInterval(t); b.disabled = false; b.textContent = "Resend code"; } }, 1000); };
      countdown();
      el.addEventListener("click", async (e) => {
        if (e.target.closest("[data-resend]") && !e.target.closest("[data-resend]").disabled) {
          try { await BF.http.post("/api/auth/verify-email/resend"); ui.toast({ kind: "info", title: "New code sent" }); countdown(); } catch (x) { ui.toast({ kind: "error", title: "Couldn’t send a new code", desc: esc(x.message) }); }
        }
        if (e.target.closest("[data-outbox]")) {
          const r = await BF.http.get("/api/dev/outbox");
          const box = el.querySelector("[data-outbox-body]"); box.hidden = false;
          box.textContent = r.items.map((m) => `${new Date(m.created_at).toLocaleTimeString()} · ${m.subject}\n${m.body}`).join("\n\n") || "No mail yet.";
        }
      });
      el.querySelector("[data-f]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = inputs.map((x) => x.value).join("");
        if (code.length < 6) return err("Enter all 6 digits.");
        const btn = e.target.querySelector(".btn-primary"); busy(btn, true);
        try {
          const r = await BF.http.post("/api/auth/verify-email", { code });
          await BF.store.hydrate(r.user);
          ui.toast({ title: "Email verified" });
          location.hash = "#/onboarding" + (q.role ? "?role=" + encodeURIComponent(q.role) : "");
        } catch (x) {
          busy(btn, false); err(x.message); inputs.forEach((i) => (i.value = "")); inputs[0].focus();
        }
      });
      return () => clearInterval(t);
    },
  });

  /* ---------- FORGOT PASSWORD ---------- */
  BF.route("/forgot", {
    title: "Reset password", layout: "auth",
    render: () => shell(`<a class="link" href="#/login" style="display:inline-flex;gap:6px;align-items:center;font-size:14px;margin-bottom:20px">${I("arrow-left", "i-sm")} Back to sign in</a>
      <div data-stage="ask"><h1 class="h2">Reset your password</h1><p class="muted" style="margin:6px 0 24px">Enter the email on your account and we’ll send a reset link.</p>
        ${errBox}
        <form class="stack-16" novalidate data-f><div class="field"><label class="label" for="fp-email">Email</label><input class="input" id="fp-email" type="email" autocomplete="email" required maxlength="254"><div class="field-error">${I("alert-circle", "i-xs")} <span></span></div></div><button class="btn btn-primary btn-lg btn-block">Send reset link</button></form></div>
      <div data-stage="sent" hidden>${ui.empty({ icon: "mail", title: "Check your inbox", body: `If an account uses <b data-sent-to></b>, a reset link is on its way. It expires in 30 minutes.` })}
        ${BF.env?.dev_tools ? `<p class="hint" style="text-align:center">${I("info", "i-xs")} Development: <button class="link" data-devmail>show the email</button> (no email provider configured).</p><pre class="dev-outbox" data-devmail-body hidden></pre>` : ""}</div>`, { quote: false }),
    mount(el) {
      common(el);
      let email = "";
      el.querySelector("[data-f]").addEventListener("submit", async (e) => {
        e.preventDefault(); const em = el.querySelector("#fp-email");
        if (!setErr(em, EMAIL.test(em.value.trim()) ? "" : "Enter a valid email.")) return em.focus();
        const btn = e.target.querySelector("button"); busy(btn, true);
        try {
          await BF.http.post("/api/auth/password/forgot", { email: em.value.trim() });
          email = em.value.trim();
          el.querySelector('[data-stage="ask"]').hidden = true; el.querySelector('[data-stage="sent"]').hidden = false; el.querySelector("[data-sent-to]").textContent = email;
        } catch (err) { busy(btn, false); showErr(el, esc(err.message)); }
      });
      el.addEventListener("click", async (e) => {
        if (!e.target.closest("[data-devmail]")) return;
        const r = await BF.http.get(`/api/dev/mail?email=${encodeURIComponent(email)}`);
        const box = el.querySelector("[data-devmail-body]"); box.hidden = false;
        const m = r.items.find((x) => x.subject.includes("Reset"));
        box.innerHTML = m ? esc(m.body).replace(/(https?:\/\/\S+|\/#\/reset\?token=\S+)/, (u) => `<a class="link" href="${esc(u.slice(u.indexOf("#")))}">${esc(u)}</a>`) : "No reset email (there’s no account with that address).";
      });
    },
  });

  /* ---------- RESET PASSWORD (from the emailed link) ---------- */
  BF.route("/reset", {
    title: "Choose a new password", layout: "auth",
    render: (_, q) => shell(!q.token ? ui.empty({ icon: "alert", title: "This reset link is incomplete", actions: `<a class="btn btn-primary" href="#/forgot">Request a new link</a>` }) : `<h1 class="h2">Choose a new password</h1><p class="muted" style="margin:6px 0 24px">You’ll be signed out everywhere else.</p>
      ${errBox}
      <form class="stack-16" novalidate data-f>${pwField("rp-pw", "New password", "new-password")}${pwField("rp-pw2", "Repeat password", "new-password")}<button class="btn btn-primary btn-lg btn-block">Save password</button></form>`, { quote: false }),
    mount(el, _, q) {
      common(el);
      el.querySelector("[data-f]")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const a = el.querySelector("#rp-pw"), b = el.querySelector("#rp-pw2");
        const ok = [setErr(a, a.value.length >= 10 ? "" : "Use at least 10 characters."), setErr(b, a.value === b.value ? "" : "The passwords don’t match.")].every(Boolean);
        if (!ok) return el.querySelector(".has-error input").focus();
        const btn = e.target.querySelector(".btn-primary"); busy(btn, true);
        try {
          const r = await BF.http.post("/api/auth/password/reset", { token: q.token, password: a.value });
          await signedIn(r.user);
          ui.toast({ title: "Password changed", desc: "Other devices were signed out." });
          location.hash = "#/";
        } catch (err) { busy(btn, false); if (err.code === "weak_password") setErr(a, err.message); else showErr(el, `${esc(err.message)} <a class="link" href="#/forgot">Request a new link</a>`); }
      });
    },
  });

  /* ---------- ONBOARDING (preferences; follows are saved to the account) ---------- */
  BF.route("/onboarding", {
    title: "Welcome", layout: "auth",
    render: () => shell(`<div data-ob></div>`, { quote: false }),
    mount(el, _, q) {
      const S = { step: 1, role: q.role === "producer" ? "producer" : "", genres: [], follows: [] };
      const host = el.querySelector("[data-ob]");
      const me = BF.store.get("session").user;
      const dots = () => `<div class="ob-dots" aria-hidden="true">${[1, 2, 3].map((i) => `<span class="${i <= S.step ? "on" : ""}"></span>`).join("")}</div><p class="sr-only">Step ${S.step} of 3</p>`;
      const paint = () => {
        if (S.step === 1) host.innerHTML = `${dots()}<h1 class="h2">What brings you here?</h1><p class="muted" style="margin:6px 0 24px">We’ll point you to the right store. You can change this anytime.</p>
          <div class="role-grid" role="radiogroup" aria-label="Account type">${[["artist", "mic", "I’m an artist", "Find beats, license them, and release music."], ["producer", "disc", "I’m a producer", "Sell beats, set licenses, grow a fanbase."], ["both", "layers", "Both", "I make beats and write over them too."], ["dj", "headphones", "I’m a DJ or listener", "Discover and buy electronic music from artists and labels."]].map(([v, ic, t, d]) => `<label class="role-card"><input type="radio" name="role" value="${v}" ${S.role === v ? "checked" : ""}><span class="rc-icon">${I(ic, "i-lg")}</span><span class="rc-t">${t}</span><span class="rc-d">${d}</span><span class="rc-check">${I("check", "i-xs")}</span></label>`).join("")}</div>
          <button class="btn btn-primary btn-lg btn-block" data-next style="margin-top:24px" ${S.role ? "" : "disabled"}>Continue</button>`;
        if (S.step === 2) {
          const dj = S.role === "dj";
          const follow = dj ? BF.LABELS.slice(0, 4).map((l) => [l.id, BF.mui.labelLogo(l, 32), l.name, l.genres.map((g) => BF.egenre(g).name).slice(0, 2).join(" · ")])
            : BF.PRODUCERS.slice(0, 4).map((p) => [p.id, `<div class="avatar sm"><img src="${p.avatar}" alt=""></div>`, p.name, p.genres.map((g) => BF.genreById[g]?.name).filter(Boolean).join(" · ")]);
          host.innerHTML = `${dots()}<h1 class="h2">${dj ? "What do you play?" : "What are you into?"}</h1><p class="muted" style="margin:6px 0 24px">Pick a few genres and ${dj ? "labels" : "producers"} to follow.</p>
            <div class="chip-wrap" role="group" aria-label="Genres">${(dj ? BF.egenres().filter((g) => g.visible !== false).slice(0, 16) : BF.GENRES).map((g) => `<button class="chip" data-g="${g.id}" aria-pressed="${S.genres.includes(g.id)}">${esc(g.name)}</button>`).join("")}</div>
            <h2 class="h4" style="margin:24px 0 10px">${dj ? "Labels" : "Producers"} to follow</h2><div class="ob-follow">${follow.map(([id, pic, name, sub]) => `<div class="ob-prod">${pic}<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px">${esc(name)}</div><div class="subtle" style="font-size:12.5px">${esc(sub)}</div></div><button class="btn btn-sm ${BF.store.isFollowing(id) ? "btn-secondary" : "btn-outline"}" data-f="${id}" aria-pressed="${BF.store.isFollowing(id)}">${BF.store.isFollowing(id) ? "Following" : "Follow"}</button></div>`).join("")}</div>
            ${S.role === "producer" || S.role === "both" ? `<p class="hint" style="margin-top:18px">${I("store", "i-xs")} Your storefront will live at <span class="mono">${BF.brand.domain}/beats/producer/${esc(me?.handle ?? "you")}</span> once you upload your first beat.</p>` : ""}
            <div style="display:flex;gap:10px;margin-top:28px"><button class="btn btn-ghost btn-lg" data-back>Back</button><button class="btn btn-primary btn-lg" style="flex:1" data-next>Continue</button></div>`;
        }
        if (S.step === 3) {
          const dest = S.role === "dj" ? { href: `#/electronic/discover${S.genres.length ? "?genre=" + S.genres.join(",") : ""}`, label: "Enter the Electronic Music Store" }
            : S.role === "artist" ? { href: `#/beats/catalog${S.genres.length ? "?genre=" + S.genres.join(",") : ""}`, label: "Enter the Beats Store" } : { href: "#/dashboard/upload", label: "Upload your first beat" };
          host.innerHTML = `${dots()}<div class="state-icon" style="width:56px;height:56px;border-radius:14px;display:grid;place-items:center;background:var(--success-soft);color:var(--success);margin-bottom:20px">${I("check")}</div>
            <h1 class="h2">You’re all set.</h1><p class="muted" style="margin:6px 0 20px">${S.follows.length ? `Following ${S.follows.length}. ` : ""}${me?.emailVerified ? "" : "Verify your email before you sell or withdraw earnings."}</p>
            <a class="btn btn-primary btn-lg btn-block" href="${dest.href}">${dest.label} ${I("arrow-right", "i-sm")}</a>
            ${S.role === "both" ? `<a class="btn btn-ghost btn-block" href="#/" style="margin-top:8px">Or choose a store to explore</a>` : ""}`;
        }
        host.querySelector("h1").tabIndex = -1; host.querySelector("h1").focus();
      };
      host.addEventListener("change", (e) => { if (e.target.name === "role") { S.role = e.target.value; host.querySelector("[data-next]").disabled = false; } });
      host.addEventListener("click", (e) => {
        const g = e.target.closest("[data-g]"); if (g) { const id = g.dataset.g; S.genres = S.genres.includes(id) ? S.genres.filter((x) => x !== id) : [...S.genres, id]; g.setAttribute("aria-pressed", S.genres.includes(id)); }
        const f = e.target.closest("[data-f]");
        if (f) { const on = BF.store.toggleFollow(f.dataset.f); if (on !== false || BF.store.get("session").signedIn) { const now = BF.store.isFollowing(f.dataset.f); S.follows = now ? [...new Set([...S.follows, f.dataset.f])] : S.follows.filter((x) => x !== f.dataset.f); f.setAttribute("aria-pressed", now); f.textContent = now ? "Following" : "Follow"; f.classList.toggle("btn-secondary", now); f.classList.toggle("btn-outline", !now); } }
        if (e.target.closest("[data-next]")) { S.step++; paint(); }
        if (e.target.closest("[data-back]")) { S.step--; paint(); }
      });
      paint();
    },
  });
})();
