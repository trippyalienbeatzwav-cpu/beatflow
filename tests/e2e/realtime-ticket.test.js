// Split hosting in a real browser: when the server advertises a separate WebSocket URL (as on Vercel + Render),
// the page must fetch a one-time ticket and connect with it; the session cookie alone isn't used.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startServer } from "../helpers.js";

let srv, browser;
before(async () => {
  srv = await startServer({ seed: true });
  // The WebSocket "host" is this same server, reached only via the ticket path
  srv.S.cfg.realtimeUrl = srv.base.replace("http", "ws") + "/ws";
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
});
after(async () => { await browser?.close(); await srv?.close(); });

test("social real-time connects with a one-time ticket when realtime_url is set", { timeout: 60_000 }, async () => {
  const user = await srv.as("rafi.listens");
  const ctx = await browser.newContext();
  const [name, value] = user.cookie.split("=");
  await ctx.addCookies([{ name, value, url: srv.base }]);
  const p = await ctx.newPage();
  const sockets = [];
  p.on("websocket", (ws) => sockets.push(ws.url()));
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${srv.base}/#/social`);
  await p.waitForFunction(() => window.BF?.social?.ws?.connected === true, null, { timeout: 20_000 });
  assert.equal(sockets.length, 1);
  assert.match(sockets[0], /\/ws\?ticket=[\w-]+$/, "connected with a ticket");
  // A server-side event reaches the page over that socket
  await p.evaluate(() => { window.__probe = new Promise((resolve) => window.BF.social.ws.on("probe", (m) => resolve(m.n))); });
  srv.S.rt.toUser(srv.db.get("SELECT id FROM users WHERE username = 'rafi.listens'").id, { t: "probe", n: 42 });
  assert.equal(await p.evaluate(() => Promise.race([window.__probe, new Promise((r) => setTimeout(() => r("timeout"), 5000))])), 42);
  assert.deepEqual(errors, []);
  await ctx.close();
});
