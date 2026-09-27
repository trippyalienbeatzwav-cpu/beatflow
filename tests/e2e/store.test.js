// End-to-end buyer journey through the real UI and API: sign up → verify email → browse → play a preview →
// save to a playlist → add a license to the cart → check out with the sandbox payment → download from the library.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { startServer } from "../helpers.js";

const OUT = "test-results";
let srv, browser;
const errors = [];
before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  srv = await startServer({ seed: true });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
});
after(async () => { await browser?.close(); await srv?.close(); });

test("buyer journey: sign up, verify, play, playlist, checkout (sandbox), download", { timeout: 300_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_ABORTED|net::ERR_FAILED|status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });

  // Sign up
  await p.goto(`${srv.base}/#/signup`);
  await p.fill("#su-name", "Journey Tester");
  await p.fill("#su-user", "journey_tester");
  await p.fill("#su-email", "journey@example.com");
  await p.fill("#su-pw", "copper-lantern-river-8");
  await p.check("#su-terms");
  await p.locator("form[data-f] button.btn-primary").click();
  await p.waitForURL(/#\/verify/);

  // Verify with the code from the (development) outbox
  const code = await p.evaluate(async () => (await BF.http.get("/api/dev/mail?email=journey%40example.com")).items[0].body.match(/\b(\d{6})\b/)[1]);
  const digits = p.locator(".otp input");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(code[i]);
  await p.locator("form[data-f] button.btn-primary").click().catch(() => {});
  await p.waitForFunction(() => BF.store.get("session").user?.emailVerified === true, null, { timeout: 10_000 });

  // Browse to a beat and play its preview
  await p.goto(`${srv.base}/#/beats/beat/b3`);
  await p.waitForSelector(".bd-title");
  await p.locator(".bd-player [data-action=play], .bd-player .play-btn").first().click();
  await p.waitForFunction(() => BF.previewEngine.playing && BF.previewEngine.element.currentTime > 0.2, null, { timeout: 20_000 });
  const src = await p.evaluate(() => BF.previewEngine.element.currentSrc);
  assert.match(src, /\/assets\/audio\/beats\//, "plays the real preview file");

  // Save to a new playlist (server-side)
  await p.locator('.bd-actions [data-action="playlist"]').click();
  await p.fill("#npl", "Journey picks");
  await p.locator("form[data-new] button").click();
  await p.waitForFunction(() => BF.store.get("playlists").some((l) => l.title === "Journey picks" && l.beatIds.includes("b3")), null, { timeout: 5000 });
  const stored = srv.db.get("SELECT COUNT(*) n FROM playlist_items pi JOIN playlists pl ON pl.id = pi.playlist_id JOIN users u ON u.id = pl.user_id WHERE u.username = 'journey_tester' AND pi.item_id = 'b3'");
  assert.equal(stored.n, 1);

  // Choose the Basic lease, add to cart, check out
  const basic = p.locator('.lic-panel .lic-option:has(input[value="basic"])');
  await basic.evaluate((e) => e.scrollIntoView({ block: "center" }));   // clear of the fixed player bar, as a user would scroll
  await basic.click();
  await p.waitForFunction(() => document.querySelector('input[name="detail-lic"][value="basic"]')?.checked);
  await p.locator("[data-add-lic]").click();
  await p.waitForFunction(() => BF.store.get("cart").some((c) => c.beatId === "b3" && c.licenseId === "basic"), null, { timeout: 5000 });
  await p.goto(`${srv.base}/#/checkout`);
  await p.waitForSelector("form[data-co]");
  await p.waitForFunction(() => !document.querySelector(".co-pay")?.disabled, null, { timeout: 10_000 });
  await p.fill("#co-legal", "Journey Tester");
  await p.selectOption("#co-country", "US").catch(() => p.fill("#co-country", "US"));
  await p.fill("#co-zip", "10001");
  await p.check("#co-agree");
  const payLabel = await p.locator(".co-pay").textContent();
  await p.locator(".co-pay").click();
  await p.locator('[data-pay="succeed"]').click();
  await p.waitForSelector("[data-success] [data-dl-ent]", { timeout: 20_000 });
  await p.screenshot({ path: `${OUT}/journey-success.png` });

  // The server charged what the page showed, and granted exactly one entitlement
  const order = srv.db.get("SELECT c.total_cents, c.status FROM store_checkouts c JOIN users u ON u.id = c.user_id WHERE u.username = 'journey_tester'");
  assert.equal(order.status, "paid");
  assert.ok(payLabel.includes((order.total_cents / 100).toFixed(2)), `pay button (${payLabel.trim()}) shows the charged total`);

  // Download the MP3 from the library
  await p.goto(`${srv.base}/#/beats/library`);
  const btn = p.locator("[data-dl-ent]").first();
  await btn.waitFor();
  // Headless Chromium under Playwright diverts every `Content-Disposition: attachment` response into its
  // download manager and reports it as canceled (reproduced with a bare Node server), so the file behind the
  // link the UI produced is fetched with the browser context's own cookies instead.
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 180_000 }), btn.click()]);
  assert.match(dl.url(), /\/api\/store\/downloads\/[\w-]+\/file\?exp=\d+&sig=/, "a signed, expiring link");
  assert.match(dl.suggestedFilename(), /\.mp3$/);
  const res = await ctx.request.get(dl.url());
  assert.equal(res.status(), 200);
  assert.equal(res.headers()["content-type"], "audio/mpeg");
  const head = (await res.body()).subarray(0, 3);
  assert.ok(head[0] === 0xff || head.toString("latin1") === "ID3", "the downloaded file is an MP3");
  const anon = await (await browser.newContext()).request.get(dl.url());
  assert.equal(anon.status(), 401, "the link is useless without the buyer's session");
  await ctx.close();
});

test("no page or console errors during the store journey", () => assert.deepEqual(errors, []));
