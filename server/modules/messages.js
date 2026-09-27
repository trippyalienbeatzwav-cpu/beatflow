// Direct messages and group chats. Delivery is real time over the members' user channels. Each message
// carries a sender-generated client_id, so a retried send can never create a duplicate. Whether a new
// conversation lands in the inbox or in message requests depends on the recipient's privacy setting.
import { id } from "../lib/ids.js";
import { bad, forbidden, notFound, HttpError } from "../lib/http.js";
import { json } from "../lib/db.js";
import { cardsById, getUser, privacyOf, isBlockedEither, isFollowing } from "./users.js";
import { mediaOut, ownedMedia } from "./media.js";
import { notify } from "./notifications.js";
import { REACTIONS, canViewPost, serializePosts } from "./posts.js";

const KINDS = ["text", "image", "video", "voice", "file", "story_reply", "post_share"];
const EDIT_WINDOW_MS = 15 * 60_000;

function membership(S, convId, userId) {
  const m = S.db.get("SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?", convId, userId);
  if (!m || m.state === "left" || m.state === "declined") throw notFound("Conversation not found.");
  return m;
}

/** Where a new conversation from `sender` should land for `recipient`: "active" (inbox) or "request". Throws if not allowed. */
function landingState(S, senderId, recipient) {
  if (isBlockedEither(S, senderId, recipient.id)) throw forbidden("blocked", "You can’t message this account.");
  const setting = privacyOf(S, recipient.id).messages;
  if (setting === "nobody") throw forbidden("messages_closed", "This account isn’t accepting new messages.");
  if (setting === "everyone") return "active";
  return isFollowing(S, recipient.id, senderId) ? "active" : "request";   // "following": only people they follow reach the inbox; others go to requests
}

function getOrCreateDm(S, sender, recipientId) {
  const recipient = getUser(S, recipientId);
  if (!recipient || recipient.status !== "active") throw notFound("That account isn’t available.");
  if (recipient.id === sender.id) throw bad("self_message", "You can’t message yourself.");
  const key = [sender.id, recipient.id].sort().join(":");
  const existing = S.db.get("SELECT * FROM conversations WHERE dm_key = ?", key);
  if (existing) {
    if (isBlockedEither(S, sender.id, recipient.id)) throw forbidden("blocked", "You can’t message this account.");
    return existing;
  }
  const state = landingState(S, sender.id, recipient);
  const cid = id("cv");
  const now = S.now();
  S.db.run("INSERT INTO conversations (id, kind, dm_key, created_by, last_message_at, created_at) VALUES (?,?,?,?,?,?)", cid, "dm", key, sender.id, now, now);
  S.db.run("INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)", cid, sender.id, "owner", "active", now);
  S.db.run("INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)", cid, recipient.id, "member", state, now);
  return S.db.get("SELECT * FROM conversations WHERE id = ?", cid);
}

function messageOut(S, rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map((m) => m.id);
  const ph = ids.map(() => "?").join(",");
  const senders = cardsById(S, rows.map((m) => m.sender_id));
  const media = Object.fromEntries(S.db.all(`SELECT * FROM media WHERE id IN (${rows.map(() => "?").join(",")})`, ...rows.map((m) => m.media_id ?? "")).map((x) => [x.id, x]));
  const reacts = S.db.all(`SELECT target_id, kind, user_id FROM reactions WHERE target_type = 'message' AND target_id IN (${ph})`, ...ids);
  const replyIds = rows.map((m) => m.reply_to_id).filter(Boolean);
  const replies = replyIds.length ? Object.fromEntries(S.db.all(`SELECT id, sender_id, body, kind, deleted_at FROM messages WHERE id IN (${replyIds.map(() => "?").join(",")})`, ...replyIds).map((x) => [x.id, x])) : {};
  return rows.map((m) => {
    const ref = json(m.ref, {});
    let refOut = null;
    if (m.kind === "story_reply" && ref.story_id) {
      const st = S.db.get("SELECT s.*, md.storage_key, md.poster_key, md.kind AS mk FROM stories s LEFT JOIN media md ON md.id = s.media_id WHERE s.id = ?", ref.story_id);
      refOut = st && st.status === "active" && st.expires_at > S.now()
        ? { type: "story", story_id: st.id, author_id: st.author_id, preview_url: S.mediaUrl(st.mk === "video" ? st.poster_key : st.storage_key), text: json(st.content, {}).text ?? "" }
        : { type: "story", unavailable: true };
    }
    if (m.kind === "post_share" && ref.post_id) {
      const p = S.db.get("SELECT * FROM posts WHERE id = ?", ref.post_id);
      refOut = p && canViewPost(S, viewerId, p) ? { type: "post", post: serializePosts(S, [p], viewerId)[0] } : { type: "post", unavailable: true };
    }
    const rs = reacts.filter((r) => r.target_id === m.id);
    const grouped = {};
    rs.forEach((r) => { grouped[r.kind] = grouped[r.kind] ?? { kind: r.kind, count: 0, mine: false }; grouped[r.kind].count++; if (r.user_id === viewerId) grouped[r.kind].mine = true; });
    const rep = m.reply_to_id ? replies[m.reply_to_id] : null;
    return {
      id: m.id, conversation_id: m.conversation_id, sender: senders[m.sender_id], kind: m.kind, client_id: m.sender_id === viewerId ? m.client_id : undefined,
      body: m.deleted_at ? "" : m.body, media: m.deleted_at ? null : mediaOut(S, media[m.media_id]), deleted: !!m.deleted_at, edited_at: m.edited_at, created_at: m.created_at,
      reply_to: rep ? { id: rep.id, sender_id: rep.sender_id, kind: rep.kind, body: rep.deleted_at ? "" : rep.body.slice(0, 140), deleted: !!rep.deleted_at } : null,
      ref: refOut, reactions: Object.values(grouped),
    };
  });
}

const activeMembers = (S, convId) => S.db.all("SELECT user_id, state FROM conversation_members WHERE conversation_id = ? AND state IN ('active','request')", convId);
function broadcast(S, convId, msg, exceptUser) {
  for (const m of activeMembers(S, convId)) if (m.user_id !== exceptUser) S.rt.toUser(m.user_id, msg);
}

/** Append a message to a conversation the sender belongs to. */
export function postMessage(S, conv, sender, p) {
  const kind = p.kind ?? "text";
  if (!KINDS.includes(kind)) throw bad("invalid_kind", "Unknown message type.");
  const body = String(p.body ?? "");
  if (body.length > 4000) throw bad("message_too_long", "Messages can be up to 4,000 characters.");
  const clientId = p.client_id ? String(p.client_id).slice(0, 64) : null;
  if (clientId) {
    const dupe = S.db.get("SELECT * FROM messages WHERE sender_id = ? AND client_id = ?", sender.id, clientId);
    if (dupe) return { message: messageOut(S, [dupe], sender.id)[0], conversation_id: dupe.conversation_id, duplicate: true };
  }
  S.limiter.take("message", sender.id);
  let media = null;
  if (["image", "video", "voice", "file"].includes(kind)) {
    if (!p.media_id) throw bad("media_required", "Attach a file.");
    media = ownedMedia(S, sender.id, [p.media_id], kind === "voice" ? ["audio"] : kind === "file" ? ["file", "image", "video", "audio"] : [kind])[0];
  } else if (!body.trim() && kind !== "post_share") throw bad("empty_message", "Write a message first.");
  let ref = {};
  if (kind === "story_reply") ref = { story_id: String(p.ref?.story_id ?? "") };
  if (kind === "post_share") {
    const post = S.db.get("SELECT * FROM posts WHERE id = ?", String(p.ref?.post_id ?? p.post_id ?? ""));
    if (!post || !canViewPost(S, sender.id, post)) throw notFound("That post isn’t available.");
    ref = { post_id: post.id };
  }
  let replyTo = null;
  if (p.reply_to_id) {
    replyTo = S.db.get("SELECT id FROM messages WHERE id = ? AND conversation_id = ?", String(p.reply_to_id), conv.id);
    if (!replyTo) throw bad("invalid_reply", "The message you replied to isn’t in this conversation.");
  }
  const mid = id("msg");
  const now = S.now();
  const firstForRequest = S.db.tx(() => {
    S.db.run(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, media_id, reply_to_id, ref, client_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      mid, conv.id, sender.id, kind, body.trim(), media?.id ?? null, replyTo?.id ?? null, JSON.stringify(ref), clientId, now);
    S.db.run("UPDATE conversations SET last_message_id = ?, last_message_at = ? WHERE id = ?", mid, now, conv.id);
    S.db.run("UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?", mid, conv.id, sender.id);
    // Revive a DM the recipient had cleared from their inbox
    S.db.run("UPDATE conversation_members SET state = 'active' WHERE conversation_id = ? AND state = 'left' AND ? = 'dm'", conv.id, conv.kind);
    if (kind === "post_share") S.db.run("INSERT INTO shares (id, user_id, post_id, channel, created_at) VALUES (?,?,?,?,?)", id("sh"), sender.id, ref.post_id, "message", now);
    return S.db.all("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND state = 'request'", conv.id)
      .filter((m) => m.user_id !== sender.id && S.db.get("SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND sender_id = ?", conv.id, sender.id).n === 1);
  });
  const out = messageOut(S, [S.db.get("SELECT * FROM messages WHERE id = ?", mid)], sender.id)[0];
  for (const m of activeMembers(S, conv.id)) {
    const view = m.user_id === sender.id ? out : { ...out, client_id: undefined };
    S.rt.toUser(m.user_id, { t: "message", conversation_id: conv.id, message: view, request: m.state === "request" });
  }
  firstForRequest.forEach((m) => notify(S, { userId: m.user_id, type: "message_request", actorId: sender.id, targetType: "conversation", targetId: conv.id }));
  return { message: out, conversation_id: conv.id };
}

/** Send a DM (creating the conversation when needed). Used by story replies and profile "Message". */
export function sendDirect(S, sender, recipientId, payload) {
  const conv = S.db.tx(() => getOrCreateDm(S, sender, recipientId));
  const me = membership(S, conv.id, sender.id);
  if (me.state === "request") S.db.run("UPDATE conversation_members SET state = 'active' WHERE conversation_id = ? AND user_id = ?", conv.id, sender.id);
  return postMessage(S, conv, sender, payload);
}

function conversationOut(S, conv, viewerId) {
  const members = S.db.all("SELECT user_id, role, state, last_read_id, muted FROM conversation_members WHERE conversation_id = ? AND state <> 'left'", conv.id);
  const cards = cardsById(S, members.map((m) => m.user_id));
  const me = members.find((m) => m.user_id === viewerId);
  const last = conv.last_message_id ? S.db.get("SELECT * FROM messages WHERE id = ?", conv.last_message_id) : null;
  const myActivity = privacyOf(S, viewerId).activity_status;
  const others = members.filter((m) => m.user_id !== viewerId);
  return {
    id: conv.id, kind: conv.kind, title: conv.title,
    members: members.map((m) => ({ ...cards[m.user_id], role: m.role, state: m.state, last_read_id: m.last_read_id,
      online: m.user_id !== viewerId && myActivity && privacyOf(S, m.user_id).activity_status ? S.rt.isOnline(m.user_id) : undefined })),
    state: me?.state, muted: !!me?.muted, role: me?.role,
    unread: !!(last && last.sender_id !== viewerId && (!me?.last_read_id || me.last_read_id < last.id)),
    last_message: last ? { id: last.id, sender_id: last.sender_id, kind: last.kind, body: last.deleted_at ? "" : last.body.slice(0, 120), deleted: !!last.deleted_at, created_at: last.created_at } : null,
    last_message_at: conv.last_message_at,
    blocked: conv.kind === "dm" && others[0] ? isBlockedEither(S, viewerId, others[0].user_id) : false,
  };
}

export function register(r, S) {
  r.get("/api/conversations", ({ user, query }) => {
    const folder = query.folder === "requests" ? "request" : "active";
    const rows = S.db.all(`SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id
      WHERE m.user_id = ? AND m.state = ? ${query.cursor ? "AND c.last_message_at < ?" : ""} AND (c.last_message_id IS NOT NULL OR c.kind = 'group' OR c.created_by = ?)
      ORDER BY c.last_message_at DESC LIMIT 31`, user.id, folder, ...(query.cursor ? [Number(query.cursor)] : []), user.id);
    const page = rows.slice(0, 30);
    return { items: page.map((c) => conversationOut(S, c, user.id)), next_cursor: rows.length > 30 ? String(page.at(-1).last_message_at) : null };
  });

  r.post("/api/conversations", ({ user, body }) => {
    const ids = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : []).map(String))].filter((x) => x !== user.id);
    if (!ids.length) throw bad("no_members", "Pick at least one person.");
    if (ids.length === 1 && !body.title) return { conversation: conversationOut(S, S.db.tx(() => getOrCreateDm(S, user, ids[0])), user.id) };
    if (ids.length > 31) throw bad("too_many_members", "Groups can have up to 32 people.");
    const cid = id("cv");
    const now = S.now();
    S.db.tx(() => {
      S.db.run("INSERT INTO conversations (id, kind, title, created_by, last_message_at, created_at) VALUES (?,?,?,?,?,?)", cid, "group", String(body.title ?? "").slice(0, 60) || null, user.id, now, now);
      S.db.run("INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)", cid, user.id, "owner", "active", now);
      for (const uid of ids) {
        const u = getUser(S, uid);
        if (!u || u.status !== "active") throw bad("unknown_user", "One of those accounts isn’t available.");
        const state = landingState(S, user.id, u);
        S.db.run("INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)", cid, u.id, "member", state, now);
      }
    });
    const conv = S.db.get("SELECT * FROM conversations WHERE id = ?", cid);
    postMessage(S, conv, user, { kind: "text", body: `${user.display_name} created the group` });
    return { conversation: conversationOut(S, conv, user.id) };
  });

  r.get("/api/conversations/:id", ({ params, user }) => {
    membership(S, params.id, user.id);
    return { conversation: conversationOut(S, S.db.get("SELECT * FROM conversations WHERE id = ?", params.id), user.id) };
  });

  r.get("/api/conversations/:id/messages", ({ params, user, query }) => {
    membership(S, params.id, user.id);
    const rows = S.db.all(`SELECT * FROM messages WHERE conversation_id = ? ${query.before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT 41`, params.id, ...(query.before ? [String(query.before)] : []));
    const page = rows.slice(0, 40).reverse();
    return { items: messageOut(S, page, user.id), has_more: rows.length > 40 };
  });

  r.post("/api/conversations/:id/messages", ({ params, user, body }) => {
    const me = membership(S, params.id, user.id);
    const conv = S.db.get("SELECT * FROM conversations WHERE id = ?", params.id);
    if (conv.kind === "dm") {
      const other = S.db.get("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?", conv.id, user.id);
      if (other && isBlockedEither(S, user.id, other.user_id)) throw forbidden("blocked", "You can’t message this account.");
    }
    // Replying to a request accepts it
    if (me.state === "request") S.db.run("UPDATE conversation_members SET state = 'active' WHERE conversation_id = ? AND user_id = ?", conv.id, user.id);
    return postMessage(S, conv, user, body);
  });

  r.patch("/api/messages/:id", ({ params, user, body }) => {
    const m = S.db.get("SELECT * FROM messages WHERE id = ?", params.id);
    if (!m || m.deleted_at) throw notFound("Message not found.");
    if (m.sender_id !== user.id) throw forbidden("not_sender", "You can only edit your own messages.");
    if (!["text", "story_reply"].includes(m.kind)) throw bad("not_editable", "Only text messages can be edited.");
    if (S.now() - m.created_at > EDIT_WINDOW_MS) throw forbidden("edit_window", "Messages can be edited for 15 minutes.");
    const text = String(body.body ?? "").trim();
    if (!text || text.length > 4000) throw bad("invalid_body", "Messages are 1–4,000 characters.");
    S.db.run("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?", text, S.now(), m.id);
    const out = messageOut(S, [S.db.get("SELECT * FROM messages WHERE id = ?", m.id)], user.id)[0];
    broadcast(S, m.conversation_id, { t: "message_updated", conversation_id: m.conversation_id, message: { ...out, client_id: undefined } });
    return { message: out };
  });

  r.delete("/api/messages/:id", ({ params, user }) => {
    const m = S.db.get("SELECT * FROM messages WHERE id = ?", params.id);
    if (!m || m.deleted_at) throw notFound("Message not found.");
    if (m.sender_id !== user.id) throw forbidden("not_sender", "You can only unsend your own messages.");
    S.db.run("UPDATE messages SET deleted_at = ?, body = '', media_id = NULL WHERE id = ?", S.now(), m.id);
    broadcast(S, m.conversation_id, { t: "message_deleted", conversation_id: m.conversation_id, message_id: m.id });
    return { ok: true };
  });

  r.post("/api/messages/:id/react", ({ params, user, body }) => {
    const kind = body.kind ?? "love";
    if (!REACTIONS.includes(kind)) throw bad("invalid_reaction", "Unknown reaction.");
    const m = S.db.get("SELECT * FROM messages WHERE id = ?", params.id);
    if (!m || m.deleted_at) throw notFound("Message not found.");
    membership(S, m.conversation_id, user.id);
    S.db.run(`INSERT INTO reactions (user_id, target_type, target_id, kind, created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET kind = excluded.kind`, user.id, "message", m.id, kind, S.now());
    const out = messageOut(S, [m], user.id)[0];
    broadcast(S, m.conversation_id, { t: "message_reactions", conversation_id: m.conversation_id, message_id: m.id, user_id: user.id, kind });
    return { reactions: out.reactions };
  });
  r.delete("/api/messages/:id/react", ({ params, user }) => {
    const m = S.db.get("SELECT * FROM messages WHERE id = ?", params.id);
    if (!m) throw notFound("Message not found.");
    membership(S, m.conversation_id, user.id);
    S.db.run("DELETE FROM reactions WHERE user_id = ? AND target_type = 'message' AND target_id = ?", user.id, m.id);
    broadcast(S, m.conversation_id, { t: "message_reactions", conversation_id: m.conversation_id, message_id: m.id, user_id: user.id, kind: null });
    return { ok: true };
  });

  r.post("/api/conversations/:id/read", ({ params, user, body }) => {
    const me = membership(S, params.id, user.id);
    const mid = String(body.message_id ?? "");
    const msg = S.db.get("SELECT id FROM messages WHERE id = ? AND conversation_id = ?", mid, params.id);
    if (!msg) throw bad("invalid_message", "Unknown message.");
    if (!me.last_read_id || me.last_read_id < msg.id) {
      S.db.run("UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?", msg.id, params.id, user.id);
      broadcast(S, params.id, { t: "read", conversation_id: params.id, user_id: user.id, message_id: msg.id });
    }
    return { ok: true };
  });

  r.post("/api/conversations/:id/:action", ({ params, user, body }) => {
    const me = membership(S, params.id, user.id);
    const conv = S.db.get("SELECT * FROM conversations WHERE id = ?", params.id);
    switch (params.action) {
      case "accept":
        if (me.state !== "request") throw bad("not_a_request", "This conversation isn’t a request.");
        S.db.run("UPDATE conversation_members SET state = 'active' WHERE conversation_id = ? AND user_id = ?", conv.id, user.id);
        break;
      case "decline":
        if (me.state !== "request") throw bad("not_a_request", "This conversation isn’t a request.");
        S.db.run("UPDATE conversation_members SET state = 'declined' WHERE conversation_id = ? AND user_id = ?", conv.id, user.id);
        break;
      case "leave":
        S.db.run("UPDATE conversation_members SET state = 'left' WHERE conversation_id = ? AND user_id = ?", conv.id, user.id);
        if (conv.kind === "group") postMessage(S, conv, user, { kind: "text", body: `${user.display_name} left the group` });
        break;
      case "mute":
        S.db.run("UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?", body.muted === false ? 0 : 1, conv.id, user.id);
        break;
      case "members": {
        if (conv.kind !== "group") throw bad("not_group", "Only groups can add people.");
        if (!["owner", "admin"].includes(me.role)) throw forbidden("not_admin", "Only group admins can add people.");
        const ids = (Array.isArray(body.user_ids) ? body.user_ids : []).map(String);
        const count = S.db.get("SELECT COUNT(*) n FROM conversation_members WHERE conversation_id = ? AND state IN ('active','request')", conv.id).n;
        if (count + ids.length > 32) throw bad("too_many_members", "Groups can have up to 32 people.");
        S.db.tx(() => ids.forEach((uid) => {
          const u = getUser(S, uid);
          if (!u) throw bad("unknown_user", "Unknown account.");
          S.db.run(`INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)
            ON CONFLICT(conversation_id, user_id) DO UPDATE SET state = excluded.state`, conv.id, u.id, "member", landingState(S, user.id, u), S.now());
        }));
        break;
      }
      case "title":
        if (conv.kind !== "group") throw bad("not_group", "Only groups have titles.");
        S.db.run("UPDATE conversations SET title = ? WHERE id = ?", String(body.title ?? "").slice(0, 60) || null, conv.id);
        break;
      default: throw notFound();
    }
    return { conversation: conversationOut(S, S.db.get("SELECT * FROM conversations WHERE id = ?", conv.id), user.id) };
  });

  r.get("/api/messages/search", ({ user, query }) => {
    S.limiter.take("search", user.id);
    const q = String(query.q ?? "").trim();
    if (q.length < 2) return { items: [] };
    const rows = S.db.all(`SELECT m.* FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ? AND cm.state = 'active'
      WHERE m.deleted_at IS NULL AND m.body LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 50`, user.id, `%${q.replace(/[%_\\]/g, "\\$&")}%`);
    return { items: messageOut(S, rows, user.id) };
  });

  r.get("/api/presence", ({ user, query }) => {
    const ids = String(query.ids ?? "").split(",").filter(Boolean).slice(0, 50);
    const mine = privacyOf(S, user.id).activity_status;
    // Activity status is mutual: hide yours and you can't see anyone's
    return { items: Object.fromEntries(ids.map((uid) => [uid, mine && privacyOf(S, uid)?.activity_status && !isBlockedEither(S, user.id, uid) ? S.rt.isOnline(uid) : null])) };
  });
}

export function init(S) {
  const memberCache = new Map();
  S.rt.guard("conv:", (conn, convId) => !!S.db.get("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND state IN ('active','request')", convId, conn.userId));
  S.rt.on("typing", (conn, msg) => {
    const convId = String(msg.conversation_id ?? "");
    const k = `${convId}:${conn.userId}`;
    let ok = memberCache.get(k);
    if (ok === undefined) {
      ok = !!S.db.get("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND state = 'active'", convId, conn.userId);
      memberCache.set(k, ok);
      setTimeout(() => memberCache.delete(k), 60_000).unref();
    }
    if (!ok) return;
    for (const m of activeMembers(S, convId)) if (m.user_id !== conn.userId) S.rt.toUser(m.user_id, { t: "typing", conversation_id: convId, user_id: conn.userId, typing: msg.typing !== false });
  });
  // Tell DM partners when someone comes online or goes offline (only if both share activity status)
  S.rt.onPresence((userId, online) => {
    if (!privacyOf(S, userId)?.activity_status) return;
    const partners = S.db.all(`SELECT DISTINCT cm2.user_id FROM conversation_members cm1 JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
      WHERE cm1.user_id = ? AND cm2.user_id <> ? AND cm2.state = 'active' LIMIT 500`, userId, userId);
    for (const p of partners) if (S.rt.isOnline(p.user_id) && privacyOf(S, p.user_id).activity_status) S.rt.toUser(p.user_id, { t: "presence", user_id: userId, online });
  });
}

export { HttpError };
