// Real-time behaviour over actual WebSocket connections: messaging, notifications and live rooms.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, ikey, sleep } from "../helpers.js";

let T, nova, rafi, priya, mira, juno;
const uid = (n) => T.db.get("SELECT id FROM users WHERE username = ?", n).id;

before(async () => {
  T = await startServer({ config: { live: { transport: "webrtc-mesh", meshMaxViewers: 2, iceServers: [], hostReconnectGraceMs: 300 } } });
  [nova, rafi, priya, mira, juno] = await Promise.all(["nova.keys", "rafi.listens", "priya.plays", "mira.kaan", "juno.fm"].map((u) => T.as(u)));
});
after(() => T.close());

test("websocket requires a valid session", async () => {
  const anon = T.client().ws();
  await assert.rejects(anon.open(), /401/);
});

test("messages are delivered in real time; retries with the same client_id don't duplicate", async () => {
  const wsNova = nova.ws(); await wsNova.open();
  const conv = (await rafi.post("/api/conversations", { user_ids: [uid("nova.keys")] })).data.conversation;
  const cid = ikey();
  const [a, b] = await Promise.all([
    rafi.post(`/api/conversations/${conv.id}/messages`, { body: "Realtime hello", client_id: cid }),
    rafi.post(`/api/conversations/${conv.id}/messages`, { body: "Realtime hello", client_id: cid }),
  ]);
  assert.equal(a.data.message.id, b.data.message.id);
  const ev = await wsNova.wait((m) => m.t === "message" && m.message.body === "Realtime hello");
  assert.equal(ev.conversation_id, conv.id);
  assert.equal(ev.message.client_id, undefined, "client ids are only echoed to the sender");
  await sleep(100);
  assert.equal(wsNova.events.filter((m) => m.t === "message" && m.message.body === "Realtime hello").length, 0, "delivered exactly once");

  // Typing indicator reaches the other member only
  const wsRafi = rafi.ws(); await wsRafi.open();
  wsNova.send({ t: "typing", conversation_id: conv.id, typing: true });
  const typing = await wsRafi.wait((m) => m.t === "typing");
  assert.equal(typing.user_id, uid("nova.keys"));
  // Read receipt
  await nova.post(`/api/conversations/${conv.id}/read`, { message_id: a.data.message.id });
  const read = await wsRafi.wait((m) => m.t === "read");
  assert.equal(read.message_id, a.data.message.id);
  // Edit and unsend propagate
  await rafi.patch(`/api/messages/${a.data.message.id}`, { body: "Realtime hello (edited)" });
  assert.equal((await wsNova.wait((m) => m.t === "message_updated")).message.body, "Realtime hello (edited)");
  await rafi.del(`/api/messages/${a.data.message.id}`);
  assert.equal((await wsNova.wait((m) => m.t === "message_deleted")).message_id, a.data.message.id);
  // Reactions
  const m2 = await nova.post(`/api/conversations/${conv.id}/messages`, { body: "react to me", client_id: ikey() });
  await rafi.post(`/api/messages/${m2.data.message.id}/react`, { kind: "love" });
  assert.equal((await wsNova.wait((m) => m.t === "message_reactions")).kind, "love");
  // Nova can't edit Rafi's message; edit window enforced
  assert.equal((await nova.patch(`/api/messages/${a.data.message.id}`, { body: "x" })).status, 404);
  T.db.run("UPDATE messages SET created_at = ? WHERE id = ?", Date.now() - 3600_000, m2.data.message.id);
  assert.equal((await nova.patch(`/api/messages/${m2.data.message.id}`, { body: "late edit" })).data.error.code, "edit_window");
  // Non-members can't read the conversation or subscribe to it
  assert.equal((await priya.get(`/api/conversations/${conv.id}/messages`)).status, 404);
  const wsPriya = priya.ws(); await wsPriya.open();
  wsPriya.send({ t: "sub", ch: `conv:${conv.id}` });
  assert.equal((await wsPriya.wait((m) => m.t === "sub_denied")).ch, `conv:${conv.id}`);
  // Search messages
  const found = await rafi.get("/api/messages/search?q=react%20to");
  assert.ok(found.data.items.some((m) => m.id === m2.data.message.id));
  [wsNova, wsRafi, wsPriya].forEach((w) => w.close());
});

test("message requests follow the recipient's privacy settings", async () => {
  // Juno only accepts inbox messages from people Juno follows
  const r = await rafi.post("/api/conversations", { user_ids: [uid("juno.fm")] });
  await rafi.post(`/api/conversations/${r.data.conversation.id}/messages`, { body: "Hi Juno", client_id: ikey() });
  const reqs = await juno.get("/api/conversations?folder=requests");
  assert.ok(reqs.data.items.some((c) => c.id === r.data.conversation.id));
  const inbox = await juno.get("/api/conversations");
  assert.ok(!inbox.data.items.some((c) => c.id === r.data.conversation.id));
  await juno.post(`/api/conversations/${r.data.conversation.id}/accept`);
  assert.ok((await juno.get("/api/conversations")).data.items.some((c) => c.id === r.data.conversation.id));
  // "nobody" blocks new conversations entirely
  await T.db.run("UPDATE privacy_settings SET messages = 'nobody' WHERE user_id = ?", uid("sol.synth"));
  assert.equal((await rafi.post("/api/conversations", { user_ids: [uid("sol.synth")] })).data.error.code, "messages_closed");
  // Groups
  const g = await nova.post("/api/conversations", { user_ids: [uid("rafi.listens"), uid("mira.kaan")], title: "Test group" });
  assert.equal(g.data.conversation.kind, "group");
  assert.equal(g.data.conversation.members.length, 3);
});

test("notifications are pushed live with an unread count", async () => {
  const ws = nova.ws(); await ws.open();
  const pid = (await nova.post("/api/posts", { caption: "push test" })).data.post.id;
  await rafi.post(`/api/posts/${pid}/comments`, { body: "Pushed!" });
  const n = await ws.wait((m) => m.t === "notification" && m.item.type === "comment");
  assert.equal(n.item.actor.username, "rafi.listens");
  assert.ok(n.unread >= 1);
  ws.close();
});

test("live: start, join, viewer counts, chat, reactions, gifts and tips arrive in real time", async () => {
  const created = await nova.post("/api/live", { title: "Test live", category: "Production session", audience: "public" });
  const sid = created.data.stream.id;
  assert.equal(created.data.stream.status, "scheduled");
  assert.equal((await rafi.post(`/api/live/${sid}/start`)).status, 403);
  const started = await nova.post(`/api/live/${sid}/start`);
  assert.equal(started.data.stream.status, "live");
  assert.equal((await nova.post("/api/live", { title: "Second" })).status, 200);
  const second = (await nova.post("/api/live", { title: "Third" })).data.stream.id;
  assert.equal((await nova.post(`/api/live/${second}/start`)).data.error.code, "already_live");

  const host = nova.ws(); await host.open();
  host.send({ t: "sub", ch: `live:${sid}` }); await host.wait((m) => m.t === "subscribed");
  host.send({ t: "live:host", stream: sid });
  await host.wait((m) => m.t === "live:viewers_list");

  const v1 = rafi.ws(); await v1.open();
  v1.send({ t: "sub", ch: `live:${sid}` }); await v1.wait((m) => m.t === "subscribed");
  const joined = await host.wait((m) => m.t === "live:viewer_joined");
  assert.equal(joined.user.username, "rafi.listens");
  assert.equal((await v1.wait((m) => m.t === "live:viewers")).count, 1);

  // Signalling: host → viewer is relayed, viewer → another viewer is not
  host.send({ t: "live:signal", stream: sid, to: joined.conn, data: { sdp: { type: "offer", sdp: "v=0" } } });
  const sig = await v1.wait((m) => m.t === "live:signal");
  assert.equal(sig.data.sdp.type, "offer");
  const v2 = priya.ws(); await v2.open();
  v2.send({ t: "sub", ch: `live:${sid}` }); await v2.wait((m) => m.t === "subscribed");
  const j2 = await host.wait((m) => m.t === "live:viewer_joined" && m.user.username === "priya.plays");
  v1.send({ t: "live:signal", stream: sid, to: j2.conn, data: { sdp: "sneaky" } });
  await sleep(100);
  assert.ok(!v2.events.some((m) => m.t === "live:signal"), "viewer-to-viewer signals are dropped");

  // Mesh capacity (2 viewers in this test config)
  const v3c = await T.as("sol.synth");
  const v3 = v3c.ws(); await v3.open();
  v3.send({ t: "sub", ch: `live:${sid}` });
  assert.equal((await v3.wait((m) => m.t === "live:full")).max, 2);

  // Chat broadcast, slow mode, mod exemption
  await rafi.post(`/api/live/${sid}/messages`, { body: "first!" });
  assert.equal((await v2.wait((m) => m.t === "live:chat" && m.message.body === "first!")).message.user.username, "rafi.listens");
  await nova.patch(`/api/live/${sid}`, { slow_mode_seconds: 10 });
  await v1.wait((m) => m.t === "live:settings");
  assert.equal((await rafi.post(`/api/live/${sid}/messages`, { body: "second" })).data.error.code, "slow_mode");
  assert.equal((await nova.post(`/api/live/${sid}/messages`, { body: "host is exempt" })).status, 200);
  // Pin
  const pinMsg = (await priya.post(`/api/live/${sid}/messages`, { body: "pin me" })).data.message;
  await nova.post(`/api/live/${sid}/pin`, { message_id: pinMsg.id });
  assert.equal((await v1.wait((m) => m.t === "live:pinned")).message.id, pinMsg.id);
  // Reaction
  await priya.post(`/api/live/${sid}/react`, { kind: "fire" });
  assert.equal((await v1.wait((m) => m.t === "live:reaction")).kind, "fire");
  // Gift during live → animation event to everyone in the room
  await rafi.post("/api/gifts/send", { gift_id: "gift_rocket", recipient_id: uid("nova.keys"), context_type: "live", context_id: sid, idempotency_key: ikey() }).then((r) => assert.equal(r.status, 402, "Rafi's seeded credits don't cover a Headliner"));
  const g = await rafi.post("/api/gifts/send", { gift_id: "gift_fire", recipient_id: uid("nova.keys"), context_type: "live", context_id: sid, idempotency_key: ikey() });
  assert.equal(g.status, 200);
  const gev = await v2.wait((m) => m.t === "live:gift");
  assert.equal(gev.gift.name, "Fire");
  assert.equal(gev.user.username, "rafi.listens");
  const earn = await host.wait((m) => m.t === "earnings");
  assert.ok(earn.balances.pending_cents > 0);
  // Tip during live (sandbox payment) → donation event in the room
  const tip = await priya.post("/api/donations", { recipient_id: uid("nova.keys"), amount_cents: 300, message: "🔥 set", context_type: "live", context_id: sid, idempotency_key: ikey() });
  await priya.post(`/api/payments/sandbox/${tip.data.checkout.session}/complete`, { outcome: "succeed" });
  const dev = await v1.wait((m) => m.t === "live:donation");
  assert.equal(dev.amount_cents, 300);
  assert.equal(dev.test_mode, true);

  // Moderation: timeout (mute), then ban removes the viewer from the room and clears their chat
  await nova.post(`/api/live/${sid}/moderation`, { action: "mute", user_id: uid("priya.plays"), minutes: 5 });
  assert.equal((await priya.post(`/api/live/${sid}/messages`, { body: "can I talk" })).data.error.code, "muted");
  assert.equal((await rafi.post(`/api/live/${sid}/moderation`, { action: "ban", user_id: uid("priya.plays") })).status, 403, "viewers can't moderate");
  await nova.post(`/api/live/${sid}/moderators`, { user_id: uid("rafi.listens") });
  await nova.post(`/api/live/${sid}/moderation`, { action: "ban", user_id: uid("priya.plays") });
  assert.equal((await v2.wait((m) => m.t === "live:removed")).reason, "banned");
  assert.equal((await v1.wait((m) => m.t === "live:chat_deleted")).message_id, pinMsg.id);
  assert.equal((await priya.get(`/api/live/${sid}`)).status, 404, "banned viewers can't rejoin");
  // Rafi is a moderator now and bypasses slow mode
  assert.equal((await rafi.post(`/api/live/${sid}/messages`, { body: "mod message" })).status, 200);

  // Host drops: room shows "reconnecting"; host returns within the grace period and the stream resumes
  host.close();
  assert.equal((await v1.wait((m) => m.t === "live:state")).status, "reconnecting");
  const host2 = nova.ws(); await host2.open();
  host2.send({ t: "sub", ch: `live:${sid}` }); await host2.wait((m) => m.t === "subscribed");
  host2.send({ t: "live:host", stream: sid });
  const resumed = await v1.wait((m) => m.t === "live:state");
  assert.equal(resumed.status, "live");
  const list = await host2.wait((m) => m.t === "live:viewers_list");
  assert.ok(list.viewers.some((v) => v.user.username === "rafi.listens"), "host re-offers to existing viewers");

  // End: summary with stats
  const end = await nova.post(`/api/live/${sid}/end`);
  assert.equal(end.data.stream.status, "ended");
  assert.ok(end.data.summary.peak_viewers >= 2);
  assert.ok(end.data.summary.gift_cents > 0);
  assert.equal((await v1.wait((m) => m.t === "live:state")).status, "ended");
  assert.equal((await rafi.post(`/api/live/${sid}/messages`, { body: "after" })).data.error.code, "not_live");
  [host2, v1, v2, v3].forEach((w) => w.close());
});

test("live: host that never returns is ended automatically after the grace period", async () => {
  const sid = (await mira.post("/api/live", { title: "Drop test" })).data.stream.id;
  await mira.post(`/api/live/${sid}/start`);
  const h = mira.ws(); await h.open();
  h.send({ t: "sub", ch: `live:${sid}` }); await h.wait((m) => m.t === "subscribed");
  h.send({ t: "live:host", stream: sid }); await h.wait((m) => m.t === "live:viewers_list");
  h.close();
  await sleep(700);
  assert.equal(T.db.get("SELECT status FROM live_streams WHERE id = ?", sid).status, "ended");
});

test("live audience: followers-only lives are hidden from non-followers", async () => {
  const sid = (await mira.post("/api/live", { title: "Followers only", audience: "followers" })).data.stream.id;
  await mira.post(`/api/live/${sid}/start`);
  const outsider = await T.as("free.followers.99");   // the only seeded account that does not follow Mira
  assert.equal((await outsider.get(`/api/live/${sid}`)).status, 404);
  assert.ok(!(await outsider.get("/api/live")).data.items.some((l) => l.id === sid));
  assert.equal((await priya.get(`/api/live/${sid}`)).status, 200, "followers can watch");
  await mira.post(`/api/live/${sid}/end`);
});
