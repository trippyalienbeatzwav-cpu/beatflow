/* ==========================================================================
   TUNIBEAT Social — gifts, tips, wallet, Creator Studio and withdrawals
   All amounts shown come from the server. The client sends ids and idempotency
   keys only, never prices. In development, payments run through a clearly labelled
   sandbox checkout where no money moves.
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const testMode = () => !!SX.state.env?.payments?.test_mode;
  const TEST_BADGE = `<span class="s-test-badge">${I("info", "i-xs")} TEST MODE</span>`;

  /* ---------- Checkout (sandbox or provider redirect) ---------- */
  SX.checkout = (checkout, { title, amount, what }) => new Promise((resolve) => {
    if (!checkout) return resolve("failed");
    if (checkout.type === "redirect") { location.href = checkout.url; return; }
    let settled = false;
    const close = SX.sheet({
      title: "Sandbox checkout",
      body: `<div class="s-checkout">
        <div class="s-checkout-test" role="note">${I("shield", "i-sm")}<div><b>Test mode: no real money moves.</b><p>This stands in for the payment provider’s secure checkout page. No card details are collected and nothing is charged.</p></div></div>
        <dl class="s-checkout-sum"><div><dt>${esc(what)}</dt><dd>${esc(amount)}</dd></div></dl>
        <div class="s-form-actions col">
          <button class="s-btn primary lg block" data-pay="succeed">${I("check", "i-sm")} Approve test payment</button>
          <button class="s-btn block" data-pay="decline">Simulate a declined card</button>
          <button class="s-btn ghost block" data-close>Cancel</button></div></div>`,
      onMount: (bd, doClose) => bd.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-pay]"); if (!b) return;
        bd.querySelectorAll("[data-pay]").forEach((x) => (x.disabled = true));
        b.innerHTML = `<span class="s-spinner sm"></span> Processing…`;
        try {
          const r = await api.post(`/api/payments/sandbox/${checkout.session}/complete`, { outcome: b.dataset.pay });
          settled = true; doClose();
          resolve(r.status === "succeeded" || r.already ? "succeeded" : "failed");
        } catch (err) { SX.fail(err, "Payment failed"); settled = true; doClose(); resolve("failed"); }
      }),
    });
    const obs = new MutationObserver(() => { if (!document.querySelector(".s-checkout")) { obs.disconnect(); if (!settled) resolve("cancelled"); } });
    obs.observe(document.body, { childList: true });
    void close; void title;
  });

  /* ---------- Buy credits ---------- */
  SX.buyCredits = ({ need = 0, onDone } = {}) => SX.sheet({
    title: "Buy credits",
    body: `<div class="s-buy">${testMode() ? `<div class="s-testmode inline">${TEST_BADGE} Purchases use the sandbox. No real money moves.</div>` : ""}
      ${need ? `<p class="s-need">${I("info", "i-xs")} You need <b>${SX.count(need)}</b> more credits for that gift.</p>` : ""}
      <p class="muted">Credits are used for gifts. They can’t be withdrawn or transferred.</p>
      <div class="s-packs" data-packs>${SX.skeletonRows(2)}</div></div>`,
    onMount: async (bd, close) => {
      const w = await api.get("/api/wallet");
      if (!w.payments.available) { bd.querySelector("[data-packs]").innerHTML = SX.empty({ icon: "wallet", title: "Purchases unavailable", body: "This server has no payment provider configured." }); return; }
      bd.querySelector("[data-packs]").innerHTML = w.packages.map((p) => `<button class="s-pack ${p.credits >= need && need ? "fit" : ""}" data-pack="${p.id}">${I("coin")}<b>${SX.count(p.credits)}</b><span>credits</span><em>${SX.money(p.amount_cents, p.currency)}</em></button>`).join("");
      bd.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-pack]"); if (!b) return;
        const pack = w.packages.find((p) => p.id === b.dataset.pack);
        bd.querySelectorAll("[data-pack]").forEach((x) => (x.disabled = true));
        try {
          const r = await api.post("/api/wallet/purchases", { package_id: pack.id, idempotency_key: SX.ikey() });
          close();
          const res = await SX.checkout(r.checkout, { what: `${SX.count(pack.credits)} credits`, amount: SX.money(pack.amount_cents, pack.currency) });
          if (res === "succeeded") {
            const w2 = await api.get("/api/wallet"); SX.state.me.credits = w2.credits;
            BF.$$("[data-credits]").forEach((x) => (x.textContent = SX.count(w2.credits)));
            SX.toast({ title: `${SX.count(pack.credits)} credits added`, desc: testMode() ? "Test purchase. No money moved." : "Receipt in your wallet." });
            onDone?.(w2.credits);
          } else if (res === "failed") SX.toast({ kind: "error", title: "Payment declined", desc: "No credits were added." });
        } catch (err) { SX.fail(err, "Couldn’t start checkout"); bd.querySelectorAll("[data-pack]").forEach((x) => (x.disabled = false)); }
      });
    },
  });

  /* ---------- Gifts ---------- */
  let skipConfirmUnder = 0;   // "don't ask again" threshold for this session
  SX.openGifts = ({ recipient, contextType, contextId }) => SX.sheet({
    title: `Send a gift to ${esc(recipient.display_name)}`,
    body: `<div class="s-gifts"><div class="s-gifts-bal">${I("coin", "i-sm")} <span><b data-bal>…</b> credits</span><button class="s-btn sm" data-buy>Buy credits</button></div>
      <div class="s-gift-grid" data-grid role="radiogroup" aria-label="Gifts">${SX.skeletonRows(2)}</div>
      <div data-confirm></div>
      <p class="s-fine">Gifts are virtual items paid with credits. ${esc(recipient.display_name)} earns part of each gift’s value. Gifts aren’t refundable once sent.</p></div>`,
    onMount: async (bd) => {
      const [cat, w] = await Promise.all([api.get(`/api/gifts/catalog?context=${contextType}`), api.get("/api/wallet")]);
      let credits = w.credits, sel = null, key = null;
      const bal = () => (bd.querySelector("[data-bal]").textContent = SX.count(credits));
      bal();
      bd.querySelector("[data-grid]").innerHTML = cat.items.map((g) => `<button class="s-gift" role="radio" aria-checked="false" data-g="${g.id}"><span class="s-gift-ic ${g.animation}">${SX.giftIcon(g.icon)}</span><b>${esc(g.name)}</b><span>${I("coin", "i-xs")} ${SX.count(g.credit_cost)}</span></button>`).join("") || `<p class="muted">No gifts available here.</p>`;
      const confirm = () => {
        const box = bd.querySelector("[data-confirm]");
        if (!sel) { box.innerHTML = ""; return; }
        const short = sel.credit_cost > credits;
        key = SX.ikey();   // one key per confirmation: double taps can’t send twice
        box.innerHTML = `<div class="s-gift-confirm ${short ? "short" : ""}">
          <div><span class="s-gift-ic big ${sel.animation}">${SX.giftIcon(sel.icon)}</span></div>
          <div class="grow"><b>${esc(sel.name)}</b> for <b>${SX.count(sel.credit_cost)} credits</b>
            <p class="muted">${short ? `You have ${SX.count(credits)}. You need ${SX.count(sel.credit_cost - credits)} more.` : `Balance after: ${SX.count(credits - sel.credit_cost)} credits`}</p>
            ${!short ? `<label class="s-check"><input type="checkbox" data-skip> Don’t ask again this session for gifts up to ${SX.count(sel.credit_cost)} credits</label>` : ""}</div>
          ${short ? `<button class="s-btn primary" data-buy-need="${sel.credit_cost - credits}">Buy credits</button>` : `<button class="s-btn primary" data-send>Send gift</button>`}</div>`;
      };
      const send = async (btn) => {
        if (btn) { btn.disabled = true; btn.innerHTML = `<span class="s-spinner sm"></span> Sending…`; }
        try {
          const r = await api.post("/api/gifts/send", { gift_id: sel.id, recipient_id: recipient.id, context_type: contextType, context_id: contextId, idempotency_key: key });
          credits = r.credits; bal(); SX.state.me.credits = credits;
          SX.toast({ title: `${esc(sel.name)} sent`, desc: `${esc(recipient.display_name)} will see it${contextType === "live" ? " on stream" : ""}.` });
          key = SX.ikey(); confirm();
        } catch (err) {
          if (err.code === "insufficient_credits") { credits = err.extra.credits ?? credits; bal(); confirm(); }
          else SX.fail(err, "Gift not sent");
          if (btn) { btn.disabled = false; btn.textContent = "Send gift"; }
        }
      };
      bd.addEventListener("click", (e) => {
        const g = e.target.closest("[data-g]");
        if (g) {
          sel = cat.items.find((x) => x.id === g.dataset.g);
          bd.querySelectorAll("[data-g]").forEach((x) => x.setAttribute("aria-checked", x === g));
          // Quick re-send without confirm only when the user opted in and the gift is within their threshold
          if (sel.credit_cost <= skipConfirmUnder && sel.credit_cost <= credits) { key = SX.ikey(); send(null); return; }
          confirm();
        }
        const s = e.target.closest("[data-send]");
        if (s) { if (bd.querySelector("[data-skip]")?.checked) skipConfirmUnder = sel.credit_cost; send(s); }
        if (e.target.closest("[data-buy]") || e.target.closest("[data-buy-need]")) {
          const need = Number(e.target.closest("[data-buy-need]")?.dataset.buyNeed ?? 0);
          SX.buyCredits({ need, onDone: (c) => { credits = c; bal(); confirm(); } });
        }
      });
    },
  });

  /* ---------- Tips (real money through the payment provider) ---------- */
  SX.openTip = ({ recipient, contextType, contextId }) => SX.sheet({
    title: `Tip ${esc(recipient.display_name)}`,
    body: `<form class="s-form s-tip" data-tip>${testMode() ? `<div class="s-testmode inline">${TEST_BADGE} Tips run in the payment sandbox here. No real money moves.</div>` : ""}
      <p class="muted">A tip is a direct payment to the creator, separate from gifts and credits.</p>
      <fieldset class="s-amounts" data-amounts><legend class="sr-only">Amount</legend>${[200, 500, 1000, 2000].map((c, i) => `<label class="s-amount"><input type="radio" name="preset" value="${c}" ${i === 1 ? "checked" : ""}><span>${SX.money(c)}</span></label>`).join("")}
        <label class="s-amount custom"><input type="radio" name="preset" value="custom"><span>Other</span></label></fieldset>
      <label class="s-field" data-custom hidden><span>Amount (USD)</span><input class="s-input" name="custom" type="number" inputmode="decimal" step="0.01"></label>
      <label class="s-field"><span>Message (optional)</span><input class="s-input" name="message" maxlength="200" placeholder="Say thanks…"></label>
      <div class="s-tip-sum" data-sum></div>
      <div class="s-form-actions"><button type="button" class="s-btn ghost" data-close>Cancel</button><button class="s-btn primary" data-go>Continue to payment</button></div></form>`,
    onMount: async (bd, close) => {
      const w = await api.get("/api/wallet");
      const s = w.settings.donation;
      const form = bd.querySelector("[data-tip]");
      const key = SX.ikey();
      const cents = () => form.preset.value === "custom" ? Math.round(Number(form.custom.value || 0) * 100) : Number(form.preset.value);
      form.custom.min = (s.min_cents / 100).toFixed(2); form.custom.max = (s.max_cents / 100).toFixed(2);
      const sum = () => {
        bd.querySelector("[data-custom]").hidden = form.preset.value !== "custom";
        const c = cents();
        const ok = Number.isInteger(c) && c >= s.min_cents && c <= s.max_cents;
        const fee = Math.round((c * s.fee_bps) / 10000);
        bd.querySelector("[data-sum]").innerHTML = ok
          ? `<dl><div><dt>You pay</dt><dd>${SX.money(c)}</dd></div><div><dt>Platform fee (${s.fee_bps / 100}%)</dt><dd>−${SX.money(fee)}</dd></div><div class="total"><dt>${esc(recipient.display_name)} receives</dt><dd>${SX.money(c - fee)}</dd></div></dl><p class="s-fine">Earnings clear after a short hold period. Refunds follow our tipping policy.</p>`
          : `<p class="s-hint warn">Tips are between ${SX.money(s.min_cents)} and ${SX.money(s.max_cents)}.</p>`;
        bd.querySelector("[data-go]").disabled = !ok;
      };
      form.addEventListener("input", sum); sum();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = bd.querySelector("[data-go]"); btn.disabled = true;
        try {
          const r = await api.post("/api/donations", { recipient_id: recipient.id, amount_cents: cents(), currency: "USD", message: form.message.value, context_type: contextType, context_id: contextId, idempotency_key: key });
          close();
          const res = await SX.checkout(r.checkout, { what: `Tip for @${recipient.username}`, amount: SX.money(r.donation.amount_cents) });
          if (res === "succeeded") SX.toast({ title: "Tip sent", desc: `${SX.money(r.donation.amount_cents)} to ${esc(recipient.display_name)}${r.donation.test_mode ? " (test mode)" : ""}` });
          else if (res === "failed") SX.toast({ kind: "error", title: "Payment declined", desc: "Your tip wasn’t sent." });
        } catch (err) { SX.fail(err, "Couldn’t start tip"); btn.disabled = false; }
      });
    },
  });

  /* ---------- Transactions ---------- */
  const TX = {
    credit_purchase: ["Credits purchased", "coin"], gift_sent: ["Gift sent", "gift"], gift_received: ["Gift received", "gift"], donation_sent: ["Tip sent", "send"], donation_received: ["Tip received", "coin"],
    platform_fee: ["Platform fee", "percent"], earning_release: ["Earnings cleared", "check"], withdrawal: ["Withdrawal", "arrow-up-right"], withdrawal_reversal: ["Withdrawal returned", "refresh"],
    refund: ["Refund", "refresh"], refund_reversal: ["Refund reversal", "refresh"], adjustment: ["Adjustment", "edit"],
  };
  const BUCKET = { wallet: "Credits", pending: "Pending", available: "Available", held: "Held", external: "Card / bank" };
  const txRow = (t) => {
    const [label, ic] = TX[t.type] ?? [t.type, "receipt"];
    const amt = t.unit === "credits" ? `${t.amount > 0 ? "+" : "−"}${SX.count(Math.abs(t.amount))} cr` : `${t.amount > 0 ? "+" : "−"}${SX.money(Math.abs(t.amount), t.currency ?? "USD")}`;
    return `<li class="s-tx"><span class="s-tx-ic">${I(ic, "i-sm")}</span>
      <div class="grow"><b>${label}</b>${t.note ? ` · <span>${esc(t.note)}</span>` : ""}${t.counterparty ? ` · ${t.amount < 0 ? "to" : "from"} @${esc(t.counterparty.username)}` : ""}
        <div class="s-tx-meta"><span>${SX.when(t.created_at)}</span><span>${BUCKET[t.balance]}</span>${t.status !== "completed" ? `<span class="s-pill ${t.status === "pending" ? "warn" : ""}">${t.status}</span>` : ""}${t.test_mode ? `<span class="s-pill test">test</span>` : ""}<button class="s-txid" data-copy="${t.id}" title="Copy transaction ID">${t.id}</button></div></div>
      <span class="s-tx-amt ${t.amount > 0 ? "in" : "out"}">${amt}</span></li>`;
  };
  function bindCopy(root) { root.addEventListener("click", (e) => { const b = e.target.closest("[data-copy]"); if (b) SX.copy(b.dataset.copy); }); }

  /* ---------- Wallet ---------- */
  SX.route("/social/wallet", {
    title: "Wallet", active: "wallet",
    render: () => `<header class="s-page-head"><h1 class="s-h2">Wallet</h1></header>
      <div class="s-wallet-top">
        <div class="s-card s-balance"><span class="s-kicker">Credits</span><div class="s-big">${I("coin")} <span data-credits>…</span></div><p class="muted">For sending gifts in lives, on posts and profiles.</p><button class="s-btn primary" data-buy>Buy credits</button></div>
        <div class="s-card s-balance alt" data-creator></div>
      </div>
      <section class="s-card"><div class="s-row between"><h2 class="s-h5">Transactions</h2><div class="s-seg sm" role="tablist">${[["", "All"], ["wallet", "Credits & payments"], ["earnings", "Earnings"]].map(([k, l], i) => `<button role="tab" data-scope="${k}" aria-selected="${!i}">${l}</button>`).join("")}</div></div>
        <ul class="s-tx-list" data-tx></ul></section>
      <section class="s-card s-explain"><h2 class="s-h5">How money works on TUNIBEAT Social</h2>
        <div class="s-explain-grid"><div>${I("gift")}<b>Gifts</b><p>Virtual items bought with credits. Creators earn a share of each gift’s value.</p></div>
        <div>${I("coin")}<b>Tips</b><p>Direct payments to a creator, processed by our payment provider every time. Not credits.</p></div>
        <div>${I("clock")}<b>Pending → available</b><p>Creator earnings clear after a hold period that covers refunds and chargebacks, then they can be withdrawn.</p></div></div></section>`,
    async mount(el, p, q) {
      const w = await api.get("/api/wallet");
      el.querySelector("[data-credits]").textContent = SX.count(w.credits);
      const b = w.balances;
      el.querySelector("[data-creator]").innerHTML = SX.state.me.is_creator
        ? `<span class="s-kicker">Creator earnings</span><div class="s-big">${SX.money(b.available_cents)}</div><p class="muted">Available · ${SX.money(b.pending_cents)} pending${b.held_cents ? ` · ${SX.money(b.held_cents)} in withdrawal` : ""}</p><a class="s-btn" href="#/social/studio">Open Creator Studio</a>`
        : `<span class="s-kicker">Are you a creator?</span><p class="muted">Turn on creator tools to receive gifts and tips.</p><a class="s-btn" href="#/social/studio">Learn more</a>`;
      const list = el.querySelector("[data-tx]");
      let scope = "", inf;
      // After a purchase the balance and the transaction list both come from the server again
      el.querySelector("[data-buy]").onclick = () => SX.buyCredits({ onDone: (c) => { el.querySelector("[data-credits]").textContent = SX.count(c); start(); } });
      const start = () => {
        inf?.destroy(); list.innerHTML = "";
        inf = SX.infinite({ list, load: (c) => api.get(`/api/wallet/transactions${SX.qs({ scope, cursor: c })}`), render: (items) => items.map(txRow).join(""), empty: SX.empty({ icon: "receipt", title: "No transactions yet", body: "Credit purchases, gifts, tips and payouts will appear here." }) });
        inf.more();
      };
      start();
      el.querySelector(".s-seg").addEventListener("click", (e) => { const t = e.target.closest("[data-scope]"); if (!t) return; scope = t.dataset.scope; el.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-selected", x === t)); start(); });
      bindCopy(el);
      if (q.paid) SX.toast({ title: "Payment confirmed" });
      return () => inf?.destroy();
    },
  });

  /* ---------- Creator Studio ---------- */
  SX.route("/social/studio", {
    title: "Creator Studio", active: "studio",
    async mount(el, p, q) {
      const me = SX.state.me;
      if (!me.is_creator) {
        el.innerHTML = `<div class="s-card s-hero-card">${I("studio")}<h1 class="s-h2">Creator Studio</h1><p class="muted">Turn on creator tools to receive gifts and tips, see analytics and withdraw earnings. You can turn it off any time.</p>
          <button class="s-btn primary lg" data-enable>Turn on creator tools</button></div>`;
        el.querySelector("[data-enable]").onclick = async () => { try { const r = await api.patch("/api/me/profile", { is_creator: true }); SX.state.me = { ...SX.state.me, ...r.user }; BF.$("#main") && window.dispatchEvent(new HashChangeEvent("hashchange")); } catch (err) { SX.fail(err); } };
        return;
      }
      let days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
      const offs = [];
      const draw = async () => {
        const d = await api.get(`/api/creator/overview?days=${days}`);
        const t = d.totals, b = d.balances;
        el.innerHTML = `<header class="s-page-head row"><div><h1 class="s-h2">Creator Studio</h1><p class="muted">@${esc(me.username)} · ${SX.count(d.followers)} followers</p></div>
            <div class="s-seg sm" role="tablist" aria-label="Range">${[7, 30, 90].map((n) => `<button role="tab" data-days="${n}" aria-selected="${n === days}">${n}d</button>`).join("")}</div></header>
          <section class="s-bal-grid" aria-label="Balances">
            <div class="s-card s-bal"><span class="s-kicker">Available</span><b data-b="available">${SX.money(b.available_cents)}</b><button class="s-btn sm primary" data-withdraw ${b.available_cents < d.settings.withdrawal.min_cents ? "disabled" : ""}>Withdraw</button><small class="muted">Minimum ${SX.money(d.settings.withdrawal.min_cents)}</small></div>
            <div class="s-card s-bal"><span class="s-kicker">Pending</span><b data-b="pending">${SX.money(b.pending_cents)}</b><small class="muted">Clears after ${fmtHold(d.settings.earnings_hold_seconds)}</small></div>
            <div class="s-card s-bal"><span class="s-kicker">In withdrawal</span><b data-b="held">${SX.money(b.held_cents)}</b><small class="muted">Being paid out</small></div>
            <div class="s-card s-bal"><span class="s-kicker">Lifetime net</span><b data-b="lifetime">${SX.money(b.lifetime_cents)}</b><small class="muted">After fees and refunds</small></div>
          </section>
          <section class="s-kpis" aria-label="Last ${days} days">
            ${kpi("Views", SX.count(t.views))}${kpi("New followers", SX.count(t.new_followers))}${kpi("Engagement rate", (t.engagement_rate * 100).toFixed(1) + "%", `${SX.count(t.interactions)} interactions`)}
            ${kpi("Gift revenue", SX.money(t.gift_net), `${t.gift_count} gifts · gross ${SX.money(t.gift_gross)}`)}${kpi("Tip revenue", SX.money(t.donation_net), `${t.donation_count} tips · gross ${SX.money(t.donation_gross)}`)}
            ${kpi("Platform fees", SX.money(t.fees))}${kpi("Net earnings", SX.money(t.net))}${kpi("Avg reel watch", t.avg_reel_watch_ms ? (t.avg_reel_watch_ms / 1000).toFixed(1) + "s" : "—")}
            ${kpi("Live peak viewers", SX.count(t.live_peak), `${t.live_sessions} session${t.live_sessions === 1 ? "" : "s"}`)}${kpi("Avg live watch", t.avg_live_watch_ms ? SX.dur(t.avg_live_watch_ms) : "—")}
          </section>
          <section class="s-chart-grid">
            <div class="s-card"><h2 class="s-h6">Views</h2><div id="ch-views" class="s-chart"></div></div>
            <div class="s-card"><h2 class="s-h6">New followers</h2><div id="ch-fol" class="s-chart"></div></div>
            <div class="s-card wide"><h2 class="s-h6">Earnings (net, gifts + tips)</h2><div id="ch-earn" class="s-chart"></div></div>
          </section>
          <section class="s-card"><div class="s-row between"><h2 class="s-h5">Withdrawals</h2><button class="s-btn sm" data-methods>${I("card", "i-sm")} Payout methods</button></div><ul class="s-wd-list" data-wds>${SX.skeletonRows(2)}</ul></section>
          <section class="s-card"><h2 class="s-h5">Earnings activity</h2><ul class="s-tx-list" data-earn></ul></section>
          <div class="s-two">
            <section class="s-card"><h2 class="s-h5">Top content</h2>${d.top_content.length ? `<table class="s-table"><thead><tr><th scope="col">Post</th><th scope="col">Views</th><th scope="col">Likes</th><th scope="col">Comments</th></tr></thead><tbody>${d.top_content.map((c) => `<tr><td><a class="s-top-post" href="#/social/${c.type === "reel" ? "reels" : "p"}/${c.id}">${c.thumb_url ? `<img src="${c.thumb_url}" alt="">` : `<span class="s-top-txt">${I("text", "i-xs")}</span>`}<span>${esc(c.caption || c.type)}</span></a></td><td>${SX.count(c.views)}</td><td>${SX.count(c.likes)}</td><td>${SX.count(c.comments)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Post something to see what resonates.</p>`}</section>
            <section class="s-card"><h2 class="s-h5">Recent lives</h2>${d.recent_lives.length ? `<table class="s-table"><thead><tr><th scope="col">Live</th><th scope="col">Peak</th><th scope="col">Viewers</th><th scope="col">Length</th></tr></thead><tbody>${d.recent_lives.map((l) => `<tr><td>${esc(l.title)}<br><small class="muted">${SX.when(l.started_at)}</small></td><td>${l.peak_viewers}</td><td>${l.unique_viewers}</td><td>${SX.dur(l.ended_at - l.started_at)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No lives yet. <a href="#/social/create?mode=live">Go live</a></p>`}</section>
          </div>`;
        const fmtDay = (s) => new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const chart = (id, series, fn, fmt) => {
          const host = el.querySelector(id);
          if (!series.some((x) => x.value > 0)) { host.innerHTML = `<p class="s-chart-empty">No data in this range yet.</p>`; return; }
          BF.chart[fn](host, series.map((x) => ({ label: fmtDay(x.date), value: x.value })), { format: fmt, height: 190, label: id });
        };
        chart("#ch-views", d.series.views, "line", (v) => SX.count(Math.round(v)));
        chart("#ch-fol", d.series.followers, "columns", (v) => SX.count(Math.round(v)));
        chart("#ch-earn", d.series.gifts.map((g, i) => ({ date: g.date, value: g.value + d.series.donations[i].value })), "columns", (v) => SX.money(v));
        loadWithdrawals(); loadEarnings();
      };
      const loadWithdrawals = async () => {
        const r = await api.get("/api/creator/withdrawals");
        const box = el.querySelector("[data-wds]"); if (!box) return;
        box.innerHTML = r.items.map((w) => `<li class="s-wd"><div class="grow"><b>${SX.money(w.amount_cents, w.currency)}</b> to ${esc(w.method?.label ?? "payout method")}${w.test_mode ? ` <span class="s-pill test">test</span>` : ""}
            <div class="s-tx-meta"><span>${SX.when(w.created_at)}</span>${w.failure_reason ? `<span>${esc(w.failure_reason)}</span>` : ""}</div></div>
          ${statusSteps(w)}
          ${w.needs_verification ? `<button class="s-btn sm primary" data-verify="${w.id}">Enter code</button><button class="s-btn sm ghost" data-cancel-wd="${w.id}">Cancel</button>` : ""}</li>`).join("") || `<li class="muted">No withdrawals yet.</li>`;
      };
      const loadEarnings = () => {
        const list = el.querySelector("[data-earn]"); if (!list) return;
        const inf = SX.infinite({ list, load: (c) => api.get(`/api/creator/earnings${SX.qs({ cursor: c })}`), render: (items) => items.map((e) => `<li class="s-tx"><span class="s-tx-ic">${I(e.source_type === "gift" ? "gift" : "coin", "i-sm")}</span>
          <div class="grow"><b>${e.source_type === "gift" ? `Gift: ${esc(e.label)}` : "Tip"}</b>${e.from ? ` from @${esc(e.from.username)}` : ""}${e.source_type === "donation" && e.label ? ` · “${esc(e.label)}”` : ""}
            <div class="s-tx-meta"><span>${SX.when(e.created_at)}</span><span>${esc(e.context_type ?? "")}</span><span>Gross ${SX.money(e.gross_cents)} · fee ${SX.money(e.fee_cents)}</span></div></div>
          <span class="s-pill ${e.status === "pending" ? "warn" : e.status === "reversed" ? "bad" : "ok"}">${e.status === "pending" ? `pending · clears ${SX.ago(Math.max(Date.now() + 1000, e.available_at)).replace("now", "soon")}` : e.status}</span>
          <span class="s-tx-amt ${e.status === "reversed" ? "out" : "in"}">+${SX.money(e.net_cents)}</span></li>`).join(""), empty: `<li class="muted">Gifts and tips you receive show up here.</li>` });
        inf.more();
        offs.push(() => inf.destroy());
      };
      await draw();
      el.addEventListener("click", async (e) => {
        const dd = e.target.closest("[data-days]"); if (dd) { days = Number(dd.dataset.days); BF.setQuery({ days }); offs.forEach((f) => f()); offs.length = 0; draw(); return; }
        if (e.target.closest("[data-methods]")) return payoutMethods();
        if (e.target.closest("[data-withdraw]")) return withdraw(() => { offs.forEach((f) => f()); offs.length = 0; draw(); });
        const v = e.target.closest("[data-verify]"); if (v) return verify(v.dataset.verify, loadWithdrawals);
        const c = e.target.closest("[data-cancel-wd]");
        if (c) { try { await api.post(`/api/creator/withdrawals/${c.dataset.cancelWd}/cancel`); SX.toast({ title: "Withdrawal cancelled", desc: "The funds are back in your available balance." }); offs.forEach((f) => f()); offs.length = 0; draw(); } catch (err) { SX.fail(err); } }
      });
      offs.push(SX.ws.on("earnings", (m) => Object.entries({ available: m.balances.available_cents, pending: m.balances.pending_cents, held: m.balances.held_cents, lifetime: m.balances.lifetime_cents }).forEach(([k, v]) => { const x = el.querySelector(`[data-b="${k}"]`); if (x) x.textContent = SX.money(v); })));
      const offW = SX.ws.on("withdrawal", (m) => { loadWithdrawals(); SX.toast({ kind: m.withdrawal.status === "completed" ? "success" : m.withdrawal.status === "failed" ? "error" : "info", title: `Withdrawal ${m.withdrawal.status}`, desc: `${SX.money(m.withdrawal.amount_cents)}${m.withdrawal.test_mode ? " · test mode" : ""}` }); });
      return () => { offs.forEach((f) => f()); offW(); };
    },
  });
  const kpi = (label, value, sub = "") => `<div class="s-kpi"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const fmtHold = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);
  function statusSteps(w) {
    if (["failed", "rejected", "cancelled"].includes(w.status)) return `<span class="s-pill bad">${w.status}</span>`;
    const label = w.needs_verification ? "Verify" : w.awaiting_review ? "In review" : w.status;
    const steps = [["Requested", true], ["Verified", w.verified], [w.awaiting_review ? "Review" : "Processing", w.status === "completed" || (w.status === "processing" && !w.awaiting_review)], ["Paid", w.status === "completed"]];
    return `<ol class="s-steps" aria-label="Status: ${esc(label)}">${steps.map(([s, done]) => `<li class="${done ? "done" : ""}">${s}</li>`).join("")}</ol><span class="s-pill ${w.status === "completed" ? "ok" : "warn"}">${esc(label)}</span>`;
  }

  function payoutMethods(onChange) {
    SX.sheet({
      title: "Payout methods",
      body: `<div class="s-methods">${SX.state.env?.payouts?.test_mode ? `<div class="s-testmode inline">${TEST_BADGE} Sandbox payouts. Connect a test account; no bank details are collected.</div>` : ""}
        <p class="muted">Bank details are held by the payout provider, never by TUNIBEAT. We only keep a reference to the account.</p>
        <ul class="s-user-list" data-list>${SX.skeletonRows(1)}</ul>
        <div class="s-row wrap"><button class="s-btn primary" data-add="succeeds">${I("plus", "i-sm")} Connect test bank account</button>${SX.state.env?.dev_tools ? `<button class="s-btn ghost" data-add="fails">Add failing test account</button>` : ""}</div></div>`,
      onMount: async (bd) => {
        const draw = async () => {
          const r = await api.get("/api/creator/payout-methods");
          bd.querySelector("[data-list]").innerHTML = r.items.map((m) => `<li class="s-user-row">${I("card")}<div class="grow"><b>${esc(m.label)}</b><div class="s-handle">${esc(m.provider)} · ${m.status}${m.test_mode ? " · test" : ""}</div></div><button class="s-btn sm ghost" data-rm="${m.id}">Remove</button></li>`).join("") || `<li class="muted">No payout methods yet.</li>`;
        };
        await draw();
        bd.addEventListener("click", async (e) => {
          const a = e.target.closest("[data-add]"); if (a) { try { await api.post("/api/creator/payout-methods", { scenario: a.dataset.add }); draw(); onChange?.(); } catch (err) { SX.fail(err); } }
          const rm = e.target.closest("[data-rm]"); if (rm) { try { await api.del(`/api/creator/payout-methods/${rm.dataset.rm}`); draw(); } catch (err) { SX.fail(err); } }
        });
      },
    });
  }

  function withdraw(done) {
    SX.sheet({
      title: "Withdraw earnings",
      body: `<form class="s-form" data-wd>${SX.state.env?.payouts?.test_mode ? `<div class="s-testmode inline">${TEST_BADGE} Sandbox payout. No money moves.</div>` : ""}<div data-body>${SX.skeletonRows(2)}</div></form>`,
      onMount: async (bd, close) => {
        const [ov, m] = await Promise.all([api.get("/api/creator/overview?days=7"), api.get("/api/creator/payout-methods")]);
        const s = ov.settings.withdrawal, avail = ov.balances.available_cents;
        const key = SX.ikey();
        const body = bd.querySelector("[data-body]");
        if (!m.items.length) { body.innerHTML = `<p>Connect a payout method first.</p><button type="button" class="s-btn primary" data-open-methods>Payout methods</button>`; bd.querySelector("[data-open-methods]").onclick = () => { close(); payoutMethods(); }; return; }
        body.innerHTML = `<p class="muted">Available: <b>${SX.money(avail)}</b>. Withdrawals over ${SX.money(s.review_threshold_cents)} are reviewed by our team first.</p>
          <label class="s-field"><span>Amount (USD)</span><input class="s-input" name="amount" type="number" inputmode="decimal" step="0.01" min="${(s.min_cents / 100).toFixed(2)}" max="${(Math.min(avail, s.max_cents) / 100).toFixed(2)}" value="${(Math.min(avail, s.max_cents) / 100).toFixed(2)}" required></label>
          <label class="s-field"><span>Send to</span><select class="s-input" name="method">${m.items.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join("")}</select></label>
          <p class="s-fine">We’ll email a 6-digit code to confirm it’s you. Funds are held while the withdrawal is in progress.</p>
          <div class="s-form-actions"><button type="button" class="s-btn ghost" data-close>Cancel</button><button class="s-btn primary">Request withdrawal</button></div>`;
        bd.querySelector("[data-wd]").addEventListener("submit", async (e) => {
          e.preventDefault();
          const f = e.target;
          try {
            const r = await api.post("/api/creator/withdrawals", { amount_cents: Math.round(Number(f.amount.value) * 100), payout_method_id: f.method.value, idempotency_key: key });
            close(); done?.(); verify(r.withdrawal.id, done);
          } catch (err) { SX.fail(err, "Withdrawal not requested"); }
        });
      },
    });
  }

  function verify(wid, done) {
    SX.sheet({
      title: "Confirm withdrawal",
      body: `<form class="s-form" data-v><p>Enter the 6-digit code we sent to your email.</p>
        <label class="s-field"><span>Verification code</span><input class="s-input s-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required autofocus></label>
        ${SX.state.env?.dev_tools ? `<div class="s-dev-outbox"><b>${I("mail", "i-xs")} Developer outbox</b><p>No email provider is configured in development, so codes land here.</p><button type="button" class="s-btn sm" data-outbox>Show latest code</button><pre data-mail hidden></pre></div>` : ""}
        <div class="s-form-actions"><button type="button" class="s-btn ghost" data-close>Later</button><button class="s-btn primary">Confirm</button></div></form>`,
      onMount: (bd, close) => {
        bd.querySelector("[data-outbox]")?.addEventListener("click", async () => {
          const r = await api.get("/api/dev/outbox");
          const pre = bd.querySelector("[data-mail]"); pre.hidden = false; pre.textContent = r.items[0] ? `${r.items[0].subject}\n\n${r.items[0].body}` : "Outbox is empty.";
        });
        bd.querySelector("[data-v]").addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            const r = await api.post(`/api/creator/withdrawals/${wid}/verify`, { code: e.target.code.value.trim() });
            close();
            SX.toast({ title: r.withdrawal.awaiting_review ? "Sent for review" : "Withdrawal processing", desc: r.withdrawal.awaiting_review ? "Our team reviews larger withdrawals. We’ll notify you." : "We’ll notify you when it’s paid." });
            done?.();
          } catch (err) { SX.fail(err, "Code not accepted"); if (["code_expired", "too_many_attempts"].includes(err.code)) { close(); done?.(); } }
        });
      },
    });
  }
})();
