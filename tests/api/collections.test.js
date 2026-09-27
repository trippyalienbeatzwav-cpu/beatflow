// Store collections (favourites, follows, playlists/crates), play counting, store reports and schema versioning.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../helpers.js";
import { openDb } from "../../server/lib/db.js";
import { LATEST } from "../../server/db/migrations.js";

let T, rafi, priya;
before(async () => { T = await startServer(); [rafi, priya] = await Promise.all([T.as("rafi.listens"), T.as("priya.plays")]); });
after(() => T.close());

test("favourites and follows are idempotent and validated", async () => {
  assert.equal((await rafi.put("/api/store/favorites/beat/b1")).status, 200);
  const again = await rafi.put("/api/store/favorites/beat/b1");
  assert.equal(again.data.favorite, true);
  assert.ok((await rafi.get("/api/store/me")).data.favorites.some((f) => f.id === "b1" || f === "b1" || f.item_id === "b1"));
  assert.equal((await rafi.put("/api/store/favorites/beat/nope")).status, 404);
  assert.equal((await rafi.put("/api/store/favorites/user/b1")).status, 400);
  assert.equal((await rafi.put(`/api/store/favorites/beat/${"x".repeat(300)}`)).status, 400);
  assert.equal((await rafi.del("/api/store/favorites/beat/b1")).data.favorite, false);
  assert.equal((await rafi.put("/api/store/follows/producer/p2")).status, 200);
  assert.equal((await rafi.put("/api/store/follows/producer/does-not-exist")).status, 404);
  assert.equal((await T.client().put("/api/store/favorites/beat/b1")).status, 401, "signed-out users can't write");
});

test("playlists: create, reorder, add/remove, and other users can't touch them", async () => {
  const p = (await rafi.post("/api/store/playlists", { kind: "beats", title: "  <b>Night</b>   set ", item_ids: ["b1", "b3", "nope", "b3"] })).data.playlist;
  assert.deepEqual(p.itemIds ?? p.item_ids, ["b1", "b3"], "unknown and duplicate ids are dropped");
  assert.doesNotMatch(p.title, /[<>]/);
  const re = await rafi.patch(`/api/store/playlists/${p.id}`, { item_ids: ["b3", "b1"] });
  assert.equal(re.status, 200);
  assert.deepEqual(re.data.playlist.itemIds ?? re.data.playlist.item_ids, ["b3", "b1"]);
  assert.equal((await priya.patch(`/api/store/playlists/${p.id}`, { title: "mine now" })).status, 404, "IDOR");
  assert.equal((await priya.post(`/api/store/playlists/${p.id}/items`, { id: "b5" })).status, 404, "IDOR");
  assert.equal((await priya.del(`/api/store/playlists/${p.id}`)).status, 404, "IDOR");
  assert.equal((await rafi.post("/api/store/playlists", { kind: "videos", title: "x" })).status, 400);
  assert.equal((await rafi.del(`/api/store/playlists/${p.id}`)).status, 200);
});

test("plays: counted once per listener per 30 minutes, anonymous listeners included", async () => {
  const before = T.db.get("SELECT play_count FROM beats WHERE id = 'b4'").play_count;
  assert.equal((await rafi.post("/api/store/plays", { kind: "beat", id: "b4" })).data.counted, true);
  assert.equal((await rafi.post("/api/store/plays", { kind: "beat", id: "b4" })).data.counted, false);
  assert.equal((await T.client().post("/api/store/plays", { kind: "beat", id: "b4" })).data.counted, true);
  assert.equal(T.db.get("SELECT play_count FROM beats WHERE id = 'b4'").play_count, before + 2);
  const clock = T.S.now; T.S.now = () => clock() + 31 * 60_000;
  try { assert.equal((await rafi.post("/api/store/plays", { kind: "beat", id: "b4" })).data.counted, true); } finally { T.S.now = clock; }
  assert.equal((await rafi.post("/api/store/plays", { kind: "beat", id: "missing" })).status, 404);
  assert.equal((await rafi.post("/api/store/plays", { kind: "../etc", id: "b4" })).status, 400);
});

test("store items can be reported and reach the moderation queue", async () => {
  const r = await rafi.post("/api/reports", { target_type: "beat", target_id: "b5", reason: "ip", details: "uses my sample" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await rafi.post("/api/reports", { target_type: "beat", target_id: "nope", reason: "ip" })).status, 404);
  const admin = await T.as("tunibeat.team");
  const q = await admin.get("/api/admin/reports");
  assert.ok(JSON.stringify(q.data).includes("b5"));
});

test("schema: a new database is stamped with the latest version and reopening is a no-op", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mig-"));
  const file = path.join(dir, "t.db");
  const a = openDb(file);
  const v = a.get("PRAGMA user_version").user_version;
  a.run("INSERT INTO users (id, username, email, password_hash, display_name, created_at) VALUES ('u1','keep','k@e.co','x','Keep',1)");
  a.close();
  assert.equal(v, LATEST);
  const b = openDb(file);
  assert.equal(b.get("PRAGMA user_version").user_version, LATEST);
  assert.equal(b.get("SELECT username FROM users WHERE id = 'u1'").username, "keep");
  assert.equal(b.get("PRAGMA integrity_check").integrity_check, "ok");
  b.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
