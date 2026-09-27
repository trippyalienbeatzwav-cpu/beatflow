// Vercel Routing Middleware (runs only on Vercel). Vercel hosts the static front end (dist/); the Node server
// (server/index.js) runs on a long-lived host such as Render. This forwards /api and /media to it, so the
// browser stays same-origin: session cookies, CSRF checks and relative URLs work unchanged.
//
// Vercel project settings → Environment Variables:
//   API_ORIGIN    the Node server's origin, e.g. https://beatflow-api.onrender.com   (required)
//   PROXY_SECRET  same value as on the server; lets it trust the visitor IP this sends (rate limits)
// WebSockets can't be proxied by Vercel: the page connects to the server directly with a one-time ticket
// (PUBLIC_WS_URL / RENDER_EXTERNAL_URL on the server).
import { rewrite, ipAddress } from "@vercel/functions";

export const config = { matcher: ["/api/:path*", "/media/:path*"] };

export default function middleware(request) {
  return proxy(request, process.env);
}

/**
 * @param {Request} request
 * @param {Record<string, string | undefined>} env
 */
export function proxy(request, env) {
  const origin = parseOrigin(env.API_ORIGIN);
  if (!origin) {
    return Response.json(
      { error: { code: "api_not_configured", message: "The TUNIBEAT API isn’t connected yet. Set API_ORIGIN in the Vercel project to the Node server’s URL and redeploy." } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  // Never let a visitor supply these themselves
  headers.delete("x-tunibeat-proxy");
  headers.delete("x-tunibeat-client-ip");
  if (env.PROXY_SECRET) {
    headers.set("x-tunibeat-proxy", env.PROXY_SECRET);
    const ip = ipAddress(request);
    if (ip) headers.set("x-tunibeat-client-ip", ip);
  }
  return rewrite(target, { request: { headers } });
}

/** Accepts "https://host[:port]" (http only for localhost); anything else counts as not configured. */
function parseOrigin(value) {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return u.origin;
  } catch {
    return null;
  }
}
