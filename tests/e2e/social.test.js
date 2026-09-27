// End-to-end: TUNIBEAT Social through the real UI against a real server (isolated database).
// Sign-up, posting, reacting, commenting, following, sandbox credit purchase (approve + decline),
// and every social route rendering at phone and desktop widths without errors or horizontal scroll.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { startServer } from "../helpers.js";
import { reconcile } from "../../server/modules/admin.js";

const OUT = "test-results";
let srv, browser;
const errors = [];

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  srv = await startServer({ seed: true });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
});
after(async () => { await browser?.close(); await srv?.close(); });

async function newPage(viewport = { width: 1280, height: 860 }, extra = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", ...extra });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_ABORTED|status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return p;
}
const api = (p, url, method = "GET", body) => p.evaluate(async ({ url, method, body }) => {
  const r = await fetch(url, { method, headers: { "x-tunibeat-csrf": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}, { url, method, body });

test("sign up, post, react, comment, follow, buy credits in the sandbox", { timeout: 120_000 }, async () => {
  const p = await newPage();
  const uname = `e2e_${Date.now().toString(36)}`;

  // Sign up through the form
  await p.goto(`${srv.base}/#/social/login`);
  await p.getByRole("tab", { name: "Create account" }).click();
  const up = p.locator("form[data-up]");
  await up.locator("[name=display_name]").fill("E2E Tester");
  await up.locator("[name=username]").fill(uname);
  await up.locator("[name=email]").fill(`${uname}@example.test`);
  await up.locator("[name=password]").fill("correct horse battery");
  await up.getByRole("button", { name: "Create account" }).click();
  await p.waitForFunction(() => location.hash.startsWith("#/social") && !location.hash.includes("login") && BF.social.state.me, null, { timeout: 10_000 });
  assert.equal(await p.evaluate(() => BF.social.state.me.username), uname);

  // Create a text post
  await p.goto(`${srv.base}/#/social/create`);
  const caption = `Testing the deck tonight #e2e ${uname}`;
  await p.locator("[data-caption-input]").fill(caption);
  await p.locator("[data-submit]").click();
  await p.waitForFunction(() => /#\/social\/p\//.test(location.hash), null, { timeout: 10_000 });
  const postId = await p.evaluate(() => location.hash.split("/").pop());
  await p.waitForSelector(`text=${uname}`);
  const saved = await api(p, `/api/posts/${postId}`);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.post.caption, caption);

  // Like it (optimistic UI, then confirmed by the server)
  await p.locator('[data-act="like"]').first().click();
  await p.waitForFunction(() => document.querySelector('[data-act="like"]')?.getAttribute("aria-pressed") === "true");
  await p.waitForTimeout(400);
  const liked = await api(p, `/api/posts/${postId}`);
  assert.equal(liked.data.post.counts.likes, 1);

  // Comment on it
  const box = p.locator("form[data-cform] textarea");
  await box.fill("First comment from the E2E run");
  await p.locator("form[data-cform]").getByRole("button", { name: "Post", exact: true }).click();
  await p.waitForSelector("text=First comment from the E2E run");
  const cm = await api(p, `/api/posts/${postId}`);
  assert.equal(cm.data.post.counts.comments, 1);

  // Follow a public creator from their profile
  await p.goto(`${srv.base}/#/social/u/nova.keys`);
  const follow = p.locator('[data-follow]').first();
  await follow.click();
  await p.waitForFunction(() => document.querySelector("[data-follow]")?.dataset.state === "active", null, { timeout: 5000 });
  const prof = await api(p, "/api/users/nova.keys");
  assert.equal(prof.data.relationship.following, "active");

  // Wallet: buy credits in the sandbox (approve), then a declined card changes nothing
  await p.goto(`${srv.base}/#/social/wallet`);
  const w0 = (await api(p, "/api/wallet")).data.credits;
  await p.locator("[data-buy]").click();
  await p.locator("[data-pack]").first().waitFor();
  const packCredits = Number((await p.locator("[data-pack] b").first().textContent()).replace(/\D/g, ""));
  await p.locator("[data-pack]").first().click();
  await p.getByRole("button", { name: "Approve test payment" }).click();
  await p.waitForFunction((want) => fetch("/api/wallet", { headers: { "x-tunibeat-csrf": "1" } }).then((r) => r.json()).then((w) => w.credits === want), w0 + packCredits, { timeout: 10_000, polling: 300 });
  await p.screenshot({ path: `${OUT}/social-wallet.png` });
  const w1 = (await api(p, "/api/wallet")).data.credits;
  assert.equal(w1, w0 + packCredits, "approved sandbox payment credits exactly one pack");
  await p.keyboard.press("Escape").catch(() => {});
  await p.waitForSelector("[data-tx] li, [data-tx] .s-tx", { timeout: 5000 });
  assert.ok(!(await p.locator("text=No transactions yet").count()), "transaction list refreshed after purchase");

  await p.keyboard.press("Escape");
  await p.locator("[data-buy]").click();
  await p.locator("[data-pack]").first().waitFor();
  await p.locator("[data-pack]").first().click();
  await p.getByRole("button", { name: "Simulate a declined card" }).click();
  await p.waitForTimeout(1200);
  assert.equal((await api(p, "/api/wallet")).data.credits, w1, "declined payment adds nothing");

  // The ledger agrees with the balance
  const rec = reconcile(srv.S);
  assert.equal(rec.ok, true, JSON.stringify(rec.mismatches));
  await p.context().close();
});

test("every social route renders at 390px and 1440px without errors or horizontal scroll", { timeout: 180_000 }, async () => {
  const routes = ["/social", "/social?tab=following", "/social/explore", "/social/reels", "/social/live", "/social/messages", "/social/notifications",
    "/social/wallet", "/social/studio", "/social/settings", "/social/create", "/social/u/nova.keys", "/social/u/mira.kaan", "/social/tag/techno", "/social/admin"];
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const p = await newPage({ width: w, height: h }, mobile ? { isMobile: true, hasTouch: true } : {});
    await p.goto(`${srv.base}/#/social/login`);
    await p.evaluate(() => fetch("/api/auth/demo", { method: "POST", headers: { "x-tunibeat-csrf": "1", "content-type": "application/json" }, body: JSON.stringify({ username: "tunibeat.team" }) }));
    // Hash navigation never reloads the app, so reload once to boot with the new session
    await p.goto(`${srv.base}/#/social`); await p.reload();
    await p.waitForFunction(() => BF.social.state.me?.username === "tunibeat.team", null, { timeout: 10_000 });
    for (const r of routes) {
      await p.goto(`${srv.base}/#${r}`);
      await p.waitForTimeout(700);
      const state = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, main: document.querySelector("main")?.innerText.length ?? 0, hash: location.hash, login: !!document.querySelector(".s-auth") }));
      assert.ok(!state.login && !state.hash.includes("login"), `${r} shows the signed-in page (got ${state.hash})`);
      assert.ok(!state.overflow, `${r} overflows horizontally at ${w}px`);
      assert.ok(state.main > 20, `${r} rendered content at ${w}px`);
    }
    await p.goto(`${srv.base}/#/social`); await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/social-feed-${w}.png` });
    await p.context().close();
  }
});

test("no page or console errors during social tests", () => {
  assert.deepEqual(errors, []);
});
