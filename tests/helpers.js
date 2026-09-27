// Test harness: boots an isolated app (temp data dir, random port) and gives each test user a cookie-jar client.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import WebSocket from "ws";
import { createApp } from "../server/app.js";

export async function startServer({ seed = true, config = {}, disableRateLimits = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tunibeat-test-"));
  const app = await createApp({ quiet: true, seed, disableRateLimits, config: { dataDir, ...config } });
  const addr = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    app, base, S: app.S, db: app.db,
    client: () => client(base),
    async as(username) { const c = client(base); await c.post("/api/auth/demo", { username }); return c; },
    async close() { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

export function client(base) {
  let cookie = "";
  async function call(method, url, body, { raw = undefined, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { "x-tunibeat-csrf": "1", ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (k === "tb_sid") cookie = v ? `tb_sid=${v}` : ""; }
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (u, o) => call("GET", u, undefined, o), post: (u, b = {}, o) => call("POST", u, b, o), patch: (u, b = {}, o) => call("PATCH", u, b, o),
    put: (u, b, o) => call("PUT", u, b, o), del: (u, o) => call("DELETE", u, undefined, o), raw: call,
    get cookie() { return cookie; },
    ws() { return wsClient(base.replace("http", "ws") + "/ws", cookie); },
  };
}

export function wsClient(url, cookie) {
  const ws = new WebSocket(url, { headers: { cookie } });
  const events = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    // An event handed to a waiter is consumed; otherwise it is buffered for a later wait()
    const w = waiters.find((x) => x.pred(m));
    if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } else events.push(m);
  });
  const api = {
    ws, events,
    open: () => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); ws.once("unexpected-response", (_, r) => rej(new Error("ws " + r.statusCode))); }),
    send: (m) => ws.send(JSON.stringify(m)),
    wait(pred, ms = 3000) {
      const hit = events.find(pred);
      if (hit) { events.splice(events.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error("timeout waiting for ws event")); } }, ms).unref();
      });
    },
    close: () => ws.close(),
  };
  return api;
}

export const ikey = () => crypto.randomBytes(16).toString("hex");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
