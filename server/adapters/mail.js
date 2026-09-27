// Transactional mail. Development writes to a local outbox (visible at Settings → Developer outbox) so
// verification codes can be read without an email provider. Production sends through Resend
// (RESEND_API_KEY + MAIL_FROM); with no provider configured, sending fails closed.
import { id } from "../lib/ids.js";
import { HttpError } from "../lib/http.js";

export function createMailer(S, { fetchImpl = globalThis.fetch } = {}) {
  const m = S.cfg.mail ?? {};
  if (m.provider === "resend") {
    return {
      name: "resend", available: true,
      // Sending is asynchronous: callers never wait on the provider, and a delivery failure is logged
      // (the user can ask for a new code / reset link) instead of failing the request that triggered it.
      send({ userId, subject, body }) {
        const to = S.db.get("SELECT email FROM users WHERE id = ?", userId)?.email;
        if (!to) throw new HttpError(404, "no_recipient", "No email address on file.");
        const sent = fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${m.resendApiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from: m.from, to: [to], subject, text: body }),
          signal: AbortSignal.timeout(10_000),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }).catch((err) => S.log?.("mail delivery failed", err.message));
        return sent;
      },
    };
  }
  if (m.provider) throw new Error(`Unknown MAIL_PROVIDER "${m.provider}" (supported: resend).`);
  if (S.cfg.devTools) {
    return {
      name: "dev-outbox", available: true,
      send({ userId, subject, body }) {
        S.db.run("INSERT INTO dev_outbox (id, user_id, subject, body, created_at) VALUES (?,?,?,?,?)", id("mail"), userId, subject, body, Date.now());
        S.rt?.toUser(userId, { t: "dev_mail", subject });
      },
    };
  }
  return { name: "none", available: false, send() { throw new HttpError(503, "mail_not_configured", "Email delivery is not configured."); } };
}
