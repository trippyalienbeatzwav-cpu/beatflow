// Real-time hub over WebSockets (ws). Clients authenticate with the same session cookie as the REST API.
// Channels: "user:<id>" (private events, subscribed automatically), "conv:<id>", "live:<id>".
// Each feature module registers subscribe guards and message handlers. The hub has no feature logic.
// For more than one server node, back publish() with a pub/sub broker (Redis, NATS) so events fan out across nodes.
import { WebSocketServer } from "ws";
import { id as newId } from "./ids.js";

export function createRealtime({ authenticate, log = (..._args) => {} }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const conns = new Map();          // connId → conn
  const channels = new Map();       // channel → Set<conn>
  const byUser = new Map();         // userId → Set<conn>
  const guards = [];                // [prefix, (conn, channelId) → boolean | throws]
  const handlers = new Map();       // type → (conn, msg) => void
  const joinHooks = [], leaveHooks = [], presenceHooks = [];

  const send = (conn, msg) => { if (conn.ws.readyState === 1) conn.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); };

  function subscribe(conn, ch) {
    if (conn.subs.has(ch)) return true;
    const g = guards.find(([p]) => ch.startsWith(p));
    if (!g) return false;
    if (!g[1](conn, ch.slice(g[0].length))) return false;
    conn.subs.add(ch);
    if (!channels.has(ch)) channels.set(ch, new Set());
    channels.get(ch).add(conn);
    joinHooks.forEach((h) => h(conn, ch));
    return true;
  }
  function unsubscribe(conn, ch) {
    if (!conn.subs.delete(ch)) return;
    const set = channels.get(ch);
    if (set) { set.delete(conn); if (!set.size) channels.delete(ch); }
    leaveHooks.forEach((h) => h(conn, ch));
  }

  function attach(ws, user, session) {
    const conn = { id: newId("c"), ws, userId: user.id, user, session, subs: new Set(), alive: true, meta: {} };
    conns.set(conn.id, conn);
    const first = !byUser.has(user.id);
    if (first) byUser.set(user.id, new Set());
    byUser.get(user.id).add(conn);
    // The private user channel is always on
    conn.subs.add(`user:${user.id}`);
    if (!channels.has(`user:${user.id}`)) channels.set(`user:${user.id}`, new Set());
    channels.get(`user:${user.id}`).add(conn);
    if (first) presenceHooks.forEach((h) => h(user.id, true));

    ws.on("pong", () => (conn.alive = true));
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg.t !== "string") return;
      try {
        if (msg.t === "sub") {
          const ok = typeof msg.ch === "string" && subscribe(conn, msg.ch);
          send(conn, { t: ok ? "subscribed" : "sub_denied", ch: msg.ch, ref: msg.ref });
          return;
        }
        if (msg.t === "unsub") { if (typeof msg.ch === "string") unsubscribe(conn, msg.ch); return; }
        if (msg.t === "ping") { send(conn, { t: "pong", ts: Date.now() }); return; }
        const h = handlers.get(msg.t);
        if (h) h(conn, msg);
      } catch (err) {
        send(conn, { t: "error", ref: msg.ref, code: err.code ?? "error", message: err.status ? err.message : "Something went wrong." });
        if (!err.status) log("ws handler error", err);
      }
    });
    ws.on("close", () => {
      [...conn.subs].forEach((ch) => unsubscribe(conn, ch));
      conns.delete(conn.id);
      const set = byUser.get(user.id);
      if (set) { set.delete(conn); if (!set.size) { byUser.delete(user.id); presenceHooks.forEach((h) => h(user.id, false)); } }
    });
    send(conn, { t: "hello", conn: conn.id, user: user.id, ts: Date.now() });
    return conn;
  }

  const heartbeat = setInterval(() => {
    for (const c of conns.values()) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* socket already gone */ }
    }
  }, 25_000);
  heartbeat.unref();

  return {
    handleUpgrade(req, socket, head) {
      const auth = authenticate(req);
      if (!auth) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => attach(ws, auth.user, auth.session));
    },
    guard(prefix, fn) { guards.push([prefix, fn]); },
    on(type, fn) { handlers.set(type, fn); },
    onJoin(fn) { joinHooks.push(fn); },
    onLeave(fn) { leaveHooks.push(fn); },
    onPresence(fn) { presenceHooks.push(fn); },
    publish(ch, msg, except) {
      const set = channels.get(ch); if (!set) return 0;
      const s = JSON.stringify(msg);
      let n = 0;
      for (const c of set) if (c !== except) { send(c, s); n++; }
      return n;
    },
    toUser(userId, msg) { return this.publish(`user:${userId}`, msg); },
    toConn(connId, msg) { const c = conns.get(connId); if (c) send(c, msg); return !!c; },
    conn: (connId) => conns.get(connId),
    members: (ch) => [...(channels.get(ch) ?? [])],
    isOnline: (userId) => byUser.has(userId),
    /** Drop a user from a channel (e.g. banned from a live). */
    kick(ch, userId, msg) {
      for (const c of [...(channels.get(ch) ?? [])]) if (c.userId === userId) { if (msg) send(c, msg); unsubscribe(c, ch); }
    },
    /** Force-close every socket of a user (suspension, sign-out everywhere). */
    disconnectUser(userId) { for (const c of [...(byUser.get(userId) ?? [])]) c.ws.close(4001, "session ended"); },
    close() { clearInterval(heartbeat); for (const c of conns.values()) c.ws.terminate(); wss.close(); },
    stats: () => ({ connections: conns.size, channels: channels.size, users: byUser.size }),
  };
}
