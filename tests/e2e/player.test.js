// End-to-end: the Electronic Music Store DJ preview player in a real browser (Edge/Chromium via playwright-core).
// Verifies the waveform against reference audio, clock sync, seeking, zoom, loop, cues, preview limits,
// store actions and responsive layout. Screenshots go to test-results/.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { startServer, ikey } from "../helpers.js";

const OUT = "test-results";
let srv, browser;
const errors = [];

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  srv = await startServer({ seed: true });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
});
after(async () => { await browser?.close(); await srv?.close(); });

async function page(viewport = { width: 1440, height: 900 }, extra = {}, cookie = null) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", ...extra });
  if (cookie) { const [name, value] = cookie.split("="); await ctx.addCookies([{ name, value, url: srv.base }]); }
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_ABORTED|net::ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return p;
}
const eng = (p, fn, arg) => p.evaluate(fn, arg);
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("Player Lab: reference tracks A–G match their ground truth (analysis and canvas colours)", { timeout: 300_000 }, async () => {
  const p = await page();
  await p.goto(`${srv.base}/#/electronic/player-lab?run=1`);
  await p.waitForFunction(() => window.__lab?.done, null, { timeout: 280_000 });
  const res = await p.evaluate(() => Object.fromEntries(Object.entries(window.__lab.results).map(([k, v]) => [k, { pass: v.pass, checks: v.checks, profile: v.profile, pixels: v.pixels, bpm: v.analysis.bpm }])));
  await p.screenshot({ path: `${OUT}/lab-desktop.png`, fullPage: true });
  const lines = Object.entries(res).map(([id, r]) => `${id} ${r.pass ? "PASS" : "FAIL"} low ${r.profile.low.toFixed(2)} mid ${r.profile.mid.toFixed(2)} high ${r.profile.high.toFixed(2)} px(${r.pixels.low.toFixed(2)}/${r.pixels.mid.toFixed(2)}/${r.pixels.high.toFixed(2)}) bpm ${r.bpm}` + r.checks.filter((c) => !c.ok).map((c) => `\n   ✗ ${c.name}: ${c.detail}`).join(""));
  console.log(lines.join("\n"));
  assert.equal(Object.keys(res).length, 7);
  for (const [id, r] of Object.entries(res)) assert.ok(r.pass, `track ${id} failed: ${r.checks.filter((c) => !c.ok).map((c) => c.name + " " + c.detail).join("; ")}`);
  // The dominant canvas colour follows the audio: A red, D blue, B/C mid colours
  assert.ok(res.A.pixels.low > res.A.pixels.high && res.A.pixels.low > res.A.pixels.mid);
  assert.ok(res.D.pixels.high > res.D.pixels.low && res.D.pixels.high > res.D.pixels.mid);
  assert.ok(res.B.pixels.mid > 0.6 && res.C.pixels.mid > 0.6);
  await p.context().close();
});

test("Store player: real preview audio, clock-synced deck, seek, zoom, loop, cues, preview end, cart", { timeout: 180_000 }, async () => {
  // A listener who really bought t5 (cart → checkout → sandbox payment), signed in to the browser with that session
  const buyer = await srv.as("rafi.listens");
  await buyer.put("/api/store/cart", { items: [{ kind: "track", id: "t5", format: "WAV" }] });
  const ck = await buyer.post("/api/store/checkout", { idempotency_key: ikey(), email: "r@example.com", legal_name: "Rafi Test", country: "US", postal_code: "10001", agree: true });
  assert.equal(ck.status, 200, JSON.stringify(ck.data));
  await buyer.post(`/api/payments/sandbox/${ck.data.checkout.checkout.session}/complete`, { outcome: "succeed" });
  const p = await page(undefined, {}, buyer.cookie);
  await p.goto(`${srv.base}/#/electronic/release/r2`);
  await p.evaluate(() => { localStorage.removeItem("tb:previewConfig"); BF.store.set("previewMode", "start"); });
  await p.reload();
  await p.getByRole("button", { name: "Play Neon Horizon (Original Mix)" }).last().click();
  await p.waitForFunction(() => BF.transport.engine === "preview" && BF.previewEngine.playing && BF.previewEngine.element.currentTime > 0.3, null, { timeout: 20_000 });
  const clip = await eng(p, () => ({ src: BF.previewEngine.element.currentSrc, win: BF.previewEngine.window }));
  assert.match(clip.src, /assets\/audio\/previews\/.+\.opus$/);
  // Position is derived from audio.currentTime only
  const s1 = await eng(p, () => ({ pos: BF.previewEngine.position(), ct: BF.previewEngine.element.currentTime, cs: BF.previewEngine.window.clipStart }));
  assert.ok(Math.abs(s1.pos - (s1.cs + s1.ct)) < 0.02, "position = clipStart + currentTime");
  assert.ok(s1.pos >= clip.win.start - 0.05 && s1.pos < clip.win.start + 3, "starts at the preview start");
  await p.waitForTimeout(1500);
  const s2 = await eng(p, () => BF.previewEngine.position());
  assert.ok(s2 - s1.pos > 1.0 && s2 - s1.pos < 2.5, `advances in real time (${(s2 - s1.pos).toFixed(2)}s)`);

  // Mini waveform in the player bar is drawn from analysis
  const lit = (sel) => p.evaluate((s) => { const c = document.querySelector(s); if (!c) return -1; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) n++; return n; }, sel);
  assert.ok((await lit(".dj-mini canvas")) > 500, "mini waveform drawn");

  // Deck
  await p.locator('.player [data-p="deck"]').click();
  await p.waitForSelector("#deck:not([hidden])");
  await p.waitForFunction(() => BF.deck.state().hasDetail, null, { timeout: 60_000 });
  await p.waitForTimeout(300);
  assert.ok((await lit(".dj-detail canvas")) > 2000, "detail waveform drawn");
  assert.ok((await lit(".dj-overview canvas")) > 2000, "overview waveform drawn");
  const shown = await eng(p, () => ({ text: document.querySelector("[data-t-cur]").textContent, pos: BF.previewEngine.position() }));
  const [mm, ss] = shown.text.split(":").map(Number);
  assert.ok(Math.abs(mm * 60 + ss - shown.pos) <= 1.5, `time readout ${shown.text} matches clock ${shown.pos.toFixed(1)}`);
  await p.screenshot({ path: `${OUT}/deck-desktop.png` });

  // Seek by clicking the overview (inside the preview window)
  const ov = await p.locator("[data-dj-overview]").boundingBox();
  const meta = await eng(p, () => ({ dur: BF.deck.state().meta.duration, win: BF.deck.state().win, period: BF.deck.state().meta.beatPeriod }));
  const target = (meta.win.start + meta.win.end) / 2;
  await p.mouse.click(ov.x + (target / meta.dur) * ov.width, ov.y + ov.height / 2);
  const afterSeek = await eng(p, () => BF.previewEngine.position());
  assert.ok(Math.abs(afterSeek - target) < 1.2, `overview click seeks (${afterSeek.toFixed(2)} vs ${target.toFixed(2)})`);
  // Outside the window clamps to the preview
  await p.mouse.click(ov.x + ov.width * 0.01, ov.y + ov.height / 2);
  const clamped = await eng(p, () => BF.previewEngine.position());
  assert.ok(Math.abs(clamped - meta.win.start) < 0.3, "seek before the preview clamps to its start");

  // Keyboard: → moves one beat on the grid
  await p.locator("[data-dj-detail]").focus();
  const k0 = await eng(p, () => BF.previewEngine.position());
  await p.keyboard.press("ArrowRight");
  const k1 = await eng(p, () => BF.previewEngine.position());
  assert.ok(k1 - k0 > meta.period * 0.4 && k1 - k0 < meta.period * 1.8, `arrow moves ~1 beat (${(k1 - k0).toFixed(3)})`);

  // Zoom
  const z0 = await eng(p, () => BF.deck.state().zoomBars);
  await p.locator('#deck [data-d="zoomin"]').click();
  const z1 = await eng(p, () => BF.deck.state().zoomBars);
  assert.ok(z1 < z0 || z0 === 1, "zoom in shows fewer bars");

  // Loop 4 bars: playback wraps at the loop end
  await p.locator('#deck [data-loopn="4"]').click();
  const loop = await eng(p, () => BF.previewEngine.loop);
  assert.ok(loop && Math.abs(loop.end - loop.start - meta.period * 16) < 0.01, "4-bar loop length");
  await eng(p, () => BF.previewEngine.seek(BF.previewEngine.loop.end - 0.3));
  await p.waitForTimeout(900);
  const inLoop = await eng(p, () => BF.previewEngine.position());
  assert.ok(inLoop >= loop.start && inLoop < loop.start + 1.2, `loop wraps (${inLoop.toFixed(2)} in ${loop.start.toFixed(2)}…)`);
  await p.locator('#deck [data-d="loop"]').click();
  assert.equal(await eng(p, () => BF.previewEngine.loop), null);

  // Cue B (drop) if inside the preview
  const cueB = await eng(p, () => { const c = BF.deck.state().meta.cues.find((x) => x.id === "B"); const w = BF.deck.state().win; return c && c.time >= w.start && c.time <= w.end ? c.time : null; });
  if (cueB != null) { await p.locator('#deck [data-cue="B"]').click(); const at = await eng(p, () => BF.previewEngine.position()); assert.ok(Math.abs(at - cueB) < 0.3, "cue B jumps to the drop"); }

  // Fades follow the configured window
  const fades = await eng(p, () => { const w = BF.previewEngine.window, f = BF.previewEngine.fadeGainAt; return { mid: f((w.start + w.end) / 2), inHalf: f(w.start + w.fadeIn / 2), outHalf: f(w.end - w.fadeOut / 2), end: f(w.end) }; });
  assert.equal(fades.mid, 1); assert.ok(Math.abs(fades.inHalf - 0.5) < 0.01); assert.ok(Math.abs(fades.outHalf - 0.5) < 0.01); assert.equal(fades.end, 0);

  // Owned track (t5 was bought above): the deck offers the download, not a purchase
  assert.equal(await eng(p, () => BF.store.ownsMusic("track", BF.player.current().id)), true);
  assert.equal(await p.locator('#deck [data-action="add-music"][data-kind="track"]').count(), 0);
  assert.equal(await p.locator('#deck a[href="#/electronic/library"]').count(), 1);
  assert.equal(await p.locator('.player [data-p="price"]').textContent(), "Owned · Download", "player bar reflects ownership");

  // Not-owned track: switch tracks, the deck follows, and "Buy track" adds exactly that track to the cart
  const tid = await eng(p, () => BF.releaseById.r2.trackIds.find((id) => !BF.store.ownsMusic("track", id)));
  await eng(p, (id) => BF.player.playBeat(id), tid);
  await p.waitForFunction((id) => BF.deck.state().track === id && BF.previewEngine.track?.id === id, tid, { timeout: 15_000 })
    .catch(async (e) => { throw new Error(e.message + " " + JSON.stringify(await eng(p, () => ({ deck: BF.deck.state().track, eng: BF.previewEngine.track?.id, cur: BF.player.current()?.id, t: BF.transport.engine })))); });
  const before = await eng(p, () => BF.store.get("cart").length);
  await p.locator('#deck [data-action="add-music"][data-kind="track"]').click();
  await p.waitForTimeout(300);
  const cart = await eng(p, () => BF.store.get("cart"));
  assert.equal(cart.length, before + 1, "one item added");
  assert.ok(JSON.stringify(cart).includes(tid), "the playing track is in the cart");

  // Preview settings: 30 s from 8 s into the clip, applied on the next load
  await eng(p, () => BF.setPreviewConfig({ maxLength: 30, startOffset: 8 }));
  await eng(p, async () => { await BF.transport.load(BF.player.current(), 0); await BF.transport.play(); });
  const w30 = await eng(p, () => BF.previewEngine.window);
  assert.ok(Math.abs(w30.length - 30) < 0.01 && Math.abs(w30.start - (w30.clipStart + 8)) < 0.01, "configured length and start");
  assert.ok(w30.end < w30.clipEnd - 1, "window ends inside the clip");
  const st = await eng(p, () => ({ pos: BF.previewEngine.position(), ct: BF.previewEngine.element.currentTime }));
  assert.ok(Math.abs(st.pos - w30.start) < 0.3 && Math.abs(st.ct - 8) < 0.3, "clock maps to the offset start");

  // Preview end is enforced by the audio clock (then the player moves on through the queue)
  const endRun = await p.evaluate(async (id) => {
    let max = 0;
    BF.previewEngine.seek(BF.previewEngine.window.end - 0.8);
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (BF.player.current()?.id !== id || !BF.previewEngine.playing) break;
      max = Math.max(max, BF.previewEngine.position());
    }
    return { max, moved: BF.player.current()?.id !== id, playing: BF.previewEngine.playing, ct: BF.previewEngine.element.currentTime };
  }, tid);
  assert.ok(endRun.moved || !endRun.playing, "preview stopped at its end");
  assert.ok(endRun.max <= w30.end + 0.05, `never plays past the preview end (${endRun.max.toFixed(3)} vs ${w30.end.toFixed(3)})`);
  assert.ok(endRun.max > w30.end - 0.3, "played right up to the end");
  await eng(p, () => BF.setPreviewConfig({ maxLength: 90, startOffset: 0 }));
  await p.context().close();
});

test("Responsive: release page + deck at 320–1920 without horizontal scroll; touch scrubbing", { timeout: 180_000 }, async () => {
  for (const [w, h, mobile] of [[320, 640, true], [375, 812, true], [768, 1024, true], [1024, 768, false], [1440, 900, false], [1920, 1080, false]]) {
    const p = await page({ width: w, height: h }, mobile ? { isMobile: true, hasTouch: true } : {});
    await p.goto(`${srv.base}/#/electronic/release/r2`);
    await p.waitForSelector("[data-wf-track] canvas");
    assert.ok(await noOverflow(p), `no horizontal scroll at ${w}px (release)`);
    const play = p.locator(".rel-cover-play [data-action=play]");
    if (mobile) await play.tap(); else await play.click();
    await p.waitForFunction(() => BF.previewEngine.playing, null, { timeout: 20_000 });
    await p.evaluate(() => BF.deck.open());
    await p.waitForSelector("#deck:not([hidden])");
    await p.waitForTimeout(600);
    assert.ok(await noOverflow(p), `no horizontal scroll at ${w}px (deck open)`);
    const box = await p.locator("[data-dj-detail]").boundingBox();
    assert.ok(box.width <= w && box.height >= 100, `detail waveform fits at ${w}px`);
    const tooSmall = await p.evaluate(() => [...document.querySelectorAll("#deck button")].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 30 || b.getBoundingClientRect().width < 30)).map((b) => b.textContent.trim() || b.getAttribute("aria-label")));
    assert.deepEqual(tooSmall, [], `deck buttons are touch-sized at ${w}px`);
    if (mobile) {
      // A vertical swipe over the overview must not seek; a tap does
      const ov = await p.locator("[data-dj-overview]").boundingBox();
      const before = await p.evaluate(() => BF.previewEngine.position());
      await p.evaluate(({ x, y }) => {
        const el = document.querySelector("[data-dj-overview]");
        const ev = (type, dy) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", clientX: x, clientY: y + dy, bubbles: true, isPrimary: true }));
        ev("pointerdown", 0); ev("pointermove", 14); ev("pointermove", 30); ev("pointerup", 30);
      }, { x: ov.x + ov.width * 0.3, y: ov.y + 10 });
      const afterSwipe = await p.evaluate(() => BF.previewEngine.position());
      assert.ok(Math.abs(afterSwipe - before) < 1, "vertical swipe does not seek");
    }
    await p.screenshot({ path: `${OUT}/deck-${w}.png` });
    await p.context().close();
  }
});

test("No page or console errors during player tests", () => {
  assert.deepEqual(errors, []);
});
