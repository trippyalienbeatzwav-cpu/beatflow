// End-to-end: the production build (dist/) boots and works — bundles load, routes render, the analysis
// Worker (loaded by path at runtime) still runs, and hashed bundles are served as immutable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { startServer } from "../helpers.js";

let srv, browser;
before(async () => {
  execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "pipe" });
  srv = await startServer({ seed: true, config: { webRoot: path.resolve("dist") } });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
});
after(async () => { await browser?.close(); await srv?.close(); });

test("dist bundle: stores, social and the Player Lab work from the build", { timeout: 120_000 }, async () => {
  const errors = [];
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const html = await (await fetch(`${srv.base}/`)).text();
  const js = html.match(/js\/app\.[0-9a-f]{10}\.js/)?.[0];
  assert.ok(js, "index.html references the hashed bundle");
  assert.equal((html.match(/<script src=/g) ?? []).length, 1, "one script tag");
  const head = await fetch(`${srv.base}/${js}`, { method: "HEAD" });
  assert.match(head.headers.get("cache-control"), /immutable/);
  for (const r of ["/", "/beats", "/electronic", "/electronic/release/r2", "/social/login"]) {
    await p.goto(`${srv.base}/#${r}`);
    await p.waitForTimeout(500);
    assert.ok((await p.evaluate(() => document.querySelector("main")?.innerText.length ?? 0)) > 20, `${r} renders from dist`);
  }
  await p.goto(`${srv.base}/#/electronic/player-lab?run=1`);
  await p.waitForFunction(() => window.__lab?.done, null, { timeout: 100_000 });
  const passed = await p.evaluate(() => Object.values(window.__lab.results).filter((r) => r.pass).length);
  assert.equal(passed, 7, "all reference tracks pass using the built worker");
  assert.deepEqual(errors, []);
});
