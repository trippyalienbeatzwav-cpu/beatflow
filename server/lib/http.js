// Minimal HTTP toolkit: a router, typed errors, JSON bodies, cookies, and static and range file serving.
import fs from "node:fs";
import path from "node:path";

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message ?? code);
    this.status = status; this.code = code; this.extra = extra;
  }
}
export const bad = (code, msg, extra) => new HttpError(400, code, msg, extra);
export const forbidden = (code = "forbidden", msg = "You don't have permission to do that.") => new HttpError(403, code, msg);
export const notFound = (what = "Not found") => new HttpError(404, "not_found", what);
export const conflict = (code, msg) => new HttpError(409, code, msg);

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
    this.routes.push({ method, re, keys, handler, opts });
    return this;
  }
  get(p, h, o) { return this.add("GET", p, h, o); }
  post(p, h, o) { return this.add("POST", p, h, o); }
  put(p, h, o) { return this.add("PUT", p, h, o); }
  patch(p, h, o) { return this.add("PATCH", p, h, o); }
  delete(p, h, o) { return this.add("DELETE", p, h, o); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, "payload_too_large", `Request body exceeds ${limit} bytes`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJson(req, limit = 256 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch { throw bad("invalid_json", "Request body must be a JSON object."); }
}

export function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export function setCookie(res, name, value, { maxAge = null, secure = false, httpOnly = true, sameSite = "Lax", path: p = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${p}`, `SameSite=${sameSite}`];
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), parts.join("; ")]);
}

export function sendJson(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
  ".opus": "audio/ogg; codecs=opus", ".wf": "application/octet-stream", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".pdf": "application/pdf",
};
export const contentType = (file) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * Serve a file with ETag and HTTP Range support (required for video seeking).
 */
export function sendFile(req, res, file, { type = null, cache = "no-cache", extraHeaders = {} } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = { "Content-Type": type ?? contentType(file), "Cache-Control": cache, ETag: etag, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", ...extraHeaders };
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); res.end(); return true; }
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    let start = range[1] === "" ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : st.size - 1;
    if (range[1] === "") end = st.size - 1;
    if (start < 0) start = 0;
    if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); res.end(); return true; }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") { res.end(); return true; }
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, "Content-Length": st.size });
  if (req.method === "HEAD") { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Resolve a URL path under root, refusing traversal. */
export function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const full = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  return full.startsWith(path.resolve(root)) ? full : null;
}
