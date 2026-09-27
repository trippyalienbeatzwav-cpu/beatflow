/* ==========================================================================
   TUNIBEAT Social — Trust & Safety and monetization console (staff only)
   The server enforces roles; this page only hides what you can't use.
   ========================================================================== */
(function () {
  const SX = BF.social, I = SX.icon, esc = SX.esc, api = SX.api;
  const TABS = [["reports", "Reports", "flag"], ["withdrawals", "Withdrawals", "wallet"], ["refunds", "Tips & refunds", "refresh"], ["gifts", "Gift catalog", "gift"], ["settings", "Monetization", "sliders"], ["ledger", "Ledger check", "receipt"]];

  SX.route("/social/admin", {
    title: "Moderation", active: "admin",
    render: (p, q) => `<header class="s-page-head row"><div><h1 class="s-h2">${I("shield")} Trust & Safety</h1><p class="muted">Staff tools. Every action is logged.</p></div></header>
      <div class="s-admin-stats" data-stats></div>
      <div class="s-tabs scroll" role="tablist">${TABS.map(([k, l, ic]) => `<a role="tab" href="#/social/admin?tab=${k}" aria-selected="${(q.tab ?? "reports") === k}">${I(ic, "i-xs")} ${l}</a>`).join("")}</div>
      <section class="s-card" data-body>${SX.skeletonRows(4)}</section>`,
    async mount(el, p, q) {
      if (!SX.isStaff()) { el.innerHTML = SX.empty({ icon: "lock", title: "Staff only", body: "You don’t have access to moderation tools." }); return; }
      const tab = q.tab ?? "reports";
      const body = el.querySelector("[data-body]");
      const admin = SX.state.me.role === "admin";
      api.get("/api/admin/stats").then((s) => (el.querySelector("[data-stats]").innerHTML = [["Open reports", s.open_reports], ["Live now", s.live_now], ["Withdrawals to review", s.withdrawals_to_review], ["Gift credits (24h)", SX.count(s.gift_credits_24h)], ["Tips (24h)", SX.money(s.donation_cents_24h)], ["Credit sales (24h)", SX.money(s.credit_sales_cents_24h)], ["Users", s.users], ["Sanctioned", s.sanctioned]].map(([l, v]) => `<div class="s-kpi"><span>${l}</span><b>${v}</b></div>`).join(""))).catch(() => {});

      if (tab === "reports") {
        let status = q.status ?? "open";
        const draw = async () => {
          const r = await api.get(`/api/admin/reports?status=${status}`);
          body.innerHTML = `<div class="s-row between"><h2 class="s-h5">Reports</h2><div class="s-seg sm">${["open", "actioned", "dismissed"].map((s) => `<button data-status="${s}" aria-selected="${s === status}">${s}</button>`).join("")}</div></div>
            ${r.items.map((x) => `<article class="s-report">
              <header><span class="s-pill">${esc(x.target_type)}</span><b>${x.n} report${x.n === 1 ? "" : "s"}</b><span class="muted">${x.reasons.map(esc).join(", ")} · first ${SX.ago(x.first_at)} ago</span></header>
              <div class="s-report-body">${x.preview?.media?.url ? `<img src="${x.preview.media.kind === "video" ? x.preview.media.poster_url : x.preview.media.url}" alt="">` : ""}<div><p>${esc(x.preview?.text ?? "(content unavailable)")}</p><p class="muted">Owner: ${x.owner ? `<a href="#/social/u/${esc(x.owner.username)}">@${esc(x.owner.username)}</a>` : "—"} · status: ${esc(x.preview?.status ?? "?")} ${x.preview?.link ? `· <a href="${x.preview.link}">Open</a>` : ""}</p>
                <details><summary>Reporter details</summary><ul>${x.details.map((d) => `<li>@${esc(d.reporter?.username)}: ${esc(d.reason)}${d.details ? `, “${esc(d.details)}”` : ""}</li>`).join("")}</ul></details></div></div>
              ${status === "open" ? `<div class="s-row wrap"><button class="s-btn sm" data-resolve="${x.id}" data-a="dismiss">Dismiss</button><button class="s-btn sm" data-resolve="${x.id}" data-a="warn">Warn</button>${x.target_type !== "user" ? `<button class="s-btn sm danger" data-resolve="${x.id}" data-a="remove_content">Remove content</button>` : ""}<button class="s-btn sm danger" data-resolve="${x.id}" data-a="suspend_user">Suspend user</button><button class="s-btn sm danger" data-resolve="${x.id}" data-a="ban_user">Ban user</button></div>` : ""}
            </article>`).join("") || SX.empty({ icon: "check", title: "Queue is clear", body: `No ${status} reports.` })}`;
        };
        await draw();
        body.addEventListener("click", async (e) => {
          const s = e.target.closest("[data-status]"); if (s) { status = s.dataset.status; draw(); return; }
          const b = e.target.closest("[data-resolve]"); if (!b) return;
          const a = b.dataset.a;
          if (a !== "dismiss" && !(await SX.confirm({ title: `${a.replace("_", " ")}?`, body: "The account owner is notified and this is logged.", confirmLabel: "Confirm", danger: a !== "warn" }))) return;
          try { await api.post(`/api/admin/reports/${b.dataset.resolve}/resolve`, { action: a }); SX.toast({ title: "Resolved" }); draw(); } catch (err) { SX.fail(err); }
        });
      }

      if (tab === "withdrawals") {
        if (!admin) { body.innerHTML = SX.empty({ icon: "lock", title: "Admins only" }); return; }
        const draw = async () => {
          const [queue, all] = await Promise.all([api.get("/api/admin/withdrawals"), api.get("/api/admin/withdrawals?status=all")]);
          body.innerHTML = `<h2 class="s-h5">Awaiting review</h2>${queue.items.map((w) => `<div class="s-user-row">${SX.avatar(w.creator, "sm")}<div class="grow"><b>${SX.money(w.amount_cents)}</b> · @${esc(w.creator.username)} → ${esc(w.method?.label ?? "")}${w.test_mode ? ` <span class="s-pill test">test</span>` : ""}<div class="s-handle">${SX.when(w.created_at)}</div></div><button class="s-btn sm primary" data-wd="${w.id}" data-d="approve">Approve</button><button class="s-btn sm danger" data-wd="${w.id}" data-d="reject">Reject</button></div>`).join("") || `<p class="muted">Nothing to review.</p>`}
            <h2 class="s-h5">Recent</h2><table class="s-table"><thead><tr><th>Creator</th><th>Amount</th><th>Status</th><th>When</th></tr></thead><tbody>${all.items.map((w) => `<tr><td>@${esc(w.creator.username)}</td><td>${SX.money(w.amount_cents)}</td><td><span class="s-pill">${esc(w.status)}</span>${w.failure_reason ? ` <small>${esc(w.failure_reason)}</small>` : ""}</td><td>${SX.when(w.created_at)}</td></tr>`).join("")}</tbody></table>`;
        };
        await draw();
        body.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-wd]"); if (!b) return;
          let reason;
          if (b.dataset.d === "reject") { if (!(await SX.confirm({ title: "Reject withdrawal?", body: "Funds return to the creator’s available balance.", confirmLabel: "Reject", danger: true }))) return; reason = "Rejected after review"; }
          try { await api.post(`/api/admin/withdrawals/${b.dataset.wd}/${b.dataset.d}`, { reason }); SX.toast({ title: b.dataset.d === "approve" ? "Approved and sent to payouts" : "Rejected" }); draw(); } catch (err) { SX.fail(err); }
        });
      }

      if (tab === "refunds") {
        if (!admin) { body.innerHTML = SX.empty({ icon: "lock", title: "Admins only" }); return; }
        const draw = async () => {
          const r = await api.get("/api/admin/donations");
          body.innerHTML = `<h2 class="s-h5">Tips</h2><p class="muted">Refunds reverse the creator’s earnings and are only possible inside the refund window, before the funds are withdrawn.</p>
            <table class="s-table"><thead><tr><th>From</th><th>To</th><th>Amount</th><th>Status</th><th>When</th><th></th></tr></thead><tbody>${r.items.map((d) => `<tr><td>@${esc(d.donor?.username)}</td><td>@${esc(d.recipient?.username)}</td><td>${SX.money(d.amount_cents)}</td><td><span class="s-pill">${esc(d.status)}</span></td><td>${SX.when(d.created_at)}</td><td>${d.status === "succeeded" ? `<button class="s-btn sm" data-refund="${d.id}">Refund</button>` : ""}</td></tr>`).join("")}</tbody></table>`;
        };
        await draw();
        body.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-refund]"); if (!b) return;
          if (!(await SX.confirm({ title: "Refund this tip?", body: "The donor is refunded through the payment provider and the creator’s earnings are reversed.", confirmLabel: "Refund", danger: true }))) return;
          try { await api.post(`/api/admin/donations/${b.dataset.refund}/refund`, { reason: "Refunded by staff" }); SX.toast({ title: "Refunded" }); draw(); } catch (err) { SX.fail(err); }
        });
      }

      if (tab === "gifts") {
        if (!admin) { body.innerHTML = SX.empty({ icon: "lock", title: "Admins only" }); return; }
        const draw = async () => {
          const r = await api.get("/api/admin/gifts");
          body.innerHTML = `<h2 class="s-h5">Gift catalog</h2><p class="muted">Price changes apply to future gifts only. Creator share + platform fee always total 100%.</p>
            <div class="s-table-wrap"><table class="s-table edit"><thead><tr><th>Icon</th><th>Name</th><th>Credits</th><th>Creator %</th><th>Animation</th><th>Where</th><th>Status</th><th></th></tr></thead><tbody>
            ${r.items.map((g) => `<tr data-gid="${g.id}"><td>${SX.giftIcon(g.icon)}</td><td><input class="s-input sm" name="name" value="${esc(g.name)}" aria-label="Name"></td><td><input class="s-input sm" name="credit_cost" type="number" min="1" value="${g.credit_cost}" aria-label="Credits"></td>
              <td><input class="s-input sm" name="creator_share_bps" type="number" min="0" max="100" value="${g.creator_share_bps / 100}" aria-label="Creator share percent"></td>
              <td><select class="s-input sm" name="animation" aria-label="Animation">${["float", "burst", "rain", "spin", "pulse"].map((a) => `<option ${a === g.animation ? "selected" : ""}>${a}</option>`).join("")}</select></td>
              <td><select class="s-input sm" name="availability" aria-label="Availability">${[["everywhere", "Everywhere"], ["live_only", "Live only"], ["profile_only", "Not in live"]].map(([v, l]) => `<option value="${v}" ${v === g.availability ? "selected" : ""}>${l}</option>`).join("")}</select></td>
              <td><select class="s-input sm" name="status" aria-label="Status">${["active", "disabled", "archived"].map((s) => `<option ${s === g.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
              <td><button class="s-btn sm" data-save-gift>Save</button></td></tr>`).join("")}</tbody></table></div>
            <form class="s-form s-row wrap" data-new-gift><input class="s-input" name="name" placeholder="New gift name" required maxlength="40"><input class="s-input" name="icon" placeholder="icon key (e.g. star)" required pattern="[a-z0-9-]{2,24}"><input class="s-input" name="credit_cost" type="number" min="1" placeholder="Credits" required><button class="s-btn primary">Add gift</button></form>`;
        };
        await draw();
        body.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-save-gift]"); if (!b) return;
          const tr = b.closest("[data-gid]"); const v = (n) => tr.querySelector(`[name=${n}]`).value;
          try { await api.patch(`/api/admin/gifts/${tr.dataset.gid}`, { name: v("name"), credit_cost: Number(v("credit_cost")), creator_share_bps: Math.round(Number(v("creator_share_bps")) * 100), animation: v("animation"), availability: v("availability"), status: v("status") }); SX.toast({ title: "Gift saved" }); } catch (err) { SX.fail(err); }
        });
        body.addEventListener("submit", async (e) => {
          if (!e.target.matches("[data-new-gift]")) return; e.preventDefault();
          const f = e.target;
          try { await api.post("/api/admin/gifts", { name: f.name.value, icon: f.icon.value, credit_cost: Number(f.credit_cost.value) }); draw(); } catch (err) { SX.fail(err); }
        });
      }

      if (tab === "settings") {
        if (!admin) { body.innerHTML = SX.empty({ icon: "lock", title: "Admins only" }); return; }
        const r = await api.get("/api/admin/settings/monetization");
        const s = r.settings;
        const num = (name, label, val, help = "", step = 1) => `<label class="s-field"><span>${label}${help ? ` <small class="muted">${help}</small>` : ""}</span><input class="s-input" type="number" step="${step}" name="${name}" value="${val}"></label>`;
        body.innerHTML = `<form class="s-form" data-set><h2 class="s-h5">Monetization settings</h2>
          <div class="s-set-grid">
            <fieldset><legend>General</legend>${num("currency_txt", "Currency", "", "")}${num("credit_value_cents", "Gift value per credit (cents)", s.credit_value_cents)}${num("earnings_hold_seconds", "Earnings hold (seconds)", s.earnings_hold_seconds, "pending → available")}${num("refund_window_hours", "Refund window (hours)", s.refund_window_hours)}</fieldset>
            <fieldset><legend>Tips</legend>${num("donation.min_cents", "Minimum (cents)", s.donation.min_cents)}${num("donation.max_cents", "Maximum (cents)", s.donation.max_cents)}${num("donation.fee_bps", "Platform fee (basis points)", s.donation.fee_bps, "500 = 5%")}</fieldset>
            <fieldset><legend>Gift abuse protection</legend>${num("gifts.min_account_age_minutes", "Min account age (min)", s.gifts.min_account_age_minutes)}${num("gifts.max_credits_per_minute", "Max credits / minute / sender", s.gifts.max_credits_per_minute)}${num("gifts.daily_credit_limit", "Daily credit limit / sender", s.gifts.daily_credit_limit)}</fieldset>
            <fieldset><legend>Withdrawals</legend>${num("withdrawal.min_cents", "Minimum (cents)", s.withdrawal.min_cents)}${num("withdrawal.max_cents", "Maximum (cents)", s.withdrawal.max_cents)}${num("withdrawal.review_threshold_cents", "Manual review above (cents)", s.withdrawal.review_threshold_cents)}</fieldset>
          </div><div class="s-form-actions"><button class="s-btn primary">Save settings</button></div></form>`;
        const form = body.querySelector("[data-set]");
        form.querySelector("[name=currency_txt]").outerHTML = `<input class="s-input" name="currency" maxlength="3" value="${esc(s.currency)}">`;
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const out = { donation: {}, gifts: {}, withdrawal: {} };
          new FormData(form).forEach((v, k) => { const [a, b] = k.split("."); if (b) out[a][b] = Number(v); else out[a] = a === "currency" ? String(v).toUpperCase() : Number(v); });
          try { await api.patch("/api/admin/settings/monetization", out); SX.toast({ title: "Settings saved" }); } catch (err) { SX.fail(err, "Invalid settings"); }
        });
      }

      if (tab === "ledger") {
        if (!admin) { body.innerHTML = SX.empty({ icon: "lock", title: "Admins only" }); return; }
        const r = await api.get("/api/admin/ledger/reconcile");
        body.innerHTML = `<h2 class="s-h5">Ledger reconciliation</h2><p class="muted">Every wallet and creator balance must equal the sum of its ledger rows.</p>
          ${r.ok ? `<div class="s-ok-box">${I("check")} All balances reconcile (checked ${SX.when(r.checked_at)}).</div>` : `<div class="s-bad-box">${I("alert")} ${r.mismatches.length} mismatch(es)</div><table class="s-table"><thead><tr><th>User</th><th>Bucket</th><th>Balance</th><th>Ledger</th></tr></thead><tbody>${r.mismatches.map((m) => `<tr><td>${esc(m.user_id)}</td><td>${esc(m.bucket)}</td><td>${m.balance}</td><td>${m.ledger}</td></tr>`).join("")}</tbody></table>`}`;
      }
    },
  });
})();
