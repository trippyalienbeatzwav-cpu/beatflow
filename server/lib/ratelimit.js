// Token-bucket rate limiter, keyed by action and actor. It lives in memory for this single-node
// deployment; with several nodes, back it with Redis (same interface).
import { HttpError } from "./http.js";

export const LIMITS = {
  login: { capacity: 10, perSec: 10 / 60 },
  signup: { capacity: 5, perSec: 5 / 3600 },
  post: { capacity: 10, perSec: 10 / 600 },
  comment: { capacity: 20, perSec: 20 / 60 },
  message: { capacity: 30, perSec: 30 / 30 },
  follow: { capacity: 60, perSec: 60 / 600 },
  react: { capacity: 120, perSec: 2 },
  live_chat: { capacity: 8, perSec: 8 / 10 },
  live_react: { capacity: 30, perSec: 3 },
  gift: { capacity: 15, perSec: 15 / 30 },          // gift spam protection
  payment: { capacity: 10, perSec: 10 / 600 },
  withdrawal: { capacity: 5, perSec: 5 / 3600 },
  withdrawal_code: { capacity: 5, perSec: 5 / 900 },
  report: { capacity: 20, perSec: 20 / 3600 },
  upload: { capacity: 30, perSec: 30 / 600 },
  search: { capacity: 60, perSec: 2 },
  login_account: { capacity: 5, perSec: 5 / 900 },  // per account, whatever the IP (credential stuffing)
  auth_code: { capacity: 5, perSec: 5 / 600 },        // verification / reset code attempts
  auth_mail: { capacity: 3, perSec: 3 / 900 },        // verification / reset emails sent
  cart: { capacity: 60, perSec: 1 },
  play: { capacity: 30, perSec: 30 / 60 },
  download: { capacity: 20, perSec: 20 / 300 },
  store_write: { capacity: 60, perSec: 1 },
  default: { capacity: 120, perSec: 4 },
};

export function createLimiter(clock = () => Date.now()) {
  const buckets = new Map();
  let enabled = true;
  function take(action, actor, cost = 1) {
    if (!enabled) return;
    const cfg = LIMITS[action] ?? LIMITS.default;
    const key = `${action}:${actor}`;
    const now = clock();
    const b = buckets.get(key) ?? { tokens: cfg.capacity, t: now };
    b.tokens = Math.min(cfg.capacity, b.tokens + ((now - b.t) / 1000) * cfg.perSec);
    b.t = now;
    if (b.tokens < cost) {
      buckets.set(key, b);
      const retry = Math.ceil((cost - b.tokens) / cfg.perSec);
      throw new HttpError(429, "rate_limited", `Slow down. Try again in ${retry}s.`, { retry_after: retry });
    }
    b.tokens -= cost;
    buckets.set(key, b);
  }
  // Periodically drop full buckets so memory stays bounded
  const sweep = setInterval(() => {
    const now = clock();
    for (const [k, b] of buckets) if (now - b.t > 3600_000) buckets.delete(k);
  }, 600_000);
  sweep.unref();
  return { take, setEnabled: (v) => (enabled = v), get enabled() { return enabled; }, reset: () => buckets.clear() };
}
