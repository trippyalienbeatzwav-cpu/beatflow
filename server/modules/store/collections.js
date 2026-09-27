// Personal store state: favourites, follows (producers, artists, labels), playlists / DJ crates,
// counted preview plays and recently played. Everything is per account and validated server-side.
import crypto from "node:crypto";
import { id } from "../../lib/ids.js";
import { bad, notFound, HttpError } from "../../lib/http.js";
import { plain } from "../../lib/text.js";

const FAV_KINDS = { beat: "beats", pack: "packs", track: "tracks", release: "releases" };
const FOLLOW_KINDS = { producer: "producers", artist: "artists", label: "labels" };
const PLAY_DEDUPE_MS = 30 * 60_000;       // one counted play per listener per item per 30 minutes
const MAX_PLAYLISTS = 100, MAX_ITEMS = 500;

const exists = (S, table, itemId, published = true) => !!S.db.get(`SELECT 1 FROM ${table} WHERE id = ?${published ? " AND status = 'published'" : ""}`, itemId);
const validId = (s) => /^[\w-]{1,40}$/.test(String(s ?? ""));

function playlistsOut(S, userId) {
  const lists = S.db.all("SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC", userId);
  const items = lists.length ? S.db.all(`SELECT * FROM playlist_items WHERE playlist_id IN (${lists.map(() => "?").join(",")}) ORDER BY position`, ...lists.map((l) => l.id)) : [];
  return lists.map((l) => ({ id: l.id, kind: l.kind, title: l.title, is_public: !!l.is_public, updated_at: l.updated_at, item_ids: items.filter((i) => i.playlist_id === l.id).map((i) => i.item_id) }));
}
export function storeState(S, userId) {
  const ent = S.db.all("SELECT kind, item_id, license_id FROM entitlements WHERE user_id = ? AND revoked_at IS NULL", userId);
  const owned = { beats: {}, packs: [], tracks: [], releases: [] };
  for (const e of ent) {
    if (e.kind === "beat") (owned.beats[e.item_id] ??= []).push(e.license_id ?? "free");
    else owned[`${e.kind}s`].push(e.item_id);
  }
  // Tracks included in an owned release
  if (owned.releases.length) owned.tracks.push(...S.db.all(`SELECT id FROM tracks WHERE release_id IN (${owned.releases.map(() => "?").join(",")})`, ...owned.releases).map((t) => t.id));
  return {
    favorites: S.db.all("SELECT kind, item_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC", userId).map((f) => ({ kind: f.kind, id: f.item_id })),
    follows: S.db.all("SELECT target_kind, target_id FROM store_follows WHERE user_id = ? ORDER BY created_at", userId).map((f) => ({ kind: f.target_kind, id: f.target_id })),
    playlists: playlistsOut(S, userId),
    recent: S.db.all("SELECT item_id, MAX(created_at) t FROM plays WHERE user_id = ? AND kind = 'track' GROUP BY item_id ORDER BY t DESC LIMIT 30", userId).map((p) => p.item_id),
    owned: { ...owned, tracks: [...new Set(owned.tracks)] },
    seller: {
      producer: S.db.get("SELECT id, handle FROM producers WHERE user_id = ?", userId) ?? null,
      artist: S.db.get("SELECT id, handle FROM artists WHERE user_id = ?", userId) ?? null,
      labels: S.db.all("SELECT id, name FROM labels WHERE owner_id = ?", userId),
    },
  };
}

export function register(r, S) {
  r.get("/api/store/me", ({ user }) => storeState(S, user.id));

  // ----- Favourites -----
  r.put("/api/store/favorites/:kind/:id", ({ user, params }) => {
    S.limiter.take("store_write", user.id);
    const table = FAV_KINDS[params.kind];
    if (!table || !validId(params.id)) throw bad("invalid_item", "Unknown item.");
    if (!exists(S, table, params.id)) throw notFound("That item isn’t available.");
    S.db.run("INSERT OR IGNORE INTO favorites (user_id, kind, item_id, created_at) VALUES (?,?,?,?)", user.id, params.kind, params.id, S.now());
    return { favorite: true, count: S.db.get("SELECT COUNT(*) n FROM favorites WHERE kind = ? AND item_id = ?", params.kind, params.id).n };
  });
  r.delete("/api/store/favorites/:kind/:id", ({ user, params }) => {
    if (!FAV_KINDS[params.kind]) throw bad("invalid_item", "Unknown item.");
    S.db.run("DELETE FROM favorites WHERE user_id = ? AND kind = ? AND item_id = ?", user.id, params.kind, params.id);
    return { favorite: false, count: S.db.get("SELECT COUNT(*) n FROM favorites WHERE kind = ? AND item_id = ?", params.kind, params.id).n };
  });

  // ----- Follows (store storefronts) -----
  r.put("/api/store/follows/:kind/:id", ({ user, params }) => {
    S.limiter.take("follow", user.id);
    const table = FOLLOW_KINDS[params.kind];
    if (!table || !validId(params.id)) throw bad("invalid_target", "Unknown storefront.");
    if (!exists(S, table, params.id, false)) throw notFound("That storefront doesn’t exist.");
    S.db.run("INSERT OR IGNORE INTO store_follows (user_id, target_kind, target_id, created_at) VALUES (?,?,?,?)", user.id, params.kind, params.id, S.now());
    return { following: true };
  });
  r.delete("/api/store/follows/:kind/:id", ({ user, params }) => {
    if (!FOLLOW_KINDS[params.kind]) throw bad("invalid_target", "Unknown storefront.");
    S.db.run("DELETE FROM store_follows WHERE user_id = ? AND target_kind = ? AND target_id = ?", user.id, params.kind, params.id);
    return { following: false };
  });

  // ----- Playlists (beats) and crates (tracks) -----
  const own = (userId, pid) => {
    const p = S.db.get("SELECT * FROM playlists WHERE id = ?", pid);
    if (!p || p.user_id !== userId) throw notFound("Playlist not found.");   // never reveal other people's lists
    return p;
  };
  const title = (v) => { const t = plain(v).trim().replace(/\s+/g, " "); if (!t || t.length > 60) throw bad("invalid_title", "Titles are 1–60 characters."); return t; };
  r.post("/api/store/playlists", ({ user, body }) => {
    S.limiter.take("store_write", user.id);
    const kind = body.kind === "crate" ? "crate" : body.kind === "beats" ? "beats" : null;
    if (!kind) throw bad("invalid_kind", "Playlists are for beats or tracks (crates).");
    if (S.db.get("SELECT COUNT(*) n FROM playlists WHERE user_id = ?", user.id).n >= MAX_PLAYLISTS) throw new HttpError(409, "too_many_playlists", `You can have up to ${MAX_PLAYLISTS} playlists.`);
    const pid = id("pl"), now = S.now();
    S.db.run("INSERT INTO playlists (id, user_id, kind, title, is_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", pid, user.id, kind, title(body.title), body.is_public ? 1 : 0, now, now);
    const ids = Array.isArray(body.item_ids) ? body.item_ids.slice(0, MAX_ITEMS) : [];
    ids.forEach((iid, i) => { if (validId(iid) && exists(S, kind === "crate" ? "tracks" : "beats", iid)) S.db.run("INSERT OR IGNORE INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?,?,?,?)", pid, iid, i, now); });
    return { playlist: playlistsOut(S, user.id).find((p) => p.id === pid) };
  });
  r.patch("/api/store/playlists/:id", ({ user, params, body }) => {
    const p = own(user.id, params.id);
    S.db.tx(() => {
      S.db.run("UPDATE playlists SET title = ?, is_public = ?, updated_at = ? WHERE id = ?", body.title != null ? title(body.title) : p.title, body.is_public != null ? (body.is_public ? 1 : 0) : p.is_public, S.now(), p.id);
      // Reorder: the new order must contain exactly the playlist's current items
      if (body.item_ids != null) {
        const cur = S.db.all("SELECT item_id FROM playlist_items WHERE playlist_id = ?", p.id).map((x) => x.item_id);
        const next = Array.isArray(body.item_ids) ? body.item_ids.map(String) : [];
        if (next.length !== cur.length || new Set(next).size !== next.length || next.some((x) => !cur.includes(x))) throw bad("invalid_order", "The new order must list each item of the playlist exactly once.");
        next.forEach((iid, i) => S.db.run("UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND item_id = ?", i, p.id, iid));
      }
    });
    return { playlist: playlistsOut(S, user.id).find((x) => x.id === p.id) };
  });
  // Clear "recently played": the plays stay counted for artists, but are no longer linked to this account
  r.delete("/api/store/recent", ({ user }) => {
    S.db.run("UPDATE plays SET user_id = NULL, listener = 'cleared:' || id WHERE user_id = ?", user.id);
    return { ok: true };
  });
  r.delete("/api/store/playlists/:id", ({ user, params }) => { own(user.id, params.id); S.db.run("DELETE FROM playlists WHERE id = ?", params.id); return { ok: true }; });
  r.post("/api/store/playlists/:id/items", ({ user, params, body }) => {
    S.limiter.take("store_write", user.id);
    const p = own(user.id, params.id);
    const iid = String(body.item_id ?? "");
    if (!validId(iid) || !exists(S, p.kind === "crate" ? "tracks" : "beats", iid)) throw bad("invalid_item", p.kind === "crate" ? "Crates hold tracks from the Electronic Music Store." : "Playlists hold beats from the Beats Store.");
    const n = S.db.get("SELECT COUNT(*) n, MAX(position) m FROM playlist_items WHERE playlist_id = ?", p.id);
    if (n.n >= MAX_ITEMS) throw new HttpError(409, "playlist_full", `A playlist can hold ${MAX_ITEMS} items.`);
    const added = S.db.run("INSERT OR IGNORE INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?,?,?,?)", p.id, iid, (n.m ?? -1) + 1, S.now()).changes > 0;
    S.db.run("UPDATE playlists SET updated_at = ? WHERE id = ?", S.now(), p.id);
    return { added, playlist: playlistsOut(S, user.id).find((x) => x.id === p.id) };
  });
  r.delete("/api/store/playlists/:id/items/:item", ({ user, params }) => {
    const p = own(user.id, params.id);
    S.db.run("DELETE FROM playlist_items WHERE playlist_id = ? AND item_id = ?", p.id, params.item);
    S.db.run("UPDATE playlists SET updated_at = ? WHERE id = ?", S.now(), p.id);
    return { playlist: playlistsOut(S, user.id).find((x) => x.id === p.id) };
  });

  // ----- Counted plays (a listen of 5 s or more, reported by the player) -----
  r.post("/api/store/plays", ({ user, body, req, ip }) => {
    const kind = String(body.kind ?? ""), itemId = String(body.id ?? "");
    const table = { beat: "beats", pack: "packs", track: "tracks" }[kind];
    if (!table || !validId(itemId)) throw bad("invalid_item", "Unknown item.");
    const listener = user?.id ?? crypto.createHash("sha256").update(`${ip}|${req.headers["user-agent"] ?? ""}|${S.cfg.downloadSecret}`).digest("hex").slice(0, 32);
    S.limiter.take("play", listener);
    if (!exists(S, table, itemId)) throw notFound("That item isn’t available.");
    const now = S.now();
    if (S.db.get("SELECT 1 FROM plays WHERE listener = ? AND kind = ? AND item_id = ? AND created_at > ?", listener, kind, itemId, now - PLAY_DEDUPE_MS)) return { counted: false };
    S.db.tx(() => {
      S.db.run("INSERT INTO plays (kind, item_id, user_id, listener, created_at) VALUES (?,?,?,?,?)", kind, itemId, user?.id ?? null, listener, now);
      if (kind !== "pack") S.db.run(`UPDATE ${table} SET play_count = play_count + 1 WHERE id = ?`, itemId);
    });
    return { counted: true };
  }, { public: true });
}
